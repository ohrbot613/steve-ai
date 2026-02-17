import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss";
import styles from "../scss/AllStatements.module.scss";

const API_BASE = "/api/v2/supplier-logs";

export default function AllStatements() {
    const [statements, setStatements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [searchParams, setSearchParams] = useSearchParams();
    const [pages, setPages] = useState(1);
    const navigate = useNavigate();

    const page = Number(searchParams.get("page")) || 1;
    const sortBy = searchParams.get("sortBy") || "processDateTime";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    function formatDate(dateString) {
        if (!dateString) return "—";
        const d = new Date(dateString);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    }

    function formatDateTime(dateString) {
        if (!dateString) return "—";
        const d = new Date(dateString);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const h = d.getHours();
        const m = d.getMinutes();
        return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    // Map 2.0 status (reconciled | partially reconciled | not reconciled) to display status
    function mapStatus(status) {
        const s = (status || "").toLowerCase();
        if (s === "reconciled") return "reconciled";
        if (s === "partially reconciled") return "partial";
        if (s === "not reconciled") return "unreconciled";
        return "pending";
    }

    function transformLogs(logs) {
        return (logs || []).map((log) => ({
            id: log._id,
            supplier: log.supplier?.name || "Unknown Supplier",
            statementIssueDate: formatDate(log.invoiceIssueDate),
            processDateTime: formatDateTime(log.addedAt),
            reconciled: Math.max(0, log.reconciled ?? 0),
            unreconciled: Math.max(0, log.unreconciled ?? 0),
            total: log.total ?? 0,
            fileId: log._id,
            file: log.file,
            addedAt: log.addedAt,
            status: mapStatus(log.status),
        }));
    }

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");

        fetch(
            `${API_BASE}/all-statements?page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}`
        )
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data.success) {
                    setStatements(transformLogs(data.logs || []));
                    setPages(data.pages ?? 1);
                } else {
                    setError("Failed to load statements");
                }
            })
            .catch((err) => {
                if (!cancelled) setError("An error occurred while loading statements");
                console.error(err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [page, sortBy, sortOrder]);

    function handleColumnClick(columnName) {
        // If clicking the same column, toggle the order
        if (sortBy === columnName) {
            const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
            setSearchParams({ page: '1', sortBy: columnName, sortOrder: newOrder });
        } else {
            // If clicking a new column, default to descending
            setSearchParams({ page: '1', sortBy: columnName, sortOrder: 'desc' });
        }
    }

    function handlePrevPage() {
        if (page > 1) {
            setSearchParams({ page: String(page - 1), sortBy, sortOrder });
        }
    }

    function handleNextPage() {
        if (page < pages) {
            setSearchParams({ page: String(page + 1), sortBy, sortOrder });
        }
    }

    function getStatusBadge(status) {
        const statusConfig = {
            pending: { label: 'Pending', className: styles.statusPending },
            unreconciled: { label: 'Unreconciled', className: styles.statusUnreconciled },
            reconciled: { label: 'Fully Reconciled', className: styles.statusReconciled },
            partial: { label: 'Partially Reconciled', className: styles.statusPartial }
        };

        const config = statusConfig[status] || statusConfig.pending;

        return (
            <div className={`${styles.statusBadge} ${config.className}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                </svg>
                <span>{config.label}</span>
            </div>
        );
    }

    function handleRowClick(statement) {
        if (statement.fileId) {
            navigate(`/single-statement/${statement.fileId}`, {
                state: { from: 'all-statements' }
            });
        }
    }

    async function handleDeleteLog(logId) {
        if (!window.confirm('Are you sure you want to delete this statement? This will also delete all invoices associated with it. This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/statements/${logId}`, {
                method: "DELETE",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
            });

            const data = await response.json();

            if (data.success) {
                const refreshResponse = await fetch(
                    `${API_BASE}/all-statements?page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}`
                );
                const refreshData = await refreshResponse.json();
                if (refreshData.success) {
                    setStatements(transformLogs(refreshData.logs || []));
                    setPages(refreshData.pages ?? 1);
                }
            } else {
                setError(data.message || 'Failed to delete statement');
            }
        } catch (err) {
            setError('An error occurred while deleting the statement');
            console.error(err);
        }
    }

    return (
        <>
            <Top />
            <main className={pageStyle.main}>
                <div className={pageStyle.top}>
                    {loading ? (
                        <>
                            <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ height: '2.8rem', marginBottom: '0.8rem', maxWidth: '22rem' }} />
                            <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} style={{ height: '1.6rem', maxWidth: '18rem' }} />
                        </>
                    ) : (
                        <>
                            <h1>All Statements</h1>
                            <p>Cross-supplier statement overview</p>
                        </>
                    )}
                </div>

                {error && (
                    <div className={pageStyle.errorMessage}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className={pageStyle.tableContainer}>
                        <table className={styles.statementsTable}>
                            <thead>
                                <tr>
                                    <th>SUPPLIER</th>
                                    <th>STATEMENT ISSUE DATE</th>
                                    <th>PROCESS DATE/TIME</th>
                                    <th>STATUS</th>
                                    <th>RECONCILED INVOICES</th>
                                    <th>UNRECONCILED INVOICES</th>
                                    <th>TOTAL INVOICES</th>
                                    <th>FILE</th>
                                    <th>ACTIONS</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...Array(10)].map((_, i) => (
                                    <tr key={`skeleton-${i}`} className={pageStyle.skeletonRow}>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ maxWidth: '14rem' }} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '10rem' }} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '2.4rem' }} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '2.4rem' }} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '2.4rem' }} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '6rem' }} /></td>
                                        <td><div className={pageStyle.skeletonBlock} style={{ width: '2.4rem', height: '2.4rem', borderRadius: '0.4rem' }} /></td>
                                        <td><div className={pageStyle.skeletonBlock} style={{ width: '1.6rem', height: '1.6rem', margin: '0 auto', borderRadius: '0.4rem' }} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className={pageStyle.tableContainer}>
                        <table className={styles.statementsTable}>
                            <thead>
                                <tr>
                                    <th onClick={() => handleColumnClick('supplier')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            SUPPLIER {sortBy === 'supplier' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('statementIssueDate')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            STATEMENT ISSUE DATE {sortBy === 'statementIssueDate' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('processDateTime')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            PROCESS DATE/TIME {sortBy === 'processDateTime' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('status')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            STATUS {sortBy === 'status' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('reconciled')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            RECONCILED INVOICES {sortBy === 'reconciled' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('unreconciled')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            UNRECONCILED INVOICES {sortBy === 'unreconciled' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('total')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            TOTAL INVOICES {sortBy === 'total' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th>FILE</th>
                                    <th>ACTIONS</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {statements.length === 0 ? (
                                    <tr>
                                        <td colSpan="9" className={pageStyle.noData}>
                                            No statements found
                                        </td>
                                    </tr>
                                ) : (
                                    statements.map((statement) => (
                                        <tr
                                            key={statement.id}
                                            className={styles.statementRow}
                                            onClick={() => handleRowClick(statement)}
                                        >
                                            <td>
                                                <div className={styles.supplierName}>
                                                    {statement.supplier}
                                                </div>
                                            </td>
                                            <td>
                                                <div className={styles.dateText}>
                                                    {statement.statementIssueDate}
                                                </div>
                                            </td>
                                            <td>
                                                <div className={styles.dateTimeText}>
                                                    {statement.processDateTime}
                                                </div>
                                            </td>
                                            <td>
                                                {getStatusBadge(statement.status)}
                                            </td>
                                            <td>
                                                <div className={styles.reconciledNumber}>
                                                    {statement.reconciled}
                                                </div>
                                            </td>
                                            <td>
                                                <div className={styles.unreconciledNumber}>
                                                    {statement.unreconciled}
                                                </div>
                                            </td>
                                            <td>
                                                <div className={styles.totalNumber}>
                                                    {statement.total}
                                                </div>
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                {statement.fileId ? (
                                                    <a 
                                                        href={`/file/${statement.fileId}`} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer" 
                                                        className={pageStyle.downloadLink}
                                                    >
                                                        Download
                                                    </a>
                                                ) : (
                                                    <span className={styles.noFile}>—</span>
                                                )}
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => handleDeleteLog(statement.fileId)}
                                                    className={pageStyle.deleteButton}
                                                    title="Delete statement"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M3 6h18"></path>
                                                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                                    </svg>
                                                </button>
                                            </td>
                                            <td>
                                                <svg className={pageStyle.arrowIcon} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="m9 18 6-6-6-6"></path>
                                                </svg>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {!loading && statements.length > 0 && (
                    <div className={pageStyle.pagination}>
                        <button
                            onClick={handlePrevPage}
                            disabled={page <= 1}
                            className={pageStyle.pageButton}
                        >
                            Previous
                        </button>
                        <span className={pageStyle.pageCount}>
                            {page} / {pages === 0 ? 1 : pages}
                        </span>
                        <button
                            onClick={handleNextPage}
                            disabled={page >= pages}
                            className={pageStyle.pageButton}
                        >
                            Next
                        </button>
                    </div>
                )}
            </main>
        </>
    )
}
