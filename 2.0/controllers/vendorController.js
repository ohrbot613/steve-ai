const { tryCatchAsync } = require("../../controllers/ErrorController");
const Vendor = require("../modals/vendorModal");
const Invoice = require("../modals/invoiceModal");

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** contactIds (xeroIds) that have at least one invoice: unpaid OR fromXero false. One indexed query. */
async function getQualifyingContactIds() {
    return Invoice.distinct("contactId", {
        isDeleted: { $ne: true },
        $or: [{ status: "unpaid" }, { fromXero: false }],
    });
}

/**
 * Get first 50 vendors (suppliers) from the 2.0 database with optional pagination and search.
 * Only returns suppliers that have unpaid invoices OR at least one invoice with fromXero === false.
 * Returns vendors with logCount/invoiceCount as 0; frontend should call getVendorCounts with same page/search to fill in counts.
 */
exports.getVendors = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Number(req.query.page) || 1;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const offset = (page - 1) * limit;

    const qualifyingContactIds = await getQualifyingContactIds();
    if (qualifyingContactIds.length === 0) {
        return res.status(200).json({
            success: true,
            suppliers: [],
            pages: 1,
            total: 0,
        });
    }

    const query = {
        isDeleted: { $ne: true },
        supplier: true,
        xeroId: { $in: qualifyingContactIds },
    };
    if (search) {
        query.name = { $regex: escapeRegex(search), $options: "i" };
    }

    const [vendors, total] = await Promise.all([
        Vendor.find(query).sort({ name: 1 }).skip(offset).limit(limit).lean(),
        Vendor.countDocuments(query),
    ]);

    const pages = Math.max(1, Math.ceil(total / limit));
    const suppliers = vendors.map((v) => ({
        ...v,
        logCount: 0,
        invoiceCount: 0,
    }));

    res.status(200).json({
        success: true,
        suppliers,
        pages,
        total,
    });
});

/**
 * Get statement and invoice counts for the vendors on the given page.
 * Only includes suppliers that have unpaid invoices OR at least one invoice with fromXero === false.
 * Call after getVendors with same page/search; merge counts into suppliers by _id.
 */
exports.getVendorCounts = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Number(req.query.page) || 1;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const offset = (page - 1) * limit;

    const qualifyingContactIds = await getQualifyingContactIds();
    if (qualifyingContactIds.length === 0) {
        return res.status(200).json({ success: true, counts: [] });
    }

    const query = {
        isDeleted: { $ne: true },
        supplier: true,
        xeroId: { $in: qualifyingContactIds },
    };
    if (search) {
        query.name = { $regex: escapeRegex(search), $options: "i" };
    }

    // Get this page of vendor ids only, then run count lookups just for them
    const pageVendors = await Vendor.find(query)
        .sort({ name: 1 })
        .skip(offset)
        .limit(limit)
        .select("_id xeroId")
        .lean();

    if (pageVendors.length === 0) {
        return res.status(200).json({ success: true, counts: [] });
    }

    const counts = await Vendor.aggregate([
        { $match: { _id: { $in: pageVendors.map((v) => v._id) } } },
        { $project: { _id: 1, xeroId: 1 } },
        {
            $lookup: {
                from: "statements-2.0",
                let: { xeroId: "$xeroId" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$contactId", "$$xeroId"] }, isDeleted: { $ne: true } } },
                    { $count: "count" },
                ],
                as: "logCountResult",
            },
        },
        {
            $lookup: {
                from: "invoices-2.0",
                let: { xeroId: "$xeroId" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$contactId", "$$xeroId"] }, isDeleted: { $ne: true } } },
                    { $count: "count" },
                ],
                as: "invoiceCountResult",
            },
        },
        {
            $project: {
                _id: 1,
                logCount: { $ifNull: [{ $arrayElemAt: ["$logCountResult.count", 0] }, 0] },
                invoiceCount: { $ifNull: [{ $arrayElemAt: ["$invoiceCountResult.count", 0] }, 0] },
            },
        },
    ]);

    res.status(200).json({
        success: true,
        counts,
    });
});
