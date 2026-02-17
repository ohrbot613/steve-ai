# Phase 6: Fix Xero statement balance mismatch with dashboard values - Research

**Researched:** 2026-02-10
**Domain:** PDF statement generation, supplier invoice reconciliation, balance calculation consistency
**Confidence:** MEDIUM

## Summary

This phase addresses a balance mismatch between generated PDF supplier statements and the dashboard display. Unlike Phase 5 (which fixed bank balance display), Phase 6 is about ensuring supplier statement PDFs show consistent balance/invoice data with what users see on the dashboard.

The system generates PDF statements for suppliers containing invoice data extracted from uploaded statements. These PDFs are stored in the database and made available for download. The mismatch likely occurs because:
1. PDF generation calculates balances differently than dashboard components
2. Different data sources or calculation timing between PDF generation and dashboard display
3. Currency conversion, filtering, or aggregation logic differs between the two contexts

Phase 5 established that the dashboard now uses `xeroBalance` (live authorized transactions) over `statementBalance` (imported statement data) for bank accounts. This phase needs to determine if supplier statement PDFs use a different balance calculation method that causes inconsistency with dashboard views.

**Primary recommendation:** Audit the balance calculation logic in both PDF generation and dashboard components (AllStatements, SingleStatement, SupplierLogs). Identify where calculations diverge. Standardize on a single source of truth for supplier invoice balances, ensure consistent filtering (ACTIVE status, currency matching), and use the same data transformation logic in both contexts.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| xero-node | 13.4.0 | Xero API SDK | Already in use; provides accounting data for statement generation |
| React | ^18.x | Frontend UI | Dashboard components display statement data; already in codebase |
| Mongoose | ^8.9.3 | MongoDB ODM | Statement and Invoice schemas; data persistence layer |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pdf-lib or puppeteer | TBD (not yet identified) | PDF generation | Statement PDF creation; need to identify which library is used |
| currency-symbol-map | ^5.1.0 | Currency symbols | Already installed; standardize currency display across PDF and dashboard |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fix calculation in both places | Refactor to shared utility | Shared utility is better but requires more refactoring; may be future phase |
| PDF generation from scratch | Use Xero's native statement PDFs | Xero doesn't provide supplier statement PDFs with AI-extracted data; custom PDF needed |
| Manual balance review | Automated validation tests | Tests catch regressions; manual review scales poorly |

**Installation:**
```bash
# No new packages expected - use existing dependencies
# If PDF generation library is missing, install based on current implementation
npm install  # Verify all dependencies are installed
```

## Architecture Patterns

### Recommended Project Structure
```
PDF automation/
├── 2.0/
│   ├── controllers/
│   │   └── invoiceController.js     # Invoice file upload, statement creation
│   ├── modals/
│   │   ├── statementModal.js        # Statement schema (2.0)
│   │   └── invoiceModal.js          # Invoice schema
├── client/src/
│   ├── pages/
│   │   ├── AllStatements.jsx        # Displays statement list with counts
│   │   ├── SingleStatement.jsx      # Displays individual statement invoices
│   │   └── SupplierLogs.jsx         # Supplier-specific statement view
│   └── utils/
│       ├── currencyUtils.js         # Currency formatting (already exists)
│       └── balanceCalculation.js    # PROPOSED: Shared balance logic
└── modals/
    └── statementsModal.js           # Old statement schema (legacy)
```

### Pattern 1: Shared Balance Calculation Utility
**What:** Centralize balance calculation logic to ensure consistency across PDF generation and dashboard
**When to use:** Any time statement balance, invoice totals, or reconciliation status is calculated
**Example:**
```javascript
// utils/balanceCalculation.js
export function calculateStatementBalance(invoices, options = {}) {
  const {
    currency = null,           // Filter by currency
    includeUnreconciled = true, // Include unreconciled invoices
    useXeroAmount = true        // Prefer xeroAmount over vendorAmount
  } = options;

  return invoices
    .filter(inv => !currency || inv.currency === currency)
    .filter(inv => includeUnreconciled || inv.status === 'reconciled')
    .reduce((sum, inv) => {
      const amount = useXeroAmount
        ? (inv.xeroAmount ?? inv.vendorAmount ?? 0)
        : (inv.vendorAmount ?? inv.xeroAmount ?? 0);
      return sum + amount;
    }, 0);
}

export function getReconciliationCounts(invoices) {
  const reconciled = invoices.filter(inv => inv.status === 'Reconciled').length;
  const unreconciled = invoices.filter(inv => inv.status !== 'Reconciled').length;
  const total = invoices.length;

  return { reconciled, unreconciled, total };
}
```

### Pattern 2: Data Consistency Validation
**What:** Add validation checks before PDF generation to ensure data matches dashboard state
**When to use:** During statement creation, PDF generation, or when displaying dashboard data
**Example:**
```javascript
// Validate that PDF data matches dashboard calculation before generation
async function validateStatementData(statementId) {
  const invoices = await Invoice.find({ statementId, isDeleted: false });

  const dashboardBalance = calculateStatementBalance(invoices, {
    useXeroAmount: true,
    includeUnreconciled: true
  });

  const pdfData = await generatePDFData(statementId);

  if (Math.abs(dashboardBalance - pdfData.totalBalance) > 0.01) {
    console.error('[ValidationError] Balance mismatch:', {
      dashboard: dashboardBalance,
      pdf: pdfData.totalBalance,
      difference: Math.abs(dashboardBalance - pdfData.totalBalance)
    });
    throw new Error('Statement balance mismatch detected');
  }

  return true;
}
```

### Pattern 3: Consistent Currency Handling
**What:** Use same currency filtering and formatting logic in PDF and dashboard
**When to use:** Displaying monetary amounts in any context
**Example:**
```javascript
// Use consistent currency utilities
import { getCurrencySymbol } from '../utils/currencyUtils';

function formatCurrency(amount, currency = 'USD') {
  if (amount === null || amount === undefined) return '—';
  const currencySymbol = getCurrencySymbol(currency);
  return `${currencySymbol}${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

// Filter to base currency only (consistent with Phase 5 decision)
function filterToBaseCurrency(invoices, baseCurrency) {
  return invoices.filter(inv =>
    (inv.vendorCurrency || inv.xeroCurrency) === baseCurrency
  );
}
```

### Anti-Patterns to Avoid
- **Duplicating balance logic:** Separate calculations in PDF generation and dashboard lead to drift
- **Inconsistent data filtering:** Different filters (status, currency, date range) cause mismatches
- **Ignoring calculation timing:** PDF generated from stale data while dashboard shows live updates
- **Hardcoding currency assumptions:** Assuming all invoices are in one currency without validation
- **No validation between PDF and dashboard:** Generate PDFs without checking they match displayed data

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Balance calculation | Multiple ad-hoc calculations | Shared utility function | Single source of truth prevents drift; easier to debug and test |
| Currency conversion | Manual exchange rate lookup | Filter to base currency OR use Xero's multi-currency support | Exchange rates change; Xero handles conversions; filtering is simpler |
| PDF generation validation | Manual QA review | Automated comparison tests | Tests catch regressions early; manual review doesn't scale |
| Invoice reconciliation status | Custom status logic | Use Xero's invoice status + amount matching | Xero provides authoritative status; custom logic may diverge from accounting rules |

**Key insight:** The mismatch likely stems from duplicated calculation logic. Phase 5 established patterns for preferring `xeroBalance` over `statementBalance` and filtering by ACTIVE status and base currency. These same patterns must apply to statement PDF generation to maintain consistency.

## Common Pitfalls

### Pitfall 1: Using different balance sources in PDF vs dashboard
**What goes wrong:** PDF uses `vendorAmount` while dashboard uses `xeroAmount`, causing different totals
**Why it happens:** PDF generation code may have been written before Phase 5 decisions; uses original supplier statement amounts instead of Xero reconciled amounts
**How to avoid:** Audit both code paths and standardize on the same field precedence (prefer `xeroAmount` or `xeroBalance` per Phase 5)
**Warning signs:** Users report "PDF shows different number than screen"; balance differs by exact amount of a few invoices

### Pitfall 2: Different filtering logic (status, currency, deleted)
**What goes wrong:** Dashboard filters out deleted or inactive invoices; PDF includes all invoices
**Why it happens:** Separate query logic in PDF generation and dashboard API endpoints
**How to avoid:** Use same MongoDB filter in both: `{ statementId: X, isDeleted: false, status: { $ne: 'DELETED' } }`
**Warning signs:** Invoice counts differ; PDF shows invoices that don't appear on dashboard

### Pitfall 3: Stale data in PDF generation
**What goes wrong:** PDF generated from cached or old data; dashboard displays live updates from Xero
**Why it happens:** PDF created at statement upload time; dashboard fetches fresh Xero data on view
**How to avoid:** Either regenerate PDFs on-demand with fresh data OR clearly label PDF generation timestamp; consider making PDFs ephemeral (generate on download)
**Warning signs:** Recently reconciled invoices show as unreconciled in PDF; user says "I just paid this invoice"

### Pitfall 4: Currency mixing without conversion
**What goes wrong:** PDF sums GBP and USD invoices without conversion, showing meaningless total
**Why it happens:** No currency validation before aggregation; assumes single-currency statements
**How to avoid:** Follow Phase 5 pattern: filter to `baseCurrency` only, OR display per-currency subtotals, OR clearly label as "mixed currency"
**Warning signs:** Multi-currency supplier statements show nonsensical totals; user confusion about exchange rates

### Pitfall 5: Rounding differences in calculations
**What goes wrong:** Dashboard rounds to whole numbers; PDF shows 2 decimal places; creates apparent mismatch
**Why it happens:** Different display formatting; underlying values may match but appear different
**How to avoid:** Use same rounding/formatting rules in both contexts; consider rounding at calculation time (not just display)
**Warning signs:** Balances differ by small amounts (e.g., £0.50); user reports "close but not exact match"

## Code Examples

Verified patterns from codebase analysis:

### Current Dashboard Balance Display
```javascript
// client/src/pages/AllStatements.jsx (lines 40-62)
function transformLogs(logs) {
  return logs.map((log) => {
    // Use reconciled and unreconciled counts directly from backend
    const reconciled = log.reconciled || 0;
    const unreconciled = log.unreconciled || 0;

    // Determine status based on counts
    let status = 'pending';
    if (log.status === 'completed' && unreconciled === 0) {
      status = 'reconciled';
    } else if (log.status === 'completed' && unreconciled > 0) {
      status = 'partial';
    } else if (log.status === 'failed') {
      status = 'unreconciled';
    }

    return {
      reconciled: Math.max(0, reconciled),
      unreconciled: Math.max(0, unreconciled),
      total: log.total || 0,
      status
    };
  });
}
```

### Current Invoice Balance Calculation (SingleStatement)
```javascript
// client/src/pages/SingleStatement.jsx (lines 316-319)
invoices.map((invoice) => {
  const supplierAmount = invoice.vendorAmount || 0;
  const systemAmount = invoice.xeroAmount || 0;
  const difference = supplierAmount - systemAmount;
  const currency = invoice.vendorCurrency || invoice.xeroCurrency || 'USD';
  // ... display logic
});
```

### Phase 5 Bank Balance Pattern (to apply here)
```javascript
// client/src/hooks/useXeroBalance.js (lines 47-58)
// This pattern should be adapted for statement balances:
const total = data.accounts
  .filter(acc =>
    acc.status === 'ACTIVE' &&
    acc.currencyCode === data.baseCurrency
  )
  .reduce((sum, acc) => {
    // Prefer xeroBalance (live), fallback to statementBalance
    const accountBalance = acc.xeroBalance != null
      ? acc.xeroBalance
      : acc.statementBalance;
    return sum + (accountBalance || 0);
  }, 0);
```

### Proposed Shared Utility (to create)
```javascript
// utils/statementBalanceUtils.js (NEW FILE)
/**
 * Calculate statement balance using standardized logic.
 * Matches Phase 5 patterns: prefer xeroAmount, filter ACTIVE, base currency only.
 */
export function calculateStatementBalance(invoices, options = {}) {
  const {
    baseCurrency = null,
    includeDeleted = false,
    preferXeroAmount = true  // Per Phase 5: xeroBalance more accurate
  } = options;

  return invoices
    .filter(inv => includeDeleted || !inv.isDeleted)
    .filter(inv => !baseCurrency ||
      (inv.vendorCurrency || inv.xeroCurrency) === baseCurrency)
    .reduce((sum, inv) => {
      const amount = preferXeroAmount
        ? (inv.xeroAmount ?? inv.vendorAmount ?? 0)
        : (inv.vendorAmount ?? inv.xeroAmount ?? 0);
      return sum + amount;
    }, 0);
}

/**
 * Get reconciliation counts matching dashboard display logic.
 */
export function getReconciliationStatus(invoices) {
  const reconciled = invoices.filter(inv =>
    inv.xeroDate != null &&
    Math.abs((inv.vendorAmount || 0) - (inv.xeroAmount || 0)) <= 0.01
  ).length;

  const unreconciled = invoices.length - reconciled;

  return {
    reconciled,
    unreconciled,
    total: invoices.length,
    status: unreconciled === 0 ? 'reconciled' :
            reconciled > 0 ? 'partial' : 'unreconciled'
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Separate calculations for PDF and dashboard | Need to identify and standardize | Phase 6 (this phase) | Eliminates balance mismatches between views |
| Use vendorAmount for statements | Prefer xeroAmount per Phase 5 | Phase 5 decisions | Consistent with bank balance pattern established |
| No validation between PDF and dashboard | Add validation layer | Phase 6 (proposed) | Catch mismatches before user sees them |

**Deprecated/outdated:**
- Two separate statement schemas (statementsModal.js and statementModal.js) suggest legacy migration; may have different calculation logic
- Hardcoded balance display removed in Phase 5 for bank accounts; same pattern should apply to supplier statements

## Open Questions

1. **Where are statement PDFs actually generated?**
   - What we know: PDFs stored in database, downloadable via `/file/:id` route; file paths in statement records
   - What's unclear: Which controller/function generates the PDF? Is it at upload time or on-demand?
   - Recommendation: Search for PDF generation library (puppeteer, pdf-lib, jsPDF) usage; locate generation logic; audit its balance calculations

2. **What balance value should statements show?**
   - What we know: Phase 5 prefers xeroBalance (live) over statementBalance for bank accounts; SingleStatement shows both vendorAmount and xeroAmount
   - What's unclear: Should statement PDF show supplier's original amount, Xero's reconciled amount, or both with variance?
   - Recommendation: Show both with clear labeling ("Supplier Statement: £X" vs "Reconciled in Xero: £Y" with difference); follow accounting best practice of showing both for audit trail

3. **Are PDFs static snapshots or regenerated on demand?**
   - What we know: Statement files stored in database; download route serves existing files
   - What's unclear: Are PDFs generated once at upload time (static) or regenerated with fresh data on download?
   - Recommendation: Static PDFs are simpler but can become stale; on-demand generation ensures fresh data but is slower; consider hybrid: cache PDFs, invalidate cache when invoice data changes

4. **Should reconciliation counts in PDF match dashboard exactly?**
   - What we know: Dashboard shows reconciled/unreconciled/total counts; calculated from invoice status
   - What's unclear: Are these counts embedded in PDF at generation time or calculated live?
   - Recommendation: If PDF is static snapshot, it should show counts "as of [date]"; if dynamic, regenerate with current counts; consistency matters most

5. **How to handle multi-currency statements?**
   - What we know: Phase 5 filters bank accounts to baseCurrency only; suppliers may have invoices in multiple currencies
   - What's unclear: Should statement PDFs filter to base currency or show multi-currency breakdown?
   - Recommendation: Match dashboard behavior: filter to base currency for summaries, OR provide per-currency subtotals with clear labels; never mix currencies in single total

## Sources

### Primary (HIGH confidence)
- Local codebase analysis:
  - `/client/src/pages/AllStatements.jsx` (dashboard statement display logic)
  - `/client/src/pages/SingleStatement.jsx` (individual statement invoice display)
  - `/2.0/modals/statementModal.js` (statement schema - 2.0 version)
  - `/modals/statementsModal.js` (legacy statement schema)
  - `/2.0/modals/invoiceModal.js` (invoice schema with amount fields)
  - `/client/src/hooks/useXeroBalance.js` (Phase 5 balance calculation pattern)
  - `/controllers/ViewController.js` (file download route)
- Phase 5 decisions (from 05-01-PLAN.md):
  - Prefer xeroBalance over statementBalance (live authorized transactions more accurate)
  - Treat 401 as non-error state for Xero connection
  - Filter by ACTIVE accounts in base currency only
  - Format currency with no decimals to match original display style

### Secondary (MEDIUM confidence)
- [Why Your Xero Bank Reconciliation Doesn't Match Your Bank Statement](https://www.loveyourbooks.com.au/resources/xero-bank-reconciliation-not-matching) - Common reconciliation mismatch causes
- [Dashboard Statement Balance doesn't match Reconciliation Report](https://tv.xero.com/detail/video/5127745841001/) - Xero official video on balance differences
- [Xero Central: Why are the Statement Balance and Balance in Xero different](https://central.xero.com/s/article/Why-are-the-statement-balance-and-balance-in-Xero-different) - Official Xero documentation on balance types
- [Supplier Statement Matching Software for Xero](https://statementzen.com/supplier-statement-matching-software-for-xero-accuracy-speed-and-supplier-trust/) - Industry approach to statement reconciliation
- [Supplier Statement Reconciliation](https://www.businessaccountingbasics.co.uk/supplier-statement/) - Accounting basics for statement reconciliation
- [Xero: Messy supplier account reconciliations](https://caseron.co.uk/xero-messy-supplier-account-reconciliations/) - Common reconciliation challenges

### Tertiary (LOW confidence)
- [Bills - AI reconciliation of supplier statements](https://productideas.xero.com/forums/967139-purchase-orders-bills-inventory/suggestions/47511881-bills-ai-reconciliation-of-supplier-statements) - Feature request (not implemented); shows demand for automated matching
- [Contacts - Supplier Statement "Detailed Ledger"](https://productideas.xero.com/forums/967127-practice-tools/suggestions/50612198-contacts-supplier-statement-detailed-ledger-r) - Feature request for running balance statements

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - Core libraries identified, but PDF generation library not yet located in codebase search
- Architecture: MEDIUM - Dashboard code analyzed, but PDF generation logic not yet found; need to locate PDF creation code
- Pitfalls: MEDIUM - Inferred from common reconciliation issues and Phase 5 patterns; not verified against actual bug reports

**Research date:** 2026-02-10
**Valid until:** 2026-03-10 (30 days - domain is stable, but Phase 5 decisions are recent and may evolve)
