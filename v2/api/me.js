// api/me.js — returns current user (used by frontend to validate token on load)
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return res.status(401).json({ error: "Invalid token" });

  // Fetch xero connection status from clients table
  const { data: client } = await supabase
    .from("clients")
    .select("xero_tenant_id, xero_last_polled_at")
    .eq("id", user.id)
    .single();

  return res.json({
    id: user.id,
    email: user.email,
    xeroConnected: !!(client?.xero_tenant_id),
    xeroLastPolledAt: client?.xero_last_polled_at || null,
  });
}
