---
phase: 05-fix-xero-bank-balance-mismatch-on-dashboard
plan: 01
subsystem: frontend/dashboard
tags:
  - xero-integration
  - dashboard
  - frontend
  - api-consumption
dependency_graph:
  requires:
    - Backend endpoint /api/v2/scripts/get-bank-balance (already exists)
  provides:
    - Live bank balance display in dashboard
    - useXeroBalance React hook for balance fetching
    - formatCurrency utility function
  affects:
    - Dashboard Top component user experience
    - Bank balance visibility
tech_stack:
  added:
    - React custom hook pattern (useXeroBalance)
    - Intl.NumberFormat for currency formatting
  patterns:
    - Fetch API for backend communication (existing pattern)
    - JWT cookie authentication (credentials: 'include')
    - Loading/error/success state management pattern
key_files:
  created:
    - PDF automation/client/src/hooks/useXeroBalance.js
  modified:
    - PDF automation/client/src/utils/currencyUtils.js
    - PDF automation/client/src/componentes/Top.jsx
decisions:
  - title: "Prefer xeroBalance over statementBalance"
    rationale: "xeroBalance reflects live AUTHORISED transactions in Xero, more accurate than report-based statementBalance"
    context: "useXeroBalance hook implementation"
  - title: "Treat 401 as non-error state"
    rationale: "User not being connected to Xero is a normal state, not an error. Shows 'Connect Xero' instead of error message"
    context: "Error handling in useXeroBalance"
  - title: "Filter by ACTIVE accounts in base currency"
    rationale: "Match backend logic, only sum accounts that are active and in the organization's base currency to avoid currency conversion issues"
    context: "Balance calculation logic"
  - title: "Format with no decimal places"
    rationale: "Matches original display format '23,340 pounds' - whole numbers only with thousands separators"
    context: "formatCurrency implementation"
  - title: "Fetch once on mount, no auto-refresh"
    rationale: "Per research recommendations - balance doesn't change frequently enough to warrant polling. User can manually refresh page if needed"
    context: "useXeroBalance useEffect dependency array"
metrics:
  duration: 7m 54s
  tasks_completed: 2
  files_created: 1
  files_modified: 2
  commits: 2
  completed_date: 2026-02-10
---

# Phase 05 Plan 01: Fix Xero Bank Balance Mismatch on Dashboard Summary

**One-liner:** Replaced hardcoded "23,340 pounds" with live bank balance fetched from Xero API using custom React hook and proper currency formatting.

## Objective

Replace the hardcoded bank balance in the dashboard Top component with live data from the existing `/api/v2/scripts/get-bank-balance` endpoint. The dashboard was displaying stale, hardcoded data that didn't reflect actual bank account balances.

## Implementation Details

### Task 1: Create useXeroBalance Hook and formatCurrency Utility
**Commit:** e237467

Created a custom React hook `useXeroBalance` that:
- Fetches bank balance from `/api/v2/scripts/get-bank-balance` on component mount
- Uses native fetch API with `credentials: 'include'` for JWT cookie authentication
- Manages loading, success, and error states
- Handles 401 (unauthenticated) as a normal state, not an error
- Filters accounts by ACTIVE status and base currency match
- Prefers `xeroBalance` (live authorized transactions) over `statementBalance`
- Returns `{ balance, loading, error }` object

Added `formatCurrency` function to existing `currencyUtils.js`:
- Reuses existing `getCurrencySymbol` function to get currency symbols
- Uses `Intl.NumberFormat('en-GB')` for thousands separators
- Formats with zero decimal places to match original "23,340" style
- Returns '--' placeholder for null/invalid amounts

**Files created:**
- `PDF automation/client/src/hooks/useXeroBalance.js`

**Files modified:**
- `PDF automation/client/src/utils/currencyUtils.js` (added formatCurrency function)

### Task 2: Wire Live Balance into Top Component
**Commit:** 69293c3

Updated the dashboard `Top.jsx` component to:
- Import and invoke `useXeroBalance` hook
- Import `formatCurrency` utility for display
- Replace hardcoded "23,340 pounds" with dynamic rendering:
  - "Loading..." while fetching
  - Formatted currency (e.g., "£23,451") when balance available
  - "Connect Xero" when user not authenticated (401 response)

**Files modified:**
- `PDF automation/client/src/componentes/Top.jsx`

## Verification Results

All verification checks passed:
- ✅ Build completed successfully with no errors
- ✅ Hardcoded "23,340" completely removed from codebase
- ✅ `useXeroBalance` hook properly wired in Top.jsx
- ✅ API endpoint `/api/v2/scripts/get-bank-balance` called by hook
- ✅ `formatCurrency` reuses existing `getCurrencySymbol` (no duplication)
- ✅ Loading state displays "Loading..." during fetch
- ✅ Unauthenticated state displays "Connect Xero" (not error)
- ✅ Active account filtering implemented
- ✅ xeroBalance preferred over statementBalance

## Deviations from Plan

None - plan executed exactly as written.

## Technical Notes

### Response Structure
The hook consumes the backend response shape from `scripts.js`:
```json
{
  "success": true,
  "baseCurrency": "GBP",
  "accounts": [
    {
      "accountId": "abc-123",
      "name": "Business Current Account",
      "currencyCode": "GBP",
      "baseCurrency": "GBP",
      "statementBalance": 23340.00,
      "xeroBalance": 23450.50,
      "status": "ACTIVE"
    }
  ]
}
```

### Balance Calculation Logic
The hook sums all accounts where:
1. `status === 'ACTIVE'`
2. `currencyCode === baseCurrency` (avoid multi-currency issues)
3. Uses `xeroBalance ?? statementBalance` (prefer live data)

### State Management
Three states managed by hook:
- `loading`: true initially, false after fetch completes
- `balance`: `{ total, currency, accounts }` on success, `null` on 401
- `error`: sanitized error message string, never exposes raw API errors

## Success Criteria Met

- ✅ Dashboard Top component fetches bank balance from `/api/v2/scripts/get-bank-balance` on mount
- ✅ Balance displayed as formatted currency string (e.g., "£23,451") instead of "23,340 pounds"
- ✅ Loading state visible while data fetches
- ✅ Unauthenticated users see "Connect Xero" instead of errors
- ✅ No new npm dependencies required (uses native fetch)
- ✅ Client builds successfully

## Must-Haves Verification

### Truths
- ✅ Dashboard displays live bank balance fetched from Xero API instead of hardcoded '23,340 pounds'
- ✅ Balance shows correct currency symbol and formatted number (e.g. '£23,451' not '23340 pounds')
- ✅ Dashboard shows 'Loading...' while balance is being fetched
- ✅ Dashboard shows 'Connect Xero' when user is not authenticated with Xero (401 response)
- ✅ Balance sums all ACTIVE accounts in the organisation's base currency

### Artifacts
- ✅ `useXeroBalance.js` exists with 86 lines (>30 min), provides custom React hook
- ✅ `currencyUtils.js` contains `formatCurrency` function using `getCurrencySymbol`
- ✅ `Top.jsx` modified to use `useXeroBalance` hook

### Key Links
- ✅ `useXeroBalance.js` → `/api/v2/scripts/get-bank-balance` via fetch call
- ✅ `Top.jsx` → `useXeroBalance.js` via hook import and invocation
- ✅ `Top.jsx` → `currencyUtils.js` via formatCurrency import

## Future Considerations

1. **Auto-refresh**: Current implementation fetches once on mount. Consider adding periodic refresh or manual refresh button if users report stale data issues.

2. **Account Breakdown**: Current display shows total only. Could add tooltip/modal showing individual account balances for transparency.

3. **Error Retry**: No retry logic on network errors. Could add retry mechanism for transient failures.

4. **Caching**: No response caching. Consider adding short-term cache to reduce API calls if component remounts frequently.

5. **Multi-currency**: Currently filters to base currency only. Consider displaying foreign currency accounts separately if users need visibility into those.

## Self-Check

Verifying all claimed files and commits exist:

### Files Check
```bash
# Created files
[ -f "PDF automation/client/src/hooks/useXeroBalance.js" ]
✅ FOUND: PDF automation/client/src/hooks/useXeroBalance.js

# Modified files
[ -f "PDF automation/client/src/utils/currencyUtils.js" ]
✅ FOUND: PDF automation/client/src/utils/currencyUtils.js

[ -f "PDF automation/client/src/componentes/Top.jsx" ]
✅ FOUND: PDF automation/client/src/componentes/Top.jsx
```

### Commits Check
```bash
git log --oneline --all | grep "e237467"
✅ FOUND: e237467 feat(05-01): create useXeroBalance hook and formatCurrency utility

git log --oneline --all | grep "69293c3"
✅ FOUND: 69293c3 feat(05-01): wire live Xero balance into dashboard Top component
```

### Build Verification
```bash
cd "PDF automation/client" && npm run build
✅ Build completed successfully in 11.26s with no errors
```

## Self-Check: PASSED

All files exist, all commits are in git history, and build succeeds.
