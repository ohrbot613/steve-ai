// api/results.js — fetch reconciliation results with stats for the CFO dashboard
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  const { data: reconciliations, error } = await supabase
    .from("reconciliations")
    .select(`
      id,
      match_type,
      confidence,
      match_reason,
      overridden_by_user,
      override_note,
      created_at,
      bank_transaction:bank_transactions(id, invoice_number, activity_description, amount, currency, transaction_date, payment_status),
      invoice:invoices(id, invoice_number, contact_name, amount, status, review_flag)
    `)
    .eq("client_id", user.id)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) return res.status(500).json({ error: error.message });

  // Fetch Xero invoices flagged for manual review (e.g. missing_contact) that
  // never made it into the reconciliations table because they couldn't be matched.
  const { data: flaggedInvoices, error: flagErr } = await supabase
    .from("invoices")
    .select("id, invoice_number, contact_name, amount, currency, status, date, due_date, description, review_flag, created_at")
    .eq("client_id", user.id)
    .not("review_flag", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (flagErr) {
    console.error("[Results] flagged invoices fetch error:", flagErr.message);
  }

  // Shape flagged invoices as pseudo-reconciliation records so the frontend can
  // render them in the same table without special-casing the data structure.
  const flaggedRows = (flaggedInvoices || []).map((inv) => ({
    id: `flagged-${inv.id}`,
    match_type: inv.review_flag, // e.g. "missing_contact"
    confidence: null,
    match_reason: null,
    overridden_by_user: false,
    override_note: null,
    created_at: inv.created_at,
    bank_transaction: null,
    invoice: {
      id: inv.id,
      invoice_number: inv.invoice_number,
      contact_name: inv.contact_name,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      date: inv.date,
      due_date: inv.due_date,
      description: inv.description,
      review_flag: inv.review_flag,
    },
  }));

  // Deduplicate: if an invoice already appears in reconciliations, skip its flagged row
  // (prevents duplicate rows when an invoice has both a reconciliation and a review_flag)
  const reconciledInvoiceIds = new Set(
    reconciliations.map((r) => r.invoice?.id).filter(Boolean)
  );
  const dedupedFlaggedRows = flaggedRows.filter(
    (r) => !reconciledInvoiceIds.has(r.invoice?.id)
  );

  const allRows = [...reconciliations, ...dedupedFlaggedRows];

  const total = allRows.length;
  const overridden = reconciliations.filter((r) => r.overridden_by_user).length;
  const matched = reconciliations.filter(
    (r) => r.match_type === "exact_id" || r.match_type === "manual" || r.overridden_by_user
  ).length;
  const unmatched = reconciliations.filter((r) => r.match_type === "unmatched").length;
  const review = allRows.filter(
    (r) =>
      (r.match_type === "semantic" ||
        r.match_type === "needs_review" ||
        r.match_type === "missing_contact") &&
      !r.overridden_by_user
  ).length;

  return res.json({
    reconciliations: allRows,
    stats: { total, matched, unmatched, review, overridden },
  });
}
