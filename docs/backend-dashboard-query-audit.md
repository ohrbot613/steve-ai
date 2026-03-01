# Backend Dashboard Query Audit

## Query hotspots
- `GET /api/v2/dashboard/dashboard-data`
  - Reads latest process log, then loads statements/invoices by id list, then resolves paired Xero invoices.
- `GET /api/v2/dashboard/dashboard-tab-2`
  - Loads invoices globally (`isDeleted != true`) and groups by supplier + invoice number in memory.
  - Loads matching vendors and latest statements by contact id.
- `GET /api/v2/dashboard/dashboard-tab-3`
  - Loads unpaid invoices globally and groups in memory.
  - Resolves vendor metadata and optional FX rates.

## Implemented optimizations
- Added response metrics headers and server timing logs:
  - `Server-Timing`
  - `X-Response-Bytes`
  - `X-Cache`
- Added short-lived in-memory cache for heavy read endpoints:
  - `dashboard-tab-2`
  - `dashboard-tab-3`
- Added cache invalidation on mutation paths:
  - mark paid
  - undo mark paid
  - hard delete invoice
  - force sync now
- Added/expanded compound indexes:
  - `Invoice`: query-supporting indexes for `isDeleted`, `contactId`, `invoiceNumber`, `fromXero`, `status`
  - `Statement`: `isDeleted + contactId + dateOnFile`
  - `Vendor`: `xeroId + isDeleted + supplier`

## Follow-up opportunities
- Move `tab-2` and `tab-3` grouping logic into aggregation pipelines to reduce Node.js heap pressure.
- Add tenant/user scoping at query level where applicable to reduce dataset scans.
- Persist endpoint timing to metrics backend and compute rolling `P95` per route.
