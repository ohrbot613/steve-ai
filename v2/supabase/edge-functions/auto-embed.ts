// auto-embed.ts — Supabase Edge Function
// Triggered by pg_net webhook on INSERT to invoices or bank_transactions.
// Calls OpenRouter embedding API, writes vector back to the row.
//
// Deploy:
//   supabase functions deploy auto-embed --no-verify-jwt
//
// Environment variables (set in Supabase dashboard → Settings → Edge Functions):
//   OPENROUTER_API_KEY   — your OpenRouter API key
//   SUPABASE_URL         — injected automatically by Supabase runtime
//   SUPABASE_SERVICE_ROLE_KEY — injected automatically by Supabase runtime

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// OpenRouter proxies OpenAI-compatible embeddings.
// text-embedding-3-small produces 1536-dimension vectors — matches our schema.
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";

// ─────────────────────────────────────────────────────────────────────────────
// Webhook payload shape (sent by pg_net trigger)
// ─────────────────────────────────────────────────────────────────────────────

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: "invoices" | "bank_transactions";
  schema: "public";
  record: Record<string, unknown>;
  old_record: Record<string, unknown> | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate embedding via OpenRouter
// ─────────────────────────────────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error("Cannot embed empty text");
  }

  const response = await fetch(OPENROUTER_EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://steve-ai.vercel.app",
      "X-Title": "Steve AI — Invoice Reconciliation",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.trim(),
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter embedding failed (${response.status}): ${body}`);
  }

  const json = await response.json();
  const embedding = json?.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding shape: got ${JSON.stringify(embedding)?.slice(0, 100)}`
    );
  }

  return embedding;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // Health check
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", fn: "auto-embed" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Validate env
  if (!OPENROUTER_API_KEY) {
    console.error("auto-embed: OPENROUTER_API_KEY not set");
    return new Response("Server misconfigured: missing OPENROUTER_API_KEY", { status: 500 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("auto-embed: Supabase env vars not set");
    return new Response("Server misconfigured: missing Supabase env vars", { status: 500 });
  }

  // Parse webhook payload
  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON payload", { status: 400 });
  }

  const { type, table, record } = payload;

  // Only handle INSERT events on our two target tables
  if (type !== "INSERT") {
    return new Response(JSON.stringify({ skipped: true, reason: "not an INSERT" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (table !== "invoices" && table !== "bank_transactions") {
    return new Response(
      JSON.stringify({ skipped: true, reason: `table '${table}' not handled` }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // embedding_content is a generated column in the schema:
  //   invoices:           invoice_number || ' ' || contact_name || ' ' || description
  //   bank_transactions:  invoice_number || ' ' || contact_name || ' ' || activity_description
  // pg_net sends the full row including generated columns.
  const rowId = record.id as string;
  const embeddingContent = (record.embedding_content as string | null)?.trim();

  if (!rowId) {
    return new Response("Payload missing row id", { status: 400 });
  }

  // Skip if embedding_content is empty (nothing to embed)
  if (!embeddingContent) {
    console.warn(`auto-embed: ${table} row ${rowId} has empty embedding_content — skipping`);
    return new Response(
      JSON.stringify({ skipped: true, reason: "empty embedding_content" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // Skip if embedding already set (e.g. re-delivered webhook)
  if (record.embedding !== null && record.embedding !== undefined) {
    return new Response(
      JSON.stringify({ skipped: true, reason: "embedding already populated" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`auto-embed: generating embedding for ${table} ${rowId} — "${embeddingContent.slice(0, 80)}..."`);

  // Generate embedding
  let embedding: number[];
  try {
    embedding = await generateEmbedding(embeddingContent);
  } catch (err) {
    console.error(`auto-embed: embedding generation failed for ${table} ${rowId}:`, err);
    return new Response(
      JSON.stringify({ error: "Embedding generation failed", detail: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Write embedding back to the row using service role (bypasses RLS)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { error: updateError } = await supabase
    .from(table)
    .update({ embedding: `[${embedding.join(",")}]` })
    .eq("id", rowId);

  if (updateError) {
    console.error(`auto-embed: failed to write embedding for ${table} ${rowId}:`, updateError);
    return new Response(
      JSON.stringify({ error: "DB update failed", detail: updateError.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`auto-embed: embedding written for ${table} ${rowId}`);

  return new Response(
    JSON.stringify({ success: true, table, id: rowId, dimensions: EMBEDDING_DIMENSIONS }),
    { headers: { "Content-Type": "application/json" } }
  );
});
