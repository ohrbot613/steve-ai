#!/usr/bin/env node
/**
 * Steve v2 — End-to-end pipeline test
 * Tests: PDF parse → Claude extraction → JSON shape validation
 *
 * No Supabase required. Needs only ANTHROPIC_API_KEY.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node test-pipeline.mjs [path/to/invoice.pdf]
 *
 * Defaults to the sample PDF: /Users/shual/Desktop/Steve/Code/30c2874b-f185-41e2-8904-f4807834137d.pdf
 */

import { readFileSync, existsSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

// ─── Config ──────────────────────────────────────────────────────────────────

// Use path relative to repo root so any developer can run this
const SAMPLE_PDF = new URL("../30c2874b-f185-41e2-8904-f4807834137d.pdf", import.meta.url).pathname;
const PDF_PATH = process.argv[2] || SAMPLE_PDF;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("❌  ANTHROPIC_API_KEY is not set.");
  process.exit(1);
}

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ─── Helpers (ported from api/extract.js) ────────────────────────────────────

async function claudeCall(content, systemPrompt) {
  const msg = await client.messages.create({
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

async function checkMultipleInvoiceNumbers(text, fileName = "") {
  const sysPrompt = `You are an expert financial document analyzer. Your task is to determine if a document contains ONE invoice or MULTIPLE invoices.

Return ONLY valid JSON:
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

async function extractPotentialInvoiceIds(text, fileName = "") {
  const sysPrompt = `You are an expert at extracting potential invoice/reference numbers from financial documents.

Return ONLY valid JSON:
{
  "potentialIds": ["ID1", "ID2", ...]
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

async function extractInvoices(text, fileName = "", countInfo = null, potentialIds = null) {
  const invoiceCountContext = countInfo
    ? `\nINVOICE COUNT: ${countInfo.hasMultipleInvoices ? "MULTIPLE" : "SINGLE"} — ${countInfo.reason}\n`
    : "";

  const idsContext =
    potentialIds && potentialIds.length > 0
      ? `\nPRE-EXTRACTED IDs: ${JSON.stringify(potentialIds)}\n`
      : "";

  const sysPrompt = `You are an expert financial document parser. Extract ALL invoices from the document.
${invoiceCountContext}${idsContext}
Return ONLY valid JSON:
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

  const raw = await claudeCall(text, sysPrompt);
  return parseJSON(raw);
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateExtraction(result) {
  const errors = [];
  if (!result || typeof result !== "object") {
    return ["Result is not an object"];
  }
  if (!Array.isArray(result.invoices)) {
    errors.push("Missing 'invoices' array");
    return errors;
  }
  if (result.invoices.length === 0) {
    errors.push("Empty 'invoices' array — no invoices extracted");
    return errors;
  }

  const seenNumbers = new Set();
  result.invoices.forEach((inv, i) => {
    const prefix = `invoices[${i}]`;
    if (!inv.invoiceNumber) errors.push(`${prefix}.invoiceNumber is missing`);
    else if (seenNumbers.has(inv.invoiceNumber)) {
      errors.push(`${prefix}.invoiceNumber "${inv.invoiceNumber}" is a duplicate`);
    } else {
      seenNumbers.add(inv.invoiceNumber);
    }
    if (inv.amount == null || typeof inv.amount !== "object") {
      errors.push(`${prefix}.amount is missing or invalid`);
    } else if (typeof inv.amount.amount !== "number") {
      errors.push(`${prefix}.amount.amount is not a number`);
    }
  });

  return errors;
}

// ─── Reconcile mock (no Supabase) ─────────────────────────────────────────────

function mockReconcile(invoices, bankStatements) {
  const normalizeDigits = (s) => {
    const digits = String(s ?? "").replace(/[^0-9]/g, "");
    return digits ? String(parseInt(digits, 10)) : "";
  };

  const results = invoices.map((inv) => {
    const invNorm = normalizeDigits(inv.invoiceNumber);
    const match = bankStatements.find((stmt) => {
      const stmtNorm = normalizeDigits(stmt.reference);
      return stmtNorm && stmtNorm === invNorm;
    });
    return {
      invoiceNumber: inv.invoiceNumber,
      matched: !!match,
      matchedRef: match?.reference ?? null,
      matchType: match ? "exact_id" : "unmatched",
    };
  });

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("Steve v2 — Pipeline Test");
  console.log("=".repeat(60));

  // Step 1: Parse PDF
  console.log(`\n[1/3] Parsing PDF: ${PDF_PATH}`);
  if (!existsSync(PDF_PATH)) {
    console.error(`❌  File not found: ${PDF_PATH}`);
    process.exit(1);
  }

  const pdfBuffer = readFileSync(PDF_PATH);
  let text;
  try {
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const parsed = await pdfParse(pdfBuffer);
    text = parsed.text.trim();
    console.log(`   ✅  Extracted ${text.length} characters from PDF`);
    console.log(`   Preview: ${text.slice(0, 200).replace(/\n/g, " ")}...`);
  } catch (err) {
    console.error("   ❌  PDF parse failed:", err.message);
    process.exit(1);
  }

  // Step 2: Extract with Claude
  console.log("\n[2/3] Running Claude extraction pipeline...");

  console.log("   → Checking invoice count...");
  const countInfo = await checkMultipleInvoiceNumbers(text, PDF_PATH);
  console.log(`   → Count result: ${JSON.stringify(countInfo)}`);

  console.log("   → Extracting potential IDs...");
  const { potentialIds } = await extractPotentialInvoiceIds(text, PDF_PATH);
  console.log(`   → Potential IDs found: ${JSON.stringify(potentialIds)}`);

  console.log("   → Running main extraction...");
  let extracted;
  try {
    extracted = await extractInvoices(text, PDF_PATH, countInfo, potentialIds);
    console.log(`   ✅  Extraction complete — ${extracted.invoices?.length ?? 0} invoices`);
  } catch (err) {
    console.error("   ❌  Extraction failed:", err.message);
    process.exit(1);
  }

  // Step 3: Validate shape
  console.log("\n[3/3] Validating output shape...");
  const errors = validateExtraction(extracted);
  if (errors.length > 0) {
    console.error("   ❌  Validation failed:");
    errors.forEach((e) => console.error(`      - ${e}`));
  } else {
    console.log("   ✅  Shape valid");
  }

  // Print extracted invoices
  console.log("\n--- Extracted Invoices ---");
  (extracted.invoices || []).forEach((inv, i) => {
    console.log(`\n  [${i + 1}] Invoice #${inv.invoiceNumber ?? "(none)"}`);
    console.log(`      Date:        ${inv.invoiceDate ?? "(none)"}`);
    console.log(`      Description: ${inv.activityDescription ?? "(none)"}`);
    console.log(`      Amount:      ${inv.currency ?? ""}${inv.amount?.amount ?? "?"} (tax: ${inv.amount?.tax_fees ?? 0})`);
    console.log(`      Status:      ${inv.paymentStatus ?? "(none)"}`);
    console.log(`      IDs:         ${JSON.stringify(inv.potentialInvoiceIds ?? [])}`);
  });

  // Optional: mock reconcile
  const SAMPLE_BANK_STATEMENTS = [
    { reference: extracted.invoices?.[0]?.invoiceNumber ?? "INV-0001", amount: extracted.invoices?.[0]?.amount?.amount ?? 0 },
    { reference: "INV-NOMATCH", amount: 999 },
  ];

  console.log("\n--- Mock Reconciliation (sample bank data) ---");
  const reconcileResults = mockReconcile(extracted.invoices || [], SAMPLE_BANK_STATEMENTS);
  reconcileResults.forEach((r) => {
    const icon = r.matched ? "✅" : "❌";
    console.log(`  ${icon} Invoice ${r.invoiceNumber} → ${r.matchType}${r.matchedRef ? ` (ref: ${r.matchedRef})` : ""}`);
  });

  console.log("\n" + "=".repeat(60));
  if (errors.length > 0) {
    console.log("RESULT: ❌  FAILED — extraction shape errors detected (likely prompt issue)");
    process.exit(1);
  } else {
    console.log("RESULT: ✅  PASSED — PDF parse, Claude extraction, and shape all OK");
  }
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n💥 Unexpected error:", err);
  process.exit(1);
});
