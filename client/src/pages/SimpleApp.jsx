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

function getTab2UnpairedIssue(inv) {
  if (inv?.issueType) return String(inv.issueType).toUpperCase();
  if (inv?.fromXero === true) return "UNVERIFIED";
  return "MISSING FROM XERO";
}

function formatIssueForEmail(issue) {
  const normalized = String(issue || "").trim().toUpperCase();
  if (!normalized) return "Needs review";
  if (normalized === "AMOUNT MISMATCH") return "Amount mismatch";
  if (normalized === "MISSING FROM XERO") return "Missing from our record";
  if (normalized === "MISSING FROM FILE" || normalized === "UNVERIFIED") return "We never received an invoice from them";
  if (normalized === "OVERDUE") return "Overdue";
  if (normalized === "MATCHED") return "Reconciled";
  if (normalized === "PAID") return "Paid";
  return normalized
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatEmailAmount(currency, amount) {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  return formatCurrencyTableAmount(currency || "GBP", Number(amount));
}

function buildSupplierEmailDraft(row) {
  const supplierName = row?.supplier || "Supplier";
  const to = row?.supplierEmail || "";
  const subject = `Invoice query - ${supplierName}`;
  const selected = Array.isArray(row?.selectedInvoices) ? row.selectedInvoices : [];
  const normalizeCellText = (value) =>
    String(value ?? "-")
      .replace(/[\u00A0\u2000-\u200B]/g, " ")
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/\|/g, "/")
      .replace(/\s+/g, " ")
      .trim() || "-";
  const rows = selected.map((item) => ({
    invoice: normalizeCellText(item.invoiceNumber),
    problem: normalizeCellText(item.problem || "Needs review"),
    supplier: normalizeCellText(item.supplierAmount),
    ours: normalizeCellText(item.ourAmount),
    diff: normalizeCellText(item.difference),
  }));
  const tableHeader = "| Invoice # | Problem | Supplier record | Our record | Difference |";
  const tableDivider = "| --- | --- | --- | --- | --- |";
  const tableRows = rows.map(
    (item) =>
      `| ${item.invoice} | ${item.problem} | ${item.supplier} | ${item.ours} | ${item.diff} |`
  );
  const tableBlock =
    selected.length > 0
      ? `${tableHeader}\n${tableDivider}\n${tableRows.join("\n")}\n\n`
      : "";
  const body =
    `Dear ${supplierName},\n\n` +
    `Please review the invoice discrepancies listed below and confirm the correct records:\n\n` +
    tableBlock +
    `Please share any corrected invoice references or supporting details so we can reconcile quickly.\n\n` +
    `Kind regards,\n` +
    `Steve Accounting Team`;
  return { to, subject, body };
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
const TAB2_PAGE_SIZE = 50;

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];
const ALLOWED_EXT = [".pdf", ".xlsx", ".xls"];

function getInvoiceRecordId(record) {
  if (!record || typeof record !== "object") return null;
  return String(record._id ?? record.id ?? record.invoiceId ?? "").trim() || null;
}

function getPairKey(pair) {
  const fileId = getInvoiceRecordId(pair?.fileInvoice) ?? "none";
  const xeroId = getInvoiceRecordId(pair?.xeroInvoice) ?? "none";
  return `${fileId}::${xeroId}`;
}

function isPairOverdue(pair) {
  const rawDate =
    pair?.fileInvoice?.dueDate ||
    pair?.fileInvoice?.date ||
    pair?.xeroInvoice?.dueDate ||
    pair?.xeroInvoice?.date;
  if (!rawDate) return false;
  const due = new Date(rawDate);
  if (Number.isNaN(due.getTime())) return false;
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

function getPairAmount(pair) {
  const fileAmt = pair?.fileInvoice?.amount;
  if (fileAmt != null) {
    const parsed = Number(fileAmt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const xeroAmt = pair?.xeroInvoice?.amount;
  if (xeroAmt != null) {
    const parsed = Number(xeroAmt);
    if (Number.isFinite(parsed)) return parsed;
  }
  const fallback = Number(pair?.fileAmountGBP);
  return Number.isFinite(fallback) ? fallback : 0;
}

function removeInvoiceIdsFromDashboardData(prev, invoiceIds) {
  if (!prev || !Array.isArray(prev.supplierSummary) || invoiceIds.size === 0) return prev;
  let removedCount = 0;
  const supplierSummary = prev.supplierSummary.map((row) => {
    const invoicesViewAll = Array.isArray(row.invoicesViewAll)
      ? row.invoicesViewAll.filter((inv) => !invoiceIds.has(getInvoiceRecordId(inv)))
      : [];
    const invoicesNeedAttention = Array.isArray(row.invoicesNeedAttention)
      ? row.invoicesNeedAttention.filter((inv) => !invoiceIds.has(getInvoiceRecordId(inv)))
      : [];
    const removedFromRow = Math.max(0, (row.invoicesViewAll?.length ?? 0) - invoicesViewAll.length);
    removedCount += removedFromRow;
    return {
      ...row,
      invoicesViewAll,
      invoicesNeedAttention,
      unpaid: Math.max(0, Number(row.unpaid ?? invoicesViewAll.length) - removedFromRow),
      issues: invoicesNeedAttention.length,
    };
  });
  const nextInvoicesLength = Number(prev.invoicesLength);
  return {
    ...prev,
    supplierSummary,
    invoicesLength: Number.isFinite(nextInvoicesLength)
      ? Math.max(0, nextInvoicesLength - removedCount)
      : prev.invoicesLength,
  };
}

function removeInvoiceIdsFromTab2Data(prev, invoiceIds) {
  if (!prev || !Array.isArray(prev.bySupplier) || invoiceIds.size === 0) return prev;
  const bySupplier = prev.bySupplier
    .map((supplier) => {
      const invoices = (supplier.invoices || []).filter((inv) => !invoiceIds.has(getInvoiceRecordId(inv)));
      const unpairedInvoices = (supplier.unpairedInvoices || []).filter(
        (inv) => !invoiceIds.has(getInvoiceRecordId(inv))
      );
      const pairs = (supplier.pairs || []).filter((pair) => {
        const fileId = getInvoiceRecordId(pair?.fileInvoice);
        const xeroId = getInvoiceRecordId(pair?.xeroInvoice);
        return !(invoiceIds.has(fileId) || invoiceIds.has(xeroId));
      });
      const theySay = invoices
        .filter((inv) => inv?.fromXero === false)
        .reduce((sum, inv) => sum + (Number(inv?.amount) || 0), 0);
      const xeroSays = invoices
        .filter((inv) => inv?.fromXero === true)
        .reduce((sum, inv) => sum + (Number(inv?.amount) || 0), 0);
      return {
        ...supplier,
        invoices,
        unpairedInvoices,
        pairs,
        theySay,
        xeroSays,
        unpaid: invoices.length,
      };
    })
    .filter((supplier) => (supplier.invoices?.length ?? 0) > 0 || (supplier.pairs?.length ?? 0) > 0 || (supplier.unpairedInvoices?.length ?? 0) > 0);
  return { ...prev, bySupplier };
}

function removeInvoiceIdsFromTab3Data(prev, invoiceIds) {
  if (!prev || !Array.isArray(prev.bySupplier) || invoiceIds.size === 0) return prev;
  const bySupplier = prev.bySupplier
    .map((supplier) => {
      const pairs = (supplier.pairs || []).filter((pair) => {
        const fileId = getInvoiceRecordId(pair?.fileInvoice);
        const xeroId = getInvoiceRecordId(pair?.xeroInvoice);
        return !(invoiceIds.has(fileId) || invoiceIds.has(xeroId));
      });
      const amountOriginal = pairs.reduce((sum, pair) => sum + getPairAmount(pair), 0);
      return {
        ...supplier,
        pairs,
        pairCount: pairs.length,
        unpaid: pairs.length,
        amountOriginal,
        pairsOverdue: pairs.filter(isPairOverdue).length,
      };
    })
    .filter((supplier) => (supplier.pairs?.length ?? 0) > 0);
  return { ...prev, bySupplier };
}

function insertPairsIntoTab3Data(prev, restoreRows) {
  if (!prev || !Array.isArray(prev.bySupplier) || !Array.isArray(restoreRows) || restoreRows.length === 0) {
    return prev;
  }
  const bySupplier = prev.bySupplier.map((supplier) => ({ ...supplier, pairs: [...(supplier.pairs || [])] }));
  for (const row of restoreRows) {
    const restoredPairs = Array.isArray(row?.pairs) ? row.pairs.filter(Boolean) : [];
    if (restoredPairs.length === 0) continue;
    const idx = bySupplier.findIndex((supplier) => {
      if (row?.contactId && supplier?.contactId) return String(supplier.contactId) === String(row.contactId);
      return String(supplier?.supplier ?? "") === String(row?.supplier ?? "");
    });
    if (idx >= 0) {
      const existing = bySupplier[idx].pairs || [];
      const seen = new Set(existing.map(getPairKey));
      const merged = [...existing];
      for (const pair of restoredPairs) {
        const key = getPairKey(pair);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(pair);
      }
      bySupplier[idx].pairs = merged;
    } else {
      bySupplier.push({
        supplier: row?.supplier ?? "Unknown supplier",
        contactId: row?.contactId ?? null,
        supplierCurrency:
          restoredPairs.find((pair) => pair?.fileInvoice?.currency)?.fileInvoice?.currency ??
          restoredPairs.find((pair) => pair?.xeroInvoice?.currency)?.xeroInvoice?.currency ??
          "GBP",
        pairs: restoredPairs,
      });
    }
  }
  const normalized = bySupplier
    .map((supplier) => {
      const pairs = supplier.pairs || [];
      const amountOriginal = pairs.reduce((sum, pair) => sum + getPairAmount(pair), 0);
      return {
        ...supplier,
        pairs,
        pairCount: pairs.length,
        unpaid: pairs.length,
        amountOriginal,
        pairsOverdue: pairs.filter(isPairOverdue).length,
      };
    })
    .filter((supplier) => (supplier.pairs?.length ?? 0) > 0);
  return { ...prev, bySupplier: normalized };
}

function applyUploadSuccessToDashboardData(prev, createdCount) {
  if (!prev || !Number.isFinite(createdCount) || createdCount <= 0) return prev;
  const nextInvoicesLength = Number(prev.invoicesLength);
  return {
    ...prev,
    invoicesLength: Number.isFinite(nextInvoicesLength)
      ? nextInvoicesLength + createdCount
      : prev.invoicesLength,
    log: prev.log ? { ...prev.log, createdAt: new Date().toISOString() } : prev.log,
  };
}

function applyStatementDeleteToDashboardData(prev) {
  if (!prev) return prev;
  const current = Number(prev.statementCount);
  return {
    ...prev,
    statementCount: Number.isFinite(current) ? Math.max(0, current - 1) : prev.statementCount,
  };
}

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
          supplierEmail: row.supplierEmail || "",
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
        const hasOverdue = unpairedInvoices.some((u) => getTab2UnpairedIssue(u) === "OVERDUE");
        const hasUnverified = unpairedInvoices.some((u) => getTab2UnpairedIssue(u) === "UNVERIFIED");
        const statusParts = [
          hasAmountMismatch ? "AMOUNT MISMATCH" : null,
          hasMissingFromXero ? "MISSING FROM XERO" : null,
          hasOverdue ? "OVERDUE" : null,
          hasUnverified ? "UNVERIFIED" : null,
        ].filter(Boolean);
        const statusIssueCounts = {
          amountMismatch: pairsAmountMismatch.length,
          missingFromXero: unpairedInvoices.filter((u) => u.fromXero === false).length,
          overdue: unpairedInvoices.filter((u) => getTab2UnpairedIssue(u) === "OVERDUE").length,
          unverified: unpairedInvoices.filter((u) => getTab2UnpairedIssue(u) === "UNVERIFIED").length,
          // Keep legacy key for latest-tab dot rendering.
          missingFromFile: unpairedInvoices.filter((u) => getTab2UnpairedIssue(u) === "UNVERIFIED").length,
        };
        return {
          supplier: s.supplier,
          contactId: s.contactId,
          supplierEmail: s.supplierEmail || "",
          theySay,
          xeroSays,
          supplierCurrency: s.supplierCurrency ?? "GBP",
          unpaid: (s.invoices || []).length,
          issues,
          status: statusParts.length > 0 ? statusParts.join(" • ") : "Unpaid",
          statusIssueKinds: statusParts,
          statusIssueCounts,
          allPairs,
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
          supplierEmail: s.supplierEmail || "",
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

  const refetch = useCallback(async (options = {}) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(DASHBOARD_DATA_URL, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setData(json);
      else if (!silent) setData(null);
    } catch {
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const updateData = useCallback((updater) => {
    setData((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  return { data, loading, refetch, updateData };
}

/** Fetch dashboard tab 2 (unpaid by supplier). */
function useDashboardTab2() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async (options = {}) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(DASHBOARD_TAB2_URL, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setData(json);
      else if (!silent) setData(null);
    } catch {
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const updateData = useCallback((updater) => {
    setData((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  return { data: data ?? null, loading, refetch, updateData };
}

/** Fetch dashboard tab 3 (reconciled: same-amount pairs only, by supplier). */
function useDashboardTab3() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async (options = {}) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(DASHBOARD_TAB3_URL, { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success) setData(json);
      else if (!silent) setData(null);
    } catch {
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const updateData = useCallback((updater) => {
    setData((prev) => (typeof updater === "function" ? updater(prev) : updater));
  }, []);

  return { data: data ?? null, loading, refetch, updateData };
}

function formatLogDateTime(createdAt) {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

function splitFileName(fileName) {
  const name = String(fileName || "");
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { baseName: name || "file", extension: "" };
  }
  return {
    baseName: name.slice(0, lastDot),
    extension: name.slice(lastDot),
  };
}

const DASHBOARD_TABS = ["latest", "attention", "reconciled", "statements"];
const ACTIVE_TAB_STORAGE_KEY = "simpleApp.activeTab";

export default function SimpleApp() {
  const { data: dashboardData, loading: lastUploadLoading, refetch: refetchDashboardData, updateData: updateDashboardData } =
    useDashboardData();
  const { data: tab2Data, refetch: refetchTab2, updateData: updateTab2Data } = useDashboardTab2();
  const { data: tab3Data, refetch: refetchTab3, updateData: updateTab3Data } = useDashboardTab3();
  const fileInputRef = useRef(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [manualSupplierQueue, setManualSupplierQueue] = useState([]);
  const [manualSupplierInput, setManualSupplierInput] = useState("");
  const [manualSupplierSubmitting, setManualSupplierSubmitting] = useState(false);
  const [manualSupplierError, setManualSupplierError] = useState("");
  const [manualSupplierVisible, setManualSupplierVisible] = useState(false);
  const [predefinedNamesVisible, setPredefinedNamesVisible] = useState(false);
  const [predefinedNamesFiles, setPredefinedNamesFiles] = useState([]);
  const [predefinedNamesError, setPredefinedNamesError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const uploadPickerModeRef = useRef("standard");
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const storedTab = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
      return DASHBOARD_TABS.includes(storedTab) ? storedTab : "attention";
    } catch {
      return "attention";
    }
  });
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
  const [feedbackToast, setFeedbackToast] = useState(null);
  const feedbackToastTimeoutRef = useRef(null);
  const statementsWithInvoices = useMemo(
    () => statementsList.filter((log) => Number(log?.total) > 1),
    [statementsList]
  );

  const statementsBySupplier = useMemo(() => {
    // Show only statements that have more than 1 invoice.
    const byContactId = {};
    for (const log of statementsWithInvoices) {
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
        const supplierCurrency =
          statements.find((log) => log?.supplierCurrency)?.supplierCurrency ?? "GBP";
        const totalAmountOriginal = statements.reduce((sum, log) => {
          const amount = Number(log?.amountOriginal);
          return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0);
        return { supplierName, contactId: contactKey, statements, supplierCurrency, totalAmountOriginal };
      });
  }, [statementsWithInvoices]);

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
  const tableDataForTab = getTableDataForTab(activeTab, dashboardData, tab2Data, tab3Data);
  const tableDataForDisplay = tableDataForTab;
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

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // Ignore storage failures (private mode, blocked storage, etc.)
    }
  }, [activeTab]);

  const refetchStatementsList = useCallback(async () => {
    setStatementsLoading(true);
    setStatementsError("");
    const sortBy = "processDateTime";
    const sortOrder = "desc";
    const fast = "1";
    const limit = 300;
    try {
      const firstRes = await fetch(
        `${ALL_STATEMENTS_URL}?page=1&sortBy=${sortBy}&sortOrder=${sortOrder}&fast=${fast}&limit=${limit}`,
        { credentials: "include" }
      );
      const firstPage = await firstRes.json();
      if (!firstRes.ok || !firstPage.success || !Array.isArray(firstPage.logs)) {
        throw new Error("Failed to load statements");
      }
      const totalPages = Number(firstPage.pages) > 0 ? Number(firstPage.pages) : 1;
      if (totalPages <= 1) {
        setStatementsList(firstPage.logs);
        return;
      }
      const pagePromises = [];
      for (let page = 2; page <= totalPages; page += 1) {
        pagePromises.push(
          fetch(
            `${ALL_STATEMENTS_URL}?page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}&fast=${fast}&limit=${limit}`,
            { credentials: "include" }
          ).then(async (res) => {
            const pageData = await res.json();
            if (!res.ok || !pageData.success || !Array.isArray(pageData.logs)) {
              throw new Error("Failed to load statements");
            }
            return pageData.logs;
          })
        );
      }
      const remainingLogs = await Promise.all(pagePromises);
      setStatementsList([...firstPage.logs, ...remainingLogs.flat()]);
    } catch {
      setStatementsList([]);
      setStatementsError("Failed to load statements");
    } finally {
      setStatementsLoading(false);
    }
  }, []);

  // Fetch statements from DB per supplier by contact id when Statements tab is active
  useEffect(() => {
    if (activeTab !== "statements") return;
    void refetchStatementsList();
  }, [activeTab, refetchStatementsList]);

  const backgroundRevalidateTimeoutRef = useRef(null);
  const revalidateDashboardInBackground = useCallback((options = {}) => {
    const includeStatements = options.includeStatements === true;
    if (backgroundRevalidateTimeoutRef.current) {
      clearTimeout(backgroundRevalidateTimeoutRef.current);
    }
    backgroundRevalidateTimeoutRef.current = setTimeout(() => {
      backgroundRevalidateTimeoutRef.current = null;
      const tasks = [
        refetchDashboardData({ silent: true }),
        refetchTab2({ silent: true }),
        refetchTab3({ silent: true }),
      ];
      if (includeStatements) tasks.push(refetchStatementsList());
      void Promise.allSettled(tasks);
    }, 300);
  }, [refetchDashboardData, refetchStatementsList, refetchTab2, refetchTab3]);

  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [expandedStatementSuppliers, setExpandedStatementSuppliers] = useState(() => new Set());
  const toggleRowExpanded = (supplier) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(supplier)) {
        next.delete(supplier);
        setTab1SelectedByRow((prevSelected) => {
          const key = String(supplier);
          if (!(key in prevSelected)) return prevSelected;
          const nextSelected = { ...prevSelected };
          delete nextSelected[key];
          return nextSelected;
        });
      } else next.add(supplier);
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
    setTab1SelectedByRow((prev) => {
      const key = String(supplier);
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
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
  const [tab1SelectedByRow, setTab1SelectedByRow] = useState(() => ({}));
  const [tab3SelectedIds, setTab3SelectedIds] = useState(() => new Set());
  const [deletingInvoiceId, setDeletingInvoiceId] = useState(null);
  const [deletingLatestRowKey, setDeletingLatestRowKey] = useState(null);
  const [deletingStatementId, setDeletingStatementId] = useState(null);
  const [hidePaidAndMatchedInTab1, setHidePaidAndMatchedInTab1] = useState(false);
  const toggleTab1InvoiceSelection = (rowKey, invoiceId) => {
    const rowKeyStr = String(rowKey);
    const invoiceIdStr = String(invoiceId);
    setTab1SelectedByRow((prev) => {
      const current = prev[rowKeyStr] ?? new Set();
      const nextSet = new Set(current);
      if (nextSet.has(invoiceIdStr)) nextSet.delete(invoiceIdStr);
      else nextSet.add(invoiceIdStr);
      if (nextSet.size === 0) {
        if (!(rowKeyStr in prev)) return prev;
        const next = { ...prev };
        delete next[rowKeyStr];
        return next;
      }
      return { ...prev, [rowKeyStr]: nextSet };
    });
  };
  const toggleTab1SelectAllForRow = (rowKey, invoiceIds) => {
    const rowKeyStr = String(rowKey);
    const ids = invoiceIds.map((id) => String(id));
    setTab1SelectedByRow((prev) => {
      const current = prev[rowKeyStr] ?? new Set();
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      if (allSelected || ids.length === 0) {
        if (!(rowKeyStr in prev)) return prev;
        const next = { ...prev };
        delete next[rowKeyStr];
        return next;
      }
      return { ...prev, [rowKeyStr]: new Set(ids) };
    });
  };
  const clearTab1SelectionForRow = (rowKey) => {
    const rowKeyStr = String(rowKey);
    setTab1SelectedByRow((prev) => {
      if (!(rowKeyStr in prev)) return prev;
      const next = { ...prev };
      delete next[rowKeyStr];
      return next;
    });
  };
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
  const [tab3PaidToast, setTab3PaidToast] = useState({
    visible: false,
    invoiceIds: [],
    message: "",
    restoreRows: [],
  });
  const tab3PaidToastTimeoutRef = useRef(null);
  const showFeedback = useCallback((message, type = "error") => {
    if (!message) return;
    setFeedbackToast({ message, type });
    if (feedbackToastTimeoutRef.current) clearTimeout(feedbackToastTimeoutRef.current);
    feedbackToastTimeoutRef.current = setTimeout(() => {
      setFeedbackToast(null);
      feedbackToastTimeoutRef.current = null;
    }, 4500);
  }, []);
  const emailDraft = useMemo(
    () => (emailModalRow ? buildSupplierEmailDraft(emailModalRow) : { to: "", subject: "", body: "" }),
    [emailModalRow]
  );

  const handleMarkPaid = useCallback(async (row, indices, rowKey) => {
    if (!row?.pairs?.length) return;
    const invoiceIds = indices.flatMap((j) => {
      const p = row.pairs[j];
      if (!p?.fileInvoice?._id || !p?.xeroInvoice?._id) return [];
      return [String(p.fileInvoice._id), String(p.xeroInvoice._id)];
    });
    if (invoiceIds.length === 0) return;
    const pairCount = indices.length;
    const message = pairCount === 1 ? "1 invoice marked as paid" : `${pairCount} invoices marked as paid`;
    setTab3SelectedIds((prev) => {
      const next = new Set(prev);
      indices.forEach((j) => next.delete(`${rowKey}-${j}`));
      return next;
    });
    try {
      const res = await fetch("/api/v2/dashboard/mark-invoices-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to mark as paid");
      }
      const restorePairs = indices.map((j) => row.pairs[j]).filter(Boolean);
      setTab3PaidToast({
        visible: true,
        invoiceIds,
        message,
        restoreRows: restorePairs.length
          ? [{ supplier: row?.supplier, contactId: row?.contactId, pairs: restorePairs }]
          : [],
      });
      if (tab3PaidToastTimeoutRef.current) clearTimeout(tab3PaidToastTimeoutRef.current);
      tab3PaidToastTimeoutRef.current = setTimeout(() => {
        setTab3PaidToast((t) => ({ ...t, visible: false }));
        tab3PaidToastTimeoutRef.current = null;
      }, 5000);
      updateTab3Data((prev) => removeInvoiceIdsFromTab3Data(prev, new Set(invoiceIds)));
      revalidateDashboardInBackground();
    } catch (err) {
      console.error(err);
      showFeedback(err.message || "Failed to mark as paid");
    }
  }, [revalidateDashboardInBackground, showFeedback, updateTab3Data]);

  const handleHardDeleteInvoice = useCallback(async (invoiceId) => {
    if (!invoiceId) return;
    setDeletingInvoiceId(invoiceId);
    try {
      const res = await fetch(`/api/v2/dashboard/invoices/${encodeURIComponent(invoiceId)}`, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to delete invoice");
      if ((data?.deletedCount ?? 0) > 1) {
        showFeedback(data.message || `${data.deletedCount} file invoice(s) deleted from this statement.`, "success");
      }
      const deletedIds = new Set([String(invoiceId)]);
      updateDashboardData((prev) => removeInvoiceIdsFromDashboardData(prev, deletedIds));
      updateTab2Data((prev) => removeInvoiceIdsFromTab2Data(prev, deletedIds));
      updateTab3Data((prev) => removeInvoiceIdsFromTab3Data(prev, deletedIds));
      revalidateDashboardInBackground();
    } catch (err) {
      console.error(err);
      showFeedback(err.message || "Failed to delete invoice");
    } finally {
      setDeletingInvoiceId(null);
    }
  }, [revalidateDashboardInBackground, showFeedback, updateDashboardData, updateTab2Data, updateTab3Data]);

  const handleDeleteLatestFileOnlyInvoices = useCallback(async (rowKey, supplierName, invoiceIds) => {
    if (!rowKey || !Array.isArray(invoiceIds) || invoiceIds.length === 0) return;
    const rowKeyStr = String(rowKey);
    setDeletingLatestRowKey(rowKeyStr);
    try {
      const results = await Promise.allSettled(
        invoiceIds.map(async (invoiceId) => {
          const res = await fetch(`/api/v2/dashboard/invoices/${encodeURIComponent(invoiceId)}`, {
            method: "DELETE",
            credentials: "include",
          });
          let data = null;
          try {
            data = await res.json();
          } catch {
            data = null;
          }
          if (res.ok && (data == null || data.success !== false)) return { outcome: "deleted", invoiceId };
          const msg = String(data?.message || "");
          const notFound = res.status === 404 || /not found|already deleted|does not exist/i.test(msg);
          if (notFound) return { outcome: "missing", invoiceId };
          throw new Error(data?.message || `Failed to delete invoice ${invoiceId}`);
        })
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        const firstError = failed[0]?.reason?.message || "Failed to delete some invoices";
        showFeedback(`${firstError} (${failed.length} failed)`);
      }
      const settledIds = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => String(r.value?.invoiceId || ""))
        .filter(Boolean);
      if (settledIds.length > 0) {
        const deletedIds = new Set(settledIds);
        updateDashboardData((prev) => removeInvoiceIdsFromDashboardData(prev, deletedIds));
        updateTab2Data((prev) => removeInvoiceIdsFromTab2Data(prev, deletedIds));
        updateTab3Data((prev) => removeInvoiceIdsFromTab3Data(prev, deletedIds));
      }
      revalidateDashboardInBackground();
      clearTab1SelectionForRow(rowKey);
    } catch (err) {
      console.error(err);
      showFeedback(err.message || "Failed to delete invoices");
    } finally {
      setDeletingLatestRowKey(null);
    }
  }, [clearTab1SelectionForRow, revalidateDashboardInBackground, showFeedback, updateDashboardData, updateTab2Data, updateTab3Data]);

  const handleDeleteStatement = useCallback(async (statementId) => {
    if (!statementId) return;
    setDeletingStatementId(String(statementId));
    try {
      const res = await fetch(`/api/v2/supplier-logs/statements/${encodeURIComponent(statementId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || "Failed to delete statement");
      const statementIdStr = String(statementId);
      setStatementsList((prev) => prev.filter((log) => String(log?._id ?? "") !== statementIdStr));
      updateDashboardData((prev) => applyStatementDeleteToDashboardData(prev));
      revalidateDashboardInBackground({ includeStatements: true });
    } catch (err) {
      console.error(err);
      showFeedback(err.message || "Failed to delete statement");
    } finally {
      setDeletingStatementId(null);
    }
  }, [revalidateDashboardInBackground, showFeedback, updateDashboardData]);

  const handleUndoPaid = useCallback(async () => {
    const { invoiceIds, restoreRows } = tab3PaidToast;
    if (!invoiceIds?.length) return;
    if (tab3PaidToastTimeoutRef.current) {
      clearTimeout(tab3PaidToastTimeoutRef.current);
      tab3PaidToastTimeoutRef.current = null;
    }
    setTab3PaidToast((t) => ({ ...t, visible: false }));
    try {
      const res = await fetch("/api/v2/dashboard/undo-mark-invoices-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to undo");
      }
      if (Array.isArray(restoreRows) && restoreRows.length > 0) {
        updateTab3Data((prev) => insertPairsIntoTab3Data(prev, restoreRows));
      }
      revalidateDashboardInBackground();
    } catch (err) {
      console.error(err);
      showFeedback(err.message || "Failed to undo");
    }
  }, [revalidateDashboardInBackground, showFeedback, tab3PaidToast, updateTab3Data]);

  useEffect(() => {
    return () => {
      if (tab3PaidToastTimeoutRef.current) clearTimeout(tab3PaidToastTimeoutRef.current);
      if (backgroundRevalidateTimeoutRef.current) clearTimeout(backgroundRevalidateTimeoutRef.current);
      if (feedbackToastTimeoutRef.current) clearTimeout(feedbackToastTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const openPicker = (event) => {
      uploadPickerModeRef.current =
        event?.detail?.mode === "predefined-names" ? "predefined-names" : "standard";
      fileInputRef.current?.click();
    };
    window.addEventListener("simple-app-open-upload", openPicker);
    return () => window.removeEventListener("simple-app-open-upload", openPicker);
  }, []);

  const refreshXeroSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v2/dashboard/xero-sync-status", { credentials: "include" });
      const data = await res.json();
      if (data?.lastSyncedAt) setLastSyncedAt(new Date(data.lastSyncedAt));
      else setLastSyncedAt(null);
    } catch {
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
      showFeedback(err.message || "Failed to sync with Xero");
    } finally {
      setSyncNowLoading(false);
    }
  }, [refetchDashboardData, refetchTab2, refetchTab3, refreshXeroSyncStatus, showFeedback]);

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
      showFeedback("No data to export");
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
            issue: getTab2UnpairedIssue(u),
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
        showFeedback("No issues to export");
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
      showFeedback("Export failed");
    } finally {
      setExportTab2Loading(false);
    }
  }, [showFeedback, tab2Data]);

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
        issue: getTab2UnpairedIssue(u),
        invoiceNumber: u.invoiceNumber || "",
        fileAmount: u.fromXero ? "" : amtOrig,
        fileCurrency: u.fromXero ? "" : curr,
        xeroAmount: u.fromXero ? amtOrig : "",
        xeroCurrency: u.fromXero ? curr : "",
        dueDate: dueOrDate ? new Date(dueOrDate).toLocaleDateString("en-GB") : "",
      });
    }
    if (rows.length === 0) {
      showFeedback("No issues to export for this supplier");
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
      showFeedback("Export failed");
    } finally {
      setExportingSupplierKey(null);
    }
  }, [showFeedback]);

  const exportTab3ToExcel = useCallback(async () => {
    const bySupplier = tab3Data?.bySupplier;
    if (!Array.isArray(bySupplier) || bySupplier.length === 0) {
      showFeedback("No reconciled data to export");
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
        showFeedback("No reconciled invoices to export");
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
      showFeedback("Export failed");
    } finally {
      setExportTab3Loading(false);
    }
  }, [showFeedback, tab3Data]);

  const exportSingleSupplierTab3ToExcel = useCallback(async (row) => {
    const supplier = row.supplier || row.contactId || "";
    const pairs = row.pairs || [];
    if (pairs.length === 0) {
      showFeedback("No reconciled invoices to export for this supplier");
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
      showFeedback("Export failed");
    } finally {
      setExportingSupplierKey(null);
    }
  }, [showFeedback]);

  function handleFileSelect(e) {
    const files = e.target.files;
    const selectedMode =
      uploadPickerModeRef.current === "predefined-names"
        ? "predefined-names"
        : "standard";
    uploadPickerModeRef.current = "standard";

    if (files?.length > 0) {
      if (selectedMode === "predefined-names") {
        const entries = Array.from(files).map((file, idx) => {
          const { extension } = splitFileName(file.name);
          return {
            id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
            file,
            extension,
            enteredName: "",
          };
        });
        setPredefinedNamesFiles(entries);
        setPredefinedNamesError("");
        setPredefinedNamesVisible(true);
      } else {
        handleFileUpload(files, { uploadMode: selectedMode });
      }
    }
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
      switchToLatestBatchTab();
      const createdCount = Number(data.createdCount ?? (data.created?.length ?? 0));
      if (createdCount > 0) {
        updateDashboardData((prev) => applyUploadSuccessToDashboardData(prev, createdCount));
      }
      popManualSupplierQueue(true);
      revalidateDashboardInBackground();
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

  function switchToLatestBatchTab() {
    setActiveTab("latest");
  }

  async function handleFileUpload(files, options = {}) {
    if (!files?.length) return;
    const uploadMode = options.uploadMode || uploadPickerModeRef.current;
    uploadPickerModeRef.current = "standard";
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
    setUploadSuccess(
      uploadMode === "predefined-names"
        ? "Predefined names applied. Uploading now..."
        : ""
    );
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
            switchToLatestBatchTab();
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
          switchToLatestBatchTab();
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
          updateDashboardData((prev) => applyUploadSuccessToDashboardData(prev, totalCreated));
        }
        revalidateDashboardInBackground();
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
        switchToLatestBatchTab();
        if (createdCount > 0) {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 },
            colors: ["#4ADE80", "#22C55E", "#7B8CDE", "#A5B4FC", "#FBBF24"],
            decay: 0.9,
            ticks: 100,
          });
          updateDashboardData((prev) => applyUploadSuccessToDashboardData(prev, createdCount));
        }
        revalidateDashboardInBackground();
      }
    } catch (err) {
      setUploadError(getUploadErrorMessage(err?.message, "network"));
    } finally {
      setUploadLoading(false);
    }
  }

  async function handlePredefinedNamesContinue() {
    if (!predefinedNamesFiles.length || uploadLoading) return;
    const invalid = predefinedNamesFiles.find(
      (entry) => !String(entry.enteredName || "").trim()
    );
    if (invalid) {
      setPredefinedNamesError("Please enter a name for every file.");
      return;
    }

    const renamedFiles = predefinedNamesFiles.map((entry) => {
      const typed = String(entry.enteredName || "").trim();
      const extension = entry.extension || "";
      const finalName = typed.toLowerCase().endsWith(extension.toLowerCase())
        ? typed
        : `${typed}${extension}`;
      return new File([entry.file], finalName, {
        type: entry.file.type,
        lastModified: entry.file.lastModified,
      });
    });

    setPredefinedNamesVisible(false);
    setPredefinedNamesError("");
    setPredefinedNamesFiles([]);
    await handleFileUpload(renamedFiles, { uploadMode: "predefined-names" });
  }

  function handlePredefinedNamesCancel() {
    if (uploadLoading) return;
    setPredefinedNamesVisible(false);
    setPredefinedNamesError("");
    setPredefinedNamesFiles([]);
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
              const tabs = DASHBOARD_TABS;
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
              Suppliers
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
                <p className={styles.statementsListMessage}>No statements with more than 1 invoice.</p>
              )}
              {!statementsLoading && !statementsError && statementsBySupplier.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.supplierTable}>
                    <thead>
                      <tr>
                        <th className={styles.tableTh}>SUPPLIER NAME</th>
                        <th className={styles.tableTh}>STATEMENTS</th>
                        <th className={styles.tableTh}>INVOICES</th>
                        <th className={styles.tableTh}>TOTAL AMOUNT (ORIGINAL CURRENCY)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statementsBySupplier.map(({ supplierName, contactId, statements, supplierCurrency, totalAmountOriginal }) => {
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
                              <td className={styles.tableTd}>
                                {formatCurrencyTableAmount(supplierCurrency, totalAmountOriginal)}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className={styles.tableRowDetail}>
                                <td colSpan={4} className={styles.tableTdDetail}>
                                  <div className={styles.detailPanel}>
                                    <h3 className={styles.detailTitle}>Statements</h3>
                                    <div className={styles.detailTableWrap}>
                                      <table className={styles.detailTable}>
                                        <thead>
                                          <tr>
                                            <th className={styles.detailTh}>PROCESSED</th>
                                            <th className={styles.detailTh}>INVOICES</th>
                                            <th className={styles.detailTh}>AMOUNT (ORIGINAL CURRENCY)</th>
                                            <th className={styles.detailTh}>VIEW PDF</th>
                                            <th className={styles.detailTh}>ACTION</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {statements.map((log) => {
                                            const isPdf = /\.pdf$/i.test(String(log?.file ?? ""));
                                            const invoiceCount = log.total ?? 0;
                                            const statementAmount = Number(log?.amountOriginal);
                                            const statementCurrency = log?.supplierCurrency ?? supplierCurrency ?? "GBP";
                                            return (
                                              <tr key={log._id}>
                                                <td className={styles.detailTd}>
                                                  {formatLogDateTime(log.addedAt) ?? "—"}
                                                </td>
                                                <td className={styles.detailTd}>{invoiceCount}</td>
                                                <td className={styles.detailTd}>
                                                  {formatCurrencyTableAmount(
                                                    statementCurrency,
                                                    Number.isFinite(statementAmount) ? statementAmount : null
                                                  )}
                                                </td>
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
                                                <td className={styles.detailTd} onClick={(e) => e.stopPropagation()}>
                                                  <button
                                                    type="button"
                                                    className={styles.detailDeleteBtn}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleDeleteStatement(log._id);
                                                    }}
                                                    disabled={deletingStatementId === String(log._id)}
                                                    aria-label={`Delete statement ${log._id}`}
                                                    title="Delete statement"
                                                  >
                                                    {deletingStatementId === String(log._id) ? (
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
                    {activeTab === "latest" && (
                      <th key="delete-file-only" className={styles.tableTh} style={{ width: 52 }}>
                        Delete
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
                      : (
                        showSupplierCurrencyTotals
                          ? (
                            // Tab 2/3 supplier-currency values should be "GBP -123.45" (minus before number).
                            activeTab === "attention"
                              ? formatCurrencyTableAmount(rowSupplierCurrency, diff)
                              : `-${formatCurrencyTableAmount(rowSupplierCurrency, -diff)}`
                          )
                          : `-${formatTableAmount(-diff)}`
                      );
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
                    const latestFileOnlyDeleteIds =
                      activeTab === "latest"
                        ? Array.from(
                            new Set(
                              [...viewAllInvoices, ...detailInvoices]
                                .filter((inv) => {
                                  const issue = String(inv?.issue || "").toUpperCase();
                                  return inv?.fromXero === false || issue === "MISSING FROM XERO" || issue === "FILE ONLY";
                                })
                                .map((inv) => inv?.deleteInvoiceId ?? inv?.invoiceId ?? inv?._id ?? inv?.id)
                                .filter(Boolean)
                                .map((id) => String(id))
                            )
                          )
                        : [];
                    const tab2Pairs = activeTab === "attention" ? (row.pairs || []) : [];
                    const tab2AllPairs = activeTab === "attention" ? (row.allPairs || []) : [];
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
                                issue: getTab2UnpairedIssue(u),
                                supplierAmt: u.fromXero ? null : amt,
                                xeroAmt: u.fromXero ? amt : null,
                                difference: amt,
                                status: "Unpaid",
                              };
                            }),
                          ]
                        : [];
                    const attentionMatchedDetailInvoices =
                      activeTab === "attention"
                        ? (tab2AllPairs || [])
                            .filter((p) => p.label === "perfect match")
                            .map((p) => {
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
                                issue: "Matched",
                                supplierAmt: fa,
                                xeroAmt: xa,
                                difference: xa - fa,
                                status: "Reconciled",
                              };
                            })
                        : [];
                    const detailRows =
                      activeTab === "reconciled"
                        ? reconciledDetailInvoices
                        : activeTab === "attention"
                          ? (viewAllShownForRow.has(rowKey)
                              ? [...attentionDetailInvoices, ...attentionMatchedDetailInvoices]
                              : attentionDetailInvoices)
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
                    const tab1SelectableDetailIds =
                      activeTab === "latest" || activeTab === "attention"
                        ? sortedDetailRows
                            .map((inv) => inv.deleteInvoiceId ?? inv._id)
                            .filter(Boolean)
                            .map((id) => String(id))
                        : [];
                    const tab1SelectedSet =
                      activeTab === "latest" || activeTab === "attention"
                        ? (tab1SelectedByRow[String(rowKey)] ?? new Set())
                        : new Set();
                    const tab1SelectedIdsForDelete =
                      activeTab === "latest" || activeTab === "attention"
                        ? tab1SelectableDetailIds.filter((id) => tab1SelectedSet.has(id))
                        : [];
                    const tab1RowHasSelection = tab1SelectedIdsForDelete.length > 0;
                    const tab1SelectAllChecked =
                      tab1SelectableDetailIds.length > 0 &&
                      tab1SelectableDetailIds.every((id) => tab1SelectedSet.has(id));
                    const selectedInvoicesForEmail =
                      activeTab === "latest" || activeTab === "attention"
                        ? sortedDetailRows
                            .filter((inv) => {
                              const id = inv.deleteInvoiceId ?? inv._id;
                              return id != null && tab1SelectedSet.has(String(id));
                            })
                            .map((inv) => {
                              const supplierCurrency = inv.supplierCurrencyOriginal ?? inv.currency ?? "GBP";
                              const xeroCurrency = inv.xeroCurrencyOriginal ?? inv.currency ?? "GBP";
                              const diffCurrency =
                                inv.differenceOriginalCurrency ??
                                inv.supplierCurrencyOriginal ??
                                inv.xeroCurrencyOriginal ??
                                inv.currency ??
                                "GBP";
                              const supplierAmount =
                                inv.supplierAmountOriginal != null ? Number(inv.supplierAmountOriginal) : inv.supplierAmt != null ? Number(inv.supplierAmt) : null;
                              const xeroAmount =
                                inv.xeroAmountOriginal != null ? Number(inv.xeroAmountOriginal) : inv.xeroAmt != null ? Number(inv.xeroAmt) : null;
                              const diffAmount =
                                inv.differenceOriginal != null ? Number(inv.differenceOriginal) : inv.difference != null ? Number(inv.difference) : null;
                              const diffText =
                                diffAmount == null || Number.isNaN(diffAmount)
                                  ? "—"
                                  : `${diffAmount < 0 ? "-" : ""}${formatEmailAmount(diffCurrency, Math.abs(diffAmount))}`;
                              return {
                                invoiceNumber: inv.invoiceNumber || "—",
                                problem: formatIssueForEmail(inv.issue),
                                supplierAmount: formatEmailAmount(supplierCurrency, supplierAmount),
                                ourAmount: formatEmailAmount(xeroCurrency, xeroAmount),
                                difference: diffText,
                              };
                            })
                        : [];
                    const detailColumns = [
                      ...(activeTab === "latest" || activeTab === "attention" ? [["select", ""]] : []),
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
                              (row.statusIssueCounts.overdue ?? 0) > 0 ||
                              (row.statusIssueCounts.unverified ?? row.statusIssueCounts.missingFromFile ?? 0) > 0 ||
                              (row.statusIssueCounts.missingFromFile ?? 0) > 0) ? (
                              <span
                                className={styles.statusIssueDots}
                                aria-label={`Amount mismatch: ${row.statusIssueCounts.amountMismatch ?? 0}, Missing from Xero: ${row.statusIssueCounts.missingFromXero ?? 0}, Overdue: ${row.statusIssueCounts.overdue ?? 0}, Unverified: ${row.statusIssueCounts.unverified ?? row.statusIssueCounts.missingFromFile ?? 0}`}
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
                                {(row.statusIssueCounts.overdue ?? 0) > 0 && (
                                  <span
                                    className={styles.statusIssueDotWrap}
                                    data-tooltip={`Overdue (${row.statusIssueCounts.overdue})`}
                                    tabIndex={0}
                                    aria-label="Overdue"
                                  >
                                    <span className={`${styles.statusIssueDot} ${styles.statusIssueDotOverdue}`} aria-hidden>
                                      {row.statusIssueCounts.overdue}
                                    </span>
                                  </span>
                                )}
                                {(row.statusIssueCounts.unverified ?? row.statusIssueCounts.missingFromFile ?? 0) > 0 && (
                                  <span
                                    className={styles.statusIssueDotWrap}
                                    data-tooltip={`Unverified (${row.statusIssueCounts.unverified ?? row.statusIssueCounts.missingFromFile})`}
                                    tabIndex={0}
                                    aria-label="Unverified"
                                  >
                                    <span className={`${styles.statusIssueDot} ${styles.statusIssueDotMissingFile}`} aria-hidden>
                                      {row.statusIssueCounts.unverified ?? row.statusIssueCounts.missingFromFile}
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
                          {activeTab === "latest" && (
                            <td className={styles.tableTd} onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={styles.detailDeleteBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteLatestFileOnlyInvoices(rowKey, row.supplier, latestFileOnlyDeleteIds);
                                }}
                                disabled={deletingLatestRowKey === String(rowKey) || latestFileOnlyDeleteIds.length === 0}
                                aria-label={`Delete file-only invoices for ${row.supplier}`}
                                title={
                                  latestFileOnlyDeleteIds.length > 0
                                    ? `Delete ${latestFileOnlyDeleteIds.length} file-only invoice${latestFileOnlyDeleteIds.length !== 1 ? "s" : ""}`
                                    : "No file-only invoices to delete"
                                }
                              >
                                {deletingLatestRowKey === String(rowKey) ? (
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
                            </td>
                          )}
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
                            <td colSpan={activeTab === "reconciled" ? 6 : activeTab === "attention" ? 8 : activeTab === "latest" ? 8 : 7} className={styles.tableTdDetail}>
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
                                    {(activeTab === "latest" || activeTab === "attention") && (
                                      <button
                                        type="button"
                                        className={styles.tab1BulkDeleteBtn}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteLatestFileOnlyInvoices(rowKey, row.supplier, tab1SelectedIdsForDelete);
                                        }}
                                        disabled={!tab1RowHasSelection || deletingLatestRowKey === String(rowKey)}
                                        aria-label={`Delete ${tab1SelectedIdsForDelete.length} selected invoice${tab1SelectedIdsForDelete.length !== 1 ? "s" : ""}`}
                                      >
                                        {deletingLatestRowKey === String(rowKey) ? "Deleting…" : `Delete Selected${tab1RowHasSelection ? ` (${tab1SelectedIdsForDelete.length})` : ""}`}
                                      </button>
                                    )}
                                    {activeTab === "latest" && (
                                      <button
                                        type="button"
                                        className={hidePaidAndMatchedInTab1 ? styles.tab1HideToggleActive : styles.tab1HideToggle}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setHidePaidAndMatchedInTab1((v) => !v);
                                        }}
                                        aria-pressed={hidePaidAndMatchedInTab1}
                                        aria-label={hidePaidAndMatchedInTab1 ? "Show paid and reconciled" : "Hide paid and reconciled"}
                                      >
                                        {hidePaidAndMatchedInTab1 ? "Show paid & reconciled" : "Hide paid & reconciled"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className={styles.detailEmailBtn}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if ((activeTab === "latest" || activeTab === "attention") && !tab1RowHasSelection) {
                                          showFeedback("Please select at least one invoice before emailing the supplier.");
                                          return;
                                        }
                                        setEmailModalRow({
                                          ...row,
                                          selectedInvoices: selectedInvoicesForEmail,
                                        });
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
                                  <p className={styles.detailNoUnpaid}>All invoices here are paid or reconciled.</p>
                                )}
                                {detailRows.length > 0 && (
                                <div className={styles.detailTableWrap}>
                                  <table className={styles.detailTable}>
                                    <thead>
                                      <tr>
                                        {detailColumns.map(([key, label]) => (
                                          <th
                                            key={key}
                                            className={key === "delete" || key === "select" ? styles.detailTh : `${styles.detailTh} ${styles.detailThSortable}`}
                                            onClick={key === "delete" || key === "select" ? undefined : (e) => { e.stopPropagation(); handleDetailSort(key); }}
                                            onKeyDown={key === "delete" || key === "select" ? undefined : (e) => { if (e.key === "Enter") { e.stopPropagation(); handleDetailSort(key); } }}
                                            role="columnheader"
                                            tabIndex={key === "delete" || key === "select" ? -1 : 0}
                                            aria-sort={key === "delete" || key === "select" ? undefined : (detailTableSort.column === key ? (detailTableSort.dir === "asc" ? "ascending" : "descending") : undefined)}
                                          >
                                            {key === "select" && (activeTab === "latest" || activeTab === "attention") ? (
                                              <label className={styles.reconciledCheckboxLabel} onClick={(e) => e.stopPropagation()}>
                                                <input
                                                  type="checkbox"
                                                  checked={tab1SelectAllChecked}
                                                  disabled={tab1SelectableDetailIds.length === 0}
                                                  onChange={() => toggleTab1SelectAllForRow(rowKey, tab1SelectableDetailIds)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  aria-label="Select all visible invoices"
                                                />
                                              </label>
                                            ) : label}
                                            {key !== "delete" && key !== "select" && detailTableSort.column === key && (
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
                                        const rowDeleteId = inv.deleteInvoiceId ?? inv._id;
                                        const rowDeleteIdStr = rowDeleteId ? String(rowDeleteId) : null;
                                        return (
                                        <tr key={inv.invoiceNumber ? `${inv.invoiceNumber}-${j}` : j} className={isPaid ? styles.detailRowPaid : undefined}>
                                          {(activeTab === "latest" || activeTab === "attention") && (
                                            <td className={styles.detailTd} onClick={(e) => e.stopPropagation()}>
                                              <label className={styles.reconciledCheckboxLabel}>
                                                <input
                                                  type="checkbox"
                                                  checked={rowDeleteIdStr ? tab1SelectedSet.has(rowDeleteIdStr) : false}
                                                  disabled={!rowDeleteIdStr}
                                                  onChange={() => rowDeleteIdStr && toggleTab1InvoiceSelection(rowKey, rowDeleteIdStr)}
                                                  onClick={(e) => e.stopPropagation()}
                                                  aria-label={`Select invoice ${inv.invoiceNumber || j + 1}`}
                                                />
                                              </label>
                                            </td>
                                          )}
                                          <td className={styles.detailTd}>{inv.invoiceNumber}</td>
                                          <td className={styles.detailTd}>{inv.date || "–"}</td>
                                          <td className={styles.detailTd}>
                                            {inv.issue === "paid" ? (
                                              <span className={styles.issuePillPaid}>paid</span>
                                            ) : inv.issue === "Matched" ? (
                                              <span className={styles.issuePillMatched}>Reconciled</span>
                                            ) : inv.issue === "AMOUNT MISMATCH" ? (
                                              <span className={styles.issuePillMismatch}>{inv.issue}</span>
                                            ) : inv.issue === "MISSING FROM XERO" ? (
                                              <span className={styles.issuePillMissingFromXero}>{inv.issue}</span>
                                            ) : inv.issue === "OVERDUE" ? (
                                              <span className={styles.issuePillOverdue}>Overdue</span>
                                            ) : inv.issue === "MISSING FROM FILE" || inv.issue === "UNVERIFIED" ? (
                                              <span className={styles.issuePillMissingFromFile}>Unverified</span>
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
                                            {rowDeleteIdStr ? (
                                              <button
                                                type="button"
                                                className={styles.detailDeleteBtn}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleHardDeleteInvoice(rowDeleteIdStr);
                                                }}
                                                disabled={deletingInvoiceId === rowDeleteIdStr}
                                                aria-label={`Delete invoice ${inv.invoiceNumber || "row"}`}
                                                title="Delete invoice"
                                              >
                                                {deletingInvoiceId === rowDeleteIdStr ? (
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

      {predefinedNamesVisible && (
        <div
          className={styles.manualSupplierOverlay}
          onClick={handlePredefinedNamesCancel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="predefined-names-title"
        >
          <div
            className={styles.manualSupplierBox}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="predefined-names-title" className={styles.manualSupplierTitle}>
              Upload with predefined names
            </h2>
            <p className={styles.manualSupplierText}>
              Review files below and set the name for each one before upload.
            </p>
            <div className={styles.predefinedNamesList}>
              {predefinedNamesFiles.map((entry) => (
                <div key={entry.id} className={styles.predefinedNamesRow}>
                  <div className={styles.predefinedNamesFile}>
                    <strong>{entry.file.name}</strong>
                    <span>{entry.extension || "No extension"}</span>
                  </div>
                  <input
                    type="text"
                    className={styles.manualSupplierInput}
                    value={entry.enteredName}
                    onChange={(e) =>
                      setPredefinedNamesFiles((prev) =>
                        prev.map((item) =>
                          item.id === entry.id
                            ? { ...item, enteredName: e.target.value }
                            : item
                        )
                      )
                    }
                    placeholder="Enter file name"
                    disabled={uploadLoading}
                  />
                </div>
              ))}
            </div>
            {predefinedNamesError && (
              <p className={styles.uploadError} role="alert">
                {predefinedNamesError}
              </p>
            )}
            <div className={styles.manualSupplierActions}>
              <button
                type="button"
                className={styles.manualSupplierPrimary}
                onClick={handlePredefinedNamesContinue}
                disabled={uploadLoading}
              >
                {uploadLoading ? "Uploading..." : "Continue upload"}
              </button>
              <button
                type="button"
                className={styles.manualSupplierSecondary}
                onClick={handlePredefinedNamesCancel}
                disabled={uploadLoading}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {feedbackToast && (
        <div
          className={`${styles.paidToast} ${feedbackToast.type === "success" ? styles.paidToastSuccess : styles.paidToastError}`}
          role="status"
          aria-live="polite"
        >
          <span className={styles.paidToastMessage}>{feedbackToast.message}</span>
          <button
            type="button"
            className={styles.paidToastDismiss}
            onClick={() => setFeedbackToast(null)}
            aria-label="Dismiss message"
          >
            Dismiss
          </button>
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
                {emailDraft.to || ""}
              </div>
            </div>
            <div className={styles.emailModalField}>
              <label className={styles.emailModalLabel}>Subject</label>
              <div className={styles.emailModalValue}>
                {emailDraft.subject}
              </div>
            </div>
            <div className={styles.emailModalField}>
              <label className={styles.emailModalLabel}>Body</label>
              <div className={styles.emailModalBody}>
                Dear {emailModalRow.supplier || "Supplier"},
                {"\n\n"}
                Please review the invoice discrepancies listed below and confirm the correct records:
                {"\n\n"}
                {Array.isArray(emailModalRow.selectedInvoices) && emailModalRow.selectedInvoices.length > 0 ? (
                  <>
                    <table className={styles.detailTable} style={{ marginBottom: "1rem" }}>
                      <thead>
                        <tr>
                          <th className={styles.detailTh}>INVOICE #</th>
                          <th className={styles.detailTh}>PROBLEM</th>
                          <th className={styles.detailTh}>SUPPLIER RECORD</th>
                          <th className={styles.detailTh}>OUR RECORD</th>
                          <th className={styles.detailTh}>DIFFERENCE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emailModalRow.selectedInvoices.map((item, idx) => (
                          <tr key={`${item.invoiceNumber}-${idx}`}>
                            <td className={styles.detailTd}>{item.invoiceNumber}</td>
                            <td className={styles.detailTd}>{item.problem}</td>
                            <td className={styles.detailTd}>{item.supplierAmount}</td>
                            <td className={styles.detailTd}>{item.ourAmount}</td>
                            <td className={styles.detailTd}>{item.difference}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {"\n"}
                  </>
                ) : null}
                Please share any corrected invoice references or supporting details so we can reconcile quickly.
                {"\n\n"}
                Kind regards,
                {"\n"}
                Steve Accounting Team
              </div>
            </div>
            <div className={styles.emailModalActions}>
              <button
                type="button"
                className={styles.emailModalPrimary}
                onClick={() => {
                  const mailto = `mailto:${encodeURIComponent(emailDraft.to)}?subject=${encodeURIComponent(emailDraft.subject)}&body=${encodeURIComponent(emailDraft.body)}`;
                  window.open(mailto, "_blank", "noopener,noreferrer");
                }}
                aria-label="Open default mail app"
              >
                Open in Mail App
              </button>
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
        </div>
      )}
    </div>
  );
}
