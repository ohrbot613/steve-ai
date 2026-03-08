const express = require("express");
const router = express.Router();
const Sentry = require("@sentry/node");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { tryCatchAsync } = require("../controllers/ErrorController");
const { protect } = require("../controllers/AuthController");
const UserErrorReport = require("../2.0/modals/userErrorReportModal");
const {
  listUserReports,
  resolveIssue,
  getSentryConfig,
} = require("../services/sentryIssuesService");

/**
 * Parse data URL to Buffer and content type. Returns { data, contentType }.
 */
function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return null;
  }
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const base64 = match[2].replace(/\s/g, "");
  return {
    contentType: match[1].trim() || "application/octet-stream",
    data: Buffer.from(base64, "base64"),
  };
}

/** Sanitize filename for Sentry (no path, safe chars). */
function sanitizeFilename(name) {
  const base = name.replace(/^.*[/\\]/, "");
  return base.replace(/[^\w.\-]/g, "_") || "attachment";
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .map((item) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const data = typeof item?.data === "string" ? item.data : "";
      return { name, data };
    })
    .filter((item) => item.name || item.data);
}

function normalizeStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value) return "open";
  if (value === "resolved") return "closed";
  if (value === "reviewed by dev" || value === "reviewd by dev") return "reviewed_by_dev";
  if (value === "in dev") return "in_dev";
  if (value === "approved by client" || value === "appoved by client") return "approved_by_client";

  const allowed = new Set([
    "open",
    "reviewed_by_dev",
    "in_dev",
    "fixed",
    "approved_by_client",
    "closed",
  ]);
  return allowed.has(value) ? value : "open";
}

function isValidMongoId(value) {
  return /^[a-fA-F0-9]{24}$/.test(String(value || ""));
}

function buildReportAccessQuery(userId, tenantId) {
  if (tenantId) {
    return { $or: [{ tenantId }, { tenantId: null, userId }] };
  }
  return { userId };
}

const REPORT_FILES_DIR = path.resolve(
  __dirname,
  "../../steve_files_do_not_delete/errors"
);

function ensureReportFilesDir() {
  if (!fs.existsSync(REPORT_FILES_DIR)) {
    fs.mkdirSync(REPORT_FILES_DIR, { recursive: true });
  }
}

function extensionFromContentType(contentType) {
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "application/json": "json",
    "application/zip": "zip",
  };
  return map[String(contentType || "").toLowerCase()] || "bin";
}

async function saveScreenshotToDisk(screenshotData) {
  const parsed = parseDataUrl(screenshotData);
  if (!parsed || !parsed.data?.length) return null;
  ensureReportFilesDir();
  const ext = extensionFromContentType(parsed.contentType);
  const fileName = `screenshot-${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(REPORT_FILES_DIR, fileName);
  await fs.promises.writeFile(filePath, parsed.data);
  return fileName;
}

async function saveAttachmentsToDisk(attachments) {
  if (!attachments.length) return [];
  ensureReportFilesDir();
  const saved = [];
  for (const item of attachments) {
    const parsed = item?.data ? parseDataUrl(item.data) : null;
    if (!parsed || !parsed.data?.length) continue;
    const safeName = sanitizeFilename(item?.name || "attachment");
    const fileName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const filePath = path.join(REPORT_FILES_DIR, fileName);
    await fs.promises.writeFile(filePath, parsed.data);
    saved.push(fileName);
  }
  return saved;
}

/**
 * POST /api/v1/report-error
 * Auth required (protect). Body: { message: string, screenshot?: string, attachments?: Array<{ name: string, data: string }> }
 * screenshot and attachments are data URLs (base64). Used by the frontend "Report error" button.
 */
router.post(
  "/report-error",
  protect,
  tryCatchAsync(async (req, res) => {
    const { message, screenshot, attachments } = req.body || {};
    const dsn = process.env.SENTRY_DSN;
    const trimmedMessage = typeof message === "string" ? message.trim() : "";
    const screenshotData = typeof screenshot === "string" ? screenshot : null;
    const attachmentList = normalizeAttachments(attachments);
    const hasScreenshot = Boolean(screenshotData);
    const userId = req.user?._id ? String(req.user._id) : null;
    const tenantId = req.user?.tenant ? String(req.user.tenant) : null;

    if (!trimmedMessage) {
      return res.status(400).json({
        status: "fail",
        message: "Please provide a description of the error.",
      });
    }

    await saveScreenshotToDisk(screenshotData);
    await saveAttachmentsToDisk(attachmentList);

    await UserErrorReport.create({
      tenantId,
      userId,
      userEmail: req.user?.email || null,
      userName: req.user?.name || null,
      message: trimmedMessage,
      screenshot: screenshotData,
      attachments: attachmentList,
      hasScreenshot,
      attachmentsCount: attachmentList.length,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (dsn) {
      Sentry.withScope((scope) => {
        scope.setTag("source", "user_report");
        if (userId) scope.setUser({ id: userId });
        const attachmentNames = attachmentList
          .map((a) => (a?.name && typeof a.name === "string" ? a.name : null))
          .filter(Boolean);
        scope.setContext("user_report", {
          message: trimmedMessage,
          user_id: userId,
          has_screenshot: hasScreenshot,
          attachments_count: attachmentList.length,
          attachment_names: attachmentNames.length ? attachmentNames : undefined,
        });
        scope.setLevel("warning");
        scope.setFingerprint(["user-report", Date.now().toString(), Math.random().toString(36)]);
        if (screenshotData) {
          const parsed = parseDataUrl(screenshotData);
          if (parsed && parsed.data.length > 0) {
            scope.addAttachment({
              filename: "screenshot.jpg",
              data: new Uint8Array(parsed.data),
              contentType: parsed.contentType,
            });
          }
        }
        for (const item of attachmentList) {
          const name = sanitizeFilename(
            item?.name && typeof item.name === "string" ? item.name : "attachment"
          );
          const parsed = item?.data ? parseDataUrl(item.data) : null;
          if (parsed && parsed.data.length > 0) {
            scope.addAttachment({
              filename: name,
              data: new Uint8Array(parsed.data),
              contentType: parsed.contentType,
            });
          }
        }
        Sentry.captureMessage(`User report: ${trimmedMessage.slice(0, 100)}${trimmedMessage.length > 100 ? "…" : ""}`);
      });
      console.log("userId", userId);
    } else {
      console.log("[Report error] User report (Sentry not configured):", {
        message: trimmedMessage,
        user_id: userId,
        has_screenshot: hasScreenshot,
        attachments_count: attachmentList.length,
      });
    }

    res.status(200).json({
      status: "success",
      message: "Thank you. Your report has been submitted.",
    });
  })
);

/**
 * GET /api/v1/report-error/db/list
 * Returns authenticated user's team reports from DB.
 */
router.get(
  "/report-error/db/list",
  protect,
  tryCatchAsync(async (req, res) => {
    const userId = req.user?._id ? String(req.user._id) : null;
    const tenantId = req.user?.tenant ? String(req.user.tenant) : null;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Not authenticated",
      });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const query = { ...buildReportAccessQuery(userId, tenantId), archived: { $ne: true } };

    const [items, total] = await Promise.all([
      UserErrorReport.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UserErrorReport.countDocuments(query),
    ]);

    return res.status(200).json({
      status: "success",
      page,
      limit,
      total,
      items: items.map((item) => ({
        id: String(item._id),
        tenantId: item.tenantId || null,
        userId: item.userId || null,
        userEmail: item.userEmail || null,
        userName: item.userName || null,
        message: item.message || "",
        screenshot: item.screenshot || null,
        attachments: Array.isArray(item.attachments) ? item.attachments : [],
        hasScreenshot: Boolean(item.hasScreenshot),
        attachmentsCount: Number(item.attachmentsCount || 0),
        status: normalizeStatus(item.status),
        isOwnReport: item.userId === userId,
        createdAt: item.createdAt || null,
        updatedAt: item.updatedAt || null,
      })),
    });
  })
);

/**
 * PATCH /api/v1/report-error/db/:reportId
 * Edit current authenticated user's DB report (message/status).
 */
router.patch(
  "/report-error/db/:reportId",
  protect,
  tryCatchAsync(async (req, res) => {
    const userId = req.user?._id ? String(req.user._id) : null;
    const tenantId = req.user?.tenant ? String(req.user.tenant) : null;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Not authenticated",
      });
    }

    const reportId = String(req.params.reportId || "");
    if (!isValidMongoId(reportId)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid report id.",
      });
    }
    const accessQuery = buildReportAccessQuery(userId, tenantId);
    const existing = await UserErrorReport.findOne({ _id: reportId, ...accessQuery });
    if (!existing) {
      return res.status(404).json({
        status: "fail",
        message: "Report not found.",
      });
    }

    const updates = {};
    if (typeof req.body?.message === "string") {
      const trimmedMessage = req.body.message.trim();
      if (!trimmedMessage) {
        return res.status(400).json({
          status: "fail",
          message: "Message cannot be empty.",
        });
      }
      updates.message = trimmedMessage;
    }
    if (typeof req.body?.status === "string") {
      updates.status = normalizeStatus(req.body.status);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        status: "fail",
        message: "No valid fields to update.",
      });
    }

    updates.updatedAt = new Date();
    const updated = await UserErrorReport.findOneAndUpdate(
      { _id: reportId, ...accessQuery },
      updates,
      { new: true }
    ).lean();

    return res.status(200).json({
      status: "success",
      item: {
        id: String(updated._id),
        message: updated.message || "",
        status: normalizeStatus(updated.status),
        updatedAt: updated.updatedAt || null,
      },
      message: "Report updated.",
    });
  })
);

/**
 * DELETE /api/v1/report-error/db/:reportId
 * Soft-delete (archive) current authenticated user's DB report.
 */
router.delete(
  "/report-error/db/:reportId",
  protect,
  tryCatchAsync(async (req, res) => {
    const userId = req.user?._id ? String(req.user._id) : null;
    const tenantId = req.user?.tenant ? String(req.user.tenant) : null;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Not authenticated",
      });
    }
    const reportId = String(req.params.reportId || "");
    if (!isValidMongoId(reportId)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid report id.",
      });
    }
    const accessQuery = buildReportAccessQuery(userId, tenantId);
    const updated = await UserErrorReport.findOneAndUpdate(
      { _id: reportId, ...accessQuery },
      { archived: true, archivedAt: new Date(), updatedAt: new Date() },
      { new: true }
    ).lean();
    if (!updated) {
      return res.status(404).json({
        status: "fail",
        message: "Report not found.",
      });
    }
    return res.status(200).json({
      status: "success",
      message: "Report archived.",
    });
  })
);

/**
 * GET /api/v1/report-error/list
 * Returns current authenticated user's submitted reports from Sentry.
 */
router.get(
  "/report-error/list",
  protect,
  tryCatchAsync(async (req, res) => {
    const userId = req.user?._id ? String(req.user._id) : null;
    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Not authenticated",
      });
    }

    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const includeResolved = String(req.query.includeResolved || "true") !== "false";

    const config = getSentryConfig();
    if (!config.ok) {
      return res.status(503).json({
        status: "error",
        message: config.message,
      });
    }

    const result = await listUserReports({
      userId,
      page,
      limit,
      includeResolved,
    });

    return res.status(200).json({
      status: "success",
      ...result,
    });
  })
);

/**
 * POST /api/v1/report-error/:issueId/resolve
 * Resolve a Sentry issue from the app.
 */
router.post(
  "/report-error/:issueId/resolve",
  protect,
  tryCatchAsync(async (req, res) => {
    const issueId = req.params.issueId;
    if (!issueId) {
      return res.status(400).json({
        status: "fail",
        message: "Issue id is required.",
      });
    }

    const config = getSentryConfig();
    if (!config.ok) {
      return res.status(503).json({
        status: "error",
        message: config.message,
      });
    }

    await resolveIssue(issueId);

    return res.status(200).json({
      status: "success",
      message: "Issue resolved in Sentry.",
    });
  })
);

module.exports = router;
