const express = require("express");
const router = express.Router();
const Sentry = require("@sentry/node");
const { tryCatchAsync } = require("../controllers/ErrorController");
const { protect } = require("../controllers/AuthController");
const User = require("../modals/userModal");

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

    if (!trimmedMessage) {
      return res.status(400).json({
        status: "fail",
        message: "Please provide a description of the error.",
      });
    }

    const hasScreenshot = Boolean(screenshot && typeof screenshot === "string");
    const attachmentList = Array.isArray(attachments) ? attachments : [];
    const userId = req.user?._id ? String(req.user._id) : null;

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
        if (screenshot && typeof screenshot === "string") {
          const parsed = parseDataUrl(screenshot);
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

module.exports = router;
