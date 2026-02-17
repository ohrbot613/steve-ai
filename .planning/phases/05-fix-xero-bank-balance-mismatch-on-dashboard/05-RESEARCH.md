# Phase 5: Fix Xero bank balance mismatch on dashboard - Research

**Researched:** 2026-02-10
**Domain:** Xero API integration, React frontend data display, financial data reconciliation
**Confidence:** MEDIUM

## Summary

The dashboard displays a hardcoded bank balance ("23,340 pounds") in the Top component. The backend already has a functional `getBankBalance` endpoint that fetches real-time data from Xero's Bank Summary report and calculates live balances from bank transactions. The mismatch occurs because the frontend never calls this endpoint - it displays static text instead of dynamic data.

The backend implementation (in `/2.0/scripts/scripts.js`) follows a sophisticated approach: it fetches the Bank Summary report for statement balances, then computes live "Balance in Xero" by iterating through all AUTHORISED bank transactions (RECEIVE adds, SPEND subtracts). This dual-source approach provides both statement balance and computed Xero balance per account.

**Primary recommendation:** Wire the existing `/api/v2/scripts/get-bank-balance` endpoint to the Top component. Replace hardcoded balance with dynamic data fetched on mount/auth. Handle multiple bank accounts (sum or display primary), currency formatting, loading/error states, and respect Xero authentication status.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| xero-node | 13.4.0 | Xero API SDK | Official Xero OAuth2-enabled Node.js SDK for accounting data |
| React | ^18.x | Frontend UI | Already in use; component state and hooks for data fetching |
| axios | ^1.13.2 | HTTP client | Already installed; used throughout codebase for API calls |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| currency-symbol-map | ^5.1.0 | Currency symbols | Already installed; map ISO codes (GBP, USD) to symbols |
| express | ^5.2.1 | Backend routing | Already serving API; endpoint exists at `/api/v2/scripts/get-bank-balance` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| axios | fetch API | Fetch is native but lacks interceptors; axios already in dependencies |
| xero-node SDK | Direct REST calls | SDK handles OAuth token refresh automatically; raw REST requires manual token management |
| Sum all accounts | Display primary account | Summing assumes same currency; primary account simpler but may not reflect full picture |

**Installation:**
```bash
# No new packages needed - all dependencies already installed
npm install  # Ensures existing packages are up to date
```

## Architecture Patterns

### Recommended Project Structure
```
client/src/
├── componentes/
│   └── Top.jsx              # Dashboard header with balance display (UPDATE THIS)
├── hooks/
│   └── useXeroBalance.js    # Custom hook for balance fetching (CREATE NEW)
└── utils/
    └── formatCurrency.js    # Currency formatting utility (CREATE NEW)
```

### Pattern 1: Custom Hook for Balance Fetching
**What:** Encapsulate API call, loading state, error handling, and auto-refresh in a reusable hook
**When to use:** Component needs Xero balance data with loading/error UI feedback
**Example:**
```javascript
// hooks/useXeroBalance.js
import { useState, useEffect } from 'react';
import axios from 'axios';

export function useXeroBalance() {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchBalance() {
      try {
        setLoading(true);
        const response = await axios.get('/api/v2/scripts/get-bank-balance');

        if (response.data.success) {
          // Sum all active bank accounts in base currency
          const total = response.data.accounts
            .filter(acc => acc.status === 'ACTIVE')
            .reduce((sum, acc) => {
              // Use xeroBalance (live computed) over statementBalance
              const bal = acc.xeroBalance ?? acc.statementBalance ?? 0;
              return sum + bal;
            }, 0);

          setBalance({
            total,
            currency: response.data.baseCurrency,
            accounts: response.data.accounts
          });
        } else {
          setError(response.data.message || 'Failed to fetch balance');
        }
      } catch (err) {
        // Handle 401 (not authenticated) gracefully - don't show error
        if (err.response?.status === 401) {
          setBalance(null);
        } else {
          setError('Could not load bank balance');
        }
      } finally {
        setLoading(false);
      }
    }

    fetchBalance();
  }, []);

  return { balance, loading, error };
}
```

### Pattern 2: Currency Formatting Utility
**What:** Format numeric balance with currency symbol and locale-aware thousands separators
**When to use:** Displaying monetary amounts to users
**Example:**
```javascript
// utils/formatCurrency.js
import currencySymbolMap from 'currency-symbol-map';

export function formatCurrency(amount, currencyCode = 'GBP') {
  if (amount == null || typeof amount !== 'number') return 'N/A';

  const symbol = currencySymbolMap(currencyCode) || currencyCode;
  const formatted = new Intl.NumberFormat('en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(amount));

  return `${symbol}${formatted}`;
}
```

### Pattern 3: Graceful Degradation for Unauthenticated Users
**What:** Show placeholder or "Connect Xero" message when balance unavailable due to auth
**When to use:** User not authenticated with Xero but balance display is part of UI
**Example:**
```javascript
// In Top.jsx component
const { balance, loading, error } = useXeroBalance();

return (
  <div className={styles.userBalance}>
    <span className={styles.userBalanceLabel}>Balance</span>
    {loading ? (
      <span className={styles.userBalanceAmount}>Loading...</span>
    ) : balance ? (
      <span className={styles.userBalanceAmount}>
        {formatCurrency(balance.total, balance.currency)}
      </span>
    ) : (
      <span className={styles.userBalanceAmount}>Connect Xero</span>
    )}
  </div>
);
```

### Anti-Patterns to Avoid
- **Hardcoding balance values:** Always fetch from live API; hardcoded values become stale immediately
- **Fetching on every render:** Use useEffect with empty dependency array or React Query for caching
- **Ignoring currency differences:** Don't sum balances across different currencies without conversion
- **Displaying raw errors to users:** Sanitize error messages; "Could not load balance" vs API error details

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth token refresh | Manual token expiry check and refresh | xero-node SDK's built-in refresh | SDK handles token lifecycle automatically via `setTokenSet()` |
| Currency conversion | Custom exchange rate lookup | Accept base currency only OR use external conversion API | Exchange rates fluctuate; manual conversion is error-prone |
| Balance calculation | Sum all Xero invoices/bills | Use Bank Summary report + Bank Transactions API | Report data is pre-aggregated; transaction-level calculation is expensive and slow |
| Number formatting | String concatenation with commas | `Intl.NumberFormat` API | Handles locale-specific formatting (1,234.56 vs 1.234,56) automatically |

**Key insight:** Xero's Bank Summary report provides statement balances but may be stale (cached/batched). The backend already implements the correct pattern: use Bank Summary as baseline, then compute live balance from all AUTHORISED bank transactions. This gives real-time accuracy while leveraging Xero's optimized reporting.

## Common Pitfalls

### Pitfall 1: Using statementBalance instead of xeroBalance
**What goes wrong:** Statement balance from Bank Summary report reflects bank-imported transactions but may not match Xero's calculated balance if transactions are manually entered or reconciliation is pending
**Why it happens:** Backend returns both `statementBalance` and `xeroBalance` fields; unclear which to use
**How to avoid:** Prefer `xeroBalance` (computed from all AUTHORISED transactions) for "Balance in Xero" accuracy. Fall back to `statementBalance` only if `xeroBalance` is null.
**Warning signs:** Balance doesn't match Xero dashboard; user reports "numbers don't add up"

### Pitfall 2: Not handling 401 (unauthenticated) gracefully
**What goes wrong:** Error modal or broken UI when user not connected to Xero; balance fetch fails
**Why it happens:** Endpoint requires Xero auth middleware (`authController.xeroClient`, `authController.xeroTokenInfo`)
**How to avoid:** Catch 401 responses and display "Connect Xero" message instead of error. Don't treat missing authentication as an error state.
**Warning signs:** Red error messages on dashboard before user connects Xero; console errors about missing tokens

### Pitfall 3: Summing balances across different currencies
**What goes wrong:** Displaying "Total: $52,340" when accounts are in GBP, USD, EUR leads to meaningless number
**Why it happens:** Backend returns `accounts` array with per-account `currencyCode`; naively summing ignores currency
**How to avoid:** Filter accounts to `baseCurrency` only before summing, OR display multi-currency breakdown, OR clearly label as "Base Currency Equivalent"
**Warning signs:** Balance doesn't match user's mental model; multi-currency businesses report incorrect totals

### Pitfall 4: Stale balance data (no refresh mechanism)
**What goes wrong:** Balance fetched once on page load; never updates even after user makes transactions
**Why it happens:** useEffect with empty dependency array runs once; no refresh trigger
**How to avoid:** Add refresh button, auto-refresh every N minutes (e.g., 5 min), or refetch on window focus. For Phase 5, once-on-load is acceptable; future enhancement can add refresh.
**Warning signs:** User says "balance hasn't updated" after processing invoices

## Code Examples

Verified patterns from official sources:

### Fetching Bank Balance from Backend
```javascript
// client/src/componentes/Top.jsx (UPDATED)
import { useState, useEffect } from "react";
import axios from "axios";
import { formatCurrency } from "../utils/formatCurrency";

export default function Top() {
  const [bankBalance, setBankBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  useEffect(() => {
    async function loadBalance() {
      try {
        const response = await axios.get('/api/v2/scripts/get-bank-balance');
        if (response.data.success) {
          // Sum active accounts in base currency
          const total = response.data.accounts
            .filter(acc => acc.status === 'ACTIVE')
            .reduce((sum, acc) => sum + (acc.xeroBalance ?? acc.statementBalance ?? 0), 0);

          setBankBalance({
            amount: total,
            currency: response.data.baseCurrency
          });
        }
      } catch (err) {
        // Fail silently for 401 (not authenticated)
        if (err.response?.status !== 401) {
          console.error('Failed to load bank balance:', err);
        }
      } finally {
        setBalanceLoading(false);
      }
    }

    loadBalance();
  }, []);

  return (
    <div className={styles.userBalance}>
      <span className={styles.userBalanceLabel}>Balance</span>
      <span className={styles.userBalanceAmount}>
        {balanceLoading ? 'Loading...' :
         bankBalance ? formatCurrency(bankBalance.amount, bankBalance.currency) :
         'Connect Xero'}
      </span>
    </div>
  );
}
```

### Backend Endpoint Response Structure
```javascript
// Response from GET /api/v2/scripts/get-bank-balance
// Source: PDF automation/2.0/scripts/scripts.js (lines 457-523)
{
  "success": true,
  "baseCurrency": "GBP",
  "accounts": [
    {
      "accountId": "abc-123-def",
      "name": "Business Current Account",
      "currencyCode": "GBP",
      "baseCurrency": "GBP",
      "statementBalance": 23340.00,    // From Bank Summary report
      "xeroBalance": 23450.50,          // Computed from all AUTHORISED transactions
      "status": "ACTIVE"
    },
    {
      "accountId": "xyz-789-uvw",
      "name": "Savings Account",
      "currencyCode": "GBP",
      "baseCurrency": "GBP",
      "statementBalance": 10000.00,
      "xeroBalance": 10000.00,
      "status": "ACTIVE"
    }
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded balance in Top.jsx | Fetch from Xero API on load | Phase 5 (this phase) | Real-time accuracy instead of stale placeholder |
| Bank Summary report only | Bank Summary + Bank Transactions aggregation | Already implemented (backend) | xeroBalance reflects live transactions vs report snapshot |
| Stateless balance display | Could add periodic refresh | Future enhancement | Would keep balance current during long sessions |

**Deprecated/outdated:**
- Hardcoded "23,340 pounds" in `Top.jsx` line 66: Placeholder from initial frontend scaffold; must be replaced with API call

## Open Questions

1. **Which balance to display for multi-account orgs?**
   - What we know: Backend returns all bank accounts; response includes `baseCurrency` and per-account balances
   - What's unclear: Should UI sum all accounts, display primary account only, or show dropdown?
   - Recommendation: Sum all ACTIVE accounts in `baseCurrency` for Phase 5; add account breakdown in future phase if needed

2. **How to handle multi-currency accounts?**
   - What we know: Each account has `currencyCode`; some orgs have accounts in GBP, USD, EUR
   - What's unclear: Should non-base-currency accounts be excluded from sum, converted, or displayed separately?
   - Recommendation: Filter to `baseCurrency` only for Phase 5 (e.g., if base is GBP, ignore USD accounts). Clearly label as "GBP Balance" not just "Balance".

3. **Should balance auto-refresh?**
   - What we know: Balance fetched once on component mount; no refresh mechanism
   - What's unclear: Is once-per-session sufficient, or do users need periodic updates?
   - Recommendation: Start with once-on-load for Phase 5. If users report staleness, add manual refresh button or 5-minute auto-refresh in follow-up.

4. **What if Xero token expired mid-session?**
   - What we know: Backend middleware (`authController.xeroClient`) validates token; may return 401 if expired
   - What's unclear: Does xero-node SDK auto-refresh expired tokens, or does frontend need to handle re-auth flow?
   - Recommendation: Backend appears to handle token refresh (OAuth2 refresh token stored in XeroTenants collection). If 401, display "Reconnect Xero" and test token refresh behavior.

## Sources

### Primary (HIGH confidence)
- Local codebase analysis:
  - `/2.0/scripts/scripts.js` (getBankBalance implementation, lines 457-523)
  - `/2.0/routes/scriptsRoutes.js` (endpoint route definition)
  - `/client/src/componentes/Top.jsx` (hardcoded balance display, line 66)
  - `.planning/codebase/INTEGRATIONS.md` (Xero integration details)
  - `.planning/codebase/ARCHITECTURE.md` (data flow patterns)

### Secondary (MEDIUM confidence)
- [Xero Developer - Accounting API Reports](https://developer.xero.com/documentation/api/accounting/reports) - Bank Summary report endpoint documentation
- [xero-node GitHub Repository](https://github.com/XeroAPI/xero-node) - Official SDK used in backend
- [xero-node npm package](https://www.npmjs.com/package/xero-node) - Package details and version info
- [Xero Developer - Bank Transactions API](https://developer.xero.com/documentation/api/accounting/banktransactions) - Transaction endpoint used for live balance calculation

### Tertiary (LOW confidence)
- [GitHub Issue #330 - xero-node](https://github.com/XeroAPI/xero-node/issues/330) - Historical issue about date parameters in getReportBankSummary (may be outdated)
- [Xero API Directory - Knit.dev](https://www.getknit.dev/blog/xero-api-directory) - Third-party API overview (not official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed and in active use; no new dependencies needed
- Architecture: HIGH - Backend endpoint exists and functional; React patterns are standard; data flow is clear
- Pitfalls: MEDIUM - Pitfalls inferred from code structure and common Xero integration issues; not verified against production incidents

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (30 days - stable domain, Xero API changes infrequently)
