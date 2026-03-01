const axios = require("axios");

const SENTRY_BASE_URL = "https://sentry.io/api/0";

function getSentryConfig() {
  const token = process.env.SENTRY_API_TOKEN;
  const orgSlug = process.env.SENTRY_ORG_SLUG;
  const projectSlug = process.env.SENTRY_PROJECT_SLUG;

  if (!token || !orgSlug || !projectSlug) {
    return {
      ok: false,
      message:
        "Sentry API is not configured. Please set SENTRY_API_TOKEN, SENTRY_ORG_SLUG, and SENTRY_PROJECT_SLUG.",
    };
  }

  return {
    ok: true,
    token,
    orgSlug,
    projectSlug,
  };
}

function createSentryClient(token) {
  return axios.create({
    baseURL: SENTRY_BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
}

function buildUserReportQuery(userId, includeResolved) {
  const statusFilter = includeResolved ? "" : "is:unresolved ";
  return `${statusFilter}source:user_report user.id:"${String(userId)}"`;
}

function normalizeIssue(issue) {
  return {
    id: issue.id,
    shortId: issue.shortId || null,
    title: issue.title || "Untitled error",
    culprit: issue.culprit || null,
    status: issue.status || "unknown",
    level: issue.level || null,
    count: issue.count || "0",
    userCount: issue.userCount || 0,
    firstSeen: issue.firstSeen || null,
    lastSeen: issue.lastSeen || null,
    permalink: issue.permalink || null,
  };
}

async function listUserReports({ userId, page = 1, limit = 20, includeResolved = true }) {
  const config = getSentryConfig();
  if (!config.ok) {
    const err = new Error(config.message);
    err.statusCode = 503;
    throw err;
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const sentryQuery = buildUserReportQuery(userId, includeResolved);
  const client = createSentryClient(config.token);
  const requestedCount = Math.min(safePage * safeLimit, 100);

  const response = await client.get(
    `/projects/${encodeURIComponent(config.orgSlug)}/${encodeURIComponent(config.projectSlug)}/issues/`,
    {
      params: {
        query: sentryQuery,
        limit: requestedCount,
      },
    }
  );

  const items = Array.isArray(response.data) ? response.data : [];
  const startIndex = (safePage - 1) * safeLimit;
  const pageItems = items.slice(startIndex, startIndex + safeLimit);
  return {
    page: safePage,
    limit: safeLimit,
    items: pageItems.map(normalizeIssue),
  };
}

async function resolveIssue(issueId) {
  const config = getSentryConfig();
  if (!config.ok) {
    const err = new Error(config.message);
    err.statusCode = 503;
    throw err;
  }

  const client = createSentryClient(config.token);
  await client.put(`/issues/${encodeURIComponent(String(issueId))}/`, {
    status: "resolved",
  });
}

module.exports = {
  getSentryConfig,
  listUserReports,
  resolveIssue,
};
