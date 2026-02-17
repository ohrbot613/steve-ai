# Supplier Reconciliation Module — Implementation Guide

**For:** Engineering team
**From:** Product
**Date:** February 2025
**Prototype:** `reconciliation-module-v6.jsx` (attached)

---

## What You're Building

A single-screen CFO tool with two modules: **Reconciliation** (compare supplier statements vs Xero, resolve discrepancies) and **Payment** (manage payments post-reconciliation). This guide covers the Reconciliation module — the prototype is fully interactive and contains all the UI logic, data models, and interaction patterns you need.

The prototype is a single React artifact with mock data. Your job is to turn it into a production app with real data, real APIs, and real email/payment integrations.

---

## Getting Started — Use Claude Artifact Runner

The prototype is a Claude Artifact (a self-contained `.jsx` file). The fastest way to get it running locally and scaffolded into a real project is **claude-artifact-runner**:

**Repository:** [github.com/claudio-silva/claude-artifact-runner](https://github.com/claudio-silva/claude-artifact-runner)

### Why This Tool

- Takes our `.jsx` prototype and instantly creates a full **React + TypeScript + Vite + Tailwind + shadcn/ui** project — the exact stack we want
- Pre-includes all libraries the prototype uses (React 18, Tailwind, Lucide icons, Recharts, shadcn/ui)
- Supports file-based routing out of the box, so when we add the Payment module as a second page, it just works
- Zero config — no manual Vite/TypeScript/Tailwind setup

### Setup Steps

```bash
# 1. Save the prototype file as reconciliation.jsx

# 2. Create a full editable project from it
npx run-claude-artifact create reconciliation.jsx --project-dir foundry-recon

# 3. The project is now at ./foundry-recon with everything wired up
cd foundry-recon
npm run dev

# 4. You should see the prototype running at http://localhost:5173

# 5. Initialize your own repo
git init
git remote add origin <your-repo-url>
git add . && git commit -m "Initial scaffold from prototype"
git push -u origin main
```

### Adding the Payment Module Later

When we build the Payment module, just drop the artifact into `src/artifacts/`:

```
src/artifacts/
  index.tsx          <- Reconciliation (main page)
  payment.tsx        <- Payment module (accessible at /payment)
```

Link between them with `<a href="/payment">` or `useNavigate()`. File-based routing handles the rest.

---

## Architecture — What the Prototype Tells You

The prototype contains the complete UI specification. Here's how to read it and what maps to what in production.

### Data Model

The prototype's `generateSuppliers()` function (lines 2-80) defines the full data shape. In production, this becomes your API response. Key entities:

**Supplier Record** (one per supplier per batch):
- `name`, `supplierTotal`, `xeroTotal`, `difference`
- `totalInvoices`, `missingCount`, `mismatchCount`
- `status`: `action_needed` | `contacted` | `waiting` | `reconciled`
- `batch`: `latest` | `previous`
- `daysSinceContact`: nullable integer, drives stale escalation
- `reconciledDate`, `reconciledDaysAgo`

**Invoice** (nested under supplier):
- `id`, `date`, `dueDate`, `supplierAmount`, `xeroAmount`
- `type`: `missing` | `mismatch` | `matched`
- `isOverdue`: boolean (drives payment prioritization)
- `priority`: `high` | `medium` | `low`

**Payment Suggestion** (computed, not stored):
- Calculated from matched invoices, capped at 15% of available cash
- Sorted: overdue first, then by amount descending
- User can toggle invoices in/out, totals recalculate live

### Three Tabs — Filtering & Sorting Logic

This is critical to get right. Each tab is a different view of the same supplier dataset:

| Tab | Filter | Sort | Purpose |
|-----|--------|------|---------|
| **Latest Batch** | `batch === "latest"` | Problems first (by issue count), reconciled last | "What just happened" |
| **Needs Attention** | `status !== "reconciled"` (across ALL batches) | Action needed -> stale (7+ days) -> contacted -> waiting | "Everything unresolved" |
| **Reconciled** | `status === "reconciled"` AND within retention window | Most recently reconciled first | "Ready for payment" |

The sorting functions are in the prototype (`sortLatest`, `sortAttention`, `sortReconciled` -- around line 780). Copy the logic exactly.

### Status System

Four statuses with specific visual treatment and transition rules:

- **Action Needed** (purple, pulsing dot) -- New issues, no action taken yet
- **Contacted** (green) -- Email sent to supplier
- **Awaiting Reply** (amber) -- Waiting for supplier response. **At 7+ days, escalates**: color shifts to orange, day count appears, sorts higher in Needs Attention
- **Reconciled** (green) -- All issues resolved or auto-matched

Status transitions: `action_needed -> contacted` (on email send), `contacted -> waiting` (automatic after send), `waiting -> reconciled` (manual or on resolution).

### Expanded Row — Two Distinct Flows

When a user clicks a supplier row, the expanded content depends on whether the supplier has issues or is reconciled:

**Problem Supplier (has issues):**
1. Shows invoice table with missing/mismatched invoices highlighted
2. "View all" toggle to see matched invoices too
3. "Email Supplier" button -> inline email draft with specific invoice details
4. "Send & Mark as Contacted" updates status without leaving the view

**Reconciled Supplier (ready for payment):**
1. Shows summary: total owed, invoice count, overdue count
2. **"Generate Payment Suggestion"** button (deliberate action, not auto-loaded)
3. 0.7s calculation animation, then reveals:
   - **Suggested Payment** amount (hero, large) + invoice count pill
   - **Account Balance** and **Remaining After Payment** (warns if < $20K)
   - Suggested invoices table with checkboxes (click to remove)
   - Deferred invoices table with + checkboxes (click to add)
   - Totals recalculate live on every toggle
4. "Send to Payment Module" or "Pay Now" buttons

---

## What Needs to Be Built (Beyond the Prototype)

The prototype handles all UI/UX. Here's what you need to add:

### 1. Backend API

Replace `generateSuppliers()` with real endpoints:

- `GET /api/reconciliation/batches` -- list batches with summary stats
- `GET /api/reconciliation/suppliers?tab=latest|attention|reconciled` -- filtered supplier list
- `GET /api/reconciliation/suppliers/:id/invoices` -- invoice detail for expanded view
- `PATCH /api/reconciliation/suppliers/:id/status` -- update status
- `POST /api/reconciliation/suppliers/:id/email` -- send email, update status to contacted
- `GET /api/payments/balance` -- current account balance (currently mocked at $145K)
- `POST /api/payments/suggestion` -- generate payment suggestion for a supplier
- `POST /api/payments/send` -- send to payment module

### 2. Statement Upload & Matching

- Upload endpoint accepting PDF and Excel statements
- Parser to extract invoice data from varying supplier formats
- Matching engine: compare extracted invoices against Xero data
- Tolerance threshold for auto-reconciliation (configurable, needs UI)

### 3. Xero Integration

- OAuth2 connection to Xero
- Pull invoices/bills for comparison
- Real-time balance lookup for payment suggestions
- Sync status: "Synced with Xero . 2 min ago" in footer is currently static

### 4. Email Integration

- SMTP connection (or SendGrid/Postmark)
- Template system using the email draft structure from the prototype
- Tracking: mark when sent, log responses
- The prototype's `buildEmailBody()` function shows the exact format -- follow it

### 5. Payment Module

- Separate page/view for managing payment runs
- Queue of suppliers sent from reconciliation
- Batch payment execution
- Payment confirmation and status tracking

---

## Design Specifications

The prototype IS the design spec. Key values to preserve exactly:

### Typography
- **Sans:** DM Sans (Google Fonts) -- all UI text
- **Mono:** JetBrains Mono (Google Fonts) -- all numbers, amounts, invoice IDs, dates
- Numbers should always be `fontWeight: 700-800` for readability

### Colors (CSS variables recommended)
- Background: `#090A0E` (page), `#0C0D12` (cards), `#0B0C10` (tables), `#101218` (nested)
- Borders: `#1A1D28` (cards), `#1E2030` (tables), `#161820` (rows)
- Text: `#F8FAFC` (titles), `#F1F5F9` (primary), `#CBD5E1` (secondary), `#94A3B8` (tertiary), `#6B7280` (muted)
- Accent blue: `#7B8CDE` (buttons, active tab)
- Green: `#4ADE80` (reconciled, payment), Red: `#F87171` (issues), Purple: `#A78BFA` (action needed), Amber: `#FBBF24` -> Orange: `#FB923C` (stale escalation)

### Animations
- `slideDown`: 0.2s ease-out for expanded rows
- `fadeIn`: 0.25s for row appearance, staggered 0.025s per row
- `pulse`: 2s infinite on action-needed and stale dots
- Payment generation: 0.7s calculating state before reveal

---

## Autonomous Development Setup — Claude Code

For maximum development velocity, use **Claude Code** as your autonomous coding agent. This is the setup we recommend:

### Install Claude Code

```bash
# macOS
brew install claude-code

# Or via the installer
curl -fsSL https://cli.claude.com/install | sh

# Then navigate to the project and start
cd foundry-recon
claude
```

### Set Up a CLAUDE.md for Context

Create a `CLAUDE.md` at the project root -- this is Claude Code's persistent instructions file. It reads this every session:

```markdown
# Foundry Reconciliation Module

## Project Context
CFO tool for supplier reconciliation against Xero. React + TypeScript + Vite + Tailwind.
Dark theme (#090A0E), DM Sans + JetBrains Mono typography.

## Key Files
- src/artifacts/index.tsx -- Main reconciliation UI (started from prototype)
- src/api/ -- Backend API routes
- src/hooks/ -- Custom hooks for data fetching
- src/types/ -- TypeScript interfaces

## Architecture Decisions
- Single-screen app with three tabs (Latest Batch, Needs Attention, Reconciled)
- Expanded rows for supplier detail -- two flows: problem (email) and reconciled (payment)
- Status system: action_needed -> contacted -> waiting -> reconciled
- Payment suggestions capped at 15% of available cash, overdue prioritized

## Coding Standards
- All monetary values use Intl.NumberFormat USD
- All dates in ISO format, displayed as locale strings
- Monospace font (JetBrains Mono) for all numbers
- Error handling with try-catch on all API calls
- Loading states for all async operations

## Testing
- Run: npm test
- Lint: npm run lint
- Build check: npm run build
```

### Recommended Workflow

1. **Use Claude Code in VS Code** -- install the extension for inline diffs and plan review
2. **Work in feature branches** -- let Claude Code create branches, commit, and PR
3. **Use sub-agents for parallel work**: `claude --agents` to split backend API and frontend component work
4. **Create a `claude-progress.txt`** -- Claude Code writes progress summaries here between sessions, so context carries over
5. **Use checkpoints** -- Claude Code 2.0 auto-creates restore points. If something breaks, press Esc twice or `/rewind`

### Example Session

```bash
cd foundry-recon
claude

# Then in the Claude Code session:
> "Read the prototype in src/artifacts/index.tsx. Extract the data model
>  into TypeScript interfaces in src/types/. Create a suppliers hook that
>  will eventually call the API but for now returns the mock data from
>  the prototype. Refactor the main component to use the hook."
```

Claude Code will read the file, plan the refactor, create the types, build the hook, update the component, and run the build to verify. Review the diff, approve, and it commits.

### Key Claude Code Features to Use

- **`/model opus`** -- Use Opus for complex refactoring and architecture decisions
- **`/compact`** -- When context gets long, compact to continue without losing state
- **Multi-agent**: One agent builds the API layer, another refactors the UI to consume it
- **Git integration**: "Create a feature branch for xero-integration, implement the OAuth flow, and open a PR"
- **Test generation**: "Write integration tests for the supplier status transitions"

---

## Implementation Priority

Recommended build order:

1. **Scaffold** -- Set up project with artifact runner, get prototype running locally
2. **Type system** -- Extract TypeScript interfaces from the prototype's data model
3. **Component decomposition** -- Break the 900-line prototype into proper components (StatusBadge, BatchSummary, SupplierTable, ProblemExpanded, PaymentExpanded, EmailDraft)
4. **State management** -- Replace `useState` with proper state (React Query + Zustand or similar)
5. **API layer** -- Build backend endpoints, swap mock data for real fetching
6. **Xero integration** -- OAuth, invoice sync, balance lookup
7. **Email integration** -- SMTP/service, template, send & track
8. **Payment module** -- Second page, payment queue, execution
9. **Upload & matching** -- Statement parsing, auto-reconciliation engine
10. **Polish** -- Error handling, loading states, edge cases, mobile responsiveness

---

## Files Included with This Guide

| File | Description |
|------|-------------|
| `reconciliation-module-v6.jsx` | Complete interactive prototype -- this IS the spec |
| `Reconciliation-Module-Guide.md` | Quick intro (shareable with stakeholders) |
| `Reconciliation-Walkthrough.pptx` | Visual walkthrough deck for reviews |

---

**Questions?** Walk through the prototype -- click everything. Every interaction, every expanded row, every status badge, every email draft, every payment suggestion is implemented and represents the target behavior. If the prototype does it, the production app should do it the same way.
