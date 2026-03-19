#!/usr/bin/env bash
# Steve v2 — Full deployment script
# Run this after Shaul has created the Supabase project.
# Usage: bash v2/scripts/deploy-day.sh
#
# What this does (in order):
#   1. Check prerequisites (supabase CLI, vercel CLI)
#   2. Link Supabase project
#   3. Push database migrations
#   4. Deploy edge functions
#   5. Set Vercel environment variables
#   6. Deploy to Vercel production
#   7. Smoke test the live deployment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V2_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
fail() { echo -e "${RED}✗${NC}  $1"; exit 1; }
step() { echo -e "\n${YELLOW}==>${NC} $1"; }

echo ""
echo "========================================"
echo "  Steve v2 — Deploy Day"
echo "========================================"
echo ""

# ── Step 1: Prerequisites ──────────────────────────────────────────────────────

step "Checking prerequisites"

command -v supabase >/dev/null 2>&1 || fail "supabase CLI not found. Install: brew install supabase/tap/supabase"
command -v vercel   >/dev/null 2>&1 || fail "vercel CLI not found. Install: npm i -g vercel"
command -v curl     >/dev/null 2>&1 || fail "curl not found"

ok "supabase CLI: $(supabase --version 2>/dev/null | head -1)"
ok "vercel CLI:   $(vercel --version 2>/dev/null | head -1)"

# ── Step 2: Collect config ─────────────────────────────────────────────────────

step "Collecting configuration"

# Supabase project ref (the part of the URL after supabase.co/project/)
SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-}"
if [ -z "$SUPABASE_PROJECT_REF" ]; then
  echo "  Find this at: supabase.com/dashboard → your project → Settings → General"
  echo "  It looks like: abcdefghijklmnop (16 chars)"
  read -rp "  SUPABASE_PROJECT_REF: " SUPABASE_PROJECT_REF
fi

SUPABASE_URL="${SUPABASE_URL:-}"
if [ -z "$SUPABASE_URL" ]; then
  SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"
  warn "SUPABASE_URL not set — defaulting to: $SUPABASE_URL"
fi

SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-}"
if [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "  Find at: supabase.com → project → Settings → API → anon public"
  read -rp "  SUPABASE_ANON_KEY: " SUPABASE_ANON_KEY
fi

SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "  Find at: supabase.com → project → Settings → API → service_role secret"
  read -rsp "  SUPABASE_SERVICE_ROLE_KEY (hidden): " SUPABASE_SERVICE_ROLE_KEY
  echo ""
fi

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
if [ -z "$ANTHROPIC_API_KEY" ]; then
  read -rsp "  ANTHROPIC_API_KEY (sk-ant-..., hidden): " ANTHROPIC_API_KEY
  echo ""
fi

XERO_CLIENT_ID="${XERO_CLIENT_ID:-2AB441B1BB814413ABA1925DC2B5BD3B}"

XERO_CLIENT_SECRET="${XERO_CLIENT_SECRET:-}"
if [ -z "$XERO_CLIENT_SECRET" ]; then
  echo "  Find at: developer.xero.com/app/manage → Steve app → Client secret"
  read -rsp "  XERO_CLIENT_SECRET (hidden): " XERO_CLIENT_SECRET
  echo ""
fi

APP_URL="${NEXT_PUBLIC_APP_URL:-}"
if [ -z "$APP_URL" ]; then
  warn "APP_URL not set yet (needed for Xero redirect). Will prompt after Vercel deploy."
  DEFER_APP_URL=1
else
  DEFER_APP_URL=0
fi

CRON_SECRET="${CRON_SECRET:-6f21707586010a6b3b17db4d20b68f655f1a130164c5f6ce1821feee871c962f}"

OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "  Find at: openrouter.ai → Keys → Create key"
  read -rsp "  OPENROUTER_API_KEY (sk-or-..., hidden): " OPENROUTER_API_KEY
  echo ""
fi

ok "Configuration collected"

# ── Step 3: Link Supabase project ──────────────────────────────────────────────

step "Linking Supabase project ($SUPABASE_PROJECT_REF)"

cd "$V2_DIR"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
ok "Supabase project linked"

# ── Step 4: Push database migrations ──────────────────────────────────────────

step "Pushing database migrations"

# Patch migration 003: substitute placeholders with real values before pushing.
# The file is a template in git; we restore it after the push.
MIGRATION_003="$V2_DIR/supabase/migrations/003_auto_embed_trigger.sql"
MIGRATION_003_BAK="${MIGRATION_003}.bak"
cp "$MIGRATION_003" "$MIGRATION_003_BAK"
sed \
  -e "s|<YOUR_SUPABASE_PROJECT_REF>|${SUPABASE_PROJECT_REF}|g" \
  -e "s|<YOUR_SUPABASE_ANON_KEY>|${SUPABASE_ANON_KEY}|g" \
  "$MIGRATION_003_BAK" > "$MIGRATION_003"
# Ensure the template is restored even if supabase db push fails
trap 'mv "$MIGRATION_003_BAK" "$MIGRATION_003"' EXIT INT TERM

supabase db push

trap - EXIT INT TERM
mv "$MIGRATION_003_BAK" "$MIGRATION_003"
ok "Migrations applied"

# ── Step 5: Deploy edge functions ──────────────────────────────────────────────

step "Deploying edge functions"

supabase functions deploy auto-embed \
  --project-ref "$SUPABASE_PROJECT_REF" \
  --no-verify-jwt

ok "Edge function 'auto-embed' deployed"

# ── Step 5b: Set edge function secrets ────────────────────────────────────────

step "Setting edge function secrets"

supabase secrets set OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  --project-ref "$SUPABASE_PROJECT_REF"

ok "Edge function secret OPENROUTER_API_KEY set"

# ── Step 6: Set Vercel environment variables ───────────────────────────────────

step "Setting Vercel environment variables"

# Helper: set env var (skip if already set, force update)
vercel_env_set() {
  local key="$1"
  local val="$2"
  local env="${3:-production}"
  # Remove existing value silently before adding, to avoid duplicate prompts
  vercel env rm "$key" "$env" --yes 2>/dev/null || true
  echo "$val" | vercel env add "$key" "$env"
}

vercel_env_set SUPABASE_URL             "$SUPABASE_URL"
vercel_env_set SUPABASE_ANON_KEY        "$SUPABASE_ANON_KEY"
vercel_env_set SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
vercel_env_set ANTHROPIC_API_KEY        "$ANTHROPIC_API_KEY"
vercel_env_set XERO_CLIENT_ID           "$XERO_CLIENT_ID"
vercel_env_set XERO_CLIENT_SECRET       "$XERO_CLIENT_SECRET"
vercel_env_set CRON_SECRET              "$CRON_SECRET"

ok "Vercel env vars set (excluding APP_URL and XERO_REDIRECT_URI — needs deploy URL first)"

# ── Step 7: Deploy to Vercel production ───────────────────────────────────────

step "Deploying to Vercel production"

DEPLOY_OUTPUT=$(vercel --prod --yes 2>&1)
echo "$DEPLOY_OUTPUT"

DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' | tail -1)

if [ -z "$DEPLOY_URL" ]; then
  warn "Could not auto-detect deploy URL from vercel output."
  read -rp "  Enter the deployed URL (e.g. https://steve-v2.vercel.app): " DEPLOY_URL
fi

ok "Deployed to: $DEPLOY_URL"

# ── Step 8: Set URL-dependent env vars ────────────────────────────────────────

if [ "${DEFER_APP_URL:-0}" = "1" ]; then
  APP_URL="$DEPLOY_URL"
fi

XERO_REDIRECT_URI="${APP_URL}/api/xero-callback"

vercel_env_set NEXT_PUBLIC_APP_URL "$APP_URL"
vercel_env_set XERO_REDIRECT_URI   "$XERO_REDIRECT_URI"

ok "APP_URL and XERO_REDIRECT_URI set"

# Redeploy to pick up the URL env vars
step "Redeploying with URL env vars"
vercel --prod --yes
ok "Redeployment complete"

# ── Step 9: Smoke test ────────────────────────────────────────────────────────

step "Running smoke tests"

BASE="$APP_URL"
FAIL=0

check_endpoint() {
  local label="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local http_status
  http_status=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$http_status" = "$expected_status" ]; then
    ok "$label → HTTP $http_status"
  else
    warn "$label → HTTP $http_status (expected $expected_status)"
    FAIL=1
  fi
}

check_endpoint "Homepage"         "$BASE/"
check_endpoint "Config endpoint"  "$BASE/api/config"
check_endpoint "Health check"     "$BASE/api/health" 200

# Xero auth should redirect (302) not error
XERO_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/xero-auth")
if [ "$XERO_STATUS" = "302" ] || [ "$XERO_STATUS" = "200" ]; then
  ok "Xero auth endpoint → HTTP $XERO_STATUS"
else
  warn "Xero auth endpoint → HTTP $XERO_STATUS (expected 302 redirect)"
  FAIL=1
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
if [ "$FAIL" = "0" ]; then
  echo -e "${GREEN}  Deploy complete — all checks passed${NC}"
else
  echo -e "${YELLOW}  Deploy complete — some checks flagged (see above)${NC}"
fi
echo "========================================"
echo ""
echo "  App URL:           $APP_URL"
echo "  Xero redirect URI: $XERO_REDIRECT_URI"
echo ""
echo "  Next steps:"
echo "  1. Register redirect URI in Xero developer portal:"
echo "     → https://developer.xero.com/app/manage → Steve app → Redirect URIs"
echo "     → Add: $XERO_REDIRECT_URI"
echo "  2. Connect Xero: visit $APP_URL → Connect Xero"
echo "  3. Upload a bank statement CSV and verify reconciliation works end-to-end"
echo ""
