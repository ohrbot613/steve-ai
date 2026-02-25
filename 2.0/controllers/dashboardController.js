const { tryCatchAsync } = require("../../controllers/ErrorController");
const Invoice = require("../modals/invoiceModal");
const Team = require("../modals/teamModal");
const User = require("../../modals/userModal");
const ProcessLog = require("../modals/processLogModal");
const Statement = require("../modals/statementModal");
const Vendor = require("../modals/vendorModal");
const XeroSyncState = require("../../modals/xeroSyncStateModal");
const { logProcess } = require("./processLogController");
const { syncIncrementalInvoicesFromXero } = require("../scripts/scripts");
const mongoose = require("mongoose");

const FRANKFURTER_LATEST_GBP = "https://api.frankfurter.dev/v1/latest?base=GBP";

function normalizeCurrency(value) {
    return (value && String(value).toUpperCase()) || null;
}

/**
 * Resolve invoice currency with pair fallback:
 * - use invoice currency if present
 * - if missing and paired invoice has currency, use the paired currency
 * - else fallback to GBP
 */
function resolveInvoiceCurrency(inv, pairedInv = null) {
    return normalizeCurrency(inv?.currency) || normalizeCurrency(pairedInv?.currency) || "GBP";
}

/** Get amount in GBP using resolved currency (with optional pair fallback). */
function toAmountGBP(inv, rates = {}, pairedInv = null) {
    const amount = Number(inv?.amount) || 0;
    const currency = resolveInvoiceCurrency(inv, pairedInv);
    if (currency === "GBP") return amount;
    const rate = rates[currency];
    if (!rate || rate === 0) return amount;
    return amount / rate;
}

function addCurrencyAmount(bucket, currency, amount) {
    const key = normalizeCurrency(currency) || "GBP";
    const numeric = Math.round((Number(amount) || 0) * 100) / 100;
    bucket[key] = Math.round(((bucket[key] || 0) + numeric) * 100) / 100;
}

/**
 * GET /api/v2/dashboard/stats
 * Returns aggregate counts for the 2.0 dashboard:
 * - bankBalance: from Team model for the current user's tenant
 * - unmatchedCount: invoice numbers that don't have both fromXero true and fromXero false
 * - invoicesToPayCount: payment-run candidates (same invoiceNumber+amount, 2+ docs)
 * - overdueCount: those candidates whose due date is before today
 */
exports.getDashboardStats = tryCatchAsync(async (req, res) => {
    const baseMatch = { isDeleted: { $ne: true } };

    // Bank balance from Team (same tenant resolution as payment run)
    let bankBalance = null;
    const user = await User.findById(req.user._id).select("tenant").lean();
    const tenantId = user?.tenant != null ? String(user.tenant) : null;
    if (tenantId) {
        const team = await Team.findOne({ tenantId }).select("bankBalance").lean();
        if (team?.bankBalance != null) bankBalance = team.bankBalance;
    }

    // Unmatched: invoice numbers that don't have both a fromXero true and fromXero false record (only unpaid)
    const unmatchedAgg = await Invoice.aggregate([
        { $match: { ...baseMatch, status: "unpaid" } },
        {
            $group: {
                _id: "$invoiceNumber",
                hasFromXero: { $max: { $cond: ["$fromXero", 1, 0] } },
                hasFromFile: { $max: { $cond: ["$fromXero", 0, 1] } },
            },
        },
        { $match: { $or: [{ hasFromXero: 0 }, { hasFromFile: 0 }] } },
        { $count: "count" },
    ]);
    const unmatchedCount = unmatchedAgg[0]?.count ?? 0;

    // Payment-run candidates: group by invoiceNumber + amount, count >= 2 (same logic as paymentRunInvoice)
    const grouped = await Invoice.aggregate([
        { $match: baseMatch },
        {
            $group: {
                _id: { invoiceNumber: "$invoiceNumber", amount: "$amount" },
                count: { $sum: 1 },
                docs: { $push: "$$ROOT" },
            },
        },
        { $match: { count: { $gte: 2 } } },
        {
            $addFields: {
                dueDate: {
                    $let: {
                        vars: {
                            fromFile: {
                                $arrayElemAt: [
                                    { $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", false] } } },
                                    0,
                                ],
                            },
                        },
                        in: {
                            $ifNull: [
                                "$$fromFile.dueDate",
                                { $arrayElemAt: ["$docs.dueDate", 0] },
                            ],
                        },
                    },
                },
            },
        },
        { $project: { count: 1, dueDate: 1 } },
    ]);

    const invoicesToPayCount = grouped.length;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const overdueCount = grouped.filter((g) => {
        const d = g.dueDate;
        if (!d) return false;
        const due = new Date(d);
        due.setHours(0, 0, 0, 0);
        return due.getTime() < now.getTime();
    }).length;

    res.status(200).json({
        success: true,
        bankBalance,
        unmatchedCount,
        invoicesToPayCount,
        overdueCount,
    });
});

/**
 * GET /api/v2/dashboard/unmatched-invoices-export
 * Returns all unpaid invoices that are "unmatched" (invoice numbers without both fromXero true and false)
 * with supplier name for Excel export.
 */
exports.getUnmatchedInvoicesExport = tryCatchAsync(async (req, res) => {
    const baseMatch = { isDeleted: { $ne: true }, status: "unpaid" };

    // Same as stats: get invoice numbers that don't have both fromXero true and fromXero false
    const unmatchedNumbersAgg = await Invoice.aggregate([
        { $match: baseMatch },
        {
            $group: {
                _id: "$invoiceNumber",
                hasFromXero: { $max: { $cond: ["$fromXero", 1, 0] } },
                hasFromFile: { $max: { $cond: ["$fromXero", 0, 1] } },
            },
        },
        { $match: { $or: [{ hasFromXero: 0 }, { hasFromFile: 0 }] } },
        { $project: { invoiceNumber: "$_id", _id: 0 } },
    ]);
    const unmatchedInvoiceNumbers = unmatchedNumbersAgg.map((r) => r.invoiceNumber).filter(Boolean);

    if (unmatchedInvoiceNumbers.length === 0) {
        return res.status(200).json({ success: true, invoices: [] });
    }

    const invoices = await Invoice.aggregate([
        { $match: { ...baseMatch, invoiceNumber: { $in: unmatchedInvoiceNumbers } } },
        {
            $lookup: {
                from: "vendors-2.0",
                localField: "contactId",
                foreignField: "xeroId",
                as: "vendorDoc",
            },
        },
        {
            $addFields: {
                supplierName: { $arrayElemAt: ["$vendorDoc.name", 0] },
            },
        },
        { $sort: { invoiceNumber: 1, fromXero: -1 } },
        {
            $project: {
                _id: 0,
                invoiceNumber: 1,
                supplierName: 1,
                amount: 1,
                currency: 1,
                date: 1,
                dueDate: 1,
                fromXero: 1,
                description: 1,
                jobNumber: 1,
                status: 1,
            },
        },
    ]);

    const rows = invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber ?? "",
        supplier: inv.supplierName ?? "",
        amount: inv.amount != null ? inv.amount : "",
        currency: inv.currency ?? "",
        date: inv.date ? new Date(inv.date).toISOString().slice(0, 10) : "",
        dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : "",
        source: inv.fromXero ? "Xero" : "File",
        description: inv.description ?? "",
        jobNumber: inv.jobNumber ?? "",
        status: inv.status ?? "",
    }));

    res.status(200).json({ success: true, invoices: rows });
});

/**
 * GET /api/v2/dashboard/dashboard-data
 * Returns the latest *statement* process log for the current user (process must have at least one id starting with "s-").
 * Then: count of statement ids (s-*), Statement documents for those ids, and Invoice documents for i-* ids with fromXero false.
 */
exports.getDashboardData = tryCatchAsync(async (req, res) => {
    const userId = req.user?._id;
    const log = await ProcessLog.findOne({
        user: userId,
        ids: { $elemMatch: { $regex: /^s-/ } },
    })
        .sort({ createdAt: -1 })
        .limit(1)
        .lean();
    if (!log || !Array.isArray(log.ids)) {
        return res.status(200).json({ success: true, log: null, statementCount: 0, statements: [], invoices: [], supplierSummary: [] });
    }
    const statementIdStrings = log.ids
        .filter((id) => typeof id === "string" && id.startsWith("s-"))
        .map((id) => id.slice(2))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const statementCount = statementIdStrings.length;
    const statementObjectIds = statementIdStrings.map((id) => new mongoose.Types.ObjectId(id));
    const invoiceIdStrings = log.ids
        .filter((id) => typeof id === "string" && id.startsWith("i-"))
        .map((id) => id.slice(2))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const invoiceObjectIds = invoiceIdStrings.map((id) => new mongoose.Types.ObjectId(id));

    const [statements, invoices] = await Promise.all([
        statementObjectIds.length > 0
            ? Statement.find({ _id: { $in: statementObjectIds }, isDeleted: { $ne: true } }).lean()
            : Promise.resolve([]),
        invoiceObjectIds.length > 0
            ? Invoice.find({
                _id: { $in: invoiceObjectIds },
                fromXero: false,
                isDeleted: { $ne: true },
            }).lean()
            : Promise.resolve([]),
    ]);

    const invoiceNumbers = [...new Set(invoices.map((inv) => inv.invoiceNumber).filter(Boolean))];
    const xeroInvoices = invoiceNumbers.length > 0
        ? await Invoice.find({
            invoiceNumber: { $in: invoiceNumbers },
            fromXero: true,
            isDeleted: { $ne: true },
        }).lean()
        : [];
    const xeroByNumber = new Map(xeroInvoices.map((inv) => [inv.invoiceNumber, inv]));

    // Tab 1: include all file invoices from the statement (including paid). Paid ones are marked with issue "paid" and status "Paid" in supplierSummary.
    const fileInvoicesForTab1 = invoices;

    const keptFileInvoiceNumbers = new Set(fileInvoicesForTab1.map((inv) => inv.invoiceNumber).filter(Boolean));
    const xeroInvoicesForTab1 = xeroInvoices.filter((inv) => keptFileInvoiceNumbers.has(inv.invoiceNumber));

    const isPaidForTotal = (inv) => inv.status === "paid" || (inv.invoiceNumber && xeroByNumber.get(inv.invoiceNumber)?.status === "paid");
    const unpaidFileInvsForTotal = fileInvoicesForTab1.filter((inv) => !isPaidForTotal(inv));
    const invoicesAmountTotal = unpaidFileInvsForTotal
        .reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0)
        .toFixed(2);
    let xeroTotal = 0;
    for (const inv of unpaidFileInvsForTotal) {
        const xeroInv = inv.invoiceNumber ? xeroByNumber.get(inv.invoiceNumber) : null;
        if (xeroInv) xeroTotal += Number(xeroInv.amount) || 0;
    }
    const xeroInvoicesAmountTotal = Number(xeroTotal.toFixed(2)).toFixed(2);

    const pairsSameAmount = [];
    const pairsDiffAmount = [];
    const pairedFileIds = new Set();
    for (const fileInv of fileInvoicesForTab1) {
        const xeroInv = fileInv.invoiceNumber ? xeroByNumber.get(fileInv.invoiceNumber) : null;
        if (!xeroInv) continue;
        const fileAmount = Number(fileInv.amount) || 0;
        const xeroAmount = Number(xeroInv.amount) || 0;
        pairedFileIds.add(String(fileInv._id));
        const fileRounded = Math.round(fileAmount * 100) / 100;
        const xeroRounded = Math.round(xeroAmount * 100) / 100;
        if (fileRounded === xeroRounded) {
            pairsSameAmount.push([fileInv, xeroInv]);
        } else {
            pairsDiffAmount.push([fileInv, xeroInv]);
        }
    }
    const pairedInvoices = pairsDiffAmount;

    const contactIdsInPaired = [
        ...new Set(
            pairsSameAmount.flatMap(([fileInv, xeroInv]) => [
                fileInv.contactId,
                xeroInv.contactId,
            ].filter(Boolean))
        ),
    ];
    const contactIdsInNonPaired = [
        ...new Set(
            [
                ...fileInvoicesForTab1.filter((inv) => !pairedFileIds.has(String(inv._id))),
                ...pairsDiffAmount.map(([fileInv]) => fileInv),
            ]
                .map((inv) => inv.contactId)
                .filter(Boolean)
        ),
    ];
    const nonPairedSet = new Set(contactIdsInNonPaired);
    const contactIdsInPairedFiltered = contactIdsInPaired.filter((id) => !nonPairedSet.has(id));

    // All suppliers that were in the process (from all file invoices)
    const allProcessContactIds = [...new Set(invoices.map((inv) => inv.contactId).filter(Boolean))];
    // Suppliers whose process invoices are all paid (file inv status paid or paired xero is paid)
    const contactIdsFullyPaid = allProcessContactIds.filter((contactId) => {
        const invs = fileInvoicesForTab1.filter((inv) => inv.contactId === contactId);
        return invs.length > 0 && invs.every((inv) => {
            const xeroInv = inv.invoiceNumber ? xeroByNumber.get(inv.invoiceNumber) : null;
            return inv.status === "paid" || (xeroInv && xeroInv.status === "paid");
        });
    });
    const contactIdsReconciled = [
        ...new Set([...contactIdsInPairedFiltered, ...contactIdsFullyPaid]),
    ];

    const currencies = [
        ...new Set([
            ...fileInvoicesForTab1.map((inv) => inv.currency ?? "GBP"),
            ...xeroInvoicesForTab1.map((inv) => inv.currency ?? "GBP"),
        ]),
    ];

    // All suppliers that were in the process (from all file invoices), not only those with kept invoices.
    // Tab 1: only vendors where supplier is true.
    const allContactIds = [...new Set(invoices.map((inv) => inv.contactId).filter(Boolean))];
    const vendors = allContactIds.length > 0
        ? await Vendor.find({ xeroId: { $in: allContactIds }, isDeleted: { $ne: true }, supplier: true })
            .select("xeroId name")
            .lean()
        : [];
    const vendorNameByContactId = new Map(vendors.map((v) => [v.xeroId, v.name || v.xeroId]));
    const contactIds = allContactIds.filter((id) => vendorNameByContactId.has(id));

    const invoicesWithIssues = fileInvoicesForTab1
        .filter((inv) => inv.status === "unpaid")
        .filter((inv) => {
            const xeroInv = inv.invoiceNumber ? xeroByNumber.get(inv.invoiceNumber) : null;
            if (!xeroInv) return true;
            const fileCur = resolveInvoiceCurrency(inv, xeroInv);
            const xeroCur = resolveInvoiceCurrency(xeroInv, inv);
            return fileCur !== xeroCur;
        })
        .map((inv) => {
            const xeroInv = inv.invoiceNumber ? xeroByNumber.get(inv.invoiceNumber) : null;
            const issue = !xeroInv ? "NO_PAIR" : "CURRENCY_MISMATCH";
            const date = inv.date ? new Date(inv.date).toISOString().slice(0, 10) : "";
            const resolvedCurrency = resolveInvoiceCurrency(inv, xeroInv);
            return {
                _id: inv._id,
                invoiceNumber: inv.invoiceNumber || "",
                amount: inv.amount,
                currency: resolvedCurrency,
                date,
                contactId: inv.contactId,
                supplier: vendorNameByContactId.get(inv.contactId) || inv.contactId,
                issue,
            };
        });

    const pairsDiffAmountByFileId = new Set(pairsDiffAmount.map(([f]) => String(f._id)));
    const pairsSameAmountByFileId = new Set(pairsSameAmount.map(([f]) => String(f._id)));

    const supplierSummary = contactIds.map((contactId) => {
        const fileInvs = fileInvoicesForTab1.filter((inv) => inv.contactId === contactId);
        const isPaidInv = (inv) => inv.status === "paid" || (inv.invoiceNumber && xeroByNumber.get(inv.invoiceNumber)?.status === "paid");
        const classifyInvoice = (inv) => {
            const xeroInv = inv.invoiceNumber ? xeroByNumber.get(inv.invoiceNumber) : null;
            const isPaid = isPaidInv(inv);
            const hasPair = pairedFileIds.has(String(inv._id));
            const hasMismatch = pairsDiffAmountByFileId.has(String(inv._id));
            // Tab 1 actionable issue = unpaid invoice that is missing in Xero or amount-mismatched.
            const isActionableIssue = !isPaid && (!hasPair || hasMismatch);
            return { inv, xeroInv, isPaid, hasPair, hasMismatch, isActionableIssue };
        };

        const classifiedInvoices = fileInvs.map(classifyInvoice);
        const unpaidClassified = classifiedInvoices.filter((c) => !c.isPaid);
        const paidCount = classifiedInvoices.filter((c) => c.isPaid).length;
        const unpaid = unpaidClassified.length;
        const issues = classifiedInvoices.filter((c) => c.isActionableIssue).length;
        const status = issues === 0 ? "No action needed" : "Action Needed";

        const theySay = unpaidClassified.reduce((sum, c) => sum + (Number(c.inv.amount) || 0), 0);
        const xeroSays = unpaidClassified.reduce((sum, c) => {
            if (!c.xeroInv) return sum;
            return sum + (Number(c.xeroInv.amount) || 0);
        }, 0);
        const supplierCurrency = unpaidClassified.length > 0
            ? resolveInvoiceCurrency(unpaidClassified[0].inv, unpaidClassified[0].xeroInv)
            : (fileInvs.length > 0 ? resolveInvoiceCurrency(fileInvs[0], fileInvs[0].invoiceNumber ? xeroByNumber.get(fileInvs[0].invoiceNumber) : null) : "GBP");

        const invoicesNeedAttention = classifiedInvoices
            .filter((c) => c.isActionableIssue)
            .map((c) => {
                const inv = c.inv;
                const xeroInv = c.xeroInv;
                const supplierAmt = Math.round((Number(inv.amount) || 0) * 100) / 100;
                const noPair = !xeroInv;
                const xeroAmt = noPair ? null : Math.round((Number(xeroInv.amount) || 0) * 100) / 100;
                const difference = noPair ? supplierAmt : Math.round((xeroAmt - supplierAmt) * 100) / 100;
                const fileCur = resolveInvoiceCurrency(inv, xeroInv);
                const xeroCur = xeroInv ? resolveInvoiceCurrency(xeroInv, inv) : null;
                const sameCurrency = xeroCur && fileCur === xeroCur;
                const diffOrig = noPair
                    ? supplierAmt
                    : (sameCurrency && inv.amount != null && xeroInv?.amount != null
                        ? Math.round((Number(xeroInv.amount) - Number(inv.amount)) * 100) / 100
                        : null);
                const issue = noPair ? "MISSING FROM XERO" : "AMOUNT MISMATCH";
                const date = inv.date
                    ? new Date(inv.date).toISOString().slice(0, 10)
                    : "";
                const resolvedSupplierCurrency = resolveInvoiceCurrency(inv, xeroInv);
                const resolvedXeroCurrency = xeroInv ? resolveInvoiceCurrency(xeroInv, inv) : null;
                return {
                    _id: inv._id,
                    invoiceNumber: inv.invoiceNumber || "",
                    date,
                    currency: resolvedSupplierCurrency,
                    supplierAmountOriginal: inv.amount != null ? Number(inv.amount) : null,
                    supplierCurrencyOriginal: resolvedSupplierCurrency,
                    xeroAmountOriginal: xeroInv?.amount != null ? Number(xeroInv.amount) : null,
                    xeroCurrencyOriginal: resolvedXeroCurrency ?? "GBP",
                    supplierOriginalAmount: inv.amount != null ? Number(inv.amount) : null,
                    differenceOriginal: diffOrig,
                    differenceOriginalCurrency: diffOrig != null ? resolvedSupplierCurrency : null,
                    issue,
                    supplierAmt,
                    xeroAmt,
                    difference,
                    status: "Unpaid",
                };
            });

        const invoicesViewAll = fileInvs.map((inv) => {
            const isPaid = inv.status === "paid" || (inv.invoiceNumber && xeroByNumber.get(inv.invoiceNumber)?.status === "paid");
            const xeroInv = inv.invoiceNumber ? xeroByNumber.get(inv.invoiceNumber) : null;
            const supplierAmt = Math.round((Number(inv.amount) || 0) * 100) / 100;
            const noPair = !xeroInv;
            const xeroAmt = noPair ? null : Math.round((Number(xeroInv.amount) || 0) * 100) / 100;
            const difference = noPair ? supplierAmt : Math.round((xeroAmt - supplierAmt) * 100) / 100;
            const fileCur = resolveInvoiceCurrency(inv, xeroInv);
            const xeroCur = xeroInv ? resolveInvoiceCurrency(xeroInv, inv) : null;
            const sameCurrency = xeroCur && fileCur === xeroCur;
            const diffOrig = noPair
                ? supplierAmt
                : (sameCurrency && inv.amount != null && xeroInv?.amount != null
                    ? Math.round((Number(xeroInv.amount) - Number(inv.amount)) * 100) / 100
                    : null);
            const hasMismatch = pairsDiffAmountByFileId.has(String(inv._id));
            const issue = isPaid ? "paid" : (noPair ? "MISSING FROM XERO" : (hasMismatch ? "AMOUNT MISMATCH" : "Matched"));
            const date = inv.date
                ? new Date(inv.date).toISOString().slice(0, 10)
                : "";
            const resolvedSupplierCurrency = resolveInvoiceCurrency(inv, xeroInv);
            const resolvedXeroCurrency = xeroInv ? resolveInvoiceCurrency(xeroInv, inv) : null;
            return {
                _id: inv._id,
                invoiceNumber: inv.invoiceNumber || "",
                date,
                currency: resolvedSupplierCurrency,
                supplierAmountOriginal: inv.amount != null ? Number(inv.amount) : null,
                supplierCurrencyOriginal: resolvedSupplierCurrency,
                xeroAmountOriginal: xeroInv?.amount != null ? Number(xeroInv.amount) : null,
                xeroCurrencyOriginal: resolvedXeroCurrency ?? "GBP",
                supplierOriginalAmount: inv.amount != null ? Number(inv.amount) : null,
                differenceOriginal: diffOrig,
                differenceOriginalCurrency: diffOrig != null ? resolvedSupplierCurrency : null,
                issue,
                supplierAmt,
                xeroAmt,
                difference,
                status: isPaid ? "Paid" : "Unpaid",
            };
        });

        return {
            supplier: vendorNameByContactId.get(contactId) || contactId,
            contactId,
            theySay: Math.round(theySay * 100) / 100,
            xeroSays: Math.round(xeroSays * 100) / 100,
            supplierCurrency,
            unpaid,
            paidCount,
            issues,
            status,
            invoicesNeedAttention,
            invoicesViewAll,
        };
    });

    res.status(200).json({
        success: true,
        log,
        statementCount,
        invoices: fileInvoicesForTab1,
        xeroInvoices: xeroInvoicesForTab1,
        currencies,
        supplierSummary,
        invoicesWithIssues,
        xeroInvoicesLength: xeroInvoicesForTab1.length,
        invoicesLength: fileInvoicesForTab1.length,
        invoicesAmountTotal,
        xeroInvoicesAmountTotal,
        pairedInvoices,
        contactIdsInPaired: contactIdsReconciled,
        contactIdsInNonPaired,
    });
});


/**
 * GET /api/v2/dashboard/dashboard-tab-2
 * Returns actionable invoice issues grouped by supplier (contactId).
 * Matchup rule: one invoice with fromXero false (file) and one with fromXero true (xero),
 * same supplier (contactId) and same invoice number → match them as a pair; show as one row in the frontend.
 * Uses stored invoice amounts directly (no currency conversion).
 * Paid invoices are excluded, and if either side of a pair is paid the whole pair is excluded from Tab 2.
 */
exports.getDashboardTab2 = tryCatchAsync(async (req, res) => {
    const allInvoices = await Invoice.find({
        isDeleted: { $ne: true },
    })
        .lean();
    const invoices = allInvoices;
    const contactIdsFromInvoices = [...new Set(invoices.map((inv) => inv.contactId).filter(Boolean))];
    const vendors = contactIdsFromInvoices.length > 0
        ? await Vendor.find({ xeroId: { $in: contactIdsFromInvoices }, isDeleted: { $ne: true }, supplier: true })
            .select("xeroId name")
            .lean()
        : [];
    const vendorNameByContactId = new Map(vendors.map((v) => [v.xeroId, v.name || v.xeroId]));
    const validContactIds = new Set(vendorNameByContactId.keys());
    const invoicesWithValidSupplier = invoices.filter((inv) => validContactIds.has(inv.contactId || ""));

    const contactIds = [...new Set(invoicesWithValidSupplier.map((inv) => inv.contactId).filter(Boolean))];
    const bySupplier = contactIds.map((contactId) => {
            const supplierInvoices = invoicesWithValidSupplier.filter((inv) => inv.contactId === contactId);
            const includedInvoiceIds = new Set();
            const byInvoiceNumber = new Map();
            for (const inv of supplierInvoices) {
                const num = (inv.invoiceNumber && String(inv.invoiceNumber).trim()) || "";
                if (!byInvoiceNumber.has(num)) byInvoiceNumber.set(num, []);
                byInvoiceNumber.get(num).push(inv);
            }
            const pairs = [];
            const unpairedInvoices = [];
            let theySay = 0;
            let xeroSays = 0;
            const theySayByCurrency = {};
            const xeroSaysByCurrency = {};
            const supplierCurrency = normalizeCurrency(
                supplierInvoices.find((inv) => inv.fromXero === false)?.currency
            ) || normalizeCurrency(supplierInvoices[0]?.currency) || "GBP";
            for (const [, invs] of byInvoiceNumber) {
                const fileCandidates = invs.filter((i) => i.fromXero === false);
                const xeroCandidates = invs.filter((i) => i.fromXero === true);
                const fileInv = fileCandidates.find((i) => i.status !== "paid") || fileCandidates[0];
                const xeroInv = xeroCandidates.find((i) => i.status !== "paid") || xeroCandidates[0];
                if (fileInv && xeroInv) {
                    const pairHasPaid = fileInv.status === "paid" || xeroInv.status === "paid";
                    if (pairHasPaid) continue;
                    const fileAmount = Math.round((Number(fileInv.amount) || 0) * 100) / 100;
                    const xeroAmount = Math.round((Number(xeroInv.amount) || 0) * 100) / 100;
                    const fileCurrencyOriginal = resolveInvoiceCurrency(fileInv, xeroInv);
                    const xeroCurrencyOriginal = resolveInvoiceCurrency(xeroInv, fileInv);
                    const sameCurrency = fileCurrencyOriginal === xeroCurrencyOriginal;
                    const label = sameCurrency && fileAmount === xeroAmount ? "perfect match" : "amount mismatch";
                    const difference = sameCurrency
                        ? Math.round((xeroAmount - fileAmount) * 100) / 100
                        : null;
                    const differenceOriginal = difference;
                    theySay += fileAmount;
                    xeroSays += xeroAmount;
                    addCurrencyAmount(theySayByCurrency, fileCurrencyOriginal, fileAmount);
                    addCurrencyAmount(xeroSaysByCurrency, xeroCurrencyOriginal, xeroAmount);
                    includedInvoiceIds.add(String(fileInv._id));
                    includedInvoiceIds.add(String(xeroInv._id));
                    pairs.push({
                        fileInvoice: fileInv,
                        xeroInvoice: xeroInv,
                        fileAmount,
                        xeroAmount,
                        // Keep legacy keys for current frontend compatibility.
                        fileAmountGBP: fileAmount,
                        xeroAmountGBP: xeroAmount,
                        difference,
                        differenceOriginal,
                        differenceOriginalCurrency: differenceOriginal != null ? fileCurrencyOriginal : null,
                        fileCurrencyOriginal,
                        xeroCurrencyOriginal,
                        label,
                    });
                } else {
                    for (const inv of invs) {
                        if (inv.status === "paid") continue;
                        const amount = Number(inv.amount) || 0;
                        const amountRounded = Math.round(amount * 100) / 100;
                        const currency = normalizeCurrency(inv.currency) || "GBP";
                        if (inv.fromXero === false) {
                            theySay += amountRounded;
                            addCurrencyAmount(theySayByCurrency, currency, amountRounded);
                        } else {
                            xeroSays += amountRounded;
                            addCurrencyAmount(xeroSaysByCurrency, currency, amountRounded);
                        }
                        unpairedInvoices.push({
                            invoiceNumber: inv.invoiceNumber,
                            amount: inv.amount,
                            amountOriginal: amountRounded,
                            // Keep legacy key for current frontend compatibility.
                            amountGBP: amountRounded,
                            currency: currency,
                            supplierAmountOriginal: inv.fromXero === false ? (inv.amount != null ? Number(inv.amount) : null) : null,
                            supplierCurrencyOriginal: inv.fromXero === false ? currency : null,
                            xeroAmountOriginal: inv.fromXero === true ? (inv.amount != null ? Number(inv.amount) : null) : null,
                            xeroCurrencyOriginal: inv.fromXero === true ? currency : null,
                            dueDate: inv.dueDate,
                            date: inv.date,
                            status: inv.status,
                            fromXero: inv.fromXero,
                            _id: inv._id,
                            isZero: amount === 0,
                        });
                        includedInvoiceIds.add(String(inv._id));
                    }
                }
            }
            const actionableInvoices = supplierInvoices.filter((inv) => includedInvoiceIds.has(String(inv._id)));
            return {
                contactId,
                supplier: vendorNameByContactId.get(contactId) || contactId,
                invoices: actionableInvoices,
                pairs,
                unpairedInvoices,
                theySay: Math.round(theySay * 100) / 100,
                xeroSays: Math.round(xeroSays * 100) / 100,
                supplierCurrency,
                theySayByCurrency,
                xeroSaysByCurrency,
                theySayTotals: Object.entries(theySayByCurrency).map(([currency, amount]) => ({ currency, amount })),
                xeroSaysTotals: Object.entries(xeroSaysByCurrency).map(([currency, amount]) => ({ currency, amount })),
            };
        });
    res.status(200).json({ success: true, bySupplier });
});

/**
 * GET /api/v2/dashboard/dashboard-tab-3
 * Only display items that are pairs: same supplier, same invoice number, one from file and one from Xero.
 * Xero (fromXero true) is in pounds; file (fromXero false) uses listed currency or fallback GBP.
 * Convert file amount to GBP; if equal to Xero amount in GBP, it's a pair.
 * Count one amount per pair (do not double-count). Return pair count, pairs overdue, and total amount in GBP.
 */
exports.getDashboardTab3 = tryCatchAsync(async (req, res) => {
    const unpaidInvoices = await Invoice.find({
        status: "unpaid",
        isDeleted: { $ne: true },
    })
        .lean();
    const allContactIds = [...new Set(unpaidInvoices.map((inv) => inv.contactId).filter(Boolean))];
    const vendors = allContactIds.length > 0
        ? await Vendor.find({ xeroId: { $in: allContactIds }, isDeleted: { $ne: true }, supplier: true })
            .select("xeroId name")
            .lean()
        : [];
    const vendorNameByContactId = new Map(vendors.map((v) => [v.xeroId, v.name || v.xeroId]));
    const contactIds = allContactIds.filter((id) => vendorNameByContactId.has(id));

    const currencies = new Set(
        unpaidInvoices.map((inv) => (inv.currency && String(inv.currency).toUpperCase()) || "GBP")
    );
    const needsRates = [...currencies].some((c) => c && c !== "GBP");
    let rates = {};
    if (needsRates) {
        try {
            const res = await fetch(FRANKFURTER_LATEST_GBP);
            const data = await res.json();
            if (data && typeof data.rates === "object") rates = data.rates;
        } catch (_) {
            // keep rates {} so toAmountGBP falls back to treating unknown as 1:1
        }
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const bySupplier = contactIds
        .map((contactId) => {
            const supplierInvoices = unpaidInvoices.filter((inv) => inv.contactId === contactId);
            const byInvoiceNumber = new Map();
            for (const inv of supplierInvoices) {
                const num = (inv.invoiceNumber && String(inv.invoiceNumber).trim()) || "";
                if (!byInvoiceNumber.has(num)) byInvoiceNumber.set(num, []);
                byInvoiceNumber.get(num).push(inv);
            }
            const sameAmountPairs = [];
            for (const [, invs] of byInvoiceNumber) {
                const fileInv = invs.find((i) => i.fromXero === false);
                const xeroInv = invs.find((i) => i.fromXero === true);
                if (!fileInv || !xeroInv) continue;
                if (fileInv.contactId !== xeroInv.contactId) continue;
                const fileAmountGBP = toAmountGBP(fileInv, rates, xeroInv);
                const xeroAmountGBP = toAmountGBP(xeroInv, rates, fileInv);
                const fileRounded = Math.round(fileAmountGBP * 100) / 100;
                const xeroRounded = Math.round(xeroAmountGBP * 100) / 100;
                if (fileRounded !== xeroRounded) continue;
                sameAmountPairs.push({
                    fileInvoice: fileInv,
                    xeroInvoice: xeroInv,
                    fileAmountGBP: fileRounded,
                    xeroAmountGBP: xeroRounded,
                    differenceGBP: 0,
                });
            }
            if (sameAmountPairs.length === 0) return null;
            const pairCount = sameAmountPairs.length;
            const amountGBP = sameAmountPairs.reduce((sum, p) => sum + (p.fileAmountGBP ?? 0), 0);
            const amountGBPRounded = Math.round(amountGBP * 100) / 100;
            let pairsOverdue = 0;
            for (const p of sameAmountPairs) {
                const due = p.fileInvoice?.dueDate || p.xeroInvoice?.dueDate;
                if (due) {
                    const dueDate = new Date(due);
                    dueDate.setHours(0, 0, 0, 0);
                    if (dueDate.getTime() <= todayStart.getTime()) pairsOverdue += 1;
                }
            }
            return {
                contactId,
                supplier: vendorNameByContactId.get(contactId) || contactId,
                pairs: sameAmountPairs,
                pairCount,
                pairsOverdue,
                amountGBP: amountGBPRounded,
                theySay: amountGBPRounded,
                xeroSays: amountGBPRounded,
                difference: 0,
                unpaid: pairCount,
            };
        })
        .filter(Boolean);
    res.status(200).json({ success: true, bySupplier });
});

/**
 * POST /api/v2/dashboard/mark-invoices-paid
 * Body: { invoiceIds: string[] } - array of Invoice _ids (both file and xero for each pair).
 * Sets status to "paid" for all given invoices and logs the process.
 */
exports.markInvoicesPaid = tryCatchAsync(async (req, res) => {
    const { invoiceIds } = req.body;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).json({ success: false, message: "Please select at least one invoice to mark as paid." });
    }
    const validIds = invoiceIds.filter((id) => id && mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
        return res.status(400).json({ success: false, message: "We couldn't update those invoices. Please try again." });
    }
    const result = await Invoice.updateMany(
        { _id: { $in: validIds } },
        { $set: { status: "paid", modifiedLast: new Date() } }
    );
    const userId = req.user?._id ?? null;
    const pairCount = Math.floor(result.modifiedCount / 2);
    await logProcess(
        `Marked ${pairCount} invoice(s) as paid (dashboard Tab 3)`,
        validIds,
        userId
    );
    res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
});

/**
 * POST /api/v2/dashboard/undo-mark-invoices-paid
 * Body: { invoiceIds: string[] } - same ids that were previously marked paid.
 * Sets status back to "unpaid" and logs the undo.
 */
exports.undoMarkInvoicesPaid = tryCatchAsync(async (req, res) => {
    const { invoiceIds } = req.body;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).json({ success: false, message: "Please select at least one invoice to update." });
    }
    const validIds = invoiceIds.filter((id) => id && mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
        return res.status(400).json({ success: false, message: "We couldn't update those invoices. Please try again." });
    }
    const result = await Invoice.updateMany(
        { _id: { $in: validIds } },
        { $set: { status: "unpaid", modifiedLast: new Date() } }
    );
    const userId = req.user?._id ?? null;
    const pairCount = Math.floor(result.modifiedCount / 2);
    await logProcess(
        `Undo: marked ${pairCount} invoice(s) back to unpaid (dashboard Tab 3)`,
        validIds,
        userId
    );
    res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
});

/**
 * GET /api/v2/dashboard/xero-sync-status
 * Returns the last successful Xero sync timestamp for the "Last synced" indicator.
 */
exports.getXeroSyncStatus = tryCatchAsync(async (req, res) => {
    const state = await XeroSyncState.findOne().select('lastSuccessAt').lean();
    res.status(200).json({
        success: true,
        lastSyncedAt: state?.lastSuccessAt || null,
    });
});

/**
 * POST /api/v2/dashboard/xero-sync-now
 * Force an immediate invoice sync from Xero.
 */
exports.syncNowWithXero = tryCatchAsync(async (req, res) => {
    const result = await syncIncrementalInvoicesFromXero(req, { force: true });
    if (result?.reason === "in_progress") {
        return res.status(409).json({
            success: false,
            message: "A Xero sync is already running. Please wait a moment and try again.",
        });
    }
    if (result?.reason === "missing_xero_auth") {
        return res.status(401).json({
            success: false,
            message: "Xero authentication required. Ensure you are connected to Xero.",
        });
    }

    const state = await XeroSyncState.findOne().select("lastSuccessAt").lean();
    return res.status(200).json({
        success: true,
        message: "Xero sync completed.",
        syncedCount: result?.syncedCount ?? 0,
        lastSyncedAt: state?.lastSuccessAt || result?.lastSyncedAt || null,
    });
});

/**
 * DELETE /api/v2/dashboard/invoices/:id
 * Soft-delete a single invoice.
 */
exports.hardDeleteInvoice = tryCatchAsync(async (req, res) => {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Valid invoice id is required." });
    }
    const invoice = await Invoice.findOne({ _id: id, isDeleted: { $ne: true } }).select("_id").lean();
    if (!invoice) {
        return res.status(404).json({ success: false, message: "Invoice not found." });
    }
    await Invoice.updateOne(
        { _id: id },
        { $set: { isDeleted: true, modifiedLast: new Date() } }
    );
    const userId = req.user?._id ?? null;
    await logProcess(`Soft-deleted invoice ${id} (dashboard)`, [id], userId);
    res.status(200).json({ success: true, message: "Invoice deleted." });
});
