# Steve AI Next Phase Master Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn Steve AI from a promising reconciliation engine into a trustworthy finance product with synthetic validation, connector architecture, onboarding, and approval workflows.

**Architecture:** Keep the reconciliation brain provider-agnostic. Build a validation harness and connector framework around canonical financial records. Design the product around the promise: **Steve prepares. You approve.**

**Tech Stack:** Existing Steve AI repo: React frontend (`client/`), Express/Node backend (`server.js`, `routes/`, `controllers/`, `services/`), MongoDB/Mongoose, existing Xero OAuth/polling code, Python reconciliation core in `src/`.

---

## Workstream A — Supplier Validation Without Real Supplier Data

### Objective
Build a synthetic supplier validation harness so Steve can be stress-tested before real supplier data arrives.

### Deliverables
- Synthetic supplier personas.
- Scenario generator.
- Ground-truth answer keys.
- Reconciliation scoring report.
- CI test suite for bad-payment prevention.

### First implementation tasks

1. Create `tests/fixtures/synthetic_suppliers/`.
2. Create reusable personas: Founding IP, Stalker IP, KHIP, Volume Vendor, Credit Note Supplier, Partial Pay Supplier, Subscription Vendor, Bad Statement Vendor.
3. Create scenario schema with:
   - supplier profile
   - supplier statement rows
   - Xero-style ledger rows
   - expected match decisions
   - expected payment recommendation
   - expected email/status/audit outputs
4. Build deterministic generator script, e.g. `scripts/generate_synthetic_reconciliation_cases.py`.
5. Build validation runner that executes each scenario against `src/reconciliation_app.py`.
6. Score every run with pass/fail metrics.

### Critical acceptance rule
Steve must have **zero silent unsafe payment recommendations**. If data is ambiguous, missing, duplicated, paid already, or currency-conflicted, Steve should block or ask for review.

---

## Workstream B — Connector / Integration Framework

### Objective
Make Steve able to connect Xero now, but support QuickBooks, NetSuite, CSV, banks, email, Drive, WhatsApp, and third-party tools later through one connector architecture.

### Product principle
Steve should reconcile **canonical financial records**, not Xero-specific records.

### Deliverables
- Connector registry / marketplace.
- Generic connection model.
- MockLedger connector for testing.
- Xero connector refactor plan.
- Connection health and sync logs.
- Canonical data mapping layer.

### First implementation tasks

1. Create connector contracts under `services/connectors/`:
   - `LedgerConnector`
   - `FileConnector`
   - `WebhookConnector`
2. Create generic Mongo models:
   - `IntegrationConnection`
   - `IntegrationSyncState`
   - `IntegrationSyncRun`
   - `ExternalRecordMapping`
3. Build `mockLedgerConnector` first so testing does not depend on live Xero.
4. Normalize connector output into canonical invoice/contact/payment records.
5. Add connector contract tests.
6. Wrap existing Xero logic behind the new connector interface.
7. Add frontend Integrations screen:
   - available connectors
   - connected status
   - last sync
   - errors
   - manual sync button

### Security rules
- Encrypt credentials/tokens.
- Redact logs.
- Use OAuth state and ideally PKCE.
- Audit every sync and external write.
- Do not write back to ledgers until human approval flow is strong.

---

## Workstream C — Power Dashboard + Approval Flow

### Objective
Create the product surface where finance users can review Steve’s work and approve/hold/reject actions.

### Product promise
**Steve prepares. You approve.**

### Primary dashboard sections
- Ready to approve.
- Needs review.
- Blocked.
- Unmatched value.
- Cash impact.
- Last sync / data freshness.
- Recent Steve activity.

### Approval item types
- Reconciliation approvals.
- Exception decisions.
- Supplier email approvals.
- Xero posting approvals.
- Payment preparation approvals.
- Rule approvals.

### First implementation tasks

1. Design approval object model:
   - type
   - supplier
   - amount impact
   - reason
   - evidence links
   - risk level
   - Steve recommendation
   - required human action
   - audit events
2. Add backend approval queue API.
3. Add frontend approval queue page.
4. Add invoice/detail drawer with evidence:
   - statement row
   - ledger row
   - match reason
   - confidence/risk
   - what Steve will/won’t do
5. Add decision actions:
   - approve
   - hold
   - reject
   - request supplier email
   - mark needs investigation
6. Add audit trail for every decision.

### UX rule
Never show users a vague AI conclusion without evidence and a clear next action.

---

## Workstream D — Company Onboarding Flow

### Objective
Make first-time setup guided, confidence-building, and testable.

### Recommended onboarding flow
1. Welcome / value framing.
2. Company profile.
3. Connect ledger, starting with Xero or MockLedger.
4. Choose company/entity/tenant.
5. Import suppliers.
6. Set payment rules.
7. Choose supplier statement source.
8. Upload first statement.
9. Run first reconciliation.
10. Show first “aha” result.
11. Invite team / assign roles.

### First implementation tasks

1. Add onboarding state model.
2. Add onboarding checklist API.
3. Add guided frontend onboarding pages.
4. Support demo mode with MockLedger + synthetic supplier pack.
5. Add setup progress / completion state.
6. Add clear empty states for missing ledger, missing statements, failed sync, no suppliers, no approvals.

### Benchmark principle
Treat onboarding like a great consumer app: fast progress, visible checklist, immediate “aha moment,” and no blank dashboard.

---

## Workstream E — AI Workflow + Communication Design

### Objective
Make Steve’s AI behavior trustworthy, bounded, and useful.

### Communication rules
Steve should communicate in:
- evidence
- confidence/risk bands
- next-best actions
- auditability
- clear “I did / I did not do” summaries

### First implementation tasks

1. Define Steve action taxonomy:
   - observed
   - matched
   - flagged
   - recommended
   - drafted
   - waiting for approval
   - completed
2. Add explainability fields to reconciliation results.
3. Add user-facing Steve summaries for dashboard cards.
4. Add safe wording for low-confidence cases.
5. Add notification/event feed.

---

## Workstream F — Stress Testing

### Objective
Prove Steve handles scale, messy data, onboarding gaps, connector failures, and UX edge cases.

### Test categories
- 10 invoices, clean baseline.
- 1,000 invoices, mostly clean.
- 10,000 invoices, scale/performance.
- Duplicate invoices.
- Missing invoices.
- Amount mismatch.
- Currency mismatch.
- Already-paid invoices.
- Partial payments.
- Credits/negative rows.
- Supplier aliases.
- Date format chaos.
- Failed Xero sync.
- Expired token.
- Blank dashboard state.
- Half-completed onboarding.
- User approves then undoes.

### First implementation tasks

1. Add generated large fixture packs.
2. Add performance thresholds.
3. Add onboarding scenario tests.
4. Add connector failure mocks.
5. Add visual/interaction acceptance checklist for the dashboard.

---

## Recommended sequence

### Phase 1 — Build trust without live data
- Synthetic supplier validation harness.
- MockLedger connector.
- First approval queue data model.

### Phase 2 — Productize the first experience
- Onboarding flow using demo/synthetic data.
- Power Dashboard.
- Evidence drawer and audit trail.

### Phase 3 — Bring Xero back through the right architecture
- Wrap existing Xero code as a connector.
- Add connection health/sync logs.
- Run the same validation tests against MockLedger and Xero-shaped data.

### Phase 4 — Automate carefully
- Scheduled sync.
- Scheduled reconciliation.
- Supplier email drafts.
- Human approvals before external actions.

### Phase 5 — Expand connectors
- QuickBooks.
- NetSuite.
- CSV.
- Bank feeds.
- Email/Drive/WhatsApp intake.

---

## Documents created in this planning pass

- `docs/supplier-reconciliation-test-data-validation-strategy.md`
- `docs/integration-connector-architecture.md`
- `docs/ux-onboarding-approval-flow-proposal.md`
- `docs/steve-ai-next-phase-master-plan.md`

---

## Immediate next build sprint

If we start coding now, the best first sprint is:

1. Build the synthetic supplier fixture format.
2. Build the deterministic fixture generator.
3. Build the validation runner/scorer.
4. Build MockLedger connector contract.
5. Add first approval queue schema.
6. Add first dashboard wireframe page using mock data.

This gives us data trust, integration architecture, and product UX all moving together without waiting for live Xero access.
