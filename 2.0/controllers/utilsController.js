const { fileTypeFromBuffer } = require("file-type");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");
const axios = require("axios");

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

/**
 * Parse a single file buffer: PDF or Excel.
 * Returns { type: 'pdf'|'excel', data, raw } and for PDF also { text, images }.
 */
async function parseFile(fileBuffer, fileName) {
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType) {
        throw new Error("Unable to determine file type");
    }

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
        return {
            type: "excel",
            data: allRecords,
            raw: JSON.stringify(allRecords, null, 2),
        };
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

            return {
                type: "pdf",
                data: finalText,
                raw: finalText,
                text: finalText,
                images,
                logoCompanyNames,
            };
        } finally {
            if (parser.destroy) await parser.destroy();
        }
    }

    throw new Error(`Unsupported file type: ${fileType.ext}. Only PDF and Excel are supported.`);
}

/**
 * Pass the file directly to the AI (no parsing). Asks for top 3 company names with confidence.
 * PDF: send file to AI. Excel: parse to text first (OpenRouter file API does not accept xlsx), then send text.
 * Returns { companyNames } as [{ name, confidence }, ...]. Use parseFile separately when you need result for invoice extraction.
 */
async function getCompaniesFromFile(fileBuffer, fileName) {
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey) {
        throw new Error("OPEN_ROUTER not configured; cannot get company names from file.");
    }
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType) throw new Error("Unable to determine file type");

    const prompt =
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
        // PDF: send file to AI
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
    }

    const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", requestBody, {
        headers: {
            Authorization: `Bearer ${openRouterKey}`,
            "Content-Type": "application/json",
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
    if (!raw) {
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
    const list = Array.isArray(parsed)
        ? parsed
              .filter((x) => x && typeof x === "object")
              .map((x) => ({
                  name: typeof x.name === "string" ? x.name.trim() : "",
                  confidence: typeof x.confidence === "number" ? Math.max(0, Math.min(1, x.confidence)) : 0,
              }))
              .slice(0, 3)
        : [];
    while (list.length < 3) list.push({ name: "", confidence: 0 });
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
    const companyNames = list.slice(0, 3).map((entry) => ({
        name: entry.name,
        confidence: nextUniqueConfidence(entry.confidence),
    }));
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
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey) {
        throw new Error("OPEN_ROUTER not configured; cannot extract invoices from file.");
    }
    const fileType = await fileTypeFromBuffer(fileBuffer);
    if (!fileType) throw new Error("Unable to determine file type");

    let requestBody;
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

    const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", requestBody, {
        headers: {
            Authorization: `Bearer ${openRouterKey}`,
            "Content-Type": "application/json",
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    const raw = response.data?.choices?.[0]?.message?.content?.trim() || "";
    if (!raw) {
        return { fileDate: null, invoices: [] };
    }
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
