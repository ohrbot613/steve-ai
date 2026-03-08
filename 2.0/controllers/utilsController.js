const { fileTypeFromBuffer } = require("file-type");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");
const axios = require("axios");
const sharp = require("sharp");

const IMAGE_MAX_WIDTH = 1600;
const IMAGE_JPEG_QUALITY = 75;

const OPEN_ROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPEN_ROUTER_RETRY_MAX = 3;
const OPEN_ROUTER_RETRY_BASE_MS = 2000;

/**
 * POST to OpenRouter with retry on 429/503. Uses exponential backoff; respects Retry-After if present.
 */
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
            console.log("[parseFile] openRouterPost OK", { elapsedMs, attempts: attempt + 1 });
            return response;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            const retryAfter = err.response?.headers?.["retry-after"];
            if ((status === 429 || status === 503) && attempt < OPEN_ROUTER_RETRY_MAX) {
                const waitMs = retryAfter
                    ? Math.min(Number(retryAfter) * 1000, 60000)
                    : OPEN_ROUTER_RETRY_BASE_MS * Math.pow(2, attempt);
                console.warn("[parseFile] OpenRouter rate limit or server error, retrying", {
                    status,
                    attempt: attempt + 1,
                    waitMs,
                });
                await new Promise((r) => setTimeout(r, waitMs));
                continue;
            }
            const msg = status === 429
                ? "Rate limit exceeded. Please try again in a few minutes."
                : (err.message || "Request failed");
            const e = new Error(msg);
            e.statusCode = status;
            const elapsedMs = Date.now() - startMs;
            console.log("[parseFile] openRouterPost ERROR", { elapsedMs, attempts: attempt + 1, status, message: err.message });
            throw e;
        }
    }
}

/**
 * Extract text from image-based PDF using OpenRouter AI vision (optional).
 * Only runs if OPEN_ROUTER env is set.
 */
async function extractTextFromImagePDF(fileBuffer, fileName) {
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey) {
        throw new Error("OPEN_ROUTER not configured; cannot extract text from image PDF.");
    }
    const base64Pdf = fileBuffer.toString("base64");
    const fileDataUrl = `data:application/pdf;base64,${base64Pdf}`;
    const requestBody = {
        model: "google/gemini-2.5-flash",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Extract all text from this PDF exactly. Return only the raw extracted text, no commentary.",
                    },
                    {
                        type: "file",
                        file: { filename: fileName, file_data: fileDataUrl },
                    },
                ],
            },
        ],
        plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }],
    };
    const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        requestBody,
        {
            headers: {
                Authorization: `Bearer ${openRouterKey}`,
                "Content-Type": "application/json",
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        }
    );
    const text = response.data?.choices?.[0]?.message?.content || "";
    if (!text.trim()) {
        throw new Error("AI vision extraction returned no text.");
    }
    return text;
}

/**
 * Ask AI to describe an image and extract any text it holds (vision + OCR).
 * Text is returned with titles and structure, not as a raw blob. Images only.
 * Uses OPEN_ROUTER. Returns { description, textInImage } or null if not configured / error.
 */
async function describeImageWithAI(imageDataUrl) {
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey || !imageDataUrl) return null;
    const formatPrompt = [
        "Look at this image and reply with a JSON object only (no markdown, no code block), with exactly three keys:",
        "1. \"description\" — short description of what the image shows (layout, logos, charts, photos, etc.).",
        "2. \"textInImage\" — all text you can read in the image, BUT formatted with clear structure: use section titles (e.g. **Title** or Title:), line breaks, and label: value pairs so it is readable and not one blob. Preserve logical grouping (e.g. header, body, footer). If it looks like a form, invoice, or document, use titles for sections and keep fields on separate lines. If there is no text, use empty string.",
        "3. \"companyNameFromLogo\" — if this image is a company or brand logo, return ONLY the actual logo/brand name (the primary company or brand name). Do NOT include taglines, slogans, subtext, straplines, or any secondary text—only the main logo name. Single string; otherwise null.",
    ].join(" ");
    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "google/gemini-2.5-flash",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: formatPrompt,
                            },
                            {
                                type: "image_url",
                                image_url: { url: imageDataUrl },
                            },
                        ],
                    },
                ],
            },
            {
                headers: {
                    Authorization: `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json",
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            }
        );
        const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
        if (!raw) return null;
        const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const companyNameFromLogo = parsed.companyNameFromLogo;
        return {
            description: parsed.description ?? "",
            textInImage: parsed.textInImage ?? "",
            companyNameFromLogo: typeof companyNameFromLogo === "string" && companyNameFromLogo.trim() ? companyNameFromLogo.trim() : null,
        };
    } catch (err) {
        console.error("[describeImageWithAI]", err.message);
        return null;
    }
}

/**
 * Extract only text from an image (minimal prompt, faster than describeImageWithAI).
 * Returns { textInImage } or null. Use when you only need OCR text.
 */
async function getTextFromImageWithAI(imageDataUrl) {
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey || !imageDataUrl) return null;
    const prompt = 'Reply with a JSON object only (no markdown): { "textInImage": "all text you can read in this image, or empty string if none" }';
    try {
        const response = await axios.post(
            OPEN_ROUTER_URL,
            {
                model: "google/gemini-2.5-flash",
                messages: [
                    { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageDataUrl } }] },
                ],
            },
            {
                headers: {
                    Authorization: `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json",
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            }
        );
        const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
        if (!raw) return null;
        const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, "").trim();
        const parsed = JSON.parse(cleaned);
        return { textInImage: parsed.textInImage ?? "" };
    } catch (err) {
        console.error("[getTextFromImageWithAI]", err.message);
        return null;
    }
}

/** Downscale image dataUrl to smaller JPEG for faster upload/vision. */
async function downscaleImageForVision(dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return dataUrl;
    const base64 = match[2].replace(/\s/g, "");
    const buffer = Buffer.from(base64, "base64");
    const out = await sharp(buffer)
        .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: IMAGE_JPEG_QUALITY })
        .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/**
 * Run text through AI to extract possible company names. Uses OPEN_ROUTER.
 * Returns an array of company name strings, or [] if not configured / error.
 */
async function extractCompanyNames(text) {
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey || !text || String(text).trim().length === 0) return [];
    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "google/gemini-2.5-flash",
                messages: [
                    {
                        role: "user",
                        content: "From the following text (e.g. invoice, document, spreadsheet content), list every possible company name you can find (sender, recipient, vendor, client, business names, etc.). Reply with a JSON array of strings only, no other text. Example: [\"ACME Inc\", \"Widget Co\"]. If none found, reply: [].\n\nText:\n" + String(text).slice(0, 30000),
                    },
                ],
            },
            {
                headers: {
                    Authorization: `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json",
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            }
        );
        const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
        if (!raw) return [];
        const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, "").trim();
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x.trim()) : [];
    } catch (err) {
        console.error("[extractCompanyNames]", err.message);
        return [];
    }
}

/**
 * Resolve a logo-derived company name (often one word, e.g. TAKAOKAIP) to the full
 * name as it appears elsewhere in the document (e.g. "Takaoka IP Group"). Uses OPEN_ROUTER.
 * Returns the resolved name string, or the original logoName if not configured / no match.
 */
async function resolveLogoNameFromDocument(logoName, documentText) {
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey || !logoName || !documentText || String(documentText).trim().length === 0) {
        return logoName;
    }
    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "google/gemini-2.5-flash",
                messages: [
                    {
                        role: "user",
                        content:
                            "The logo on a document reads as this single word or combined form: \"" +
                            String(logoName).trim() +
                            "\". In the document text below, find the same company name as it appears in full (often with spaces, e.g. \"Takaoka IP Group\" for TAKAOKAIP). Return ONLY that full company name exactly as it appears in the text—no extra words like (USD) or addresses. If you find a matching name with spaces or different casing, return it. If no matching name appears in the text, return the original logo text.\n\nDocument text:\n" +
                            String(documentText).slice(0, 25000),
                    },
                ],
            },
            {
                headers: {
                    Authorization: `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json",
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            }
        );
        const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
        if (!raw) return logoName;
        const resolved = raw.replace(/^["']|["']$/g, "").trim();
        return resolved || logoName;
    } catch (err) {
        console.error("[resolveLogoNameFromDocument]", err.message);
        return logoName;
    }
}

/**
 * Ask AI to return exactly 3 company names from the document, each with a confidence score (0-1).
 * Optionally pass candidate names (e.g. from logo) to favor. Uses OPEN_ROUTER.
 * Returns [{ name, confidence }, ...] with up to 3 items.
 */
async function getTop3CompanyNamesWithConfidence(documentText, candidateNames = []) {
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey || !documentText || String(documentText).trim().length === 0) {
        return (candidateNames || []).slice(0, 3).map((name) => ({ name: String(name), confidence: 0 }));
    }
    const candidateHint =
        candidateNames?.length > 0
            ? " These candidate names (e.g. from a logo) should be preferred and ranked first if they appear in the document: " +
              JSON.stringify(candidateNames) +
              ".\n\n"
            : "";
    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "google/gemini-2.5-flash",
                messages: [
                    {
                        role: "user",
                        content:
                            "From the document text below, identify the top 3 most likely company names (sender, recipient, vendor, client, business names). " +
                            candidateHint +
                            "Reply with a JSON array of exactly 3 objects, each with keys \"name\" (string, company name as it appears in the document) and \"confidence\" (number 0 to 1). Order by confidence descending. Example: [{\"name\": \"Takaoka IP Group\", \"confidence\": 0.95}, {\"name\": \"INSPERANTO LTD\", \"confidence\": 0.88}, {\"name\": \"Other Co\", \"confidence\": 0.6}]. If fewer than 3 companies exist, use empty string for name and 0 for confidence for the rest.\n\nDocument text:\n" +
                            String(documentText).slice(0, 25000),
                    },
                ],
            },
            {
                headers: {
                    Authorization: `Bearer ${openRouterKey}`,
                    "Content-Type": "application/json",
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            }
        );
        const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
        if (!raw) return normalizeTo3WithConfidence(candidateNames);
        const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const list = Array.isArray(parsed)
            ? parsed
                  .filter((x) => x && typeof x === "object")
                  .map((x) => ({
                      name: typeof x.name === "string" ? x.name.trim() : "",
                      confidence: typeof x.confidence === "number" ? Math.max(0, Math.min(1, x.confidence)) : 0,
                  }))
            : [];
        return normalizeTo3WithConfidence(candidateNames, list);
    } catch (err) {
        console.error("[getTop3CompanyNamesWithConfidence]", err.message);
        return normalizeTo3WithConfidence(candidateNames);
    }
}

function normalizeTo3WithConfidence(candidateNames = [], aiList = []) {
    const result = [];
    const seen = new Set();
    for (const item of aiList) {
        if (result.length >= 3) break;
        const name = (item && item.name) ? String(item.name).trim() : "";
        const confidence = (item && typeof item.confidence === "number") ? Math.max(0, Math.min(1, item.confidence)) : 0;
        if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            result.push({ name, confidence });
        }
    }
    const fallback = (candidateNames || []).filter((n) => n && !seen.has(String(n).toLowerCase()));
    for (const name of fallback) {
        if (result.length >= 3) break;
        result.push({ name: String(name).trim(), confidence: 0.5 });
    }
    while (result.length < 3) {
        result.push({ name: "", confidence: 0 });
    }
    return result.slice(0, 3);
}

const PARSE_FILE_LOG = "[parseFile]";

/**
 * Parse a single file buffer: PDF or Excel.
 * Returns { type: 'pdf'|'excel', data, raw } and for PDF also { text, images }.
 */
async function parseFile(fileBuffer, fileName) {
    const fileSize = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0;
    const startMs = Date.now();
    console.log(PARSE_FILE_LOG, "parseFile CALL", { fileName: fileName || "(unnamed)", fileSize, fileType: "pending" });

    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType) {
        const elapsedMs = Date.now() - startMs;
        console.log(PARSE_FILE_LOG, "parseFile OUTCOME", { success: false, error: "Unable to determine file type", elapsedMs });
        throw new Error("Unable to determine file type");
    }
    console.log(PARSE_FILE_LOG, "parseFile DATA", { fileName: fileName || "(unnamed)", detectedType: fileType.ext, mime: fileType.mime });

    if (fileType.ext === "xlsx" || fileType.ext === "xls") {
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const allRecords = [];
        workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const records = XLSX.utils.sheet_to_json(sheet, {
                defval: null,
                raw: false,
                dateNF: "yyyy-mm-dd",
            });
            records.forEach((r) => {
                r.sheetName = sheetName;
                r._source = "excel";
            });
            allRecords.push(...records);
        });
        const rowCount = allRecords.length;
        const sampleKeys = rowCount > 0 ? Object.keys(allRecords[0] || {}) : [];
        const currencyLikeKeys = sampleKeys.filter((k) => /currency|curr|ccy|amount|total|£|€|\$/i.test(k));
        console.log(PARSE_FILE_LOG, "parseFile DATA excel", {
            sheetNames: workbook.SheetNames,
            rowCount,
            columnSample: sampleKeys.slice(0, 15),
            currencyLikeColumns: currencyLikeKeys,
        });
        const result = {
            type: "excel",
            data: allRecords,
            raw: JSON.stringify(allRecords, null, 2),
        };
        const elapsedMs = Date.now() - startMs;
        console.log(PARSE_FILE_LOG, "parseFile OUTCOME", {
            success: true,
            type: "excel",
            rowCount,
            rawLength: result.raw?.length ?? 0,
            elapsedMs,
        });
        return result;
    }

    if (fileType.ext === "pdf") {
        const parser = new PDFParse({ data: fileBuffer });

        try {
            const textResult = await parser.getText();
            const extractedText = (textResult?.text || "").trim();
            let finalText = extractedText;
            if (extractedText.length < 50) {
                finalText = await extractTextFromImagePDF(fileBuffer, fileName);
            }

            let imageResult = { pages: [] };
            try {
                imageResult = await parser.getImage({ imageThreshold: 0, imageDataUrl: true, imageBuffer: false });
            } catch (_) {}

            const images = [];
            if (imageResult?.pages) {
                imageResult.pages.forEach((page, pageIndex) => {
                    (page.images || []).forEach((img, imgIndex) => {
                        const dataUrl = img.dataUrl ?? img.dataURL ?? (img.data ? `data:image/png;base64,${(Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data)).toString("base64")}` : null);
                        images.push({
                            page: pageIndex + 1,
                            index: imgIndex,
                            dataUrl,
                            width: img.width,
                            height: img.height,
                        });
                    });
                });
            }

            let logoCompanyNames = [];
            if (images.length > 0) {
                const aiResults = process.env.OPEN_ROUTER
                    ? await Promise.all(images.map((img) => describeImageWithAI(img.dataUrl)))
                    : images.map(() => null);
                aiResults.forEach((result, i) => {
                    images[i].dataUrl = null;
                    images[i].description = result?.description ?? null;
                    images[i].textInImage = result?.textInImage ?? null;
                    images[i].companyNameFromLogo = result?.companyNameFromLogo ?? null;
                    if (result?.companyNameFromLogo && !logoCompanyNames.includes(result.companyNameFromLogo)) {
                        logoCompanyNames.push(result.companyNameFromLogo);
                    }
                });
            }

            const elapsedMs = Date.now() - startMs;
            const result = {
                type: "pdf",
                data: finalText,
                raw: finalText,
                text: finalText,
                images,
                logoCompanyNames,
            };
            console.log(PARSE_FILE_LOG, "parseFile DATA pdf", {
                textLength: finalText.length,
                imageCount: images.length,
                logoCompanyNames: logoCompanyNames.length ? logoCompanyNames : undefined,
                elapsedMs,
            });
            console.log(PARSE_FILE_LOG, "parseFile OUTCOME", {
                success: true,
                type: "pdf",
                textLength: finalText.length,
                imageCount: images.length,
                elapsedMs,
            });
            return result;
        } finally {
            if (parser.destroy) await parser.destroy();
        }
    }

    const elapsedMsUnsupported = Date.now() - startMs;
    console.log(PARSE_FILE_LOG, "parseFile OUTCOME", { success: false, error: `Unsupported file type: ${fileType.ext}`, elapsedMs: elapsedMsUnsupported });
    throw new Error(`Unsupported file type: ${fileType.ext}. Only PDF and Excel are supported.`);
}

/**
 * Pass the file directly to the AI (no parsing). Asks for top 3 company names with confidence.
 * PDF: send file to AI. Excel: parse to text first (OpenRouter file API does not accept xlsx), then send text.
 * Returns { companyNames } as [{ name, confidence }, ...]. Use parseFile separately when you need result for invoice extraction.
 */
async function getCompaniesFromFile(fileBuffer, fileName) {
    const fileSize = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0;
    const startMs = Date.now();
    console.log(PARSE_FILE_LOG, "getCompaniesFromFile CALL", { fileName: fileName || "(unnamed)", fileSize });

    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey) {
        console.log(PARSE_FILE_LOG, "getCompaniesFromFile OUTCOME", { success: false, error: "OPEN_ROUTER not configured" });
        throw new Error("OPEN_ROUTER not configured; cannot get company names from file.");
    }
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType) {
        console.log(PARSE_FILE_LOG, "getCompaniesFromFile OUTCOME", { success: false, error: "Unable to determine file type" });
        throw new Error("Unable to determine file type");
    }

    const fileTitleHint = fileName
        ? `File name: "${String(fileName).slice(0, 180)}" use the file name as an additional context when identifying company names. `
        : "";
    const prompt =
        fileTitleHint +
        "From this document (invoice, statement, or spreadsheet), identify the top 3 most likely company names (sender, recipient, vendor, client, business names). " +
        "Reply with a JSON array of exactly 3 objects, each with keys \"name\" (string) and \"confidence\" (number 0 to 1). Order by confidence descending. " +
        "Example: [{\"name\": \"ACME Inc\", \"confidence\": 0.95}, {\"name\": \"Client Co\", \"confidence\": 0.8}, {\"name\": \"\", \"confidence\": 0}]. If fewer than 3, use empty string and 0 for the rest.";

    let requestBody;
    if (fileType.ext === "xlsx" || fileType.ext === "xls") {
        // OpenRouter file API returns 400 for Excel; parse to text and send as message content
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const parts = [];
        workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const records = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, dateNF: "yyyy-mm-dd" });
            parts.push(`Sheet: ${sheetName}\n` + JSON.stringify(records.slice(0, 100), null, 2));
        });
        const documentText = parts.join("\n\n").slice(0, 30000);
        requestBody = {
            model: "google/gemini-2.5-flash",
            messages: [
                {
                    role: "user",
                    content: prompt + "\n\nDocument content (spreadsheet data):\n" + documentText,
                },
            ],
        };
    } else {
        // PDF: break up into text + array of images, then send those to the AI
        const parser = new PDFParse({ data: fileBuffer });
        let extractedText = "";
        let firstPageText = "";
        const images = [];
        try {
            const textResult = await parser.getText();
            extractedText = (textResult?.text || "").trim();
            firstPageText = (textResult?.pages?.[0]?.text || "").trim() || extractedText.slice(0, 4000);
            let imageResult = { pages: [] };
            try {
                imageResult = await parser.getImage({ imageThreshold: 0, imageDataUrl: true, imageBuffer: false });
            } catch (_) {}
            if (imageResult?.pages) {
                imageResult.pages.forEach((page, pageIndex) => {
                    (page.images || []).forEach((img, imgIndex) => {
                        const dataUrl = img.dataUrl ?? img.dataURL ?? (img.data ? `data:image/png;base64,${(Buffer.isBuffer(img.data) ? img.data : Buffer.from(img.data)).toString("base64")}` : null);
                        if (dataUrl) images.push({ page: pageIndex + 1, index: imgIndex, dataUrl });
                    });
                });
            }
        } finally {
            if (parser.destroy) await parser.destroy();
        }

        const hasText = extractedText.length > 0;
        const hasImages = images.length > 0;
        if (hasText || hasImages) {
            const blockStartMs = Date.now();
            if (hasImages) {
                const downscaled = await Promise.all(images.map((img) => downscaleImageForVision(img.dataUrl)));
                const results = await Promise.all(downscaled.map((dataUrl) => getTextFromImageWithAI(dataUrl)));
                results.forEach((result, i) => {
                    images[i].textOnImage = result?.textInImage ?? "";
                });
                const textExtracted = images.map((img) => img.textOnImage || "").filter(Boolean);
            }
            const imageTexts = images.map((img) => img.textOnImage || "").filter(Boolean);
            const labeledImageTexts = images.map((img, i) => `Image ${i + 1}:\n${(img.textOnImage || "").trim()}`).filter((s) => s.length > "Image 1:\n".length);
            const pdfFirstPageSection = firstPageText ? `PDF (first page):\n${firstPageText}` : "";
            const combinedText = [...labeledImageTexts, pdfFirstPageSection].filter(Boolean).join("\n\n");
            const content = [
                { type: "text", text: prompt + (combinedText ? "\n\nDocument text:\n" + combinedText : "") },
                ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
            ].filter((part) => part.type !== "image_url" || part.image_url?.url);
            requestBody = {
                model: "google/gemini-2.5-flash",
                messages: [{ role: "user", content }],
            };
        } else {
            // Fallback: send whole PDF (e.g. image-only PDF)
            const mime = fileType.mime ?? "application/pdf";
            const fileDataUrl = `data:${mime};base64,${fileBuffer.toString("base64")}`;
            requestBody = {
                model: "google/gemini-2.5-flash",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "file", file: { filename: fileName || "document", file_data: fileDataUrl } },
                        ],
                    },
                ],
                plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }],
            };
            console.log(PARSE_FILE_LOG, "getCompaniesFromFile DATA pdf fallback full file");
        }
    }
    
    const response = await openRouterPost(requestBody, openRouterKey);
    const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
    const elapsedMs = Date.now() - startMs;
    if (!raw) {
        console.log(PARSE_FILE_LOG, "getCompaniesFromFile OUTCOME⏱❤️", { success: false, elapsedMs });
        return { companyNames: [{ name: "", confidence: 0 }, { name: "", confidence: 0 }, { name: "", confidence: 0 }] };
    }
    const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, "").trim();
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\[[\s\S]*\]/);
        parsed = match ? JSON.parse(match[0]) : [];
    }
    const fileNameCompact = String(fileName || "")
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[^a-z0-9]+/g, "");
    const normalizeNameForFileMatch = (value) => String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
    const filenameMatchBoost = (companyName) => {
        const normalized = normalizeNameForFileMatch(companyName);
        if (!fileNameCompact || normalized.length < 3) return 0;
        if (fileNameCompact.includes(normalized)) return 0.2;
        if (normalized.includes(fileNameCompact) && fileNameCompact.length >= 4) return 0.12;
        return 0;
    };

    const list = Array.isArray(parsed)
        ? parsed
              .filter((x) => x && typeof x === "object")
              .map((x) => ({
                  name: typeof x.name === "string" ? x.name.trim() : "",
                  confidence: typeof x.confidence === "number" ? Math.max(0, Math.min(1, x.confidence)) : 0,
              }))
        : [];
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
    // Ensure no two items have the same confidence (weight)
    const used = new Set();
    const nextUniqueConfidence = (c) => {
        let val = Math.round(Math.max(0, Math.min(1, c)) * 1000) / 1000;
        while (used.has(val)) {
            val = val <= 0 ? Math.min(0.001 * used.size, 0.99) : Math.max(0, Math.round((val - 0.001) * 1000) / 1000);
        }
        used.add(val);
        return val;
    };
    const companyNames = rerankedList.slice(0, 3).map((entry) => ({
        name: entry.name,
        confidence: nextUniqueConfidence(entry.adjustedConfidence),
    }));
    console.log(PARSE_FILE_LOG, "getCompaniesFromFile DATA", { fileName: fileName || "(unnamed)", companyNames, elapsedMs });
    console.log(PARSE_FILE_LOG, "getCompaniesFromFile OUTCOME ⏱❤️", { success: true, companyNames, elapsedMs });
    return { companyNames };
}

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

/**
 * Use AI vision to extract all invoices from the file: amount, potential invoice numbers/IDs, currency, date due, statement date.
 * PDF: send file to AI. Excel: parse to text and send. Returns { fileDate, invoices } compatible with existing flow.
 */
async function getInvoicesFromFileWithAIVision(fileBuffer, fileName) {
    const fileSize = Buffer.isBuffer(fileBuffer) ? fileBuffer.length : 0;
    const startMs = Date.now();
    console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision CALL", { fileName: fileName || "(unnamed)", fileSize });

    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey) {
        console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, error: "OPEN_ROUTER not configured" });
        throw new Error("OPEN_ROUTER not configured; cannot extract invoices from file.");
    }
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType) {
        console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, error: "Unable to determine file type" });
        throw new Error("Unable to determine file type");
    }
    console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision DATA", { fileName: fileName || "(unnamed)", detectedType: fileType.ext });

    let requestBody;
    let invoicePdfStartMs = null;
    if (fileType.ext === "xlsx" || fileType.ext === "xls") {
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const parts = [];
        workbook.SheetNames.forEach((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            const records = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, dateNF: "yyyy-mm-dd" });
            parts.push(`Sheet: ${sheetName}\n` + JSON.stringify(records.slice(0, 150), null, 2));
        });
        const documentText = parts.join("\n\n").slice(0, 35000);
        requestBody = {
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: INVOICES_AI_PROMPT + "\n\nDocument content:\n" + documentText }],
        };
    } else {
        invoicePdfStartMs = Date.now();
        console.log(PARSE_FILE_LOG, "⏱️ getInvoicesFromFileWithAIVision PDF start", { fileName: fileName || "(unnamed)" });
        const mime = fileType.mime ?? "application/pdf";
        const fileDataUrl = `data:${mime};base64,${fileBuffer.toString("base64")}`;
        requestBody = {
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

    const response = await openRouterPost(requestBody, openRouterKey);
    if (invoicePdfStartMs != null) {
        const invoicePdfElapsedSec = ((Date.now() - invoicePdfStartMs) / 1000).toFixed(2);
        console.log(PARSE_FILE_LOG, "✅ getInvoicesFromFileWithAIVision PDF done",{ elapsedSec: invoicePdfElapsedSec + "s" });
    }

    const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
    const elapsedMs = Date.now() - startMs;
    console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision DATA rawResponse", {
        fileName: fileName || "(unnamed)",
        rawLength: raw?.length ?? 0,
        rawPreview: raw ? raw.substring(0, 500) + (raw.length > 500 ? "..." : "") : "",
        elapsedMs,
    });
    if (!raw) {
        console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, fileDate: null, invoiceCount: 0, reason: "empty AI response", elapsedMs });
        return { fileDate: null, invoices: [] };
    }
    const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, "").trim();
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!objMatch) {
        console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, fileDate: null, invoiceCount: 0, reason: "no JSON object in response" });
        return { fileDate: null, invoices: [] };
    }
    let obj;
    try {
        obj = JSON.parse(objMatch[0]);
    } catch (e) {
        console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision OUTCOME", { success: false, fileDate: null, invoiceCount: 0, reason: "JSON parse error", error: e.message });
        return { fileDate: null, invoices: [] };
    }
    const fileDate = obj.fileDate ?? null;
    let invoices = Array.isArray(obj.invoices) ? obj.invoices : [];
    invoices = invoices.map((inv) => {
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
    });
    // If an invoice has only one date (invoiceDate present, dateDue missing),
    // treat that single date as the due date by moving it to dateDue and clearing invoiceDate.
    for (const inv of invoices) {
        if ((inv.dateDue == null || inv.dateDue === "") && inv.invoiceDate) {
            inv.dateDue = inv.invoiceDate;
            inv.invoiceDate = null;
        }
    }
    
    const currenciesInFile = [...new Set(invoices.map((inv) => inv.currency).filter(Boolean))];
    console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision DATA parsedInvoices", {
        fileName: fileName || "(unnamed)",
        fileDate,
        invoiceCount: invoices.length,
        currencyOfFile: currenciesInFile,
        invoices: invoices.map((inv) => ({
            invoiceNumber: inv.invoiceNumber,
            amount: inv.amount,
            currency: inv.currency,
            dateDue: inv.dateDue,
            invoiceDate: inv.invoiceDate,
            paymentStatus: inv.paymentStatus,
        })),
    });
    console.log(PARSE_FILE_LOG, "getInvoicesFromFileWithAIVision OUTCOME", {
        success: true,
        fileDate,
        invoiceCount: invoices.length,
        currencyOfFile: currenciesInFile,
    });
    return { fileDate, invoices };
}

module.exports = {
    extractTextFromImagePDF,
    describeImageWithAI,
    extractCompanyNames,
    resolveLogoNameFromDocument,
    getTop3CompanyNamesWithConfidence,
    parseFile,
    getCompaniesFromFile,
    getInvoicesFromFileWithAIVision,
};
