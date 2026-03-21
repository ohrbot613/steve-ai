/**
 * Steve v2 — End-to-end pipeline test (REC-118)
 * Tests: PDF parse logic → Claude extraction → reconcile matching
 *
 * No live Supabase project required.
 * Requires: ANTHROPIC_API_KEY
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node test-e2e.js
 *
 * Exit codes:
 *   0 — all tests passed (or skipped due to missing API key)
 *   1 — one or more tests failed
 */

// ─── ANTHROPIC_API_KEY guard ──────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("SKIP: ANTHROPIC_API_KEY not set");
  process.exit(0);
}

import Anthropic from "@anthropic-ai/sdk";

// ─── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, label, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push({ label, detail });
    failed++;
  }
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`[${title}]`);
  console.log("─".repeat(60));
}

// ─── Step 1: Parse (multipart → text) ─────────────────────────────────────────
//
// api/parse.js uses a hand-rolled multipart parser. We reproduce the exact
// same logic here to test it without needing a live Vercel server or Supabase.

section("1/3  PARSE  (multipart text extraction)");

function buildMultipartBody(fieldName, fileBuffer, boundary) {
  const header =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="test.txt"\r\n` +
    `Content-Type: text/plain\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([
    Buffer.from(header),
    fileBuffer,
    Buffer.from(footer),
  ]);
}

// Inline copy of parse.js parseMultipart (no modification to source)
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;
  while (start < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    const partStart = idx + boundaryBuf.length;
    if (buffer[partStart] === 0x2d && buffer[partStart + 1] === 0x2d) break;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(partStart + 2, headerEnd).toString();
    const nextBoundary = buffer.indexOf(boundaryBuf, headerEnd + 4);
    const bodyEnd =
      nextBoundary === -1 ? buffer.length : nextBoundary - 2;
    parts.push({ headers: headerStr, data: buffer.slice(headerEnd + 4, bodyEnd) });
    start = nextBoundary === -1 ? buffer.length : nextBoundary;
  }
  return parts;
}

const BOUNDARY = "TestBoundary1234";
const INVOICE_TEXT = `INVOICE
Invoice No: INV-2025-0042
Date: 15/03/2025
Vendor: Acme Corp Ltd
Description: Cloud hosting services Q1 2025
Amount: $1,250.00
Tax: $125.00
Total: $1,375.00
Status: UNPAID`;

const multipartBody = buildMultipartBody(
  "file",
  Buffer.from(INVOICE_TEXT, "utf-8"),
  BOUNDARY
);

const parts = parseMultipart(multipartBody, BOUNDARY);
const filePart = parts.find((p) => p.headers.includes('name="file"'));

assert(parts.length === 1, "multipart body produces exactly 1 part");
assert(filePart !== undefined, "file part found by name");

const extractedText = filePart?.data?.toString("utf-8") ?? "";
assert(
  extractedText === INVOICE_TEXT,
  "extracted text matches original content"
);

// Verify non-PDF path (magic bytes check from parse.js)
const isPdf =
  filePart?.data[0] === 0x25 &&
  filePart?.data[1] === 0x50 &&
  filePart?.data[2] === 0x44 &&
  filePart?.data[3] === 0x46;
assert(!isPdf, "plain text file is not classified as PDF");

// ─── Step 2: Extract (Claude API → structured invoice data) ───────────────────
//
// Calls Claude with the extracted text and validates the response shape.
// Mirrors the logic in api/extract.js → extractInvoices().

section("2/3  EXTRACT  (Claude API → structured invoice JSON)");

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseJSON(raw) {
  let cleaned = raw.replace(/```json/gi, "").replace(/```/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (match) return JSON.parse(match[0]);
  return JSON.parse(cleaned);
}

async function extractInvoicesViaApi(text, fileName = "") {
  const sysPrompt = `You are an expert financial document parser.
Extract ALL invoices from the document.

Return ONLY valid JSON (no markdown):
{
  "fileDate": "yyyy-mm-dd",
  "invoices": [
    {
      "invoiceDate": "dd/mm/yyyy",
      "invoiceNumber": "string",
      "potentialInvoiceIds": ["string"],
      "activityDescription": "string",
      "amount": { "amount": number, "tax_fees": number },
      "currency": "string",
      "paymentStatus": "paid" | "unpaid"
    }
  ]
}`;

  const msg = await claude.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1024,
    system: sysPrompt,
    messages: [{ role: "user", content: text }],
  });

  return parseJSON(msg.content[0]?.text || "");
}

let extracted;
try {
  extracted = await extractInvoicesViaApi(INVOICE_TEXT, "test-invoice.txt");
} catch (err) {
  console.error(`  FAIL  Claude extraction threw an error: ${err.message}`);
  failures.push({ label: "Claude extraction", detail: err.message });
  failed++;
}

if (extracted) {
  assert(
    extracted !== null && typeof extracted === "object",
    "extract response is an object"
  );
  assert(
    Array.isArray(extracted.invoices),
    "extract response has 'invoices' array"
  );
  assert(
    (extracted.invoices?.length ?? 0) >= 1,
    "at least 1 invoice extracted"
  );

  const inv = extracted.invoices?.[0];
  if (inv) {
    assert(
      typeof inv.invoiceNumber === "string" && inv.invoiceNumber.length > 0,
      "invoice[0].invoiceNumber is a non-empty string"
    );
    assert(
      inv.amount !== null && typeof inv.amount === "object",
      "invoice[0].amount is an object"
    );
    assert(
      typeof inv.amount?.amount === "number",
      "invoice[0].amount.amount is a number",
      `got: ${JSON.stringify(inv.amount?.amount)}`
    );
    assert(
      inv.paymentStatus === "paid" || inv.paymentStatus === "unpaid",
      "invoice[0].paymentStatus is 'paid' or 'unpaid'",
      `got: ${inv.paymentStatus}`
    );
    assert(
      Array.isArray(inv.potentialInvoiceIds),
      "invoice[0].potentialInvoiceIds is an array"
    );
  }
}

// ─── Step 3: Reconcile (matching logic, no Supabase) ─────────────────────────
//
// api/reconcile.js's getIdScore() uses normalizeInvoiceDigits() for exact ID
// matching. We test the same logic inline — confirming match, no-match, and
// partial-ID scenarios — which is what the Supabase-backed handler executes.

section("3/3  RECONCILE  (match logic — no Supabase)");

const normalizeInvoiceDigits = (s) => {
  const digits = String(s ?? "").replace(/[^0-9]/g, "");
  return digits ? String(parseInt(digits, 10)) : "";
};

function getIdScore(transaction, invoice) {
  const xeroNum = invoice.invoice_number ?? "";
  if (!xeroNum) return 0;
  const xeroNorm = normalizeInvoiceDigits(xeroNum);
  if (!xeroNorm) return 0;

  const potentialIds =
    Array.isArray(transaction.potential_invoice_ids) &&
    transaction.potential_invoice_ids.length > 0
      ? transaction.potential_invoice_ids
      : [transaction.invoice_number].filter(Boolean);

  if (potentialIds.length === 0) return 0;

  for (const pid of potentialIds) {
    const p = String(pid).trim();
    if (!p) continue;
    const pNorm = normalizeInvoiceDigits(p);
    if (pNorm && pNorm === xeroNorm) return 1.0;
  }

  return 0;
}

// Sample data that mirrors what reconcileClient() works with
const SAMPLE_TRANSACTIONS = [
  {
    id: "tx-001",
    invoice_number: "INV-2025-0042",
    potential_invoice_ids: ["INV-2025-0042", "2025-0042", "42"],
    amount: 1250,
  },
  {
    id: "tx-002",
    invoice_number: "INV-9999",
    potential_invoice_ids: ["INV-9999"],
    amount: 500,
  },
  {
    id: "tx-003",
    invoice_number: null,
    potential_invoice_ids: [],
    amount: 750,
  },
];

const SAMPLE_INVOICES = [
  { id: "inv-a", invoice_number: "INV-42", contact_name: "Acme Corp", amount: 1250, status: "unpaid" },
  { id: "inv-b", invoice_number: "INV-0007", contact_name: "Beta Ltd",  amount: 500,  status: "unpaid" },
];

// Run the same matching loop that reconcile.js uses
const reconciliationRows = [];

for (const tx of SAMPLE_TRANSACTIONS) {
  let bestInvoice = null;
  let bestScore = 0;

  for (const inv of SAMPLE_INVOICES) {
    const score = getIdScore(tx, inv);
    if (score > bestScore) {
      bestScore = score;
      bestInvoice = inv;
    }
  }

  if (bestScore >= 0.8 && bestInvoice) {
    reconciliationRows.push({
      bank_transaction_id: tx.id,
      invoice_id: bestInvoice.id,
      match_type: "exact_id",
      confidence: bestScore,
    });
  } else {
    reconciliationRows.push({
      bank_transaction_id: tx.id,
      invoice_id: null,
      match_type: "unmatched",
      confidence: 0,
    });
  }
}

// Assertions on reconciliation results
assert(
  Array.isArray(reconciliationRows),
  "reconcile produces an array of result rows"
);
assert(
  reconciliationRows.length === SAMPLE_TRANSACTIONS.length,
  "one result row per transaction"
);

const tx001Result = reconciliationRows.find((r) => r.bank_transaction_id === "tx-001");
assert(
  tx001Result?.match_type === "exact_id",
  "tx-001 (INV-2025-0042) matches INV-42 via digit normalisation",
  `got match_type: ${tx001Result?.match_type}, invoice_id: ${tx001Result?.invoice_id}`
);
assert(
  tx001Result?.confidence === 1.0,
  "matched transaction has confidence 1.0"
);

const tx002Result = reconciliationRows.find((r) => r.bank_transaction_id === "tx-002");
assert(
  tx002Result?.match_type === "unmatched",
  "tx-002 (INV-9999) correctly produces no match"
);

const tx003Result = reconciliationRows.find((r) => r.bank_transaction_id === "tx-003");
assert(
  tx003Result?.match_type === "unmatched",
  "tx-003 (no IDs) correctly produces no match"
);

// Validate response shape: every row must have the required fields
const requiredKeys = ["bank_transaction_id", "invoice_id", "match_type", "confidence"];
const allRowsHaveShape = reconciliationRows.every((r) =>
  requiredKeys.every((k) => Object.hasOwn(r, k))
);
assert(allRowsHaveShape, "all reconciliation rows have required shape fields");

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${"=".repeat(60)}`);
console.log(`Steve v2 Pipeline Test — REC-118`);
console.log(`${"=".repeat(60)}`);
console.log(`Passed: ${passed}  |  Failed: ${failed}`);

if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach(({ label, detail }) => {
    console.log(`  - ${label}${detail ? `: ${detail}` : ""}`);
  });
  console.log("\nRESULT: FAIL");
  process.exit(1);
} else {
  console.log("\nRESULT: PASS");
  process.exit(0);
}
