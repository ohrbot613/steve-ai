// api/review.js — Vercel Serverless Function
// Allows a logged-in user to confirm or override a semantic reconciliation match.
// PATCH /api/review  body: { id, action: 'confirm' | 'override', note?: string }

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "PATCH") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  // ── Validate body ─────────────────────────────────────────────────────────────
  const { id, action, note } = req.body || {};
  if (!id || !action) {
    return res.status(400).json({ error: "Missing id or action" });
  }
  if (action !== "confirm" && action !== "override") {
    return res.status(400).json({ error: "action must be 'confirm' or 'override'" });
  }

  // ── Build update payload ──────────────────────────────────────────────────────
  // confirm  → set match_type='manual', overridden_by_user=false, clear override_note
  // override → set overridden_by_user=true, store override_note
  const updates =
    action === "confirm"
      ? {
          match_type: "manual",
          overridden_by_user: false,
          override_note: null,
          updated_at: new Date().toISOString(),
        }
      : {
          overridden_by_user: true,
          override_note: note || null,
          updated_at: new Date().toISOString(),
        };

  // RLS on the reconciliations table ensures the user can only update their own rows
  const { error: updateErr } = await supabase
    .from("reconciliations")
    .update(updates)
    .eq("id", id)
    .eq("client_id", user.id);

  if (updateErr) {
    console.error("[Review] update error:", updateErr.message);
    return res.status(500).json({ error: updateErr.message });
  }

  return res.status(200).json({ ok: true });
}
