import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import pageStyle from "../scss/Pages.module.scss";
import styles from "../scss/UserErrors.module.scss";

const PAGE_SIZE = 20;
const STATUS_OPTIONS = [
  { value: "open", label: "Open Issue" },
  { value: "reviewed_by_dev", label: "Under Review" },
  { value: "in_dev", label: "Being Fixed" },
  { value: "fixed", label: "Fix Ready for Check" },
  { value: "closed", label: "Closed" },
];

const STATUS_LABELS = {
  open: "Open Issue",
  reviewed_by_dev: "Under Review",
  in_dev: "Being Fixed",
  fixed: "Fix Ready for Check",
  approved_by_client: "Confirmed by You",
  closed: "Closed",
};

function formatDate(dateString) {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export default function UserErrors() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [successMessage, setSuccessMessage] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [editing, setEditing] = useState(null);

  const hasPrev = page > 1;
  const hasNext = reports.length === PAGE_SIZE;
  const canManageReport = (report) => report?.isOwnReport !== false;

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccessMessage("");
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
    } catch (err) {
      setError(err.message || "Failed to load team error reports.");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadReports();
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
      setReports((prev) =>
        prev.map((item) =>
          item.id === editing.id
            ? {
                ...item,
                message: trimmedMessage,
                status: editing.status,
                updatedAt: new Date().toISOString(),
              }
            : item
        )
      );
      setEditing(null);
      setSuccessMessage("Report updated.");
    } catch (err) {
      setError(err.message || "Failed to update report.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(report) {
    if (!canManageReport(report)) return;
    if (!report?.id || deletingId) return;
    const confirmDelete = window.confirm("Delete this report?");
    if (!confirmDelete) return;
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
        throw new Error(data.message || "Failed to delete report.");
      }
      setReports((prev) => prev.filter((item) => item.id !== report.id));
      if (editing?.id === report.id) setEditing(null);
      setSuccessMessage("Report deleted.");
    } catch (err) {
      setError(err.message || "Failed to delete report.");
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
      setReports((prev) =>
        prev.map((item) =>
          item.id === report.id
            ? {
                ...item,
                status: "approved_by_client",
                updatedAt: new Date().toISOString(),
              }
            : item
        )
      );
      if (editing?.id === report.id) {
        setEditing((prev) => (prev ? { ...prev, status: "approved_by_client" } : prev));
      }
      setSuccessMessage("Report approved.");
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

  return (
    <main className={pageStyle.main}>
      <Link to="/" className={pageStyle.back}>
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Back to home
      </Link>
      <div className={pageStyle.top}>
        <h1 className={styles.pageTitle}>Team Errors</h1>
        <p>View all error reports submitted by your team, including status and attachments.</p>
      </div>

      {error && <div className={pageStyle.errorMessage}>{error}</div>}
      {successMessage && <div className={pageStyle.successMessage}>{successMessage}</div>}

      {loading ? (
        <div className={pageStyle.loading}>
          <p>Loading team errors...</p>
        </div>
      ) : reports.length === 0 ? (
        emptyState
      ) : (
        <div className={styles.list}>
          {reports.map((report) => (
            <article key={report.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <p className={styles.title}>{report.message || "Untitled error"}</p>
                <span
                  className={`${styles.statusBadge} ${
                    styles[`status_${report.status}`] || styles.status_open
                  }`}
                >
                  {STATUS_LABELS[report.status] || "Open"}
                </span>
              </div>

              <div className={styles.meta}>
                <span>Created: {formatDate(report.createdAt)}</span>
                <span>Updated: {formatDate(report.updatedAt || report.createdAt)}</span>
                <span>User: {report.userName || "Unknown"}</span>
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
                  onClick={() => handleDelete(report)}
                  disabled={!canManageReport(report) || deletingId === report.id || savingId === report.id}
                >
                  {deletingId === report.id ? "Deleting..." : "Delete"}
                </button>
                {report.status === "fixed" && canManageReport(report) && (
                  <button
                    type="button"
                    className={`${styles.primaryBtn} ${styles.approveBtn}`}
                    onClick={() => handleApprove(report)}
                    disabled={deletingId === report.id || savingId === report.id}
                  >
                    {savingId === report.id ? "Approving..." : "Approve"}
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
