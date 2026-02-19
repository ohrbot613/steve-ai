import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss";
import activityStyle from "../scss/Activity.module.scss";

const PROCESS_LOGS_URL = "/api/v2/process-logs";

export default function Activity() {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [searchParams, setSearchParams] = useSearchParams();
    const [pages, setPages] = useState(1);

    const page = Number(searchParams.get("page")) || 1;
    const limit = 50;

    useEffect(() => {
        async function getData() {
            setLoading(true);
            setError("");

            try {
                const response = await fetch(
                    `${PROCESS_LOGS_URL}?page=${page}&limit=${limit}`,
                    { credentials: "include" }
                );

                if (!response.ok) {
                    throw new Error("Failed to fetch activity logs");
                }

                const data = await response.json();

                if (data.success) {
                    setLogs(data.logs || []);
                    setPages(data.pages ?? 1);
                } else {
                    setError("Failed to load activity logs");
                }
            } catch (err) {
                setError("An error occurred while loading activity logs");
                console.error(err);
            } finally {
                setLoading(false);
            }
        }

        getData();
    }, [page]);

    function formatDate(dateString) {
        if (!dateString) return "Unknown";
        const date = new Date(dateString);
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const day = date.getDate();
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const seconds = date.getSeconds();
        return `${month} ${day}, ${year} • ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }

    function handlePrevPage() {
        if (page > 1) {
            setSearchParams({ page: String(page - 1) });
        }
    }

    function handleNextPage() {
        if (page < pages) {
            setSearchParams({ page: String(page + 1) });
        }
    }

    return (
        <>
            <Top />
            <main className={pageStyle.main}>
                <div className={pageStyle.top}>
                    <h1>Activity Log</h1>
                    <p>Processing history</p>
                </div>

                {error && (
                    <div className={pageStyle.errorMessage}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className={pageStyle.loading}>
                        <p>Loading activity logs...</p>
                    </div>
                ) : (
                    <>
                        <div className={activityStyle.activityList}>
                            {logs.length === 0 ? (
                                <div className={activityStyle.noData}>
                                    No activity logs found
                                </div>
                            ) : (
                                logs.map((log) => {
                                    const userName = log.userDetail
                                        ? (log.userDetail.name || log.userDetail.email)
                                        : "System";
                                    const dateStr = formatDate(log.createdAt);
                                    const firstId = log.ids?.[0];
                                    const statementId =
                                        typeof firstId === "string" && firstId.startsWith("s-")
                                            ? firstId.slice(2)
                                            : firstId;
                                    const statementHref =
                                        statementId != null ? `/single-statement/${String(statementId)}` : null;

                                    return (
                                        <div
                                            key={log._id}
                                            className={`${activityStyle.activityCard} ${activityStyle.notClickable}`}
                                        >
                                            <div className={activityStyle.activityIconContainer}>
                                                <div className={`${activityStyle.activityIcon} ${activityStyle.processed}`}>
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M20 6 9 17l-5-5"></path>
                                                    </svg>
                                                </div>
                                            </div>
                                            <div className={activityStyle.activityContent}>
                                                <h3 className={activityStyle.activityTitle}>
                                                    {log.description || "Process"}
                                                </h3>
                                                <div className={activityStyle.activityDetails}>
                                                    <span className={activityStyle.supplierName}>
                                                        User: {userName}
                                                    </span>
                                                    <span className={activityStyle.activityDate}>
                                                        {dateStr}
                                                    </span>
                                                    {statementHref && (
                                                        <Link
                                                            to={statementHref}
                                                            className={activityStyle.statementLink}
                                                        >
                                                            View statement →
                                                        </Link>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

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
                    </>
                )}
            </main>
        </>
    );
}
