---
phase: 08-auto-reconcile-new-xero-invoices-on-30-minute-polling-with-fuzzy-statement-matching
plan: 01
subsystem: infra
tags: [node-cron, xero, mongoose, fuzzy-matching, polling, reconciliation]

# Dependency graph
requires:
  - phase: 05-fix-xero-bank-balance-mismatch-on-dashboard
    provides: Xero token management pattern (XeroTenants model, AuthController token refresh)
  - phase: 07-add-supplier-reconciliation-dashboard-with-view-toggle
    provides: Invoice model with fromXero flag and nameSimilarity matching logic
provides:
  - 30-minute background Xero invoice polling via node-cron
  - XeroSyncState model tracking lastPolledAt and lastSuccessAt
  - ReconLog model with per-cycle audit data (timing, counts, error)
  - xeroPollingService: token refresh, Xero fetch, fuzzy match, DB writes
  - Automatic statement record invoice number updates on match >= 0.8 threshold
affects:
  - any future phase reading reconciliation status or match history

# Tech tracking
tech-stack:
  added: [node-cron@^4.2.1]
  patterns:
    - Singleton upsert pattern for tracking last-poll state (XeroSyncState.findOneAndUpdate with {})
    - If-Modified-Since incremental Xero polling (ISO string without milliseconds)
    - In-memory boolean lock preventing overlapping cron cycles (isPolling)
    - Asymmetric fuzzy ID scoring: statement record as first arg (has potentialInvoiceIds), Xero invoice as second

key-files:
  created:
    - modals/xeroSyncStateModal.js
    - modals/reconLogModal.js
    - services/xeroPollingService.js
  modified:
    - server.js
    - package.json

key-decisions:
  - "node-cron schedules via */30 * * * * (every 30 minutes); immediate runPollCycle() fires on server start (fire-and-forget)"
  - "XeroSyncState and ReconLog use default mongoose connection (MONGO_URI), not 2.0 connection"
  - "Overlap prevention via module-level isPolling boolean lock (no Redis/DB needed)"
  - "getIdScore is asymmetric: statement record passed as first arg (has potentialInvoiceIds), Xero invoice number as second"
  - "MATCH_THRESHOLD = 0.8, same as upload feature; best match wins, only one statement record updated per Xero invoice"
  - "If Xero not connected (no refreshToken), cycle is skipped silently — no ReconLog entry written"
  - "Xero API errors caught per-cycle and logged to ReconLog.error field; retry naturally on next schedule"

patterns-established:
  - "Background polling: cron.schedule + isPolling lock + try/catch/finally for resilient service"
  - "Incremental API fetch: store lastPolledAt, use If-Modified-Since on next call to reduce data transfer"
  - "Per-cycle audit log: ReconLog.create with timing, counts, and error field for operational visibility"

requirements-completed: []

# Metrics
duration: 3min
completed: 2026-02-23
---

# Phase 08 Plan 01: Auto-Reconcile Xero Invoices via 30-Minute Polling Summary

**node-cron background service polling Xero every 30 minutes, upserting invoices to MongoDB, and fuzzy-matching against statement records using nameSimilarity with 0.8 threshold**

## Performance

- **Duration:** 3 min (161 seconds)
- **Started:** 2026-02-23T14:09:01Z
- **Completed:** 2026-02-23T14:11:42Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Two new Mongoose models (XeroSyncState, ReconLog) tracking poll state and per-cycle audit data
- Full polling service with token refresh, paginated Xero API fetch with If-Modified-Since, upsert, and fuzzy matching
- Overlap prevention via in-memory isPolling lock; xeroPollingService.start() wired into server.js after mongoose.connect()

## Task Commits

Each task was committed atomically:

1. **Task 1: Create XeroSyncState and ReconLog MongoDB models and install node-cron** - `f13f937` (feat)
2. **Task 2: Create xeroPollingService.js and wire into server.js** - `eef08bf` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `modals/xeroSyncStateModal.js` - Singleton document tracking lastPolledAt and lastSuccessAt timestamps (default mongoose connection)
- `modals/reconLogModal.js` - Per-cycle reconciliation log with ranAt, durationMs, counts, and error field
- `services/xeroPollingService.js` - Full polling service: token refresh, Xero API fetch, getIdScore, matchAndReconcile, runPollCycle, start
- `server.js` - Added xeroPollingService require and start() call after mongoose.connect() succeeds
- `package.json` - Added node-cron@^4.2.1 dependency

## Decisions Made

- node-cron used for scheduling (*/30 * * * *); fires an immediate cycle on start (fire-and-forget, does not block server boot)
- XeroSyncState and ReconLog placed on default mongoose connection (MONGO_URI), matching other root-level models like xeroTenantsModal
- In-memory isPolling boolean for overlap prevention — lightweight, no external dependencies
- getIdScore replicates upload logic exactly: statement record first arg (reads potentialInvoiceIds), Xero invoice number second arg
- If Xero is not connected (no refreshToken in DB), cycle skips silently without creating a ReconLog entry
- Token refresh uses same simple-oauth2 pattern as AuthController.js optionalXeroTokenInfo middleware
- If-Modified-Since header strips milliseconds (.000Z -> Z) per Xero API requirement

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The poller uses existing XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI, MONGO_URI, and MONGO_URI_2 environment variables already in use.

## Next Phase Readiness

- Polling infrastructure is complete and operational
- XeroSyncState will be populated on first successful cycle
- ReconLog provides audit trail viewable in MongoDB
- Future phases can extend the poller (e.g., webhook-based triggering, status dashboard endpoint)

---
*Phase: 08-auto-reconcile-new-xero-invoices-on-30-minute-polling-with-fuzzy-statement-matching*
*Completed: 2026-02-23*
