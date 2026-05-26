---
type: ux-proposal
created: 2026-05-25
tags:
  - steve-ai
  - ux
  - onboarding
  - approvals
  - cfo
---

# Steve AI UX Proposal: Company Onboarding + Approval Flow

## Executive summary

Steve should feel less like “an AI chatbot that may be right” and more like a calm finance teammate that prepares work, shows evidence, asks for approval at the right moment, and never moves money or records without a human green light.

The core UX shift:

1. **Onboard the company like a guided finance checklist**, not a blank dashboard.
2. **Turn reconciliation into a Power Dashboard with a daily/weekly approval queue.**
3. **Make Steve communicate in confidence bands, evidence, and next-best actions**, not vague AI prose.
4. **Use progressive disclosure:** CFO sees risk and decisions first; AP can drill into invoice-level details.
5. **Design for Jeffrey’s concern:** accuracy is earned through visibility, audit trail, and easy correction.

---

## Design principles

### 1. “Chief in the loop”
Steve recommends. The finance person approves. The product must make this contract obvious everywhere.

**UX rule:** Any irreversible or external-facing action needs a clear approval step:
- Posting to Xero
- Marking invoices reconciled
- Drafting/sending supplier emails
- Preparing payments
- Exporting final reports

### 2. Confidence is not enough; show evidence
A score alone does not build trust. Users need to see why Steve thinks something is safe.

**Show:** source documents, Xero record, bank line, supplier statement, amount/date/reference match, historical supplier behavior, and what changed since last sync.

### 3. Triage before detail
CFO/AP users do not want a giant table first. They want:
- What is safe?
- What needs me?
- What is blocked?
- What changed?
- What is the cash impact?

### 4. Progressive disclosure
Default views should be simple. Drilldowns should satisfy accountants who need proof.

### 5. “No silent automation”
If Steve acts, users should know:
- What Steve did
- Why Steve did it
- What Steve did not do
- What needs approval
- How to undo/correct it

---

## Primary personas and anxieties

### CFO / controller
**Goal:** Know month-end reconciliation status, cash exposure, and risk quickly.

**Anxieties:**
- “Can I trust this?”
- “Will this create an accounting mess?”
- “Will the app embarrass me with suppliers?”
- “Is anything being posted or paid without my approval?”

### AP / finance operator
**Goal:** Process statements, fix exceptions, communicate with suppliers.

**Anxieties:**
- “Where do I start?”
- “How do I know what Steve wants from me?”
- “Can I override Steve safely?”
- “Will I lose my work?”

### Design partner Jeffrey
**Likely success condition:** He can look at a supplier, understand the mismatch, correct Steve if needed, and feel the app is safer/faster than spreadsheet review.

---

# Part 1: Company onboarding flow

## Onboarding promise

> “Connect your accounting data, teach Steve your finance rules, run a safe first reconciliation, then approve what Steve found.”

The onboarding should feel like Duolingo-quality progression: short steps, visible progress, reassuring microcopy, instant wins, and no dead ends.

## Recommended onboarding structure

### Step 0 — Welcome / value confirmation
**Screen:** Welcome to Steve

**Goal:** Establish trust and scope.

**Content hierarchy:**
1. Headline: “Steve prepares your reconciliation. You approve every important action.”
2. Three cards:
   - Connect Xero
   - Upload or import supplier statements
   - Review Steve’s approval queue
3. Trust note: “Steve will not post, email, or prepare payments without approval.”
4. Primary CTA: “Set up my company”

**State notes:**
- If invited by another user, show company name and role.
- If returning, resume at the last incomplete step.

---

### Step 1 — Company profile
**Screen:** Tell Steve about your company

**Fields:**
- Company legal name
- Trading name, if different
- Base currency
- Country/timezone
- Month-end close date or usual reconciliation cadence
- Primary finance contact

**UX pattern:** 5-minute estimate, form grouped into “Company”, “Finance calendar”, “Contact”.

**Microcopy:** “This helps Steve label reports correctly and avoid currency/date mistakes.”

**Guardrail:** Currency and timezone become prominent system settings; changes later require confirmation.

---

### Step 2 — Connect accounting system
**Screen:** Connect Xero

**Goal:** OAuth connection with trust framing.

**Layout:**
- Left: simple explanation of what Steve reads/writes.
- Right: connection status card.

**Permission copy:**
- Reads: invoices, contacts, accounts, bank transactions.
- Writes only after approval: reconciliation status, notes, attachments, draft postings if supported.

**Connection states:**
- Not connected
- Connecting
- Connected
- Syncing first data
- Sync failed
- Reconnect required

**Important UX:** After connection, show “Last synced just now” and a small data preview: “Found 1,284 invoices, 312 contacts, 4 bank accounts.”

---

### Step 3 — Choose bank accounts and date range
**Screen:** What should Steve reconcile?

**Fields:**
- Bank accounts to monitor
- Start date
- Statement sources: Xero bank feed, uploaded bank statements, supplier statements
- Default reconciliation cadence: daily, weekly, monthly

**Guardrails:**
- Warn if selected date range is huge: “First run may take longer. We recommend last 90 days first.”
- Warn if no bank account is selected.

---

### Step 4 — Upload/import first supplier statement
**Screen:** Add your first supplier statement

**Design goal:** Get to first value quickly.

**Upload area:**
- Drag/drop PDF, XLS, XLSX
- “Try with sample data” option for demo/onboarding
- Supplier detection preview

**Detection states:**
- “Steve found: Acme Supplies Ltd” with editable supplier field
- “Steve is not sure who this belongs to” with required supplier name
- “This file has multiple suppliers” with split/review option

**Microcopy:** “Steve reads the file first. Nothing is posted to Xero yet.”

---

### Step 5 — Teach Steve rules
**Screen:** Your approval rules

This is where Steve becomes trustworthy.

**Recommended default rules:**
- Auto-mark as “Ready to approve” when exact amount + invoice number + supplier match.
- Require review when amount/date/reference differs.
- Always block currency mismatch.
- Require approval before supplier emails.
- Require approval before posting to Xero.
- Require approval before payment preparation.

**UI:** Toggle list with recommended defaults already selected. Use “Recommended” badges.

**Examples:**
- “If amount differs by under £1 due to rounding: mark as low-risk review.”
- “If invoice exists in supplier statement but not Xero: ask whether to post or query supplier.”
- “If invoice exists in Xero but not supplier statement: mark as needs review.”

**Advanced section collapsed by default:**
- Approval threshold by amount
- Role-based approvals
- Supplier-specific rules
- Tolerance settings
- Email tone/preferences

---

### Step 6 — First run progress
**Screen:** Steve is reconciling

**Avoid generic spinners. Use staged progress:**
1. Reading statement
2. Matching supplier to Xero contact
3. Comparing invoice numbers and amounts
4. Checking bank/payment evidence
5. Preparing approval queue

**Show what Steve has found live:**
- “18 matched confidently”
- “3 need review”
- “1 blocked: currency mismatch”

**If slow:** offer “Notify me when ready” and keep user in app.

---

### Step 7 — First results / aha moment
**Screen:** First reconciliation summary

**Above the fold:**
- Supplier name
- Total statement value
- Matched confidently
- Needs review
- Blocked
- Estimated time saved

**CTA:** “Review approval queue”

**Secondary CTA:** “Invite teammate” or “Upload another statement”

**Celebration:** Light, professional celebration. Confetti is okay only for demo/first successful setup, not for serious month-end approvals.

---

### Step 8 — Invite team and assign roles
**Screen:** Who else works on reconciliation?

**Roles:**
- CFO/admin: can approve final actions and manage rules.
- AP operator: can upload, review, prepare drafts.
- Viewer/auditor: read-only access.

**Good default:** Allow skip, but remind later.

---

## Onboarding completion dashboard

After onboarding, land users on a setup checklist, not a blank dashboard.

**Checklist card:**
- Connected to Xero ✅
- Bank account selected ✅
- First supplier statement processed ✅
- Approval rules set ✅
- Team invited optional

**Next action:** “You have 4 items waiting for approval.”

---

# Part 2: Power Dashboard / approval flow

## Dashboard mental model

The dashboard should be an operations cockpit:

1. **Top:** What needs attention now?
2. **Middle:** Approval queue grouped by risk/action.
3. **Bottom:** Supplier/activity details and audit trail.

## Proposed top-level navigation

- **Dashboard** — executive status and next actions
- **Approvals** — all items Steve wants human approval for
- **Suppliers** — supplier-level reconciliation status
- **Statements** — uploads/imports and processing history
- **Activity** — audit trail
- **Settings** — company, integrations, rules, team
- **Ask Steve** — contextual assistant, not primary navigation

---

## Power Dashboard layout

### Header
**Left:** “Reconciliation dashboard”

**Subtext:** “Xero synced 12 minutes ago · 3 supplier statements processed today”

**Right actions:**
- Upload statement
- Sync Xero
- Export report

### KPI strip
Use 4–5 cards max:

1. **Ready to approve** — green/blue, action-oriented
2. **Needs review** — amber
3. **Blocked** — red
4. **Unmatched value** — currency amount
5. **Last sync / data freshness** — trust signal

Avoid vanity metrics. Every KPI should click into a filtered queue.

### “Steve’s recommended next action” card
A calm guidance card:

> “Review 7 low-risk matches first. They total £18,420 and all have exact invoice number + amount matches.”

Buttons:
- Review low-risk approvals
- Show why
- Change rules

### Approval queue preview
Grouped tabs:
- Ready to approve
- Needs review
- Blocked
- Draft emails
- Payment prep
- Recently approved

Each row should show:
- Supplier
- Action Steve recommends
- Amount impact
- Confidence/risk badge
- Evidence summary
- Age
- Primary action

Example row:

| Supplier | Steve recommends | Amount | Evidence | Risk | Action |
|---|---|---:|---|---|---|
| Acme Ltd | Mark 12 invoices reconciled | £8,240 | Invoice # + amount + Xero match | Low | Review |

---

# Approval flow

## Approval object types

Steve should generate approval items, not just table rows.

### 1. Reconciliation approval
“Mark these invoices as reconciled / no action needed.”

### 2. Exception decision
“Choose what to do with this mismatch.”

### 3. Supplier email approval
“Approve this draft email to supplier.”

### 4. Xero posting approval
“Create/post this missing bill or adjustment in Xero.”

### 5. Payment preparation approval
“Prepare these invoices for payment.”

### 6. Rule approval
“Steve noticed a repeated pattern. Save this as a future rule?”

---

## Approval detail screen

### Top summary panel
- Supplier
- Statement period
- Total amount affected
- Steve’s recommendation
- Risk level
- Confidence band
- Status: Ready / Needs review / Blocked

### Evidence panel
Show side-by-side evidence:

**Supplier statement** | **Xero** | **Bank/payment evidence**

For each invoice:
- Invoice number
- Date/due date
- Amount/currency
- Contact/supplier
- Reference
- Source file link
- Match reason

### Decision panel
Primary action depends on item type:

For ready matches:
- Approve selected
- Approve all low-risk
- Send to review
- Reject Steve’s recommendation

For mismatches:
- Accept supplier amount
- Accept Xero amount
- Mark as disputed
- Draft supplier email
- Ignore for now
- Add note

For blocked items:
- Resolve currency mismatch
- Select correct supplier/contact
- Upload missing support
- Re-run match

### Audit trail panel
- Who uploaded file
- When Xero synced
- What Steve matched
- What confidence/rules were used
- Who approved/overrode
- Notes/comments

---

## Bulk approval pattern

Bulk approval is valuable but risky. Use a two-step pattern.

### Step 1 — Select items
User selects low-risk items.

Show sticky footer:
> “12 selected · £8,240 total · 12 low risk · 0 blocked”

CTA: “Review before approving”

### Step 2 — Confirmation modal/drawer
Title: “Approve 12 reconciliations?”

Show:
- What will happen
- What will not happen
- Total amount
- Highest risk level
- Any excluded blocked items
- Undo/correction policy

Require checkbox for sensitive actions:
- “I understand Steve will mark these as reconciled in Steve/Xero.”

Buttons:
- Approve 12
- Cancel

---

## Decision states

### Ready to approve
**Meaning:** Steve has strong evidence but still needs human approval.

**Visual:** Blue/green badge. No scary wording.

**Copy:** “Ready for your approval” not “Auto-approved.”

### Needs review
**Meaning:** Steve found a likely issue or insufficient evidence.

**Visual:** Amber badge.

**Copy:** “Steve needs your decision.”

### Blocked
**Meaning:** Steve should not proceed.

**Visual:** Red badge.

**Examples:** currency mismatch, missing supplier, duplicate invoice number, stale Xero sync, permission issue.

**Copy:** “Blocked until resolved.”

### Approved
**Meaning:** Human approved. Show approver name/time.

### Rejected / corrected
**Meaning:** Human disagreed. Capture reason, update Steve’s learning/rules if appropriate.

---

# AI agent communication design

## Ask Steve should be contextual and action-aware

Steve should know where the user is and offer relevant prompts.

### Dashboard prompts
- “What should I review first?”
- “Explain today’s blocked items.”
- “What changed since yesterday?”
- “Draft supplier emails for missing invoices.”

### Approval detail prompts
- “Why did you match these?”
- “Show only invoices with amount differences.”
- “What would you do here?”
- “Create a supplier email, but don’t send it.”

### Onboarding prompts
- “What permissions do you need from Xero?”
- “What rules do most CFOs use?”
- “Help me choose bank accounts.”

## Steve response format

Steve should answer finance questions in a structured way:

1. **Short answer**
2. **Evidence**
3. **Risk/uncertainty**
4. **Recommended next action**
5. **Approval required?**

Example:

> I recommend approving these 12 matches.  
> Evidence: invoice number, supplier, amount, and currency match in both the supplier statement and Xero.  
> Risk: low. No date or currency mismatch found.  
> Next action: review the batch summary, then approve.  
> Approval required: yes — I will not mark them reconciled until you approve.

## Agent guardrail language

Use direct trust-building copy:
- “I prepared this for review.”
- “I need your approval before I do this.”
- “I’m not confident enough to recommend approval.”
- “This is blocked because the currencies do not match.”
- “I can draft the email; you approve before it is sent.”

Avoid:
- “Done” when an action is only drafted.
- “Matched” if it is only a suggested match.
- “No issues” if data may be incomplete.
- Overconfident language like “definitely” unless deterministic.

---

# Empty, loading, and error states

## Empty dashboard before setup
**Headline:** “Let’s set up your first reconciliation.”

**Body:** “Connect Xero and upload one supplier statement. Steve will prepare an approval queue for you.”

**CTA:** “Start setup”

## Empty approval queue
**Headline:** “No approvals waiting.”

**Body:** “Steve will add items here after a statement is processed or Xero sync finds changes.”

**Secondary:** “Upload statement” / “Sync Xero”

## Loading state
Use skeleton cards plus meaningful progress messages:
- “Checking Xero invoices…”
- “Comparing supplier statement…”
- “Preparing approval queue…”

## Partial failure
Do not collapse into a generic error.

Example:
> “Steve processed 4 of 5 files. One file needs attention: `statement-march.pdf` could not be read.”

Actions:
- Retry file
- Replace file
- Enter supplier manually
- Contact support

## Stale data warning
If Xero sync is old:
> “Xero last synced 2 days ago. Approvals may be based on stale data.”

CTA: “Sync now”

---

# Stress-testing onboarding

## Scenarios to test

1. **No Xero connection** — user lands with no data.
2. **Xero connected but no bank accounts selected.**
3. **OAuth expires mid-onboarding.**
4. **First supplier statement has unknown supplier.**
5. **File has multiple suppliers.**
6. **Unsupported file type.**
7. **Huge first upload** — 2,000+ rows.
8. **OCR poor quality PDF.**
9. **Currency mismatch.**
10. **Duplicate invoice numbers.**
11. **Invoice exists in supplier statement but not Xero.**
12. **Invoice exists in Xero but not supplier statement.**
13. **User leaves onboarding and returns later.**
14. **Two users review same approval item.**
15. **User bulk approves then notices an error.**
16. **AP user lacks permission to approve.**
17. **CFO wants read-only demo first.**
18. **Xero sync finds new changes after approval queue was prepared.**

## Acceptance criteria

- User always knows the next best action.
- User can recover from every setup failure.
- No irreversible action happens without explicit approval.
- Every approval has evidence and an audit trail.
- Blocked items explain exactly why they are blocked.
- Steve’s language distinguishes draft vs approved vs completed.

---

# Implementation handoff

## Recommended MVP screens

### Onboarding MVP
1. Welcome/setup checklist
2. Company profile
3. Xero connect + sync preview
4. Bank account/date range selection
5. Upload first statement + supplier detection
6. Approval rules
7. First run progress
8. First results summary

### Approval MVP
1. Power Dashboard
2. Approval queue
3. Approval detail drawer/page
4. Bulk approval confirmation
5. Activity/audit trail
6. Settings: approval rules

## Data needed per approval item

- Approval ID
- Type: reconciliation, exception, email, posting, payment, rule
- Supplier/contact
- Related statement/upload
- Related invoice IDs
- Amount and currency
- Risk level: low, medium, high, blocked
- Confidence band and reasons
- Evidence links/sources
- Recommended action
- Available user actions
- Status
- Created time
- Last updated time
- Approver/reviewer
- Notes/comments
- Audit events

## Component patterns

- `SetupChecklist`
- `ConnectionStatusCard`
- `DataFreshnessBadge`
- `ApprovalQueueTabs`
- `ApprovalRow`
- `RiskBadge`
- `EvidenceSummary`
- `ApprovalDetailDrawer`
- `BulkApprovalFooter`
- `ConfirmApprovalModal`
- `AuditTimeline`
- `SteveRecommendationCard`
- `EmptyState`
- `ProgressStepper`

## Visual hierarchy recommendations

- Use calm neutral backgrounds with strong status colors only where needed.
- Keep red only for truly blocked/risky states.
- Use badges for state, not paragraphs.
- Place amount/risk/action in the same horizontal scan path.
- Put evidence one click away, not buried in tables.
- Do not make Ask Steve compete with the approval CTA.

## Suggested first build sequence

1. Add approval statuses and queue model to the product language.
2. Redesign dashboard top section around “Ready / Review / Blocked”.
3. Add approval detail drawer with evidence and audit trail.
4. Add onboarding checklist and Xero/data setup states.
5. Add first-run progress and first-results summary.
6. Add rule settings after the first successful reconciliation.
7. Upgrade Ask Steve prompts and response template.

---

# Key copy library

## Trust copy
- “Steve prepares. You approve.”
- “Nothing is posted to Xero without your approval.”
- “Steve found a likely match. Review the evidence before approving.”
- “Blocked for safety: currency mismatch.”
- “This draft email has not been sent.”

## CTA copy
- “Review approvals”
- “Approve selected”
- “Send to review”
- “Draft supplier email”
- “Resolve blocked item”
- “Sync Xero now”
- “Upload another statement”

## Error copy
- “We could not read this file. Try uploading a clearer PDF or Excel version.”
- “Xero needs to be reconnected before Steve can continue.”
- “Steve found duplicate invoice numbers. Please choose the correct one.”
- “This item is blocked because the supplier statement and Xero use different currencies.”

---

# Recommendation for Jeffrey demo

For the next design-partner demo, do not show a broad feature tour. Show a trust journey:

1. Connect/sync state: “Here is what Steve is looking at.”
2. Upload one supplier statement.
3. Steve processes it with transparent progress.
4. Dashboard shows ready/review/blocked.
5. Open one low-risk approval and show evidence.
6. Open one mismatch and show decision options.
7. Ask Steve: “Why did you match this?”
8. Approve a safe item.
9. Show audit trail.
10. Show that nothing was posted/emailed without approval.

The win is not “AI magic.” The win is “I can trust this workflow more than my spreadsheet.”
