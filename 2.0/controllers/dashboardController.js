const { tryCatchAsync } = require("../../controllers/ErrorController");
const Invoice = require("../modals/invoiceModal");
const Team = require("../modals/teamModal");
const User = require("../../modals/userModal");

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
                contactId: 0,
                vendorDoc: 0,
                isDeleted: 0,
                modifiedLast: 0,
                statementId: 0,
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
