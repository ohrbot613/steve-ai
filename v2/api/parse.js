// api/parse.js — Vercel Serverless Function
// Accepts a raw PDF file upload (multipart/form-data, field "file") and
// returns extracted plain text. Called by the frontend before /api/extract
// so that PDF content reaches Claude as readable text, not garbled binary.

import { createClient } from "@supabase/supabase-js";

// Vercel disables the default body parser so we can stream the raw bytes
export const config = { api: { bodyParser: false } };

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

    const CRLF = Buffer.from("\r\n");
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
  } catch (err) {
    return res.status(400).json({ error: "Failed to read request body" });
  }

  const parts = parseMultipart(rawBuf, boundaryMatch[1]);
  const filePart = parts.find((p) => p.headers.includes('name="file"'));
  if (!filePart) {
    return res.status(400).json({ error: 'Missing "file" field in form data' });
  }

  // ── Extract text ─────────────────────────────────────────────────────────────
  let text;

  // Check if it's a PDF by magic bytes (%PDF)
  const isPdf =
    filePart.data[0] === 0x25 &&
    filePart.data[1] === 0x50 &&
    filePart.data[2] === 0x44 &&
    filePart.data[3] === 0x46;

  if (isPdf) {
    try {
      const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
      const parsed = await pdfParse(filePart.data);
      text = parsed.text;
    } catch (err) {
      console.error("[Parse] pdf-parse error:", err.message);
      return res.status(500).json({ error: "PDF parsing failed: " + err.message });
    }
  } else {
    // Non-PDF (e.g. Excel exported as text): return as UTF-8 string
    text = filePart.data.toString("utf-8");
  }

  return res.status(200).json({ text: text.trim() });
}
