/**
 * Beta file parsing: same API as utilsController (getCompaniesFromFile, getInvoicesFromFileWithAIVision)
 * but uses PDF page extraction, image downscaling, and parallel vision requests for PDFs.
 * Not connected to frontend; use via require("./utilsControllerBeta") when testing.
 */
const { fileTypeFromBuffer } = require("file-type");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");
const axios = require("axios");
const sharp = require("sharp");

const LOG = "[parseFileBeta]";
const OPEN_ROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPEN_ROUTER_RETRY_MAX = 3;
const OPEN_ROUTER_RETRY_BASE_MS = 2000;
const VISION_CONCURRENCY = 4;
const SHARP_MAX_WIDTH = 1600;
const SHARP_JPEG_QUALITY = 75;

async function openRouterPost(requestBody, openRouterKey) {
    const startMs = Date.now();
    let lastError;
    for (let attempt = 0; attempt <= OPEN_ROUTER_RETRY_MAX; attempt++) {
        try {
            const response = await axios.post(OPEN_ROUTER_URL, requestBody, {
                headers: {
                    Authorization: `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json",
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
            const elapsedMs = Date.now() - startMs;
            console.log(LOG, "openRouterPost OK", { elapsedMs, attempts: attempt + 1 });
            return response;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            const retryAfter = err.response?.headers?.["retry-after"];
            const isRetryable = status === 429 || status === 503 || status === 500 || status === 502;
            if (isRetryable && attempt < OPEN_ROUTER_RETRY_MAX) {
                const waitMs = retryAfter
                    ? Math.min(Number(retryAfter) * 1000, 60000)
                    : OPEN_ROUTER_RETRY_BASE_MS * Math.pow(2, attempt);
                console.warn(LOG, "OpenRouter retry", { status, attempt: attempt + 1, waitMs, is5xx: status >= 500 });
                await new Promise((r) => setTimeout(r, waitMs));
                continue;
            }
            const msg = status === 429
                ? "Rate limit exceeded. Please try again in a few minutes."
                : (err.message || "Request failed");
            const e = new Error(msg);
            e.statusCode = status;
            console.log(LOG, "openRouterPost ERROR", { elapsedMs: Date.now() - startMs, attempts: attempt + 1, status });
            throw e;
        }
    }
    throw lastError;
}

/** Run async tasks with bounded concurrency. */
async function runWithConcurrency(tasks, concurrency) {
    const results = [];
    let index = 0;
    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            try {
                results[i] = await tasks[i]();
            } catch (err) {
                results[i] = { __error: err };
            }
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

/** Run async tasks with bounded concurrency; call onProgress(doneCount, total, outcome) after each task completes. */
async function runWithConcurrencyAndProgress(tasks, concurrency, onProgress) {
    const results = [];
    let index = 0;
    let completedCount = 0;
    const total = tasks.length;
    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            let outcome;
            try {
                outcome = await tasks[i]();
                results[i] = outcome;
            } catch (err) {
                outcome = { __error: err };
                results[i] = outcome;
            }
            completedCount++;
            if (typeof onProgress === "function") onProgress(completedCount, total, outcome);
        }
    }
    const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
    await Promise.all(workers);
    return results;
}

/**
 * Extract one image per page from PDF (first image of each page). Returns array of { dataUrl } or [].
 */
async function extractPdfPageImages(fileBuffer) {
    const parser = new PDFParse({ data: fileBuffer });
    try {
        let imageResult = { pages: [] };
        try {
            imageResult = await parser.getImage({ imageThreshold: 0, imageDataUrl: true, imageBuffer: false });
        } catch (_) {}
        const pageImages = [];
        if (imageResult?.pages) {
            for (const page of imageResult.pages) {
                const images = page?.images || [];
                const first = images[0];
                if (first) {
                    const dataUrl = first.dataUrl ?? first.dataURL ?? (first.data ? `data:image/png;base64,${(Buffer.isBuffer(first.data) ? first.data : Buffer.from(first.data)).toString("base64")}` : null);
                    if (dataUrl) pageImages.push({ dataUrl });
                }
            }
        }
        return pageImages;
    } finally {
        if (parser.destroy) await parser.destroy();
    }
}

/**
 * Downscale image from dataUrl to smaller JPEG dataUrl.
 */
async function downscaleImage(dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return dataUrl;
    const base64 = match[2].replace(/\s/g, "");
    const buffer = Buffer.from(base64, "base64");
    const out = await sharp(buffer)
        .resize({ width: SHARP_MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: SHARP_JPEG_QUALITY })
        .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
}

// --------------- Company names (same prompt and parsing as current) ---------------
const FILE_TITLE_HINT = (fileName) =>
    fileName ? `File name: "${String(fileName).slice(0, 180)}" use the file name as an additional context when identifying company names. ` : "";
const COMPANY_NAMES_PROMPT = (fileName) =>
    FILE_TITLE_HINT(fileName) +
    "From this document (invoice, statement, or spreadsheet), identify the top 3 most likely company names (sender, recipient, vendor, client, business names). " +
    "Reply with a JSON array of exactly 3 objects, each with keys \"name\" (string) and \"confidence\" (number 0 to 1). Order by confidence descending. " +
    "Example: [{\"name\": \"ACME Inc\", \"confidence\": 0.95}, {\"name\": \"Client Co\", \"confidence\": 0.8}, {\"name\": \"\", \"confidence\": 0}]. If fewer than 3, use empty string and 0 for the rest.";

function parseCompanyNamesRaw(raw) {
    const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, "").trim();
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\[[\s\S]*\]/);
        parsed = match ? JSON.parse(match[0]) : [];
    }
    return Array.isArray(parsed)
        ? parsed.filter((x) => x && typeof x === "object").map((x) => ({
            name: typeof x.name === "string" ? x.name.trim() : "",
            confidence: typeof x.confidence === "number" ? Math.max(0, Math.min(1, x.confidence)) : 0,
        }))
        : [];
}

function mergeCompanyNamesToTop3(entries, fileName) {
    const normalizeNameForFileMatch = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const byNorm = new Map();
    for (const entry of entries) {
        if (!entry.name) continue;
        const norm = normalizeNameForFileMatch(entry.name);
        if (!byNorm.has(norm) || byNorm.get(norm).confidence < entry.confidence) {
            byNorm.set(norm, { name: entry.name, confidence: entry.confidence });
        }
    }
    const list = Array.from(byNorm.values());
    const fileNameCompact = String(fileName || "").toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "");
    const filenameMatchBoost = (companyName) => {
        const normalized = normalizeNameForFileMatch(companyName);
        if (!fileNameCompact || normalized.length < 3) return 0;
        if (fileNameCompact.includes(normalized)) return 0.2;
        if (normalized.includes(fileNameCompact) && fileNameCompact.length >= 4) return 0.12;
        return 0;
    };
    const rerankedList = list
        .map((entry) => {
            const boost = filenameMatchBoost(entry.name);
            return {
                ...entry,
                filenameBoost: boost,
                adjustedConfidence: Math.max(0, Math.min(1, entry.confidence + boost)),
            };
        })
        .sort((a, b) => {
            if (b.adjustedConfidence !== a.adjustedConfidence) return b.adjustedConfidence - a.adjustedConfidence;
            return b.confidence - a.confidence;
        })
        .slice(0, 3);
    while (rerankedList.length < 3) rerankedList.push({ name: "", confidence: 0, filenameBoost: 0, adjustedConfidence: 0 });
    const used = new Set();
    const nextUniqueConfidence = (c) => {
        let val = Math.round(Math.max(0, Math.min(1, c)) * 1000) / 1000;
        while (used.has(val)) {
            val = val <= 0 ? Math.min(0.001 * used.size, 0.99) : Math.max(0, Math.round((val - 0.001) * 1000) / 1000);
        }
        used.add(val);
        return val;
    };
    return rerankedList.slice(0, 3).map((entry) => ({
        name: entry.name,
        confidence: nextUniqueConfidence(entry.adjustedConfidence),
    }));
}

// --------------- Invoices (same prompt and parsing as current) ---------------
const INVOICES_AI_PROMPT = `Extract ALL invoices from this document (statement, invoice list, or spreadsheet). Return ONLY valid JSON, no markdown or commentary.

Required JSON structure:
{
  "fileDate": "yyyy-mm-dd",
  "invoices": [
    {
      "invoiceNumber": "string",
      "potentialInvoiceIds": ["string", "string", ...],
      "amount": number,
      "currency": "string",
      "dateDue": "yyyy-mm-dd",
      "invoiceDate": "yyyy-mm-dd",
      "activityDescription": "string",
      "paymentStatus": "paid" | "unpaid"
    }
  ]
}

Rules:
- fileDate: the date of the statement/document (from header, footer, or "Statement as at").
- For EACH invoice/row: invoiceNumber = primary reference; potentialInvoiceIds = ALL possible invoice IDs (Our Ref, Invoice No., Reference, Doc Number, etc.).
- amount: numeric total (no currency symbols). currency: e.g. "USD", "£", "€".
- dateDue and invoiceDate: use yyyy-mm-dd. Use null if missing.
- Extract EVERY row/entry; if only one invoice, return one object in the array.`;

function normalizeInvoiceFromRaw(inv) {
    const amountVal = inv.amount != null
        ? (typeof inv.amount === "object" && inv.amount !== null
            ? (Number(inv.amount.amount) || 0) + (Number(inv.amount.tax_fees) || 0)
            : Number(inv.amount))
        : null;
    return {
        invoiceNumber: typeof inv.invoiceNumber === "string" ? inv.invoiceNumber.trim() : String(inv.invoiceNumber ?? ""),
        potentialInvoiceIds: Array.isArray(inv.potentialInvoiceIds) ? inv.potentialInvoiceIds.map(String).filter(Boolean) : [inv.invoiceNumber].filter(Boolean),
        amount: amountVal,
        currency: typeof inv.currency === "string" ? inv.currency.trim() : (inv.currency ?? null),
        dateDue: inv.dateDue ?? inv.dueDate ?? null,
        invoiceDate: inv.invoiceDate ?? null,
        activityDescription: typeof inv.activityDescription === "string" ? inv.activityDescription.trim() : (inv.activityDescription ?? null),
        paymentStatus: inv.paymentStatus === "paid" || inv.paymentStatus === "unpaid" ? inv.paymentStatus : "unpaid",
    };
}

function parseInvoicesFromRaw(raw) {
    const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, "").trim();
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objMatch) return { fileDate: null, invoices: [] };
    let obj;
    try {
        obj = JSON.parse(objMatch[0]);
    } catch {
        return { fileDate: null, invoices: [] };
    }
    const fileDate = obj.fileDate ?? null;
    let invoices = Array.isArray(obj.invoices) ? obj.invoices.map(normalizeInvoiceFromRaw) : [];
    for (const inv of invoices) {
        if ((inv.dateDue == null || inv.dateDue === "") && inv.invoiceDate) {
            inv.dateDue = inv.invoiceDate;
            inv.invoiceDate = null;
        }
    }
    return { fileDate, invoices };
}

// --------------- Fallback: full PDF single request (current behavior) ---------------
function buildFullPdfCompanyNamesRequest(fileBuffer, fileName) {
    const mime = "application/pdf";
    const fileDataUrl = `data:${mime};base64,${fileBuffer.toString("base64")}`;
    return {
        model: "google/gemini-2.5-flash",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: COMPANY_NAMES_PROMPT(fileName) },
                    { type: "file", file: { filename: fileName || "document", file_data: fileDataUrl } },
                ],
            },
        ],
        plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }],
    };
}

function buildFullPdfInvoicesRequest(fileBuffer, fileName) {
    const mime = "application/pdf";
    const fileDataUrl = `data:${mime};base64,${fileBuffer.toString("base64")}`;
    return {
        model: "google/gemini-2.5-flash",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: INVOICES_AI_PROMPT },
                    { type: "file", file: { filename: fileName || "document", file_data: fileDataUrl } },
                ],
            },
        ],
        plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }],
    };
}

// --------------- getCompaniesFromFile ---------------
async function getCompaniesFromFile(fileBuffer, fileName) {
    const startMs = Date.now();
    const fileSize = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0;
    console.log(LOG, "getCompaniesFromFile CALL", { fileName: fileName || "(unnamed)", fileSize });

    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey) {
        console.log(LOG, "getCompaniesFromFile OUTCOME", { success: false, error: "OPEN_ROUTER not configured" });
        throw new Error("OPEN_ROUTER not configured; cannot get company names from file.");
    }
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType) {
        console.log(LOG, "getCompaniesFromFile OUTCOME", { success: false, error: "Unable to determine file type" });
        throw new Error("Unable to determine file type");
    }

    // Excel: same as current (text-only)
    if (fileType.ext === "xlsx" || fileType.ext === "xls") {
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const parts = [];
        workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const records = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, dateNF: "yyyy-mm-dd" });
            parts.push(`Sheet: ${sheetName}\n` + JSON.stringify(records.slice(0, 100), null, 2));
        });
        const documentText = parts.join("\n\n").slice(0, 30000);
        const requestBody = {
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: COMPANY_NAMES_PROMPT(fileName) + "\n\nDocument content (spreadsheet data):\n" + documentText }],
        };
        const response = await openRouterPost(requestBody, openRouterKey);
        const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
        const elapsedMs = Date.now() - startMs;
        if (!raw) {
            console.log(LOG, "getCompaniesFromFile OUTCOME", { success: false, elapsedMs });
            return { companyNames: [{ name: "", confidence: 0 }, { name: "", confidence: 0 }, { name: "", confidence: 0 }] };
        }
        const list = parseCompanyNamesRaw(raw);
        const companyNames = mergeCompanyNamesToTop3(list, fileName);
        console.log(LOG, "getCompaniesFromFile OUTCOME", { success: true, elapsedMs, source: "excel" });
        return { companyNames };
    }

    // PDF: extract pages -> downscale -> parallel vision -> merge, or fallback to full PDF
    if (fileType.ext === "pdf") {
        let pageImages;
        try {
            pageImages = await extractPdfPageImages(fileBuffer);
        } catch (err) {
            console.log(LOG, "getCompaniesFromFile extractPdfPageImages failed", { error: err.message });
            pageImages = [];
        }
        if (pageImages.length === 0) {
            console.log(LOG, "getCompaniesFromFile fallback to full PDF", { reason: "no page images" });
            try {
                const requestBody = buildFullPdfCompanyNamesRequest(fileBuffer, fileName);
                const response = await openRouterPost(requestBody, openRouterKey);
                const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
                const elapsedMs = Date.now() - startMs;
                if (!raw) {
                    console.log(LOG, "getCompaniesFromFile OUTCOME", { success: false, elapsedMs });
                    return { companyNames: [{ name: "", confidence: 0 }, { name: "", confidence: 0 }, { name: "", confidence: 0 }] };
                }
                const list = parseCompanyNamesRaw(raw);
                const companyNames = mergeCompanyNamesToTop3(list, fileName);
                console.log(LOG, "getCompaniesFromFile OUTCOME", { success: true, elapsedMs, source: "fullPdf" });
                return { companyNames };
            } catch (fallbackErr) {
                console.warn(LOG, "getCompaniesFromFile full-PDF fallback failed, using main controller", { error: fallbackErr.message });
                const main = require("./utilsController");
                return main.getCompaniesFromFile(fileBuffer, fileName);
            }
        }
        const downscaleStart = Date.now();
        const downscaled = await Promise.all(pageImages.map((p) => downscaleImage(p.dataUrl)));
        console.log(LOG, "getCompaniesFromFile downscale", { pageCount: downscaled.length, elapsedMs: Date.now() - downscaleStart });
        const prompt = COMPANY_NAMES_PROMPT(fileName);
        const tasks = downscaled.map((dataUrl, i) => () => {
            const body = {
                model: "google/gemini-2.5-flash",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: `This is page ${i + 1} of a multi-page document. ${prompt}` },
                            { type: "image_url", image_url: { url: dataUrl } },
                        ],
                    },
                ],
            };
            return openRouterPost(body, openRouterKey);
        });
        const results = await runWithConcurrency(tasks, VISION_CONCURRENCY);
        const allEntries = [];
        let hasError = false;
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r && r.__error) {
                hasError = true;
                console.warn(LOG, "getCompaniesFromFile page failed", { pageIndex: i, error: r.__error?.message });
                continue;
            }
            const rawContent = r?.data?.choices?.[0]?.message?.content?.trim() || "";
            if (rawContent) allEntries.push(...parseCompanyNamesRaw(rawContent));
        }
        if (allEntries.length === 0 && hasError) {
            console.log(LOG, "getCompaniesFromFile fallback to full PDF", { reason: "all page requests failed" });
            try {
                const requestBody = buildFullPdfCompanyNamesRequest(fileBuffer, fileName);
                const response = await openRouterPost(requestBody, openRouterKey);
                const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
                const elapsedMs = Date.now() - startMs;
                if (!raw) {
                    return { companyNames: [{ name: "", confidence: 0 }, { name: "", confidence: 0 }, { name: "", confidence: 0 }] };
                }
                const list = parseCompanyNamesRaw(raw);
                const companyNames = mergeCompanyNamesToTop3(list, fileName);
                console.log(LOG, "getCompaniesFromFile OUTCOME", { success: true, elapsedMs, source: "fullPdf" });
                return { companyNames };
            } catch (fallbackErr) {
                console.warn(LOG, "getCompaniesFromFile full-PDF fallback failed, using main controller", { error: fallbackErr.message });
                const main = require("./utilsController");
                return main.getCompaniesFromFile(fileBuffer, fileName);
            }
        }
        const companyNames = mergeCompanyNamesToTop3(allEntries, fileName);
        const elapsedMs = Date.now() - startMs;
        console.log(LOG, "getCompaniesFromFile OUTCOME", { success: true, elapsedMs, source: "parallelPages", pageCount: pageImages.length });
        return { companyNames };
    }

    console.log(LOG, "getCompaniesFromFile OUTCOME", { success: false, error: `Unsupported file type: ${fileType.ext}` });
    throw new Error(`Unsupported file type: ${fileType.ext}. Only PDF and Excel are supported.`);
}

// --------------- getInvoicesFromFileWithAIVision ---------------
async function getInvoicesFromFileWithAIVision(fileBuffer, fileName) {
    const startMs = Date.now();
    const fileSize = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0;
    console.log(LOG, "getInvoicesFromFileWithAIVision CALL", { fileName: fileName || "(unnamed)", fileSize });

    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey) {
        console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, error: "OPEN_ROUTER not configured" });
        throw new Error("OPEN_ROUTER not configured; cannot extract invoices from file.");
    }
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType) {
        console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, error: "Unable to determine file type" });
        throw new Error("Unable to determine file type");
    }

    // Excel: same as current (text-only)
    if (fileType.ext === "xlsx" || fileType.ext === "xls") {
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const parts = [];
        workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const records = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, dateNF: "yyyy-mm-dd" });
            parts.push(`Sheet: ${sheetName}\n` + JSON.stringify(records.slice(0, 150), null, 2));
        });
        const documentText = parts.join("\n\n").slice(0, 35000);
        const requestBody = {
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: INVOICES_AI_PROMPT + "\n\nDocument content:\n" + documentText }],
        };
        const response = await openRouterPost(requestBody, openRouterKey);
        const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
        const elapsedMs = Date.now() - startMs;
        if (!raw) {
            console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, fileDate: null, invoiceCount: 0, elapsedMs });
            return { fileDate: null, invoices: [] };
        }
        const { fileDate, invoices } = parseInvoicesFromRaw(raw);
        console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: true, fileDate, invoiceCount: invoices.length, elapsedMs, source: "excel" });
        return { fileDate, invoices };
    }

    // PDF: extract pages -> downscale -> parallel vision -> merge, or fallback to full PDF
    if (fileType.ext === "pdf") {
        let pageImages;
        try {
            pageImages = await extractPdfPageImages(fileBuffer);
        } catch (err) {
            console.log(LOG, "getInvoicesFromFileWithAIVision extractPdfPageImages failed", { error: err.message });
            pageImages = [];
        }
        if (pageImages.length === 0) {
            console.log(LOG, "getInvoicesFromFileWithAIVision fallback to full PDF", { reason: "no page images" });
            try {
                const requestBody = buildFullPdfInvoicesRequest(fileBuffer, fileName);
                const response = await openRouterPost(requestBody, openRouterKey);
                const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
                if (!raw) {
                    console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, fileDate: null, invoiceCount: 0 });
                    return { fileDate: null, invoices: [] };
                }
                const out = parseInvoicesFromRaw(raw);
                console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: true, fileDate: out.fileDate, invoiceCount: out.invoices.length, source: "fullPdf" });
                return out;
            } catch (fallbackErr) {
                console.warn(LOG, "getInvoicesFromFileWithAIVision full-PDF fallback failed, using main controller", { error: fallbackErr.message });
                const main = require("./utilsController");
                return main.getInvoicesFromFileWithAIVision(fileBuffer, fileName);
            }
        }
        const downscaleStart = Date.now();
        const downscaled = await Promise.all(pageImages.map((p) => downscaleImage(p.dataUrl)));
        console.log(LOG, "getInvoicesFromFileWithAIVision downscale", { pageCount: downscaled.length, elapsedMs: Date.now() - downscaleStart });
        const tasks = downscaled.map((dataUrl, i) => () => {
            const body = {
                model: "google/gemini-2.5-flash",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: `This is page ${i + 1} of a multi-page document. Extract ALL invoices from this page. ${INVOICES_AI_PROMPT}` },
                            { type: "image_url", image_url: { url: dataUrl } },
                        ],
                    },
                ],
            };
            return openRouterPost(body, openRouterKey);
        });
        const results = await runWithConcurrency(tasks, VISION_CONCURRENCY);
        let mergedFileDate = null;
        const allInvoices = [];
        const seenNumbers = new Set();
        let hasError = false;
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r && r.__error) {
                hasError = true;
                console.warn(LOG, "getInvoicesFromFileWithAIVision page failed", { pageIndex: i, error: r.__error?.message });
                continue;
            }
            const rawContent = r?.data?.choices?.[0]?.message?.content?.trim() || "";
            if (!rawContent) continue;
            const { fileDate: pageDate, invoices: pageInvoices } = parseInvoicesFromRaw(rawContent);
            if (pageDate && mergedFileDate == null) mergedFileDate = pageDate;
            for (const inv of pageInvoices) {
                const num = (inv.invoiceNumber || "").trim();
                if (num && !seenNumbers.has(num)) {
                    seenNumbers.add(num);
                    allInvoices.push(inv);
                }
            }
        }
        if (allInvoices.length === 0 && hasError) {
            console.log(LOG, "getInvoicesFromFileWithAIVision fallback to full PDF", { reason: "all page requests failed" });
            try {
                const requestBody = buildFullPdfInvoicesRequest(fileBuffer, fileName);
                const response = await openRouterPost(requestBody, openRouterKey);
                const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
                if (!raw) return { fileDate: null, invoices: [] };
                const out = parseInvoicesFromRaw(raw);
                console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: true, fileDate: out.fileDate, invoiceCount: out.invoices.length, source: "fullPdf" });
                return out;
            } catch (fallbackErr) {
                console.warn(LOG, "getInvoicesFromFileWithAIVision full-PDF fallback failed, using main controller", { error: fallbackErr.message });
                const main = require("./utilsController");
                return main.getInvoicesFromFileWithAIVision(fileBuffer, fileName);
            }
        }
        const elapsedMs = Date.now() - startMs;
        const currenciesInFile = [...new Set(allInvoices.map((inv) => inv.currency).filter(Boolean))];
        console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", {
            success: true,
            fileDate: mergedFileDate,
            invoiceCount: allInvoices.length,
            currencyOfFile: currenciesInFile,
            elapsedMs,
            source: "parallelPages",
            pageCount: pageImages.length,
        });
        return { fileDate: mergedFileDate, invoices: allInvoices };
    }

    console.log(LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, error: `Unsupported file type: ${fileType.ext}` });
    throw new Error(`Unsupported file type: ${fileType.ext}. Only PDF and Excel are supported.`);
}

module.exports = {
    getCompaniesFromFile,
    getInvoicesFromFileWithAIVision,
    runWithConcurrency,
    runWithConcurrencyAndProgress,
};
