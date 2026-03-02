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

/**
 * Normalize currency to ISO 4217 3-letter code.
 * For ambiguous symbols used by many currencies (e.g. "£"), prefer app defaults.
 */
function toISO4217Currency(input) {
    if (input == null || typeof input !== "string") return null;
    const s = input.trim();
    if (!s) return null;
    const explicit = AMBIGUOUS_SYMBOL_DEFAULTS[s];
    if (explicit) return explicit;
    const upper = s.toUpperCase();
    if (s.length === 3 && currencyToSymbolMap[upper]) return upper;
    const symbolToCode = symbolToCodeMap || (symbolToCodeMap = buildSymbolToCodeMap());
    return symbolToCode[s] || symbolToCode[upper] || null;
}
const AMBIGUOUS_SYMBOL_DEFAULTS = {
    "$": "USD",
    "£": "GBP",
    "¥": "JPY",
};
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

const PARSE_FILE_LOG = "[parseFile]";

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
const CLOSE_CALL_DELTA = 0.03;
const SIGNIFICANT_INVOICE_RATIO = 2;
const NEEDS_SUPPLIER_INPUT_STATUS = "needs_supplier_input";
const SUPPLIER_NOT_FOUND_MESSAGE = "Supplier not found. Please add or sync this supplier in Reconciliation first.";

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
        const currencies = [...new Set((parsed.invoices || []).map((inv) => inv.currency).filter(Boolean))];
        console.log("[invoiceFileUpload] getInvoicesFromFile: done", { invoiceCount: parsed.invoices?.length ?? 0, fileDate: parsed.fileDate, currencyOfFile: currencies });
        console.log(PARSE_FILE_LOG, "getInvoicesFromFile OUTCOME", { fileName: fn, success: true, fileDate: parsed.fileDate, invoiceCount: parsed.invoices?.length ?? 0, currencyOfFile: currencies, invoices: (parsed.invoices || []).map((inv) => ({ invoiceNumber: inv.invoiceNumber, amount: inv.amount, currency: inv.currency })) });
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

    let preferredVendorId = null;
    let decision = {
        reason: "default_similarity",
        closeCall: false,
        closeCallDelta: null,
        invoiceCounts: [],
    };

    if (matchesAbove08.length >= 2) {
        const topScore = Number(matchesAbove08[0]?.score ?? matchesAbove08[0]?.similarityToQuery ?? 0);
        const secondScore = Number(matchesAbove08[1]?.score ?? matchesAbove08[1]?.similarityToQuery ?? 0);
        const scoreDelta = Math.round((topScore - secondScore) * 1000) / 1000;
        const closeCall = scoreDelta <= CLOSE_CALL_DELTA;
        decision.closeCall = closeCall;
        decision.closeCallDelta = scoreDelta;

        if (closeCall) {
            const closeCallMatches = matchesAbove08.filter((m) => {
                const score = Number(m?.score ?? m?.similarityToQuery ?? 0);
                return (topScore - score) <= CLOSE_CALL_DELTA;
            });
            const xeroIds = [...new Set(closeCallMatches.map((m) => m.xeroId).filter(Boolean))];
            const countMap = await getInvoiceCountsByXeroId(xeroIds);
            const matchesWithCounts = closeCallMatches
                .map((m) => ({
                    ...m,
                    invoiceCount: Number(countMap[m.xeroId]) || 0,
                }))
                .sort((a, b) => {
                    if (b.invoiceCount !== a.invoiceCount) return b.invoiceCount - a.invoiceCount;
                    const aScore = Number(a.score ?? a.similarityToQuery ?? 0);
                    const bScore = Number(b.score ?? b.similarityToQuery ?? 0);
                    return bScore - aScore;
                });

            decision.invoiceCounts = matchesWithCounts.map((m) => ({
                name: m.name,
                xeroId: m.xeroId,
                score: Number(m.score ?? m.similarityToQuery ?? 0),
                invoiceCount: m.invoiceCount,
            }));

            const highest = matchesWithCounts[0];
            const nextHighest = matchesWithCounts[1];
            if (
                highest?.xeroId &&
                nextHighest &&
                highest.invoiceCount > 0 &&
                highest.invoiceCount >= (nextHighest.invoiceCount * SIGNIFICANT_INVOICE_RATIO)
            ) {
                preferredVendorId = highest.xeroId;
                decision.reason = "close_call_invoice_count_override";
                decision.overrideVendor = {
                    name: highest.name,
                    xeroId: highest.xeroId,
                    invoiceCount: highest.invoiceCount,
                };
            } else {
                decision.reason = "close_call_no_significant_count_gap";
            }
        }
    }

    console.log("[invoiceFileUpload] selectBestVendor: decision", {
        firstCompanyName,
        matchCount: matchesAbove08.length,
        preferredVendorId,
        decision,
    });
    return { similarSearch, matchesAbove08, preferredVendorId, decision };
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
            message: err.code === "LIMIT_FILE_TYPE" || (err.message && err.message.includes("allowed"))
                ? "Please upload only PDF or Excel files."
                : "We couldn't accept that file. Please use a PDF or Excel file and try again.",
        });
    }
    next();
};

function validateUpload(req, res) {
    if (!req.file) {
        res.status(400).json({
            success: false,
            message: "Please choose a file to upload.",
        });
        return null;
    }
    return req.file;
}

function persistUploadedFile(buffer, fileName) {
    const filesDir = path.join(__dirname, "..", "..", "..", "steve_files_do_not_delete");
    if (!fs.existsSync(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
    }
    const safeName = (fileName || "statement").replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${Date.now()}-${safeName}`;
    fs.writeFileSync(path.join(filesDir, uniqueName), buffer);
    return uniqueName;
}

function buildCandidateSuppliers(matchesAbove08) {
    return (matchesAbove08 || []).map((m) => ({
        name: m.name,
        xeroId: m.xeroId,
        score: Number(m.score ?? m.similarityToQuery ?? 0),
    }));
}

function buildNeedsSupplierInputResult({ fileName, storedFile, fileDate, invoices, reason, message, candidateSuppliers = [] }) {
    return {
        success: false,
        status: NEEDS_SUPPLIER_INPUT_STATUS,
        reason,
        message,
        fileName,
        candidateSuppliers,
        invoices,
        unresolvedUpload: {
            fileName,
            storedFile,
            fileDate: fileDate ?? null,
            invoices,
            candidateSuppliers,
            reason,
        },
    };
}

/** Known friendly messages we set ourselves (safe to show to user). */
const FRIENDLY_UPLOAD_MESSAGES = new Set([
    "Could not determine the best vendor. Please select the best vendor from the list.",
    "We couldn't identify a supplier in this file. Please check the file and try again.",
    "We couldn't match this file to a supplier. Please add the supplier in Reconciliation first.",
]);

function sendParseError(err, res) {
    console.error("[invoiceFileUpload] Parse error:", err.message);
    const status = typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : 500;
    const message = err.message && FRIENDLY_UPLOAD_MESSAGES.has(err.message)
        ? err.message
        : "We couldn't read this file. Please check it's a valid PDF or Excel file and try again.";
    res.status(status).json({
        success: false,
        message,
    });
}

/**
 * Parse one file, create Statement, write to disk. Returns body for completeInvoiceFileUploadLogic.
 * Used by single upload and batch upload. Throws on error.
 */
async function prepareOneFileUpload(file, options = {}) {
    const allowManualSupplierInput = Boolean(options.allowManualSupplierInput);
    const fileName = getFileName(file);
    const fileSize = file.buffer ? file.buffer.length : 0;
    console.log(PARSE_FILE_LOG, "prepareOneFileUpload CALL", { fileName, fileSize });

    const { companyNames: rawCompanyNames } = await getCompaniesFromFile(file.buffer, fileName);
    let companyNames = rawCompanyNames.filter((entry) => !isExcludedName(entry.name));
    companyNames = companyNames.filter((entry) => (Number(entry.confidence) || 0) > SIMILARITY_THRESHOLD);
    companyNames = ensureThreeSlots(companyNames);
    companyNames = deduplicateConfidences(companyNames);

    const { fileDate, invoices: invoicesFromAIVision } = await getInvoicesFromFileWithAIVision(file.buffer, fileName);
    const invoices = invoicesFromAIVision ?? [];
    const storedFile = persistUploadedFile(file.buffer, fileName);
    const currencyOfFile = [...new Set(invoices.map((inv) => inv.currency).filter(Boolean))];
    console.log(PARSE_FILE_LOG, "prepareOneFileUpload DATA after getInvoicesFromFileWithAIVision", {
        fileName,
        fileDate,
        invoiceCount: invoices.length,
        currencyOfFile,
        invoices: invoices.map((inv) => ({ invoiceNumber: inv.invoiceNumber, amount: inv.amount, currency: inv.currency, dateDue: inv.dateDue, invoiceDate: inv.invoiceDate })),
    });

    const first = companyNames[0];
    if (!first || !String(first.name || "").trim()) {
        if (allowManualSupplierInput) {
            return buildNeedsSupplierInputResult({
                fileName,
                storedFile,
                fileDate,
                invoices,
                reason: "no_supplier_detected",
                message: "We couldn't identify a supplier from this file. Enter the supplier name to continue.",
                candidateSuppliers: [],
            });
        }
        throw new Error("We couldn't identify a supplier in this file. Please check the file and try again.");
    }

    const { matchesAbove08, preferredVendorId } = await selectBestVendor(first.name);
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

    if (supplierMatchCountList.length === 0 && matchesAbove08?.length > 1 && !preferredVendorId) {
        const candidateSuppliers = buildCandidateSuppliers(matchesAbove08);
        if (allowManualSupplierInput) {
            return buildNeedsSupplierInputResult({
                fileName,
                storedFile,
                fileDate,
                invoices,
                reason: "ambiguous_supplier",
                message: "We couldn't confidently choose a supplier. Enter the supplier name to continue.",
                candidateSuppliers,
            });
        }
        const err = new Error("Could not determine the best vendor. Please select the best vendor from the list.");
        err.statusCode = 409;
        err.invoices = invoices;
        err.companyNames = matchesAbove08;
        throw err;
    }

    const selectedVendor = supplierMatchCountList[0]?.contactId ?? preferredVendorId ?? matchesAbove08?.[0]?.xeroId;
    if (!selectedVendor) {
        if (allowManualSupplierInput) {
            return buildNeedsSupplierInputResult({
                fileName,
                storedFile,
                fileDate,
                invoices,
                reason: "no_vendor_match",
                message: "We couldn't match this file to a supplier. Enter the supplier name to continue.",
                candidateSuppliers: buildCandidateSuppliers(matchesAbove08),
            });
        }
        throw new Error("We couldn't match this file to a supplier. Please add the supplier in Reconciliation first.");
    }

    // When a supply matches, ensure vendor is marked as supplier if not already
    await Vendor.updateOne(
        { xeroId: selectedVendor, supplier: { $ne: true } },
        { $set: { supplier: true, modifiedLast: new Date() } }
    );

    const dateOnFile = parseInvoiceDate(fileDate);
    const statement = await Statement.create({
        contactId: selectedVendor,
        file: storedFile,
        isDeleted: false,
        dateOnFile,
    });

    const outcome = {
        vendorId: selectedVendor,
        invoices,
        statementId: statement._id,
    };
    console.log(PARSE_FILE_LOG, "prepareOneFileUpload OUTCOME", {
        fileName,
        success: true,
        vendorId: selectedVendor,
        statementId: statement._id,
        invoiceCount: invoices.length,
        currencyOfFile,
    });
    return outcome;
}

/**
 * POST /invoice/invoice-file-upload
 * Accepts a single file (PDF or Excel), parses it and returns parsed result.
 */
exports.invoiceFileUpload = tryCatchAsync(async (req, res, next) => {
    const file = validateUpload(req, res);
    if (!file) {
        console.log("[invoiceFileUpload] validateUpload: no file");
        return;
    }
    const fileName = getFileName(file);
    console.log(PARSE_FILE_LOG, "invoiceFileUpload CALL", { fileName });
    console.log("[invoiceFileUpload] start");
    try {
        const body = await prepareOneFileUpload(file, { allowManualSupplierInput: true });
        if (body?.status === NEEDS_SUPPLIER_INPUT_STATUS) {
            return res.status(409).json(body);
        }
        req.body.vendorId = body.vendorId;
        req.body.invoices = body.invoices;
        req.body.statementId = body.statementId;
        return exports.completeInvoiceFileUpload(req, res, (err) => {
            if (err) sendParseError(err, res);
        });
    } catch (err) {
        console.log(PARSE_FILE_LOG, "invoiceFileUpload OUTCOME", { fileName, success: false, error: err.message, statusCode: err.statusCode });
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
    if (!vendor) throw new Error("We couldn't match this file to a supplier. Please add the supplier in Reconciliation first.");

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

    // For each file invoice: if existing invoice with same invoice number and fromXero false, update it; otherwise create new (fromXero: false).
    // Match by exact invoice number or by idNoLetters so "INV-001" and "001" count as same; dedupe so we never leave multiple fromXero false with same number.
    const contactId = vendor.xeroId;
    const created = [];
    const statementIdsToCheck = new Set();
    const idNoLettersForMatch = (s) => String(s ?? "").replace(/[a-zA-Z]/g, "").trim();
    let existingFromFile = await Invoice.find({ contactId, fromXero: false, isDeleted: { $ne: true } }).lean();

    for (const fileInv of invoicesWithClosestMatches) {
        const numbersToFind = [
            fileInv.invoiceNumber,
            ...(Array.isArray(fileInv.potentialInvoiceIds) ? fileInv.potentialInvoiceIds : []),
        ].map((s) => String(s).trim()).filter(Boolean);
        const canonicalNumber = fileInv.match?.length > 0
            ? fileInv.match[0].invoice.invoiceNumber
            : (fileInv.invoiceNumber ?? "");
        if (!canonicalNumber.trim()) continue;

        const dateVal = parseInvoiceDate(fileInv.invoiceDate ?? fileInv.dateDue);
        const dueDateVal = parseInvoiceDate(fileInv.dateDue ?? fileInv.dueDate);
        const updatePayload = {
            invoiceNumber: canonicalNumber.trim(),
            amount: fileInv.amount != null ? Number(fileInv.amount) : null,
            status: fileInv.paymentStatus === "paid" ? "paid" : "unpaid",
            description: fileInv.activityDescription ?? null,
            currency: toISO4217Currency(fileInv.currency),
            date: dateVal,
            dueDate: dueDateVal,
            fromXero: false,
            isDeleted: false,
            statementId: statementId || null,
        };

        const canonicalDigits = idNoLettersForMatch(canonicalNumber);
        const matchingExisting = existingFromFile.filter((ex) => {
            if (numbersToFind.includes(ex.invoiceNumber)) return true;
            if (canonicalDigits && idNoLettersForMatch(ex.invoiceNumber) === canonicalDigits) return true;
            return false;
        });

        let record;
        if (matchingExisting.length > 0) {
            const toUpdate = matchingExisting[0];
            const extras = matchingExisting.slice(1);
            if (toUpdate.statementId) statementIdsToCheck.add(toUpdate.statementId.toString());
            for (const inv of extras) {
                if (inv.statementId) statementIdsToCheck.add(inv.statementId.toString());
            }
            if (extras.length > 0) {
                await Invoice.deleteMany({ _id: { $in: extras.map((e) => e._id) } });
                existingFromFile = existingFromFile.filter((ex) => !extras.some((e) => e._id.equals(ex._id)));
            }
            record = await Invoice.findByIdAndUpdate(
                toUpdate._id,
                { $set: updatePayload },
                { new: true, runValidators: true }
            );
        } else {
            record = await Invoice.create({
                ...updatePayload,
                contactId,
            });
            existingFromFile.push({ invoiceNumber: record.invoiceNumber, _id: record._id, statementId: record.statementId });
        }
        created.push(record);
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

    const result = {
        success: true,
        vendorId,
        vendor: { name: vendor.name, xeroId: vendor.xeroId },
        invoices: invoicesWithClosestMatches,
        xeroInvoiceCount: xeroInvoices.length,
        matchThreshold: MATCH_THRESHOLD,
        matchCount,
        createdCount: created.length,
        created: created.map((inv) => ({ _id: inv._id, invoiceNumber: inv.invoiceNumber, amount: inv.amount, date: inv.date, dueDate: inv.dueDate, currency: inv.currency })),
    };
    console.log(PARSE_FILE_LOG, "completeInvoiceFileUploadLogic OUTCOME", {
        statementId,
        vendorId,
        vendorName: vendor?.name,
        invoiceCount: fileInvoices.length,
        currencyOfFile: [...new Set(fileInvoices.map((inv) => inv.currency).filter(Boolean))],
        matchCount: result.matchCount,
        createdCount: result.createdCount,
        created: result.created,
    });
    return result;
}

exports.completeInvoiceFileUpload = tryCatchAsync(async (req, res) => {
    const result = await completeInvoiceFileUploadLogic(req.body, req.user?._id);
    return res.status(200).json(result);
});

async function resolveVendorFromManualName(name) {
    const typed = String(name || "").trim();
    if (!typed) return null;

    const exactRegex = new RegExp(`^${typed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const exact = await Vendor.findOne({
        name: exactRegex,
        isDeleted: { $ne: true },
        xeroId: { $exists: true, $nin: [null, ""] },
    }).lean();
    if (exact?.xeroId) return exact;

    const similar = await searchSimilarVendors(typed, 5);
    const best = (similar.matches || []).find((m) => Number(m.score ?? m.similarityToQuery ?? 0) >= SIMILARITY_THRESHOLD);
    if (!best?.xeroId) return null;

    return Vendor.findOne({
        xeroId: best.xeroId,
        isDeleted: { $ne: true },
    }).lean();
}

exports.continueUnresolvedInvoiceUpload = tryCatchAsync(async (req, res) => {
    const supplierName = String(req.body?.supplierName || "").trim();
    const unresolvedUpload = req.body?.unresolvedUpload || {};
    const invoices = Array.isArray(unresolvedUpload.invoices) ? unresolvedUpload.invoices : [];
    const fileName = unresolvedUpload.fileName || "statement";
    const storedFile = unresolvedUpload.storedFile || null;
    const vendor = await resolveVendorFromManualName(supplierName);

    if (!supplierName) {
        return res.status(400).json({
            success: false,
            message: "Please enter a supplier name to continue.",
        });
    }
    if (!vendor?.xeroId) {
        return res.status(404).json({
            success: false,
            status: "supplier_not_found",
            message: SUPPLIER_NOT_FOUND_MESSAGE,
        });
    }

    await Vendor.updateOne(
        { xeroId: vendor.xeroId, supplier: { $ne: true } },
        { $set: { supplier: true, modifiedLast: new Date() } }
    );

    const statement = await Statement.create({
        contactId: vendor.xeroId,
        file: storedFile,
        isDeleted: false,
        dateOnFile: parseInvoiceDate(unresolvedUpload.fileDate),
    });

    const result = await completeInvoiceFileUploadLogic(
        { vendorId: vendor.xeroId, invoices, statementId: statement._id },
        req.user?._id
    );

    return res.status(200).json({
        ...result,
        fileName,
        resolvedBy: "manual_supplier_input",
    });
});

/**
 * POST /invoice/batch-invoice-file-upload
 * Accepts multiple files; processes each and creates one activity log for the batch.
 * ids in the log: s-<statementId> for each statement, i-<invoiceId> for each created invoice.
 */
exports.batchInvoiceFileUpload = tryCatchAsync(async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) {
        return res.status(400).json({ success: false, message: "Please add at least one file to upload." });
    }
    console.log(PARSE_FILE_LOG, "batchInvoiceFileUpload CALL", { fileCount: files.length, fileNames: files.map((f) => f.originalname || f.name) });
    const userId = req.user?._id;
    const allIds = [];
    const results = [];
    const errors = [];
    for (const file of files) {
        const fileLabel = file.originalname || file.name;
        console.log(PARSE_FILE_LOG, "batchInvoiceFileUpload FILE", { fileName: fileLabel, fileIndex: results.length + errors.length + 1, totalFiles: files.length });
        try {
            const body = await prepareOneFileUpload(file, { allowManualSupplierInput: true });
            if (body?.status === NEEDS_SUPPLIER_INPUT_STATUS) {
                errors.push({
                    fileName: fileLabel,
                    status: NEEDS_SUPPLIER_INPUT_STATUS,
                    message: body.message,
                    reason: body.reason,
                    candidateSuppliers: body.candidateSuppliers,
                    unresolvedUpload: body.unresolvedUpload,
                });
                continue;
            }
            const result = await completeInvoiceFileUploadLogic(body, userId, { skipProcessLog: true });
            allIds.push(`s-${body.statementId}`);
            result.created.forEach((inv) => allIds.push(`i-${inv._id}`));
            const resultEntry = {
                fileName: fileLabel,
                success: true,
                statementId: body.statementId,
                createdCount: result.created.length,
            };
            results.push(resultEntry);
            console.log(PARSE_FILE_LOG, "batchInvoiceFileUpload FILE OUTCOME", { fileName: fileLabel, success: true, statementId: body.statementId, createdCount: result.created.length, currencyOfFile: [...new Set((body.invoices || []).map((inv) => inv.currency).filter(Boolean))] });
        } catch (err) {
            console.log(PARSE_FILE_LOG, "batchInvoiceFileUpload FILE OUTCOME", { fileName: fileLabel, success: false, error: err.message });
            errors.push({
                fileName: fileLabel,
                status: "error",
                error: "We couldn't process this file. Please check the format and try again.",
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
    console.log(PARSE_FILE_LOG, "batchInvoiceFileUpload OUTCOME", {
        totalFiles: files.length,
        processed: results.length,
        failed: errors.length,
        results: results.map((r) => ({ fileName: r.fileName, statementId: r.statementId, createdCount: r.createdCount })),
        errors: errors.length ? errors.map((e) => ({ fileName: e.fileName, error: e.error })) : undefined,
    });
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
    const fileSize = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0;
    console.log(PARSE_FILE_LOG, "processOneStatementFile CALL", { fileName, fileSize });
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

        const { matchesAbove08, preferredVendorId } = await selectBestVendor(first.name);
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

        if (supplierMatchCountList.length === 0 && matchesAbove08?.length > 1 && !preferredVendorId) {
            return { success: false, error: "Could not determine the best vendor." };
        }

        const selectedVendor = supplierMatchCountList[0]?.contactId ?? preferredVendorId ?? matchesAbove08?.[0]?.xeroId;
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
        const outcome = { ...result, statementId: statement._id };
        console.log(PARSE_FILE_LOG, "processOneStatementFile OUTCOME", {
            fileName,
            success: true,
            statementId: statement._id,
            vendorId: selectedVendor,
            invoiceCount: invoices.length,
            currencyOfFile: [...new Set(invoices.map((inv) => inv.currency).filter(Boolean))],
            createdCount: result.createdCount,
            matchCount: result.matchCount,
        });
        return outcome;
    } catch (err) {
        console.log(PARSE_FILE_LOG, "processOneStatementFile OUTCOME", { fileName, success: false, error: err.message || String(err) });
        console.error("[processOneStatementFile]", err);
        return { success: false, error: err.message || String(err) };
    }
};