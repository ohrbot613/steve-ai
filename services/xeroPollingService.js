const cron = require("node-cron");
const axios = require("axios");
const { AuthorizationCode } = require("simple-oauth2");
const XeroTenants = require("../modals/xeroTenantsModal");
const XeroSyncState = require("../modals/xeroSyncStateModal");
const ReconLog = require("../modals/reconLogModal");
const Invoice = require("../2.0/modals/invoiceModal");
const { nameSimilarity } = require("../2.0/scripts/scripts");

const MATCH_THRESHOLD = 0.8;

let isPolling = false;

// ─────────────────────────────────────────────────────────────────────────────
// Token helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve a valid Xero access token, refreshing if expired.
 * Returns { accessToken, tenantId } or null if Xero is not connected.
 */
async function getValidXeroToken() {
    const xeroTenant = await XeroTenants.findOne().lean();
    if (!xeroTenant?.authData?.refreshToken) {
        return null;
    }

    const client = new AuthorizationCode({
        client: {
            id: process.env.XERO_CLIENT_ID,
            secret: process.env.XERO_CLIENT_SECRET,
        },
        auth: {
            tokenHost: "https://identity.xero.com/connect/token",
            authorizePath: "https://login.xero.com/identity/connect/authorize",
            tokenPath: "/connect/token",
        },
    });

    const scope =
        xeroTenant.authData.scope ||
        "openid profile email offline_access accounting.contacts accounting.transactions accounting.reports.read";

    let tokenSet = client.createToken({
        access_token: xeroTenant.authData.accessToken,
        refresh_token: xeroTenant.authData.refreshToken,
        expires_at: xeroTenant.authData.expiryTime,
        token_type: "Bearer",
        scope,
    });

    if (tokenSet.expired()) {
        try {
            tokenSet = await tokenSet.refresh();
            const updateFields = {
                "authData.accessToken": tokenSet.token.access_token,
                "authData.refreshToken": tokenSet.token.refresh_token,
                "authData.expiryTime": tokenSet.token.expires_at,
                modifiedLast: Date.now(),
            };
            if (tokenSet.token.scope) {
                updateFields["authData.scope"] = tokenSet.token.scope;
            }
            await XeroTenants.findOneAndUpdate({ tenantId: xeroTenant.tenantId }, updateFields);
        } catch (err) {
            console.error("[XeroPoller] Token refresh failed:", err.message);
            return null;
        }
    }

    return {
        accessToken: tokenSet.token.access_token,
        tenantId: xeroTenant.tenantId,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Xero API fetch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all invoices from Xero modified since lastPolledAt.
 * Uses If-Modified-Since header for incremental polling.
 * Paginates through all pages with 300ms delay between pages.
 */
async function fetchNewXeroInvoices(accessToken, tenantId, lastPolledAt) {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
    };

    if (lastPolledAt) {
        // Remove milliseconds from ISO string per Xero API requirement
        headers["If-Modified-Since"] = new Date(lastPolledAt)
            .toISOString()
            .replace(/\.\d{3}Z$/, "Z");
    }

    const allInvoices = [];
    let page = 1;

    while (true) {
        const response = await axios.get(
            `https://api.xero.com/api.xro/2.0/Invoices?page=${page}&pageSize=100`,
            { headers }
        );

        const invoices = response.data?.Invoices || [];
        allInvoices.push(...invoices);

        if (invoices.length < 100) {
            break;
        }

        page++;
        // Avoid Xero rate limits
        await new Promise((r) => setTimeout(r, 300));
    }

    return allInvoices;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy ID matching (replicates upload logic)
// ─────────────────────────────────────────────────────────────────────────────

const idNoLetters = (s) => String(s ?? "").replace(/[a-zA-Z]/g, "");

/**
 * Score how well a statement record (fileInv) matches a Xero invoice number.
 * Asymmetric: fileInv has potentialInvoiceIds; xeroInv only has invoiceNumber.
 */
function getIdScore(fileInv, xeroInv) {
    const xeroNum = xeroInv.invoiceNumber ?? "";
    if (!xeroNum) return 0;
    const xeroDigits = idNoLetters(xeroNum);

    const potentialIds =
        Array.isArray(fileInv.potentialInvoiceIds) && fileInv.potentialInvoiceIds.length > 0
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

    return Math.round(best * 1e6) / 1e6;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert + reconcile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert each Xero invoice to MongoDB and fuzzy-match against statement records.
 * Returns { invoicesSaved, matchesWritten }.
 */
async function matchAndReconcile(xeroInvoices) {
    let invoicesSaved = 0;
    let matchesWritten = 0;

    for (const xeroInv of xeroInvoices) {
        const contactId = xeroInv.Contact?.ContactID || null;

        // Upsert the Xero invoice into invoices-2.0
        await Invoice.findOneAndUpdate(
            {
                invoiceNumber: xeroInv.InvoiceNumber,
                fromXero: true,
                contactId: contactId,
            },
            {
                $set: {
                    invoiceNumber: xeroInv.InvoiceNumber,
                    amount: xeroInv.SubTotal || xeroInv.Total || null,
                    status: xeroInv.Status === "PAID" ? "paid" : "unpaid",
                    currency: xeroInv.CurrencyCode || null,
                    date: xeroInv.DateString ? new Date(xeroInv.DateString) : null,
                    dueDate: xeroInv.DueDateString ? new Date(xeroInv.DueDateString) : null,
                    contactId: contactId,
                    description: xeroInv.LineItems?.[0]?.Description || null,
                    fromXero: true,
                    isDeleted: false,
                    modifiedLast: new Date(),
                },
            },
            { upsert: true, new: true }
        );
        invoicesSaved++;

        // Only match against statement records if there is a contactId
        if (!contactId) continue;

        const statementRecords = await Invoice.find({
            contactId: contactId,
            fromXero: false,
            isDeleted: { $ne: true },
        }).lean();

        if (statementRecords.length === 0) continue;

        let bestMatch = null;
        let bestScore = 0;

        for (const record of statementRecords) {
            const score = getIdScore(record, { invoiceNumber: xeroInv.InvoiceNumber });
            if (score > bestScore) {
                bestScore = score;
                bestMatch = record;
            }
        }

        if (bestScore >= MATCH_THRESHOLD && bestMatch) {
            await Invoice.findByIdAndUpdate(bestMatch._id, {
                $set: { invoiceNumber: xeroInv.InvoiceNumber },
            });
            matchesWritten++;
        }
    }

    return { invoicesSaved, matchesWritten };
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll cycle
// ─────────────────────────────────────────────────────────────────────────────

async function pollAndReconcile() {
    const startTime = Date.now();

    const tokenInfo = await getValidXeroToken();
    if (!tokenInfo) {
        console.log("[XeroPoller] Xero not connected — skipping cycle");
        return;
    }

    const { accessToken, tenantId } = tokenInfo;

    let syncState = await XeroSyncState.findOne().lean();
    const lastPolledAt = syncState?.lastPolledAt || null;

    // First run: set lastPolledAt to now so future cycles only get new invoices
    if (!lastPolledAt) {
        const now = new Date();
        await XeroSyncState.findOneAndUpdate(
            {},
            { $set: { lastPolledAt: now, lastSuccessAt: now } },
            { upsert: true }
        );
        console.log("[XeroPoller] First run — initialized sync timestamp, will fetch new invoices from next cycle");
        return;
    }

    const xeroInvoices = await fetchNewXeroInvoices(accessToken, tenantId, lastPolledAt);

    const now = new Date();

    if (xeroInvoices.length === 0) {
        // Nothing new — update timestamps and log a zero-count cycle
        await XeroSyncState.findOneAndUpdate(
            {},
            { $set: { lastPolledAt: now, lastSuccessAt: now } },
            { upsert: true }
        );
        await ReconLog.create({
            ranAt: new Date(startTime),
            durationMs: Date.now() - startTime,
            newInvoicesFetched: 0,
            invoicesSaved: 0,
            matchesWritten: 0,
        });
        return;
    }

    const { invoicesSaved, matchesWritten } = await matchAndReconcile(xeroInvoices);

    await XeroSyncState.findOneAndUpdate(
        {},
        { $set: { lastPolledAt: now, lastSuccessAt: now } },
        { upsert: true }
    );

    const durationMs = Date.now() - startTime;

    await ReconLog.create({
        ranAt: new Date(startTime),
        durationMs,
        newInvoicesFetched: xeroInvoices.length,
        invoicesSaved,
        matchesWritten,
    });

    console.log(
        `[XeroPoller] Cycle complete: ${xeroInvoices.length} fetched, ${invoicesSaved} saved, ${matchesWritten} matched (${durationMs}ms)`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lock wrapper
// ─────────────────────────────────────────────────────────────────────────────

async function runPollCycle() {
    if (isPolling) {
        console.log("[XeroPoller] Previous cycle still running — skipping");
        return;
    }

    isPolling = true;
    try {
        await pollAndReconcile();
    } catch (err) {
        console.error("[XeroPoller] Cycle error:", err.message);
        try {
            await ReconLog.create({
                ranAt: new Date(),
                durationMs: null,
                error: err.message,
            });
        } catch (logErr) {
            console.error("[XeroPoller] Failed to write error log:", logErr.message);
        }
    } finally {
        isPolling = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

exports.start = function start() {
    cron.schedule("*/30 * * * *", runPollCycle);
    console.log("[XeroPoller] Started — polling Xero every 30 minutes");
    // Fire an immediate cycle without blocking server startup
    runPollCycle();
};
