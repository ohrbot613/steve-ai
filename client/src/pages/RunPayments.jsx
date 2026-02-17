import { useEffect, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss";

const PAYMENT_RUN_URL = "/api/v2/scripts/payment-run-invoice";

export default function RunPayments() {
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const runPayment = useCallback(async () => {
        setLoading(true);
        setError("");
        setResult(null);
        try {
            const response = await fetch(PAYMENT_RUN_URL, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
            });
            const data = await response.json();

            if (!response.ok) {
                setError(data?.message || "Request failed");
                setLoading(false);
                return;
            }

            if (data.success === false) {
                setError(data.message || "Payment run could not be completed");
                setResult(null);
            } else {
                setResult(data);
                setError("");
            }
        } catch (err) {
            setError(err.message || "An error occurred");
            setResult(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        runPayment();
    }, []);

    const payable = result?.payable ?? [];
    const balance = result?.balance;
    const payableTotal = result?.payableTotal ?? "0.00";
    const totalCandidates = result?.total ?? 0;

    const exportToCsv = useCallback(() => {
        if (payable.length === 0) return;
        const headers = ["Invoice #", "Contact name", "Currency", "Amount", "Due date", "Due in (days)", "Payment terms (days)"];
        const escape = (v) => {
            const s = String(v ?? "");
            return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const rows = payable.map((item) => {
            const [docs, dueInDays, dueDate, paymentTermsDays, contactName] = item;
            const doc = docs?.[0];
            const amount = doc?.amount != null ? Number(doc.amount).toFixed(2) : "";
            const dueStr = dueDate ? new Date(dueDate).toLocaleDateString("en-US") : "";
            return [
                escape(doc?.invoiceNumber),
                escape(contactName),
                escape(doc?.currency),
                amount,
                dueStr,
                dueInDays ?? "",
                paymentTermsDays ?? "",
            ];
        });
        const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `payment-run-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [payable]);

    const exportToExcel = useCallback(() => {
        if (payable.length === 0) return;
        const headers = ["Invoice #", "Contact name", "Currency", "Amount", "Due date", "Due in (days)", "Payment terms (days)"];
        const rows = payable.map((item) => {
            const [docs, dueInDays, dueDate, paymentTermsDays, contactName] = item;
            const doc = docs?.[0];
            const amount = doc?.amount != null ? Number(doc.amount).toFixed(2) : "";
            const dueStr = dueDate ? new Date(dueDate).toLocaleDateString("en-US") : "";
            return [
                doc?.invoiceNumber ?? "",
                contactName ?? "",
                doc?.currency ?? "",
                amount,
                dueStr,
                dueInDays ?? "",
                paymentTermsDays ?? "",
            ];
        });
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Payment run");
        const filename = `payment-run-${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, filename);
    }, [payable]);

    return (
        <div>
            <Top />
            <div className={pageStyle.main}>
                <div className={pageStyle.top}>
                    <h1 style={{ fontSize: "2.4rem", fontWeight: 600, color: "rgb(62, 75, 95)" }}>
                        Supplier payment run
                    </h1>
                    <p style={{ fontSize: "1.5rem", color: "rgb(100, 116, 139)", marginTop: "0.8rem" }}>
                        Auto-generated payment run based on duplicate invoices and available balance.
                    </p>
                </div>

                <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginBottom: "2rem" }}>
                    <button
                        type="button"
                        onClick={runPayment}
                        disabled={loading}
                        style={{
                            padding: "1rem 1.6rem",
                            fontSize: "1.5rem",
                            fontWeight: 500,
                            backgroundColor: "#2563eb",
                            color: "#fff",
                            border: "none",
                            borderRadius: "0.8rem",
                            cursor: loading ? "not-allowed" : "pointer",
                            opacity: loading ? 0.7 : 1,
                        }}
                    >
                        Regenerate
                    </button>
                    <button
                        type="button"
                        onClick={exportToCsv}
                        disabled={payable.length === 0}
                        style={{
                            padding: "1rem 1.6rem",
                            fontSize: "1.5rem",
                            fontWeight: 500,
                            backgroundColor: "#059669",
                            color: "#fff",
                            border: "none",
                            borderRadius: "0.8rem",
                            cursor: payable.length === 0 ? "not-allowed" : "pointer",
                            opacity: payable.length === 0 ? 0.6 : 1,
                        }}
                    >
                        Export to CSV
                    </button>
                    <button
                        type="button"
                        onClick={exportToExcel}
                        disabled={payable.length === 0}
                        style={{
                            padding: "1rem 1.6rem",
                            fontSize: "1.5rem",
                            fontWeight: 500,
                            backgroundColor: "#0d9488",
                            color: "#fff",
                            border: "none",
                            borderRadius: "0.8rem",
                            cursor: payable.length === 0 ? "not-allowed" : "pointer",
                            opacity: payable.length === 0 ? 0.6 : 1,
                        }}
                    >
                        Export to Excel
                    </button>
                    {loading && <span style={{ fontSize: "1.4rem", color: "#6b7280" }}>Running…</span>}
                </div>

                {loading && (
                    <p style={{ fontSize: "1.5rem", color: "#6b7280" }}>Running payment…</p>
                )}

                {!loading && error && (
                    <div style={{
                        padding: "1.6rem",
                        backgroundColor: "#fef2f2",
                        border: "1px solid #fecaca",
                        borderRadius: "0.8rem",
                        marginBottom: "2rem",
                    }}>
                        <p style={{ fontSize: "1.5rem", color: "#b91c1c" }}>{error}</p>
                    </div>
                )}

                {!loading && result && result.success && (
                    <>
                        <div style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "2rem",
                            marginBottom: "2.4rem",
                        }}>
                            <div style={{
                                padding: "1.6rem 2rem",
                                backgroundColor: "#fff",
                                borderRadius: "0.8rem",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                                minWidth: "14rem",
                            }}>
                                <div style={{ fontSize: "1.3rem", color: "#6b7280", marginBottom: "0.4rem" }}>Available balance</div>
                                <div style={{ fontSize: "2rem", fontWeight: 600, color: "#1f2937" }}>
                                    {balance != null ? Number(balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                                </div>
                                <div style={{ fontSize: "1rem", color: "#9ca3af", marginTop: "0.4rem" }}>
                                    100K reserved
                                </div>
                            </div>
                            <div style={{
                                padding: "1.6rem 2rem",
                                backgroundColor: "#fff",
                                borderRadius: "0.8rem",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                                minWidth: "14rem",
                            }}>
                                <div style={{ fontSize: "1.3rem", color: "#6b7280", marginBottom: "0.4rem" }}>Payable total</div>
                                <div style={{ fontSize: "2rem", fontWeight: 600, color: "#059669" }}>
                                    {payableTotal}
                                </div>
                            </div>
                            <div style={{
                                padding: "1.6rem 2rem",
                                backgroundColor: "#fff",
                                borderRadius: "0.8rem",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                                minWidth: "14rem",
                            }}>
                                <div style={{ fontSize: "1.3rem", color: "#6b7280", marginBottom: "0.4rem" }}>Invoices in run</div>
                                <div style={{ fontSize: "2rem", fontWeight: 600, color: "#1f2937" }}>
                                    {payable.length}
                                </div>
                            </div>
                            <div style={{
                                padding: "1.6rem 2rem",
                                backgroundColor: "#fff",
                                borderRadius: "0.8rem",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                                minWidth: "14rem",
                            }}>
                                <div style={{ fontSize: "1.3rem", color: "#6b7280", marginBottom: "0.4rem" }}>Total candidates</div>
                                <div style={{ fontSize: "2rem", fontWeight: 600, color: "#1f2937" }}>
                                    {totalCandidates}
                                </div>
                            </div>
                        </div>

                        {payable.length > 0 && (
                            <div style={{ marginBottom: "2rem" }}>
                                <h2 style={{ fontSize: "1.8rem", fontWeight: 600, color: "#374151", marginBottom: "1.2rem" }}>
                                    Payable invoices
                                </h2>
                                <div style={{
                                    overflowX: "auto",
                                    backgroundColor: "#fff",
                                    borderRadius: "0.8rem",
                                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                                }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "1.4rem" }}>
                                        <thead>
                                            <tr style={{ borderBottom: "2px solid #e5e7eb", backgroundColor: "#f9fafb" }}>
                                                <th style={{ textAlign: "left", padding: "1.2rem 1.6rem", fontWeight: 600, color: "#374151" }}>Invoice #</th>
                                                <th style={{ textAlign: "left", padding: "1.2rem 1.6rem", fontWeight: 600, color: "#374151" }}>Contact name</th>
                                                <th style={{ textAlign: "left", padding: "1.2rem 1.6rem", fontWeight: 600, color: "#374151" }}>Currency</th>
                                                <th style={{ textAlign: "right", padding: "1.2rem 1.6rem", fontWeight: 600, color: "#374151" }}>Amount</th>
                                                <th style={{ textAlign: "left", padding: "1.2rem 1.6rem", fontWeight: 600, color: "#374151" }}>Due date</th>
                                                <th style={{ textAlign: "center", padding: "1.2rem 1.6rem", fontWeight: 600, color: "#374151" }}>Due in (days)</th>
                                                <th style={{ textAlign: "center", padding: "1.2rem 1.6rem", fontWeight: 600, color: "#374151" }}>Payment terms (days)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {payable.map((item, idx) => {
                                                const [docs, dueInDays, dueDate, paymentTermsDays, contactName] = item;
                                                const doc = docs?.[0];
                                                if (!doc) return null;
                                                const amount = doc.amount != null ? Number(doc.amount).toFixed(2) : "—";
                                                const dueStr = dueDate ? new Date(dueDate).toLocaleDateString("en-US") : "—";
                                                return (
                                                    <tr key={idx} style={{ borderBottom: "1px solid #e5e7eb" }}>
                                                        <td style={{ padding: "1.2rem 1.6rem", color: "#1f2937" }}>{doc.invoiceNumber ?? "—"}</td>
                                                        <td style={{ padding: "1.2rem 1.6rem", color: "#1f2937" }}>{contactName ?? "—"}</td>
                                                        <td style={{ padding: "1.2rem 1.6rem", color: "#1f2937" }}>{doc.currency ?? "—"}</td>
                                                        <td style={{ padding: "1.2rem 1.6rem", textAlign: "right", color: "#1f2937" }}>{amount}</td>
                                                        <td style={{ padding: "1.2rem 1.6rem", color: "#1f2937" }}>{dueStr}</td>
                                                        <td style={{ padding: "1.2rem 1.6rem", textAlign: "center", color: "#1f2937" }}>{dueInDays ?? "—"}</td>
                                                        <td style={{ padding: "1.2rem 1.6rem", textAlign: "center", color: "#1f2937" }}>{paymentTermsDays ?? "—"}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {!loading && !result && !error && (
                    <p style={{ fontSize: "1.5rem", color: "#6b7280" }}>No data yet. Click Regenerate after the first run if needed.</p>
                )}
            </div>
        </div>
    );
}
