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
      invoice:invoices(id, invoice_number, contact_name, amount, status)
    `)
    .eq("client_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  const total = reconciliations.length;
  const matched = reconciliations.filter(
    (r) => r.match_type === "exact_id" || r.match_type === "manual"
  ).length;
  const unmatched = reconciliations.filter((r) => r.match_type === "unmatched").length;
  const review = reconciliations.filter(
    (r) => (r.match_type === "semantic" || r.match_type === "needs_review") && !r.overridden_by_user
  ).length;

  return res.json({
    reconciliations,
    stats: { total, matched, unmatched, review },
  });
}
