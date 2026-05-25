import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import pageStyle from "../scss/Pages.module.scss";
import styles from "../scss/UserErrors.module.scss";

const PAGE_SIZE = 20;
const AUTO_REFRESH_INTERVAL_MS = 45000;
const STATUS_CONFIG = [
  { value: "open", label: "New Report", rank: 0, editable: true },
  { value: "reviewed_by_dev", label: "Under Review", rank: 1, editable: true },
  { value: "in_dev", label: "Fix in Progress", rank: 2, editable: true },
  { value: "fixed", label: "Ready for Your Review", rank: 3, editable: true },
  { value: "approved_by_client", label: "Approved by You", rank: 4, editable: false },
  { value: "closed", label: "Closed", rank: 5, editable: true },
];

const STATUS_OPTIONS = STATUS_CONFIG.filter((status) => status.editable).map(
  ({ value, label }) => ({ value, label })
);
const STATUS_LABELS = Object.fromEntries(
  STATUS_CONFIG.map(({ value, label }) => [value, label])
);
const STATUS_SORT_ORDER = Object.fromEntries(
  STATUS_CONFIG.map(({ value, rank }) => [value, rank])
);
const FILTERABLE_STATUSES = STATUS_CONFIG.map(({ value }) => value);

function formatDate(dateString, fallback = "Unknown") {
  if (!dateString) return fallback;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
}

function formatReportId(id) {
  if (!id) return "#Unknown";
  const value = String(id);
  return value.length > 8 ? `#${value.slice(-8)}` : `#${value}`;
}

export default function UserErrors() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [successMessage, setSuccessMessage] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [activeStatusFilter, setActiveStatusFilter] = useState("all");
  const [lastLoadedAt, setLastLoadedAt] = useState(null);

  const hasPrev = page > 1;
  const hasNext = reports.length === PAGE_SIZE;
  const canManageReport = (report) => Boolean(report?.id);

  const loadReports = useCallback(
    async ({
      background = false,
      preserveMessages = false,
      notifyOnError = true,
    } = {}) => {
      if (background) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
        setError("");
      }
      if (!preserveMessages) {
        setSuccessMessage("");
      }

      try {
        const response = await fetch(
          `/api/v1/report-error/db/list?page=${page}&limit=${PAGE_SIZE}`,
          {
            credentials: "include",
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.status !== "success") {
          throw new Error(data.message || "Failed to load team error reports.");
        }
        setReports(Array.isArray(data.items) ? data.items : []);
        setLastLoadedAt(new Date().toISOString());
        if (background) {
          setError("");
        }
      } catch (err) {
        if (notifyOnError) {
          setError(err.message || "Failed to load team error reports.");
        }
        if (!background) {
          setReports([]);
        }
      } finally {
        if (background) {
          setIsRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [page]
  );

  useEffect(() => {
    try {
      sessionStorage.setItem("simpleApp.cameFromErrors", "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadReports({ background: true, preserveMessages: true, notifyOnError: false });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadReports]);

  function startEdit(report) {
    if (!canManageReport(report)) return;
    setEditing({
      id: report.id,
      message: report.message || "",
      status: STATUS_LABELS[report.status] ? report.status : "open",
    });
  }

  async function handleSaveEdit() {
    if (!editing?.id) return;
    const trimmedMessage = String(editing.message || "").trim();
    if (!trimmedMessage) {
      setError("Message cannot be empty.");
      return;
    }
    setSavingId(editing.id);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/v1/report-error/db/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: trimmedMessage,
          status: editing.status,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || "Failed to update report.");
      }
      setEditing(null);
      setSuccessMessage("Report updated. Refreshing in the background...");
      await loadReports({ background: true, preserveMessages: true });
    } catch (err) {
      setError(err.message || "Failed to update report.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleArchive(report) {
    if (!canManageReport(report)) return;
    if (!report?.id || deletingId) return;
    const confirmArchive = window.confirm("Archive this report?");
    if (!confirmArchive) return;
    setDeletingId(report.id);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/v1/report-error/db/${report.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || "Failed to archive report.");
      }
      if (editing?.id === report.id) setEditing(null);
      setSuccessMessage("Report archived. Refreshing in the background...");
      await loadReports({ background: true, preserveMessages: true });
    } catch (err) {
      setError(err.message || "Failed to archive report.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleApprove(report) {
    if (!canManageReport(report)) return;
    if (!report?.id || savingId || deletingId) return;
    setSavingId(report.id);
    setError("");
    setSuccessMessage("");
    try {
      const response = await fetch(`/api/v1/report-error/db/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "approved_by_client" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== "success") {
        throw new Error(data.message || "Failed to approve report.");
      }
      if (editing?.id === report.id) {
        setEditing((prev) => (prev ? { ...prev, status: "approved_by_client" } : prev));
      }
      setSuccessMessage("Report marked as approved. Refreshing in the background...");
      await loadReports({ background: true, preserveMessages: true });
    } catch (err) {
      setError(err.message || "Failed to approve report.");
    } finally {
      setSavingId(null);
    }
  }

  const emptyState = useMemo(
    () => (
      <div className={styles.emptyState}>
        <p>No team error reports found on this page.</p>
      </div>
    ),
    []
  );

  const sortedReports = useMemo(() => {
    return [...reports].sort((a, b) => {
      const aRank = STATUS_SORT_ORDER[a?.status] ?? Number.MAX_SAFE_INTEGER;
      const bRank = STATUS_SORT_ORDER[b?.status] ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;

      const aUpdated = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      const bUpdated = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      return bUpdated - aUpdated;
    });
  }, [reports]);

  const statusCounts = useMemo(() => {
    return sortedReports.reduce(
      (acc, item) => {
        const status = item?.status || "open";
        acc.total += 1;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      { total: 0 }
    );
  }, [sortedReports]);

  const visibleReports = useMemo(() => {
    if (activeStatusFilter === "all") return sortedReports;
    return sortedReports.filter((report) => report?.status === activeStatusFilter);
  }, [activeStatusFilter, sortedReports]);

  const summaryStats = useMemo(
    () => [
      { key: "total", label: "Reports on this page", value: statusCounts.total || 0, tone: "neutral" },
      { key: "open", label: "New reports", value: statusCounts.open || 0, tone: "open" },
      { key: "in_dev", label: "Fix in progress", value: statusCounts.in_dev || 0, tone: "in_dev" },
      { key: "fixed", label: "Ready for review", value: statusCounts.fixed || 0, tone: "fixed" },
    ],
    [statusCounts]
  );

  return (
    <main className={pageStyle.main}>
      <Link to="/" className={pageStyle.back}>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back to home
      </Link>

      <section className={styles.hero}>
        <div>
          <h1 className={styles.pageTitle}>Team Errors</h1>
          <p className={styles.pageSubtitle}>
            Track, update, and close user-reported issues in one professional workflow.
          </p>
        </div>
        <div className={styles.heroActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => loadReports({ background: true, preserveMessages: true })}
            disabled={loading || isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh now"}
          </button>
          <p className={styles.refreshMeta}>
            {isRefreshing
              ? "Refreshing list in the background..."
              : lastLoadedAt
                ? `Last refreshed ${formatDate(lastLoadedAt)}`
                : "Loading the latest reports..."}
          </p>
        </div>
      </section>

      {error && <div className={pageStyle.errorMessage}>{error}</div>}
      {successMessage && <div className={pageStyle.successMessage}>{successMessage}</div>}

      {!loading && reports.length > 0 ? (
        <>
          <section className={styles.summaryGrid}>
            {summaryStats.map((item) => (
              <article
                key={item.key}
                className={`${styles.summaryCard} ${styles[`summary_${item.tone}`]}`}
              >
                <p>{item.label}</p>
                <strong>{item.value}</strong>
              </article>
            ))}
          </section>
          <section className={styles.controls}>
            <p className={styles.sortHint}>
              Sorted by status (new reports first), then most recently updated.
            </p>
            <div className={styles.filterChips}>
              <button
                type="button"
                className={`${styles.filterChip} ${
                  activeStatusFilter === "all" ? styles.filterChipActive : ""
                }`}
                onClick={() => setActiveStatusFilter("all")}
              >
                All ({statusCounts.total || 0})
              </button>
              {FILTERABLE_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`${styles.filterChip} ${
                    activeStatusFilter === status ? styles.filterChipActive : ""
                  }`}
                  onClick={() => setActiveStatusFilter(status)}
                >
                  {STATUS_LABELS[status] || status} ({statusCounts[status] || 0})
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {loading ? (
        <div className={styles.list}>
          {Array.from({ length: 4 }).map((_, index) => (
            <article
              key={`skeleton-${index}`}
              className={`${styles.card} ${styles.skeletonCard} ${styles.animatedCard}`}
              style={{ "--stagger-index": index }}
            >
              <div className={styles.cardHeader}>
                <div className={`${pageStyle.skeletonBlock} ${styles.skeletonTitle}`} />
                <div className={`${pageStyle.skeletonBlock} ${styles.skeletonBadge}`} />
              </div>
              <div className={styles.meta}>
                <div className={`${pageStyle.skeletonBlock} ${styles.skeletonMeta}`} />
                <div className={`${pageStyle.skeletonBlock} ${styles.skeletonMeta}`} />
                <div className={`${pageStyle.skeletonBlock} ${styles.skeletonMeta}`} />
              </div>
              <div className={styles.actions}>
                <div className={`${pageStyle.skeletonBlock} ${styles.skeletonButton}`} />
                <div className={`${pageStyle.skeletonBlock} ${styles.skeletonButton}`} />
              </div>
            </article>
          ))}
        </div>
      ) : reports.length === 0 ? (
        emptyState
      ) : visibleReports.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No reports found for this status filter.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {visibleReports.map((report, index) => (
            <article
              key={report.id}
              className={`${styles.card} ${styles.animatedCard}`}
              style={{ "--stagger-index": index }}
            >
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleBlock}>
                  <p className={styles.title}>{report.message || "Untitled error"}</p>
                  <p className={styles.reportId}>{formatReportId(report.id)}</p>
                </div>
                <span
                  className={`${styles.statusBadge} ${
                    styles[`status_${report.status}`] || styles.status_open
                  }`}
                >
                  {STATUS_LABELS[report.status] || STATUS_LABELS.open}
                </span>
              </div>

              <div className={styles.meta}>
                <span>Created: {formatDate(report.createdAt)}</span>
                <span>Updated: {formatDate(report.updatedAt || report.createdAt)}</span>
                <span>Reported by: {report.userName || "Unknown"}</span>
                <span>Screenshot: {report.hasScreenshot ? "Yes" : "No"}</span>
                <span>Attachments: {report.attachmentsCount || 0}</span>
              </div>

              {Array.isArray(report.attachments) && report.attachments.length > 0 ? (
                <div className={styles.attachments}>
                  {report.attachments.map((file, idx) => (
                    <span key={`${report.id}-file-${idx}`} className={styles.attachmentChip}>
                      {file?.name || `Attachment ${idx + 1}`}
                    </span>
                  ))}
                </div>
              ) : null}

              {editing?.id === report.id ? (
                <div className={styles.editPanel}>
                  <textarea
                    className={styles.editTextarea}
                    rows={4}
                    value={editing.message}
                    onChange={(e) =>
                      setEditing((prev) => ({ ...prev, message: e.target.value }))
                    }
                  />
                  <select
                    className={styles.editSelect}
                    value={editing.status}
                    onChange={(e) =>
                      setEditing((prev) => ({ ...prev, status: e.target.value }))
                    }
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      onClick={handleSaveEdit}
                      disabled={savingId === report.id}
                    >
                      {savingId === report.id ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => setEditing(null)}
                      disabled={savingId === report.id}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => startEdit(report)}
                  disabled={!canManageReport(report) || deletingId === report.id || savingId === report.id}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={styles.dangerBtn}
                  onClick={() => handleArchive(report)}
                  disabled={!canManageReport(report) || deletingId === report.id || savingId === report.id}
                >
                  {deletingId === report.id ? "Archiving..." : "Archive"}
                </button>
                {report.status === "fixed" && canManageReport(report) && (
                  <button
                    type="button"
                    className={`${styles.primaryBtn} ${styles.approveBtn}`}
                    onClick={() => handleApprove(report)}
                    disabled={deletingId === report.id || savingId === report.id}
                  >
                    {savingId === report.id ? "Approving..." : "Mark as Approved"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className={pageStyle.pagination}>
        <button
          className={pageStyle.pageButton}
          onClick={() => hasPrev && setPage((p) => p - 1)}
          disabled={!hasPrev || loading}
        >
          Previous
        </button>
        <span className={pageStyle.pageCount}>Page {page}</span>
        <button
          className={pageStyle.pageButton}
          onClick={() => hasNext && setPage((p) => p + 1)}
          disabled={!hasNext || loading}
        >
          Next
        </button>
      </div>
    </main>
  );
}
