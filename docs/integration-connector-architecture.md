# Steve AI Integration / Connector Architecture

## Goal

Steve currently has Xero-specific OAuth, polling, token storage, invoice normalization, and reconciliation trigger logic spread across `services/xeroPollingService.js`, `v2/api/xero-*.js`, and Xero-specific DB fields/models. The next architecture should keep Xero working while making QuickBooks, NetSuite, CSV import, banks, email/PDF providers, and third-party tools plug in through one connector framework.

Principle: **Steve reconciles canonical financial records, not Xero records.** Connectors ingest external data, normalize it, and write canonical records plus sync/audit metadata.

## Current repo findings

- Backend: Express/Node in `server.js`, `app.js`, `routes/`, `controllers/`, `services/` with MongoDB/Mongoose.
- Existing Xero cron starts directly in `server.js` via `xeroPollingService.start()`.
- Existing Xero models are `modals/xeroTenantsModal.js`, `modals/xeroSyncStateModal.js`, `modals/reconLogModal.js`.
- Current Xero service stores/accesses one tenant globally via `XeroTenants.findOne()`, so it is not connector-neutral or multi-tenant safe.
- Existing canonical-ish invoice model is `2.0/modals/invoiceModal.js`, but fields still include `fromXero` and no generic `source/provider/externalId` fields.
- `v2/api/xero-auth.js`, `v2/api/xero-callback.js`, and `v2/api/xero-poll.js` show a second/serverless Xero implementation using Supabase. This confirms the need to isolate provider logic from storage and app workflows before adding more integrations.
- Python reconciliation core in `src/` expects generic invoice/payment/statement-shaped data; connectors should feed this core through canonical models or API payloads.

## Proposed architecture

```text
React Integrations UI
  └── /api/v1/connectors/*
        ├── Connector Registry / Marketplace
        ├── OAuth + credential handlers
        ├── Connection health + sync logs
        └── Manual sync controls

Backend connector framework
  ├── ConnectorRegistry
  ├── Connector interfaces: AuthConnector, LedgerConnector, FileConnector, WebhookConnector
  ├── Implementations:
  │     ├── xeroConnector
  │     ├── quickbooksConnector (later)
  │     ├── netsuiteConnector (later)
  │     ├── csvConnector
  │     └── mockLedgerConnector
  ├── SyncEngine / JobRunner
  ├── RateLimiter + Retry/Backoff
  ├── Mapper/Normalizer
  └── SecretVault abstraction

MongoDB canonical data
  ├── IntegrationConnection
  ├── IntegrationSyncState
  ├── IntegrationSyncRun / SyncLog
  ├── ExternalRecordMapping
  ├── Canonical Invoice / Contact / Account / Payment / Transaction
  └── Reconciliation jobs/results

Python reconciliation core
  └── consumes canonical records, never provider-specific records
```

## Core connector contracts

Create a connector SDK under `services/connectors/` (or `server/connectors/` if the repo is reorganized later). Each provider implements the same interface.

```js
// services/connectors/types.js
class LedgerConnector {
  static provider = 'xero';
  static capabilities = {
    auth: 'oauth2',
    pull: ['contacts', 'invoices', 'payments', 'bankTransactions', 'accounts'],
    push: [], // future: bills, payments, journals
    webhooks: false,
    incrementalSync: true,
  };

  getAuthUrl({ connectionId, userId, redirectUri }) {}
  handleOAuthCallback({ code, state }) {}
  refreshCredentials(connection) {}
  testConnection(connection) {}
  listTenants(connection) {}
  sync({ connection, cursor, since, entities, jobId }) {}
  normalize(providerRecord, entityType, context) {}
}
```

Minimum normalized entity envelope:

```js
{
  provider: 'xero',
  connectionId: '...',
  entityType: 'invoice',
  externalId: 'xero-invoice-guid',
  externalTenantId: 'xero-tenant-guid',
  version: 'updated-date-or-etag',
  sourceUpdatedAt: '2026-05-25T10:00:00Z',
  raw: { /* provider payload, optional/encrypted or archived */ },
  canonical: {
    invoiceNumber: 'INV-123',
    contact: { externalId: '...', name: 'Supplier Ltd' },
    amount: 123.45,
    balanceDue: 123.45,
    currency: 'GBP',
    status: 'unpaid',
    issueDate: '2026-05-01',
    dueDate: '2026-05-31',
    lineItems: [],
  }
}
```

## Database model changes

### 1. IntegrationConnection

Replaces `XeroTenants` as the generic credential/connection model.

Important fields:

- `tenantId` / `clientId` / `teamId`: Steve account owner. Do not use global `findOne()`.
- `provider`: `xero`, `quickbooks`, `netsuite`, `csv`, `mock-ledger`, etc.
- `connectionType`: `ledger`, `bank`, `file`, `crm`, `email`, `third_party_tool`.
- `displayName`: e.g. “Recharge Xero UK”.
- `externalTenantId`, `externalTenantName`.
- `status`: `draft`, `connecting`, `connected`, `degraded`, `auth_expired`, `revoked`, `disabled`, `error`.
- `capabilities`: copied from connector metadata.
- `credentials`: encrypted OAuth/API credentials only; never plaintext tokens.
- `scopesGranted` and `scopesRequired`.
- `lastHealthCheckAt`, `lastSuccessfulSyncAt`, `lastErrorAt`, `lastErrorCode`, `lastErrorMessage`.
- `createdBy`, `createdAt`, `updatedAt`.

Indexes:

- `{ tenantId: 1, provider: 1, externalTenantId: 1 }` unique.
- `{ tenantId: 1, status: 1 }`.

### 2. IntegrationSyncState

Cursor per connection and entity type.

- `connectionId`, `provider`, `entityType`.
- `cursor`: provider-specific cursor, `updatedSince`, page token, NetSuite search ID, etc.
- `lastStartedAt`, `lastSuccessAt`, `lastAttemptAt`.
- `consecutiveFailures`, `lockUntil`.

### 3. IntegrationSyncRun / SyncLog

Append-only operational log.

- `connectionId`, `provider`, `entityTypes`, `trigger`: `manual`, `cron`, `webhook`, `oauth_complete`, `test`.
- `status`: `queued`, `running`, `success`, `partial_success`, `failed`, `cancelled`.
- Counts: `fetched`, `created`, `updated`, `unchanged`, `deleted`, `skipped`, `failed`, `reconciliationsQueued`.
- `startedAt`, `finishedAt`, `durationMs`.
- `requestId/jobId`, rate-limit stats.
- `errors[]`: sanitized code/message/entity/externalId.

### 4. ExternalRecordMapping

Provider identity map for idempotency and audit.

- `connectionId`, `provider`, `entityType`, `externalId`.
- `canonicalModel`: `Invoice`, `Contact`, etc.
- `canonicalId`.
- `externalVersion`, `sourceUpdatedAt`, `firstSeenAt`, `lastSeenAt`.
- Unique: `{ connectionId, entityType, externalId }`.

### 5. Canonical records

Evolve invoice fields away from Xero booleans:

- Replace/augment `fromXero` with `source.provider`, `source.connectionId`, `source.externalId`, `source.externalTenantId`, `source.importMethod`.
- Add generic `externalContactId`, `contactName`, `balanceDue`, `taxAmount`, `paidAt`, `sourceUpdatedAt`, `rawHash`.
- Keep existing fields for backward compatibility during migration, but new code should use `source.*`.

## Xero connector refactor

Move logic from `services/xeroPollingService.js` into provider-specific modules:

```text
services/connectors/
  registry.js
  syncEngine.js
  connectors/
    xero/
      index.js
      auth.js
      client.js
      normalizers.js
      fixtureData.js
    mockLedger/
      index.js
    csv/
      index.js
  storage/
    connectionStore.js
    syncStateStore.js
    syncLogStore.js
```

Xero adapter responsibilities:

- OAuth URL generation and callback exchange.
- Tenant selection from `/connections`; if multiple tenants exist, support user selection instead of always picking the first.
- Token refresh with jitter and refresh-before-expiry.
- Incremental fetch using `If-Modified-Since` and pagination.
- Normalize Xero contacts/invoices/payments into canonical records.
- Return sync metrics and sanitized provider errors.

The generic sync engine handles:

- Loading connection and connector implementation.
- Credential refresh through connector.
- Locking one sync per connection/entity.
- Calling connector `sync()` or paginated `fetch*()` methods.
- Upserting canonical data and `ExternalRecordMapping`.
- Writing `IntegrationSyncRun`.
- Queuing reconciliation when relevant entities change.

## API surface

Add generic endpoints and keep legacy Xero endpoints as wrappers/redirects during migration.

```text
GET  /api/v1/connectors/catalog
GET  /api/v1/connectors/connections
GET  /api/v1/connectors/connections/:id
POST /api/v1/connectors/:provider/connect              -> returns authUrl or upload session
GET  /api/v1/connectors/:provider/callback             -> OAuth callback
POST /api/v1/connectors/connections/:id/test
POST /api/v1/connectors/connections/:id/sync
POST /api/v1/connectors/connections/:id/disconnect
GET  /api/v1/connectors/connections/:id/sync-runs
GET  /api/v1/connectors/connections/:id/health
GET  /api/v1/connectors/connections/:id/mappings
PATCH /api/v1/connectors/connections/:id/settings
```

Response examples should never include tokens. Show status, scopes, tenant, last sync, and health only.

## Frontend UX

Add an “Integrations” area in React:

1. **Connector marketplace/list**
   - Cards: Xero, QuickBooks, NetSuite, CSV Upload, Mock Ledger/Sandbox, future apps.
   - Status chips: Connected, Needs attention, Coming soon, Configure.
   - Capabilities list: invoices, contacts, payments, bank transactions, push payments, webhooks.

2. **OAuth connect flow**
   - User clicks “Connect Xero”.
   - Backend returns `authUrl`; frontend redirects.
   - Callback returns to `/integrations?provider=xero&status=connected|error`.
   - If multiple Xero tenants are returned, show tenant picker before finalizing or after callback.
   - Show required scopes before redirect.

3. **Connection detail page**
   - Health: auth valid, rate-limit status, last successful sync, next scheduled sync.
   - Sync logs table with counts and errors.
   - Manual “Sync now”.
   - Settings: entities to sync, sync frequency, start date.
   - Disconnect/reconnect.

4. **Mapping/config page**
   - Vendor/contact matching rules.
   - Account mapping where needed: AP account, clearing account, currencies, tax handling.
   - CSV column mapping wizard with saved templates.

## Testing without live Xero

Testing should not require real Xero credentials.

1. **MockLedger connector**
   - Implements the same connector interface.
   - Uses deterministic fixture invoices, contacts, payments, and bank transactions.
   - Supports edge cases: duplicate invoice numbers, missing contact, currency mismatch, partial payment, deleted/voided invoice, pagination, expired token simulation.

2. **Xero HTTP mocking**
   - Unit tests for Xero adapter using `nock` or equivalent.
   - Mock token refresh, `/connections`, `/Organisation`, `/Invoices` pagination, 401, 429, 500.
   - Golden fixture payloads stored under `services/connectors/connectors/xero/__fixtures__/`.

3. **Contract tests**
   - Every connector must pass shared tests:
     - exposes metadata/capabilities;
     - normalizes required fields;
     - produces stable `externalId`;
     - handles pagination/cursors;
     - redacts secrets in errors;
     - is idempotent on repeated sync.

4. **Integration tests**
   - Use in-memory MongoDB or isolated test DB.
   - Run sync engine with MockLedger, assert canonical invoices and mappings are written.
   - Run second sync, assert no duplicates.
   - Trigger reconciliation using canonical data and assert sync logs include `reconciliationsQueued`.

5. **Frontend tests**
   - Mock `/connectors/catalog` and `/connections`.
   - Verify connected/error OAuth URL query states.
   - Verify “Sync now” displays queued/running/success states.

## Security requirements

- Encrypt connector credentials at rest with envelope encryption or a `SecretVault` abstraction. In development this can use AES-GCM with `CONNECTOR_ENCRYPTION_KEY`; production should use KMS/managed secrets if available.
- Never log tokens, auth codes, refresh tokens, or raw provider error bodies without redaction.
- Store OAuth `state` and optional PKCE verifier server-side with TTL; compare using timing-safe comparison.
- Scope OAuth requests minimally per connector capability.
- Support disconnect/revoke and erase credentials while retaining sync logs/mappings for audit.
- Validate all connector route params against registry providers; do not dynamically require arbitrary paths.
- Add per-tenant authorization checks to every connection endpoint.
- Add rate limiting on OAuth callback, connect, sync-now, and test-connection endpoints.
- Record audit events: connected, reconnected, disconnected, sync started/completed/failed, settings changed.

## Implementation phases

### Phase 1 — Foundation, no behavior change

- Add connector registry and interfaces.
- Add generic connection/sync-state/sync-run/mapping models.
- Implement `SecretVault` with local AES-GCM encryption.
- Build `mockLedgerConnector` and contract tests.
- Add `/api/v1/connectors/catalog`.

### Phase 2 — Wrap existing Xero

- Move Xero OAuth/token/polling code into `xeroConnector`.
- Keep existing routes as compatibility wrappers to generic routes.
- Replace global `XeroTenants.findOne()` with tenant-scoped `IntegrationConnection` lookup.
- Write Xero adapter unit tests with mocked HTTP.
- Add sync logs and health status for Xero.

### Phase 3 — Canonical data + reconciliation handoff

- Add `source.*` fields to invoices while keeping `fromXero` temporarily.
- Add `ExternalRecordMapping` idempotent upserts.
- Make sync engine queue/run reconciliation against canonical records.
- Update reports/UI labels from “Xero” to “Ledger” where appropriate, while still showing provider name.

### Phase 4 — Integrations UI

- Add marketplace/list page.
- Add connection detail page, sync logs, health, manual sync.
- Add OAuth result handling and tenant picker.
- Add mapping/settings page for contacts/accounts and CSV templates.

### Phase 5 — New connectors

- CSV connector first because it validates canonical normalization without OAuth.
- QuickBooks Online connector next: OAuth2, company ID, invoices/bills/payments/vendors.
- NetSuite connector after mapping UX exists: token-based OAuth/TBA, saved searches, subsidiaries, currencies.
- Add webhooks where providers support them, but keep polling as fallback.

## First practical tasks

1. Create `services/connectors/registry.js`, `services/connectors/types.js`, and `services/connectors/connectors/mockLedger/index.js`.
2. Create Mongoose models:
   - `modals/integrationConnectionModal.js`
   - `modals/integrationSyncStateModal.js`
   - `modals/integrationSyncRunModal.js`
   - `modals/externalRecordMappingModal.js`
3. Add catalog route:
   - `routes/connectorRoutes.js`
   - `controllers/ConnectorController.js`
   - mount under `/api/v1/connectors` in `app.js`.
4. Add contract tests for MockLedger and registry.
5. Refactor only token storage first: create Xero `IntegrationConnection` on OAuth callback while continuing to write legacy `XeroTenants` until migration is complete.
6. Add a manual sync endpoint backed by sync engine and MockLedger fixtures; verify idempotent sync into invoices/mappings.
7. Replace the Xero cron entry in `server.js` with generic `syncScheduler.start()` after Xero connector parity tests pass.

## Migration notes

- Do not remove `XeroTenants`, `XeroSyncState`, `ReconLog`, or `fromXero` immediately. Run dual-write for Xero until generic sync logs and canonical fields are proven.
- Add a backfill script to create `IntegrationConnection` and `ExternalRecordMapping` rows from existing Xero data.
- Feature-flag the new connector framework: `CONNECTORS_V2_ENABLED=true`.
- For existing customers, show Xero as connected if either legacy Xero tenant or generic connection exists.
