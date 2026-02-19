import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import styles from "../scss/SimpleApp.module.scss";

function formatAmount(amount) {
  if (amount == null || typeof amount !== "number" || Number.isNaN(amount)) return "—";
  const formatted = new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
  return `£${formatted}`;
}

function formatTableAmount(amount) {
  if (amount == null || typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

const DASHBOARD_DATA_URL = "/api/v2/dashboard/dashboard-data";
const DASHBOARD_TAB2_URL = "/api/v2/dashboard/dashboard-tab-2";
const TAB2_PAGE_SIZE = 50;

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
const ALLOWED_EXT = [".pdf", ".xlsx", ".xls"];

function getTableDataForTab(tab, dashboardData, tab2Data) {
  if (tab === "latest") {
    const summary = dashboardData?.supplierSummary;
    if (Array.isArray(summary) && summary.length > 0) {
      return summary.map((row) => ({
        supplier: row.supplier,
        contactId: row.contactId,
        theySay: row.theySay,
        xeroSays: row.xeroSays,
        unpaid: row.unpaid ?? 0,
        issues: row.issues ?? 0,
        status: row.status ?? "Action Needed",
        invoicesNeedAttention: Array.isArray(row.invoicesNeedAttention) ? row.invoicesNeedAttention : [],
        invoicesViewAll: Array.isArray(row.invoicesViewAll) ? row.invoicesViewAll : [],
      }));
    }
    return [];
  }
  if (tab === "attention") {
    const bySupplier = tab2Data?.bySupplier;
    if (Array.isArray(bySupplier) && bySupplier.length > 0) {
      return bySupplier.map((s) => {
        const fileInvs = (s.invoices || []).filter((i) => i.fromXero === false);
        const xeroInvs = (s.invoices || []).filter((i) => i.fromXero === true);
        const theySay = fileInvs.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
        const xeroSays = xeroInvs.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
        const amountMismatch = (s.pairs || []).filter((p) => p.label === "amount mismatch").length;
        const pairedFileIds = new Set((s.pairs || []).flatMap((p) => [p.fileInvoice?._id, p.xeroInvoice?._id]).filter(Boolean));
        const unpairedCount = fileInvs.filter((f) => !pairedFileIds.has(f._id)).length;
        const issues = amountMismatch + unpairedCount;
        return {
          supplier: s.supplier,
          contactId: s.contactId,
          theySay,
          xeroSays,
          unpaid: (s.invoices || []).length,
          issues,
          status: "Action Needed",
          pairs: s.pairs || [],
          unpairedInvoices: s.unpairedInvoices || [],
        };
      });
    }
    return [];
  }
  if (tab === "reconciled") {
    return [];
  }
  return [];
}

function sortTableRows(rows, sortColumn, sortDir) {
  const withDiff = rows.map((row) => ({
    ...row,
    difference: row.xeroSays - row.theySay,
  }));
  if (!sortColumn) return withDiff;
  const mult = sortDir === "asc" ? 1 : -1;
  return [...withDiff].sort((a, b) => {
    let va = a[sortColumn];
    let vb = b[sortColumn];
    if (sortColumn === "difference") {
      va = a.difference;
      vb = b.difference;
    } else if (sortColumn === "supplier" || sortColumn === "status") {
      va = String(va ?? "").toLowerCase();
      vb = String(vb ?? "").toLowerCase();
      return mult * (va < vb ? -1 : va > vb ? 1 : 0);
    }
    if (typeof va !== "number") va = Number(va) || 0;
    if (typeof vb !== "number") vb = Number(vb) || 0;
    return mult * (va - vb);
  });
}

/** Fetch dashboard data (last process log, statementCount for current user). */
function useDashboardData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(DASHBOARD_DATA_URL, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setData(json);
      else setData(null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, refetch };
}

/** Fetch dashboard tab 2 (unpaid by supplier). */
function useDashboardTab2() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(DASHBOARD_TAB2_URL, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setData(json);
      else setData(null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data: data ?? null, loading, refetch };
}

function formatLogDateTime(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

export default function SimpleApp() {
  const { data: dashboardData, loading: lastUploadLoading, refetch: refetchDashboardData } =
    useDashboardData();
  const { data: tab2Data } = useDashboardTab2();
  const fileInputRef = useRef(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [activeTab, setActiveTab] = useState("reconciled");
  const [sortByTab, setSortByTab] = useState({
    latest: { column: null, dir: "asc" },
    attention: { column: null, dir: "asc" },
    reconciled: { column: null, dir: "asc" },
  });

  const handleSort = (column) => {
    setSortByTab((prev) => {
      const current = prev[activeTab];
      const newDir =
        current.column === column
          ? current.dir === "asc"
            ? "desc"
            : "asc"
          : "asc";
      return {
        ...prev,
        [activeTab]: { column, dir: newDir },
      };
    });
  };

  const tabSort = sortByTab[activeTab];
  const tableDataForTab = getTableDataForTab(activeTab, dashboardData, tab2Data);
  const sortedTableData = sortTableRows(
    tableDataForTab,
    tabSort.column,
    tabSort.dir
  );

  const [tab2Page, setTab2Page] = useState(1);
  const tab2Total = activeTab === "attention" ? sortedTableData.length : 0;
  const tab2TotalPages = Math.max(1, Math.ceil(tab2Total / TAB2_PAGE_SIZE));
  const paginatedTableData =
    activeTab === "attention" && tab2Total > TAB2_PAGE_SIZE
      ? sortedTableData.slice(
          (tab2Page - 1) * TAB2_PAGE_SIZE,
          tab2Page * TAB2_PAGE_SIZE
        )
      : sortedTableData;
  useEffect(() => {
    if (activeTab === "attention") setTab2Page(1);
  }, [activeTab]);

  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const toggleRowExpanded = (supplier) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(supplier)) next.delete(supplier);
      else next.add(supplier);
      return next;
    });
  };
  const closeExpanded = (supplier) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.delete(supplier);
      return next;
    });
  };

  const [viewAllShownForRow, setViewAllShownForRow] = useState(() => new Set());
  const toggleViewAll = (rowKey) => {
    setViewAllShownForRow((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };


  useEffect(() => {
    const openPicker = () => fileInputRef.current?.click();
    window.addEventListener("simple-app-open-upload", openPicker);
    return () => window.removeEventListener("simple-app-open-upload", openPicker);
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("simple-app-upload-loading", { detail: { loading: uploadLoading } })
    );
  }, [uploadLoading]);

  const lastUploadDateTime =
    dashboardData?.log?.createdAt != null
      ? formatLogDateTime(dashboardData.log.createdAt)
      : null;
  const statementCount = dashboardData?.statementCount ?? 0;

  const suppliersSayWeOwe = dashboardData?.invoicesAmountTotal != null
    ? Number(dashboardData.invoicesAmountTotal)
    : null;
  const xeroSaysWeOwe = dashboardData?.xeroInvoicesAmountTotal != null
    ? Number(dashboardData.xeroInvoicesAmountTotal)
    : null;
  const difference = suppliersSayWeOwe != null && xeroSaysWeOwe != null
    ? xeroSaysWeOwe - suppliersSayWeOwe
    : null;

  const suppliersReconciled = Array.isArray(dashboardData?.contactIdsInPaired)
    ? dashboardData.contactIdsInPaired.length
    : 0;
  const suppliersWithIssues = Array.isArray(dashboardData?.contactIdsInNonPaired)
    ? dashboardData.contactIdsInNonPaired.length
    : 0;

  const attentionTableData = getTableDataForTab("attention", dashboardData, tab2Data);
  const needsAttentionCount = attentionTableData.reduce(
    (sum, row) => sum + (row.issues ?? 0),
    0
  );

  const xeroInvoiceNumbers = new Set(
    (dashboardData?.xeroInvoices || []).map((inv) => inv.invoiceNumber).filter(Boolean)
  );
  const hasMatchNotFound = (dashboardData?.invoices || []).some(
    (inv) => inv.invoiceNumber && !xeroInvoiceNumbers.has(inv.invoiceNumber)
  );
  const hasAmountMismatch =
    Array.isArray(dashboardData?.pairedInvoices) && dashboardData.pairedInvoices.length > 0;
  const issuesSubtitle =
    hasAmountMismatch && hasMatchNotFound
      ? "Amount mismatch / Match not found"
      : hasAmountMismatch
        ? "Amount mismatch"
        : hasMatchNotFound
          ? "Match not found"
          : null;

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
        `Use PDF or Excel only (.pdf, .xlsx, .xls). Invalid: ${invalid.map((f) => f.name).join(", ")}`
      );
      return;
    }
    setUploadLoading(true);
    setUploadError("");
    setUploadSuccess("");
    try {
      if (fileArray.length > 1) {
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
        const count = (data.results || []).length;
        const totalCreated = (data.results || []).reduce((s, r) => s + (r.createdCount ?? 0), 0);
        setUploadSuccess(
          `${count} file(s) processed.${totalCreated > 0 ? ` ${totalCreated} invoice(s) saved.` : ""}`
        );
        refetchDashboardData();
      } else {
        const formData = new FormData();
        formData.append("file", fileArray[0]);
        const response = await fetch("/api/v2/invoice/invoice-file-upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        const data = await response.json();
        if (!response.ok) {
          setUploadError(data.message || "Upload failed");
          return;
        }
        const createdCount = data.createdCount ?? (data.created?.length ?? 0);
        setUploadSuccess(
          `"${fileArray[0].name}" processed.${createdCount > 0 ? ` ${createdCount} invoice(s) saved.` : ""}`
        );
        refetchDashboardData();
      }
    } catch (err) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploadLoading(false);
    }
  }

  const totals = [
    {
      label: "Suppliers say we owe",
      value: formatAmount(suppliersSayWeOwe),
      valueClass: styles.totalsValueDefault,
    },
    {
      label: "Xero says we owe",
      value: formatAmount(xeroSaysWeOwe),
      valueClass: styles.totalsValueDefault,
    },
    {
      label: "Difference",
      value: formatAmount(difference),
      valueClass:
        difference != null
          ? difference === 0
            ? styles.totalsValueSuccess
            : styles.totalsValueDanger
          : styles.totalsValueDefault,
    },
  ];

  return (
    <div className={styles.root}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        multiple
        className={styles.uploadInput}
        onChange={handleFileSelect}
        disabled={uploadLoading}
        aria-hidden
        tabIndex={-1}
      />
      <div className={styles.container}>
        <section className={styles.batchSummary} aria-label="Latest upload summary">
          <div className={styles.batchHeader}>
            <div className={styles.latestLabel}>
              <span className={styles.latestDot} aria-hidden />
              Latest Upload —{" "}
              {lastUploadLoading
                ? "…"
                : `${statementCount} statement${statementCount !== 1 ? "s" : ""} processed`}
            </div>
            <time
              className={styles.dateTime}
              dateTime={
                dashboardData?.log?.createdAt
                  ? new Date(dashboardData.log.createdAt).toISOString()
                  : undefined
              }
            >
              {lastUploadLoading
                ? "…"
                : lastUploadDateTime ?? "No uploads yet"}
            </time>
          </div>
          {uploadLoading && (
            <p className={styles.uploadSuccess}>Processing…</p>
          )}
          {uploadError && !uploadLoading && (
            <p className={styles.uploadError} role="alert">
              {uploadError}
            </p>
          )}
          {uploadSuccess && !uploadLoading && (
            <p className={styles.uploadSuccess}>{uploadSuccess}</p>
          )}

          <div className={styles.cardsRow}>
            <div className={styles.card}>
              <div
                className={`${styles.cardNumber} ${styles.cardNumberGreen}`}
                aria-label={`${suppliersReconciled} suppliers reconciled`}
              >
                {suppliersReconciled}
              </div>
              <h2 className={styles.cardTitle}>
                supplier{suppliersReconciled !== 1 ? "s" : ""} reconciled
              </h2>
              <p className={styles.cardSub}>Ready for payment</p>
            </div>

            <div className={styles.card}>
              <div
                className={`${styles.cardNumber} ${
                  suppliersWithIssues > 0
                    ? styles.cardNumberRed
                    : styles.cardNumberGreen
                }`}
                aria-label={`${suppliersWithIssues} suppliers have issues`}
              >
                {suppliersWithIssues}
              </div>
              <h2 className={styles.cardTitle}>
                supplier{suppliersWithIssues !== 1 ? "s" : ""} have issues
              </h2>
              {issuesSubtitle && (
                <p className={styles.cardSubMuted}>{issuesSubtitle}</p>
              )}
            </div>
          </div>
        </section>

        <section className={styles.totalsBar} aria-label="Reconciliation totals">
          {totals.map(({ label, value, valueClass }) => (
            <div key={label} className={styles.totalsCell}>
              <span className={styles.totalsLabel}>{label}</span>
              <span className={`${styles.totalsValue} ${valueClass}`}>
                {value}
              </span>
            </div>
          ))}
        </section>

        <nav
          className={styles.tabs}
          role="tablist"
          aria-label="Batch views"
          onKeyDown={(e) => {
            const tabs = ["latest", "attention", "reconciled"];
            const i = tabs.indexOf(activeTab);
            if (e.key === "ArrowRight" && i < tabs.length - 1) {
              e.preventDefault();
              setActiveTab(tabs[i + 1]);
            } else if (e.key === "ArrowLeft" && i > 0) {
              e.preventDefault();
              setActiveTab(tabs[i - 1]);
            } else if (e.key === "Home") {
              e.preventDefault();
              setActiveTab("latest");
            } else if (e.key === "End") {
              e.preventDefault();
              setActiveTab("reconciled");
            }
          }}
        >
          <button
            type="button"
            role="tab"
            id="tab-latest"
            aria-selected={activeTab === "latest"}
            aria-controls="panel-latest"
            tabIndex={activeTab === "latest" ? 0 : -1}
            className={`${styles.tab} ${activeTab === "latest" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("latest")}
          >
            Latest Batch
            <span className={styles.tabBadge}>{statementCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-attention"
            aria-selected={activeTab === "attention"}
            aria-controls="panel-attention"
            tabIndex={activeTab === "attention" ? 0 : -1}
            className={`${styles.tab} ${activeTab === "attention" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("attention")}
          >
            Needs Attention
            <span className={styles.tabBadge}>{needsAttentionCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="tab-reconciled"
            aria-selected={activeTab === "reconciled"}
            aria-controls="panel-reconciled"
            tabIndex={activeTab === "reconciled" ? 0 : -1}
            className={`${styles.tab} ${activeTab === "reconciled" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("reconciled")}
          >
            Reconciled
            <span className={styles.tabBadge}>{suppliersReconciled}</span>
          </button>
        </nav>

        <div
          id={`panel-${activeTab}`}
          className={styles.tabPanel}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={0}
        >
          <section className={styles.tableSection} aria-label="Supplier table">
            <div className={styles.tableWrap}>
              <table className={styles.supplierTable}>
                <thead>
                  <tr>
                    {[
                      ["supplier", "SUPPLIER"],
                      ["theySay", "THEY SAY WE OWE"],
                      ["xeroSays", "XERO SAYS WE OWE"],
                      ["difference", "DIFFERENCE"],
                      ["unpaid", "UNPAID"],
                      ["issues", "ISSUES"],
                      ["status", "STATUS"],
                    ].map(([key, label]) => (
                      <th
                        key={key}
                        className={`${styles.tableTh} ${styles.tableThSortable}`}
                        onClick={() => handleSort(key)}
                        onKeyDown={(e) => e.key === "Enter" && handleSort(key)}
                        role="columnheader"
                        tabIndex={0}
                        aria-sort={
                          tabSort.column === key
                            ? tabSort.dir === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                      >
                        {label}
                        {tabSort.column === key && (
                          <span className={styles.sortIcon} aria-hidden>
                            {tabSort.dir === "asc" ? " ↑" : " ↓"}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedTableData.map((row, i) => {
                    const diff = row.difference ?? row.xeroSays - row.theySay;
                    const diffFormatted = diff >= 0 ? `£${formatTableAmount(diff)}` : `-£${formatTableAmount(-diff)}`;
                    const statusClass =
                      row.status === "Contacted"
                        ? styles.statusContacted
                        : row.status === "No action needed"
                          ? styles.statusNoActionNeeded
                          : row.status === "Action Needed"
                            ? styles.statusActionNeeded
                            : styles.statusAwaiting;
                    const rowKey = row.contactId ?? row.supplier;
                    const isExpanded = expandedRows.has(rowKey);
                    const detailInvoices =
                      activeTab === "latest" && Array.isArray(row.invoicesNeedAttention) && row.invoicesNeedAttention.length > 0
                        ? row.invoicesNeedAttention
                        : [];
                    const viewAllInvoices = activeTab === "latest" && Array.isArray(row.invoicesViewAll) ? row.invoicesViewAll : [];
                    const tab2Pairs = activeTab === "attention" ? (row.pairs || []) : [];
                    const tab2Unpaired = activeTab === "attention" ? (row.unpairedInvoices || []) : [];
                    const attentionDetailInvoices =
                      activeTab === "attention"
                        ? [
                            ...(tab2Pairs || []).map((p) => {
                              const fa = Number(p.fileInvoice?.amount) ?? 0;
                              const xa = Number(p.xeroInvoice?.amount) ?? 0;
                              const date = p.fileInvoice?.dueDate || p.xeroInvoice?.dueDate;
                              const dateStr = date ? new Date(date).toLocaleDateString("en-GB") : "–";
                              return {
                                invoiceNumber: p.fileInvoice?.invoiceNumber || p.xeroInvoice?.invoiceNumber || "—",
                                date: dateStr,
                                issue: p.label === "amount mismatch" ? "AMOUNT MISMATCH" : "Matched",
                                supplierAmt: fa,
                                xeroAmt: xa,
                                difference: xa - fa,
                              };
                            }),
                            ...(tab2Unpaired || []).map((u) => {
                              const amt = Number(u.amount) || 0;
                              const dateStr = u.dueDate ? new Date(u.dueDate).toLocaleDateString("en-GB") : "–";
                              return {
                                invoiceNumber: u.invoiceNumber || "—",
                                date: dateStr,
                                issue: u.fromXero ? "MISSING FROM FILE" : "MISSING FROM XERO",
                                supplierAmt: u.fromXero ? null : amt,
                                xeroAmt: u.fromXero ? amt : null,
                                difference: amt,
                              };
                            }),
                          ]
                        : [];
                    const detailRows =
                      activeTab === "attention"
                        ? attentionDetailInvoices
                        : viewAllShownForRow.has(rowKey)
                          ? viewAllInvoices
                          : detailInvoices;
                    const totalUnpaidCount =
                      activeTab === "attention"
                        ? (tab2Pairs.length * 2) + tab2Unpaired.length
                        : viewAllInvoices.length;
                    const latestNoIssues =
                      activeTab === "latest" && detailInvoices.length === 0 && !viewAllShownForRow.has(rowKey);
                    return (
                      <Fragment key={`${rowKey}-${i}`}>
                        <tr
                          className={`${styles.tableRowExpandable} ${isExpanded ? styles.tableRowExpanded : ""}`}
                          onClick={() => toggleRowExpanded(rowKey)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && toggleRowExpanded(rowKey)}
                          aria-expanded={isExpanded}
                        >
                          <td className={styles.tableTd}>
                            <span className={`${styles.rowExpandIcon} ${isExpanded ? styles.rowExpandIconOpen : ""}`} aria-hidden>▶</span>
                            {row.supplier}
                          </td>
                          <td className={styles.tableTd}>£{formatTableAmount(row.theySay)}</td>
                          <td className={styles.tableTd}>£{formatTableAmount(row.xeroSays)}</td>
                          <td className={styles.tableTd}>
                            <span className={diff < 0 ? styles.diffNegative : styles.diffPositive}>
                              {diffFormatted}
                            </span>
                          </td>
                          <td className={styles.tableTd}>{row.unpaid}</td>
                          <td className={styles.tableTd}>
                            <span className={styles.issuesBadge}>{row.issues}</span>
                          </td>
                          <td className={styles.tableTd}>
                            <span className={`${styles.statusBadge} ${statusClass}`}>
                              <span className={styles.statusDot} aria-hidden />
                              {row.status}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className={styles.tableRowDetail}>
                            <td colSpan={7} className={styles.tableTdDetail}>
                              <div className={styles.detailPanel}>
                                <div className={styles.detailHeader}>
                                  <h3 className={styles.detailTitle}>
                                    {viewAllShownForRow.has(rowKey)
                                      ? totalUnpaidCount === 0
                                        ? "No unpaid invoices"
                                        : `${totalUnpaidCount} Unpaid invoices from supplier`
                                      : latestNoIssues
                                        ? "No errors here"
                                        : "Need your attention"}
                                  </h3>
                                  {activeTab === "latest" && (
                                    <button
                                      type="button"
                                      className={styles.detailViewAll}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleViewAll(rowKey);
                                      }}
                                    >
                                      {viewAllShownForRow.has(rowKey) ? "Hide all" : "View all"}
                                    </button>
                                  )}
                                  <div className={styles.detailActions}>
                                    <button
                                      type="button"
                                      className={styles.detailEmailBtn}
                                      disabled
                                      aria-disabled="true"
                                    >
                                      Email Supplier
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.detailCloseBtn}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        closeExpanded(rowKey);
                                      }}
                                      aria-label="Close"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                                {activeTab === "latest" && viewAllShownForRow.has(rowKey) && viewAllInvoices.length === 0 && (
                                  <p className={styles.detailNoUnpaid}>No unpaid invoices.</p>
                                )}
                                {detailRows.length > 0 && (
                                <div className={styles.detailTableWrap}>
                                  <table className={styles.detailTable}>
                                    <thead>
                                      <tr>
                                        <th className={styles.detailTh}>INVOICE #</th>
                                        <th className={styles.detailTh}>DATE</th>
                                        <th className={styles.detailTh}>ISSUE</th>
                                        <th className={styles.detailTh}>SUPPLIER AMT</th>
                                        <th className={styles.detailTh}>XERO AMT</th>
                                        <th className={styles.detailTh}>DIFFERENCE</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detailRows.map((inv, j) => (
                                        <tr key={inv.invoiceNumber ? `${inv.invoiceNumber}-${j}` : j}>
                                          <td className={styles.detailTd}>{inv.invoiceNumber}</td>
                                          <td className={styles.detailTd}>{inv.date || "–"}</td>
                                          <td className={styles.detailTd}>
                                            {inv.issue === "Matched" ? (
                                              <span className={styles.issuePillMatched}>Matched</span>
                                            ) : (
                                              <span className={inv.issue === "AMOUNT MISMATCH" ? styles.issuePillMismatch : styles.issuePillMissing}>
                                                {inv.issue}
                                              </span>
                                            )}
                                          </td>
                                          <td className={styles.detailTd}>
                                            {inv.supplierAmt == null ? "–" : `£${formatTableAmount(inv.supplierAmt)}`}
                                          </td>
                                          <td className={styles.detailTd}>{inv.xeroAmt == null ? "–" : `£${formatTableAmount(inv.xeroAmt)}`}</td>
                                          <td className={styles.detailTd}>
                                            {inv.issue === "Matched" ? (
                                              <span className={styles.diffNeutral}>£0.00</span>
                                            ) : (
                                              <span className={styles.diffNegative}>£{formatTableAmount(inv.difference)}</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {activeTab === "attention" && tab2Total > TAB2_PAGE_SIZE && (
              <div className={styles.tab2Pagination}>
                <span className={styles.tab2PaginationInfo}>
                  {(tab2Page - 1) * TAB2_PAGE_SIZE + 1}–{Math.min(tab2Page * TAB2_PAGE_SIZE, tab2Total)} of {tab2Total}
                </span>
                <button
                  type="button"
                  className={styles.tab2PaginationBtn}
                  disabled={tab2Page <= 1}
                  onClick={() => setTab2Page((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  Previous
                </button>
                <span className={styles.tab2PaginationPages}>
                  Page {tab2Page} of {tab2TotalPages}
                </span>
                <button
                  type="button"
                  className={styles.tab2PaginationBtn}
                  disabled={tab2Page >= tab2TotalPages}
                  onClick={() => setTab2Page((p) => Math.min(tab2TotalPages, p + 1))}
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

    </div>
  );
}
