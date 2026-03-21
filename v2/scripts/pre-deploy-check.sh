#!/usr/bin/env bash
# Steve v2 — Pre-deploy verification
# Run this BEFORE deploy-day.sh to confirm everything is ready.
# Usage: bash v2/scripts/pre-deploy-check.sh
#
# Checks:
#   1. Required environment variables
#   2. Node.js version >= 18
#   3. Required API files exist
#   4. supabase CLI installed
#   5. vercel CLI installed
#   6. Existing test suite (if present)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V2_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colors ────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────

PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}✓${NC}  $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✗${NC}  $1"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}⚠${NC}  $1"; }
section() { echo -e "\n${BOLD}$1${NC}"; }

# ── Header ────────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
echo "  Steve v2 — Pre-Deploy Check"
echo "========================================"
echo ""

# ── 1. Environment variables ──────────────────────────────────────────────────

section "1. Environment variables"

REQUIRED_VARS=(
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  OPENROUTER_API_KEY
  XERO_CLIENT_ID
  XERO_CLIENT_SECRET
  ANTHROPIC_API_KEY
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -n "${!var:-}" ]; then
    pass "$var is set"
  else
    fail "$var is NOT set"
  fi
done

# ── 2. Node.js version ────────────────────────────────────────────────────────

section "2. Node.js version"

if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    pass "Node.js v$NODE_VERSION (>= 18 required)"
  else
    fail "Node.js v$NODE_VERSION is too old — need >= 18"
  fi
else
  fail "Node.js not found"
fi

# ── 3. Required API files ─────────────────────────────────────────────────────

section "3. Required API files (v2/api/)"

REQUIRED_FILES=(
  parse.js
  extract.js
  upload.js
  reconcile.js
  results.js
  review.js
  health.js
  me.js
  xero-auth.js
  xero-callback.js
  xero-poll.js
  config.js
)

for file in "${REQUIRED_FILES[@]}"; do
  filepath="$V2_DIR/api/$file"
  if [ -f "$filepath" ]; then
    pass "api/$file exists"
  else
    fail "api/$file is MISSING"
  fi
done

# ── 4. Supabase CLI ───────────────────────────────────────────────────────────

section "4. Supabase CLI"

if command -v supabase >/dev/null 2>&1; then
  SUPA_VERSION=$(supabase --version 2>/dev/null | head -1)
  pass "supabase CLI: $SUPA_VERSION"
else
  fail "supabase CLI not found — install: brew install supabase/tap/supabase"
fi

# ── 5. Vercel CLI ─────────────────────────────────────────────────────────────

section "5. Vercel CLI"

if command -v vercel >/dev/null 2>&1; then
  VERCEL_VERSION=$(vercel --version 2>/dev/null | head -1)
  pass "vercel CLI: $VERCEL_VERSION"
else
  fail "vercel CLI not found — install: npm i -g vercel"
fi

# ── 6. Test suite ─────────────────────────────────────────────────────────────

section "6. Test suite"

TEST_FILE="$V2_DIR/test-e2e.js"
if [ -f "$TEST_FILE" ]; then
  echo "  Running test-e2e.js..."
  if node "$TEST_FILE" 2>&1 | sed 's/^/    /'; then
    pass "test-e2e.js passed"
  else
    fail "test-e2e.js failed (see output above)"
  fi
else
  warn "test-e2e.js not found — skipping (no tests to run)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}  All checks passed ($PASS/$((PASS + FAIL))) — ready to deploy${NC}"
  echo "========================================"
  echo ""
  echo "  Next step: bash v2/scripts/deploy-day.sh"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}  $FAIL check(s) failed — fix before deploying${NC}"
  echo "========================================"
  echo ""
  exit 1
fi
