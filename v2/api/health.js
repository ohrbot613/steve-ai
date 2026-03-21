export default function handler(req, res) {
  const REQUIRED_ENV = [
    "ANTHROPIC_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];

  const missing = REQUIRED_ENV.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    return res.status(500).json({ status: "misconfigured", missing });
  }

  res.status(200).json({ status: "ok" });
}
