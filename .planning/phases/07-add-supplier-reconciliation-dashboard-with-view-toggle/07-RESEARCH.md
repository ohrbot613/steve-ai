# Phase 7: Add Supplier Reconciliation Dashboard with View Toggle - Research

**Researched:** 2026-02-17
**Domain:** React frontend component composition, dashboard view toggle, supplier reconciliation UI, CSS Modules / SCSS styling
**Confidence:** HIGH

## Summary

Phase 7 adds a new supplier reconciliation dashboard as a second view alongside the existing Dashboard page. The client finds the current dashboard (bank balance, unmatched count, invoices-to-pay, upload zone) too data-heavy. The new reconciliation-focused view becomes the default, with a toggle button in the Dashboard page to switch back to the "legacy" stats view.

The reconciliation dashboard is a pure frontend component built on mock data for now (no new backend endpoints in scope for this phase). It lives inside the existing `Dashboard.jsx` page, toggled by local state (or `localStorage` for persistence). The UI spec comes from `reconciliation-module-v6.jsx` (the CONTEXT.md prototype), with the dark theme and three-tab structure: Latest Batch, Needs Attention, Reconciled. The existing app stack (React 19, SCSS Modules, Tailwind co-installed but underused, Vite) handles everything — no new npm packages are required.

The key implementation challenge is isolation: the reconciliation view is a full-panel dark-theme component rendered inside a light-theme app. This must not leak styles or bleed global SCSS resets. The toggle mechanism should be simple — a single boolean state in `Dashboard.jsx` controlled by a visible button — and should persist across page refreshes using `localStorage`.

**Primary recommendation:** Add a `ReconciliationDashboard.jsx` component to `client/src/componentes/` (or a `client/src/pages/ReconDashboard.jsx`), driven by mock data matching the prototype's shape exactly, rendered conditionally inside `Dashboard.jsx` based on a toggled state that defaults to `true` (reconciliation is the default view). Wire it to real data in a later phase.

---

## User Constraints (from CONTEXT.md)

The CONTEXT.md for this phase contains the full implementation guide (the product brief), not a structured Decisions/Discretion/Deferred format. The relevant locked decisions come from prior phases:

### Locked Decisions (from prior phases)
- **05-01:** Prefer `xeroBalance` over `statementBalance` for bank balance (live authorized transactions are more accurate)
- **05-01:** Treat 401 as non-error state for Xero connection (user may not be connected)
- **05-01:** Filter by ACTIVE accounts in base currency only
- **05-01:** Format currency with no decimals to match original display style (`formatCurrency` from `currencyUtils.js`)
- **05-01:** Fetch balance once on mount, no auto-refresh

### This Phase: Scope Boundaries
- This phase is frontend-only for the reconciliation dashboard view. No new backend endpoints are required for the initial scaffold.
- The new reconciliation view should be the **default** view on `/dashboard` and `/`.
- The toggle button switches to the existing "Version 2.0 Dashboard" stats view.
- Mock data only — real API integration is a future phase.

### Deferred (out of scope for Phase 7)
- Real backend API endpoints for reconciliation data
- Statement upload and matching engine
- Xero invoice sync for reconciliation
- Email integration
- Payment module page
- The full prototype's email draft / payment suggestion flows (those are future phases)

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.0 | Component rendering | Already in codebase; `useState`, `useEffect` for toggle and mock data |
| SCSS Modules | (via sass ^1.97.1) | Scoped styling | Existing pattern; every page uses `*.module.scss` files |
| react-router-dom | ^7.11.0 | Routing (no change) | Already handles `/dashboard` and `/` routes; no new routes needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Tailwind CSS | 4.1.18 (co-installed) | Utility classes | Already configured via `postcss.config.mjs`; can use for the dark-theme reconciliation panel as an alternative to SCSS Modules |
| `formatCurrency` (internal) | n/a | Currency formatting | Already in `client/src/utils/currencyUtils.js`; use for all monetary values |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SCSS Module for reconciliation | Tailwind utility classes | Tailwind is already configured but barely used; prototype uses inline styles heavily; mixing approaches is fine since reconciliation component is isolated |
| `localStorage` toggle persistence | URL query param (`?view=recon`) | URL param is shareable; localStorage avoids URL clutter and is simpler since this is not a public-facing page |
| Single toggle in Dashboard.jsx | New route `/reconciliation` | New route is cleaner long-term but this phase scope says "toggle button"; new route can be done when backend APIs land |

**Installation:**
```bash
# No new packages required
# Everything needed is already in client/package.json
```

---

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
client/src/
├── componentes/
│   └── ReconciliationDashboard.jsx   # New: the reconciliation view component
├── scss/
│   └── ReconciliationDashboard.module.scss  # New: dark-theme styles
└── pages/
    └── Dashboard.jsx                 # Modified: add toggle state and conditional render
```

No new routes. No new backend files.

### Pattern 1: View Toggle in Dashboard.jsx

**What:** A single boolean state (`showRecon`) in `Dashboard.jsx`. When `true`, render `<ReconciliationDashboard />`. When `false`, render the existing stats grid. Default to `true` (reconciliation is the default). Persist in `localStorage`.

**When to use:** Any time one page needs two display modes that are mutually exclusive and don't warrant a separate URL.

**Example:**
```jsx
// client/src/pages/Dashboard.jsx
const [showRecon, setShowRecon] = useState(() => {
    const saved = localStorage.getItem('dashboardView');
    // Default to recon view ('recon') unless user explicitly chose 'stats'
    return saved !== 'stats';
});

function toggleView() {
    const next = !showRecon;
    setShowRecon(next);
    localStorage.setItem('dashboardView', next ? 'recon' : 'stats');
}

return (
    <div>
        <Top />
        <div className={pageStyle.main}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.6rem' }}>
                <button onClick={toggleView}>
                    {showRecon ? 'Switch to Stats View' : 'Switch to Reconciliation View'}
                </button>
            </div>
            {showRecon ? <ReconciliationDashboard /> : <ExistingStatsView />}
        </div>
    </div>
);
```

The "existing stats view" should be extracted from the current `Dashboard.jsx` body into a sub-component or JSX fragment, keeping the file manageable.

### Pattern 2: ReconciliationDashboard Component with Mock Data

**What:** Self-contained component that generates mock suppliers on mount (matching the prototype's `generateSuppliers()` shape), renders three tabs, and handles all interactions locally. No props required initially.

**When to use:** Phase 7 (mock data only). Future phases will pass real data via props or a hook.

**Structure:**
```jsx
// client/src/componentes/ReconciliationDashboard.jsx
import { useState, useMemo } from 'react';
import styles from '../scss/ReconciliationDashboard.module.scss';

const MOCK_SUPPLIERS = [ /* from prototype's generateSuppliers() */ ];

export default function ReconciliationDashboard() {
    const [activeTab, setActiveTab] = useState('latest'); // 'latest' | 'attention' | 'reconciled'
    const [expandedId, setExpandedId] = useState(null);

    const displayedSuppliers = useMemo(() => {
        // Apply tab filters and sorts exactly as prototype specifies
    }, [activeTab]);

    return (
        <div className={styles.container}>
            {/* Tab bar */}
            {/* Supplier table */}
            {/* Expanded row (conditional) */}
        </div>
    );
}
```

### Pattern 3: Dark Theme Isolation

**What:** The reconciliation view uses `#090A0E` background with a completely different color palette from the light app. The SCSS Module `.container` should set `background-color`, `color`, and `font-family` to establish a new baseline for everything inside.

**When to use:** Any time a dark-themed component renders inside a light-themed shell.

**Example:**
```scss
// ReconciliationDashboard.module.scss
.container {
    background-color: #090A0E;
    color: #F1F5F9;
    font-family: 'DM Sans', system-ui, sans-serif;
    border-radius: 1.2rem;
    padding: 2.4rem;
    min-height: 60vh;
}
```

Google Fonts are needed: `DM Sans` and `JetBrains Mono`. Add them to `client/index.html` via `<link>` tag (the app's HTML entry point). This is the correct place since the app is a single SPA.

### Pattern 4: Three-Tab Filtering with useMemo

**What:** All three tabs operate on the same supplier array — the tab just controls which filter/sort function to apply. Use `useMemo` keyed on `[suppliers, activeTab]` to avoid re-sorting on every render.

**Sort/filter logic (from prototype spec):**

| Tab | Filter | Sort |
|-----|--------|------|
| `latest` | `batch === 'latest'` | Issues first (missingCount + mismatchCount desc), reconciled last |
| `attention` | `status !== 'reconciled'` (all batches) | `action_needed` > stale (7+ days) > `contacted` > `waiting` |
| `reconciled` | `status === 'reconciled'` | `reconciledDaysAgo` ascending (most recent first) |

### Anti-Patterns to Avoid

- **Embedding reconciliation styles in `Pages.module.scss`:** The existing Pages module is shared across all pages. Adding dark-theme rules there will break other pages. Use a dedicated `ReconciliationDashboard.module.scss`.
- **Using global CSS for the dark theme:** The `main.scss` sets `body { background-color: rgb(248 250 252) }`. Do not change this. Set background only on the component's root element.
- **Copying the entire 900-line prototype into one file:** The prototype is a monolith for demo purposes. Break into at minimum: tab bar, supplier row, expanded problem view, expanded reconciled view, status badge.
- **Fetching real data in Phase 7:** Do not add API calls. This phase is mock-data only. The data shape should match the future API shape so wiring is a clean swap in Phase 8+.
- **Re-rendering on every keystroke:** The supplier list and tab filters should be memoized. The prototype's data set is small (10-20 suppliers) so performance is not critical, but the pattern matters for when real data loads.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Currency formatting | Custom `toFixed` logic | `formatCurrency` from `currencyUtils.js` | Already handles symbols, GB locale, no decimals — matches existing dashboard exactly |
| Date formatting | `new Date().toLocaleDateString()` ad hoc | ISO date strings + `toLocaleDateString('en-GB')` consistently | Consistency with existing pages (SingleStatement, SupplierLogsV2 both use locale formatting) |
| Toggle persistence | Custom state management | `localStorage.getItem/setItem` | Already used in `App.jsx` for sidebar state (`askSteveOpen`); same pattern |
| Animation | Manual `setTimeout` + class toggling | CSS `animation` + SCSS keyframes | Already in `Pages.module.scss` (`skeletonShimmer`, `spin`); add `slideDown`, `fadeIn`, `pulse` to the new module |

**Key insight:** This codebase uses a thin, consistent pattern: `useState` for UI state, `localStorage` for persistence, SCSS Modules for scoped styles, `fetch` with `credentials: 'include'` for API calls. The reconciliation dashboard should not introduce any new state management library (no Zustand, no Redux, no React Query for Phase 7).

---

## Common Pitfalls

### Pitfall 1: The Existing Dashboard Route Returns a JSX Wall

**What goes wrong:** `Dashboard.jsx` is a 424-line file. Adding the toggle and a new 200+ line view component inline makes it unmanageable and hard to review.

**Why it happens:** Developers reach for the "just add it here" approach when modifying existing files.

**How to avoid:** Extract the existing stats content (the 4 stat cards + upload zone + links) into a private function or a separate component. `Dashboard.jsx` becomes a thin shell that renders either `<ReconciliationDashboard />` or `<DashboardStats />` based on toggle state.

**Warning signs:** Dashboard.jsx exceeds 600 lines after the change.

### Pitfall 2: Dark Theme Bleeds into Light Theme Shell

**What goes wrong:** The `#090A0E` background applied to the reconciliation container appears as a box inside the light gray `rgb(248 250 252)` app background, creating a visible seam.

**Why it happens:** The `pageStyle.main` container has `padding: 4rem` and a max-width. The reconciliation component renders inside it.

**How to avoid:** Two options:
1. **Contained approach:** Accept the box appearance. Give the `.container` a `border-radius: 1.2rem` and let it be a panel within the light app — this is actually reasonable for a CFO tool with a distinct mode.
2. **Full-bleed approach:** Have the reconciliation view render outside the `pageStyle.main` constraint — i.e., render it directly inside `<div>` after `<Top />` without the `className={pageStyle.main}` wrapper. This matches the prototype's full-width dark appearance.

The full-bleed approach is recommended: the existing stats view stays inside `pageStyle.main`, but the reconciliation view gets its own wrapper that goes edge-to-edge (matching the prototype). This means the toggle also swaps the outer wrapper, not just the inner content.

**Warning signs:** The reconciliation panel has a gray border or margin artifact around it.

### Pitfall 3: Mock Data Shape Diverges from Future API Shape

**What goes wrong:** Mock data uses `camelCase` field names that don't match the future API's MongoDB field names (e.g., `missingCount` vs `missing_count`), requiring a rewrite when real data lands.

**Why it happens:** Mock data is written for convenience without reference to the planned data model.

**How to avoid:** Use the prototype's data model exactly as specified in CONTEXT.md. The future API will return this shape. Fields: `name`, `supplierTotal`, `xeroTotal`, `difference`, `totalInvoices`, `missingCount`, `mismatchCount`, `status`, `batch`, `daysSinceContact`, `reconciledDate`, `reconciledDaysAgo`. Nested `invoices[]` with `id`, `date`, `dueDate`, `supplierAmount`, `xeroAmount`, `type`, `isOverdue`, `priority`.

**Warning signs:** Mock data uses abbreviated names, removes nullable fields, or adds fields not in the spec.

### Pitfall 4: Google Fonts Not Loading in Production Build

**What goes wrong:** The `DM Sans` and `JetBrains Mono` fonts load fine in `npm run dev` (via `<link>` in `index.html`) but fail to load after `npm run build` + deploy because of CSP headers.

**Why it happens:** The production `helmet` CSP in `app.js` already includes `https://fonts.googleapis.com` and `https://fonts.gstatic.com` in `styleSrc` and `fontSrc` respectively. This is already configured correctly.

**How to avoid:** Verify after `npm run build` that the font `<link>` in `index.html` matches the CSP allowlist. The existing allowlist already covers Google Fonts:
```javascript
// app.js — already present
styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
fontSrc: ["'self'", "https://fonts.gstatic.com"],
```

**Warning signs:** Console shows `Refused to load stylesheet from 'https://fonts.googleapis.com'` in production.

### Pitfall 5: `useMemo` Dependency Array Missing Tab State

**What goes wrong:** The filtered supplier list doesn't re-filter when the active tab changes because the tab state is missing from the `useMemo` dependency array.

**Why it happens:** Forgetting to include reactive values that the memo depends on.

**How to avoid:**
```jsx
const displayedSuppliers = useMemo(() => {
    return filterAndSort(suppliers, activeTab);
}, [suppliers, activeTab]); // Both deps required
```

---

## Code Examples

### Toggle Button Pattern (matches existing `Top.jsx` button style)
```jsx
// Source: existing codebase pattern (Top.jsx report error button style)
<button
    type="button"
    style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.6rem 1.4rem',
        borderRadius: '0.6rem',
        border: '1px solid #e5e7eb',
        backgroundColor: '#fff',
        fontSize: '1.4rem',
        fontWeight: 500,
        color: '#374151',
        cursor: 'pointer',
    }}
    onClick={toggleView}
>
    {showRecon ? 'Stats view' : 'Reconciliation view'}
</button>
```

### LocalStorage Persistence Pattern (matches existing App.jsx pattern)
```jsx
// Source: client/src/App.jsx — same pattern used for askSteveOpen
const [showRecon, setShowRecon] = useState(() => {
    const saved = localStorage.getItem('dashboardView');
    return saved !== 'stats'; // Default: reconciliation view
});

function toggleView() {
    const next = !showRecon;
    setShowRecon(next);
    localStorage.setItem('dashboardView', next ? 'recon' : 'stats');
}
```

### Status Badge Component Pattern
```jsx
// Source: prototype spec + existing Pages.module.scss badge classes
const STATUS_CONFIG = {
    action_needed: { label: 'Action Needed', color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' },
    contacted:     { label: 'Contacted',     color: '#4ADE80', bg: 'rgba(74,222,128,0.15)' },
    waiting:       { label: 'Awaiting Reply', color: '#FBBF24', bg: 'rgba(251,191,36,0.15)' },
    reconciled:    { label: 'Reconciled',    color: '#4ADE80', bg: 'rgba(74,222,128,0.15)' },
};

function StatusBadge({ status, daysSinceContact }) {
    const isStale = status === 'waiting' && daysSinceContact >= 7;
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.action_needed;
    const color = isStale ? '#FB923C' : config.color;
    const bg = isStale ? 'rgba(251,146,60,0.15)' : config.bg;
    return (
        <span style={{ color, background: bg, padding: '0.3rem 0.8rem', borderRadius: '99px', fontSize: '1.2rem', fontWeight: 600 }}>
            {isStale ? `Stale (${daysSinceContact}d)` : config.label}
        </span>
    );
}
```

### Tab Filter/Sort Logic (Latest Batch tab)
```javascript
// Source: prototype spec, sorting functions
function sortLatest(suppliers) {
    return [...suppliers]
        .filter(s => s.batch === 'latest')
        .sort((a, b) => {
            // Reconciled go last
            if (a.status === 'reconciled' && b.status !== 'reconciled') return 1;
            if (b.status === 'reconciled' && a.status !== 'reconciled') return -1;
            // Problems first: more issues = higher
            const aIssues = (a.missingCount || 0) + (a.mismatchCount || 0);
            const bIssues = (b.missingCount || 0) + (b.mismatchCount || 0);
            return bIssues - aIssues;
        });
}

function sortAttention(suppliers) {
    const statusOrder = { action_needed: 0, waiting_stale: 1, contacted: 2, waiting: 3 };
    return [...suppliers]
        .filter(s => s.status !== 'reconciled')
        .sort((a, b) => {
            const aKey = a.status === 'waiting' && (a.daysSinceContact || 0) >= 7 ? 'waiting_stale' : a.status;
            const bKey = b.status === 'waiting' && (b.daysSinceContact || 0) >= 7 ? 'waiting_stale' : b.status;
            return (statusOrder[aKey] ?? 99) - (statusOrder[bKey] ?? 99);
        });
}

function sortReconciled(suppliers) {
    return [...suppliers]
        .filter(s => s.status === 'reconciled')
        .sort((a, b) => (a.reconciledDaysAgo || 0) - (b.reconciledDaysAgo || 0));
}
```

### Google Fonts Link (add to `client/index.html`)
```html
<!-- Add inside <head> of client/index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

### CSS Animations (in ReconciliationDashboard.module.scss)
```scss
@keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
}

@keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}

@keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
}

.expandedRow {
    animation: slideDown 0.2s ease-out;
}

.supplierRow {
    animation: fadeIn 0.25s ease-out both;
}

.pulseDot {
    animation: pulse 2s infinite;
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EJS server-rendered views | React SPA (Vite build, served from `views/index.html`) | Already done | All new views are React components; no EJS needed |
| Global CSS only | SCSS Modules per page | Already done | New component gets its own `.module.scss` |
| Hardcoded bank balance | `useXeroBalance` hook fetching live data | Phase 5 | Available to use in reconciliation header if needed |
| Single dashboard view | Two views with toggle | Phase 7 (this phase) | New UX for CFO tool |

**Deprecated/outdated:**
- EJS view templates: already removed from server, `res.render()` is gone for page views
- Direct Xero API calls without `xeroClient` middleware: use existing middleware pattern

---

## Open Questions

1. **Where exactly does the toggle button live?**
   - What we know: Phase description says "a toggle button to switch between views" and the reconciliation view is the default.
   - What's unclear: Should the toggle be inside `<Top />` (global header) or inside the Dashboard page body? Putting it in `<Top />` would require passing callback props or lifting state to App.jsx. Putting it inside Dashboard page is simpler.
   - Recommendation: Put the toggle button at the top of the Dashboard page content area (inside `pageStyle.main`, above the view), not in `<Top />`. This avoids prop-drilling and keeps it in-scope.

2. **Should the reconciliation view be full-bleed or contained?**
   - What we know: The prototype is full-screen dark. The existing `pageStyle.main` has `padding: 4rem` and `max-width: 160rem`.
   - What's unclear: The client's visual preference for how the dark panel fits in the existing layout.
   - Recommendation: Full-bleed — render the reconciliation view without the `pageStyle.main` wrapper (or set `padding: 0` on the wrapper when in recon mode). This matches the prototype's intent.

3. **How much of the prototype interaction should Phase 7 implement?**
   - What we know: "This phase adds the dashboard." The prototype includes expanded rows, email drafts, payment suggestions — all future phases.
   - What's unclear: The boundary between "dashboard with view toggle" and "scaffold for future interactions."
   - Recommendation: Phase 7 implements: tab switching, supplier table rows (clickable), expanded row structure (skeleton showing invoice table placeholder), status badges, and the toggle. Email draft and payment suggestion generation are explicitly deferred.

4. **Should `ReconciliationDashboard` accept a `suppliers` prop or own its own data?**
   - What we know: Phase 7 is mock data only.
   - What's unclear: The prop signature for when real data replaces mock.
   - Recommendation: Design the component to accept an optional `suppliers` prop that defaults to `MOCK_SUPPLIERS`. This way Phase 8 can pass real data without restructuring the component: `<ReconciliationDashboard suppliers={realData} loading={loading} />`.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `client/src/pages/Dashboard.jsx` — existing view structure, stats grid, upload zone (424 lines, fully read)
- Direct codebase inspection: `client/src/App.jsx` — routing, localStorage persistence pattern
- Direct codebase inspection: `client/src/componentes/Top.jsx` — nav structure, button styles, balance display
- Direct codebase inspection: `client/src/hooks/useXeroBalance.js` — balance fetch hook (Phase 5 output)
- Direct codebase inspection: `client/src/scss/Pages.module.scss` — existing style patterns
- Direct codebase inspection: `client/src/scss/Top.module.scss` — nav/header styles
- Direct codebase inspection: `client/src/utils/currencyUtils.js` — `formatCurrency` function
- Direct codebase inspection: `client/package.json` — React 19.2, SCSS, Tailwind 4.1, Vite 7.2 (all confirmed)
- Direct codebase inspection: `app.js` — CSP header config (Google Fonts already allowlisted)
- CONTEXT.md (07-CONTEXT.md) — prototype data model, UI spec, color palette, animation specs

### Secondary (MEDIUM confidence)
- Phase 5 and 6 RESEARCH.md and PLAN.md — established prior decisions (xeroBalance preference, 401 handling, currency format)
- `client/src/scss/main.scss` — global SCSS baseline (`body` background, font-family, `html { font-size: 62.5% }`)

### Tertiary (LOW confidence)
- None. All critical claims are backed by direct codebase inspection.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — confirmed from `client/package.json` and existing component patterns
- Architecture: HIGH — based on direct reading of all affected files; no new libraries or frameworks
- Pitfalls: HIGH — identified from actual code patterns in the codebase (existing `localStorage` usage, CSP headers, SCSS Module isolation)
- Mock data shape: HIGH — specified verbatim in CONTEXT.md prototype spec

**Research date:** 2026-02-17
**Valid until:** 2026-03-17 (stable React/SCSS stack; no fast-moving dependencies in scope)
