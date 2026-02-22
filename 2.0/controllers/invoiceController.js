const fs = require("fs");
const path = require("path");
const multer = require("multer");
const currencyToSymbolMap = require("currency-symbol-map/map");
const { getCompaniesFromFile, getInvoicesFromFileWithAIVision } = require("./utilsController");
const { searchSimilarVendors, findCloseInvoiceMatchesInDb, nameSimilarity } = require("../scripts/scripts");
const Invoice = require("../modals/invoiceModal");
const Vendor = require("../modals/vendorModal");
const Statement = require("../modals/statementModal");
const { logProcess } = require("./processLogController");

/** Normalize currency to ISO 4217 3-letter code using currency-symbol-map. Returns null if unknown. */
function toISO4217Currency(input) {
    if (input == null || typeof input !== "string") return null;
    const s = input.trim();
    if (!s) return null;
    const upper = s.toUpperCase();
    if (s.length === 3 && currencyToSymbolMap[upper]) return upper;
    const symbolToCode = symbolToCodeMap || (symbolToCodeMap = buildSymbolToCodeMap());
    return symbolToCode[s] || symbolToCode[upper] || null;
}
let symbolToCodeMap = null;
function buildSymbolToCodeMap() {
    const out = {};
    for (const [code, symbol] of Object.entries(currencyToSymbolMap)) {
        if (symbol && !out[symbol]) out[symbol] = code;
    }
    return out;
}
const {
    formatWithAIToStandardJSON,
    checkMultipleInvoiceNumbers,
    extractPotentialInvoiceIds,
} = require("../../formatting");
const { namedToolChoiceToJSON } = require("@openrouter/sdk/models");
const { tryCatchAsync } = require("../../controllers/ErrorController");

/** Company name that must never appear in results (case-insensitive). */
const EXCLUDED_COMPANY = "INSPERANTO";

function isExcludedName(name) {
    return name && String(name).toUpperCase().includes(EXCLUDED_COMPANY);
}

function getFileName(file) {
    return file.originalname || (file.mimetype === "application/pdf" ? "document.pdf" : "document.xlsx");
}

function ensureThreeSlots(companyNames) {
    const list = [...companyNames];
    while (list.length < 3) list.push({ name: "", confidence: 0 });
    return list.slice(0, 3);
}

function deduplicateConfidences(companyNames) {
    const seen = new Set();
    return companyNames.map((entry) => {
        let c = Math.max(0, Math.min(1, Number(entry.confidence) || 0));
        while (seen.has(c)) {
            c = c <= 0 ? Math.min(0.001 * seen.size, 0.99) : Math.max(0, Math.round((c - 0.01) * 100) / 100);
        }
        seen.add(c);
        return { name: entry.name, confidence: c };
    });
}

async function getInvoiceCountsByXeroId(xeroIds) {
    if (!xeroIds.length) return {};
    const rows = await Invoice.aggregate([
        { $match: { contactId: { $in: xeroIds }, isDeleted: { $ne: true } } },
        { $group: { _id: "$contactId", invoiceCount: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r) => [r._id, r.invoiceCount]));
}

const RANK_WEIGHT = 0.7;
const COUNT_WEIGHT = 0.3;
const SIMILARITY_THRESHOLD = 0.8;

/** Cost tolerance for matching file amounts to Xero: ±50% of the file amount. */
const COST_TOLERANCE_PERCENT = 50;

/** Number of closest Xero matches to return per file invoice. */
const CLOSEST_MATCHES_K = 5;

/** Minimum score to include a match; entries below this are hidden. */
const MIN_SCORE_THRESHOLD = 0.6;

/**
 * Parse AI invoice-format response string into { fileDate, invoices }.
 * Same idea as parseAIResponse in the old InvoiceController.
 */
function parseInvoicesFromAIResponse(rawString) {
    if (!rawString || typeof rawString !== "string") return { fileDate: null, invoices: [] };
    const cleaned = rawString.replace(/```json/gi, "").replace(/```/g, "").trim();
    let obj;
    try {
        obj = JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) obj = JSON.parse(match[0]);
        else return { fileDate: null, invoices: [] };
    }
    const invoices = Array.isArray(obj?.invoices) ? obj.invoices : [];
    const fileDate = obj?.fileDate ?? null;
    return { fileDate, invoices };
}

/**
 * Same logic as old InvoiceController: check single vs multiple invoices,
 * extract potential invoice IDs, then format with AI using that context.
 */
async function getInvoicesFromFile(result, fileName) {
    console.log("[invoiceFileUpload] getInvoicesFromFile: start", { fileName, type: result?.type });
    const raw = result?.raw ?? (result?.type === "pdf" ? result?.text ?? result?.data : "") ?? "";
    if (!raw || (typeof raw !== "string" && typeof raw !== "object")) {
        console.log("[invoiceFileUpload] getInvoicesFromFile: no raw content, skipping");
        return { fileDate: null, invoices: [], invoiceCountCheck: null };
    }
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const fn = fileName || "";
    console.log("[invoiceFileUpload] getInvoicesFromFile: content length", text.length);

    let potentialInvoiceIds = [];
    try {
        const contentForIdExtraction =
            result?.type === "excel"
                ? JSON.stringify((result?.data || []).slice(0, 50), null, 2)
                : text.substring(0, 15000);
        console.log("[invoiceFileUpload] getInvoicesFromFile: extracting potential invoice IDs...");
        const extracted = await extractPotentialInvoiceIds(contentForIdExtraction, fn);
        potentialInvoiceIds = extracted?.potentialIds || [];
        console.log("[invoiceFileUpload] getInvoicesFromFile: potentialInvoiceIds count", potentialInvoiceIds.length, potentialInvoiceIds.length > 0 ? `sample: ${potentialInvoiceIds.slice(0, 5).join(", ")}` : "");
    } catch (err) {
        console.error("[invoiceFileUpload] getInvoicesFromFile extractPotentialInvoiceIds:", err.message);
    }

    let invoiceCountCheck = null;
    try {
        const contentPreview = text.substring(0, 5000);
        console.log("[invoiceFileUpload] getInvoicesFromFile: checking single vs multiple invoices...");
        invoiceCountCheck = await checkMultipleInvoiceNumbers(contentPreview, fn);
        console.log("[invoiceFileUpload] getInvoicesFromFile: invoiceCountCheck", JSON.stringify(invoiceCountCheck));
    } catch (err) {
        console.error("[invoiceFileUpload] getInvoicesFromFile checkMultipleInvoiceNumbers:", err.message);
    }

    try {
        console.log("[invoiceFileUpload] getInvoicesFromFile: calling formatWithAIToStandardJSON...");
        const aiResponse = await formatWithAIToStandardJSON(
            text,
            fn,
            null,
            invoiceCountCheck,
            potentialInvoiceIds.length > 0 ? potentialInvoiceIds : null
        );
        const parsed = parseInvoicesFromAIResponse(aiResponse);
        console.log("[invoiceFileUpload] getInvoicesFromFile: done", { invoiceCount: parsed.invoices?.length ?? 0, fileDate: parsed.fileDate });
        return { ...parsed, invoiceCountCheck };
    } catch (err) {
        console.error("[invoiceFileUpload] getInvoicesFromFile formatWithAIToStandardJSON:", err.message);
        return { fileDate: null, invoices: [], invoiceCountCheck };
    }
}

async function selectBestVendor(firstCompanyName) {
    console.log("[invoiceFileUpload] selectBestVendor: start", { firstCompanyName });
    const similarSearch = await searchSimilarVendors(firstCompanyName, 10);
    const matchesAbove08 = (similarSearch.matches || []).filter(
        (m) => (Number(m.score) ?? m.similarityToQuery ?? 0) > SIMILARITY_THRESHOLD
    );

    return { similarSearch, matchesAbove08 };
    // console.log("[invoiceFileUpload] selectBestVendor: similar vendors above 0.8", matchesAbove08.length, matchesAbove08.map((m) => m.name));
    // const xeroIds = matchesAbove08.map((m) => m.xeroId).filter(Boolean);
    // const countMap = await getInvoiceCountsByXeroId(xeroIds);
    // const matchesWithCounts = matchesAbove08.map((m) => ({
    //     ...m,
    //     invoiceCount: countMap[m.xeroId] ?? 0,
    // }));
    // const maxCount = Math.max(1, ...matchesWithCounts.map((m) => m.invoiceCount));
    // const withCombinedScore = matchesWithCounts.map((m) => {
    //     const rank = Number(m.score) ?? m.similarityToQuery ?? 0;
    //     const normalizedCount = m.invoiceCount / maxCount;
    //     const combinedScore = RANK_WEIGHT * rank + COUNT_WEIGHT * normalizedCount;
    //     return { ...m, combinedScore: Math.round(combinedScore * 1000) / 1000 };
    // });
    // withCombinedScore.sort((a, b) => b.combinedScore - a.combinedScore);
    // const selectedVendor = withCombinedScore[0] ?? null;
    // const matches = selectedVendor ? [selectedVendor] : [];
    // console.log("[invoiceFileUpload] selectBestVendor: selected", selectedVendor ? { name: selectedVendor.name, combinedScore: selectedVendor.combinedScore, invoiceCount: selectedVendor.invoiceCount } : "none");
    // return { similarSearch, selectedVendor, matches };
}

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowed = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
    ];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only PDF and Excel files are allowed"), false);
    }
};

exports.upload = multer({ storage, fileFilter });

exports.handleMulterError = (err, req, res, next) => {
    if (err) {
        return res.status(400).json({
            success: false,
            message: err.message || "File upload error",
        });
    }
    next();
};

function validateUpload(req, res) {
    if (!req.file) {
        res.status(400).json({
            success: false,
            message: "No file uploaded. Send a single file (field name: file).",
        });
        return null;
    }
    return req.file;
}

function sendParseError(err, res) {
    console.error("[invoiceFileUpload] Parse error:", err.message);
    res.status(500).json({
        success: false,
        message: err.message || "Failed to parse file",
    });
}

/**
 * Parse one file, create Statement, write to disk. Returns body for completeInvoiceFileUploadLogic.
 * Used by single upload and batch upload. Throws on error.
 */
async function prepareOneFileUpload(file) {
    const fileName = getFileName(file);
    const { companyNames: rawCompanyNames } = await getCompaniesFromFile(file.buffer, fileName);
    let companyNames = rawCompanyNames.filter((entry) => !isExcludedName(entry.name));
    companyNames = companyNames.filter((entry) => (Number(entry.confidence) || 0) > SIMILARITY_THRESHOLD);
    companyNames = ensureThreeSlots(companyNames);
    companyNames = deduplicateConfidences(companyNames);

    const first = companyNames[0];
    if (!first || !String(first.name || "").trim()) {
        throw new Error("No company name identified. Could not find a confident match above 0.8.");
    }

    const { matchesAbove08 } = await selectBestVendor(first.name);
    const { fileDate, invoices: invoicesFromAIVision } = await getInvoicesFromFileWithAIVision(file.buffer, fileName);
    const invoices = invoicesFromAIVision ?? [];
    const allowedContactIds = new Set(
        (matchesAbove08 || []).map((m) => m.xeroId).filter(Boolean)
    );
    const dbCloseMatches = await findCloseInvoiceMatchesInDb(invoices, {
        threshold: 0.8,
        contactIds: allowedContactIds.size > 0 ? [...allowedContactIds] : null,
    });

    const supplierMatchCounts = {};
    for (const row of dbCloseMatches) {
        const matchCount = row.matches.length;
        if (matchCount === 0) continue;
        const weight = 1 / matchCount;
        for (const { dbInvoice } of row.matches) {
            const id = dbInvoice.contactId ?? "unknown";
            if (!allowedContactIds.size || allowedContactIds.has(id)) {
                supplierMatchCounts[id] = (supplierMatchCounts[id] || 0) + weight;
            }
        }
    }
    const supplierMatchCountList = Object.entries(supplierMatchCounts)
        .map(([contactId, count]) => ({ contactId, count: Math.round(count * 1000) / 1000 }))
        .sort((a, b) => b.count - a.count);

    if (supplierMatchCountList.length === 0 && matchesAbove08?.length > 1) {
        const err = new Error("Could not determine the best vendor. Please select the best vendor from the list.");
        err.statusCode = 409;
        err.invoices = invoices;
        err.companyNames = matchesAbove08;
        throw err;
    }

    const selectedVendor = supplierMatchCountList[0]?.contactId ?? matchesAbove08?.[0]?.xeroId;
    if (!selectedVendor) throw new Error("No vendor match found.");

    // When a supply matches, ensure vendor is marked as supplier if not already
    await Vendor.updateOne(
        { xeroId: selectedVendor, supplier: { $ne: true } },
        { $set: { supplier: true, modifiedLast: new Date() } }
    );

    const filesDir = path.join(__dirname, "..", "..", "..", "steve_files_do_not_delete");
    if (!fs.existsSync(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
    }
    const safeName = (fileName || "statement").replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${Date.now()}-${safeName}`;
    fs.writeFileSync(path.join(filesDir, uniqueName), file.buffer);

    const dateOnFile = parseInvoiceDate(fileDate);
    const statement = await Statement.create({
        contactId: selectedVendor,
        file: uniqueName,
        isDeleted: false,
        dateOnFile,
    });

    return {
        vendorId: selectedVendor,
        invoices,
        statementId: statement._id,
    };
}

/**
 * POST /invoice/invoice-file-upload
 * Accepts a single file (PDF or Excel), parses it and returns parsed result.
 */
exports.invoiceFileUpload = tryCatchAsync(async (req, res, next) => {
    console.log("[invoiceFileUpload] start");
    const file = validateUpload(req, res);
    if (!file) {
        console.log("[invoiceFileUpload] validateUpload: no file");
        return;
    }
    try {
        const body = await prepareOneFileUpload(file);
        req.body.vendorId = body.vendorId;
        req.body.invoices = body.invoices;
        req.body.statementId = body.statementId;
        return exports.completeInvoiceFileUpload(req, res, (err) => {
            if (err) sendParseError(err, res);
        });
    } catch (err) {
        console.error("[invoiceFileUpload] catch", err);
        if (err.statusCode === 409) {
            return res.status(409).json({
                success: false,
                invoices: err.invoices,
                companyNames: err.companyNames,
                message: err.message,
            });
        }
        sendParseError(err, res);
    }
})


function parseInvoiceDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const s = String(value).trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Core logic for completing a statement upload (create invoices, match, log). No res.
 * @param {object} body - { vendorId, invoices, statementId }
 * @param {*} userId
 * @param {{ skipProcessLog?: boolean }} [options] - If true, do not create a process log (caller will log once for batch).
 */
async function completeInvoiceFileUploadLogic(body, userId, options = {}) {
    const { vendorId, invoices, statementId } = body;
    const vendor = await Vendor.findOne({ xeroId: vendorId, isDeleted: { $ne: true } });
    if (!vendor) throw new Error("Vendor not found.");

    // if (!vendor) {
    //     return res.status(404).json({
    //         success: false,
    //         message: "Vendor not found.",
    //     });
    // }

    // Get all invoices from Xero (fromXero: true) for this supplier
    const xeroInvoices = await Invoice.find({
        contactId: vendor.xeroId,
        fromXero: true,
        isDeleted: { $ne: true },
    }).lean();

    // Score only by ID: each file invoice has multiple potential IDs; best match vs each Xero invoice wins
    const idNoLetters = (s) => String(s ?? "").replace(/[a-zA-Z]/g, "");
    const getIdScore = (fileInv, xeroInv) => {
        const xeroNum = xeroInv.invoiceNumber ?? "";
        if (!xeroNum) return 0;
        const xeroDigits = idNoLetters(xeroNum);
        const potentialIds = Array.isArray(fileInv.potentialInvoiceIds) && fileInv.potentialInvoiceIds.length > 0
            ? fileInv.potentialInvoiceIds
            : [fileInv.invoiceNumber, fileInv.referenceId, fileInv.id].filter(Boolean);
        if (potentialIds.length === 0) return 0;
        let best = 0;
        for (const pid of potentialIds) {
            const p = String(pid).trim();
            if (!p) continue;
            const pDigits = idNoLetters(p);
            const sim = nameSimilarity(pDigits || p, xeroDigits || xeroNum);
            if (sim > best) best = sim;
        }
        return Math.round(best * 10 ** 6) / 10 ** 6;
    };

    const MATCH_THRESHOLD = 0.8;
    const fileInvoices = invoices ?? [];
    const invoicesWithClosestMatches = fileInvoices.map((fileInv) => {
        const allScored = xeroInvoices.map((invoice) => {
            const score = getIdScore(fileInv, invoice);
            return {
                invoice: { invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, date: invoice.date, _id: invoice._id },
                distance: 1 - score,
                score,
            };
        });
        allScored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.distance - b.distance));
        const firstMatch = allScored[0];
        const keepFirst = firstMatch && firstMatch.score >= MATCH_THRESHOLD ? [firstMatch] : [];
        return {
            ...fileInv,
            match: keepFirst,
        };
    });

    // For each file invoice: delete any existing DB record with same invoice number(s); then create one new record (fromXero: false)
    const contactId = vendor.xeroId;
    const created = [];
    const statementIdsToCheck = new Set();

    for (const fileInv of invoicesWithClosestMatches) {
        const numbersToFind = [
            fileInv.invoiceNumber,
            ...(Array.isArray(fileInv.potentialInvoiceIds) ? fileInv.potentialInvoiceIds : []),
        ].map((s) => String(s).trim()).filter(Boolean);
        if (numbersToFind.length > 0) {
            const toDelete = await Invoice.find({
                contactId,
                invoiceNumber: { $in: numbersToFind },
                fromXero: false,
            }).select("statementId").lean();
            for (const inv of toDelete) {
                if (inv.statementId) statementIdsToCheck.add(inv.statementId.toString());
            }
            await Invoice.deleteMany({
                contactId,
                invoiceNumber: { $in: numbersToFind },
                fromXero: false,
            });
        }
        const invoiceNumber = fileInv.match?.length > 0
            ? fileInv.match[0].invoice.invoiceNumber
            : (fileInv.invoiceNumber ?? "");
        if (!invoiceNumber.trim()) continue;
        const dateVal = parseInvoiceDate(fileInv.invoiceDate ?? fileInv.dateDue);
        const dueDateVal = parseInvoiceDate(fileInv.dateDue ?? fileInv.dueDate);
        const newRecord = await Invoice.create({
            invoiceNumber: invoiceNumber.trim(),
            amount: fileInv.amount != null ? Number(fileInv.amount) : null,
            status: fileInv.paymentStatus === "paid" ? "paid" : "unpaid",
            description: fileInv.activityDescription ?? null,
            contactId,
            currency: toISO4217Currency(fileInv.currency),
            date: dateVal,
            dueDate: dueDateVal,
            fromXero: false,
            isDeleted: false,
            statementId: statementId || null,
        });
        created.push(newRecord);
    }

    const matchCount = invoicesWithClosestMatches.filter((inv) => inv.match?.length > 0).length;

    // If any statements had invoices deleted, drop statements that no longer have any invoices
    for (const sid of statementIdsToCheck) {
        const remaining = await Invoice.countDocuments({
            statementId: sid,
            isDeleted: { $ne: true },
        });
        if (remaining === 0) {
            await Statement.deleteOne({ _id: sid });
        }
    }

    // ids: s- for statement, i- for invoice (so batch can merge one log)
    const ids = [
        `s-${statementId}`,
        ...created.map((inv) => `i-${inv._id}`),
    ];
    const description = `Updated new statement for supplier ${vendor?.name ?? vendorId}`;
    if (!options.skipProcessLog) {
        try {
            await logProcess(description, ids, userId);
        } catch (err) {
            console.error("[completeInvoiceFileUpload] process log failed:", err.message);
        }
    }

    return {
        success: true,
        vendorId,
        vendor: { name: vendor.name, xeroId: vendor.xeroId },
        invoices: invoicesWithClosestMatches,
        xeroInvoiceCount: xeroInvoices.length,
        matchThreshold: MATCH_THRESHOLD,
        matchCount,
        createdCount: created.length,
        created: created.map((inv) => ({ _id: inv._id, invoiceNumber: inv.invoiceNumber, amount: inv.amount, date: inv.date, dueDate: inv.dueDate })),
    };
}

exports.completeInvoiceFileUpload = tryCatchAsync(async (req, res) => {
    const result = await completeInvoiceFileUploadLogic(req.body, req.user?._id);
    return res.status(200).json(result);
});

/**
 * POST /invoice/batch-invoice-file-upload
 * Accepts multiple files; processes each and creates one activity log for the batch.
 * ids in the log: s-<statementId> for each statement, i-<invoiceId> for each created invoice.
 */
exports.batchInvoiceFileUpload = tryCatchAsync(async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) {
        return res.status(400).json({ success: false, message: "No files uploaded." });
    }
    const userId = req.user?._id;
    const allIds = [];
    const results = [];
    const errors = [];
    for (const file of files) {
        try {
            const body = await prepareOneFileUpload(file);
            const result = await completeInvoiceFileUploadLogic(body, userId, { skipProcessLog: true });
            allIds.push(`s-${body.statementId}`);
            result.created.forEach((inv) => allIds.push(`i-${inv._id}`));
            results.push({
                fileName: file.originalname || file.name,
                success: true,
                statementId: body.statementId,
                createdCount: result.created.length,
            });
        } catch (err) {
            errors.push({
                fileName: file.originalname || file.name,
                error: err.message || "Failed to process file",
            });
        }
    }
    if (allIds.length > 0) {
        const description = `Batch upload: ${results.length} statement(s) processed`;
        try {
            await logProcess(description, allIds, userId);
        } catch (logErr) {
            console.error("[batchInvoiceFileUpload] process log failed:", logErr.message);
        }
    }
    return res.status(200).json({
        success: results.length > 0,
        processed: results.length,
        failed: errors.length,
        results,
        errors: errors.length ? errors : undefined,
    });
});

/**
 * Process one statement file (buffer already read). File must already be written to steve_files with uniqueFileName.
 * Used by statement-transfer to upload one statement at a time.
 */
exports.processOneStatementFile = async function processOneStatementFile(fileBuffer, uniqueFileName, user) {
    const fileName = uniqueFileName;
    try {
        const { companyNames: rawCompanyNames } = await getCompaniesFromFile(fileBuffer, fileName);
        let companyNames = rawCompanyNames.filter((entry) => !isExcludedName(entry.name));
        companyNames = companyNames.filter((entry) => (Number(entry.confidence) || 0) > SIMILARITY_THRESHOLD);
        companyNames = ensureThreeSlots(companyNames);
        companyNames = deduplicateConfidences(companyNames);

        const first = companyNames[0];
        if (!first || !String(first.name || "").trim()) {
            return { success: false, error: "No company name identified above 0.8." };
        }

        const { matchesAbove08 } = await selectBestVendor(first.name);
        const { fileDate, invoices: invoicesFromAIVision } = await getInvoicesFromFileWithAIVision(fileBuffer, fileName);
        const invoices = invoicesFromAIVision ?? [];

        const allowedContactIds = new Set((matchesAbove08 || []).map((m) => m.xeroId).filter(Boolean));
        const dbCloseMatches = await findCloseInvoiceMatchesInDb(invoices, {
            threshold: 0.8,
            contactIds: allowedContactIds.size > 0 ? [...allowedContactIds] : null,
        });

        const supplierMatchCounts = {};
        for (const row of dbCloseMatches) {
            const matchCount = row.matches.length;
            if (matchCount === 0) continue;
            const weight = 1 / matchCount;
            for (const { dbInvoice } of row.matches) {
                const id = dbInvoice.contactId ?? "unknown";
                if (!allowedContactIds.size || allowedContactIds.has(id)) {
                    supplierMatchCounts[id] = (supplierMatchCounts[id] || 0) + weight;
                }
            }
        }
        const supplierMatchCountList = Object.entries(supplierMatchCounts)
            .map(([contactId, count]) => ({ contactId, count: Math.round(count * 1000) / 1000 }))
            .sort((a, b) => b.count - a.count);

        if (supplierMatchCountList.length === 0 && matchesAbove08?.length > 1) {
            return { success: false, error: "Could not determine the best vendor." };
        }

        const selectedVendor = supplierMatchCountList[0]?.contactId ?? matchesAbove08?.[0]?.xeroId;
        if (!selectedVendor) {
            return { success: false, error: "No vendor match found." };
        }

        // When a supply matches, ensure vendor is marked as supplier if not already
        await Vendor.updateOne(
            { xeroId: selectedVendor, supplier: { $ne: true } },
            { $set: { supplier: true, modifiedLast: new Date() } }
        );

        const dateOnFile = parseInvoiceDate(fileDate);
        const statement = await Statement.create({
            contactId: selectedVendor,
            file: uniqueFileName,
            isDeleted: false,
            dateOnFile,
        });

        const result = await completeInvoiceFileUploadLogic(
            { vendorId: selectedVendor, invoices, statementId: statement._id },
            user?._id
        );
        return { ...result, statementId: statement._id };
    } catch (err) {
        console.error("[processOneStatementFile]", err);
        return { success: false, error: err.message || String(err) };
    }
};