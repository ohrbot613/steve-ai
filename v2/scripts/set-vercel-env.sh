#!/usr/bin/env bash
# Steve v2 — Set Vercel environment variables
# Run this AFTER: (1) Supabase project is created, (2) vercel login
# Usage: bash v2/scripts/set-vercel-env.sh

set -e

echo "=== Steve v2: Vercel Environment Setup ==="
echo ""

# ── Supabase ─────────────────────────────────────────────────────────────────
# Get these from: https://supabase.com/dashboard → your project → Settings → API

SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

if [ -z "$SUPABASE_URL" ]; then
  read -p "SUPABASE_URL (e.g. https://xxxx.supabase.co): " SUPABASE_URL
fi
if [ -z "$SUPABASE_ANON_KEY" ]; then
  read -p "SUPABASE_ANON_KEY (anon/public key): " SUPABASE_ANON_KEY
fi
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  read -p "SUPABASE_SERVICE_ROLE_KEY (service_role key): " SUPABASE_SERVICE_ROLE_KEY
fi

# ── Anthropic ─────────────────────────────────────────────────────────────────
# Get from: https://console.anthropic.com/settings/keys

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
if [ -z "$ANTHROPIC_API_KEY" ]; then
  read -p "ANTHROPIC_API_KEY (sk-ant-...): " ANTHROPIC_API_KEY
fi

# ── Xero ─────────────────────────────────────────────────────────────────────
# From Xero developer portal: https://developer.xero.com/app/manage
# App: Steve AI (or create one if needed)
# Required scopes: openid profile email offline_access accounting.transactions accounting.contacts

XERO_CLIENT_ID="2AB441B1BB814413ABA1925DC2B5BD3B"   # from v1 .env — verify still correct
XERO_CLIENT_SECRET="${XERO_CLIENT_SECRET:-}"          # MISSING from v1 — Shaul must provide

if [ -z "$XERO_CLIENT_SECRET" ]; then
  echo ""
  echo "⚠️  XERO_CLIENT_SECRET is missing (v1 .env had a truncated value '4')"
  echo "   → Find it at: https://developer.xero.com/app/manage → Steve app → Client secret"
  read -p "XERO_CLIENT_SECRET: " XERO_CLIENT_SECRET
fi

# ── App URL ───────────────────────────────────────────────────────────────────
# Get after first Vercel deploy: vercel --prod then copy the URL shown

APP_URL="${NEXT_PUBLIC_APP_URL:-}"
if [ -z "$APP_URL" ]; then
  read -p "App URL (e.g. https://steve-v2.vercel.app): " APP_URL
fi

XERO_REDIRECT_URI="${APP_URL}/api/xero-callback"

# ── Cron Secret ───────────────────────────────────────────────────────────────
# Pre-generated — safe to use as-is

CRON_SECRET="6f21707586010a6b3b17db4d20b68f655f1a130164c5f6ce1821feee871c962f"

# ── Apply to Vercel ───────────────────────────────────────────────────────────
echo ""
echo "Setting Vercel secrets..."

vercel env add SUPABASE_URL production <<< "$SUPABASE_URL"
vercel env add SUPABASE_ANON_KEY production <<< "$SUPABASE_ANON_KEY"
vercel env add SUPABASE_SERVICE_ROLE_KEY production <<< "$SUPABASE_SERVICE_ROLE_KEY"
vercel env add ANTHROPIC_API_KEY production <<< "$ANTHROPIC_API_KEY"
vercel env add XERO_CLIENT_ID production <<< "$XERO_CLIENT_ID"
vercel env add XERO_CLIENT_SECRET production <<< "$XERO_CLIENT_SECRET"
vercel env add XERO_REDIRECT_URI production <<< "$XERO_REDIRECT_URI"
vercel env add NEXT_PUBLIC_APP_URL production <<< "$APP_URL"
vercel env add CRON_SECRET production <<< "$CRON_SECRET"

echo ""
echo "✓ All env vars set. Now deploy:"
echo "  cd v2 && vercel --prod"
echo ""
echo "After deploy, register Xero redirect URI:"
echo "  → https://developer.xero.com/app/manage → Steve app → Redirect URIs"
echo "  → Add: ${XERO_REDIRECT_URI}"
