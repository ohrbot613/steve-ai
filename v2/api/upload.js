// api/upload.js — create upload record before file processing
import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: "Invalid token" });

  const { fileName, fileType } = req.body || {};
  if (!fileName) return res.status(400).json({ error: "fileName is required" });

  const { data, error } = await supabase
    .from("uploads")
    .insert({ client_id: user.id, file_name: fileName, file_type: fileType || null, status: "pending" })
    .select("id")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ uploadId: data.id });
}
