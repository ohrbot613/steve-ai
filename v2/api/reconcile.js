// api/reconcile.js — Vercel Serverless Function
// Runs reconciliation for a client: exact-ID matching first, then semantic fallback

import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Exact ID matching (ported from xeroPollingService.js)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile a client's unmatched transactions
// Strategy: exact-ID first, then semantic via pgvector
// ─────────────────────────────────────────────────────────────────────────────

async function reconcileClient(supabase, clientId) {
  const startTime = Date.now();
  let exactMatches = 0;
  let semanticMatches = 0;
  let unmatched = 0;

  // Fetch all unreconciled bank transactions
  const { data: transactions, error: txErr } = await supabase
    .from("bank_transactions")
    .select("id, invoice_number, potential_invoice_ids, embedding, amount")
    .eq("client_id", clientId)
    .not(
      "id",
      "in",
      `(select bank_transaction_id from reconciliations where client_id = '${clientId}')`
    );

  if (txErr) throw new Error(`Fetch transactions failed: ${txErr.message}`);
  if (!transactions?.length) return { exactMatches, semanticMatches, unmatched };

  // Fetch all invoices for this client
  const { data: invoices, error: invErr } = await supabase
    .from("invoices")
    .select("id, invoice_number, contact_name, amount, status, embedding")
    .eq("client_id", clientId)
    .eq("status", "unpaid");

  if (invErr) throw new Error(`Fetch invoices failed: ${invErr.message}`);
  if (!invoices?.length) {
    unmatched = transactions.length;
    return { exactMatches, semanticMatches, unmatched };
  }

  const reconciliationRows = [];

  for (const tx of transactions) {
    // Step 1: Exact ID match
    let bestInvoice = null;
    let bestScore = 0;

    for (const inv of invoices) {
      const score = getIdScore(tx, inv);
      if (score > bestScore) {
        bestScore = score;
        bestInvoice = inv;
      }
    }

    if (bestScore >= 0.8 && bestInvoice) {
      reconciliationRows.push({
        client_id: clientId,
        bank_transaction_id: tx.id,
        invoice_id: bestInvoice.id,
        match_type: "exact_id",
        confidence: bestScore,
        match_reason: `Exact digit match: ${bestInvoice.invoice_number}`,
      });
      exactMatches++;
      continue;
    }

    // Step 2: Semantic match via pgvector
    if (tx.embedding) {
      const { data: semanticMatches_data, error: semErr } = await supabase.rpc(
        "match_invoices",
        {
          query_embedding: tx.embedding,
          client_id_filter: clientId,
          match_threshold: 0.75,
          match_count: 1,
        }
      );

      if (!semErr && semanticMatches_data?.length > 0) {
        const match = semanticMatches_data[0];
        reconciliationRows.push({
          client_id: clientId,
          bank_transaction_id: tx.id,
          invoice_id: match.id,
          match_type: "semantic",
          confidence: Math.round(match.similarity * 100) / 100,
          match_reason: `Semantic similarity: ${(match.similarity * 100).toFixed(1)}% — ${match.invoice_number} / ${match.contact_name}`,
        });
        semanticMatches++;
        continue;
      }
    }

    // No match found
    reconciliationRows.push({
      client_id: clientId,
      bank_transaction_id: tx.id,
      invoice_id: null,
      match_type: "unmatched",
      confidence: 0,
      match_reason: "No match found",
    });
    unmatched++;
  }

  if (reconciliationRows.length > 0) {
    const { error: insertErr } = await supabase
      .from("reconciliations")
      .upsert(reconciliationRows, { onConflict: "bank_transaction_id" });

    if (insertErr) throw new Error(`Reconciliation insert failed: ${insertErr.message}`);
  }

  const durationMs = Date.now() - startTime;

  await supabase.from("audit_log").insert({
    client_id: clientId,
    category: "reconcile",
    action: "reconciliation_complete",
    details: {
      exact_matches: exactMatches,
      semantic_matches: semanticMatches,
      unmatched,
      total: transactions.length,
      duration_ms: durationMs,
    },
  });

  return { exactMatches, semanticMatches, unmatched, durationMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel handler
// POST /api/reconcile
// Auth: Bearer JWT from Supabase auth
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return res.status(401).json({ error: "Invalid token" });

  try {
    const result = await reconcileClient(supabase, user.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
