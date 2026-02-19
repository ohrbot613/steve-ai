import { useEffect, useState } from "react";
import { useSearchParams, useParams, Link, useNavigate } from "react-router-dom";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss";
import { getCurrencySymbol } from "../utils/currencyUtils";
import { exportToCSV, exportToExcel } from "../utils/exportUtils";

const API_BASE = "/api/v2/supplier-logs";

export default function SupplierLogsV2() {
    const { supplierId } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const supplierName = searchParams.get("name") || "Supplier";
    const page = Number(searchParams.get("page")) || 1;
    const invoicePage = Number(searchParams.get("invoicePage")) || 1;
    const missedInvoicePage = Number(searchParams.get("missedInvoicePage")) || 1;
    const unmatchedInvoicePage = Number(searchParams.get("unmatchedInvoicePage")) || 1;
    const matchedInvoicePage = Number(searchParams.get("matchedInvoicePage")) || 1;
    const sortBy = searchParams.get("sortBy") || "processDateTime";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const invoiceSortBy = searchParams.get("invoiceSortBy") || "addedAt";
    const invoiceSortOrder = searchParams.get("invoiceSortOrder") || "desc";
    const missedInvoiceSortBy = searchParams.get("missedInvoiceSortBy") || "addedAt";
    const missedInvoiceSortOrder = searchParams.get("missedInvoiceSortOrder") || "desc";
    const unmatchedInvoiceSortBy = searchParams.get("unmatchedInvoiceSortBy") || "addedAt";
    const unmatchedInvoiceSortOrder = searchParams.get("unmatchedInvoiceSortOrder") || "desc";
    const matchedInvoiceSortBy = searchParams.get("matchedInvoiceSortBy") || "addedAt";
    const matchedInvoiceSortOrder = searchParams.get("matchedInvoiceSortOrder") || "desc";
    const paymentFilter = searchParams.get("paymentFilter") || "all";

    const [logs, setLogs] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [missedInvoices, setMissedInvoices] = useState([]);
    const [unmatchedInvoices, setUnmatchedInvoices] = useState([]);
    const [matchedInvoices, setMatchedInvoices] = useState([]);
    const [pages, setPages] = useState(1);
    const [invoicePages, setInvoicePages] = useState(1);
    const [missedInvoicePages, setMissedInvoicePages] = useState(1);
    const [unmatchedInvoicePages, setUnmatchedInvoicePages] = useState(1);
    const [matchedInvoicePages, setMatchedInvoicePages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [activeTab, setActiveTab] = useState("statements");
    const [exporting, setExporting] = useState({ tab: null, format: null });

    const baseParams = () => ({ name: supplierName, paymentFilter });

    // Statements (2.0: status = pending | reconciled | not reconciled)
    useEffect(() => {
        if (activeTab !== "statements") return;
        let cancelled = false;
        setLoading(true);
        setError("");
        fetch(
            `${API_BASE}/statements?id=${supplierId}&page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}`
        )
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data.success) {
                    setLogs(data.logs || []);
                    setPages(data.pages || 1);
                } else setError("Failed to load statements");
            })
            .catch((err) => {
                if (!cancelled) setError("Failed to load statements");
                console.error(err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [supplierId, page, sortBy, sortOrder, activeTab]);

    // All invoices
    useEffect(() => {
        if (activeTab !== "invoices") return;
        let cancelled = false;
        setLoading(true);
        setError("");
        fetch(
            `${API_BASE}/invoices?supplierId=${supplierId}&page=${invoicePage}&sortBy=${invoiceSortBy}&sortOrder=${invoiceSortOrder}&paymentFilter=${paymentFilter}`
        )
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data.success) {
                    setInvoices(data.invoices || []);
                    setInvoicePages(data.pages || 1);
                } else setError("Failed to load invoices");
            })
            .catch((err) => {
                if (!cancelled) setError("Failed to load invoices");
                console.error(err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [supplierId, invoicePage, invoiceSortBy, invoiceSortOrder, activeTab, paymentFilter]);

    // Missed invoices
    useEffect(() => {
        if (activeTab !== "missed") return;
        let cancelled = false;
        setLoading(true);
        setError("");
        fetch(
            `${API_BASE}/missed-invoices?supplierId=${supplierId}&page=${missedInvoicePage}&sortBy=${missedInvoiceSortBy}&sortOrder=${missedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
        )
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data.success) {
                    setMissedInvoices(data.invoices || []);
                    setMissedInvoicePages(data.pages || 1);
                } else setError("Failed to load missed invoices");
            })
            .catch((err) => {
                if (!cancelled) setError("Failed to load missed invoices");
                console.error(err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [supplierId, missedInvoicePage, missedInvoiceSortBy, missedInvoiceSortOrder, activeTab, paymentFilter]);

    // Unmatched invoices
    useEffect(() => {
        if (activeTab !== "unmatched") return;
        let cancelled = false;
        setLoading(true);
        setError("");
        fetch(
            `${API_BASE}/unmatched-invoices?supplierId=${supplierId}&page=${unmatchedInvoicePage}&sortBy=${unmatchedInvoiceSortBy}&sortOrder=${unmatchedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
        )
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data.success) {
                    setUnmatchedInvoices(data.invoices || []);
                    setUnmatchedInvoicePages(data.pages || 1);
                } else setError("Failed to load unmatched invoices");
            })
            .catch((err) => {
                if (!cancelled) setError("Failed to load unmatched invoices");
                console.error(err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [supplierId, unmatchedInvoicePage, unmatchedInvoiceSortBy, unmatchedInvoiceSortOrder, activeTab, paymentFilter]);

    // Matched invoices
    useEffect(() => {
        if (activeTab !== "matched") return;
        let cancelled = false;
        setLoading(true);
        setError("");
        fetch(
            `${API_BASE}/matched-invoices?supplierId=${supplierId}&page=${matchedInvoicePage}&sortBy=${matchedInvoiceSortBy}&sortOrder=${matchedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
        )
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (data.success) {
                    setMatchedInvoices(data.invoices || []);
                    setMatchedInvoicePages(data.pages || 1);
                } else setError("Failed to load matched invoices");
            })
            .catch((err) => {
                if (!cancelled) setError("Failed to load matched invoices");
                console.error(err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [supplierId, matchedInvoicePage, matchedInvoiceSortBy, matchedInvoiceSortOrder, activeTab, paymentFilter]);

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

    function formatCurrency(amount, currency = "$") {
        if (amount == null) return "—";
        const sym = getCurrencySymbol(currency);
        return `${sym}${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function getReconciliationStatus(inv) {
        const vendorAmt = inv.vendorAmount;
        const xeroAmt = inv.xeroAmount;
        if (inv.xeroDate == null) return "n/a";
        if (vendorAmt != null && xeroAmt != null) {
            const diff = Math.abs(vendorAmt - xeroAmt);
            return diff <= 0.01 ? "fully reconciled" : "partially reconciled";
        }
        return "partially reconciled";
    }

    // 2.0 statement status: pending | reconciled | not reconciled
    function getStatementStatusBadge(log) {
        const status = (log.status || "").toLowerCase();
        if (status === "reconciled") return <span className={pageStyle.statusSuccess}>Reconciled</span>;
        if (status === "partially reconciled") return <span className={pageStyle.statusProcessing}>Partially reconciled</span>;
        if (status === "not reconciled") return <span className={pageStyle.statusWarning}>Not reconciled</span>;
        return <span className={pageStyle.statusProcessing}>Pending</span>;
    }

    function updateSort(tab, column, order) {
        const params = { ...Object.fromEntries(searchParams.entries()), name: supplierName, paymentFilter };
        if (tab === "statements") {
            params.page = "1";
            params.sortBy = column;
            params.sortOrder = order;
        } else if (tab === "invoices") {
            params.invoicePage = "1";
            params.invoiceSortBy = column;
            params.invoiceSortOrder = order;
        } else if (tab === "missed") {
            params.missedInvoicePage = "1";
            params.missedInvoiceSortBy = column;
            params.missedInvoiceSortOrder = order;
        } else if (tab === "unmatched") {
            params.unmatchedInvoicePage = "1";
            params.unmatchedInvoiceSortBy = column;
            params.unmatchedInvoiceSortOrder = order;
        } else if (tab === "matched") {
            params.matchedInvoicePage = "1";
            params.matchedInvoiceSortBy = column;
            params.matchedInvoiceSortOrder = order;
        }
        setSearchParams(params);
    }

    function setTab(tab) {
        setActiveTab(tab);
        const params = { ...baseParams() };
        if (tab === "statements") params.page = "1";
        if (tab === "invoices") params.invoicePage = "1";
        if (tab === "missed") params.missedInvoicePage = "1";
        if (tab === "unmatched") params.unmatchedInvoicePage = "1";
        if (tab === "matched") params.matchedInvoicePage = "1";
        setSearchParams(params);
    }

    function handlePaymentFilterChange(value) {
        setSearchParams({ ...Object.fromEntries(searchParams.entries()), paymentFilter: value });
    }

    function handleRowClick(logId) {
        navigate(`/v1/single-statement/${logId}`, { state: { from: "supplier-logs" } });
    }

    function handleInvoiceRowClick(inv) {
        if (inv.statementId?._id) navigate(`/v1/single-statement/${inv.statementId._id}`, { state: { from: "supplier-logs" } });
    }

    function handleDraftEmail() {
        alert("Email draft is unavailable. Please use your email client to draft messages manually.");
    }

    // Pagination
    function prevPage() {
        const p = { ...Object.fromEntries(searchParams.entries()), name: supplierName, paymentFilter };
        if (activeTab === "statements" && page > 1) p.page = String(page - 1);
        if (activeTab === "invoices" && invoicePage > 1) p.invoicePage = String(invoicePage - 1);
        if (activeTab === "missed" && missedInvoicePage > 1) p.missedInvoicePage = String(missedInvoicePage - 1);
        if (activeTab === "unmatched" && unmatchedInvoicePage > 1) p.unmatchedInvoicePage = String(unmatchedInvoicePage - 1);
        if (activeTab === "matched" && matchedInvoicePage > 1) p.matchedInvoicePage = String(matchedInvoicePage - 1);
        setSearchParams(p);
    }

    function nextPage() {
        const p = { ...Object.fromEntries(searchParams.entries()), name: supplierName, paymentFilter };
        if (activeTab === "statements" && page < pages) p.page = String(page + 1);
        if (activeTab === "invoices" && invoicePage < invoicePages) p.invoicePage = String(invoicePage + 1);
        if (activeTab === "missed" && missedInvoicePage < missedInvoicePages) p.missedInvoicePage = String(missedInvoicePage + 1);
        if (activeTab === "unmatched" && unmatchedInvoicePage < unmatchedInvoicePages) p.unmatchedInvoicePage = String(unmatchedInvoicePage + 1);
        if (activeTab === "matched" && matchedInvoicePage < matchedInvoicePages) p.matchedInvoicePage = String(matchedInvoicePage + 1);
        setSearchParams(p);
    }

    const currentPages = activeTab === "statements" ? pages : activeTab === "invoices" ? invoicePages : activeTab === "missed" ? missedInvoicePages : activeTab === "unmatched" ? unmatchedInvoicePages : matchedInvoicePages;
    const currentPage = activeTab === "statements" ? page : activeTab === "invoices" ? invoicePage : activeTab === "missed" ? missedInvoicePage : activeTab === "unmatched" ? unmatchedInvoicePage : matchedInvoicePage;
    const canPrev = currentPage > 1;
    const canNext = currentPage < currentPages;

    // Export helpers (fetch all pages then export)
    async function fetchAllStatements() {
        const first = await fetch(`${API_BASE}/statements?id=${supplierId}&page=1&sortBy=${sortBy}&sortOrder=${sortOrder}`).then((r) => r.json());
        if (!first.success) throw new Error("Failed to fetch");
        let all = first.logs || [];
        const totalPages = first.pages || 1;
        for (let p = 2; p <= totalPages; p++) {
            const res = await fetch(`${API_BASE}/statements?id=${supplierId}&page=${p}&sortBy=${sortBy}&sortOrder=${sortOrder}`).then((r) => r.json());
            if (res.success && res.logs) all = all.concat(res.logs);
        }
        return all;
    }

    async function fetchAllInvoices(endpoint) {
        const sort = endpoint === "invoices" ? invoiceSortBy : endpoint === "missed-invoices" ? missedInvoiceSortBy : endpoint === "unmatched-invoices" ? unmatchedInvoiceSortBy : matchedInvoiceSortBy;
        const order = endpoint === "invoices" ? invoiceSortOrder : endpoint === "missed-invoices" ? missedInvoiceSortOrder : endpoint === "unmatched-invoices" ? unmatchedInvoiceSortOrder : matchedInvoiceSortOrder;
        const first = await fetch(`${API_BASE}/${endpoint}?supplierId=${supplierId}&page=1&sortBy=${sort}&sortOrder=${order}&paymentFilter=${paymentFilter}`).then((r) => r.json());
        if (!first.success) throw new Error("Failed to fetch");
        let all = first.invoices || [];
        const totalPages = first.pages || 1;
        for (let p = 2; p <= totalPages; p++) {
            const res = await fetch(`${API_BASE}/${endpoint}?supplierId=${supplierId}&page=${p}&sortBy=${sort}&sortOrder=${order}&paymentFilter=${paymentFilter}`).then((r) => r.json());
            if (res.success && res.invoices) all = all.concat(res.invoices);
        }
        return all;
    }

    async function handleExportStatements(format) {
        try {
            setExporting({ tab: "statements", format });
            const all = await fetchAllStatements();
            if (all.length === 0) { alert("No statements to export"); return; }
            const headers = [
                { label: "Supplier Name", key: "supplierName" },
                { label: "Statement Issue Date", key: "statementIssueDate" },
                { label: "Process Date/Time", key: "processDateTime" },
                { label: "Status", key: "status" },
                { label: "Reconciled", key: "reconciled" },
                { label: "Unreconciled", key: "unreconciled" },
                { label: "Total", key: "total" },
            ];
            const statusLabel = (s) => (s === "reconciled" ? "Fully Reconciled" : s === "not reconciled" ? "Not Reconciled" : "Pending");
            const exportData = all.map((log) => ({
                supplierName,
                statementIssueDate: formatDate(log.invoiceIssueDate),
                processDateTime: formatDateTime(log.addedAt),
                status: statusLabel(log.status || ""),
                reconciled: log.reconciled ?? 0,
                unreconciled: log.unreconciled ?? 0,
                total: log.total ?? 0,
            }));
            const filename = `Statements_${supplierName}_${new Date().toISOString().split("T")[0]}`;
            if (format === "csv") exportToCSV(exportData, headers, filename);
            else exportToExcel(exportData, headers, filename);
        } catch (e) {
            alert("Export failed.");
            console.error(e);
        } finally {
            setExporting({ tab: null, format: null });
        }
    }

    async function handleExportInvoices(format, endpoint, filenamePrefix) {
        try {
            setExporting({ tab: activeTab, format });
            const all = await fetchAllInvoices(endpoint);
            if (all.length === 0) { alert(`No data to export`); return; }
            const headers = [
                { label: "Supplier Name", key: "supplierName" },
                { label: "Invoice Number", key: "invoiceNumber" },
                { label: "Supplier Date", key: "VendorDate" },
                { label: "Xero Date", key: "xeroDate" },
                { label: "Supplier Amount", key: "vendorAmount" },
                { label: "Xero Amount", key: "xeroAmount" },
                { label: "Payment Status", key: "paymentStatus" },
            ];
            const exportData = all.map((inv) => {
                const status = getReconciliationStatus(inv);
                return {
                    supplierName,
                    invoiceNumber: inv.invoiceNumber || "—",
                    VendorDate: formatDate(inv.VendorDate),
                    xeroDate: formatDate(inv.xeroDate),
                    vendorAmount: Number(inv.vendorAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    xeroAmount: Number(inv.xeroAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    paymentStatus: inv.paymentStatus === "paid" ? "Paid" : inv.paymentStatus === "unpaid" ? "Unpaid" : "Unknown",
                };
            });
            const filename = `${filenamePrefix}_${supplierName}_${new Date().toISOString().split("T")[0]}`;
            if (format === "csv") exportToCSV(exportData, headers, filename);
            else exportToExcel(exportData, headers, filename);
        } catch (e) {
            alert("Export failed.");
            console.error(e);
        } finally {
            setExporting({ tab: null, format: null });
        }
    }

    const tabLabel = activeTab === "statements" ? "Reconciliation statements" : activeTab === "invoices" ? "All invoices" : activeTab === "missed" ? "Missed Invoices (Xero)" : activeTab === "unmatched" ? "Unmatched Invoices (Statements)" : "Matched Invoices";

    return (
        <>
            <Top />
            <main className={pageStyle.main}>
                <Link to="/v1" className={pageStyle.back}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6"></path>
                    </svg>
                    Back to Suppliers
                </Link>

                <div className={pageStyle.top}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
                        <div>
                            <h1>{supplierName}</h1>
                            <p>{tabLabel}</p>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                            {(activeTab === "invoices" || activeTab === "missed" || activeTab === "unmatched" || activeTab === "matched") && (
                                <>
                                    <label htmlFor="paymentFilter" style={{ fontSize: "1.4rem", fontWeight: "500", color: "#374151" }}>Payment:</label>
                                    <select
                                        id="paymentFilter"
                                        value={paymentFilter}
                                        onChange={(e) => handlePaymentFilterChange(e.target.value)}
                                        style={{ padding: "0.8rem 1.2rem", fontSize: "1.4rem", border: "0.1rem solid #e5e7eb", borderRadius: "0.6rem", background: "#fff", cursor: "pointer" }}
                                    >
                                        <option value="all">All</option>
                                        <option value="paid">Paid</option>
                                        <option value="unpaid">Unpaid</option>
                                    </select>
                                </>
                            )}
                            <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                                <span style={{ fontSize: "1.4rem", fontWeight: "500", color: "#374151" }}>Export:</span>
                                <button
                                    disabled={exporting.tab !== null}
                                    className={pageStyle.browseButton}
                                    style={{ padding: "0.6rem 1.2rem", fontSize: "1.3rem" }}
                                    onClick={() => {
                                        if (activeTab === "statements") handleExportStatements("excel");
                                        else if (activeTab === "invoices") handleExportInvoices("excel", "invoices", "All_Invoices");
                                        else if (activeTab === "missed") handleExportInvoices("excel", "missed-invoices", "Missed_Invoices");
                                        else if (activeTab === "unmatched") handleExportInvoices("excel", "unmatched-invoices", "Unmatched_Invoices");
                                        else if (activeTab === "matched") handleExportInvoices("excel", "matched-invoices", "Matched_Invoices");
                                    }}
                                >
                                    {exporting.tab === activeTab && exporting.format === "excel" ? <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}><div className={pageStyle.spinner} style={{ width: "1.4rem", height: "1.4rem", borderWidth: "0.2rem" }}></div> Exporting...</span> : "Excel"}
                                </button>
                                <button
                                    disabled={exporting.tab !== null}
                                    className={pageStyle.browseButton}
                                    style={{ padding: "0.6rem 1.2rem", fontSize: "1.3rem" }}
                                    onClick={() => {
                                        if (activeTab === "statements") handleExportStatements("csv");
                                        else if (activeTab === "invoices") handleExportInvoices("csv", "invoices", "All_Invoices");
                                        else if (activeTab === "missed") handleExportInvoices("csv", "missed-invoices", "Missed_Invoices");
                                        else if (activeTab === "unmatched") handleExportInvoices("csv", "unmatched-invoices", "Unmatched_Invoices");
                                        else if (activeTab === "matched") handleExportInvoices("csv", "matched-invoices", "Matched_Invoices");
                                    }}
                                >
                                    {exporting.tab === activeTab && exporting.format === "csv" ? <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}><div className={pageStyle.spinner} style={{ width: "1.4rem", height: "1.4rem", borderWidth: "0.2rem" }}></div> Exporting...</span> : "CSV"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={pageStyle.topTabs}>
                    {["statements", "invoices", "missed", "unmatched", "matched"].map((tab) => (
                        <button
                            key={tab}
                            className={`${pageStyle.topTabButton} ${activeTab === tab ? pageStyle.topTabActive : ""}`}
                            onClick={() => setTab(tab)}
                        >
                            {tab === "statements" ? "Statements" : tab === "invoices" ? "All Invoices" : tab === "missed" ? "Missed Invoices (Xero)" : tab === "unmatched" ? "Unmatched Invoices (Statements)" : "Matched Invoices"}
                        </button>
                    ))}
                </div>

                {error && <div className={pageStyle.errorMessage}>{error}</div>}

                {loading ? (
                    <div className={pageStyle.loading}>
                        <p>Loading {activeTab === "statements" ? "statements" : "invoices"}...</p>
                    </div>
                ) : (
                    <>
                        {activeTab === "statements" && (
                            <div className={pageStyle.tableContainer}>
                                <table className={pageStyle.suppliersTable}>
                                    <thead>
                                        <tr>
                                            <th onClick={() => updateSort("statements", "statementIssueDate", sortBy === "statementIssueDate" ? (sortOrder === "asc" ? "desc" : "asc") : "desc")} style={{ cursor: "pointer" }}>
                                                STATEMENT ISSUE DATE {sortBy === "statementIssueDate" && (sortOrder === "asc" ? "↑" : "↓")}
                                            </th>
                                            <th onClick={() => updateSort("statements", "processDateTime", sortBy === "processDateTime" ? (sortOrder === "asc" ? "desc" : "asc") : "desc")} style={{ cursor: "pointer" }}>
                                                PROCESS DATE/TIME {sortBy === "processDateTime" && (sortOrder === "asc" ? "↑" : "↓")}
                                            </th>
                                            <th>STATUS</th>
                                            <th className={pageStyle.reconciled}>RECONCILED</th>
                                            <th className={pageStyle.unreconciled}>UNRECONCILED</th>
                                            <th>TOTAL</th>
                                            <th>FILE</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {logs.length === 0 ? (
                                            <tr><td colSpan="8" className={pageStyle.noData}>No statements for this supplier</td></tr>
                                        ) : logs.map((log) => (
                                            <tr key={log._id} className={pageStyle.supplierRow} onClick={() => handleRowClick(log._id)}>
                                                <td><strong>{formatDate(log.invoiceIssueDate)}</strong></td>
                                                <td>{formatDateTime(log.addedAt)}</td>
                                                <td>{getStatementStatusBadge(log)}</td>
                                                <td className={pageStyle.reconciled}>{log.reconciled ?? 0}</td>
                                                <td className={pageStyle.unreconciled}>{log.unreconciled ?? 0}</td>
                                                <td>{log.total ?? 0}</td>
                                                <td onClick={(e) => e.stopPropagation()}>
                                                    <a href={`/file/${log._id}`} target="_blank" rel="noopener noreferrer" className={pageStyle.downloadLink}>Download</a>
                                                </td>
                                                <td>
                                                    <svg className={pageStyle.arrowIcon} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"></path></svg>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === "invoices" && (
                            <div className={pageStyle.tableContainer}>
                                <table className={pageStyle.suppliersTable}>
                                    <thead>
                                        <tr>
                                            <th onClick={() => updateSort("invoices", invoiceSortBy === "invoiceNumber" ? (invoiceSortOrder === "asc" ? "desc" : "asc") : "invoiceNumber", invoiceSortOrder)} style={{ cursor: "pointer" }}>INVOICE NUMBER</th>
                                            <th onClick={() => updateSort("invoices", invoiceSortBy === "supplierDate" ? (invoiceSortOrder === "asc" ? "desc" : "asc") : "supplierDate", invoiceSortOrder)} style={{ cursor: "pointer" }}>SUPPLIER DATE</th>
                                            <th>XERO DATE</th>
                                            <th>SUPPLIER AMOUNT</th>
                                            <th>XERO AMOUNT</th>
                                            <th>FOUND IN XERO</th>
                                            <th>STATUS</th>
                                            <th>PAID STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {invoices.length === 0 ? (
                                            <tr><td colSpan="8" className={pageStyle.noData}>No invoices</td></tr>
                                        ) : invoices.map((inv) => {
                                            const currency = inv.vendorCurrency || inv.xeroCurrency || "$";
                                            // Merged rows have both sides; unpaired have one side (nulls for the other)
                                            const status = inv.reconciliationStatus != null ? inv.reconciliationStatus : getReconciliationStatus(inv);
                                            return (
                                                <tr key={inv._id} className={pageStyle.supplierRow} onClick={() => handleInvoiceRowClick(inv)} style={{ cursor: inv.statementId?._id ? "pointer" : "default" }}>
                                                    <td><strong>{inv.invoiceNumber || "—"}</strong></td>
                                                    <td>{inv.VendorDate != null ? formatDate(inv.VendorDate) : "—"}</td>
                                                    <td>{inv.xeroDate != null ? formatDate(inv.xeroDate) : "—"}</td>
                                                    <td>{inv.vendorAmount != null ? formatCurrency(inv.vendorAmount, currency) : "—"}</td>
                                                    <td>{inv.xeroAmount != null ? formatCurrency(inv.xeroAmount, currency) : "—"}</td>
                                                    <td>{inv.xeroDate != null ? "Yes" : "No"}</td>
                                                    <td>{status === "fully reconciled" && <span className={pageStyle.statusSuccess}>Fully Reconciled</span>}{(status === "not reconciled" || status === "partially reconciled" || status === "n/a") && <span className={pageStyle.statusWarning}>Not Reconciled</span>}</td>
                                                    <td>{inv.paymentStatus === "paid" ? <span style={{ color: "#059669", fontWeight: "600" }}>Paid</span> : inv.paymentStatus === "unpaid" ? <span style={{ color: "#dc2626", fontWeight: "600" }}>Unpaid</span> : <span style={{ color: "#6b7280" }}>—</span>}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === "missed" && (
                            <div className={pageStyle.tableContainer}>
                                <table className={pageStyle.suppliersTable}>
                                    <thead>
                                        <tr>
                                            <th>INVOICE NUMBER</th>
                                            <th>XERO DATE</th>
                                            <th>AMOUNT</th>
                                            <th>STATUS</th>
                                            <th>PAID STATUS</th>
                                            <th>ACTIONS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {missedInvoices.length === 0 ? (
                                            <tr><td colSpan="6" className={pageStyle.noData}>No missed invoices</td></tr>
                                        ) : missedInvoices.map((inv) => {
                                            const currency = inv.xeroCurrency || inv.vendorCurrency || "$";
                                            return (
                                                <tr key={inv._id} className={pageStyle.supplierRow} onClick={() => handleInvoiceRowClick(inv)} style={{ cursor: inv.statementId?._id ? "pointer" : "default" }}>
                                                    <td><strong>{inv.invoiceNumber || "—"}</strong></td>
                                                    <td>{formatDate(inv.xeroDate)}</td>
                                                    <td>{formatCurrency(inv.xeroAmount, currency)}</td>
                                                    <td><span className={pageStyle.statusWarning}>Not Reconciled</span></td>
                                                    <td>{inv.paymentStatus === "paid" ? <span style={{ color: "#059669", fontWeight: "600" }}>Paid</span> : inv.paymentStatus === "unpaid" ? <span style={{ color: "#dc2626", fontWeight: "600" }}>Unpaid</span> : "—"}</td>
                                                    <td onClick={(e) => e.stopPropagation()}>
                                                        <button type="button" className={pageStyle.browseButton} style={{ padding: "0.6rem 1.2rem", fontSize: "1.2rem" }} onClick={handleDraftEmail}>Draft Email</button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === "unmatched" && (
                            <div className={pageStyle.tableContainer}>
                                <table className={pageStyle.suppliersTable}>
                                    <thead>
                                        <tr>
                                            <th>INVOICE NUMBER</th>
                                            <th>DATE</th>
                                            <th>AMOUNT</th>
                                            <th>STATUS</th>
                                            <th>PAID STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {unmatchedInvoices.length === 0 ? (
                                            <tr><td colSpan="5" className={pageStyle.noData}>No unmatched invoices</td></tr>
                                        ) : unmatchedInvoices.map((inv) => {
                                            const currency = inv.vendorCurrency || inv.xeroCurrency || "$";
                                            return (
                                                <tr key={inv._id} className={pageStyle.supplierRow} onClick={() => handleInvoiceRowClick(inv)} style={{ cursor: inv.statementId?._id ? "pointer" : "default" }}>
                                                    <td><strong>{inv.invoiceNumber || "—"}</strong></td>
                                                    <td>{formatDate(inv.VendorDate)}</td>
                                                    <td>{formatCurrency(inv.vendorAmount, currency)}</td>
                                                    <td><span className={pageStyle.statusWarning}>Not Reconciled</span></td>
                                                    <td>{inv.paymentStatus === "paid" ? <span style={{ color: "#059669", fontWeight: "600" }}>Paid</span> : inv.paymentStatus === "unpaid" ? <span style={{ color: "#dc2626", fontWeight: "600" }}>Unpaid</span> : "—"}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {activeTab === "matched" && (
                            <div className={pageStyle.tableContainer}>
                                <table className={pageStyle.suppliersTable}>
                                    <thead>
                                        <tr>
                                            <th>INVOICE NUMBER</th>
                                            <th>SUPPLIER DATE</th>
                                            <th>XERO DATE</th>
                                            <th>SUPPLIER AMOUNT</th>
                                            <th>XERO AMOUNT</th>
                                            <th>DIFFERENCE</th>
                                            <th>STATUS</th>
                                            <th>PAID STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {matchedInvoices.length === 0 ? (
                                            <tr><td colSpan="8" className={pageStyle.noData}>No matched invoices</td></tr>
                                        ) : matchedInvoices.map((inv) => {
                                            const vendorAmt = inv.vendorAmount || 0;
                                            const xeroAmt = inv.xeroAmount || 0;
                                            const diff = vendorAmt - xeroAmt;
                                            const currency = inv.vendorCurrency || inv.xeroCurrency || "$";
                                            return (
                                                <tr key={inv._id} className={pageStyle.supplierRow} onClick={() => handleInvoiceRowClick(inv)} style={{ cursor: inv.statementId?._id ? "pointer" : "default" }}>
                                                    <td><strong>{inv.invoiceNumber || "—"}</strong></td>
                                                    <td>{formatDate(inv.VendorDate)}</td>
                                                    <td>{formatDate(inv.xeroDate)}</td>
                                                    <td>{formatCurrency(inv.vendorAmount, currency)}</td>
                                                    <td>{formatCurrency(inv.xeroAmount, currency)}</td>
                                                    <td className={diff !== 0 ? pageStyle.unreconciled : pageStyle.reconciled}>{formatCurrency(diff, currency)}</td>
                                                    <td><span className={pageStyle.statusSuccess}>Fully Reconciled</span></td>
                                                    <td>{inv.paymentStatus === "paid" ? <span style={{ color: "#059669", fontWeight: "600" }}>Paid</span> : inv.paymentStatus === "unpaid" ? <span style={{ color: "#dc2626", fontWeight: "600" }}>Unpaid</span> : "—"}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {!loading && (activeTab === "statements" ? logs.length : activeTab === "invoices" ? invoices.length : activeTab === "missed" ? missedInvoices.length : activeTab === "unmatched" ? unmatchedInvoices.length : matchedInvoices.length) > 0 && (
                            <div className={pageStyle.pagination}>
                                <button onClick={prevPage} disabled={!canPrev} className={pageStyle.pageButton}>Previous</button>
                                <span className={pageStyle.pageCount}>{currentPage} / {currentPages || 1}</span>
                                <button onClick={nextPage} disabled={!canNext} className={pageStyle.pageButton}>Next</button>
                            </div>
                        )}
                    </>
                )}
            </main>
        </>
    );
}
