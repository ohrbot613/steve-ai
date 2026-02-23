# Phase 8: Auto-reconcile new Xero invoices on 30-minute polling with fuzzy statement matching - Research

**Researched:** 2026-02-23
**Domain:** Node.js background polling, Xero API invoices, MongoDB upsert patterns, React "last synced" indicator
**Confidence:** HIGH

## Summary

Phase 8 adds a background polling job that runs every 30 minutes, fetches new Xero invoices into MongoDB, and applies the existing fuzzy matching function from the statement upload feature to match those invoices against uploaded bank statement records (the `invoices-2.0` collection, `fromXero: false` records). When a match is found, the statement record is updated with the Xero invoice number. A "Last synced with Xero" timestamp is shown on the reconciliation dashboard.

The codebase already has all the pieces needed. The Xero token refresh logic lives in `AuthController.exportxeroTokenInfo` and reads from `XeroTenants` collection — this same pattern can be called directly in a background service without going through HTTP middleware. The fuzzy matching logic is `nameSimilarity` in `2.0/scripts/scripts.js`, used via `getIdScore` inside `completeInvoiceFileUploadLogic` in `2.0/controllers/invoiceController.js`. The matching threshold is 0.8. The polling infrastructure does not yet exist — this phase adds it.

The most important architectural decision is where to start the polling job. The existing `server.js` initializes MongoDB then starts Express. The poller must be started after MongoDB connects (so it can read/write documents) but is otherwise independent of the HTTP request cycle. The cleanest pattern is a dedicated `services/xeroPollingService.js` that exports a `start()` function, called from `server.js` after the DB connection is confirmed. Use `node-cron` (already a well-established pattern for this stack) for the scheduler. Use an in-memory boolean lock to prevent overlapping poll cycles.

**Primary recommendation:** Add `node-cron` to the project, create `services/xeroPollingService.js` that wraps the existing token refresh + Xero invoice fetch pattern, reuses `getIdScore` (or the same `nameSimilarity` logic) for matching, writes results to MongoDB, and stores the last-polled timestamp in a new `XeroSyncState` model. Expose a `/api/v2/dashboard/xero-sync-status` endpoint that returns `lastSyncedAt`. Render "Last synced with Xero: X min ago" in `SimpleApp.jsx`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Matching behavior
- Use the exact same fuzzy matching function from the statement upload feature — reuse, don't reimplement
- Same confidence threshold as upload — no separate threshold for auto-reconcile
- Match against ALL statement records (including already-matched ones) — if a new invoice is a better match, overwrite the existing invoice number
- When one invoice matches multiple statement records, pick the best (highest confidence) match only
- Only process NEW Xero invoices since last poll (track last-checked timestamp)
- Match fields: same fields the upload matching uses (amount + supplier name)
- Process all new invoices in one batch per cycle — no cap
- Main bank account only — don't scan across all connected Xero accounts
- Every new Xero invoice gets saved to MongoDB regardless of match status

#### Match updates
- On match: write only the Xero invoice number to the statement record (minimal update)
- No confidence score stored on the record
- No distinction between auto-matched and manually matched records
- Store all Xero invoice data needed to fill the existing modal requirements (supplier, amount, date, status, line items, etc.)

#### Visibility & logging
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-cron | ^3.0.3 | Schedule the 30-minute poll job | Most widely used Node.js cron library; pure JS; works in any Node process; simple lock pattern |
| mongoose | ^9.0.2 (already installed) | MongoDB models for sync state + reconciliation log | Already in project; no new DB driver needed |
| axios | ^1.13.2 (already installed) | Xero API HTTP calls | Already used throughout the project for all Xero calls |
| simple-oauth2 | ^5.1.0 (already installed) | Token refresh | Already powers `AuthController.xeroTokenInfo`; same client instantiation pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | — | All supporting tools already in package.json | No new packages beyond node-cron |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node-cron | `setInterval` (30 * 60 * 1000) | setInterval is simpler but doesn't survive process restart cleanly and doesn't support cron-syntax time anchoring (e.g. :00 and :30 exactly); node-cron ensures runs at :00 and :30 of every hour |
| node-cron | Agenda / Bull / BullMQ | These require Redis and add significant infra complexity; overkill for a single background job |
| node-cron | OS-level cron + HTTP endpoint | Requires server-level config; not portable; harder to lock |

**Installation:**
```bash
npm install node-cron
```

---

## Architecture Patterns

### Recommended Project Structure

New files:
```
services/
└── xeroPollingService.js   # New: 30-min poll loop, matching logic, log writes
modals/
├── xeroSyncStateModal.js   # New: stores lastPolledAt timestamp for "last synced" display
└── reconLogModal.js        # New: persistent log of each poll cycle (when ran, what matched)
```

Modified files:
```
server.js                   # Modified: call xeroPollingService.start() after DB connect
2.0/routes/dashboardRoutes.js  # Modified: add GET /xero-sync-status endpoint
client/src/pages/SimpleApp.jsx  # Modified: fetch and display "Last synced: X min ago"
```

### Pattern 1: Service Started from server.js After DB Connect

**What:** The polling service module exports a `start()` function. `server.js` calls it inside the `async ()` IIFE, after `mongoose.connect()` succeeds. This guarantees the DB is available when the first tick runs.

**When to use:** Any time you need a background process that requires the DB to be ready first.

**Example:**
```javascript
// server.js (modified)
const xeroPollingService = require('./services/xeroPollingService');

(async () => {
    try {
        await mongoose.connect(mongoUri, { ... });
        console.log("MongoDB connected successfully");

        // Start background Xero polling after DB is ready
        xeroPollingService.start();
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        process.exit(1);
    }
})()
```

### Pattern 2: node-cron with In-Memory Lock

**What:** Use an in-process boolean to prevent overlapping cycles. If a poll is already in progress when the next tick fires, skip it.

**When to use:** Any cron job where a cycle can take longer than the interval (e.g. Xero API is slow or many invoices to process).

**Example:**
```javascript
// services/xeroPollingService.js
const cron = require('node-cron');

let isPolling = false;

async function runPollCycle() {
    if (isPolling) {
        console.log('[XeroPoller] Skipping cycle — previous cycle still running');
        return;
    }
    isPolling = true;
    try {
        await pollAndReconcile();
    } catch (err) {
        // Silent: log to DB, retry next cycle
        console.error('[XeroPoller] Cycle error (will retry):', err.message);
    } finally {
        isPolling = false;
    }
}

function start() {
    // Run at :00 and :30 of every hour
    cron.schedule('*/30 * * * *', runPollCycle);
    console.log('[XeroPoller] Started — polling Xero every 30 minutes');
}

module.exports = { start };
```

### Pattern 3: Reuse Existing Xero Token Refresh

**What:** The existing `xeroTokenInfo` middleware in `AuthController.js` reads from `XeroTenants`, refreshes the token if expired, and writes the new token back. The same logic runs outside of HTTP middleware by calling it directly as a function. The existing code in `optionalXeroTokenInfo` is already close to a standalone function — extract the core into a utility.

**When to use:** Background job needs Xero access without an HTTP request context.

**Example:**
```javascript
// services/xeroPollingService.js
const { AuthorizationCode } = require('simple-oauth2');
const XeroTenants = require('../modals/xeroTenantsModal');

async function getValidXeroToken() {
    const client = new AuthorizationCode({
        client: { id: process.env.XERO_CLIENT_ID, secret: process.env.XERO_CLIENT_SECRET },
        auth: {
            tokenHost: 'https://identity.xero.com/connect/token',
            authorizePath: 'https://login.xero.com/identity/connect/authorize',
            tokenPath: '/connect/token',
        },
    });

    const xeroTenant = await XeroTenants.findOne().lean();
    if (!xeroTenant?.authData?.refreshToken) return null; // Not connected

    const scope = xeroTenant.authData.scope || "openid profile email offline_access accounting.contacts accounting.transactions accounting.reports.read";
    let tokenSet = client.createToken({
        access_token: xeroTenant.authData.accessToken,
        refresh_token: xeroTenant.authData.refreshToken,
        expires_at: xeroTenant.authData.expiryTime,
        token_type: 'Bearer',
        scope,
    });

    if (tokenSet.expired()) {
        tokenSet = await tokenSet.refresh();
        await XeroTenants.findOneAndUpdate(
            { tenantId: xeroTenant.tenantId },
            {
                'authData.accessToken': tokenSet.token.access_token,
                'authData.refreshToken': tokenSet.token.refresh_token,
                'authData.expiryTime': tokenSet.token.expires_at,
                modifiedLast: Date.now(),
            }
        );
    }

    return { accessToken: tokenSet.token.access_token, tenantId: xeroTenant.tenantId };
}
```

### Pattern 4: Fetch Only New Xero Invoices Using If-Modified-Since

**What:** The Xero REST API supports `If-Modified-Since` as an HTTP request header (not a query param). Pass an ISO string of the last poll timestamp to get only invoices modified since then. This is the correct way to implement incremental polling.

**When to use:** Every poll cycle after the first. On first run (no `lastPolledAt`), fetch all invoices.

**Example:**
```javascript
// Inside pollAndReconcile()
const xeroSyncState = await XeroSyncState.findOne().lean();
const lastPolledAt = xeroSyncState?.lastPolledAt || null;

const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Xero-tenant-id': tenantId,
    Accept: 'application/json',
};

// Only pass the header if we have a prior timestamp
if (lastPolledAt) {
    // Format: ISO 8601 string without milliseconds, e.g. "2026-02-23T10:00:00"
    const isoStr = new Date(lastPolledAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
    headers['If-Modified-Since'] = isoStr;
}

const response = await axios.get('https://api.xero.com/api.xro/2.0/Invoices', { headers });
const newInvoices = response.data.Invoices || [];
```

**Important:** The `If-Modified-Since` header returns invoices with `UpdatedDateUTC` after the specified timestamp. The first poll (no prior timestamp) will fetch all invoices — which is acceptable as the upsert-by-`xeroInvoiceId` pattern prevents duplicates.

### Pattern 5: Reuse nameSimilarity for Matching

**What:** The existing matching logic in `2.0/controllers/invoiceController.js` (`completeInvoiceFileUploadLogic`) uses `getIdScore` which calls `nameSimilarity` from `2.0/scripts/scripts.js`. For Phase 8, the "statement record" is a `fromXero: false` invoice in the `invoices-2.0` collection. The new Xero invoice (to be saved as `fromXero: true`) needs to be matched against existing `fromXero: false` records.

**The exact matching path in upload:**
```javascript
// From 2.0/controllers/invoiceController.js, completeInvoiceFileUploadLogic
const MATCH_THRESHOLD = 0.8;

const idNoLetters = (s) => String(s ?? "").replace(/[a-zA-Z]/g, "");
const getIdScore = (fileInv, xeroInv) => {
    const xeroNum = xeroInv.invoiceNumber ?? "";
    if (!xeroNum) return 0;
    const xeroDigits = idNoLetters(xeroNum);
    const potentialIds = Array.isArray(fileInv.potentialInvoiceIds) && fileInv.potentialInvoiceIds.length > 0
        ? fileInv.potentialInvoiceIds
        : [fileInv.invoiceNumber, fileInv.referenceId, fileInv.id].filter(Boolean);
    if (potentialIds.length === 0) return 0;
    let best = 0;
    for (const pid of potentialIds) {
        const p = String(pid).trim();
        if (!p) continue;
        const pDigits = idNoLetters(p);
        const sim = nameSimilarity(pDigits || p, xeroDigits || xeroNum);
        if (sim > best) best = sim;
    }
    return Math.round(best * 10 ** 6) / 10 ** 6;
};
```

**For Phase 8, the roles are inverted:** the NEW Xero invoice is the "incoming" item; the `fromXero: false` statement records are the "pool" to match against. The function to reuse is `nameSimilarity(digits(xeroInvoiceNumber), digits(statementRecord.invoiceNumber))`.

**Confirmed match threshold: 0.8** (same as upload, as decided).

### Pattern 6: Upsert Xero Invoices to MongoDB

**What:** For every new Xero invoice, upsert to `invoices-2.0` with `fromXero: true` using `xeroInvoiceId` (= Xero's `InvoiceID`) as the unique key. Then attempt matching against `fromXero: false` records.

**Example:**
```javascript
// Upsert Xero invoice to invoices-2.0
await Invoice.findOneAndUpdate(
    { invoiceNumber: xeroInvoice.InvoiceNumber, fromXero: true, contactId: xeroInvoice.Contact?.ContactID },
    {
        $set: {
            invoiceNumber: xeroInvoice.InvoiceNumber,
            amount: xeroInvoice.SubTotal || xeroInvoice.Total || null,
            status: xeroInvoice.Status === 'PAID' ? 'paid' : 'unpaid',
            currency: xeroInvoice.CurrencyCode || null,
            date: xeroInvoice.DateString ? new Date(xeroInvoice.DateString) : null,
            dueDate: xeroInvoice.DueDateString ? new Date(xeroInvoice.DueDateString) : null,
            contactId: xeroInvoice.Contact?.ContactID || null,
            description: xeroInvoice.LineItems?.[0]?.Description || null,
            fromXero: true,
            isDeleted: false,
        }
    },
    { upsert: true, new: true }
);
```

### Pattern 7: Write Xero Invoice Number to Best-Match Statement Record

**What:** On match, write only the `invoiceNumber` field of the Xero invoice to the `fromXero: false` statement record. This is the "minimal update" decision.

**Example:**
```javascript
// Find all fromXero: false records for this supplier
const statementRecords = await Invoice.find({
    contactId: xeroInv.Contact?.ContactID,
    fromXero: false,
    isDeleted: { $ne: true },
}).lean();

// Score each candidate
let bestMatch = null;
let bestScore = 0;
for (const record of statementRecords) {
    const score = getIdScore(record, { invoiceNumber: xeroInv.InvoiceNumber });
    if (score > bestScore) {
        bestScore = score;
        bestMatch = record;
    }
}

// Only match if above threshold
if (bestMatch && bestScore >= MATCH_THRESHOLD) {
    await Invoice.findByIdAndUpdate(bestMatch._id, {
        $set: { invoiceNumber: xeroInv.InvoiceNumber }
    });
}
```

**Note on "best match wins" for one-to-many:** When one Xero invoice matches multiple statement records, only write to the single highest-scoring one. The above loop naturally enforces this.

### Pattern 8: XeroSyncState and ReconLog MongoDB Models

**XeroSyncState** — a singleton document (one per app/tenant) storing last sync timestamp:
```javascript
// modals/xeroSyncStateModal.js
const xeroSyncStateSchema = new mongoose.Schema({
    lastPolledAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    modifiedLast: { type: Date, default: Date.now },
});
const XeroSyncState = mongoose.model("XeroSyncState", xeroSyncStateSchema);
```

**ReconLog** — one document per poll cycle:
```javascript
// modals/reconLogModal.js
const reconLogSchema = new mongoose.Schema({
    ranAt: { type: Date, default: Date.now },
    durationMs: { type: Number, default: null },
    newInvoicesFetched: { type: Number, default: 0 },
    invoicesSaved: { type: Number, default: 0 },
    matchesWritten: { type: Number, default: 0 },
    error: { type: String, default: null },
});
const ReconLog = mongoose.model("ReconLog", reconLogSchema);
```

### Pattern 9: "Last synced" Frontend Display

**What:** `SimpleApp.jsx` currently fetches dashboard data from `/api/v2/dashboard/stats` and other endpoints. Add a lightweight call to `/api/v2/dashboard/xero-sync-status` that returns `{ lastSyncedAt: ISOString | null }`. Display as "Last synced with Xero: X min ago" in the dashboard header area. Compute "X min ago" on the client using `Date.now()` vs `lastSyncedAt`.

**When to use:** On mount and no refresh needed — the value only updates every 30 minutes anyway.

**Example:**
```javascript
// Inside SimpleApp.jsx, alongside existing fetch calls
const [lastSyncedAt, setLastSyncedAt] = useState(null);

useEffect(() => {
    fetch('/api/v2/dashboard/xero-sync-status', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
            if (data?.lastSyncedAt) setLastSyncedAt(new Date(data.lastSyncedAt));
        })
        .catch(() => {}); // Silent on error
}, []);

function formatLastSynced(date) {
    if (!date) return 'Never synced';
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ago`;
}
// In JSX: "Last synced with Xero: {formatLastSynced(lastSyncedAt)}"
```

### Anti-Patterns to Avoid

- **Starting the poller before DB connects:** The IIFE in `server.js` is `async` and awaits `mongoose.connect()`. Call `xeroPollingService.start()` only inside the `try` block after the await resolves.
- **Creating a new `AuthorizationCode` client for every poll cycle:** Create it once at module load time or once per `getValidXeroToken()` call, not per invoice.
- **Fetching all invoices every 30 minutes without `If-Modified-Since`:** With many invoices, this can approach Xero's 60 req/min rate limit over time and wastes API budget.
- **Using the `xero-node` SDK directly:** The existing codebase uses raw `axios` calls to the Xero REST API — stay consistent. Do not introduce the `xero-node` SDK for this feature.
- **Storing the raw Xero `Invoice` object as Mixed in the existing `invoices-2.0` schema:** The `Invoice` model (`invoices-2.0`) has fixed typed fields. Map Xero fields to those fields explicitly. If you need the full raw data, add a separate `xeroRawData` Mixed field.
- **Matching across ALL suppliers in one query without filtering by contactId:** Filter `fromXero: false` records by `contactId` matching the Xero invoice's `Contact.ContactID`. Don't load the entire `invoices-2.0` collection into memory.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron/scheduling | Custom timer with drift correction | `node-cron` | Handles daylight saving, drift, start/stop API; battle-tested |
| Fuzzy matching | New string similarity function | `nameSimilarity` from `2.0/scripts/scripts.js` | Decision locked: reuse exact same function; already handles Levenshtein, word overlap, compact form, prefix/suffix |
| Token refresh | Manual OAuth token HTTP calls | Copy the `getValidXeroToken` pattern from `AuthController.js` | Already handles expiry check, refresh, DB write-back |
| Overlap prevention | Distributed lock (Redis) | In-memory `isPolling` boolean | Single Node.js process; no distributed deployment needed |
| "Last synced" time formatting | `moment.js` | Inline calculation: `Math.floor((Date.now() - date) / 60000)` | No new dependency; simple enough |

**Key insight:** The entire matching pipeline already exists. The only new code is the scheduling wrapper, the Xero fetch (already done in `InvoiceController.findMissedInvoices`), the upsert pattern, and the sync state model.

---

## Common Pitfalls

### Pitfall 1: If-Modified-Since Date Format

**What goes wrong:** Passing `new Date().toISOString()` produces `"2026-02-23T10:30:00.000Z"` — the milliseconds segment (`.000`) causes Xero to silently ignore the filter and return all invoices.

**Why it happens:** Xero expects ISO 8601 without milliseconds: `"2026-02-23T10:30:00Z"`.

**How to avoid:** Strip milliseconds before passing:
```javascript
const isoStr = new Date(lastPolledAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
// Produces: "2026-02-23T10:30:00Z" ✓
```

**Warning signs:** First incremental poll returns the same count as a full fetch.

### Pitfall 2: Poller Starts Before MongoDB Is Connected

**What goes wrong:** The first poll fires at :00 or :30 and tries to read `XeroSyncState` before Mongoose has connected. Mongoose queues the query but may time out or produce confusing errors.

**Why it happens:** `cron.schedule()` called before `await mongoose.connect()` resolves.

**How to avoid:** Call `xeroPollingService.start()` only inside the `try` block of `server.js` after `await mongoose.connect()` succeeds.

**Warning signs:** `MongoNotConnectedError` in logs on first server startup.

### Pitfall 3: Matching Direction is Inverted

**What goes wrong:** In the upload flow, `getIdScore(fileInv, xeroInv)` — the FILE invoice is the "query" and the XERO invoice is the "target". In Phase 8, the poll brings in NEW Xero invoices and matches them against existing FILE (statement) records. If you accidentally pass them the wrong way, scores are computed on the wrong pair.

**Why it happens:** The `getIdScore` function is asymmetric in how it handles `potentialInvoiceIds` — it reads them from the first argument (the "file" invoice). In Phase 8, the Xero invoice is the incoming item and may not have `potentialInvoiceIds`, so you should pass the statement record as the first argument:
```javascript
// Correct for Phase 8:
const score = getIdScore(statementRecord, { invoiceNumber: xeroInv.InvoiceNumber });
// statementRecord has potentialInvoiceIds (or at least invoiceNumber) from statement upload
```

**Warning signs:** Match rate of 0% despite obvious matches in the data.

### Pitfall 4: "Best match wins" Can Steal Matches

**What goes wrong:** One statement record has a high score against multiple Xero invoices. The polling loop processes Xero invoices sequentially, and each one tries to write to the best-matching statement record. The last Xero invoice to process "wins" the statement record, overwriting earlier matches.

**Why it happens:** Processing Xero invoices one at a time and writing immediately means multiple Xero invoices can compete for the same statement record.

**How to avoid:** The decision says "if a new invoice is a better match, overwrite" — which means the last write wins regardless. This is acceptable per the locked decision. However, within a single poll cycle, if two new Xero invoices score equally against the same statement record, the behavior is nondeterministic. This is acceptable.

**Warning signs:** Not applicable — the overwrite behavior is intentional.

### Pitfall 5: Xero Rate Limit During First Poll

**What goes wrong:** The first poll (no `lastPolledAt`) fetches ALL invoices across all suppliers. If the organization has thousands of invoices and you're paginating, you can hit Xero's 60 calls/minute limit.

**Why it happens:** No `If-Modified-Since` on first run = full fetch.

**How to avoid:** The existing `findMissedInvoices` code uses page-based pagination (`page=1&pageSize=100`) with a try/catch. Replicate this pattern. 60 requests/minute is generous — 600 invoices per minute at page size 100. Most organizations won't hit this in a single poll. But add a `XERO_PAGE_DELAY_MS = 300` delay between pages (already used in `2.0/scripts/scripts.js`).

**Warning signs:** 429 responses from Xero API on first startup.

### Pitfall 6: Duplicate Xero Invoice Records

**What goes wrong:** Two consecutive poll cycles both fetch the same invoice (e.g. if `If-Modified-Since` overlaps, or first poll has no filter). Two `fromXero: true` records exist for the same `InvoiceNumber + contactId`.

**Why it happens:** Using `Invoice.create()` instead of `findOneAndUpdate` with `upsert`.

**How to avoid:** Always use `findOneAndUpdate` with `{ upsert: true }` keyed on `{ invoiceNumber, fromXero: true, contactId }`. This is idempotent.

**Warning signs:** `invoices-2.0` collection growing faster than expected; duplicate invoice numbers in the dashboard.

---

## Code Examples

Verified patterns from official sources and direct codebase inspection:

### The Existing Fuzzy Match Function (from 2.0/scripts/scripts.js)
```javascript
// Source: /Users/shual/Desktop/Steve/Code/2.0/scripts/scripts.js, line 72
// nameSimilarity — returns 0..1, higher = more similar
function nameSimilarity(query, name) {
    const q = normalizeForCompare(query);
    const n = normalizeForCompare(name);
    if (!q.length) return 0;
    if (!n.length) return 0;
    if (q === n) return 1;
    // ... (compact form, substring, word overlap, Levenshtein)
    return Math.min(1, Math.max(0, score));
}
// MATCH_THRESHOLD = 0.8 (from completeInvoiceFileUploadLogic)
```

### getIdScore from Upload (the function to reuse)
```javascript
// Source: /Users/shual/Desktop/Steve/Code/2.0/controllers/invoiceController.js, line 437
const idNoLetters = (s) => String(s ?? "").replace(/[a-zA-Z]/g, "");
const getIdScore = (fileInv, xeroInv) => {
    const xeroNum = xeroInv.invoiceNumber ?? "";
    if (!xeroNum) return 0;
    const xeroDigits = idNoLetters(xeroNum);
    const potentialIds = Array.isArray(fileInv.potentialInvoiceIds) && fileInv.potentialInvoiceIds.length > 0
        ? fileInv.potentialInvoiceIds
        : [fileInv.invoiceNumber, fileInv.referenceId, fileInv.id].filter(Boolean);
    if (potentialIds.length === 0) return 0;
    let best = 0;
    for (const pid of potentialIds) {
        const p = String(pid).trim();
        if (!p) continue;
        const pDigits = idNoLetters(p);
        const sim = nameSimilarity(pDigits || p, xeroDigits || xeroNum);
        if (sim > best) best = sim;
    }
    return Math.round(best * 10 ** 6) / 10 ** 6;
};
// Usage in Phase 8: getIdScore(statementRecord, { invoiceNumber: xeroInvoice.InvoiceNumber })
```

### Xero Token Refresh (already in AuthController.js, extract pattern)
```javascript
// Source: /Users/shual/Desktop/Steve/Code/controllers/AuthController.js, line 193
// Same logic but called outside HTTP middleware:
const xeroTenant = await XeroTenants.findOne().lean();
if (!xeroTenant?.authData?.refreshToken) return null; // Not connected — skip cycle

let tokenSet = client.createToken({
    access_token: xeroTenant.authData.accessToken,
    refresh_token: xeroTenant.authData.refreshToken,
    expires_at: xeroTenant.authData.expiryTime,
    token_type: "Bearer",
    scope,
});

if (tokenSet.expired()) {
    tokenSet = await tokenSet.refresh();
    await XeroTenants.findOneAndUpdate(
        { tenantId: xeroTenant.tenantId },
        { 'authData.accessToken': tokenSet.token.access_token, ... }
    );
}
return { accessToken: tokenSet.token.access_token, tenantId: xeroTenant.tenantId };
```

### Fetch Invoices with If-Modified-Since
```javascript
// Source: Xero API docs + github.com/XeroAPI/xero-node/issues/198
const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Xero-tenant-id': tenantId,
    Accept: 'application/json',
};
if (lastPolledAt) {
    // Remove milliseconds — Xero requires no ms in the ISO string
    headers['If-Modified-Since'] = new Date(lastPolledAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
const response = await axios.get('https://api.xero.com/api.xro/2.0/Invoices', { headers });
const invoices = response.data.Invoices || [];
```

### node-cron 30-minute schedule
```javascript
// Source: npmjs.com/package/node-cron
const cron = require('node-cron');
// Runs at :00 and :30 of every hour (minutes 0 and 30)
cron.schedule('*/30 * * * *', async () => {
    // poll handler
});
```

### Dashboard Route for lastSyncedAt
```javascript
// New endpoint in 2.0/routes/dashboardRoutes.js + 2.0/controllers/dashboardController.js
exports.getXeroSyncStatus = tryCatchAsync(async (req, res) => {
    const state = await XeroSyncState.findOne().select('lastSuccessAt').lean();
    res.status(200).json({
        success: true,
        lastSyncedAt: state?.lastSuccessAt || null,
    });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual "Find missed invoices" button (per-supplier) | Automated 30-min background poll (all suppliers) | Phase 8 (this phase) | No user action required for Xero sync |
| Xero invoices only fetched on statement upload | Xero invoices polled independently on a schedule | Phase 8 | Invoices can be matched against uploaded statements without re-uploading |
| No "last synced" indicator | "Last synced with Xero: X min ago" in dashboard | Phase 8 | Users know the data freshness |

**Deprecated/outdated:**
- None — Phase 8 adds new infrastructure without removing anything

---

## Open Questions

1. **Which invoices collection is the authoritative "statement records" for this phase?**
   - What we know: The codebase has TWO invoice flows: (a) `invoices-2.0` collection used by the 2.0 dashboard + upload (`fromXero: false` = file, `fromXero: true` = Xero); (b) `supplierinvoices` collection used by the V1 supplier reconciliation dashboard. The CONTEXT.md says "match against uploaded bank statement records" and "update the statement record with the Xero invoice number."
   - What's unclear: The CONTEXT.md's Phase 7 was the reconciliation dashboard (`SimpleApp.jsx`), which reads from `invoices-2.0`. The "upload" feature that the fuzzy matching is reused from is `completeInvoiceFileUploadLogic` in `2.0/controllers/invoiceController.js`, which also writes to `invoices-2.0`.
   - Recommendation: **The target is `invoices-2.0`** — the `fromXero: false` records created by the statement upload feature. This is consistent with Phase 7's dashboard and the locked decision to "reuse the exact same fuzzy matching function from the statement upload feature."

2. **Should the poller match across ALL contacts or only suppliers with `fromXero: false` records?**
   - What we know: The decision says "main bank account only — don't scan across all connected Xero accounts." This is about multi-org, not about filtering by supplier.
   - What's unclear: Whether the poller should fetch ALL invoices from Xero (all contacts) or only for contacts that have existing `fromXero: false` records.
   - Recommendation: Fetch all invoices using `If-Modified-Since` (most efficient; Xero returns a single paginated list). Then for each invoice, only attempt matching if a `fromXero: false` record exists for the same `contactId`. This avoids doing work for contacts with no uploaded statements.

3. **Does matching by invoice number alone suffice, or should amount also be used?**
   - What we know: The locked decision says "match fields: same fields the upload matching uses (amount + supplier name)." However, `getIdScore` in `completeInvoiceFileUploadLogic` only scores by invoice number ID (not amount). The `scoreInvoiceMatch` function in scripts.js (line 843) scores id + date + amount combined — but this is NOT what the upload uses.
   - What's unclear: The "same fields the upload matching uses" appears to be invoice number ID only (via `getIdScore`), not amount + supplier name. The "supplier name" matching is done separately during vendor lookup, not during the invoice ID match step.
   - Recommendation: Reuse `getIdScore` exactly (invoice number only). The supplier context is already implicit because you filter by `contactId` before scoring. Note this discrepancy in planning for clarification.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase: `/Users/shual/Desktop/Steve/Code/2.0/scripts/scripts.js` — `nameSimilarity`, `getIdScore`, `MATCH_THRESHOLD = 0.8`, `findCloseInvoiceMatchesInDb`
- Direct codebase: `/Users/shual/Desktop/Steve/Code/2.0/controllers/invoiceController.js` — `completeInvoiceFileUploadLogic`, `getIdScore` usage, `MATCH_THRESHOLD = 0.8`
- Direct codebase: `/Users/shual/Desktop/Steve/Code/controllers/AuthController.js` — `xeroTokenInfo`, `optionalXeroTokenInfo`, token refresh pattern
- Direct codebase: `/Users/shual/Desktop/Steve/Code/modals/xeroTenantsModal.js` — token storage schema (`accessToken`, `refreshToken`, `expiryTime`)
- Direct codebase: `/Users/shual/Desktop/Steve/Code/server.js` — MongoDB connect + Express start pattern; where to hook in poller start
- Direct codebase: `/Users/shual/Desktop/Steve/Code/2.0/modals/invoiceModal.js` — `invoices-2.0` schema fields (`invoiceNumber`, `fromXero`, `contactId`, `amount`, `status`, `statementId`)
- Direct codebase: `/Users/shual/Desktop/Steve/Code/2.0/controllers/dashboardController.js` — existing dashboard endpoint pattern for adding `xero-sync-status`
- Direct codebase: `/Users/shual/Desktop/Steve/Code/client/src/pages/SimpleApp.jsx` — reconciliation dashboard where "last synced" indicator goes
- Direct codebase: `/Users/shual/Desktop/Steve/Code/package.json` — `node-cron` NOT currently installed; `axios`, `mongoose`, `simple-oauth2` already present

### Secondary (MEDIUM confidence)
- npmjs.com/package/node-cron — `*/30 * * * *` cron expression for every 30 minutes; in-memory lock pattern; `start()` API
- github.com/XeroAPI/xero-node/issues/198 — `If-Modified-Since` header usage; ISO string without milliseconds required; `toISOString()` pattern
- Xero Developer docs (via WebSearch) — 60 req/min rate limit, 5000 req/day per org per app; pagination support for invoices endpoint
- developer.xero.com/faq/limits — confirmed 60/min, 5000/day limits

### Tertiary (LOW confidence)
- None. All critical claims have been verified against the codebase or official sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `node-cron` is the clear choice; all other dependencies already in project; confirmed from package.json
- Architecture: HIGH — based on direct reading of all affected files; poller pattern is straightforward given existing token refresh code
- Fuzzy matching reuse: HIGH — `nameSimilarity` and `getIdScore` are directly readable from codebase; threshold of 0.8 confirmed
- Xero API `If-Modified-Since`: MEDIUM — confirmed via GitHub issues and community docs; exact date format validated (no ms)
- Pitfalls: HIGH — identified from actual code patterns and Xero API behavior documented in issues

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable stack; Xero API v2.0 is stable; node-cron 3.x is stable)
