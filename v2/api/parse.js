// api/parse.js — Vercel Serverless Function
// Accepts a raw PDF file upload (multipart/form-data, field "file") and
// returns extracted plain text. Called by the frontend before /api/extract
// so that PDF content reaches Claude as readable text, not garbled binary.
//
// REC-313: Added scanned-PDF fallback.
// If pdf-parse returns < PDF_VISION_TEXT_THRESHOLD chars (likely a scanned/image
// PDF with no text layer), the PDF is sent to Claude's vision API for OCR and the
// resulting Markdown is returned instead.  This mirrors the logic in
// steve-agent-2.0/server/controllers/toolsController.js (renderPdfPagesAsDataUrls
// + openrouterTranscribeImageToMarkdown) but uses the Claude API already present
// in v2, with no additional dependencies.
//
// Claude accepts PDF documents directly in the messages API (model claude-3-5-sonnet,
// "document" content block type) — no need to manually render pages as images.

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// Vercel disables the default body parser so we can stream the raw bytes
export const config = { api: { bodyParser: false } };

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// If pdf-parse yields fewer characters than this, we treat the PDF as a
// scanned image and fall back to Claude vision OCR.
// ~200 chars is enough for a few words of boilerplate but unlikely to cover
// a real invoice — intentionally conservative so we don't miss sparse PDFs.
const PDF_VISION_TEXT_THRESHOLD = 200;

// Server-side size guard — 4.5MB to match Vercel's hard limit and frontend warning
const MAX_BYTES = 4.5 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Read raw body as a Buffer
function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Parse a multipart/form-data body and extract the first file field
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;

  while (start < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    const partStart = idx + boundaryBuf.length;
    if (buffer[partStart] === 0x2d && buffer[partStart + 1] === 0x2d) break; // "--"

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1) break;

    const headerStr = buffer.slice(partStart + 2, headerEnd).toString();
    const nextBoundary = buffer.indexOf(boundaryBuf, headerEnd + 4);
    const bodyEnd = nextBoundary === -1 ? buffer.length : nextBoundary - 2; // strip trailing \r\n

    parts.push({
      headers: headerStr,
      data: buffer.slice(headerEnd + 4, bodyEnd),
    });
    start = nextBoundary === -1 ? buffer.length : nextBoundary;
  }

  return parts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude vision OCR fallback for scanned PDFs (REC-313)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a PDF buffer to Claude as a document content block and request full OCR.
 * Claude 3.5 Sonnet supports PDF documents natively (up to ~32 pages per call).
 * Returns the transcribed Markdown text, or throws on API error.
 *
 * @param {Buffer} pdfBuf
 * @returns {Promise<string>}
 */
async function claudeVisionOcrPdf(pdfBuf) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY not set — cannot run vision OCR");
  }

  const claude = new Anthropic({ apiKey });
  const base64Pdf = pdfBuf.toString("base64");

  const msg = await claude.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf,
            },
          },
          {
            type: "text",
            text: [
              "You are a document transcription assistant performing full OCR.",
              "Transcribe every piece of readable text from this document completely and verbatim.",
              "Do not summarise, paraphrase, or skip any text.",
              "Include headers, footers, table cells, labels, amounts, dates, invoice numbers, and all fine print.",
              "Return the content as Markdown only — no preamble, no explanation.",
              "Use Markdown tables for tabular layouts so no cell text is dropped.",
              "Preserve reading order top-to-bottom, left-to-right.",
              "If there is no readable text at all, reply exactly with: (no text detected)",
            ].join(" "),
          },
        ],
      },
    ],
  });

  return msg.content[0]?.text ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth check ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization header" });
  }
  const jwt = authHeader.slice(7);

  const supabaseAnon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );
  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // ── Parse multipart body ─────────────────────────────────────────────────────
  const contentType = req.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    return res.status(400).json({ error: "Expected multipart/form-data with boundary" });
  }

  let rawBuf;
  try {
    rawBuf = await rawBody(req);
  } catch {
    return res.status(400).json({ error: "Failed to read request body" });
  }

  if (rawBuf.length > MAX_BYTES) {
    return res.status(413).json({ error: "File too large — maximum size is 4MB" });
  }

  const parts = parseMultipart(rawBuf, boundaryMatch[1]);
  const filePart = parts.find((p) => p.headers.includes('name="file"'));
  if (!filePart) {
    return res.status(400).json({ error: 'Missing "file" field in form data' });
  }

  // ── Extract text ─────────────────────────────────────────────────────────────
  let text;
  let ocrMethod = "text";

  // Check if it's a PDF by magic bytes (%PDF)
  const isPdf =
    filePart.data[0] === 0x25 &&
    filePart.data[1] === 0x50 &&
    filePart.data[2] === 0x44 &&
    filePart.data[3] === 0x46;

  if (isPdf) {
    // Step 1: try standard text extraction
    let pdfText = "";
    try {
      const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
      const parsed = await pdfParse(filePart.data);
      pdfText = parsed.text ?? "";
    } catch (err) {
      console.error("[Parse] pdf-parse error:", err.message);
      // Don't fail here — fall through to vision OCR
    }

    // Step 2: if text layer is sparse/empty, fall back to Claude vision OCR (REC-313)
    if (pdfText.trim().length < PDF_VISION_TEXT_THRESHOLD) {
      try {
        text = await claudeVisionOcrPdf(filePart.data);
        ocrMethod = "vision";
      } catch (visionErr) {
        console.error("[Parse] Claude vision OCR failed:", visionErr.message);
        // If vision also fails, return whatever text we got (may be empty)
        text = pdfText;
        ocrMethod = "text_fallback";
      }
    } else {
      text = pdfText;
    }
  } else {
    // Non-PDF (e.g. Excel exported as text, CSV): return as UTF-8 string
    text = filePart.data.toString("utf-8");
  }

  return res.status(200).json({
    text: text.trim(),
    // ocrMethod surfaced for debugging — callers can ignore this field
    ocrMethod,
  });
}
