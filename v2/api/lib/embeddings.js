// api/lib/embeddings.js
// Ported from steve-agent-2.0/server/lib/invoiceEmbedding.js
// Changes:
//   - Removed MongoDB / Atlas references
//   - Kept: embedInvoiceTexts (batch OpenRouter), averageL2NormalizedEmbeddings (fusion)
//   - embedding_content for invoices in v2 schema:
//       invoice_number || ' ' || contact_name || ' ' || description
//     (differs from agent-2.0 which embedded invoice_number ONLY)
//
// Usage: import for multi-variant embedding fusion in reconcile.js

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIM = 1536;
const BATCH_SIZE = 100;

/**
 * Embed an array of texts via OpenRouter (text-embedding-3-small, 1536 dims).
 * Returns null vectors when OPENROUTER_API_KEY is not set.
 *
 * @param {string[]} texts
 * @returns {Promise<(number[] | null)[]>}
 */
export async function embedTexts(texts) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || texts.length === 0) {
    if (!apiKey && texts.length > 0) {
      console.warn("[embeddings] OPENROUTER_API_KEY missing — returning null vectors");
    }
    return texts.map(() => null);
  }

  const out = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://steve-ai.vercel.app",
        "X-Title": "Steve AI — Invoice Reconciliation",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: chunk,
        dimensions: EMBEDDING_DIM,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenRouter embeddings ${res.status}: ${errBody || res.statusText}`);
    }

    const data = await res.json();
    // API guarantees objects are returned in the same order, but sort by index defensively
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      const vec = item.embedding;
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
        throw new Error(
          `[embeddings] expected ${EMBEDDING_DIM}-dim vector, got ${vec?.length}`
        );
      }
      out.push(vec);
    }
  }
  return out;
}

/**
 * Fuse multiple query embeddings (e.g. OCR name variants) by averaging, then
 * L2-normalising so cosine similarity in pgvector stays meaningful.
 *
 * Why: when a bank statement contains OCR noise (e.g. "Admams" vs "Adams"), embed
 * each variant separately and average the vectors. The fused vector sits between
 * all variants and scores well against the correct canonical form.
 *
 * Ported verbatim from invoiceEmbedding.js — algorithm unchanged.
 *
 * @param {(number[] | null | undefined)[]} vectors
 * @returns {number[] | null}
 */
export function averageL2NormalizedEmbeddings(vectors) {
  const valid = vectors.filter(
    (v) => Array.isArray(v) && v.length === EMBEDDING_DIM
  );
  if (valid.length === 0) return null;

  const dim = EMBEDDING_DIM;
  const out = new Float64Array(dim);
  for (const v of valid) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  const n = valid.length;
  for (let i = 0; i < dim; i++) out[i] /= n;

  // L2-normalise so downstream cosine distance is correct
  let sumSq = 0;
  for (let i = 0; i < dim; i++) sumSq += out[i] * out[i];
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return Array.from(out);
  const inv = 1 / norm;

  const result = new Array(dim);
  for (let i = 0; i < dim; i++) result[i] = out[i] * inv;
  return result;
}

/**
 * Build the embedding input text for an invoice, matching the v2 schema's
 * generated column:  invoice_number || ' ' || contact_name || ' ' || description
 *
 * @param {{ invoiceNumber?: string, contactName?: string, description?: string }} payload
 * @returns {string}
 */
export function buildInvoiceEmbeddingText({ invoiceNumber = "", contactName = "", description = "" } = {}) {
  return [invoiceNumber, contactName, description].map((s) => String(s ?? "").trim()).filter(Boolean).join(" ");
}

/**
 * Build the embedding input text for a bank transaction query, matching the
 * v2 schema's generated column:
 *   invoice_number || ' ' || contact_name || ' ' || activity_description
 *
 * @param {{ invoiceNumber?: string, contactName?: string, activityDescription?: string }} payload
 * @returns {string}
 */
export function buildTransactionEmbeddingText({ invoiceNumber = "", contactName = "", activityDescription = "" } = {}) {
  return [invoiceNumber, contactName, activityDescription].map((s) => String(s ?? "").trim()).filter(Boolean).join(" ");
}
