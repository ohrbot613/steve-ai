# Phase 8: Auto-reconcile new Xero invoices on 30-minute polling with fuzzy statement matching - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Every 30 minutes, poll Xero for new invoices, save them to MongoDB, and use the existing fuzzy matching function (from statement upload) to match invoices against uploaded bank statement records. When a match is found, update the statement record with the Xero invoice number. Show a "Last synced" indicator on the reconciliation dashboard.

</domain>

<decisions>
## Implementation Decisions

### Matching behavior
- Use the exact same fuzzy matching function from the statement upload feature — reuse, don't reimplement
- Same confidence threshold as upload — no separate threshold for auto-reconcile
- Match against ALL statement records (including already-matched ones) — if a new invoice is a better match, overwrite the existing invoice number
- When one invoice matches multiple statement records, pick the best (highest confidence) match only
- Only process NEW Xero invoices since last poll (track last-checked timestamp)
- Match fields: same fields the upload matching uses (amount + supplier name)
- Process all new invoices in one batch per cycle — no cap
- Main bank account only — don't scan across all connected Xero accounts
- Every new Xero invoice gets saved to MongoDB regardless of match status

### Match updates
- On match: write only the Xero invoice number to the statement record (minimal update)
- No confidence score stored on the record
- No distinction between auto-matched and manually matched records
- Store all Xero invoice data needed to fill the existing modal requirements (supplier, amount, date, status, line items, etc.)

### Visibility & logging
- "Last synced with Xero: X min ago" indicator on the reconciliation dashboard — just the time, no match count
- Persistent reconciliation log stored in MongoDB (when it ran, what matched) — database only, no UI viewer
- Xero API errors: silent retry next cycle, no user notification
- No manual trigger — automatic 30-minute polling only

### Claude's Discretion
- Polling infrastructure (cron job, setInterval, node-cron, etc.)
- Overlap prevention (lock mechanism to prevent concurrent cycles)
- User-facing awareness indicator approach (beyond the "last synced" timestamp)
- Error retry strategy details
- Exact MongoDB schema for reconciliation log

</decisions>

<specifics>
## Specific Ideas

- Reuse the exact same matching function from statement upload — DRY, same code path
- "Last synced with Xero: 5 min ago" style display on the reconciliation dashboard
- Save every Xero invoice to MongoDB even with no match — they should be queryable

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-auto-reconcile-new-xero-invoices-on-30-minute-polling-with-fuzzy-statement-matching*
*Context gathered: 2026-02-23*
