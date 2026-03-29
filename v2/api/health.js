export default function handler(req, res) {
  // Core: app cannot function without these
  const REQUIRED_ENV = [
    "ANTHROPIC_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "NEXT_PUBLIC_APP_URL",
    "XERO_CLIENT_ID",
    "XERO_CLIENT_SECRET",
    "XERO_REDIRECT_URI",
  ];

  // Optional: degraded-mode features (semantic matching disabled without it)
  const OPTIONAL_ENV = [
    "OPENROUTER_API_KEY",
    "NEXT_PUBLIC_POSTHOG_KEY",
  ];

  const missing = REQUIRED_ENV.filter((v) => !process.env[v]);
  const optionalMissing = OPTIONAL_ENV.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    return res.status(500).json({ status: "misconfigured", missing });
  }

  res.status(200).json({
    status: "ok",
    ...(optionalMissing.length > 0 && { optional_missing: optionalMissing }),
  });
}
