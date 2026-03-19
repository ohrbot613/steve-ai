// api/extract.js — Vercel Serverless Function
// Ported from formatting.js (prompts preserved verbatim)
// Changes: Gemini → Claude API, returns structured data for Supabase insert

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Claude helpers
// ─────────────────────────────────────────────────────────────────────────────

async function claudeCall(content, systemPrompt) {
  const msg = await claude.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: content || "Extract from the document above." }],
  });
  return msg.content[0]?.text || "";
}

function parseJSON(raw) {
  let cleaned = raw.replace(/```json/gi, "").replace(/```/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (match) return JSON.parse(match[0]);
  return JSON.parse(cleaned);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Count invoices in document (ported verbatim from formatting.js)
// ─────────────────────────────────────────────────────────────────────────────

async function checkMultipleInvoiceNumbers(text, fileName = "") {
  const sysPrompt = `You are an expert financial document analyzer. Your task is to determine if a document contains ONE invoice or MULTIPLE invoices.

TASK:
Analyze the provided document content and determine:
1. Does this document contain a SINGLE invoice (one invoice number)?
2. Or does it contain MULTIPLE invoices/transactions (multiple invoice numbers)?

FILE CONTEXT:
- File name: ${fileName || "Not provided"}
- This may be a single invoice, a statement of account, an invoice list, or a transaction summary

ANALYSIS GUIDELINES:

SINGLE INVOICE INDICATORS:
- Document has ONE invoice number in the header/title (e.g., "Invoice No. AAA-S-16129")
- Document is structured as a single invoice with one set of line items
- No table or list of multiple transactions
- Single total amount, single invoice date
- Document title contains "Invoice" (singular)

MULTIPLE INVOICES INDICATORS:
- Document is a "Statement of Account" or "Account Statement"
- Contains a TABLE with multiple rows, each row representing a different invoice/transaction
- Multiple invoice numbers visible (e.g., in different rows or entries)
- Multiple transaction dates
- Document title contains "Statement", "Summary", "List", or similar plural terms
- Multiple line items with different invoice/reference numbers

OUTPUT REQUIREMENTS:
Return ONLY valid JSON in this exact format:
{
  "hasMultipleInvoices": true | false,
  "invoiceCount": number | null,
  "reason": "brief explanation"
}`;

  try {
    const raw = await claudeCall(text, sysPrompt);
    return parseJSON(raw);
  } catch {
    return { hasMultipleInvoices: null, invoiceCount: null, reason: "Parse error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Extract all potential invoice IDs (ported verbatim)
// ─────────────────────────────────────────────────────────────────────────────

async function extractPotentialInvoiceIds(text, fileName = "") {
  const isJSON =
    typeof text === "string" &&
    (text.trim().startsWith("[") || text.trim().startsWith("{"));

  const sysPrompt = `You are an expert at extracting potential invoice/reference numbers from financial documents. Your task is to find EVERY possible identifier that could be an invoice ID.

CRITICAL TASK:
Extract ALL potential invoice/reference numbers from the document. Be thorough - it's better to include too many than to miss any.

FILE TYPE:
${isJSON ? "This appears to be an Excel/structured data file (JSON format). Look in ALL columns/fields." : "This appears to be a PDF/text document. Look in headers, tables, and throughout the document."}

WHAT TO LOOK FOR - CHECK ALL OF THESE:
1. COLUMN/FIELD NAMES: "Invoice No.", "Our Reference", "Your Reference", "Reference", "Transaction ID", "Doc Number", "Voucher No", "Bill Number", any column containing "ID", "Number", "No", "Ref", "Reference", "Invoice", "Doc", "Transaction"
2. COMMON PATTERNS: alphanumeric codes ("INV-12345"), numeric codes ("12345"), codes with prefixes, date-based codes
3. Extract EVERY unique value that could be an invoice ID

EXTRACTION RULES:
1. Preserve EXACTLY as shown: keep leading zeros, hyphens, letters, case
2. Remove duplicates
3. Include variations — if you see "INV-123" and "123", include BOTH
4. Don't filter out IDs that seem "wrong" — include everything that could be an invoice ID

WHAT TO EXCLUDE: Dates, amounts, phone numbers, email addresses, generic row numbers, page numbers

OUTPUT FORMAT:
Return ONLY valid JSON (no markdown):
{
  "potentialIds": ["ID1", "ID2", "ID3", ...]
}`;

  try {
    const raw = await claudeCall(text, sysPrompt);
    const parsed = parseJSON(raw);
    if (Array.isArray(parsed.potentialIds)) {
      parsed.potentialIds = parsed.potentialIds
        .filter((id) => id != null && String(id).trim().length > 0)
        .map((id) => String(id).trim())
        .filter((id, i, arr) => arr.indexOf(id) === i);
    } else {
      parsed.potentialIds = [];
    }
    return parsed;
  } catch {
    return { potentialIds: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Main extraction — build system prompt with context, call Claude
// Prompt preserved verbatim from formatting.js
// ─────────────────────────────────────────────────────────────────────────────

async function extractInvoices(
  text,
  fileName = "",
  previousError = null,
  invoiceCountInfo = null,
  preExtractedIds = null
) {
  let errorContext = "";
  if (previousError) {
    errorContext = `

PREVIOUS ATTEMPT FAILED:
${previousError}

IMPORTANT: The previous extraction had errors. Please fix the following issues:
- Review the error message above carefully
- Ensure each invoice has a UNIQUE invoice number
- If the file contains only ONE invoice, return an array with ONE invoice object
- If the file contains multiple invoices (like a statement), each must have a different invoice number
- Do NOT create multiple invoice objects with the same invoice number

`;
  }

  let invoiceCountContext = "";
  if (invoiceCountInfo) {
    if (invoiceCountInfo.hasMultipleInvoices === true) {
      invoiceCountContext = `

INVOICE COUNT ANALYSIS:
⚠️ CRITICAL: This document has been analyzed and contains MULTIPLE invoices/transactions.
- Expected invoice count: ${invoiceCountInfo.invoiceCount || "multiple (exact count unknown)"}
- Reason: ${invoiceCountInfo.reason || "Statement or table with multiple rows detected"}

EXTRACTION REQUIREMENTS FOR MULTIPLE INVOICES:
- You MUST extract EACH row/entry from the statement table as a SEPARATE invoice
- Each row MUST have its OWN unique invoice number
- Look for invoice numbers in columns like "Invoice No.", "Reference", "Our Reference", "Transaction ID", "Doc Number"
- If a row doesn't have an invoice number visible, look for it in adjacent columns or the row context
- DO NOT reuse the same invoice number for multiple rows
- If you see ${invoiceCountInfo.invoiceCount || "multiple"} rows in the table, extract ${invoiceCountInfo.invoiceCount || "all"} separate invoice objects
- Each invoice object should correspond to ONE row in the statement table

`;
    } else if (invoiceCountInfo.hasMultipleInvoices === false) {
      invoiceCountContext = `

INVOICE COUNT ANALYSIS:
✅ This document has been analyzed and contains a SINGLE invoice.
- Expected invoice count: 1
- Reason: ${invoiceCountInfo.reason || "Single invoice document detected"}

EXTRACTION REQUIREMENTS FOR SINGLE INVOICE:
- Extract the invoice number from the document header/title (e.g., "Invoice No. XXX")
- Return an array with EXACTLY ONE invoice object
- Do NOT create multiple invoice objects

`;
    }
  }

  const sysPrompt = `You are an expert financial document parser specializing in invoice and statement extraction. Your task is to accurately extract ALL invoice records from the provided document data.
${errorContext}${invoiceCountContext}
CRITICAL RULES:
1. Extract ONLY information that is explicitly visible in the document. Never guess, infer, or assume values.
2. If a field is missing or unclear, set it to null. Do NOT make up values.
3. You MUST extract EVERY invoice/transaction present in the document, even if some fields are incomplete.
4. Output MUST be valid JSON only - no markdown, no explanations, no code blocks.

FILE CONTEXT:
- File name: ${fileName || "Not provided"}
- This may be a statement of account, invoice list, or transaction summary
${
  preExtractedIds && preExtractedIds.length > 0
    ? `
⚠️ IMPORTANT - PRE-EXTRACTED INVOICE IDs FOUND:
The following potential invoice IDs were already identified in this document:
${JSON.stringify(preExtractedIds, null, 2)}

CRITICAL: You MUST include ALL of these IDs in the potentialInvoiceIds array for the relevant invoice(s).
- If this is a single invoice document, include ALL these IDs in that invoice's potentialInvoiceIds array
- If this is a statement with multiple invoices, distribute these IDs to the appropriate invoice rows
- These IDs are known to exist in the document, so make sure they are included in your extraction
`
    : ""
}

REQUIRED JSON STRUCTURE:
{
  "fileDate": "yyyy-mm-dd",
  "invoices": [
    {
      "invoiceDate": "dd/mm/yyyy",
      "invoiceNumber": "string",
      "potentialInvoiceIds": ["string", ...],
      "activityDescription": "string",
      "amount": {
        "amount": number,
        "tax_fees": number
      },
      "currency": "string",
      "paymentStatus": "paid" | "unpaid"
    }
  ]
}

FIELD EXTRACTION GUIDELINES:
- invoiceDate: Format as dd/mm/yyyy
- invoiceNumber: PRIMARY invoice number (most prominent)
- potentialInvoiceIds: ALL potential IDs from this invoice row — look in every column
- activityDescription: Description, Item, Details, Narrative, Memo fields
- amount.amount: Subtotal before tax (numeric, no symbols)
- amount.tax_fees: Tax/VAT/fees (default 0)
- currency: "$", "£", "€", etc.
- paymentStatus: "paid" or "unpaid"
- fileDate: Document date from header/footer

SPECIAL CASES:
- SINGLE INVOICE DOCUMENTS: Treat the entire document as ONE invoice
- STATEMENT DOCUMENTS: Each row/entry = ONE separate invoice object
- NEVER create multiple invoice objects with the same invoice number
- Credits/Refunds: Include with negative amounts

OUTPUT FORMAT:
Return ONLY valid JSON. No markdown, no explanations.`;

  const raw = await claudeCall(text, sysPrompt);
  return parseJSON(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// Full pipeline: text → Supabase bank_transactions
// ─────────────────────────────────────────────────────────────────────────────

async function extractAndStore(supabase, clientId, uploadId, text, fileName) {
  // Step 1: count check
  const countInfo = await checkMultipleInvoiceNumbers(text, fileName);

  // Step 2: pre-extract IDs
  const { potentialIds } = await extractPotentialInvoiceIds(text, fileName);

  // Step 3: main extraction (with retry on error)
  let extracted;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      extracted = await extractInvoices(
        text,
        fileName,
        lastError,
        countInfo,
        potentialIds
      );

      // Validate: check for duplicate invoice numbers
      const numbers = extracted.invoices.map((i) => i.invoiceNumber);
      const unique = new Set(numbers.filter(Boolean));
      if (unique.size < numbers.filter(Boolean).length) {
        lastError = "Duplicate invoice numbers detected in extraction.";
        continue;
      }
      break;
    } catch (err) {
      lastError = err.message;
    }
  }

  if (!extracted?.invoices?.length) {
    throw new Error(`Extraction failed: ${lastError || "no invoices returned"}`);
  }

  // Insert into bank_transactions
  const rows = extracted.invoices.map((inv) => ({
    client_id: clientId,
    upload_id: uploadId,
    invoice_number: inv.invoiceNumber || null,
    potential_invoice_ids: inv.potentialInvoiceIds || [],
    activity_description: inv.activityDescription || null,
    amount: inv.amount?.amount ?? null,
    tax_fees: inv.amount?.tax_fees ?? 0,
    currency: inv.currency || null,
    payment_status: inv.paymentStatus === "paid" ? "paid" : "unpaid",
    transaction_date: inv.invoiceDate
      ? parseDateDMY(inv.invoiceDate)
      : null,
    file_date: extracted.fileDate || null,
  }));

  const { data, error } = await supabase
    .from("bank_transactions")
    .insert(rows)
    .select("id");

  if (error) throw new Error(`DB insert failed: ${error.message}`);

  // Update upload status
  await supabase
    .from("uploads")
    .update({ status: "done", transactions_extracted: rows.length })
    .eq("id", uploadId);

  await supabase.from("audit_log").insert({
    client_id: clientId,
    category: "upload",
    action: "extraction_complete",
    details: { upload_id: uploadId, file_name: fileName, count: rows.length },
  });

  return { count: rows.length, transactionIds: data.map((r) => r.id) };
}

function parseDateDMY(str) {
  // "dd/mm/yyyy" → "yyyy-mm-dd"
  if (!str) return null;
  const [d, m, y] = str.split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel handler
// POST /api/extract
// Body: { uploadId, text, fileName }
// Auth: Bearer JWT from Supabase auth (client-issued)
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { uploadId, text, fileName } = req.body || {};
  if (!uploadId || !text) {
    return res.status(400).json({ error: "uploadId and text are required" });
  }

  // Authenticate via Supabase JWT
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Invalid token" });

  const clientId = user.id;

  // Verify the upload belongs to this client
  const { data: upload, error: uploadError } = await supabase
    .from("uploads")
    .select("id, status")
    .eq("id", uploadId)
    .eq("client_id", clientId)
    .single();

  if (uploadError || !upload) {
    return res.status(404).json({ error: "Upload not found" });
  }

  if (upload.status === "done") {
    return res.status(409).json({ error: "Upload already processed" });
  }

  // Mark as processing
  await supabase
    .from("uploads")
    .update({ status: "processing" })
    .eq("id", uploadId);

  try {
    const result = await extractAndStore(
      supabase,
      clientId,
      uploadId,
      text,
      fileName || "upload"
    );
    return res.json(result);
  } catch (err) {
    await supabase
      .from("uploads")
      .update({ status: "error", error_message: err.message })
      .eq("id", uploadId);

    return res.status(500).json({ error: err.message });
  }
}
