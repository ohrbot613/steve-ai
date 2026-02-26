const path = require("path");
const fs = require("fs");
const { tryCatchAsync } = require("../../controllers/ErrorController");
const Vendor = require("../modals/vendorModal");
const Statement = require("../modals/statementModal");
const Invoice = require("../modals/invoiceModal");
const StatementsOld = require("../../modals/statementsModal");
const invoiceController = require("./invoiceController");

const STEVE_FILES_DIR = path.join(__dirname, "../steve_files_do_not_delete");
/** Main steve files folder at project root (same as InvoiceController / ViewController). */
const MAIN_STEVE_FILES_DIR = path.join(__dirname, "../../../steve_files_do_not_delete");

const LIMIT = 50;

function mapInvoiceToResponse(inv, vendor, reconciliationStatus) {
    const out = {
        _id: inv._id,
        vendorId: { _id: vendor._id, name: vendor.name },
        statementId: inv.statementId ? { _id: inv.statementId } : null,
        invoiceNumber: inv.invoiceNumber,
        vendorAmount: inv.amount,
        xeroAmount: inv.amount,
        VendorDate: inv.date,
        xeroDate: inv.date,
        paymentStatus: inv.status || "unpaid",
        vendorCurrency: inv.currency,
        xeroCurrency: inv.currency,
        createdAt: inv.createdAt,
        fromXero: inv.fromXero === true,
    };
    if (reconciliationStatus !== undefined) out.reconciliationStatus = reconciliationStatus;
    return out;
}

/**
 * GET /api/v2/supplier-logs/statements?id=<vendorId>
 */
exports.getStatementsByVendor = tryCatchAsync(async (req, res) => {
    const id = req.query.id;
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || "processDateTime";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const offset = (page - 1) * LIMIT;

    if (!id) return res.status(400).json({ success: false, message: "id (vendor id) is required" });

    const vendor = await Vendor.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!vendor?.xeroId) return res.status(200).json({ success: true, logs: [], pages: 0 });

    const contactId = vendor.xeroId;
    const sortField = sortBy === "statementIssueDate" ? "dateOnFile" : "createdAt";

    const pipeline = [
        { $match: { contactId, isDeleted: { $ne: true } } },
        { $lookup: { from: "invoices-2.0", localField: "_id", foreignField: "statementId", as: "invoices", pipeline: [{ $match: { isDeleted: { $ne: true } } }] } },
        // File invoices = those from the statement (fromXero false). A matched invoice = same invoice number has both fromXero true and false in DB.
        {
            $addFields: {
                fileInvoices: { $filter: { input: "$invoices", as: "inv", cond: { $eq: ["$$inv.fromXero", false] } } },
            }
        },
        {
            $addFields: {
                total: { $size: "$fileInvoices" },
                fileInvoiceNumbers: { $map: { input: "$fileInvoices", as: "inv", in: "$$inv.invoiceNumber" } },
                amountOriginal: {
                    $sum: {
                        $map: {
                            input: "$fileInvoices",
                            as: "inv",
                            in: {
                                $convert: {
                                    input: "$$inv.amount",
                                    to: "double",
                                    onError: 0,
                                    onNull: 0,
                                }
                            },
                        }
                    }
                },
                supplierCurrency: {
                    $ifNull: [{ $arrayElemAt: ["$fileInvoices.currency", 0] }, "GBP"]
                },
            }
        },
        {
            $lookup: {
                from: "invoices-2.0",
                let: { contactId: "$contactId", fileNumbers: "$fileInvoiceNumbers" },
                pipeline: [
                    { $match: { isDeleted: { $ne: true } } },
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$contactId", "$$contactId"] },
                                    { $eq: ["$fromXero", true] },
                                    { $in: ["$invoiceNumber", "$$fileNumbers"] },
                                ]
                            }
                        }
                    },
                ],
                as: "xeroMatches",
            }
        },
        {
            $addFields: {
                matchedCount: { $size: "$xeroMatches" },
            }
        },
        {
            $addFields: {
                reconciled: "$matchedCount",
                unreconciled: { $subtract: ["$total", "$matchedCount"] },
                status: {
                    $cond: {
                        if: { $eq: ["$total", 0] },
                        then: "not reconciled",
                        else: {
                            $cond: {
                                if: { $eq: ["$matchedCount", "$total"] }, then: "reconciled",
                                else: { $cond: { if: { $eq: ["$matchedCount", 0] }, then: "not reconciled", else: "partially reconciled" } }
                            },
                        },
                    },
                },
            }
        },
        { $project: { invoices: 0, fileInvoices: 0, fileInvoiceNumbers: 0, xeroMatches: 0, matchedCount: 0 } },
        { $sort: { [sortField]: sortOrder } },
        { $skip: offset },
        { $limit: LIMIT },
    ];

    const [logsRaw, total] = await Promise.all([
        Statement.aggregate(pipeline),
        Statement.countDocuments({ contactId, isDeleted: { $ne: true } }),
    ]);

    const logs = logsRaw.map((doc) => ({
        _id: doc._id,
        invoiceIssueDate: doc.dateOnFile,
        addedAt: doc.createdAt,
        file: doc.file,
        amountOriginal: doc.amountOriginal ?? 0,
        supplierCurrency: doc.supplierCurrency ?? "GBP",
        reconciled: doc.reconciled ?? 0,
        unreconciled: doc.unreconciled ?? 0,
        total: doc.total ?? 0,
        status: doc.status ?? "not reconciled",
        supplier: { _id: vendor._id, name: vendor.name },
    }));

    res.status(200).json({ success: true, logs, pages: Math.max(1, Math.ceil(total / LIMIT)) });
});

/**
 * GET /api/v2/supplier-logs/all-statements?page=&sortBy=&sortOrder=
 * All statements across all vendors (for All Statements page). Same shape as getStatementsByVendor logs.
 */
exports.getAllStatements = tryCatchAsync(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || "processDateTime";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const fast = req.query.fast === "1";
    const requestedLimit = Number(req.query.limit);
    const pageLimit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 500)
        : LIMIT;
    const contactId = req.query.contactId ? String(req.query.contactId).trim() : null;
    const offset = (page - 1) * pageLimit;

    const baseMatch = { isDeleted: { $ne: true } };
    if (contactId) baseMatch.contactId = contactId;

    const sortField =
        sortBy === "statementIssueDate"
            ? "dateOnFile"
            : sortBy === "supplier"
                ? "vendorName"
                : sortBy === "processDateTime"
                    ? "createdAt"
                    : sortBy === "status"
                        ? "status"
                        : sortBy === "reconciled"
                            ? "reconciled"
                            : sortBy === "unreconciled"
                                ? "unreconciled"
                                : sortBy === "total"
                                    ? "total"
                                    : "createdAt";

    const pipeline = [
        { $match: baseMatch },
        { $lookup: { from: "invoices-2.0", localField: "_id", foreignField: "statementId", as: "invoices", pipeline: [{ $match: { isDeleted: { $ne: true } } }] } },
        {
            $addFields: {
                fileInvoices: { $filter: { input: "$invoices", as: "inv", cond: { $eq: ["$$inv.fromXero", false] } } },
            }
        },
        {
            $addFields: {
                total: { $size: "$fileInvoices" },
                fileInvoiceNumbers: { $map: { input: "$fileInvoices", as: "inv", in: "$$inv.invoiceNumber" } },
                amountOriginal: {
                    $sum: {
                        $map: {
                            input: "$fileInvoices",
                            as: "inv",
                            in: {
                                $convert: {
                                    input: "$$inv.amount",
                                    to: "double",
                                    onError: 0,
                                    onNull: 0,
                                }
                            },
                        }
                    }
                },
                supplierCurrency: {
                    $ifNull: [{ $arrayElemAt: ["$fileInvoices.currency", 0] }, "GBP"]
                },
            }
        },
        ...(fast ? [] : [
            {
                $lookup: {
                    from: "invoices-2.0",
                    let: { contactId: "$contactId", fileNumbers: "$fileInvoiceNumbers" },
                    pipeline: [
                        { $match: { isDeleted: { $ne: true } } },
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ["$contactId", "$$contactId"] },
                                        { $eq: ["$fromXero", true] },
                                        { $in: ["$invoiceNumber", "$$fileNumbers"] },
                                    ]
                                }
                            }
                        },
                    ],
                    as: "xeroMatches",
                }
            },
            { $addFields: { matchedCount: { $size: "$xeroMatches" } } },
            {
                $addFields: {
                    reconciled: "$matchedCount",
                    unreconciled: { $subtract: ["$total", "$matchedCount"] },
                    status: {
                        $cond: {
                            if: { $eq: ["$total", 0] },
                            then: "not reconciled",
                            else: {
                                $cond: {
                                    if: { $eq: ["$matchedCount", "$total"] }, then: "reconciled",
                                    else: { $cond: { if: { $eq: ["$matchedCount", 0] }, then: "not reconciled", else: "partially reconciled" } }
                                },
                            },
                        },
                    },
                }
            },
        ]),
        {
            $lookup: {
                from: "vendors-2.0",
                let: { contactId: "$contactId" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$xeroId", "$$contactId"] } } },
                    { $limit: 1 },
                ],
                as: "vendorDoc",
            }
        },
        {
            $addFields: {
                vendorName: { $ifNull: [{ $arrayElemAt: ["$vendorDoc.name", 0] }, "Unknown Supplier"] },
                vendorId: { $arrayElemAt: ["$vendorDoc._id", 0] },
                ...(fast ? { reconciled: 0, unreconciled: 0, status: "not reconciled" } : {}),
            }
        },
        { $project: { invoices: 0, fileInvoices: 0, fileInvoiceNumbers: 0, xeroMatches: 0, matchedCount: 0, vendorDoc: 0 } },
        { $sort: { [sortField]: sortOrder } },
        { $skip: offset },
        { $limit: pageLimit },
    ];

    const [logsRaw, total] = await Promise.all([
        Statement.aggregate(pipeline),
        Statement.countDocuments(baseMatch),
    ]);

    const logs = logsRaw.map((doc) => ({
        _id: doc._id,
        contactId: doc.contactId ?? null,
        invoiceIssueDate: doc.dateOnFile,
        addedAt: doc.createdAt,
        file: doc.file,
        amountOriginal: doc.amountOriginal ?? 0,
        supplierCurrency: doc.supplierCurrency ?? "GBP",
        reconciled: doc.reconciled ?? 0,
        unreconciled: doc.unreconciled ?? 0,
        total: doc.total ?? 0,
        status: doc.status ?? "not reconciled",
        supplier: { _id: doc.vendorId, name: doc.vendorName },
    }));

    res.status(200).json({ success: true, logs, pages: Math.max(1, Math.ceil(total / pageLimit)) });
});

/**
 * GET /api/v2/supplier-logs/statement-contact-ids
 * Returns distinct contact ids that have at least one statement (with invoices), plus supplier name. Used by Tab 4 to fetch statements per supplier from DB by contact id.
 */
exports.getStatementContactIds = tryCatchAsync(async (req, res) => {
    const pipeline = [
        { $match: { isDeleted: { $ne: true } } },
        { $group: { _id: "$contactId" } },
        { $match: { _id: { $ne: null, $ne: "" } } },
        {
            $lookup: {
                from: "vendors-2.0",
                let: { contactId: "$_id" },
                pipeline: [
                    { $match: { $expr: { $eq: ["$xeroId", "$$contactId"] } } },
                    { $limit: 1 },
                    { $project: { name: 1 } },
                ],
                as: "v",
            },
        },
        { $addFields: { supplierName: { $ifNull: [{ $arrayElemAt: ["$v.name", 0] }, "Unknown Supplier"] } } },
        { $sort: { supplierName: 1 } },
        { $project: { contactId: "$_id", supplierName: 1, _id: 0 } },
    ];
    const list = await Statement.aggregate(pipeline);
    const contactIds = list.map((d) => ({ contactId: d.contactId, supplierName: d.supplierName }));
    res.status(200).json({ success: true, contactIds });
});

/**
 * GET /api/v2/supplier-logs/statement-transfer
 * Old statements (oldest to newest). For each, if a file exists in 2.0/steve_files_do_not_delete:
 * copy to main steve files, run processOneStatementFile, then delete the original on success.
 */
exports.statementTransfer = tryCatchAsync(async (req, res) => {
    const statements = await StatementsOld.find({ isDeleted: { $ne: true } })
        .lean()
        .sort({ addedAt: 1 });



    // return res.status(200).json({ success: true, statements });
    const results = [];
    for (const stmt of statements) {
        const fileName = stmt.file || "";
        const baseName = path.basename(fileName);
        const filePath = path.join(STEVE_FILES_DIR, baseName);
        const exists = fileName ? fs.existsSync(filePath) : false;

        if (!exists) {
            results.push({
                oldStatementId: stmt._id,
                file: fileName,
                addedAt: stmt.addedAt,
                copied: false,
                upload: null,
                message: "No matching file in steve_files_do_not_delete",
            });
            console.log(`[statement-transfer] skip (no file) | ${stmt.addedAt?.toISOString?.() ?? stmt.addedAt} | "${fileName}"`);
            continue;
        } else {
            console.log("file exists");
        }


        const buffer = fs.readFileSync(filePath);
        const safeName = (baseName || "statement").replace(/[^a-zA-Z0-9._-]/g, "_");
        const uniqueName = `${Date.now()}-${safeName}`;
        if (!fs.existsSync(MAIN_STEVE_FILES_DIR)) {
            fs.mkdirSync(MAIN_STEVE_FILES_DIR, { recursive: true });
        }
        const copyPath = path.join(MAIN_STEVE_FILES_DIR, uniqueName);
        fs.writeFileSync(copyPath, buffer);

        const uploadResult = await invoiceController.processOneStatementFile(buffer, uniqueName, req.user);

        if (uploadResult.success && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                console.log(`[statement-transfer] deleted original (already done): ${baseName}`);
            } catch (err) {
                console.error(`[statement-transfer] failed to delete original ${baseName}:`, err.message);
            }
        }

        results.push({
            oldStatementId: stmt._id,
            file: fileName,
            addedAt: stmt.addedAt,
            copied: true,
            copyName: uniqueName,
            deletedOriginal: uploadResult.success,
            upload: uploadResult.success
                ? { success: true, statementId: uploadResult.statementId, vendorId: uploadResult.vendorId, createdCount: uploadResult.createdCount }
                : { success: false, error: uploadResult.error },
        });
        console.log(
            `[statement-transfer] ${stmt.addedAt?.toISOString?.() ?? stmt.addedAt} | "${fileName}" -> ${uniqueName} | upload: ${uploadResult.success ? "ok" : uploadResult.error}`
        );
    }

    console.log("[statement-transfer] Summary:", JSON.stringify(results, null, 2));

    res.status(200).json({ success: true, logs: results, count: results.length });
});

/**
 * DELETE /api/v2/supplier-logs/statements/:id
 * Soft-delete a statement and its file invoices (statementId = this id, fromXero false).
 */
exports.deleteStatement = tryCatchAsync(async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: "Statement id is required" });

    const statement = await Statement.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!statement) return res.status(404).json({ success: false, message: "Statement not found" });

    const now = new Date();
    await Statement.updateOne({ _id: id }, { $set: { isDeleted: true, modifiedLast: now } });
    const deletedInvoicesResult = await Invoice.updateMany(
        { statementId: id, fromXero: false, isDeleted: { $ne: true } },
        { $set: { isDeleted: true, modifiedLast: now } }
    );
    const deletedInvoiceCount = deletedInvoicesResult?.modifiedCount ?? 0;

    let supplierFlagUpdated = false;
    let vendorId = null;
    if (statement.contactId) {
        const remainingFileInvoices = await Invoice.countDocuments({
            contactId: statement.contactId,
            fromXero: false,
            isDeleted: { $ne: true },
        });
        if (remainingFileInvoices === 0) {
            const vendorUpdate = await Vendor.updateOne(
                { xeroId: statement.contactId, supplier: true, isDeleted: { $ne: true } },
                { $set: { supplier: false, modifiedLast: now } }
            );
            supplierFlagUpdated = (vendorUpdate?.modifiedCount ?? 0) > 0;
            if (supplierFlagUpdated) {
                const vendor = await Vendor.findOne({ xeroId: statement.contactId }).select("_id").lean();
                vendorId = vendor?._id ?? null;
            }
        }
    }

    res.status(200).json({
        success: true,
        message: "Statement deleted",
        deletedInvoiceCount,
        supplierFlagUpdated,
        vendorId,
    });
});

/**
 * GET /api/v2/supplier-logs/invoices?supplierId=<vendorId>
 * All invoices: pairs (same invoice number, one fromXero true and one false) are merged into one row.
 * Unpaired invoices are returned as single rows. Merged rows have reconciliationStatus "fully reconciled".
 */
function allInvoicesRowSortKey(row, sortField) {
    const v = row[sortField];
    if (v instanceof Date) return v.getTime();
    if (v != null) return v;
    return sortField === "VendorDate" || sortField === "vendorAmount" ? Infinity : -Infinity;
}

exports.getInvoicesBySupplier = tryCatchAsync(async (req, res) => {
    const supplierId = req.query.supplierId;
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || "addedAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const paymentFilter = req.query.paymentFilter || "all";
    const offset = (page - 1) * LIMIT;

    if (!supplierId) return res.status(400).json({ success: false, message: "supplierId is required" });

    const vendor = await Vendor.findOne({ _id: supplierId, isDeleted: { $ne: true } }).lean();
    if (!vendor?.xeroId) return res.status(200).json({ success: true, invoices: [], pages: 0 });

    const contactId = vendor.xeroId;
    const sortFieldMap = { invoiceNumber: "invoiceNumber", supplierDate: "VendorDate", xeroDate: "xeroDate", supplierAmount: "vendorAmount", xeroAmount: "xeroAmount", addedAt: "createdAt", paymentStatus: "paymentStatus" };
    const sortField = sortFieldMap[sortBy] || "createdAt";

    // 1. Paired invoice numbers (both fromXero true and false)
    const pairedRows = await Invoice.aggregate([
        { $match: { contactId, isDeleted: { $ne: true } } },
        {
            $group: {
                _id: "$invoiceNumber",
                hasFromXero: { $max: { $cond: ["$fromXero", 1, 0] } },
                hasFromFile: { $max: { $cond: ["$fromXero", 0, 1] } },
            }
        },
        { $match: { hasFromXero: 1, hasFromFile: 1 } },
        { $project: { _id: 1 } },
    ]);
    const pairedNumbers = new Set(pairedRows.map((r) => r._id));

    // 2. Merged rows for pairs (same pipeline as matched-invoices, no pagination)
    const mergePipeline = [
        { $match: { contactId, isDeleted: { $ne: true } } },
        { $sort: { invoiceNumber: 1, fromXero: 1 } },
        { $group: { _id: "$invoiceNumber", docs: { $push: "$$ROOT" } } },
        {
            $match: {
                $expr: {
                    $and: [
                        { $eq: [{ $size: "$docs" }, 2] },
                        { $eq: [{ $size: { $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", true] } } } }, 1] },
                        { $eq: [{ $size: { $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", false] } } } }, 1] },
                    ],
                },
            }
        },
        {
            $addFields: {
                fileDoc: { $arrayElemAt: [{ $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", false] } } }, 0] },
                xeroDoc: { $arrayElemAt: [{ $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", true] } } }, 0] },
            }
        },
        ...(paymentFilter === "paid" ? [{ $match: { $or: [{ "fileDoc.status": "paid" }, { "xeroDoc.status": "paid" }] } }] : []),
        ...(paymentFilter === "unpaid" ? [{ $match: { $or: [{ "fileDoc.status": "unpaid" }, { "xeroDoc.status": "unpaid" }] } }] : []),
        {
            $project: {
                invoiceNumber: "$_id",
                vendorAmount: "$fileDoc.amount",
                xeroAmount: "$xeroDoc.amount",
                VendorDate: "$fileDoc.date",
                xeroDate: "$xeroDoc.date",
                vendorCurrency: "$fileDoc.currency",
                xeroCurrency: "$xeroDoc.currency",
                paymentStatus: { $ifNull: ["$xeroDoc.status", "unpaid"] },
                statementId: "$fileDoc.statementId",
                fileId: "$fileDoc._id",
                createdAt: "$xeroDoc.createdAt",
            }
        },
    ];
    const mergedRaw = await Invoice.aggregate(mergePipeline);
    const mergedRows = mergedRaw.map((row) => mapMatchedPairToResponse(row, vendor));

    // 3. Unpaired invoices (single row per invoice)
    const unpairedMatch = { contactId, isDeleted: { $ne: true }, invoiceNumber: { $nin: [...pairedNumbers] } };
    if (paymentFilter === "paid") unpairedMatch.status = "paid";
    if (paymentFilter === "unpaid") unpairedMatch.status = "unpaid";
    const unpairedInvoices = await Invoice.find(unpairedMatch).lean();
    const unpairedRows = unpairedInvoices.map((inv) => {
        const fromXero = inv.fromXero === true;
        return {
            _id: inv._id,
            vendorId: { _id: vendor._id, name: vendor.name },
            statementId: inv.statementId ? { _id: inv.statementId } : null,
            invoiceNumber: inv.invoiceNumber,
            vendorAmount: fromXero ? null : inv.amount,
            xeroAmount: fromXero ? inv.amount : null,
            VendorDate: fromXero ? null : inv.date,
            xeroDate: fromXero ? inv.date : null,
            paymentStatus: inv.status || "unpaid",
            vendorCurrency: fromXero ? null : inv.currency,
            xeroCurrency: fromXero ? inv.currency : null,
            createdAt: inv.createdAt,
            reconciliationStatus: "not reconciled",
            fromXero,
        };
    });

    // 4. Combine, sort, paginate
    const allRows = [...mergedRows, ...unpairedRows];
    allRows.sort((a, b) => {
        const ka = allInvoicesRowSortKey(a, sortField);
        const kb = allInvoicesRowSortKey(b, sortField);
        if (ka < kb) return sortOrder === 1 ? -1 : 1;
        if (ka > kb) return sortOrder === 1 ? 1 : -1;
        return 0;
    });
    const total = allRows.length;
    const pageRows = allRows.slice(offset, offset + LIMIT);

    res.status(200).json({ success: true, invoices: pageRows, pages: Math.max(1, Math.ceil(total / LIMIT)) });
});

/**
 * GET /api/v2/supplier-logs/all-invoices?page=&sortBy=&sortOrder=&filter=all|matched|unmatched|missed&paymentFilter=all|paid|unpaid
 * Cross-supplier: all invoices (merged pairs + unpaired), with optional filter by tab.
 */
function allInvoicesSortKey(row, sortBy) {
    if (sortBy === "supplier") return (row.vendorId?.name || "").toLowerCase();
    const v = row[sortBy];
    if (v instanceof Date) return v.getTime();
    if (v != null) return v;
    if (sortBy === "VendorDate" || sortBy === "vendorAmount") return Infinity;
    if (sortBy === "reconciliationStatus") return (row.reconciliationStatus || "").toLowerCase();
    return -Infinity;
}

exports.getAllInvoices = tryCatchAsync(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || "addedAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const filter = req.query.filter || "all";
    const paymentFilter = req.query.paymentFilter || "all";
    const offset = (page - 1) * LIMIT;

    const sortFieldMap = {
        supplier: "supplier",
        invoiceNumber: "invoiceNumber",
        supplierDate: "VendorDate",
        xeroDate: "xeroDate",
        supplierAmount: "vendorAmount",
        xeroAmount: "xeroAmount",
        addedAt: "createdAt",
        paymentStatus: "paymentStatus",
        status: "reconciliationStatus",
    };
    const sortField = sortFieldMap[sortBy] || "createdAt";

    const vendors = await Vendor.find({ isDeleted: { $ne: true }, xeroId: { $exists: true, $nin: [null, ""] } }).lean();
    const vendorByContactId = new Map();
    vendors.forEach((v) => vendorByContactId.set(v.xeroId, { _id: v._id, name: v.name }));

    const allInvoices = await Invoice.find({ isDeleted: { $ne: true } }).lean();
    const groupKey = (inv) => `${inv.contactId || ""}\n${inv.invoiceNumber || ""}`;
    const groups = new Map();
    allInvoices.forEach((inv) => {
        const key = groupKey(inv);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(inv);
    });

    const rows = [];
    for (const [, docs] of groups) {
        const fileDoc = docs.find((d) => d.fromXero === false);
        const xeroDoc = docs.find((d) => d.fromXero === true);
        const vendor = fileDoc ? vendorByContactId.get(fileDoc.contactId) : (xeroDoc ? vendorByContactId.get(xeroDoc.contactId) : null);
        const vendorInfo = vendor ? { _id: vendor._id, name: vendor.name } : { _id: null, name: "Unknown Supplier" };

        if (fileDoc && xeroDoc) {
            const merged = {
                _id: fileDoc._id,
                vendorId: vendorInfo,
                statementId: fileDoc.statementId ? { _id: fileDoc.statementId } : null,
                invoiceNumber: fileDoc.invoiceNumber,
                vendorAmount: fileDoc.amount,
                xeroAmount: xeroDoc.amount,
                VendorDate: fileDoc.date,
                xeroDate: xeroDoc.date,
                paymentStatus: xeroDoc.status || "unpaid",
                vendorCurrency: fileDoc.currency,
                xeroCurrency: xeroDoc.currency,
                createdAt: xeroDoc.createdAt,
                reconciliationStatus: "fully reconciled",
                _isMerged: true,
            };
            rows.push(merged);
        } else {
            docs.forEach((inv) => {
                const fromXero = inv.fromXero === true;
                rows.push({
                    _id: inv._id,
                    vendorId: vendorInfo,
                    statementId: inv.statementId ? { _id: inv.statementId } : null,
                    invoiceNumber: inv.invoiceNumber,
                    vendorAmount: fromXero ? null : inv.amount,
                    xeroAmount: fromXero ? inv.amount : null,
                    VendorDate: fromXero ? null : inv.date,
                    xeroDate: fromXero ? inv.date : null,
                    paymentStatus: inv.status || "unpaid",
                    vendorCurrency: fromXero ? null : inv.currency,
                    xeroCurrency: fromXero ? inv.currency : null,
                    createdAt: inv.createdAt,
                    reconciliationStatus: "not reconciled",
                    _isMerged: false,
                    _fromXero: fromXero,
                });
            });
        }
    }

    let filtered = rows;
    if (paymentFilter === "paid") filtered = filtered.filter((r) => r.paymentStatus === "paid");
    else if (paymentFilter === "unpaid") filtered = filtered.filter((r) => r.paymentStatus === "unpaid");

    if (filter === "matched") filtered = filtered.filter((r) => r._isMerged);
    else if (filter === "unmatched") filtered = filtered.filter((r) => !r._isMerged && r._fromXero === false);
    else if (filter === "missed") filtered = filtered.filter((r) => !r._isMerged && r._fromXero === true);

    filtered.forEach((r) => {
        delete r._isMerged;
        delete r._fromXero;
    });

    filtered.sort((a, b) => {
        const ka = allInvoicesSortKey(a, sortField);
        const kb = allInvoicesSortKey(b, sortField);
        if (ka < kb) return sortOrder === 1 ? -1 : 1;
        if (ka > kb) return sortOrder === 1 ? 1 : -1;
        return 0;
    });

    const total = filtered.length;
    const pageRows = filtered.slice(offset, offset + LIMIT);
    const pages = Math.max(1, Math.ceil(total / LIMIT));

    res.status(200).json({ success: true, invoices: pageRows, pages });
});

/**
 * GET /api/v2/supplier-logs/missed-invoices?supplierId=<vendorId>
 * Show only invoices where fromXero is true and there is no other invoice (same contactId) with the same invoice number (match on invoice number only).
 */
exports.getMissedInvoices = tryCatchAsync(async (req, res) => {
    const supplierId = req.query.supplierId;
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || "addedAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const paymentFilter = req.query.paymentFilter || "all";
    const offset = (page - 1) * LIMIT;

    if (!supplierId) return res.status(400).json({ success: false, message: "supplierId is required" });

    const vendor = await Vendor.findOne({ _id: supplierId, isDeleted: { $ne: true } }).lean();
    if (!vendor?.xeroId) return res.status(200).json({ success: true, invoices: [], pages: 0 });

    const contactId = vendor.xeroId;
    const sortFieldMap = { invoiceNumber: "invoiceNumber", supplierDate: "date", addedAt: "createdAt", paymentStatus: "status" };
    const sortField = sortFieldMap[sortBy] || "createdAt";

    const matchStage = { contactId, fromXero: true, isDeleted: { $ne: true } };
    if (paymentFilter === "paid") matchStage.status = "paid";
    if (paymentFilter === "unpaid") matchStage.status = "unpaid";

    const pipeline = [
        { $match: matchStage },
        {
            $lookup: {
                from: "invoices-2.0",
                let: { invNum: "$invoiceNumber" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$invoiceNumber", "$$invNum"] },
                                    { $eq: ["$contactId", contactId] },
                                    { $eq: ["$fromXero", false] },
                                    { $ne: ["$isDeleted", true] },
                                ],
                            },
                        },
                    },
                    { $limit: 1 },
                ],
                as: "fileMatch",
            },
        },
        { $match: { fileMatch: { $size: 0 } } },
        { $project: { fileMatch: 0 } },
        { $sort: { [sortField]: sortOrder } },
        { $facet: { total: [{ $count: "n" }], rows: [{ $skip: offset }, { $limit: LIMIT }] } },
    ];

    const [result] = await Invoice.aggregate(pipeline);
    const totalCount = result?.total?.[0]?.n ?? 0;
    const invoices = result?.rows ?? [];

    res.status(200).json({
        success: true,
        invoices: invoices.map((inv) => ({ ...mapInvoiceToResponse(inv, vendor), fromXero: true })),
        pages: Math.max(1, Math.ceil(totalCount / LIMIT)),
    });
});

/**
 * GET /api/v2/supplier-logs/unmatched-invoices
 * Only fromXero false (file) invoices that do not have a matching pair (same invoice number
 * with one fromXero true and one fromXero false).
 */
exports.getUnmatchedInvoices = tryCatchAsync(async (req, res) => {
    const supplierId = req.query.supplierId;
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || "addedAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const paymentFilter = req.query.paymentFilter || "all";
    const offset = (page - 1) * LIMIT;

    if (!supplierId) return res.status(400).json({ success: false, message: "supplierId is required" });

    const vendor = await Vendor.findOne({ _id: supplierId, isDeleted: { $ne: true } }).lean();
    if (!vendor?.xeroId) return res.status(200).json({ success: true, invoices: [], pages: 0 });

    const contactId = vendor.xeroId;

    // Invoice numbers that have a matching pair (both fromXero true and fromXero false)
    const pairedRows = await Invoice.aggregate([
        { $match: { contactId, isDeleted: { $ne: true } } },
        {
            $group: {
                _id: "$invoiceNumber",
                hasFromXero: { $max: { $cond: ["$fromXero", 1, 0] } },
                hasFromFile: { $max: { $cond: ["$fromXero", 0, 1] } },
            }
        },
        { $match: { hasFromXero: 1, hasFromFile: 1 } },
        { $project: { _id: 1 } },
    ]);
    const pairedNumbers = new Set(pairedRows.map((r) => r._id));

    const match = { contactId, fromXero: false, isDeleted: { $ne: true }, invoiceNumber: { $nin: [...pairedNumbers] } };
    if (paymentFilter === "paid") match.status = "paid";
    if (paymentFilter === "unpaid") match.status = "unpaid";

    const sortFieldMap = { invoiceNumber: "invoiceNumber", supplierDate: "date", addedAt: "createdAt", paymentStatus: "status" };
    const sortField = sortFieldMap[sortBy] || "createdAt";

    const [invoices, total] = await Promise.all([
        Invoice.find(match).sort({ [sortField]: sortOrder }).skip(offset).limit(LIMIT).lean(),
        Invoice.countDocuments(match),
    ]);

    res.status(200).json({
        success: true,
        invoices: invoices.map((inv) => mapInvoiceToResponse(inv, vendor)),
        pages: Math.max(1, Math.ceil(total / LIMIT)),
    });
});

/**
 * GET /api/v2/supplier-logs/matched-invoices
 * Only invoices that have a matching pair: same invoice number, one fromXero true and one fromXero false.
 * Merged into one row per pair (supplier fields from file doc, Xero fields from Xero doc).
 */
function mapMatchedPairToResponse(merged, vendor) {
    return {
        _id: merged.fileId,
        vendorId: { _id: vendor._id, name: vendor.name },
        statementId: merged.statementId ? { _id: merged.statementId } : null,
        invoiceNumber: merged.invoiceNumber,
        vendorAmount: merged.vendorAmount,
        xeroAmount: merged.xeroAmount,
        VendorDate: merged.VendorDate,
        xeroDate: merged.xeroDate,
        paymentStatus: merged.paymentStatus || "unpaid",
        vendorCurrency: merged.vendorCurrency,
        xeroCurrency: merged.xeroCurrency,
        createdAt: merged.createdAt,
        reconciliationStatus: "fully reconciled",
    };
}

exports.getMatchedInvoices = tryCatchAsync(async (req, res) => {
    const supplierId = req.query.supplierId;
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || "addedAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const paymentFilter = req.query.paymentFilter || "all";
    const offset = (page - 1) * LIMIT;

    if (!supplierId) return res.status(400).json({ success: false, message: "supplierId is required" });

    const vendor = await Vendor.findOne({ _id: supplierId, isDeleted: { $ne: true } }).lean();
    if (!vendor?.xeroId) return res.status(200).json({ success: true, invoices: [], pages: 0 });

    const contactId = vendor.xeroId;
    const sortFieldMap = { invoiceNumber: "invoiceNumber", supplierDate: "VendorDate", xeroDate: "xeroDate", supplierAmount: "vendorAmount", xeroAmount: "xeroAmount", addedAt: "createdAt", paymentStatus: "paymentStatus" };
    const sortField = sortFieldMap[sortBy] || "createdAt";

    const pipeline = [
        { $match: { contactId, isDeleted: { $ne: true } } },
        { $sort: { invoiceNumber: 1, fromXero: 1 } },
        {
            $group: {
                _id: "$invoiceNumber",
                docs: { $push: "$$ROOT" },
            }
        },
        {
            $match: {
                $expr: {
                    $and: [
                        { $eq: [{ $size: "$docs" }, 2] },
                        { $eq: [{ $size: { $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", true] } } } }, 1] },
                        { $eq: [{ $size: { $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", false] } } } }, 1] },
                    ],
                },
            }
        },
        {
            $addFields: {
                fileDoc: { $arrayElemAt: [{ $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", false] } } }, 0] },
                xeroDoc: { $arrayElemAt: [{ $filter: { input: "$docs", as: "d", cond: { $eq: ["$$d.fromXero", true] } } }, 0] },
            }
        },
        ...(paymentFilter === "paid" ? [{ $match: { $or: [{ "fileDoc.status": "paid" }, { "xeroDoc.status": "paid" }] } }] : []),
        ...(paymentFilter === "unpaid" ? [{ $match: { $or: [{ "fileDoc.status": "unpaid" }, { "xeroDoc.status": "unpaid" }] } }] : []),
        {
            $project: {
                invoiceNumber: "$_id",
                vendorAmount: "$fileDoc.amount",
                xeroAmount: "$xeroDoc.amount",
                VendorDate: "$fileDoc.date",
                xeroDate: "$xeroDoc.date",
                vendorCurrency: "$fileDoc.currency",
                xeroCurrency: "$xeroDoc.currency",
                paymentStatus: "$xeroDoc.status",
                statementId: "$fileDoc.statementId",
                fileId: "$fileDoc._id",
                createdAt: "$xeroDoc.createdAt",
            }
        },
        { $addFields: { paymentStatus: { $ifNull: ["$paymentStatus", "unpaid"] } } },
        { $sort: { [sortField]: sortOrder } },
        {
            $facet: {
                total: [{ $count: "n" }],
                rows: [{ $skip: offset }, { $limit: LIMIT }],
            }
        },
    ];

    const [result] = await Invoice.aggregate(pipeline);
    const totalCount = result?.total?.[0]?.n ?? 0;
    const rows = result?.rows ?? [];

    const invoices = rows.map((row) => mapMatchedPairToResponse(row, vendor));
    res.status(200).json({ success: true, invoices, pages: Math.max(1, Math.ceil(totalCount / LIMIT)) });
});

/**
 * GET /api/v2/supplier-logs/statements/:id/invoices
 * Invoices for a single statement (by statement id). File invoices only; each row merged with Xero match if exists.
 * Query: page, sortBy, sortOrder. sortBy: referenceId|foundInSystem|supplierDate|systemDate|supplierAmount|systemAmount|status|paymentStatus (mapped to invoiceNumber, VendorDate, xeroDate, vendorAmount, xeroAmount, createdAt, etc.)
 */
exports.getInvoicesByStatementId = tryCatchAsync(async (req, res) => {
    const { id: statementId } = req.params;
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || "systemDate";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const offset = (page - 1) * LIMIT;

    if (!statementId) return res.status(400).json({ success: false, message: "Statement id is required" });

    const statement = await Statement.findOne({ _id: statementId, isDeleted: { $ne: true } }).lean();
    if (!statement) return res.status(404).json({ success: false, message: "Statement not found" });

    const vendor = await Vendor.findOne({ xeroId: statement.contactId, isDeleted: { $ne: true } }).lean();
    if (!vendor) return res.status(200).json({ success: true, invoices: [], pages: 1, statementInfo: { invoiceIssueDate: statement.dateOnFile, supplier: { _id: null, name: "Unknown Supplier" } } });

    const contactId = statement.contactId;
    const fileInvoices = await Invoice.find({ statementId, fromXero: false, isDeleted: { $ne: true } }).lean();
    const invoiceNumbers = fileInvoices.map((inv) => inv.invoiceNumber);

    const xeroByNumber = new Map();
    if (invoiceNumbers.length > 0) {
        const xeroInvoices = await Invoice.find({ contactId, fromXero: true, isDeleted: { $ne: true }, invoiceNumber: { $in: invoiceNumbers } }).lean();
        xeroInvoices.forEach((inv) => xeroByNumber.set(inv.invoiceNumber, inv));
    }

    const sortFieldMap = {
        referenceId: "invoiceNumber",
        foundInSystem: "xeroDate",
        supplierDate: "VendorDate",
        systemDate: "xeroDate",
        supplierAmount: "vendorAmount",
        systemAmount: "xeroAmount",
        status: "reconciliationStatus",
        paymentStatus: "paymentStatus",
        addedAt: "createdAt",
    };
    const sortField = sortFieldMap[sortBy] || "createdAt";

    const rows = fileInvoices.map((fileInv) => {
        const xeroInv = xeroByNumber.get(fileInv.invoiceNumber);
        if (xeroInv) {
            return {
                _id: fileInv._id,
                vendorId: { _id: vendor._id, name: vendor.name },
                statementId: { _id: statementId },
                invoiceNumber: fileInv.invoiceNumber,
                vendorAmount: fileInv.amount,
                xeroAmount: xeroInv.amount,
                VendorDate: fileInv.date,
                xeroDate: xeroInv.date,
                paymentStatus: xeroInv.status || "unpaid",
                vendorCurrency: fileInv.currency,
                xeroCurrency: xeroInv.currency,
                createdAt: xeroInv.createdAt,
                reconciliationStatus: "fully reconciled",
            };
        }
        return {
            _id: fileInv._id,
            vendorId: { _id: vendor._id, name: vendor.name },
            statementId: { _id: statementId },
            invoiceNumber: fileInv.invoiceNumber,
            vendorAmount: fileInv.amount,
            xeroAmount: null,
            VendorDate: fileInv.date,
            xeroDate: null,
            paymentStatus: fileInv.status || "unpaid",
            vendorCurrency: fileInv.currency,
            xeroCurrency: fileInv.currency,
            createdAt: fileInv.createdAt,
            reconciliationStatus: "not reconciled",
        };
    });

    rows.sort((a, b) => {
        let ka = a[sortField];
        let kb = b[sortField];
        if (sortField === "reconciliationStatus") {
            ka = (ka || "").toLowerCase();
            kb = (kb || "").toLowerCase();
        }
        if (ka == null) ka = sortOrder === 1 ? Infinity : -Infinity;
        if (kb == null) kb = sortOrder === 1 ? Infinity : -Infinity;
        if (ka < kb) return sortOrder === 1 ? -1 : 1;
        if (ka > kb) return sortOrder === 1 ? 1 : -1;
        return 0;
    });

    const total = rows.length;
    const invoices = rows.slice(offset, offset + LIMIT);
    const pages = Math.max(1, Math.ceil(total / LIMIT));

    res.status(200).json({
        success: true,
        invoices,
        pages,
        statementInfo: {
            invoiceIssueDate: statement.dateOnFile,
            supplier: { _id: vendor._id, name: vendor.name },
        },
    });
});

/**
 * DELETE /api/v2/supplier-logs/invoices/:id
 * Soft-delete a single invoice (by invoice _id). Used from single-statement page.
 */
exports.deleteInvoice = tryCatchAsync(async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, message: "Invoice id is required" });

    const invoice = await Invoice.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    await Invoice.updateOne({ _id: id }, { $set: { isDeleted: true } });
    res.status(200).json({ success: true, message: "Invoice deleted" });
});
