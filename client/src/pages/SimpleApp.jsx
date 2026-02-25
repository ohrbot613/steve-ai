import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import confetti from "canvas-confetti";
import styles from "../scss/SimpleApp.module.scss";
import { exportToExcel } from "../utils/exportUtils";

function fireConfettiFromElement(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = (rect.left + rect.width / 2) / window.innerWidth;
  const y = (rect.top + rect.height / 2) / window.innerHeight;
  confetti({
    particleCount: 60,
    spread: 55,
    origin: { x, y },
    colors: ["#4ADE80", "#22C55E", "#16A34A", "#FBBF24", "#F59E0B"],
    decay: 0.82,
    ticks: 90,
  });
}

function formatAmount(amount) {
  if (amount == null || typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatTableAmount(amount) {
  if (amount == null || typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatCurrencyTableAmount(currency, amount) {
  const formatted = formatTableAmount(amount);
  if (formatted === "—") return formatted;
  const curr = (currency && String(currency).toUpperCase()) || "GBP";
  return `${curr} ${formatted}`;
}

/**
 * Returns { text } for "Never synced" / "Just now", or { num, unit } for "5 min ago" etc.
 * Used so the number and unit can be rendered in separate spans with a guaranteed gap.
 */
function formatLastSynced(date) {
  if (!date) return { text: 'Never synced' };
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return { text: 'Just now' };
  if (diffMin < 60) return { num: diffMin, unit: 'min ago' };
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return { num: diffHr, unit: 'h ago' };
  const diffDays = Math.floor(diffHr / 24);
  return { num: diffDays, unit: 'd ago' };
}

const DASHBOARD_DATA_URL = "/api/v2/dashboard/dashboard-data";
const DASHBOARD_TAB2_URL = "/api/v2/dashboard/dashboard-tab-2";
const DASHBOARD_TAB3_URL = "/api/v2/dashboard/dashboard-tab-3";
const ALL_STATEMENTS_URL = "/api/v2/supplier-logs/all-statements";
const STATEMENT_CONTACT_IDS_URL = "/api/v2/supplier-logs/statement-contact-ids";
const TAB2_PAGE_SIZE = 50;

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
const ALLOWED_EXT = [".pdf", ".xlsx", ".xls"];

function getTableDataForTab(tab, dashboardData, tab2Data, tab3Data) {
  if (tab === "latest") {
    const summary = dashboardData?.supplierSummary;
    if (Array.isArray(summary) && summary.length > 0) {
      return summary.map((row) => {
        const rawStatus = row.status ?? "Action Needed";
        const status = rawStatus === "No action needed" ? "Reconciled" : rawStatus;
        const invoicesNeedAttention = Array.isArray(row.invoicesNeedAttention) ? row.invoicesNeedAttention : [];
        const latestIssueCounts = invoicesNeedAttention.reduce(
          (acc, inv) => {
            if (inv?.issue === "AMOUNT MISMATCH") acc.amountMismatch += 1;
            if (inv?.issue === "MISSING FROM XERO") acc.missingFromXero += 1;
            if (inv?.issue === "MISSING FROM FILE") acc.missingFromFile += 1;
            return acc;
          },
          { amountMismatch: 0, missingFromXero: 0, missingFromFile: 0 }
        );
        return {
          supplier: row.supplier,
          contactId: row.contactId,
          theySay: row.theySay,
          xeroSays: row.xeroSays,
          supplierCurrency: row.supplierCurrency ?? "GBP",
          unpaid: row.unpaid ?? 0,
          paidCount: row.paidCount ?? 0,
          issues: row.issues ?? 0,
          status,
          statusIssueCounts: latestIssueCounts,
          invoicesNeedAttention,
          invoicesViewAll: Array.isArray(row.invoicesViewAll) ? row.invoicesViewAll : [],
        };
      });
    }
    return [];
  }
  if (tab === "attention") {
    const bySupplier = tab2Data?.bySupplier;
    if (Array.isArray(bySupplier) && bySupplier.length > 0) {
      const isPaid = (inv) => inv && inv.status === "paid";
      const rows = bySupplier.map((s) => {
        const fileInvs = (s.invoices || []).filter((i) => i.fromXero === false);
        const xeroInvs = (s.invoices || []).filter((i) => i.fromXero === true);
        const theySay = s.theySay != null ? s.theySay : fileInvs.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
        const xeroSays = s.xeroSays != null ? s.xeroSays : xeroInvs.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
        const allPairs = (s.pairs || []).filter(
          (p) => !isPaid(p.fileInvoice) && !isPaid(p.xeroInvoice)
        );
        const pairsAmountMismatch = allPairs.filter((p) => p.label === "amount mismatch");
        const unpairedInvoices = (s.unpairedInvoices || []).filter((u) => !isPaid(u));
        const issues = pairsAmountMismatch.length + unpairedInvoices.length;
        const hasAmountMismatch = pairsAmountMismatch.length > 0;
        const hasMissingFromXero = unpairedInvoices.some((u) => u.fromXero === false);
        const hasMissingFromFile = unpairedInvoices.some((u) => u.fromXero === true);
        const statusParts = [
          hasAmountMismatch ? "AMOUNT MISMATCH" : null,
          hasMissingFromXero ? "MISSING FROM XERO" : null,
          hasMissingFromFile ? "MISSING FROM FILE" : null,
        ].filter(Boolean);
        const statusIssueCounts = {
          amountMismatch: pairsAmountMismatch.length,
          missingFromXero: unpairedInvoices.filter((u) => u.fromXero === false).length,
          missingFromFile: unpairedInvoices.filter((u) => u.fromXero === true).length,
        };
        return {
          supplier: s.supplier,
          contactId: s.contactId,
          theySay,
          xeroSays,
          supplierCurrency: s.supplierCurrency ?? "GBP",
          unpaid: (s.invoices || []).length,
          issues,
          status: statusParts.length > 0 ? statusParts.join(" • ") : "Unpaid",
          statusIssueKinds: statusParts,
          statusIssueCounts,
          pairs: pairsAmountMismatch,
          unpairedInvoices,
        };
      });
      return rows.filter((r) => r.issues > 0);
    }
    return [];
  }
  if (tab === "reconciled") {
    const bySupplier = tab3Data?.bySupplier;
    if (Array.isArray(bySupplier) && bySupplier.length > 0) {
      return bySupplier.map((s) => {
        const pairs = s.pairs || [];
        const supplierCurrency =
          s.supplierCurrency ??
          pairs.find((p) => p?.fileInvoice?.currency)?.fileInvoice?.currency ??
          pairs.find((p) => p?.xeroInvoice?.currency)?.xeroInvoice?.currency ??
          "GBP";
        const amountOriginal =
          s.amountOriginal ??
          pairs.reduce((sum, p) => {
            const fileAmt = p?.fileInvoice?.amount;
            const xeroAmt = p?.xeroInvoice?.amount;
            const amount =
              fileAmt != null
                ? Number(fileAmt)
                : xeroAmt != null
                  ? Number(xeroAmt)
                  : Number(p?.fileAmountGBP) || 0;
            return sum + (Number.isFinite(amount) ? amount : 0);
          }, 0);
        const amountRounded = Math.round(amountOriginal * 100) / 100;
        return {
          supplier: s.supplier,
          contactId: s.contactId,
          supplierCurrency,
          amountGBP: amountRounded,
          pairCount: s.pairCount ?? pairs.length,
          pairsOverdue: s.pairsOverdue ?? 0,
          theySay: amountRounded,
          xeroSays: amountRounded,
          difference: s.difference ?? 0,
          unpaid: s.pairCount ?? s.unpaid ?? 0,
          issues: 0,
          status: "Reconciled",
          pairs,
        };
      });
    }
    return [];
  }
  return [];
}

function sortTableRows(rows, sortColumn, sortDir) {
  const withDiff = rows.map((row) => ({
    ...row,
    difference: row.difference != null ? row.difference : row.xeroSays - row.theySay,
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

/** Sort detail table rows (invoice list in expanded row) by column. */
function sortDetailRows(rows, sortColumn, sortDir) {
  if (!rows || rows.length === 0 || !sortColumn || sortColumn === "delete") return rows;
  const mult = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const sortKey = sortColumn === "supplierOrigAmt" ? "supplierOriginalAmount" : sortColumn === "xeroOrigAmt" ? "xeroOriginalAmount" : sortColumn;
    let va = a[sortKey];
    let vb = b[sortKey];
    if (sortColumn === "date") {
      const da = va ? new Date(va).getTime() : 0;
      const db = vb ? new Date(vb).getTime() : 0;
      return mult * (da - db);
    }
    if (sortColumn === "invoiceNumber" || sortColumn === "issue" || sortColumn === "status" || sortColumn === "currency") {
      va = String(va ?? "").toLowerCase();
      vb = String(vb ?? "").toLowerCase();
      return mult * (va < vb ? -1 : va > vb ? 1 : 0);
    }
    if (sortColumn === "supplierAmt" || sortColumn === "xeroAmt" || sortColumn === "difference" || sortColumn === "supplierOriginalAmount" || sortColumn === "supplierOrigAmt" || sortColumn === "xeroOrigAmt") {
      va = va == null || va === "" ? NaN : Number(va);
      vb = vb == null || vb === "" ? NaN : Number(vb);
      if (Number.isNaN(va) && Number.isNaN(vb)) return 0;
      if (Number.isNaN(va)) return mult;
      if (Number.isNaN(vb)) return -mult;
      return mult * (va - vb);
    }
    va = String(va ?? "").toLowerCase();
    vb = String(vb ?? "").toLowerCase();
    return mult * (va < vb ? -1 : va > vb ? 1 : 0);
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

/** Fetch dashboard tab 3 (reconciled: same-amount pairs only, by supplier). */
function useDashboardTab3() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(DASHBOARD_TAB3_URL, { credentials: "include" });
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
  const { data: tab2Data, refetch: refetchTab2 } = useDashboardTab2();
  const { data: tab3Data, refetch: refetchTab3 } = useDashboardTab3();
  const fileInputRef = useRef(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [manualSupplierQueue, setManualSupplierQueue] = useState([]);
  const [manualSupplierInput, setManualSupplierInput] = useState("");
  const [manualSupplierSubmitting, setManualSupplierSubmitting] = useState(false);
  const [manualSupplierError, setManualSupplierError] = useState("");
  const [manualSupplierVisible, setManualSupplierVisible] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const [activeTab, setActiveTab] = useState("attention");
  const [exportTab2Loading, setExportTab2Loading] = useState(false);
  const [exportTab3Loading, setExportTab3Loading] = useState(false);
  const [exportingSupplierKey, setExportingSupplierKey] = useState(null);
  const [paymentSuggestionNotifyRow, setPaymentSuggestionNotifyRow] = useState(null);
  const [sortByTab, setSortByTab] = useState({
    latest: { column: null, dir: "asc" },
    attention: { column: null, dir: "asc" },
    reconciled: { column: null, dir: "asc" },
    statements: { column: null, dir: "asc" },
  });
  const [detailTableSort, setDetailTableSort] = useState({ column: null, dir: "asc" });
  const [statementsList, setStatementsList] = useState([]);
  const [statementsLoading, setStatementsLoading] = useState(false);
  const [statementsError, setStatementsError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncNowLoading, setSyncNowLoading] = useState(false);
  const statementsWithInvoices = useMemo(
    () => statementsList.filter((log) => (log.total ?? 0) >= 1),
    [statementsList]
  );

  const statementsBySupplier = useMemo(() => {
    // Include all statements from the list (no filter by total) so every statement in DB for that contact id is shown
    const byContactId = {};
    for (const log of statementsList) {
      const rawKey = log.contactId ?? log.supplier?.name ?? "";
      const key = typeof rawKey === "string" ? rawKey : String(rawKey || "");
      const bucketKey = key || "unknown";
      if (!byContactId[bucketKey]) byContactId[bucketKey] = [];
      byContactId[bucketKey].push(log);
    }
    for (const arr of Object.values(byContactId)) {
      arr.sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
    }
    return Object.keys(byContactId)
      .sort((a, b) => {
        const nameA = (byContactId[a][0]?.supplier?.name ?? a);
        const nameB = (byContactId[b][0]?.supplier?.name ?? b);
        return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
      })
      .map((contactKey) => {
        const statements = byContactId[contactKey];
        const supplierName = statements[0]?.supplier?.name ?? contactKey;
        return { supplierName, contactId: contactKey, statements };
      });
  }, [statementsList]);

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

  const handleDetailSort = (column) => {
    setDetailTableSort((prev) => ({
      column,
      dir: prev.column === column && prev.dir === "asc" ? "desc" : "asc",
    }));
  };

  const tabSort = sortByTab[activeTab];
  const [tab3OptimisticPaidIds, setTab3OptimisticPaidIds] = useState(() => new Set());
  const tableDataForTab = getTableDataForTab(activeTab, dashboardData, tab2Data, tab3Data);
  const tableDataForDisplay =
    activeTab === "reconciled" && tab3OptimisticPaidIds.size > 0
      ? tableDataForTab
          .map((row) => {
            const pairs = (row.pairs || []).filter(
              (p) =>
                !tab3OptimisticPaidIds.has(String(p.fileInvoice?._id)) &&
                !tab3OptimisticPaidIds.has(String(p.xeroInvoice?._id))
            );
            if (pairs.length === 0) return null;
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const pairsOverdue = pairs.filter((p) => {
              const d = p.fileInvoice?.dueDate || p.fileInvoice?.date || p.xeroInvoice?.dueDate || p.xeroInvoice?.date;
              if (!d) return false;
              const due = new Date(d);
              due.setHours(0, 0, 0, 0);
              return due.getTime() < todayStart.getTime();
            }).length;
            const amountGBP = pairs.reduce((sum, p) => {
              const fileAmt = p?.fileInvoice?.amount;
              const xeroAmt = p?.xeroInvoice?.amount;
              const amount =
                fileAmt != null
                  ? Number(fileAmt)
                  : xeroAmt != null
                    ? Number(xeroAmt)
                    : Number(p?.fileAmountGBP) || 0;
              return sum + (Number.isFinite(amount) ? amount : 0);
            }, 0);
            const amountGBPRounded = Math.round(amountGBP * 100) / 100;
            return {
              ...row,
              pairs,
              pairCount: pairs.length,
              pairsOverdue,
              amountGBP: amountGBPRounded,
              theySay: amountGBPRounded,
              xeroSays: amountGBPRounded,
              unpaid: pairs.length,
            };
          })
          .filter(Boolean)
      : tableDataForTab;
  const sortedTableData = sortTableRows(
    tableDataForDisplay,
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

  // Fetch statements from DB per supplier by contact id when Statements tab is active
  useEffect(() => {
    if (activeTab !== "statements") return;
    let cancelled = false;
    setStatementsLoading(true);
    setStatementsError("");
    const sortBy = "processDateTime";
    const sortOrder = "desc";
    fetch(STATEMENT_CONTACT_IDS_URL, { credentials: "include" })
      .then((r) => r.json())
      .then(async (data) => {
        if (cancelled) return;
        if (!data.success || !Array.isArray(data.contactIds) || data.contactIds.length === 0) {
          setStatementsList([]);
          if (data.success && Array.isArray(data.contactIds) && data.contactIds.length === 0) {
            setStatementsError("");
          } else {
            setStatementsError("Failed to load statements");
          }
          return;
        }
        const allLogs = [];
        for (const { contactId, supplierName } of data.contactIds) {
          if (cancelled) break;
          let page = 1;
          let totalPages = 1;
          do {
            const res = await fetch(
              `${ALL_STATEMENTS_URL}?page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}&contactId=${encodeURIComponent(contactId)}`,
              { credentials: "include" }
            );
            const pageData = await res.json();
            if (cancelled) break;
            if (!pageData.success || !Array.isArray(pageData.logs)) break;
            allLogs.push(...pageData.logs);
            totalPages = pageData.pages ?? 1;
            page++;
          } while (page <= totalPages && !cancelled);
        }
        if (!cancelled) setStatementsList(allLogs);
      })
      .catch(() => {
        if (!cancelled) {
          setStatementsList([]);
          setStatementsError("Failed to load statements");
        }
      })
      .finally(() => {
        if (!cancelled) setStatementsLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTab]);

  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [expandedStatementSuppliers, setExpandedStatementSuppliers] = useState(() => new Set());
  const toggleRowExpanded = (supplier) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(supplier)) next.delete(supplier);
      else next.add(supplier);
      return next;
    });
  };
  const toggleStatementSupplierExpanded = (supplierName) => {
    setExpandedStatementSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(supplierName)) next.delete(supplierName);
      else next.add(supplierName);
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

  const [emailModalRow, setEmailModalRow] = useState(null);
  const currentManualSupplierItem = manualSupplierQueue[0] ?? null;
  useEffect(() => {
    if (!currentManualSupplierItem || !manualSupplierVisible) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !manualSupplierSubmitting) handleManualSupplierCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentManualSupplierItem, manualSupplierSubmitting, manualSupplierVisible]);
  useEffect(() => {
    if (emailModalRow == null) return;
    const onKeyDown = (e) => { if (e.key === "Escape") setEmailModalRow(null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [emailModalRow]);

  const [viewAllShownForRow, setViewAllShownForRow] = useState(() => new Set());
  const toggleViewAll = (rowKey) => {
    setViewAllShownForRow((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  // Tab 3 (reconciled): selected invoice ids for bulk actions (e.g. Paid)
  const [tab3SelectedIds, setTab3SelectedIds] = useState(() => new Set());
  const [deletingInvoiceId, setDeletingInvoiceId] = useState(null);
  const [hidePaidAndMatchedInTab1, setHidePaidAndMatchedInTab1] = useState(false);
  const toggleTab3InvoiceSelection = (id) => {
    setTab3SelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleTab3SelectAllForRow = (rowKey, invoiceIds) => {
    setTab3SelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = invoiceIds.every((id) => next.has(id));
      if (allSelected) {
        invoiceIds.forEach((id) => next.delete(id));
      } else {
        invoiceIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  // Toast after marking invoices paid (bottom right, Undo for 5s)
  const [tab3PaidToast, setTab3PaidToast] = useState({ visible: false, invoiceIds: [], message: "" });
  const tab3PaidToastTimeoutRef = useRef(null);

  const handleMarkPaid = useCallback(async (row, indices, rowKey) => {
    if (!row?.pairs?.length) return;
    const invoiceIds = indices.flatMap((j) => {
      const p = row.pairs[j];
      if (!p?.fileInvoice?._id || !p?.xeroInvoice?._id) return [];
      return [String(p.fileInvoice._id), String(p.xeroInvoice._id)];
    });
    if (invoiceIds.length === 0) return;
    setTab3OptimisticPaidIds((prev) => new Set([...prev, ...invoiceIds]));
    const pairCount = indices.length;
    const message = pairCount === 1 ? "1 invoice marked as paid" : `${pairCount} invoices marked as paid`;
    setTab3PaidToast({ visible: true, invoiceIds, message });
    setTab3SelectedIds((prev) => {
      const next = new Set(prev);
      indices.forEach((j) => next.delete(`${rowKey}-${j}`));
      return next;
    });
    if (tab3PaidToastTimeoutRef.current) clearTimeout(tab3PaidToastTimeoutRef.current);
    tab3PaidToastTimeoutRef.current = setTimeout(() => {
      setTab3PaidToast((t) => ({ ...t, visible: false }));
      tab3PaidToastTimeoutRef.current = null;
    }, 5000);
    try {
      const res = await fetch("/api/v2/dashboard/mark-invoices-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setTab3OptimisticPaidIds((prev) => {
          const next = new Set(prev);
          invoiceIds.forEach((id) => next.delete(id));
          return next;
        });
        if (tab3PaidToastTimeoutRef.current) {
          clearTimeout(tab3PaidToastTimeoutRef.current);
          tab3PaidToastTimeoutRef.current = null;
        }
        setTab3PaidToast((t) => ({ ...t, visible: false }));
        throw new Error(data.message || "Failed to mark as paid");
      }
      refetchTab3().then(() => {
        setTab3OptimisticPaidIds((prev) => {
          const next = new Set(prev);
          invoiceIds.forEach((id) => next.delete(id));
          return next;
        });
      });
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to mark as paid");
    }
  }, [refetchTab3]);

  const handleHardDeleteInvoice = useCallback(async (invoiceId) => {
    if (!invoiceId) return;
    setDeletingInvoiceId(invoiceId);
    try {
      const res = await fetch(`/api/v2/dashboard/invoices/${encodeURIComponent(invoiceId)}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to delete invoice");
      await Promise.all([refetchDashboardData(), refetchTab2(), refetchTab3()]);
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to delete invoice");
    } finally {
      setDeletingInvoiceId(null);
    }
  }, [refetchDashboardData, refetchTab2, refetchTab3]);

  const handleUndoPaid = useCallback(async () => {
    const { invoiceIds } = tab3PaidToast;
    if (!invoiceIds?.length) return;
    if (tab3PaidToastTimeoutRef.current) {
      clearTimeout(tab3PaidToastTimeoutRef.current);
      tab3PaidToastTimeoutRef.current = null;
    }
    setTab3OptimisticPaidIds((prev) => {
      const next = new Set(prev);
      invoiceIds.forEach((id) => next.delete(id));
      return next;
    });
    setTab3PaidToast((t) => ({ ...t, visible: false }));
    try {
      const res = await fetch("/api/v2/dashboard/undo-mark-invoices-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setTab3OptimisticPaidIds((prev) => new Set([...prev, ...invoiceIds]));
        throw new Error(data.message || "Failed to undo");
      }
      refetchTab3();
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to undo");
    }
  }, [tab3PaidToast.invoiceIds, refetchTab3]);

  useEffect(() => {
    return () => {
      if (tab3PaidToastTimeoutRef.current) clearTimeout(tab3PaidToastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const openPicker = () => fileInputRef.current?.click();
    window.addEventListener("simple-app-open-upload", openPicker);
    return () => window.removeEventListener("simple-app-open-upload", openPicker);
  }, []);

  const refreshXeroSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v2/dashboard/xero-sync-status", { credentials: "include" });
      const data = await res.json();
      if (data?.lastSyncedAt) setLastSyncedAt(new Date(data.lastSyncedAt));
      else setLastSyncedAt(null);
    } catch (_) {
      // Silent on error — non-critical indicator
    }
  }, []);

  useEffect(() => {
    refreshXeroSyncStatus();
  }, [refreshXeroSyncStatus]);

  const handleSyncNow = useCallback(async () => {
    setSyncNowLoading(true);
    try {
      const res = await fetch("/api/v2/dashboard/xero-sync-now", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "Failed to sync with Xero");
      }
      if (data?.lastSyncedAt) setLastSyncedAt(new Date(data.lastSyncedAt));
      await Promise.all([refetchDashboardData(), refetchTab2(), refetchTab3(), refreshXeroSyncStatus()]);
    } catch (err) {
      alert(err.message || "Failed to sync with Xero");
    } finally {
      setSyncNowLoading(false);
    }
  }, [refetchDashboardData, refetchTab2, refetchTab3, refreshXeroSyncStatus]);

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
  const lastBatchInvoiceCount = dashboardData?.invoicesLength ?? statementCount;

  const suppliersSayWeOwe = dashboardData?.invoicesAmountTotal != null
    ? Number(dashboardData.invoicesAmountTotal)
    : null;
  const xeroSaysWeOwe = dashboardData?.xeroInvoicesAmountTotal != null
    ? Number(dashboardData.xeroInvoicesAmountTotal)
    : null;
  const difference = suppliersSayWeOwe != null && xeroSaysWeOwe != null
    ? xeroSaysWeOwe - suppliersSayWeOwe
    : null;

  const suppliersReconciled = Array.isArray(tab3Data?.bySupplier)
    ? tab3Data.bySupplier.length
    : Array.isArray(dashboardData?.contactIdsInPaired)
      ? dashboardData.contactIdsInPaired.length
      : 0;
  const attentionTableData = getTableDataForTab("attention", dashboardData, tab2Data);
  const suppliersWithIssues = attentionTableData.length;

  const needsAttentionCount = attentionTableData.reduce(
    (sum, row) => sum + (row.issues ?? 0),
    0
  );
  const attentionInvoiceCount = attentionTableData.reduce(
    (sum, row) => sum + (row.pairs?.length ?? 0) * 2 + (row.unpairedInvoices?.length ?? 0),
    0
  );
  const reconciledTableData = getTableDataForTab("reconciled", dashboardData, tab2Data, tab3Data);
  const reconciledInvoiceCount = reconciledTableData.reduce(
    (sum, row) => sum + (row.pairs?.length ?? 0) * 2,
    0
  );

  const exportTab2IssuesToExcel = useCallback(async () => {
    const bySupplier = tab2Data?.bySupplier;
    if (!Array.isArray(bySupplier) || bySupplier.length === 0) {
      alert("No data to export");
      return;
    }
    setExportTab2Loading(true);
    try {
      const rows = [];
      for (const s of bySupplier) {
        const supplier = s.supplier || s.contactId || "";
        for (const p of s.pairs || []) {
          if (p.label !== "amount mismatch") continue;
          const fileInv = p.fileInvoice || {};
          const xeroInv = p.xeroInvoice || {};
          rows.push({
            supplier,
            issue: "AMOUNT MISMATCH",
            invoiceNumber: fileInv.invoiceNumber || xeroInv.invoiceNumber || "",
            fileAmount: fileInv.amount != null ? Number(fileInv.amount) : "",
            fileCurrency: fileInv.currency ?? "GBP",
            xeroAmount: xeroInv.amount != null ? Number(xeroInv.amount) : "",
            xeroCurrency: xeroInv.currency ?? "GBP",
            dueDate: (xeroInv.dueDate || xeroInv.date) || (fileInv.dueDate || fileInv.date)
              ? new Date((xeroInv.dueDate || xeroInv.date) || (fileInv.dueDate || fileInv.date)).toLocaleDateString("en-GB")
              : "",
          });
        }
        for (const u of s.unpairedInvoices || []) {
          const amtOrig = u.amount != null ? Number(u.amount) : "";
          const curr = u.currency ?? "GBP";
          const dueOrDate = u.dueDate || u.date;
          rows.push({
            supplier,
            issue: u.fromXero ? "MISSING FROM FILE" : "MISSING FROM XERO",
            invoiceNumber: u.invoiceNumber || "",
            fileAmount: u.fromXero ? "" : amtOrig,
            fileCurrency: u.fromXero ? "" : curr,
            xeroAmount: u.fromXero ? amtOrig : "",
            xeroCurrency: u.fromXero ? curr : "",
            dueDate: dueOrDate ? new Date(dueOrDate).toLocaleDateString("en-GB") : "",
          });
        }
      }
      if (rows.length === 0) {
        alert("No issues to export");
        return;
      }
      const headers = [
        { label: "Supplier", key: "supplier" },
        { label: "Issue", key: "issue" },
        { label: "Invoice #", key: "invoiceNumber" },
        { label: "File Amount", key: "fileAmount" },
        { label: "File Currency", key: "fileCurrency" },
        { label: "Xero Amount", key: "xeroAmount" },
        { label: "Xero Currency", key: "xeroCurrency" },
        { label: "Due Date", key: "dueDate" },
      ];
      await exportToExcel(rows, headers, `tab2-issues-${new Date().toISOString().slice(0, 10)}`);
    } catch (err) {
      console.error(err);
      alert("Export failed");
    } finally {
      setExportTab2Loading(false);
    }
  }, [tab2Data]);

  const exportSingleSupplierToExcel = useCallback(async (row) => {
    const supplier = row.supplier || row.contactId || "";
    const rows = [];
    for (const p of row.pairs || []) {
      if (p.label !== "amount mismatch") continue;
      const fileInv = p.fileInvoice || {};
      const xeroInv = p.xeroInvoice || {};
      rows.push({
        supplier,
        issue: "AMOUNT MISMATCH",
        invoiceNumber: fileInv.invoiceNumber || xeroInv.invoiceNumber || "",
        fileAmount: fileInv.amount != null ? Number(fileInv.amount) : "",
        fileCurrency: fileInv.currency ?? "GBP",
        xeroAmount: xeroInv.amount != null ? Number(xeroInv.amount) : "",
        xeroCurrency: xeroInv.currency ?? "GBP",
        dueDate: (xeroInv.dueDate || xeroInv.date) || (fileInv.dueDate || fileInv.date)
          ? new Date((xeroInv.dueDate || xeroInv.date) || (fileInv.dueDate || fileInv.date)).toLocaleDateString("en-GB")
          : "",
      });
    }
    for (const u of row.unpairedInvoices || []) {
      const amtOrig = u.amount != null ? Number(u.amount) : "";
      const curr = u.currency ?? "GBP";
      const dueOrDate = u.dueDate || u.date;
      rows.push({
        supplier,
        issue: u.fromXero ? "MISSING FROM FILE" : "MISSING FROM XERO",
        invoiceNumber: u.invoiceNumber || "",
        fileAmount: u.fromXero ? "" : amtOrig,
        fileCurrency: u.fromXero ? "" : curr,
        xeroAmount: u.fromXero ? amtOrig : "",
        xeroCurrency: u.fromXero ? curr : "",
        dueDate: dueOrDate ? new Date(dueOrDate).toLocaleDateString("en-GB") : "",
      });
    }
    if (rows.length === 0) {
      alert("No issues to export for this supplier");
      return;
    }
    const rowKey = row.contactId ?? row.supplier;
    setExportingSupplierKey(rowKey);
    try {
      const headers = [
        { label: "Supplier", key: "supplier" },
        { label: "Issue", key: "issue" },
        { label: "Invoice #", key: "invoiceNumber" },
        { label: "File Amount", key: "fileAmount" },
        { label: "File Currency", key: "fileCurrency" },
        { label: "Xero Amount", key: "xeroAmount" },
        { label: "Xero Currency", key: "xeroCurrency" },
        { label: "Due Date", key: "dueDate" },
      ];
      const slug = String(supplier).replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
      await exportToExcel(rows, headers, `tab2-issues-${slug}-${new Date().toISOString().slice(0, 10)}`);
    } catch (err) {
      console.error(err);
      alert("Export failed");
    } finally {
      setExportingSupplierKey(null);
    }
  }, []);

  const exportTab3ToExcel = useCallback(async () => {
    const bySupplier = tab3Data?.bySupplier;
    if (!Array.isArray(bySupplier) || bySupplier.length === 0) {
      alert("No reconciled data to export");
      return;
    }
    setExportTab3Loading(true);
    try {
      const rows = [];
      for (const s of bySupplier) {
        const supplier = s.supplier || "";
        for (const p of s.pairs || []) {
          const fileInv = p.fileInvoice || {};
          const xeroInv = p.xeroInvoice || {};
          const actualAmount = fileInv.amount != null ? Number(fileInv.amount) : "";
          const currency = fileInv.currency ?? xeroInv.currency ?? "GBP";
          const generatedAmountGBP = p.fileAmountGBP != null ? p.fileAmountGBP : (actualAmount !== "" && currency === "GBP" ? actualAmount : "");
          rows.push({
            supplier,
            invoiceNumber: fileInv.invoiceNumber || xeroInv.invoiceNumber || "",
            actualAmount,
            currency,
            generatedAmountGBP,
            generatedCurrency: "GBP",
            dueDate: (fileInv.dueDate || fileInv.date) || (xeroInv.dueDate || xeroInv.date)
              ? new Date((fileInv.dueDate || fileInv.date) || (xeroInv.dueDate || xeroInv.date)).toLocaleDateString("en-GB")
              : "",
          });
        }
      }
      if (rows.length === 0) {
        alert("No reconciled invoices to export");
        return;
      }
      const headers = [
        { label: "Supplier", key: "supplier" },
        { label: "Invoice #", key: "invoiceNumber" },
        { label: "Actual Amount", key: "actualAmount" },
        { label: "Currency", key: "currency" },
        { label: "Exchange Amount (£)", key: "generatedAmountGBP" },
        { label: "Exchange Currency", key: "generatedCurrency" },
        { label: "Due Date", key: "dueDate" },
      ];
      await exportToExcel(rows, headers, `tab3-reconciled-${new Date().toISOString().slice(0, 10)}`);
    } catch (err) {
      console.error(err);
      alert("Export failed");
    } finally {
      setExportTab3Loading(false);
    }
  }, [tab3Data]);

  const exportSingleSupplierTab3ToExcel = useCallback(async (row) => {
    const supplier = row.supplier || row.contactId || "";
    const pairs = row.pairs || [];
    if (pairs.length === 0) {
      alert("No reconciled invoices to export for this supplier");
      return;
    }
    const rowKey = row.contactId ?? row.supplier;
    setExportingSupplierKey(rowKey);
    try {
      const rows = [];
      for (const p of pairs) {
        const fileInv = p.fileInvoice || {};
        const xeroInv = p.xeroInvoice || {};
        const actualAmount = fileInv.amount != null ? Number(fileInv.amount) : "";
        const currency = fileInv.currency ?? xeroInv.currency ?? "GBP";
        const generatedAmountGBP = p.fileAmountGBP != null ? p.fileAmountGBP : (actualAmount !== "" && currency === "GBP" ? actualAmount : "");
        rows.push({
          supplier,
          invoiceNumber: fileInv.invoiceNumber || xeroInv.invoiceNumber || "",
          actualAmount,
          currency,
          generatedAmountGBP,
          generatedCurrency: "GBP",
          dueDate: (fileInv.dueDate || fileInv.date) || (xeroInv.dueDate || xeroInv.date)
            ? new Date((fileInv.dueDate || fileInv.date) || (xeroInv.dueDate || xeroInv.date)).toLocaleDateString("en-GB")
            : "",
        });
      }
      const headers = [
        { label: "Supplier", key: "supplier" },
        { label: "Invoice #", key: "invoiceNumber" },
        { label: "Actual Amount", key: "actualAmount" },
        { label: "Currency", key: "currency" },
        { label: "Generated Amount (£)", key: "generatedAmountGBP" },
        { label: "Exchange Currency", key: "generatedCurrency" },
        { label: "Due Date", key: "dueDate" },
      ];
      const slug = String(supplier).replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
      await exportToExcel(rows, headers, `tab3-reconciled-${slug}-${new Date().toISOString().slice(0, 10)}`);
    } catch (err) {
      console.error(err);
      alert("Export failed");
    } finally {
      setExportingSupplierKey(null);
    }
  }, []);

  function handleFileSelect(e) {
    const files = e.target.files;
    if (files?.length > 0) handleFileUpload(files);
    e.target.value = "";
  }

  function handleDragEnter(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.types?.includes("Files")) setIsDragging(true);
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    if (uploadLoading) return;
    const files = e.dataTransfer?.files;
    if (files?.length > 0) handleFileUpload(files);
  }

  /** Show a short, non-technical reason when an upload fails. */
  function getUploadErrorMessage(serverMessage, context = "upload") {
    if (serverMessage && typeof serverMessage === "string" && serverMessage.trim()) {
      const msg = serverMessage.trim();
      if (msg.includes("supplier") || msg.includes("vendor") || msg.includes("Reconciliation")) return msg;
      if (msg.includes("PDF") || msg.includes("Excel") || msg.includes("file")) return msg;
      if (msg.includes("couldn't") || msg.includes("could not") || msg.includes("Please ")) return msg;
    }
    if (context === "batch") return "Some files couldn't be processed. Please check that each file is a valid PDF or Excel and try again.";
    if (context === "network") return "The upload didn't complete. Please check your connection and try again.";
    return "The upload failed. Please try again.";
  }

  function queueUnresolvedUploads(items) {
    const list = (items || []).filter((item) => item?.unresolvedUpload);
    if (list.length === 0) return;
    setManualSupplierQueue((prev) => {
      const next = [...prev, ...list];
      if (prev.length === 0) {
        const firstGuess = list[0]?.candidateSuppliers?.[0]?.name || "";
        setManualSupplierInput(firstGuess);
        setManualSupplierError("");
        setManualSupplierVisible(true);
      }
      return next;
    });
  }

  function popManualSupplierQueue(showNextPrompt = true) {
    setManualSupplierQueue((prev) => {
      const next = prev.slice(1);
      const nextGuess = next[0]?.candidateSuppliers?.[0]?.name || "";
      setManualSupplierInput(nextGuess);
      setManualSupplierError("");
      if (next.length > 0 && showNextPrompt) {
        setTimeout(() => setManualSupplierVisible(true), 160);
      }
      return next;
    });
  }

  async function handleManualSupplierContinue() {
    const current = manualSupplierQueue[0];
    if (!current?.unresolvedUpload) return;
    const supplierName = manualSupplierInput.trim();
    if (!supplierName) {
      setManualSupplierError("Please enter a supplier name.");
      return;
    }
    setManualSupplierSubmitting(true);
    setManualSupplierError("");
    setManualSupplierVisible(false);
    try {
      const res = await fetch("/api/v2/invoice/continue-unresolved-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          supplierName,
          unresolvedUpload: current.unresolvedUpload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManualSupplierError(
          data?.message ||
            "We couldn't continue this file. Please add/sync the supplier first."
        );
        return;
      }
      setUploadSuccess((prev) => {
        const fileLabel = current.fileName || current.unresolvedUpload?.fileName || "File";
        const createdCount = data.createdCount ?? (data.created?.length ?? 0);
        const currentLine = `${fileLabel} continued.${createdCount > 0 ? ` ${createdCount} invoice(s) saved.` : ""}`;
        return prev ? `${prev} ${currentLine}` : currentLine;
      });
      popManualSupplierQueue(true);
      refetchDashboardData();
      refetchTab2();
      refetchTab3();
    } catch (err) {
      setManualSupplierError(getUploadErrorMessage(err?.message, "network"));
      setManualSupplierVisible(true);
    } finally {
      setManualSupplierSubmitting(false);
    }
  }

  function handleManualSupplierSkip() {
    setManualSupplierVisible(false);
    popManualSupplierQueue(true);
  }

  function handleManualSupplierCancel() {
    setManualSupplierVisible(false);
    setManualSupplierQueue([]);
    setManualSupplierInput("");
    setManualSupplierError("");
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
        "Upload failed. Only PDF and Excel files are allowed. One or more of your files weren't in a supported format."
      );
      return;
    }
    setUploadLoading(true);
    setUploadError("");
    setUploadSuccess("");
    setManualSupplierQueue([]);
    setManualSupplierInput("");
    setManualSupplierError("");
    setManualSupplierVisible(false);
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
          if (data?.status === "needs_supplier_input" && data?.unresolvedUpload) {
            queueUnresolvedUploads([{
              fileName: data.fileName || fileArray[0]?.name || "File",
              candidateSuppliers: data.candidateSuppliers || [],
              unresolvedUpload: data.unresolvedUpload,
            }]);
            setUploadError("");
            return;
          }
          setUploadError(getUploadErrorMessage(data?.message, "batch"));
          return;
        }
        const errors = data.errors || [];
        const unresolvedErrors = errors.filter((e) => e?.status === "needs_supplier_input" && e?.unresolvedUpload);
        const failedErrors = errors.filter((e) => e?.status !== "needs_supplier_input");
        const count = (data.results || []).length;
        const totalCreated = (data.results || []).reduce((s, r) => s + (r.createdCount ?? 0), 0);
        if (unresolvedErrors.length > 0) {
          queueUnresolvedUploads(unresolvedErrors.map((entry) => ({
            fileName: entry.fileName,
            candidateSuppliers: entry.candidateSuppliers || [],
            unresolvedUpload: entry.unresolvedUpload,
          })));
        }
        if (errors.length > 0) {
          const allFailed = count === 0;
          if (allFailed) {
            setUploadError(
              unresolvedErrors.length > 0
                ? `${unresolvedErrors.length} file(s) need supplier name input before they can continue.`
                : "Upload failed. We couldn't process any of the files. Please check that each file is a valid PDF or Excel and that we can identify the supplier."
            );
          } else {
            setUploadSuccess(
              `${count} file(s) processed.${totalCreated > 0 ? ` ${totalCreated} invoice(s) saved.` : ""}`
            );
            const genericErrorCount = failedErrors.length;
            const unresolvedCount = unresolvedErrors.length;
            if (genericErrorCount > 0 || unresolvedCount > 0) {
              const parts = [];
              if (unresolvedCount > 0) parts.push(`${unresolvedCount} file(s) need supplier name input`);
              if (genericErrorCount > 0) parts.push(`${genericErrorCount} file(s) couldn't be processed`);
              setUploadError(`${parts.join(". ")}.`);
            }
          }
        } else {
          setUploadSuccess(
            `${count} file(s) processed.${totalCreated > 0 ? ` ${totalCreated} invoice(s) saved.` : ""}`
          );
        }
        if (totalCreated > 0) {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
            colors: ["#4ADE80", "#22C55E", "#7B8CDE", "#A5B4FC", "#FBBF24"],
            decay: 0.9,
            ticks: 100,
          });
        }
        refetchDashboardData();
        refetchTab2();
        refetchTab3();
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
          if (data?.status === "needs_supplier_input" && data?.unresolvedUpload) {
            queueUnresolvedUploads([{
              fileName: data.fileName || fileArray[0]?.name || "File",
              candidateSuppliers: data.candidateSuppliers || [],
              unresolvedUpload: data.unresolvedUpload,
            }]);
            setUploadError("");
            return;
          }
          setUploadError(getUploadErrorMessage(data?.message));
          return;
        }
        const createdCount = data.createdCount ?? (data.created?.length ?? 0);
        setUploadSuccess(
          `"${fileArray[0].name}" processed.${createdCount > 0 ? ` ${createdCount} invoice(s) saved.` : ""}`
        );
        if (createdCount > 0) {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
            colors: ["#4ADE80", "#22C55E", "#7B8CDE", "#A5B4FC", "#FBBF24"],
            decay: 0.9,
            ticks: 100,
          });
        }
        refetchDashboardData();
        refetchTab2();
        refetchTab3();
      }
    } catch (err) {
      setUploadError(getUploadErrorMessage(err?.message, "network"));
    } finally {
      setUploadLoading(false);
    }
  }

  const totals = [
    {
      label: "Suppliers say we owe (£)",
      value: formatAmount(suppliersSayWeOwe),
      valueClass: styles.totalsValueDefault,
    },
    {
      label: "Xero says we owe (£)",
      value: formatAmount(xeroSaysWeOwe),
      valueClass: styles.totalsValueDefault,
    },
    {
      label: "Difference (£)",
      value: difference != null ? `£${formatAmount(difference)}` : formatAmount(difference),
      valueClass:
        difference != null
          ? difference === 0
            ? styles.totalsValueSuccess
            : styles.totalsValueDanger
          : styles.totalsValueDefault,
    },
  ];

  return (
    <div
      className={`${styles.root} ${isDragging ? styles.rootDragging : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
        {lastUploadLoading ? (
          <>
            <section className={styles.batchSummary} aria-busy aria-label="Loading">
              <div className={styles.cardsRow}>
                <div className={styles.card}>
                  <div className={`${styles.skeletonBlock} ${styles.skeletonNumber}`} />
                  <div className={styles.skeletonLine} style={{ width: "80%", height: 16, marginTop: 10 }} />
                  <div className={styles.skeletonLine} style={{ width: 100, height: 12, marginTop: 8 }} />
                </div>
                <div className={styles.card}>
                  <div className={`${styles.skeletonBlock} ${styles.skeletonNumber}`} />
                  <div className={styles.skeletonLine} style={{ width: "75%", height: 16, marginTop: 10 }} />
                  <div className={styles.skeletonLine} style={{ width: 90, height: 12, marginTop: 8 }} />
                </div>
              </div>
            </section>
            <section className={styles.totalsBar}>
              <div className={styles.totalsBarHeader}>
                <div className={styles.skeletonLine} style={{ width: 220, height: 14 }} />
                <div className={styles.skeletonLine} style={{ width: 140, height: 12 }} />
              </div>
              <div className={styles.totalsRow}>
                <div className={styles.totalsCell}><span className={styles.skeletonLine} style={{ width: 160, height: 12, display: "block" }} /><span className={styles.skeletonBlock} style={{ width: 72, height: 20, marginTop: 4, display: "inline-block" }} /></div>
                <div className={styles.totalsCell}><span className={styles.skeletonLine} style={{ width: 150, height: 12, display: "block" }} /><span className={styles.skeletonBlock} style={{ width: 72, height: 20, marginTop: 4, display: "inline-block" }} /></div>
                <div className={styles.totalsCell}><span className={styles.skeletonLine} style={{ width: 100, height: 12, display: "block" }} /><span className={styles.skeletonBlock} style={{ width: 56, height: 20, marginTop: 4, display: "inline-block" }} /></div>
              </div>
            </section>
            <div className={styles.tabsContainer}>
              <nav className={styles.tabs} aria-hidden>
                <div className={`${styles.tab} ${styles.tabActive}`}><span className={styles.skeletonLine} style={{ width: 88, height: 14 }} /><span className={styles.skeletonBadge} /></div>
                <div className={styles.tab}><span className={styles.skeletonLine} style={{ width: 110, height: 14 }} /><span className={styles.skeletonBadge} /></div>
                <div className={styles.tab}><span className={styles.skeletonLine} style={{ width: 72, height: 14 }} /><span className={styles.skeletonBadge} /></div>
              </nav>
            </div>
            <div className={styles.tabPanel}>
              <div className={styles.tableSection}>
                <div className={styles.tableWrap}>
                  <table className={styles.supplierTable}>
                    <thead>
                      <tr>
                        <th className={styles.tableTh}><span className={styles.skeletonLine} style={{ width: 80, height: 12 }} /></th>
                        <th className={styles.tableTh}><span className={styles.skeletonLine} style={{ width: 120, height: 12 }} /></th>
                        <th className={styles.tableTh}><span className={styles.skeletonLine} style={{ width: 120, height: 12 }} /></th>
                        <th className={styles.tableTh}><span className={styles.skeletonLine} style={{ width: 90, height: 12 }} /></th>
                        <th className={styles.tableTh}><span className={styles.skeletonLine} style={{ width: 50, height: 12 }} /></th>
                        <th className={styles.tableTh}><span className={styles.skeletonLine} style={{ width: 50, height: 12 }} /></th>
                        <th className={styles.tableTh}><span className={styles.skeletonLine} style={{ width: 70, height: 12 }} /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <tr key={i} className={styles.skeletonRow}>
                          <td><span className={styles.skeletonLine} style={{ width: "90%", height: 14 }} /></td>
                          <td><span className={styles.skeletonLine} style={{ width: 64, height: 14 }} /></td>
                          <td><span className={styles.skeletonLine} style={{ width: 64, height: 14 }} /></td>
                          <td><span className={styles.skeletonLine} style={{ width: 56, height: 14 }} /></td>
                          <td><span className={styles.skeletonLine} style={{ width: 28, height: 14 }} /></td>
                          <td><span className={styles.skeletonLine} style={{ width: 28, height: 14 }} /></td>
                          <td><span className={styles.skeletonLine} style={{ width: 100, height: 14 }} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : (
        <>
        <section className={styles.batchSummary} aria-label="Upload summary">
          {uploadLoading && (
            <p className={styles.uploadSuccess}>
              <span className={styles.loadingSpinner} aria-hidden />
              <span className={styles.loadingMessage}>Processing…</span>
            </p>
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
                aria-label={`${reconciledInvoiceCount} invoices reconciled`}
              >
                {reconciledInvoiceCount}
              </div>
              <h2 className={styles.cardTitle}>
                invoice{reconciledInvoiceCount !== 1 ? "s" : ""} reconciled
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
                aria-label={`${attentionInvoiceCount} invoices have issues`}
              >
                {attentionInvoiceCount}
              </div>
              <h2 className={styles.cardTitle}>
                invoice{attentionInvoiceCount !== 1 ? "s" : ""} have issues
              </h2>
            </div>
          </div>
        </section>

        <section className={styles.totalsBar} aria-label="Reconciliation totals">
          <div className={styles.totalsBarHeader}>
            <div className={styles.latestLabel}>
              <span className={styles.latestDot} aria-hidden />
              Latest Upload —{" "}
              {statementCount} statement{statementCount !== 1 ? "s" : ""} processed
            </div>
            <time
              className={styles.dateTime}
              dateTime={
                dashboardData?.log?.createdAt
                  ? new Date(dashboardData.log.createdAt).toISOString()
                  : undefined
              }
            >
              {lastUploadDateTime ?? "No uploads yet"}
            </time>
          </div>
          <div className={styles.totalsRow}>
          {totals.map(({ label, value, valueClass }) => (
            <div key={label} className={styles.totalsCell}>
              <span className={styles.totalsLabel}>{label}</span>
              <span className={`${styles.totalsValue} ${valueClass}`}>
                {value}
              </span>
            </div>
          ))}
          <div className={`${styles.totalsCell} ${styles.totalsCellSync}`}>
            <span className={styles.totalsLabel}>Last synced with Xero</span>
            <span className={styles.syncNowWrap}>
              <span className={styles.totalsValue}>
                {(() => {
                  const sync = formatLastSynced(lastSyncedAt);
                  if (sync.text) return sync.text;
                  return (
                    <>&nbsp;
                      <span>{sync.num}</span>
                      <span className={styles.totalsValueUnit}>{sync.unit}</span>
                    </>
                  );
                })()}
              </span>
              <button
                type="button"
                className={styles.syncNowBtn}
                onClick={handleSyncNow}
                disabled={syncNowLoading}
              >
                {syncNowLoading ? "Syncing..." : "Refresh"}
              </button>
            </span>
          </div>
          </div>
        </section>

        <div className={styles.tabsContainer}>
          <nav
            className={styles.tabs}
            role="tablist"
            aria-label="Batch views"
            onKeyDown={(e) => {
              const tabs = ["latest", "attention", "reconciled", "statements"];
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
                setActiveTab("statements");
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
              <span className={styles.tabBadge}>{lastBatchInvoiceCount} invoices</span>
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
              Needs Your Attention
              <span className={styles.tabBadge}>{attentionInvoiceCount} invoices</span>
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
              <span className={styles.tabBadge}>{reconciledInvoiceCount} invoices</span>
            </button>
            <button
              type="button"
              role="tab"
              id="tab-statements"
              aria-selected={activeTab === "statements"}
              aria-controls="panel-statements"
              tabIndex={activeTab === "statements" ? 0 : -1}
              className={`${styles.tab} ${activeTab === "statements" ? styles.tabActive : ""}`}
              onClick={() => setActiveTab("statements")}
            >
              Statements
            </button>
          </nav>
          {activeTab === "attention" && (
            <button
              type="button"
              className={styles.tab2ExportBtn}
              onClick={exportTab2IssuesToExcel}
              disabled={exportTab2Loading || needsAttentionCount === 0}
              aria-label="Export all issues to Excel"
            >
              {exportTab2Loading ? "Exporting…" : "Export to Excel"}
            </button>
          )}
          {activeTab === "reconciled" && (
            <button
              type="button"
              className={styles.tab2ExportBtn}
              onClick={exportTab3ToExcel}
              disabled={exportTab3Loading || suppliersReconciled === 0}
              aria-label="Export all reconciled to Excel"
            >
              {exportTab3Loading ? "Exporting…" : "Export to Excel"}
            </button>
          )}
        </div>

        <div
          id={`panel-${activeTab}`}
          key={activeTab}
          className={styles.tabPanel}
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === "statements" ? (
            <section className={styles.tableSection} aria-label="Statements">
              {statementsLoading && (
                <div className={styles.statementsLoadingWrap} aria-busy aria-label="Loading statements">
                  <span className={styles.loadingSpinner} aria-hidden />
                  <span className={styles.loadingMessage}>Loading statements…</span>
                </div>
              )}
              {!statementsLoading && statementsError && (
                <p className={styles.statementsListMessage}>{statementsError}</p>
              )}
              {!statementsLoading && !statementsError && statementsBySupplier.length === 0 && (
                <p className={styles.statementsListMessage}>No statements with invoices.</p>
              )}
              {!statementsLoading && !statementsError && statementsBySupplier.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.supplierTable}>
                    <thead>
                      <tr>
                        <th className={styles.tableTh}>SUPPLIER NAME</th>
                        <th className={styles.tableTh}>STATEMENTS</th>
                        <th className={styles.tableTh}>INVOICES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statementsBySupplier.map(({ supplierName, contactId, statements }) => {
                        const totalInvoices = statements.reduce((sum, log) => sum + (log.total ?? 0), 0);
                        const expandKey = contactId || supplierName;
                        const isExpanded = expandedStatementSuppliers.has(expandKey);
                        return (
                          <Fragment key={expandKey}>
                            <tr
                              className={`${styles.tableRowExpandable} ${isExpanded ? styles.tableRowExpanded : ""}`}
                              onClick={() => toggleStatementSupplierExpanded(expandKey)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => e.key === "Enter" && toggleStatementSupplierExpanded(expandKey)}
                              aria-expanded={isExpanded}
                            >
                              <td className={styles.tableTd}>
                                <span className={`${styles.rowExpandIcon} ${isExpanded ? styles.rowExpandIconOpen : ""}`} aria-hidden>▶</span>
                                <span className={styles.supplierName} title={supplierName}>{supplierName}</span>
                              </td>
                              <td className={styles.tableTd}>{statements.length}</td>
                              <td className={styles.tableTd}>{totalInvoices}</td>
                            </tr>
                            {isExpanded && (
                              <tr className={styles.tableRowDetail}>
                                <td colSpan={3} className={styles.tableTdDetail}>
                                  <div className={styles.detailPanel}>
                                    <h3 className={styles.detailTitle}>Statements</h3>
                                    <div className={styles.detailTableWrap}>
                                      <table className={styles.detailTable}>
                                        <thead>
                                          <tr>
                                            <th className={styles.detailTh}>PROCESSED</th>
                                            <th className={styles.detailTh}>INVOICES</th>
                                            <th className={styles.detailTh}>VIEW PDF</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {statements.map((log) => {
                                            const isPdf = /\.pdf$/i.test(String(log?.file ?? ""));
                                            const invoiceCount = log.total ?? 0;
                                            return (
                                              <tr key={log._id}>
                                                <td className={styles.detailTd}>
                                                  {formatLogDateTime(log.addedAt) ?? "—"}
                                                </td>
                                                <td className={styles.detailTd}>{invoiceCount}</td>
                                                <td className={styles.detailTd}>
                                                  <a
                                                    href={`/file/${log._id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className={styles.statementsDownloadLink}
                                                    {...(isPdf ? {} : { download: true })}
                                                    onClick={(e) => e.stopPropagation()}
                                                  >
                                                    {isPdf ? "View PDF" : "Download file"}
                                                  </a>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
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
              )}
            </section>
          ) : (
          <section className={styles.tableSection} aria-label="Supplier table">
            <div className={styles.tableWrap}>
              <table className={styles.supplierTable}>
                <thead>
                  <tr>
                    {(activeTab === "reconciled"
                      ? [
                          ["supplier", "SUPPLIER NAME"],
                          ["amountGBP", "AMOUNT (SUPPLIER CURRENCY)"],
                          ["pairCount", "PAIRS"],
                          ["pairsOverdue", "PAIRS OVERDUE"],
                          ["status", "STATUS"],
                        ]
                      : activeTab === "latest"
                        ? [
                            ["supplier", "SUPPLIER NAME"],
                            ["theySay", "THEY SAY WE OWE (SUPPLIER CURRENCY)"],
                            ["xeroSays", "XERO SAYS WE OWE (SUPPLIER CURRENCY)"],
                            ["difference", "DIFFERENCE (SUPPLIER CURRENCY)"],
                            ["unpaid", "UNPAID"],
                            ["issues", "ISSUES"],
                            ["status", "STATUS"],
                          ]
                        : activeTab === "attention"
                          ? [
                              ["supplier", "SUPPLIER NAME"],
                              ["theySay", "THEY SAY WE OWE (SUPPLIER CURRENCY)"],
                              ["xeroSays", "XERO SAYS WE OWE (SUPPLIER CURRENCY)"],
                              ["difference", "DIFFERENCE (SUPPLIER CURRENCY)"],
                              ["unpaid", "UNPAID"],
                              ["issues", "ISSUES"],
                              ["status", "STATUS"],
                            ]
                        : [
                            ["supplier", "SUPPLIER NAME"],
                            ["theySay", "THEY SAY WE OWE (£)"],
                            ["xeroSays", "XERO SAYS WE OWE (£)"],
                            ["difference", "DIFFERENCE (£)"],
                            ["unpaid", "UNPAID"],
                            ["issues", "ISSUES"],
                            ["status", "STATUS"],
                          ]
                    ).map(([key, label]) => (
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
                    {(activeTab === "attention" || activeTab === "reconciled") && (
                      <th key="export" className={styles.tableTh} style={{ width: 52 }}>
                        Export
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paginatedTableData.map((row, i) => {
                    const diff = row.difference ?? row.xeroSays - row.theySay;
                    const rowSupplierCurrency = (row.supplierCurrency && String(row.supplierCurrency).toUpperCase()) || "GBP";
                    const showSupplierCurrencyTotals = activeTab === "latest" || activeTab === "attention";
                    const diffFormatted = diff >= 0
                      ? (showSupplierCurrencyTotals ? formatCurrencyTableAmount(rowSupplierCurrency, diff) : formatTableAmount(diff))
                      : (showSupplierCurrencyTotals ? `-${formatCurrencyTableAmount(rowSupplierCurrency, -diff)}` : `-${formatTableAmount(-diff)}`);
                    const statusClass =
                      activeTab === "attention"
                        ? styles.statusActionNeeded
                        : row.status === "Reconciled" || row.status === "Contacted"
                        ? styles.statusReconciled
                        : row.status === "No action needed"
                          ? styles.statusNoActionNeeded
                          : row.status === "Action Needed" || row.status === "Unpaid"
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
                    const tab3Pairs = activeTab === "reconciled" ? (row.pairs || []) : [];
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    const tab3OverdueCount =
                      activeTab === "reconciled"
                        ? (row.pairsOverdue ?? tab3Pairs.filter((p) => {
                            const d = p.fileInvoice?.dueDate || p.fileInvoice?.date || p.xeroInvoice?.dueDate || p.xeroInvoice?.date;
                            if (!d) return false;
                            const due = new Date(d);
                            due.setHours(0, 0, 0, 0);
                            return due.getTime() < todayStart.getTime();
                          }).length)
                        : 0;
                    const reconciledDetailInvoices =
                      activeTab === "reconciled"
                        ? tab3Pairs.map((p) => {
                            const fa = p.fileAmountGBP != null ? p.fileAmountGBP : (Number(p.fileInvoice?.amount) ?? 0);
                            const xa = p.xeroAmountGBP != null ? p.xeroAmountGBP : (Number(p.xeroInvoice?.amount) ?? 0);
                            const diff = p.differenceGBP != null ? p.differenceGBP : 0;
                            const date = p.fileInvoice?.dueDate || p.fileInvoice?.date || p.xeroInvoice?.dueDate || p.xeroInvoice?.date;
                            const dateStr = date ? new Date(date).toLocaleDateString("en-GB") : "–";
                            const fileCur = (p.fileInvoice?.currency && String(p.fileInvoice.currency).toUpperCase()) || "GBP";
                            const xeroCur = (p.xeroInvoice?.currency && String(p.xeroInvoice.currency).toUpperCase()) || "GBP";
                            const sameCur = fileCur === xeroCur;
                            const diffOrig = sameCur && p.fileInvoice?.amount != null && p.xeroInvoice?.amount != null
                              ? Math.round((Number(p.xeroInvoice.amount) - Number(p.fileInvoice.amount)) * 100) / 100
                              : null;
                            return {
                              deleteInvoiceId: p.fileInvoice?._id ? String(p.fileInvoice._id) : null,
                              invoiceNumber: p.fileInvoice?.invoiceNumber || p.xeroInvoice?.invoiceNumber || "—",
                              date: dateStr,
                              currency: p.fileInvoice?.currency ?? p.xeroInvoice?.currency ?? "GBP",
                              supplierAmountOriginal: p.fileInvoice?.amount != null ? Number(p.fileInvoice.amount) : null,
                              supplierCurrencyOriginal: p.fileInvoice?.currency ?? "GBP",
                              xeroAmountOriginal: p.xeroInvoice?.amount != null ? Number(p.xeroInvoice.amount) : null,
                              xeroCurrencyOriginal: p.xeroInvoice?.currency ?? "GBP",
                              differenceOriginal: diffOrig,
                              differenceOriginalCurrency: diffOrig != null ? (p.fileInvoice?.currency ?? "GBP") : null,
                              issue: "Matched",
                              supplierAmt: fa,
                              xeroAmt: xa,
                              difference: diff,
                            };
                          })
                        : [];
                    const attentionDetailInvoices =
                      activeTab === "attention"
                        ? [
                            ...(tab2Pairs || []).map((p) => {
                              const fa = p.fileAmountGBP != null ? p.fileAmountGBP : (Number(p.fileInvoice?.amount) ?? 0);
                              const xa = p.xeroAmountGBP != null ? p.xeroAmountGBP : (Number(p.xeroInvoice?.amount) ?? 0);
                              const date = p.xeroInvoice?.dueDate || p.xeroInvoice?.date || p.fileInvoice?.dueDate || p.fileInvoice?.date;
                              const dateStr = date ? new Date(date).toLocaleDateString("en-GB") : "–";
                              const fileCur = (p.fileInvoice?.currency && String(p.fileInvoice.currency).toUpperCase()) || "GBP";
                              const xeroCur = (p.xeroInvoice?.currency && String(p.xeroInvoice.currency).toUpperCase()) || "GBP";
                              const sameCur = fileCur === xeroCur;
                              const diffOrig = sameCur && p.fileInvoice?.amount != null && p.xeroInvoice?.amount != null
                                ? Math.round((Number(p.xeroInvoice.amount) - Number(p.fileInvoice.amount)) * 100) / 100
                                : null;
                              return {
                                deleteInvoiceId: p.fileInvoice?._id ? String(p.fileInvoice._id) : null,
                                invoiceNumber: p.fileInvoice?.invoiceNumber || p.xeroInvoice?.invoiceNumber || "—",
                                date: dateStr,
                                currency: p.fileInvoice?.currency ?? p.xeroInvoice?.currency ?? "GBP",
                                supplierAmountOriginal: p.fileInvoice?.amount != null ? Number(p.fileInvoice.amount) : null,
                                supplierCurrencyOriginal: p.fileInvoice?.currency ?? "GBP",
                                xeroAmountOriginal: p.xeroInvoice?.amount != null ? Number(p.xeroInvoice.amount) : null,
                                xeroCurrencyOriginal: p.xeroInvoice?.currency ?? "GBP",
                                differenceOriginal: diffOrig,
                                differenceOriginalCurrency: diffOrig != null ? (p.fileInvoice?.currency ?? "GBP") : null,
                                issue: "AMOUNT MISMATCH",
                                supplierAmt: fa,
                                xeroAmt: xa,
                                difference: xa - fa,
                                status: "Unpaid",
                              };
                            }),
                            ...(tab2Unpaired || []).map((u) => {
                              const amt = u.amountGBP != null ? u.amountGBP : (Number(u.amount) || 0);
                              const dateStr = (u.dueDate || u.date) ? new Date(u.dueDate || u.date).toLocaleDateString("en-GB") : "–";
                              const origAmt = u.amount != null ? Number(u.amount) : null;
                              return {
                                deleteInvoiceId: u._id ? String(u._id) : null,
                                invoiceNumber: u.invoiceNumber || "—",
                                date: dateStr,
                                currency: u.currency ?? "GBP",
                                supplierAmountOriginal: u.supplierAmountOriginal ?? (u.fromXero ? null : origAmt),
                                supplierCurrencyOriginal: u.supplierCurrencyOriginal ?? (u.fromXero ? null : (u.currency ?? "GBP")),
                                xeroAmountOriginal: u.xeroAmountOriginal ?? (u.fromXero ? origAmt : null),
                                xeroCurrencyOriginal: u.xeroCurrencyOriginal ?? (u.fromXero ? (u.currency ?? "GBP") : null),
                                differenceOriginal: null,
                                differenceOriginalCurrency: null,
                                issue: u.fromXero ? "MISSING FROM FILE" : "MISSING FROM XERO",
                                supplierAmt: u.fromXero ? null : amt,
                                xeroAmt: u.fromXero ? amt : null,
                                difference: amt,
                                status: "Unpaid",
                              };
                            }),
                          ]
                        : [];
                    const detailRows =
                      activeTab === "reconciled"
                        ? reconciledDetailInvoices
                        : activeTab === "attention"
                          ? attentionDetailInvoices
                          : activeTab === "latest"
                            ? viewAllInvoices
                            : viewAllShownForRow.has(rowKey)
                              ? viewAllInvoices
                              : detailInvoices;
                    const detailRowsFiltered =
                      activeTab === "latest" && hidePaidAndMatchedInTab1
                        ? detailRows.filter((inv) => inv.issue !== "paid" && inv.issue !== "Matched" && inv.status !== "Paid")
                        : detailRows;
                    const sortedDetailRows = sortDetailRows(detailRowsFiltered, detailTableSort.column, detailTableSort.dir);
                    const detailColumns = [
                      ["invoiceNumber", "INVOICE #"],
                      ["date", "DATE"],
                      ["issue", "ISSUE"],
                      ["supplierAmt", "SUPPLIER AMT"],
                      ["xeroAmt", "XERO AMT"],
                      ["difference", "DIFFERENCE"],
                      ["status", "STATUS"],
                      ["delete", ""],
                    ];
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
                          <td className={`${styles.tableTd} ${styles.tableTdSupplier}`}>
                            <span className={`${styles.rowExpandIcon} ${isExpanded ? styles.rowExpandIconOpen : ""}`} aria-hidden>▶</span>
                            <span className={styles.supplierName} title={row.supplier}>{row.supplier}</span>
                          </td>
                          {activeTab === "reconciled" ? (
                            <>
                              <td className={styles.tableTd}>
                                {formatCurrencyTableAmount(rowSupplierCurrency, row.amountGBP ?? row.theySay)}
                              </td>
                              <td className={styles.tableTd}>{row.pairCount ?? row.unpaid}</td>
                              <td className={styles.tableTd}>{row.pairsOverdue ?? 0}</td>
                            </>
                          ) : (
                            <>
                              <td className={styles.tableTd}>
                                {showSupplierCurrencyTotals
                                  ? formatCurrencyTableAmount(rowSupplierCurrency, row.theySay)
                                  : formatTableAmount(row.theySay)}
                              </td>
                              <td className={styles.tableTd}>
                                {showSupplierCurrencyTotals
                                  ? formatCurrencyTableAmount(rowSupplierCurrency, row.xeroSays)
                                  : formatTableAmount(row.xeroSays)}
                              </td>
                              <td className={styles.tableTd}>
                                <span className={diff < 0 ? styles.diffNegative : styles.diffPositive}>
                                  {diffFormatted}
                                </span>
                              </td>
                              <td className={styles.tableTd}>{row.unpaid}</td>
                            </>
                          )}
                          {activeTab !== "reconciled" && (
                            <td className={styles.tableTd}>
                              <span className={styles.issuesBadge}>{row.issues}</span>
                            </td>
                          )}
                          <td className={styles.tableTd}>
                            {(activeTab === "latest" || activeTab === "attention") &&
                            row.statusIssueCounts &&
                            ((row.statusIssueCounts.amountMismatch ?? 0) > 0 ||
                              (row.statusIssueCounts.missingFromXero ?? 0) > 0 ||
                              (row.statusIssueCounts.missingFromFile ?? 0) > 0) ? (
                              <span
                                className={styles.statusIssueDots}
                                aria-label={`Amount mismatch: ${row.statusIssueCounts.amountMismatch ?? 0}, Missing from Xero: ${row.statusIssueCounts.missingFromXero ?? 0}, Missing from file: ${row.statusIssueCounts.missingFromFile ?? 0}`}
                              >
                                {(row.statusIssueCounts.amountMismatch ?? 0) > 0 && (
                                  <span
                                    className={styles.statusIssueDotWrap}
                                    data-tooltip={`Amount mismatch (${row.statusIssueCounts.amountMismatch})`}
                                    tabIndex={0}
                                    aria-label="Amount mismatch"
                                  >
                                    <span className={`${styles.statusIssueDot} ${styles.statusIssueDotMismatch}`} aria-hidden>
                                      {row.statusIssueCounts.amountMismatch}
                                    </span>
                                  </span>
                                )}
                                {(row.statusIssueCounts.missingFromXero ?? 0) > 0 && (
                                  <span
                                    className={styles.statusIssueDotWrap}
                                    data-tooltip={`Missing from Xero (${row.statusIssueCounts.missingFromXero})`}
                                    tabIndex={0}
                                    aria-label="Missing from Xero"
                                  >
                                    <span className={`${styles.statusIssueDot} ${styles.statusIssueDotMissingXero}`} aria-hidden>
                                      {row.statusIssueCounts.missingFromXero}
                                    </span>
                                  </span>
                                )}
                                {(row.statusIssueCounts.missingFromFile ?? 0) > 0 && (
                                  <span
                                    className={styles.statusIssueDotWrap}
                                    data-tooltip={`Missing from file (${row.statusIssueCounts.missingFromFile})`}
                                    tabIndex={0}
                                    aria-label="Missing from file"
                                  >
                                    <span className={`${styles.statusIssueDot} ${styles.statusIssueDotMissingFile}`} aria-hidden>
                                      {row.statusIssueCounts.missingFromFile}
                                    </span>
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className={`${styles.statusBadge} ${statusClass}`}>
                                <span className={styles.statusDot} aria-hidden />
                                {row.status}
                              </span>
                            )}
                          </td>
                          {activeTab === "attention" && (
                            <td className={styles.tableTd} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={styles.exportRowBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportSingleSupplierToExcel(row);
                                }}
                                disabled={exportingSupplierKey === rowKey || (row.issues ?? 0) === 0}
                                aria-label={`Export ${row.supplier} to Excel`}
                                title="Export to Excel"
                              >
                                {exportingSupplierKey === rowKey ? (
                                  <span className={styles.exportRowBtnSpinner} aria-hidden />
                                ) : (
                                  <svg className={styles.exportRowIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                )}
                              </button>
                            </td>
                          )}
                          {activeTab === "reconciled" && (
                            <td className={styles.tableTd} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={styles.exportRowBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportSingleSupplierTab3ToExcel(row);
                                }}
                                disabled={exportingSupplierKey === rowKey || (row.pairCount ?? row.unpaid ?? 0) === 0}
                                aria-label={`Export ${row.supplier} to Excel`}
                                title="Export to Excel"
                              >
                                {exportingSupplierKey === rowKey ? (
                                  <span className={styles.exportRowBtnSpinner} aria-hidden />
                                ) : (
                                  <svg className={styles.exportRowIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                  </svg>
                                )}
                              </button>
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr className={styles.tableRowDetail}>
                            <td colSpan={activeTab === "reconciled" ? 6 : activeTab === "attention" ? 8 : 7} className={styles.tableTdDetail}>
                              {activeTab === "reconciled" ? (
                                <div className={styles.reconciledExpanded}>
                                  <div className={styles.reconciledCard}>
                                    <div className={styles.reconciledCardLeft}>
                                      <h3 className={styles.reconciledCardSupplier}>{row.supplier}</h3>
                                      <p className={styles.reconciledCardSummary}>
                                        Total owed (one per pair): <strong>{formatCurrencyTableAmount(rowSupplierCurrency, row.amountGBP ?? row.theySay)}</strong>
                                        {" · "}
                                        <strong>{row.pairCount ?? row.unpaid} invoices</strong>
                                        {tab3OverdueCount > 0 && (
                                          <>
                                            {" · "}
                                            <span className={styles.reconciledCardOverdue}>
                                              <strong>{tab3OverdueCount} overdue</strong>
                                            </span>
                                          </>
                                        )}
                                      </p>
                                    </div>
                                    <div className={styles.reconciledCardActions}>
                                      <button
                                        type="button"
                                        className={styles.reconciledCardGenerateBtn}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setPaymentSuggestionNotifyRow(rowKey);
                                          setTimeout(() => setPaymentSuggestionNotifyRow(null), 4000);
                                        }}
                                        aria-label="Generate payment suggestion"
                                      >
                                        Generate Payment Suggestion
                                      </button>
                                      <button
                                        type="button"
                                        className={styles.reconciledCardCloseBtn}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          closeExpanded(rowKey);
                                        }}
                                        aria-label="Close"
                                      >
                                        ×
                                      </button>
                                    </div>
                                    {paymentSuggestionNotifyRow === rowKey && (
                                      <p className={styles.reconciledCardNotify} role="status">
                                        Generate Payment Suggestion is in development and will be available soon.
                                      </p>
                                    )}
                                  </div>
                                  {reconciledDetailInvoices.length > 0 && (() => {
                                    const tab3RowHasSelection = reconciledDetailInvoices.some((_, j) =>
                                      tab3SelectedIds.has(`${rowKey}-${j}`)
                                    );
                                    const selectedIndices = reconciledDetailInvoices
                                      .map((_, j) => (tab3SelectedIds.has(`${rowKey}-${j}`) ? j : null))
                                      .filter((j) => j !== null);
                                    const actionsBar = (
                                      <div className={styles.reconciledActionsBar}>
                                        <span className={styles.reconciledActionsLabel}>Actions:</span>
                                        <button
                                          type="button"
                                          className={styles.reconciledActionBtn}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            fireConfettiFromElement(e.currentTarget);
                                            handleMarkPaid(row, selectedIndices, rowKey);
                                          }}
                                          aria-label="Mark selected as paid"
                                        >
                                          Paid
                                        </button>
                                      </div>
                                    );
                                    return (
                                      <>
                                        {tab3RowHasSelection && actionsBar}
                                        <div className={styles.reconciledTableWrap}>
                                          <div className={styles.detailTableWrap}>
                                            <table className={styles.detailTable}>
                                              <thead>
                                                <tr>
                                                  <th className={styles.detailTh} style={{ width: 44 }}>
                                                    <label className={styles.reconciledCheckboxLabel}>
                                                      <input
                                                        type="checkbox"
                                                        checked={
                                                          reconciledDetailInvoices.length > 0 &&
                                                          reconciledDetailInvoices.every((_, j) =>
                                                            tab3SelectedIds.has(`${rowKey}-${j}`)
                                                          )
                                                        }
                                                        onChange={(e) => {
                                                          e.stopPropagation();
                                                          const ids = reconciledDetailInvoices.map((_, j) => `${rowKey}-${j}`);
                                                          toggleTab3SelectAllForRow(rowKey, ids);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        aria-label="Select all invoices"
                                                      />
                                                    </label>
                                                  </th>
                                                  <th className={styles.detailTh}>INVOICE #</th>
                                                  <th className={styles.detailTh}>DATE</th>
                                                  <th className={styles.detailTh}>AMOUNT</th>
                                                  <th className={styles.detailTh} style={{ width: 80 }} />
                                                  <th className={styles.detailTh} style={{ width: 44 }} />
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {reconciledDetailInvoices.map((inv, j) => {
                                                  const invId = `${rowKey}-${j}`;
                                                  const delId = inv.deleteInvoiceId ?? inv._id;
                                                  return (
                                                    <tr key={inv.invoiceNumber ? `${inv.invoiceNumber}-${j}` : j}>
                                                      <td className={styles.detailTd} onClick={(e) => e.stopPropagation()}>
                                                        <label className={styles.reconciledCheckboxLabel}>
                                                          <input
                                                            type="checkbox"
                                                            checked={tab3SelectedIds.has(invId)}
                                                            onChange={() => toggleTab3InvoiceSelection(invId)}
                                                            onClick={(e) => e.stopPropagation()}
                                                            aria-label={`Select invoice ${inv.invoiceNumber || j + 1}`}
                                                          />
                                                        </label>
                                                      </td>
                                                      <td className={styles.detailTd}>{inv.invoiceNumber}</td>
                                                      <td className={styles.detailTd}>{inv.date || "–"}</td>
                                                      <td className={styles.detailTd}>
                                                        <span className={styles.supplierOrigAmtCell}>
                                                          <span className={styles.supplierOrigAmtCurrency}>{inv.supplierCurrencyOriginal ?? inv.xeroCurrencyOriginal ?? inv.currency ?? "–"}</span>
                                                          <span className={styles.supplierOrigAmtAmount}>
                                                            {inv.supplierAmountOriginal != null ? formatTableAmount(inv.supplierAmountOriginal) : inv.xeroAmountOriginal != null ? formatTableAmount(inv.xeroAmountOriginal) : inv.supplierAmt != null ? formatTableAmount(inv.supplierAmt) : inv.xeroAmt != null ? formatTableAmount(inv.xeroAmt) : "–"}
                                                          </span>
                                                        </span>
                                                      </td>
                                                      <td className={styles.detailTd} onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                          type="button"
                                                          className={styles.reconciledActionBtnRow}
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            fireConfettiFromElement(e.currentTarget);
                                                            handleMarkPaid(row, [j], rowKey);
                                                          }}
                                                          aria-label={`Mark invoice ${inv.invoiceNumber || j + 1} as paid`}
                                                        >
                                                          Paid
                                                        </button>
                                                      </td>
                                                      <td className={styles.detailTd} onClick={(e) => e.stopPropagation()}>
                                                        {delId ? (
                                                          <button
                                                            type="button"
                                                            className={styles.detailDeleteBtn}
                                                            onClick={(e) => {
                                                              e.stopPropagation();
                                                            handleHardDeleteInvoice(delId);
                                                            }}
                                                            disabled={deletingInvoiceId === delId}
                                                            aria-label={`Delete invoice ${inv.invoiceNumber || j + 1}`}
                                                            title="Delete (file invoice only)"
                                                          >
                                                            {deletingInvoiceId === delId ? (
                                                              <span className={styles.detailDeleteSpinner} aria-hidden />
                                                            ) : (
                                                              <svg className={styles.detailDeleteIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                                                <polyline points="3 6 5 6 21 6" />
                                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                                <line x1="10" y1="11" x2="10" y2="17" />
                                                                <line x1="14" y1="11" x2="14" y2="17" />
                                                              </svg>
                                                            )}
                                                          </button>
                                                        ) : null}
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                        {tab3RowHasSelection && actionsBar}
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : (
                              <div className={styles.detailPanel}>
                                <div className={styles.detailHeader}>
                                  <h3 className={styles.detailTitle}>
                                    {activeTab === "latest"
                                      ? (() => {
                                          const paid = row.paidCount ?? 0;
                                          const unpaid = row.unpaid ?? 0;
                                          if (paid === 0 && unpaid === 0) return "No invoices";
                                          if (paid === 0) return `${unpaid} Unpaid invoice${unpaid !== 1 ? "s" : ""} from supplier`;
                                          if (unpaid === 0) return `${paid} Paid invoice${paid !== 1 ? "s" : ""} from supplier`;
                                          return `${paid} paid and ${unpaid} unpaid invoice${(paid + unpaid) !== 1 ? "s" : ""} from supplier`;
                                        })()
                                      : viewAllShownForRow.has(rowKey)
                                        ? (() => {
                                            const paid = row.paidCount ?? 0;
                                            const unpaid = row.unpaid ?? 0;
                                            if (paid === 0 && unpaid === 0) return "No invoices";
                                            if (paid === 0) return `${unpaid} Unpaid invoices from supplier`;
                                            if (unpaid === 0) return `${paid} Paid invoices from supplier`;
                                            return `${paid} paid and ${unpaid} unpaid invoice${(paid + unpaid) !== 1 ? "s" : ""} from supplier`;
                                          })()
                                        : latestNoIssues
                                          ? "No issues here"
                                          : "Invoices need attention"}
                                  </h3>
                                  {activeTab === "attention" && (
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
                                    {activeTab === "latest" && (
                                      <button
                                        type="button"
                                        className={hidePaidAndMatchedInTab1 ? styles.tab1HideToggleActive : styles.tab1HideToggle}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setHidePaidAndMatchedInTab1((v) => !v);
                                        }}
                                        aria-pressed={hidePaidAndMatchedInTab1}
                                        aria-label={hidePaidAndMatchedInTab1 ? "Show paid and matched" : "Hide paid and matched"}
                                      >
                                        {hidePaidAndMatchedInTab1 ? "Show paid & matched" : "Hide paid & matched"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className={styles.detailEmailBtn}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEmailModalRow(row);
                                      }}
                                      aria-label="Email supplier"
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
                                {activeTab === "latest" && hidePaidAndMatchedInTab1 && detailRows.length > 0 && sortedDetailRows.length === 0 && (
                                  <p className={styles.detailNoUnpaid}>All invoices here are paid or matched.</p>
                                )}
                                {detailRows.length > 0 && (
                                <div className={styles.detailTableWrap}>
                                  <table className={styles.detailTable}>
                                    <thead>
                                      <tr>
                                        {detailColumns.map(([key, label]) => (
                                          <th
                                            key={key}
                                            className={key === "delete" ? styles.detailTh : `${styles.detailTh} ${styles.detailThSortable}`}
                                            onClick={key === "delete" ? undefined : (e) => { e.stopPropagation(); handleDetailSort(key); }}
                                            onKeyDown={key === "delete" ? undefined : (e) => { if (e.key === "Enter") { e.stopPropagation(); handleDetailSort(key); } }}
                                            role="columnheader"
                                            tabIndex={key === "delete" ? -1 : 0}
                                            aria-sort={key === "delete" ? undefined : (detailTableSort.column === key ? (detailTableSort.dir === "asc" ? "ascending" : "descending") : undefined)}
                                          >
                                            {label}
                                            {key !== "delete" && detailTableSort.column === key && (
                                              <span className={styles.detailSortIcon} aria-hidden>
                                                {detailTableSort.dir === "asc" ? " ↑" : " ↓"}
                                              </span>
                                            )}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sortedDetailRows.map((inv, j) => {
                                        const isPaid = inv.status === "Paid" || inv.issue === "paid";
                                        return (
                                        <tr key={inv.invoiceNumber ? `${inv.invoiceNumber}-${j}` : j} className={isPaid ? styles.detailRowPaid : undefined}>
                                          <td className={styles.detailTd}>{inv.invoiceNumber}</td>
                                          <td className={styles.detailTd}>{inv.date || "–"}</td>
                                          <td className={styles.detailTd}>
                                            {inv.issue === "paid" ? (
                                              <span className={styles.issuePillPaid}>paid</span>
                                            ) : inv.issue === "Matched" ? (
                                              <span className={styles.issuePillMatched}>Matched</span>
                                            ) : inv.issue === "AMOUNT MISMATCH" ? (
                                              <span className={styles.issuePillMismatch}>{inv.issue}</span>
                                            ) : inv.issue === "MISSING FROM XERO" ? (
                                              <span className={styles.issuePillMissingFromXero}>{inv.issue}</span>
                                            ) : inv.issue === "MISSING FROM FILE" ? (
                                              <span className={styles.issuePillMissingFromFile}>{inv.issue}</span>
                                            ) : (
                                              <span className={styles.issuePillMissing}>{inv.issue}</span>
                                            )}
                                          </td>
                                          <td className={styles.detailTd}>
                                            <span className={styles.supplierOrigAmtCell}>
                                              <span className={styles.supplierOrigAmtCurrency}>{inv.supplierCurrencyOriginal ?? inv.currency ?? "–"}</span>
                                              <span className={styles.supplierOrigAmtAmount}>{inv.supplierAmountOriginal != null ? formatTableAmount(inv.supplierAmountOriginal) : inv.supplierAmt != null ? formatTableAmount(inv.supplierAmt) : "–"}</span>
                                            </span>
                                          </td>
                                          <td className={styles.detailTd}>
                                            <span className={styles.supplierOrigAmtCell}>
                                              <span className={styles.supplierOrigAmtCurrency}>
                                                {activeTab === "latest" && inv.xeroAmountOriginal == null && inv.xeroAmt == null
                                                  ? (inv.supplierCurrencyOriginal ?? inv.currency ?? "–")
                                                  : (inv.xeroCurrencyOriginal ?? inv.currency ?? "–")}
                                              </span>
                                              <span className={styles.supplierOrigAmtAmount}>{inv.xeroAmountOriginal != null ? formatTableAmount(inv.xeroAmountOriginal) : inv.xeroAmt != null ? formatTableAmount(inv.xeroAmt) : "–"}</span>
                                            </span>
                                          </td>
                                          <td className={styles.detailTd}>
                                            {isPaid ? (
                                              <span className={styles.diffNeutral}>–</span>
                                            ) : inv.issue === "Matched" ? (
                                              <span className={styles.diffNeutral}>0.00</span>
                                            ) : inv.differenceOriginal != null ? (
                                              <span className={styles.supplierOrigAmtCell}>
                                                <span className={styles.supplierOrigAmtCurrency}>{inv.differenceOriginalCurrency ?? "–"}</span>
                                                <span className={styles.diffNegative}>{formatTableAmount(inv.differenceOriginal)}</span>
                                              </span>
                                            ) : (
                                              <span className={styles.supplierOrigAmtCell}>
                                                <span className={styles.supplierOrigAmtCurrency}>
                                                  {inv.supplierCurrencyOriginal ?? inv.xeroCurrencyOriginal ?? inv.currency ?? "GBP"}
                                                </span>
                                                <span className={styles.diffNegative}>{formatTableAmount(inv.difference)}</span>
                                              </span>
                                            )}
                                          </td>
                                          <td className={styles.detailTd}>{inv.status ?? "–"}</td>
                                          <td className={styles.detailTd} onClick={(e) => e.stopPropagation()}>
                                            {(inv.deleteInvoiceId ?? inv._id) ? (
                                              <button
                                                type="button"
                                                className={styles.detailDeleteBtn}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleHardDeleteInvoice(inv.deleteInvoiceId ?? inv._id);
                                                }}
                                                disabled={deletingInvoiceId === (inv.deleteInvoiceId ?? inv._id)}
                                                aria-label={`Delete invoice ${inv.invoiceNumber || "row"}`}
                                                title="Delete invoice"
                                              >
                                                {deletingInvoiceId === (inv.deleteInvoiceId ?? inv._id) ? (
                                                  <span className={styles.detailDeleteSpinner} aria-hidden />
                                                ) : (
                                                  <svg className={styles.detailDeleteIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                    <line x1="10" y1="11" x2="10" y2="17" />
                                                    <line x1="14" y1="11" x2="14" y2="17" />
                                                  </svg>
                                                )}
                                              </button>
                                            ) : null}
                                          </td>
                                        </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                                )}
                              </div>
                              )}
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
          )}
        </div>
        </>
        )}
      </div>

      {currentManualSupplierItem != null && manualSupplierVisible && (
        <div
          className={styles.manualSupplierOverlay}
          onClick={() => {
            if (!manualSupplierSubmitting) handleManualSupplierCancel();
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-supplier-title"
        >
          <div
            className={styles.manualSupplierBox}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="manual-supplier-title" className={styles.manualSupplierTitle}>
              Enter supplier name
            </h2>
            <p className={styles.manualSupplierText}>
              We could not confidently identify a supplier for{" "}
              <strong>{currentManualSupplierItem.fileName || currentManualSupplierItem.unresolvedUpload?.fileName || "this file"}</strong>.
            </p>
            {Array.isArray(currentManualSupplierItem.candidateSuppliers) &&
              currentManualSupplierItem.candidateSuppliers.length > 0 && (
                <p className={styles.manualSupplierHint}>
                  Possible matches:{" "}
                  {currentManualSupplierItem.candidateSuppliers
                    .slice(0, 3)
                    .map((s) => s.name)
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}
            <label className={styles.manualSupplierInputLabel} htmlFor="manual-supplier-input">
              Supplier name
            </label>
            <input
              id="manual-supplier-input"
              type="text"
              value={manualSupplierInput}
              onChange={(e) => setManualSupplierInput(e.target.value)}
              placeholder="e.g. Acme Ltd"
              className={styles.manualSupplierInput}
              disabled={manualSupplierSubmitting}
              autoFocus
            />
            {manualSupplierError && (
              <p className={styles.uploadError} role="alert">
                {manualSupplierError}
              </p>
            )}
            <div className={styles.manualSupplierActions}>
              <button
                type="button"
                className={styles.manualSupplierPrimary}
                onClick={handleManualSupplierContinue}
                disabled={manualSupplierSubmitting}
              >
                {manualSupplierSubmitting ? "Continuing..." : "Continue"}
              </button>
              <button
                type="button"
                className={styles.manualSupplierSecondary}
                onClick={handleManualSupplierSkip}
                disabled={manualSupplierSubmitting}
              >
                Skip file
              </button>
              <button
                type="button"
                className={styles.manualSupplierSecondary}
                onClick={handleManualSupplierCancel}
                disabled={manualSupplierSubmitting}
              >
                Cancel
              </button>
            </div>
            <p className={styles.manualSupplierQueueInfo}>
              {manualSupplierQueue.length} unresolved file{manualSupplierQueue.length !== 1 ? "s" : ""} remaining
            </p>
          </div>
        </div>
      )}

      {tab3PaidToast.visible && (
        <div className={styles.paidToast} role="status" aria-live="polite">
          <span className={styles.paidToastMessage}>{tab3PaidToast.message}</span>
          <button
            type="button"
            className={styles.paidToastUndo}
            onClick={handleUndoPaid}
            aria-label="Undo mark as paid"
          >
            Undo
          </button>
        </div>
      )}
      {emailModalRow != null && (
        <div
          className={styles.emailModalOverlay}
          onClick={() => setEmailModalRow(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-modal-title"
        >
          <div
            className={styles.emailModalBox}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="email-modal-title" className={styles.emailModalTitle}>Email supplier</h2>
            <div className={styles.emailModalField}>
              <label className={styles.emailModalLabel}>To</label>
              <div className={styles.emailModalValue}>
                {String(emailModalRow.supplier || "").toLowerCase().replace(/\s+/g, ".")}@supplier.example.com
              </div>
            </div>
            <div className={styles.emailModalField}>
              <label className={styles.emailModalLabel}>Subject</label>
              <div className={styles.emailModalValue}>
                Invoice query – {emailModalRow.supplier || "Supplier"}
              </div>
            </div>
            <div className={styles.emailModalField}>
              <label className={styles.emailModalLabel}>Body</label>
              <div className={styles.emailModalBody}>
                Dear {emailModalRow.supplier || "Supplier"},
                {"\n\n"}
                Please find our query regarding the recent invoices. Could you confirm the details at your earliest convenience?
                {"\n\n"}
                Kind regards
              </div>
            </div>
            <button
              type="button"
              className={styles.emailModalClose}
              onClick={() => setEmailModalRow(null)}
              aria-label="Close"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
