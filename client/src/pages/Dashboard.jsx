import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss";
const DASHBOARD_STATS_URL = "/api/v2/dashboard/stats";
const UNMATCHED_EXPORT_URL = "/api/v2/dashboard/unmatched-invoices-export";

const ALLOWED_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
];
const ALLOWED_EXT = [".pdf", ".xlsx", ".xls"];

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [uploadLoading, setUploadLoading] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState("");
    const [uploadError, setUploadError] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [exportUnmatchedLoading, setExportUnmatchedLoading] = useState(false);

    const fetchStats = useCallback(async () => {
        try {
            const response = await fetch(DASHBOARD_STATS_URL, {
                method: "GET",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data?.message || "Failed to load dashboard stats");
                return;
            }
            if (data.success && data != null) {
                setStats({
                    bankBalance: data.bankBalance ?? null,
                    unmatchedCount: data.unmatchedCount ?? 0,
                    invoicesToPayCount: data.invoicesToPayCount ?? 0,
                    overdueCount: data.overdueCount ?? 0,
                });
            }
        } catch (err) {
            setError(err.message || "Failed to load dashboard stats");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchStats();
    }, [fetchStats]);

    function handleFileSelect(e) {
        const files = e.target.files;
        if (files?.length > 0) handleFileUpload(files);
        e.target.value = "";
    }

    async function handleFileUpload(files) {
        if (!files?.length) return;
        const fileArray = Array.from(files);
        const invalid = fileArray.filter((f) => {
            const ext = f.name.toLowerCase().slice(f.name.lastIndexOf("."));
            return !ALLOWED_TYPES.includes(f.type) && !ALLOWED_EXT.includes(ext);
        });
        if (invalid.length > 0) {
            setUploadError(
                `Please upload only PDF or Excel (.pdf, .xlsx, .xls). Invalid: ${invalid.map((f) => f.name).join(", ")}`
            );
            return;
        }
        setUploadLoading(true);
        setUploadError("");
        setUploadSuccess("");
        const successes = [];
        const errors = [];
        try {
            if (fileArray.length > 1) {
                // Batch upload: one request, one activity log for all
                const formData = new FormData();
                fileArray.forEach((file) => formData.append("files", file));
                const response = await fetch("/api/v2/invoice/batch-invoice-file-upload", {
                    method: "POST",
                    body: formData,
                    credentials: "include",
                });
                const data = await response.json();
                if (!response.ok) {
                    setUploadError(data.message || "Batch upload failed");
                    return;
                }
                (data.results || []).forEach((r) =>
                    successes.push({ fileName: r.fileName, createdCount: r.createdCount ?? 0 })
                );
                (data.errors || []).forEach((e) => errors.push({ fileName: e.fileName, error: e.error }));
                if (successes.length > 0) {
                    const totalCreated = successes.reduce((s, x) => s + x.createdCount, 0);
                    let msg = `${successes.length} file(s) processed.`;
                    if (totalCreated > 0) msg += ` ${totalCreated} invoice(s) saved.`;
                    if (errors.length > 0) msg += ` ${errors.length} failed.`;
                    setUploadSuccess(msg);
                    fetchStats();
                }
                if (errors.length > 0 && successes.length === 0) {
                    setUploadError(
                        errors.length === 1 ? errors[0].error : errors.map((e) => `${e.fileName}: ${e.error}`).join("; ")
                    );
                }
            } else {
                const file = fileArray[0];
                const formData = new FormData();
                formData.append("file", file);
                const response = await fetch("/api/v2/invoice/invoice-file-upload", {
                    method: "POST",
                    body: formData,
                    credentials: "include",
                });
                const data = await response.json();
                if (!response.ok) {
                    errors.push({ fileName: file.name, error: data.message || "Failed to parse file" });
                } else if (data.success) {
                    const createdCount = data.createdCount ?? (data.created?.length ?? 0);
                    successes.push({ fileName: file.name, createdCount });
                } else {
                    errors.push({ fileName: file.name, error: data.message || "Failed to process file" });
                }
                if (successes.length > 0) {
                    const totalCreated = successes.reduce((s, x) => s + x.createdCount, 0);
                    let msg = `"${successes[0].fileName}" processed.`;
                    if (totalCreated > 0) msg += ` ${totalCreated} invoice(s) saved.`;
                    setUploadSuccess(msg);
                    fetchStats();
                }
                if (errors.length > 0 && successes.length === 0) {
                    setUploadError(errors[0].error);
                }
            }
        } catch (err) {
            setUploadError(err.message || "Upload failed");
        } finally {
            setUploadLoading(false);
        }
    }

    function handleDragOver(e) {
        e.preventDefault();
        setIsDragging(true);
    }
    function handleDragLeave(e) {
        e.preventDefault();
        setIsDragging(false);
    }
    function handleDrop(e) {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) handleFileUpload(e.dataTransfer.files);
    }

    const exportUnmatchedToExcel = useCallback(async () => {
        setExportUnmatchedLoading(true);
        try {
            const response = await fetch(UNMATCHED_EXPORT_URL, {
                method: "GET",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data?.message || "Failed to export unmatched invoices");
                return;
            }
            const invoices = data.invoices ?? [];
            const headers = [
                "Invoice #",
                "Supplier",
                "Amount",
                "Currency",
                "Date",
                "Due date",
                "Source",
                "Description",
                "Job #",
                "Status",
            ];
            const rows = invoices.map((inv) => [
                inv.invoiceNumber ?? "",
                inv.supplier ?? "",
                inv.amount !== "" ? Number(inv.amount) : "",
                inv.currency ?? "",
                inv.date ?? "",
                inv.dueDate ?? "",
                inv.source ?? "",
                inv.description ?? "",
                inv.jobNumber ?? "",
                inv.status ?? "",
            ]);
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Unmatched invoices");
            const filename = `unmatched-invoices-${new Date().toISOString().slice(0, 10)}.xlsx`;
            XLSX.writeFile(wb, filename);
        } catch (err) {
            setError(err?.message || "Export failed");
        } finally {
            setExportUnmatchedLoading(false);
        }
    }, []);

    return (
        <div>
            <Top />
            <div className={pageStyle.main}>
                <div className={pageStyle.top}>
                    <h1 style={{ fontSize: "2.4rem", fontWeight: 600, color: "rgb(62, 75, 95)" }}>
                        Version 2.0 Dashboard
                    </h1>
                    <p style={{ fontSize: "1.5rem", color: "rgb(100, 116, 139)", marginTop: "0.8rem" }}>
                        Overview of bank balance, reconciliation, and payment run metrics.
                    </p>
                </div>

                {error && (
                    <div
                        style={{
                            padding: "1.6rem",
                            backgroundColor: "#fef2f2",
                            border: "1px solid #fecaca",
                            borderRadius: "0.8rem",
                            marginBottom: "2rem",
                        }}
                    >
                        <p style={{ fontSize: "1.5rem", color: "#b91c1c" }}>{error}</p>
                    </div>
                )}

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(22rem, 1fr))",
                        gap: "2rem",
                        marginBottom: "2.4rem",
                    }}
                >
                    {/* Bank balance (from Team model) */}
                    <div
                        style={{
                            padding: "1.6rem 2rem",
                            backgroundColor: "#fff",
                            borderRadius: "0.8rem",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                            borderLeft: "4px solid #2563eb",
                        }}
                    >
                        <div style={{ fontSize: "1.3rem", color: "#6b7280", marginBottom: "0.4rem" }}>
                            Bank account balance (£)
                        </div>
                        <div style={{ fontSize: "2rem", fontWeight: 600, color: "#1f2937" }}>
                            {loading
                                ? "…"
                                : stats?.bankBalance != null
                                ? new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(stats.bankBalance)
                                : "—"}
                        </div>
                        <div style={{ fontSize: "1rem", color: "#9ca3af", marginTop: "0.4rem" }}>
                           100K reserve included
                        </div>
                    </div>

                    {/* Unmatched invoices */}
                    <div
                        style={{
                            padding: "1.6rem 2rem",
                            backgroundColor: "#fff",
                            borderRadius: "0.8rem",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                            borderLeft: "4px solid #d97706",
                        }}
                    >
                        <div style={{ fontSize: "1.3rem", color: "#6b7280", marginBottom: "0.4rem" }}>
                            Unmatched invoices
                        </div>
                        <div style={{ fontSize: "2rem", fontWeight: 600, color: "#1f2937" }}>
                            {loading ? "…" : stats?.unmatchedCount ?? "—"}
                        </div>
                        <div style={{ fontSize: "1rem", color: "#9ca3af", marginTop: "0.4rem" }}>
                            Invoice numbers without Xero or file matches
                        </div>
                        <button
                            type="button"
                            onClick={exportUnmatchedToExcel}
                            disabled={exportUnmatchedLoading || (stats?.unmatchedCount ?? 0) === 0}
                            style={{
                                marginTop: "0.8rem",
                                fontSize: "1.3rem",
                                padding: "0.4rem 0.8rem",
                                color: "#d97706",
                                fontWeight: 500,
                                background: "transparent",
                                border: "1px solid #d97706",
                                borderRadius: "0.4rem",
                                cursor: exportUnmatchedLoading || (stats?.unmatchedCount ?? 0) === 0 ? "not-allowed" : "pointer",
                                opacity: exportUnmatchedLoading || (stats?.unmatchedCount ?? 0) === 0 ? 0.6 : 1,
                            }}
                        >
                            {exportUnmatchedLoading ? "Exporting…" : "Export to Excel"}
                        </button>
                    </div>

                    {/* Invoices to pay */}
                    <div
                        style={{
                            padding: "1.6rem 2rem",
                            backgroundColor: "#fff",
                            borderRadius: "0.8rem",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                            borderLeft: "4px solid #059669",
                        }}
                    >
                        <div style={{ fontSize: "1.3rem", color: "#6b7280", marginBottom: "0.4rem" }}>
                            Invoices to pay
                        </div>
                        <div style={{ fontSize: "2rem", fontWeight: 600, color: "#1f2937" }}>
                            {loading ? "…" : stats?.invoicesToPayCount ?? "—"}
                        </div>
                        <div style={{ fontSize: "1rem", color: "#9ca3af", marginTop: "0.4rem" }}>
                            Payment-run candidates
                        </div>
                        <Link
                            to="/v1/run-payments"
                            style={{
                                display: "inline-block",
                                marginTop: "0.8rem",
                                fontSize: "1.3rem",
                                color: "#059669",
                                fontWeight: 500,
                            }}
                        >
                            Run payment run →
                        </Link>
                    </div>

                    {/* Overdue / payment run negatives */}
                    <div
                        style={{
                            padding: "1.6rem 2rem",
                            backgroundColor: "#fff",
                            borderRadius: "0.8rem",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                            borderLeft: "4px solid #dc2626",
                        }}
                    >
                        <div style={{ fontSize: "1.3rem", color: "#6b7280", marginBottom: "0.4rem" }}>
                            Overdue (payment run)
                        </div>
                        <div style={{ fontSize: "2rem", fontWeight: 600, color: "#1f2937" }}>
                            {loading ? "…" : stats?.overdueCount ?? "—"}
                        </div>
                        <div style={{ fontSize: "1rem", color: "#9ca3af", marginTop: "0.4rem" }}>
                            Candidates past due date
                        </div>
                    </div>
                </div>

                {/* Upload statements */}
                <div style={{ marginBottom: "2.4rem" }}>
                    <h2 style={{ fontSize: "1.8rem", fontWeight: 600, color: "#374151", marginBottom: "1.2rem" }}>
                        Upload statements
                    </h2>
                    <div
                        className={`${pageStyle.dropZone} ${isDragging ? pageStyle.dragging : ""} ${uploadLoading ? pageStyle.uploading : ""}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        {uploadLoading ? (
                            <div className={pageStyle.uploadLoader}>
                                <div className={pageStyle.spinner}></div>
                                <p>Uploading and processing file...</p>
                            </div>
                        ) : (
                            <>
                                <svg
                                    className={pageStyle.uploadIcon}
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="17 8 12 3 7 8"></polyline>
                                    <line x1="12" y1="3" x2="12" y2="15"></line>
                                </svg>
                                <p>Drag and drop PDF or Excel file(s) or browse</p>
                                <input
                                    type="file"
                                    accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                    onChange={handleFileSelect}
                                    className={pageStyle.fileInput}
                                    multiple
                                />
                                <button
                                    type="button"
                                    className={pageStyle.browseButton}
                                    onClick={() => document.querySelector(`.${pageStyle.fileInput}`)?.click()}
                                >
                                    Browse
                                </button>
                            </>
                        )}
                    </div>
                    {uploadSuccess && (
                        <div className={pageStyle.successMessage} style={{ marginTop: "1rem" }}>
                            {uploadSuccess}
                        </div>
                    )}
                    {uploadError && (
                        <div className={pageStyle.errorMessage} style={{ marginTop: "1rem" }}>
                            {uploadError}
                        </div>
                    )}
                </div>

                {!loading && !error && (
                    <p style={{ fontSize: "1.4rem", color: "#6b7280" }}>
                        <Link to="/v1/suppliers" style={{ color: "#2563eb", fontWeight: 500 }}>
                            Reconciliation
                        </Link>
                        {" · "}
                        <Link to="/v1/run-payments" style={{ color: "#2563eb", fontWeight: 500 }}>
                            Payment run
                        </Link>
                    </p>
                )}
            </div>
        </div>
    );
}
