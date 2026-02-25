const { tryCatchAsync } = require("../../controllers/ErrorController");
const { XeroClient } = require("xero-node");
const axios = require("axios");
const Vendor = require("../modals/vendorModal");
const Invoice = require("../modals/invoiceModal");
const Team = require("../modals/teamModal");
const User = require("../../modals/userModal");
const XeroSyncState = require("../../modals/xeroSyncStateModal");
const { logProcess } = require("../controllers/processLogController");

const PAGE_SIZE = 100;

/** Max vendors to load when doing similarity search (then score and take top N). */
const SIMILARITY_SEARCH_CANDIDATE_LIMIT = 3000;

/**
 * Levenshtein distance between two strings (edit distance).
 */
function levenshtein(a, b) {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

/**
 * Normalize name for comparison: treat "&" and "and" the same, lowercase, collapse spaces,
 * strip punctuation (e.g. S.R.L. -> srl).
 */
function normalizeForCompare(s) {
    return s
        .trim()
        .toLowerCase()
        .replace(/\s*&\s*/g, " and ")
        .replace(/[.\-,()'"\[\]\/\\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Compact form: no spaces or punctuation, lowercase. Used so "ettekaIP" matches "etteka ip group".
 */
function compactForm(s) {
    return s
        .toLowerCase()
        .replace(/\s*&\s*/g, "and")
        .replace(/[.\-,()'"\[\]\/\\\s]/g, "");
}

/**
 * Similarity score between 0 and 1 (higher = more similar).
 * - Exact and normalized match
 * - Bidirectional substring: full query vs short name (e.g. "ASTW SPECIALISED..." finds "ASTW") and vice versa
 * - Compact match: "ettekaIP" matches "etteka ip group" via "ettekaip" in "ettekaipgroup"
 * - First/key token: first word of query matching full vendor name (e.g. "astw" in query, vendor "ASTW")
 * - Word overlap and Levenshtein as fallback
 */
function nameSimilarity(query, name) {
    const q = normalizeForCompare(query);
    const n = normalizeForCompare(name);
    if (!q.length) return 0;
    if (!n.length) return 0;
    if (q === n) return 1;

    const cq = compactForm(query);
    const cn = compactForm(name);
    if (cq.length && cn.length) {
        if (cq === cn) return 1;
        if (cn.includes(cq)) return Math.max(0.92, 0.7 + 0.2 * (cq.length / cn.length));
        if (cq.includes(cn)) return Math.max(0.92, 0.7 + 0.2 * (cn.length / cq.length));
    }

    let score = 0;

    if (n.includes(q)) score = Math.max(score, 0.85);
    if (q.includes(n)) score = Math.max(score, 0.9);
    if (n.startsWith(q)) score = Math.max(score, 0.88);
    if (q.startsWith(n)) score = Math.max(score, 0.88);

    const qWords = q.split(/\s+/).filter(Boolean);
    const nWords = n.split(/\s+/).filter(Boolean);

    const wordMatches = (w) =>
        nWords.some((nw) => nw.startsWith(w) || nw.includes(w) || w.includes(nw) || w === nw);

    const firstToken = qWords[0];
    if (firstToken && firstToken.length >= 2) {
        if (n === firstToken) score = Math.max(score, 0.95);
        if (n.startsWith(firstToken + " ")) score = Math.max(score, 0.9);
        if (n.startsWith(firstToken)) score = Math.max(score, 0.82);
    }

    const WORD_WEIGHTS = [0.90, 0.90, 0.64, 0.46];
    const WEIGHT_AFTER_FOURTH = 0.2;
    let weightedWordScore = 0;
    for (let i = 0; i < qWords.length; i++) {
        if (!wordMatches(qWords[i])) continue;
        const w = i < 4 ? WORD_WEIGHTS[i] : WEIGHT_AFTER_FOURTH;
        weightedWordScore += w;
    }
    const maxWeighted = Math.min(4, qWords.length) < 4
        ? WORD_WEIGHTS.slice(0, qWords.length).reduce((a, b) => a + b, 0)
        : WORD_WEIGHTS.reduce((a, b) => a + b, 0) + Math.max(0, qWords.length - 4) * WEIGHT_AFTER_FOURTH;
    const normalizedWordScore = maxWeighted > 0 ? (weightedWordScore / maxWeighted) : 0;
    score = Math.max(score, 0.5 + 0.28 * normalizedWordScore);

    const matchingFromName = nWords.filter((nw) =>
        qWords.some((w) => nw.startsWith(w) || nw.includes(w) || w.includes(nw) || w === nw)
    );
    if (nWords.length > 0 && matchingFromName.length === nWords.length) {
        score = Math.max(score, 0.75);
    }

    const dist = levenshtein(q, n);
    const maxLen = Math.max(q.length, n.length);
    const levScore = 1 - dist / maxLen;
    score = Math.max(score, levScore);

    return Math.min(1, Math.max(0, score));
}

/** Delay ms between Xero page requests to avoid 429 rate limit. */
const XERO_PAGE_DELAY_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.getAllVenders = tryCatchAsync(async (req, res) => {
    const tenantId = req.xeroTenantId;
    const accessToken = req.xeroAccessToken;

    if (!tenantId || !accessToken) {
        return res.status(401).json({
            success: false,
            message: "Xero authentication required. Ensure you are connected to Xero.",
        });
    }

    const teamTenantId = req.user?.tenant != null ? String(req.user.tenant) : null;
    if (teamTenantId) {
        await Team.updateOne({ tenantId: teamTenantId }, { $set: { reloading: true } });
    }

    try {
    const xeroClient = new XeroClient();
    xeroClient.setTokenSet({ access_token: accessToken });

    const allSuppliers = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        let body;
        let retries = 0;
        const maxRetries = 5;

        while (true) {
            try {
                const result = await xeroClient.accountingApi.getContacts(
                    tenantId,
                    undefined, // ifModifiedSince
                    "IsSupplier==true", // where – only suppliers
                    undefined, // order
                    undefined, // iDs
                    page,
                    true, // includeArchived – get every supplier including archived
                    false, // summaryOnly
                    undefined, // searchTerm
                    PAGE_SIZE
                );
                body = result.body;
                break;
            } catch (err) {
                const status = err?.response?.statusCode;
                const retryAfter = parseInt(err?.response?.headers?.["retry-after"], 10) || 6;
                if (status === 429 && retries < maxRetries) {
                    retries += 1;
                    await sleep(retryAfter * 1000);
                } else {
                    throw err;
                }
            }
        }

        const contacts = body.contacts || [];
        allSuppliers.push(...contacts);
        console.log(`[getAllVendors] page ${page}: fetched ${contacts.length} contacts (total: ${allSuppliers.length})`);

        hasMore = contacts.length === PAGE_SIZE;
        page += 1;

        if (hasMore) {
            await sleep(XERO_PAGE_DELAY_MS);
        }
    }

    const now = new Date();
    // supplier: true only if our DB has at least one invoice with fromXero: false for this contact (nothing from Xero)
    const contactIdsWithFileInvoices = new Set(
        await Invoice.distinct("contactId", { fromXero: false, isDeleted: { $ne: true } })
    );

    const bulkOps = allSuppliers.map((contact) => {
        const pt = getSupplierPaymentTerms(contact);
        const paymentTerms = pt
            ? {
                day: pt.day,
                type: pt.type != null ? String(pt.type).toLowerCase() : null,
            }
            : { day: null, type: null };
        const supplierCurrency = contact?.defaultCurrency
            ? String(contact.defaultCurrency).toUpperCase()
            : "GBP";

        const isSupplier = contactIdsWithFileInvoices.has(contact.contactID);
        return {
            updateOne: {
                filter: { xeroId: contact.contactID },
                update: {
                    $set: {
                        name: contact.name || "Unknown",
                        email: contact.emailAddress || null,
                        modifiedLast: now,
                        paymentTerms,
                        supplier: isSupplier,
                        currency: supplierCurrency,
                    },
                    $setOnInsert: {
                        createdAt: now,
                    },
                },
                upsert: true,
            },
        };
    });

    if (bulkOps.length > 0) {
        await Vendor.bulkWrite(bulkOps);
    }

    try {
        await logProcess(
            `Reloaded suppliers from Xero (${allSuppliers.length} supplier(s) synced).`,
            [],
            req.user?._id
        );
    } catch (err) {
        console.error("[getAllVendors] process log failed:", err.message);
    }

    res.status(200).json({
        success: true,
        total: allSuppliers.length,
        message: `${allSuppliers.length} supplier(s) synced to vendors.`,
        suppliers: allSuppliers,
    });
    } finally {
        if (teamTenantId) {
            await Team.updateOne({ tenantId: teamTenantId }, { $set: { reloading: false } });
        }
    }
});

/**
 * Get bank balance from Xero for each bank account.
 * Uses the Reports API Bank Summary: GET api.xro/2.0/Reports/BankSummary
 * (via xero-node getReportBankSummary). Returns Statement Balance (Closing Bank Balance)
 * and Balance in Xero per account. Scope: accounting.reports.read
 * Optional query: fromDate, toDate (yyyy-MM-dd). Defaults to current month.
 */
exports.getBankBalance = tryCatchAsync(async (req, res) => {
    const tenantId = req.xeroTenantId;
    const accessToken = req.xeroAccessToken;

    if (!tenantId || !accessToken) {
        return res.status(401).json({
            success: false,
            message: "Xero authentication required. Ensure you are connected to Xero.",
        });
    }

    const xeroClient = new XeroClient();
    xeroClient.setTokenSet({ access_token: accessToken });

    const now = new Date();
    let fromDate = req.query.fromDate;
    let toDate = req.query.toDate;
    if (!toDate) toDate = now.toISOString().slice(0, 10);
    if (!fromDate) fromDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    let result;
    let retries = 0;
    const maxRetries = 5;
    while (true) {
        try {
            result = await xeroClient.accountingApi.getReportBankSummary(tenantId, fromDate, toDate);
            break;
        } catch (err) {
            const status = err?.response?.statusCode ?? err?.statusCode;
            const insufficientScope = (err?.response?.headers?.["www-authenticate"] || err?.headers?.["www-authenticate"] || "").includes("insufficient_scope");
            if (status === 401 && insufficientScope) {
                return res.status(403).json({
                    success: false,
                    code: "XERO_REPORTS_SCOPE_REQUIRED",
                    message: "Bank balance requires reconnecting Xero so the app can request Reports access.",
                });
            }
            const retryAfter = parseInt(err?.response?.headers?.["retry-after"] ?? err?.headers?.["retry-after"], 10) || 6;
            if (status === 429 && retries < maxRetries) {
                retries += 1;
                await sleep(retryAfter * 1000);
            } else {
                throw err;
            }
        }
    }

    const [orgResult, accountsResult] = await Promise.all([
        xeroClient.accountingApi.getOrganisations(tenantId),
        xeroClient.accountingApi.getAccounts(tenantId, undefined, 'Type=="BANK"'),
    ]);

    const baseCurrency = orgResult.body?.organisations?.[0]?.baseCurrency || "USD";
    const bankAccounts = accountsResult.body?.accounts || [];
    const accountLookup = {};
    for (const acc of bankAccounts) {
        accountLookup[acc.accountID] = {
            status: acc.status || "ACTIVE",
            currencyCode: acc.currencyCode || baseCurrency,
        };
    }

    const body = result.body;
    const reports = body?.reports || [];
    const accounts = [];
    let statementCol = -1;
    let xeroCol = -1;

    for (const report of reports) {
        const rows = report?.rows || [];
        for (const row of rows) {
            if (row.rowType === "Header" && row.cells) {
                for (let i = 0; i < row.cells.length; i++) {
                    const header = (row.cells[i]?.value || "").toLowerCase();
                    // Statement balance = Closing Bank Balance (real account amount) in report
                    if (statementCol < 0 && (header.includes("statement balance") || header.includes("closing bank balance"))) statementCol = i;
                    if (header.includes("balance in xero")) xeroCol = i;
                }
                break;
            }
        }
        if (statementCol < 0) statementCol = 1;

        for (const row of rows) {
            if (row.rowType === "Section" && row.rows) {
                for (const subRow of row.rows) {
                    if (subRow.rowType === "Row" && subRow.cells?.length >= 2) {
                        const name = subRow.cells[0]?.value ?? "";
                        const accountId = subRow.cells[0]?.attributes?.find((a) => a.id === "account")?.value;
                        const parseVal = (v) => {
                            if (v == null || v === "") return null;
                            const n = parseFloat(String(v).replace(/,/g, ""));
                            return isNaN(n) ? null : n;
                        };
                        const statementBalance = parseVal(subRow.cells[statementCol]?.value);
                        const xeroBalance = xeroCol >= 0 ? parseVal(subRow.cells[xeroCol]?.value) : null;
                        const meta = accountLookup[accountId] || { status: "ACTIVE", currencyCode: baseCurrency };
                        const balanceSource = xeroBalance != null ? "xero" : statementBalance != null ? "statement" : "unavailable";
                        accounts.push({
                            accountId,
                            name,
                            statementBalance,
                            xeroBalance,
                            balanceSource,
                            status: meta.status,
                            currencyCode: meta.currencyCode,
                            lastStatement: null,
                            statementBalanceDate: null,
                            accountBalance: xeroBalance,
                        });
                    }
                }
            }
        }
    }

    res.status(200).json({
        success: true,
        fromDate,
        toDate,
        baseCurrency,
        accounts,
    });
});

exports.getAllInvoices = tryCatchAsync(async (req, res) => {
    const tenantId = req.xeroTenantId;
    const accessToken = req.xeroAccessToken;

    const teamTenantId = req.user?.tenant != null ? String(req.user.tenant) : null;
    if (teamTenantId) {
        await Team.updateOne({ tenantId: teamTenantId }, { $set: { reloading: true } });
    }

    try {
    const xeroClient = new XeroClient();
    xeroClient.setTokenSet({ access_token: accessToken });

    const allInvoices = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        let body;
        let retries = 0;
        const maxRetries = 5;

        while (true) {
            try {
                const result = await xeroClient.accountingApi.getInvoices(
                    tenantId,
                    undefined, // ifModifiedSince
                    undefined, // where
                    undefined, // order
                    undefined, // iDs
                    undefined, // invoiceNumbers
                    undefined, // contactIDs
                    undefined, // statuses
                    page,
                    true, // includeArchived
                    undefined, // createdByMyApp
                    undefined, // unitdp
                    false, // summaryOnly
                    PAGE_SIZE,
                    undefined  // searchTerm
                );
                body = result.body;
                break;
            } catch (err) {
                console.log("err", err);
                const status = err?.statusCode ?? err?.response?.statusCode;
                const retryAfter = parseInt(err?.headers?.["retry-after"] ?? err?.response?.headers?.["retry-after"], 10) || 6;
                if (status === 429 && retries < maxRetries) {
                    retries += 1;
                    await sleep(retryAfter * 1000);
                } else if (retries < maxRetries && (!status || status >= 500)) {
                    retries += 1;
                    await sleep(retryAfter * 1000);
                } else {
                    throw err;
                }
            }
        }

        const invoices = body.invoices || [];
        allInvoices.push(...invoices);
        console.log(`[getAllInvoices] page ${page}: fetched ${invoices.length} invoices (total: ${allInvoices.length})`);

        hasMore = invoices.length === PAGE_SIZE;
        page += 1;

        if (hasMore) {
            await sleep(XERO_PAGE_DELAY_MS);
        }
    }

    const now = new Date();
    const bulkOps = allInvoices.map((inv) => {
        const paymentStatus = inv.amountDue === 0 || (inv.amountPaid != null && inv.amountPaid >= (inv.total || 0))
            ? "paid"
            : "unpaid";
        const invoiceNumber = inv.invoiceNumber || inv.invoiceID || `xero-${inv.invoiceID}`;
        return {
            updateOne: {
                filter: { invoiceNumber },
                update: {
                    $set: {
                        invoiceNumber,
                        amount: inv.total ?? null,
                        status: paymentStatus,
                        jobNumber: inv.reference || null,
                        description: inv.lineItems?.[0]?.description || null,
                        contactId: inv.contact?.contactID || null,
                        currency: inv.currencyCode || null,
                        date: inv.date ? new Date(inv.date) : null,
                        dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
                        fromXero: true,
                        modifiedLast: now,
                    },
                },
                upsert: true,
            },
        };
    });

    if (bulkOps.length > 0) {
        await Invoice.bulkWrite(bulkOps);
    }

    res.status(200).json({
        success: true,
        total: allInvoices.length,
        message: `${allInvoices.length} invoice(s) synced from Xero.`,
        invoices: allInvoices,
    });
    } finally {
        if (teamTenantId) {
            await Team.updateOne({ tenantId: teamTenantId }, { $set: { reloading: false } });
        }
    }
});

/**
 * Fire-and-forget: if team.updateInXeroInProgress is false and team.lastXeroLookup is older than 30 min, fetch invoices from Xero modified since then and upsert to DB. Call with req (must have req.user, req.xeroAccessToken, req.xeroTenantId). Uses team.updateInXeroInProgress so only one sync runs per tenant (works across processes).
 */
exports.syncIncrementalInvoicesFromXero = async function syncIncrementalInvoicesFromXero(req, options = {}) {
    const force = Boolean(options?.force);
    const teamTenantId = req.user?.tenant != null ? String(req.user.tenant) : null;
    if (!teamTenantId) return { success: false, skipped: true, reason: "no_tenant" };
    const team = await Team.findOne({ tenantId: teamTenantId }).lean();
    if (!team) return { success: false, skipped: true, reason: "team_not_found" };
console.log('team.updateInXeroInProgress', team.updateInXeroInProgress)
    if (team.updateInXeroInProgress) return { success: false, skipped: true, reason: "in_progress" };

    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
    const lastLookupMs = team.lastXeroLookup ? new Date(team.lastXeroLookup).getTime() : 0;
    const isWithinLast30Min = lastLookupMs >= thirtyMinAgo;
console.log('isWithinLast30Min', isWithinLast30Min)
    if (!force && isWithinLast30Min) return { success: true, skipped: true, reason: "within_30_min" };
    if (!req.xeroAccessToken || !req.xeroTenantId) return { success: false, skipped: true, reason: "missing_xero_auth" };

    await Team.updateOne({ tenantId: teamTenantId }, { $set: { updateInXeroInProgress: true } });
    try {

    const ifModifiedSince = team.lastXeroLookup ? new Date(team.lastXeroLookup) : new Date(thirtyMinAgo);
    const tenantId = req.xeroTenantId;
    const xeroClient = new XeroClient();
    xeroClient.setTokenSet({ access_token: req.xeroAccessToken });

    const allInvoices = [];
    let page = 1;
    let hasMore = true;

    const maxRetries = 5;

    while (hasMore) {
        let result;
        let retries = 0;
        while (true) {
            try {
                result = await xeroClient.accountingApi.getInvoices(
                    tenantId,
                    ifModifiedSince,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    page,
                    true,
                    undefined,
                    undefined,
                    false,
                    PAGE_SIZE,
                    undefined
                );
                break;
            } catch (err) {
                const status = err?.response?.statusCode ?? err?.statusCode;
                const retryAfterSec = parseInt(err?.response?.headers?.["retry-after"] ?? err?.headers?.["retry-after"], 10) || 6;
                const isRateLimit = status === 429;
                const isServerError = status && status >= 500;
                if ((isRateLimit || isServerError) && retries < maxRetries) {
                    retries += 1;
                    await sleep(retryAfterSec * 1000);
                } else {
                    console.error("[API 2.0] incremental invoice fetch error:", err?.message || err);
                    throw err;
                }
            }
        }
        const invoices = result.body?.invoices || [];
        allInvoices.push(...invoices);
        hasMore = invoices.length === PAGE_SIZE;
        console.log(page)
        page += 1;
        if (hasMore) await sleep(XERO_PAGE_DELAY_MS);
    }

    if (allInvoices.length > 0) {
        const now = new Date();
        const invoiceNumbers = allInvoices.map((inv) => inv.invoiceNumber || inv.invoiceID || `xero-${inv.invoiceID}`);
        const existingFromXero = await Invoice.find({ invoiceNumber: { $in: invoiceNumbers }, fromXero: true })
            .select("_id invoiceNumber")
            .lean();
        const existingByNumber = new Map(existingFromXero.map((doc) => [doc.invoiceNumber, doc._id]));

        const bulkOps = [];
        for (const inv of allInvoices) {
            const paymentStatus = inv.amountDue === 0 || (inv.amountPaid != null && inv.amountPaid >= (inv.total || 0)) ? "paid" : "unpaid";
            const invoiceNumber = inv.invoiceNumber || inv.invoiceID || `xero-${inv.invoiceID}`;
            const doc = {
                invoiceNumber,
                amount: inv.total ?? null,
                status: paymentStatus,
                jobNumber: inv.reference || null,
                description: inv.lineItems?.[0]?.description || null,
                contactId: inv.contact?.contactID || null,
                currency: inv.currencyCode || null,
                date: inv.date ? new Date(inv.date) : null,
                dueDate: inv.dueDate ? new Date(inv.dueDate) : null,
                fromXero: true,
                modifiedLast: now,
            };
            const existingId = existingByNumber.get(invoiceNumber);
            if (existingId) {
                bulkOps.push({ updateOne: { filter: { _id: existingId }, update: { $set: doc } } });
            } else {
                bulkOps.push({ insertOne: { document: doc } });
            }
        }
        await Invoice.bulkWrite(bulkOps);
        console.log("[API 2.0] incremental sync: upserted", allInvoices.length, "invoice(s) from Xero since", ifModifiedSince.toISOString());
    }

    const now = new Date();
    await Team.updateOne({ tenantId: teamTenantId }, { $set: { lastXeroLookup: now } });
    await XeroSyncState.findOneAndUpdate(
        {},
        { $set: { lastPolledAt: now, lastSuccessAt: now, modifiedLast: now } },
        { upsert: true }
    );
    return { success: true, skipped: false, syncedCount: allInvoices.length, lastSyncedAt: now };
    } finally {
        await Team.updateOne({ tenantId: teamTenantId }, { $set: { updateInXeroInProgress: false } });
    }
};

/**
 * Get all invoices from the supplier (vendor) that are from Xero (fromXero: true),
 * put them in a matrix, and find items closest to the target id (invoice number) and amount.
 * Params: vendorId (Vendor _id or Xero contact id).
 * Query/body: id (target invoice number to match), amount (target amount to match). At least one required.
 */
exports.findInvoiceById = tryCatchAsync(async (req, res) => {
    const { vendorId } = req.params;
    const targetId = (req.query?.id ?? req.body?.id ?? "").toString().trim();
    const targetAmount = parseFloat(req.query?.amount ?? req.body?.amount);
    const hasAmount = Number.isFinite(targetAmount);

    if (!vendorId) {
        return res.status(400).json({ success: false, message: "Vendor id is required." });
    }
    if (!targetId && !hasAmount) {
        return res.status(400).json({ success: false, message: "Target id (invoice number) or amount is required." });
    }

    let vendorXeroId = vendorId;
    if (vendorId.length === 24 && /^[a-f0-9]{24}$/i.test(vendorId)) {
        const vendor = await Vendor.findById(vendorId).select("xeroId").lean();
        if (!vendor) {
            return res.status(404).json({ success: false, message: "Vendor not found." });
        }
        vendorXeroId = vendor.xeroId;
    }

    const matrix = await Invoice.find({
        contactId: vendorXeroId,
        fromXero: true,
        isDeleted: { $ne: true },
    })
        .lean();

    if (matrix.length === 0) {
        return res.status(200).json({
            success: true,
            matrix: [],
            closest: [],
            message: "No Xero invoices found for this supplier.",
        });
    }

    const idWeight = targetId ? (hasAmount ? 0.5 : 1) : 0;
    const amountWeight = hasAmount ? (targetId ? 0.5 : 1) : 0;

    const idNoLetters = (s) => String(s || "").replace(/[a-zA-Z]/g, "");

    const withScores = matrix.map((inv) => {
        let idScore = 0;
        if (targetId && inv.invoiceNumber) {
            const targetIdDigits = idNoLetters(targetId);
            const invIdDigits = idNoLetters(inv.invoiceNumber);
            idScore = nameSimilarity(targetIdDigits, invIdDigits);
        }

        let amountScore = 0;
        if (hasAmount && inv.amount != null) {
            const diff = Math.abs(Number(inv.amount) - targetAmount);
            const scale = Math.max(Math.abs(targetAmount), 1, Math.abs(inv.amount));
            amountScore = Math.max(0, 1 - diff / scale);
        }

        const combinedScore = idWeight * idScore + amountWeight * amountScore;
        return {
            ...inv,
            idScore: Math.round(idScore * 1000) / 1000,
            amountScore: Math.round(amountScore * 1000) / 1000,
            combinedScore: Math.round(combinedScore * 1000) / 1000,
        };
    });

    withScores.sort((a, b) => b.combinedScore - a.combinedScore);
    const closest = withScores.slice(0, 10);

    res.status(200).json({
        success: true,
        matrix: withScores,
        closest,
        message: `${matrix.length} invoice(s) from this supplier; returning closest matches to id and amount.`,
    });
});

/**
 * Run search-similar-names logic for a query. Returns { query, limit, matches }.
 * Used by both the route and invoice upload (to search vendors by first company name).
 */
async function searchSimilarVendors(query, limit = 10) {
    const q = String(query || "").trim();
    const lim = Math.min(Math.max(1, parseInt(limit, 10) || 10), 50);

    const candidates = await Vendor.find({ isDeleted: { $ne: true } })
        .select("name xeroId email")
        .limit(SIMILARITY_SEARCH_CANDIDATE_LIMIT)
        .lean();

    const scored = candidates.map((v) => ({
        ...v,
        score: nameSimilarity(q, v.name),
    }));

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, lim).map(({ score, ...v }) => ({
        ...v,
        score: Math.round(score * 1000) / 1000,
        similarityToQuery: Math.round(score * 1000) / 1000,
    }));

    const CLOSE_THRESHOLD = 0.8;
    const withCloseRanks = top.map((match, i) => {
        const closeMatches = [];
        for (let j = 0; j < top.length; j++) {
            if (i === j) continue;
            const sim = nameSimilarity(match.name, top[j].name);
            if (sim >= CLOSE_THRESHOLD) {
                closeMatches.push({
                    name: top[j].name,
                    similarity: Math.round(sim * 1000) / 1000,
                });
            }
        }
        closeMatches.sort((a, b) => b.similarity - a.similarity);
        const closeRank =
            closeMatches.length === 0
                ? "unique"
                : closeMatches[0].similarity >= 0.95
                  ? "very close to others"
                  : closeMatches[0].similarity >= 0.85
                    ? "close to others"
                    : "somewhat similar to others";
        return {
            ...match,
            closeMatches,
            closeRank,
        };
    });

    return { query: q, limit: lim, matches: withCloseRanks };
}

/** Strip letters for invoice-number comparison (same as findInvoiceById). */
function idNoLetters(s) {
    return String(s || "").replace(/[a-zA-Z]/g, "");
}

/**
 * For each file invoice, find close matches in the 2.0 DB by invoice number.
 * If options.contactIds is provided, only considers invoices from those suppliers (Xero contact ids).
 * Returns array of { fileInvoice, fileInvoiceNumber, matches: [ { dbInvoice, matchScore }, ... ] }.
 * Only includes matches with matchScore >= threshold (default 0.8).
 */
async function findCloseInvoiceMatchesInDb(fileInvoices, options = {}) {
    const threshold = Number(options.threshold) || 0.8;
    const maxDb = Math.min(Math.max(1, parseInt(options.maxDb, 10) || 20000), 50000);
    const contactIds = Array.isArray(options.contactIds) ? options.contactIds.filter(Boolean) : null;

    const list = Array.isArray(fileInvoices) ? fileInvoices : [];
    if (!list.length) return [];

    const query = { isDeleted: { $ne: true }, fromXero: true };
    if (contactIds && contactIds.length > 0) {
        query.contactId = { $in: contactIds };
    }
    const dbInvoices = await Invoice.find(query)
        .limit(maxDb)
        .lean();

    return list.map((fileInv) => {
        const fileNum = fileInv.invoiceNumber ?? fileInv.referenceId ?? fileInv.id ?? "";
        const fileNumStr = String(fileNum).trim();
        const fileNumDigits = idNoLetters(fileNumStr);

        const matches = [];
        if (fileNumStr || fileNumDigits) {
            for (const dbInv of dbInvoices) {
                const dbNum = dbInv.invoiceNumber || "";
                if (!dbNum) continue;
                const dbNumDigits = idNoLetters(dbNum);
                const score = nameSimilarity(fileNumDigits || fileNumStr, dbNumDigits || dbNum);
                if (score >= threshold) {
                    matches.push({
                        dbInvoice: dbInv,
                        matchScore: Math.round(score * 1000) / 1000,
                    });
                }
            }
            matches.sort((a, b) => b.matchScore - a.matchScore);
        }

        return {
            fileInvoice: fileInv,
            fileInvoiceNumber: fileNumStr || null,
            matches,
        };
    });
}

/**
 * Score how well a file invoice matches a DB (Xero) invoice on id, date, and amount.
 * Returns { idScore, dateScore, amountScore, combinedScore } (0–1 each).
 * combinedScore uses weights: id 0.5, date 0.25, amount 0.25.
 */
function scoreInvoiceMatch(fileInvoice, fileDate, dbInvoice) {
    const idNoLetters = (s) => String(s || "").replace(/[a-zA-Z]/g, "");
    const fileNum = fileInvoice.invoiceNumber ?? fileInvoice.referenceId ?? fileInvoice.id ?? "";
    const fileNumStr = String(fileNum).trim();
    const fileNumDigits = idNoLetters(fileNumStr);
    const dbNum = dbInvoice.invoiceNumber || "";
    const dbNumDigits = idNoLetters(dbNum);

    let idScore = 0;
    if ((fileNumStr || fileNumDigits) && dbNum) {
        idScore = nameSimilarity(fileNumDigits || fileNumStr, dbNumDigits || dbNum);
    }

    let dateScore = 0;
    if (fileDate && dbInvoice.date) {
        const fileMs = fileDate.getTime ? fileDate.getTime() : new Date(fileDate).getTime();
        const dbMs = dbInvoice.date.getTime ? dbInvoice.date.getTime() : new Date(dbInvoice.date).getTime();
        const daysDiff = Math.abs(fileMs - dbMs) / (24 * 60 * 60 * 1000);
        dateScore = Math.max(0, 1 - daysDiff / 365);
    }

    let amountScore = 0;
    const fileAmount = parseFloat(fileInvoice.amount ?? fileInvoice.total ?? fileInvoice.amountDue);
    const dbAmount = dbInvoice.amount != null ? Number(dbInvoice.amount) : NaN;
    if (Number.isFinite(fileAmount) && Number.isFinite(dbAmount)) {
        const diff = Math.abs(fileAmount - dbAmount);
        const scale = Math.max(Math.abs(fileAmount), Math.abs(dbAmount), 1);
        amountScore = Math.max(0, 1 - diff / scale);
    }

    const ID_WEIGHT = 0.5;
    const DATE_WEIGHT = 0.25;
    const AMOUNT_WEIGHT = 0.25;
    const combinedScore =
        ID_WEIGHT * idScore + DATE_WEIGHT * dateScore + AMOUNT_WEIGHT * amountScore;

    return {
        idScore: Math.round(idScore * 1000) / 1000,
        dateScore: Math.round(dateScore * 1000) / 1000,
        amountScore: Math.round(amountScore * 1000) / 1000,
        combinedScore: Math.round(combinedScore * 1000) / 1000,
    };
}

exports.searchSimilarVendors = searchSimilarVendors;
exports.findCloseInvoiceMatchesInDb = findCloseInvoiceMatchesInDb;
exports.scoreInvoiceMatch = scoreInvoiceMatch;
exports.nameSimilarity = nameSimilarity;

exports.searchSimilarNames = tryCatchAsync(async (req, res) => {
    const q = (req.body?.q ?? req.query?.q ?? "").toString().trim();
    const limit = Math.min(
        Math.max(1, parseInt(req.body?.limit ?? req.query?.limit ?? 10, 10) || 10),
        50
    );

    if (!q) {
        return res.status(400).json({
            success: false,
            message: "Query 'q' is required (name or partial name to search).",
        });
    }

    const data = await searchSimilarVendors(q, limit);
    res.status(200).json({
        success: true,
        ...data,
    });
});

/**
 * Extract supplier aging policy (default payment terms for bills) from a Xero contact.
 * Uses PaymentTerms.Bills: Day = number of days, Type = e.g. OFFOLLOWINGMONTH.
 * GET Contacts/{ContactID} returns this; scope: accounting.contacts or accounting.contacts.read.
 */
function getSupplierPaymentTerms(contact) {
    const bills = contact?.paymentTerms?.bills ?? contact?.PaymentTerms?.Bills ?? null;
    if (!bills) return null;
    return {
        day: bills.day ?? bills.Day ?? null,
        type: bills.type ?? bills.Type ?? null,
    };
}

const DEFAULT_PAYMENT_DAYS = 90;

/**
 * Convert Xero PaymentTerms.Bills (Day + Type) to a single "allowed days to pay" number.
 * If null or missing, returns DEFAULT_PAYMENT_DAYS (90).
 */
function paymentTermsToDays(contact) {
    const pt = getSupplierPaymentTerms(contact);
    if (!pt || (pt.day == null && pt.type == null)) return DEFAULT_PAYMENT_DAYS;
    const day = pt.day != null ? Number(pt.day) : 0;
    const type = (pt.type || "").toLowerCase();
    switch (type) {
        case "daysafterbilldate":
            return day > 0 ? day : DEFAULT_PAYMENT_DAYS;
        case "offollowingmonth":
        case "daysafterbillmonth":
            return 30 + (day > 0 ? day : 0);
        case "ofcurrentmonth":
            return day > 0 ? day : DEFAULT_PAYMENT_DAYS;
        default:
            return day > 0 ? day : DEFAULT_PAYMENT_DAYS;
    }
}

/**
 * Get a single supplier (contact) from Xero by contact ID.
 * Query: contactId (required).
 */
exports.getOneSupplier = tryCatchAsync(async (req, res) => {
    const tenantId = req.xeroTenantId;
    const accessToken = req.xeroAccessToken;
    const contactId = (req.query?.contactId ?? req.query?.id ?? "").toString().trim();

    if (!tenantId || !accessToken) {
        return res.status(401).json({
            success: false,
            message: "Xero authentication required.",
        });
    }
    if (!contactId) {
        return res.status(400).json({
            success: false,
            message: "Query 'contactId' or 'id' is required.",
        });
    }

    const xeroClient = new XeroClient();
    xeroClient.setTokenSet({ access_token: accessToken });
    const result = await xeroClient.accountingApi.getContact(tenantId, contactId);
    const contact = result?.body?.contacts?.[0] ?? null;

    if (!contact) {
        return res.status(404).json({
            success: false,
            message: "Supplier not found.",
        });
    }

    const paymentTerms = getSupplierPaymentTerms(contact);

    res.status(200).json({
        success: true,
        supplier: contact,
        paymentTerms: paymentTerms,
    });
});

/**
 * Testing: get one random supplier from Xero and return all their details.
 * Fetches suppliers (IsSupplier==true), picks one at random, then gets full contact details.
 */
exports.getOneRandomSupplierDetails = tryCatchAsync(async (req, res) => {
    const tenantId = req.xeroTenantId;
    const accessToken = req.xeroAccessToken;

    if (!tenantId || !accessToken) {
        return res.status(401).json({
            success: false,
            message: "Xero authentication required.",
        });
    }

    const xeroClient = new XeroClient();
    xeroClient.setTokenSet({ access_token: accessToken });

    const result = await xeroClient.accountingApi.getContacts(
        tenantId,
        undefined,
        "IsSupplier==true",
        undefined,
        undefined,
        1,
        true,
        false,
        undefined,
        Math.min(PAGE_SIZE, 100)
    );
    const contacts = result?.body?.contacts ?? [];

    if (contacts.length === 0) {
        return res.status(404).json({
            success: false,
            message: "No suppliers found in Xero.",
        });
    }

    const randomIndex = Math.floor(Math.random() * contacts.length);
    const picked = contacts[randomIndex];
    const contactId = picked.contactID;

    const detailResult = await xeroClient.accountingApi.getContact(tenantId, contactId);
    const fullContact = detailResult?.body?.contacts?.[0] ?? picked;

    const paymentTerms = getSupplierPaymentTerms(fullContact);

    res.status(200).json({
        success: true,
        message: "One random supplier with full details.",
        supplier: fullContact,
        paymentTerms: paymentTerms,
    });
});

/**
 * Get a single supplier by name from Xero. Query: name (e.g. "Aird & McBurney LP").
 */
exports.getSupplierByName = tryCatchAsync(async (req, res) => {
    const tenantId = req.xeroTenantId;
    const accessToken = req.xeroAccessToken;
    const name = (req.query?.name ?? req.query?.q ?? "").toString().trim();

    if (!tenantId || !accessToken) {
        return res.status(401).json({
            success: false,
            message: "Xero authentication required.",
        });
    }
    if (!name) {
        return res.status(400).json({
            success: false,
            message: "Query 'name' or 'q' is required.",
        });
    }

    const xeroClient = new XeroClient();
    xeroClient.setTokenSet({ access_token: accessToken });

    const result = await xeroClient.accountingApi.getContacts(
        tenantId,
        undefined,
        "IsSupplier==true",
        undefined,
        undefined,
        1,
        true,
        false,
        name,
        PAGE_SIZE
    );
    const contacts = result?.body?.contacts ?? [];

    const contactName = (c) => (c.name || c.Name || "").trim();
    const exact = contacts.find((c) => contactName(c).toLowerCase() === name.toLowerCase());
    const match = exact ?? contacts[0];

    if (!match) {
        return res.status(404).json({
            success: false,
            message: `No supplier found matching "${name}".`,
        });
    }

    const detailResult = await xeroClient.accountingApi.getContact(tenantId, match.contactID);
    const fullContact = detailResult?.body?.contacts?.[0] ?? match;
    const paymentTerms = getSupplierPaymentTerms(fullContact);

    res.status(200).json({
        success: true,
        supplier: fullContact,
        paymentTerms: paymentTerms,
    });
});

/**
 * Payment run invoice: find duplicate invoices (same invoiceNumber + amount, 2+ docs),
 * return as mini-arrays and include team balance for the user's tenant.
 */
exports.paymentRunInvoice = tryCatchAsync(async (req, res) => {
    const user = await User.findById(req.user._id).select("tenant").lean();
    const tenantId = user?.tenant != null ? String(user.tenant) : req.xeroTenantId;
    const accessToken = req.xeroAccessToken;

    const grouped = await Invoice.aggregate([
        { $match: { isDeleted: false } },
        {
            $group: {
                _id: { invoiceNumber: "$invoiceNumber", amount: "$amount" },
                count: { $sum: 1 },
                docs: { $push: "$$ROOT" },
            },
        },
        { $match: { count: { $gte: 2 } } },
    ]);

    const invoices = grouped.map((g) =>
        g.docs.sort((a, b) => new Date(a.date) - new Date(b.date))
    );

    let balance = null;
    if (tenantId) {
        const team = await Team.findOne({ tenantId })
        balance = team?.bankBalance != null ? team.bankBalance - 100000 : null;
    }

    if(balance == null || balance === 0) {
        return res.status(200).json({
            success: false,
            message: "Under or at minimum balance could not do any payment runs"
        });
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const msPerDay = 24 * 60 * 60 * 1000;

    const uniqueContactIds = [...new Set(invoices.flatMap((docs) => docs.map((d) => d.contactId).filter(Boolean)))];
    const contactIdToPaymentDays = {};
    const contactIdToName = {};

    // Contact names from suppliers (vendors) 2.0 by xeroId (contactId)
    if (uniqueContactIds.length > 0) {
        const vendors = await Vendor.find({
            xeroId: { $in: uniqueContactIds },
            isDeleted: { $ne: true },
        })
            .select("xeroId name")
            .lean();
        for (const v of vendors) {
            if (v.xeroId && v.name) contactIdToName[v.xeroId] = v.name;
        }
    }

    if (tenantId && accessToken && uniqueContactIds.length > 0) {
        const xeroClient = new XeroClient();
        xeroClient.setTokenSet({ access_token: accessToken });
        await Promise.all(
            uniqueContactIds.map(async (contactId) => {
                try {
                    const result = await xeroClient.accountingApi.getContact(tenantId, contactId);
                    const contact = result?.body?.contacts?.[0] ?? null;
                    contactIdToPaymentDays[contactId] = contact ? paymentTermsToDays(contact) : DEFAULT_PAYMENT_DAYS;
                } catch {
                    contactIdToPaymentDays[contactId] = DEFAULT_PAYMENT_DAYS;
                }
            })
        );
    }

    const invoicesWithDue = invoices.map((docs) => {
        const fromFile = docs.find((d) => d.fromXero === false);
        const dueDateRaw = (fromFile?.dueDate != null ? fromFile.dueDate : null)
            ?? (docs.find((d) => d.dueDate != null)?.dueDate ?? null);
        let dueDate = null;
        let dueInDays = null;
        if (dueDateRaw != null) {
            dueDate = new Date(dueDateRaw);
            dueDate.setHours(0, 0, 0, 0);
            const diffMs = dueDate.getTime() - now.getTime();
            dueInDays = Math.round(diffMs / msPerDay);
        }
        const contactId = docs.find((d) => d.contactId)?.contactId ?? null;
        const paymentTermsDays = contactId != null ? (contactIdToPaymentDays[contactId] ?? DEFAULT_PAYMENT_DAYS) : DEFAULT_PAYMENT_DAYS;
        const contactName = contactId != null ? (contactIdToName[contactId] ?? null) : null;
        return [docs, dueInDays, dueDate, paymentTermsDays, contactName];
    });

    invoicesWithDue.sort((a, b) => {
        const dueA = a[1] != null ? a[1] : 0;
        const dueB = b[1] != null ? b[1] : 0;
        const supplierA = a[3] != null ? a[3] : DEFAULT_PAYMENT_DAYS;
        const supplierB = b[3] != null ? b[3] : DEFAULT_PAYMENT_DAYS;
        const scoreA = dueA + supplierA;
        const scoreB = dueB + supplierB;
        return scoreA - scoreB;
    });

    const getAmount = (item) => {
        const docs = item[0];
        return docs.length > 0 && docs[0].amount != null ? Number(docs[0].amount) : 0;
    };

    let runningBalance = balance != null ? balance : 0;
    const payable = [];
    let payableTotal = 0;
    const remaining = [...invoicesWithDue];

    while (remaining.length > 0 && runningBalance >= 0) {
        const firstAmount = getAmount(remaining[0]);
        if (runningBalance >= firstAmount) {
            const item = remaining.shift();
            const amount = getAmount(item);
            runningBalance -= amount;
            payableTotal += amount;
            payable.push(item);
            continue;
        }
        const idx = remaining.findIndex((item) => runningBalance >= getAmount(item));
        if (idx === -1) break;
        const item = remaining.splice(idx, 1)[0];
        const amount = getAmount(item);
        runningBalance -= amount;
        payableTotal += amount;
        payable.push(item);
    }

    res.status(200).json({
        success: true,
        total: invoicesWithDue.length,
        invoices: invoicesWithDue,
        payable,
        payableTotal: payableTotal.toFixed(2),
        balance,
    });
});