# Performance Baseline and Measurement Method

## Goals
- Track frontend bundle size and page-interaction responsiveness over time.
- Track backend dashboard endpoint latency (`P50`, `P95`) and response payload sizes.
- Compare before/after for each performance-focused PR.

## Frontend baseline
- Build command: `cd client && npm run build`.
- Measure generated assets in `client/dist/assets`:
  - Main JS entry size (raw and gzip if available).
  - Main CSS size.
  - Total JS payload across route chunks.
- Runtime checks in browser:
  - First load of `/` (simple app): record Time to Interactive and first table render.
  - Navigate to `/v1`, then `/v1/suppliers`, `/v1/statements`: record route-change latency.
  - Trigger one high-cost flow: report-error modal submit with screenshot disabled and enabled.

## Backend baseline
- Endpoint set:
  - `GET /api/v2/dashboard/dashboard-data`
  - `GET /api/v2/dashboard/dashboard-tab-2`
  - `GET /api/v2/dashboard/dashboard-tab-3`
  - `GET /api/v2/dashboard/xero-sync-status`
- Capture from response headers:
  - `Server-Timing` duration (`dur`).
  - `X-Response-Bytes` payload bytes.
  - `X-Cache` hit/miss where present.
- Aggregate over at least 30 requests per endpoint to compute `P50`/`P95`.

## Suggested runbook
1. Warm start app and backend with production-like data.
2. Collect backend timings with repeated requests from authenticated session.
3. Capture frontend load + route transitions via browser profiler.
4. Save results in a dated section in this file.

## Acceptance threshold (initial)
- Frontend:
  - Reduce initial route JS payload by at least 25% from current baseline.
  - Keep route transition delay under 300ms on warm cache.
- Backend:
  - `P95` for dashboard endpoints under 800ms on warm DB/cache.
  - Response payload size stable or decreasing for unchanged query scope.
