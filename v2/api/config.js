// api/config.js — serves public Supabase config to the frontend
// Only exposes ANON key (safe for browser) — never the service role key
export default function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return res.status(500).json({ error: "Supabase environment variables not configured" });
  }

  // Cache for 1 hour — these values don't change between deployments
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.json({
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    // REC-335: PostHog analytics key (public/anon, safe for browser)
    posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY || null,
  });
}
