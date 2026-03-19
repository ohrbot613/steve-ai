// api/xero-poll.js — Vercel Serverless Function
// Ported from services/xeroPollingService.js
// Changes: MongoDB → Supabase, cron-removed (called externally), OAuth state fixed

import { createClient } from "@supabase/supabase-js";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";
const MATCH_THRESHOLD = 0.8;
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client (service role — server-side only, never exposed to browser)
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Token helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getValidXeroToken(supabase, clientId) {
  const { data: client, error } = await supabase
    .from("clients")
    .select("xero_access_token, xero_refresh_token, xero_token_expires_at, xero_tenant_id, xero_scope")
    .eq("id", clientId)
    .single();

  if (error || !client?.xero_refresh_token) return null;

  const expiresAt = client.xero_token_expires_at
    ? new Date(client.xero_token_expires_at)
    : null;

  // Refresh if expired or expiring within 60s
  if (!expiresAt || expiresAt.getTime() - Date.now() < 60_000) {
    const refreshed = await refreshXeroToken(
      client.xero_refresh_token,
      client.xero_scope
    );
    if (!refreshed) return null;

    await supabase
      .from("clients")
      .update({
        xero_access_token: refreshed.access_token,
        xero_refresh_token: refreshed.refresh_token,
        xero_token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientId);

    return {
      accessToken: refreshed.access_token,
      tenantId: client.xero_tenant_id,
    };
  }

  return {
    accessToken: client.xero_access_token,
    tenantId: client.xero_tenant_id,
  };
}

async function refreshXeroToken(refreshToken, scope) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.XERO_CLIENT_ID,
    client_secret: process.env.XERO_CLIENT_SECRET,
    scope: scope || "openid profile email offline_access accounting.transactions accounting.contacts",
  });

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    console.error("[XeroPoller] Token refresh failed:", await res.text());
    return null;
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Xero API fetch
// ─────────────────────────────────────────────────────────────────────────────

async function fetchNewXeroInvoices(accessToken, tenantId, lastPolledAt) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Xero-tenant-id": tenantId,
    Accept: "application/json",
  };

  if (lastPolledAt) {
    // Strip milliseconds per Xero API requirement
    headers["If-Modified-Since"] = new Date(lastPolledAt)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z");
  }

  const allInvoices = [];
  let page = 1;

  while (true) {
    const url =
      `${XERO_INVOICES_URL}` +
      `?where=${encodeURIComponent('Type=="ACCPAY"')}` +
      `&page=${page}&pageSize=${PAGE_SIZE}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error("[XeroPoller] Fetch failed:", res.status, await res.text());
      break;
    }

    const data = await res.json();
    const invoices = data?.Invoices || [];
    allInvoices.push(...invoices);

    if (invoices.length < PAGE_SIZE) break;

    page++;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  return allInvoices;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exact ID matching (ported verbatim from xeroPollingService.js)
// ─────────────────────────────────────────────────────────────────────────────

const normalizeInvoiceDigits = (s) => {
  const digits = String(s ?? "").replace(/[^0-9]/g, "");
  return digits ? String(parseInt(digits, 10)) : "";
};

function getIdScore(fileInv, xeroInv) {
  const xeroNum = xeroInv.invoiceNumber ?? "";
  if (!xeroNum) return 0;
  const xeroNorm = normalizeInvoiceDigits(xeroNum);
  if (!xeroNorm) return 0;

  const potentialIds =
    Array.isArray(fileInv.potential_invoice_ids) && fileInv.potential_invoice_ids.length > 0
      ? fileInv.potential_invoice_ids
      : [fileInv.invoice_number].filter(Boolean);

  if (potentialIds.length === 0) return 0;

  for (const pid of potentialIds) {
    const p = String(pid).trim();
    if (!p) continue;
    const pNorm = normalizeInvoiceDigits(p);
    if (pNorm && pNorm === xeroNorm) return 1.0;
  }

  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert + reconcile
// ─────────────────────────────────────────────────────────────────────────────

async function matchAndReconcile(supabase, clientId, xeroInvoices) {
  let invoicesSaved = 0;
  let matchesWritten = 0;

  for (const xeroInv of xeroInvoices) {
    const contactId = xeroInv.Contact?.ContactID || null;

    // Upsert the Xero invoice into Supabase
    const { error: upsertError } = await supabase
      .from("invoices")
      .upsert(
        {
          client_id: clientId,
          xero_invoice_id: xeroInv.InvoiceID,
          invoice_number: xeroInv.InvoiceNumber,
          contact_id: contactId,
          contact_name: xeroInv.Contact?.Name || null,
          amount: xeroInv.Total || xeroInv.SubTotal || null,
          currency: xeroInv.CurrencyCode || "GBP",
          status: xeroInv.Status === "PAID" ? "paid" : "unpaid",
          date: xeroInv.DateString ? xeroInv.DateString.split("T")[0] : null,
          due_date: xeroInv.DueDateString ? xeroInv.DueDateString.split("T")[0] : null,
          description: xeroInv.LineItems?.[0]?.Description || null,
          from_xero: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "client_id,xero_invoice_id" }
      );

    if (upsertError) {
      console.error("[XeroPoller] Upsert error:", upsertError.message);
      continue;
    }
    invoicesSaved++;

    if (!contactId) continue;

    // Find unmatched bank transactions for this client
    const { data: transactions } = await supabase
      .from("bank_transactions")
      .select("id, invoice_number, potential_invoice_ids")
      .eq("client_id", clientId);

    if (!transactions?.length) continue;

    let bestMatch = null;
    let bestScore = 0;

    for (const tx of transactions) {
      const score = getIdScore(tx, { invoiceNumber: xeroInv.InvoiceNumber });
      if (score > bestScore) {
        bestScore = score;
        bestMatch = tx;
      }
    }

    if (bestScore >= MATCH_THRESHOLD && bestMatch) {
      // Get the invoice we just upserted
      const { data: invoice } = await supabase
        .from("invoices")
        .select("id")
        .eq("client_id", clientId)
        .eq("xero_invoice_id", xeroInv.InvoiceID)
        .single();

      if (invoice) {
        await supabase.from("reconciliations").upsert(
          {
            client_id: clientId,
            bank_transaction_id: bestMatch.id,
            invoice_id: invoice.id,
            match_type: "exact_id",
            confidence: bestScore,
            match_reason: `Exact digit match: ${xeroInv.InvoiceNumber}`,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "bank_transaction_id" }
        );
        matchesWritten++;
      }
    }
  }

  return { invoicesSaved, matchesWritten };
}

// ─────────────────────────────────────────────────────────────────────────────
// Poll cycle
// ─────────────────────────────────────────────────────────────────────────────

async function pollAndReconcileForClient(supabase, clientId) {
  const startTime = Date.now();

  const tokenInfo = await getValidXeroToken(supabase, clientId);
  if (!tokenInfo) {
    return { skipped: true, reason: "Xero not connected" };
  }

  const { accessToken, tenantId } = tokenInfo;

  const { data: client } = await supabase
    .from("clients")
    .select("xero_last_polled_at")
    .eq("id", clientId)
    .single();

  const lastPolledAt = client?.xero_last_polled_at || null;

  // First run — initialize timestamp, fetch everything next cycle
  if (!lastPolledAt) {
    await supabase
      .from("clients")
      .update({ xero_last_polled_at: new Date().toISOString() })
      .eq("id", clientId);

    await supabase.from("audit_log").insert({
      client_id: clientId,
      category: "xero_sync",
      action: "first_run_initialized",
      details: {},
    });

    return { skipped: true, reason: "First run — timestamp initialized" };
  }

  const xeroInvoices = await fetchNewXeroInvoices(accessToken, tenantId, lastPolledAt);
  const now = new Date().toISOString();

  await supabase
    .from("clients")
    .update({ xero_last_polled_at: now })
    .eq("id", clientId);

  if (xeroInvoices.length === 0) {
    await supabase.from("audit_log").insert({
      client_id: clientId,
      category: "xero_sync",
      action: "poll_cycle_empty",
      details: { duration_ms: Date.now() - startTime },
    });
    return { invoicesFetched: 0, invoicesSaved: 0, matchesWritten: 0 };
  }

  const { invoicesSaved, matchesWritten } = await matchAndReconcile(
    supabase,
    clientId,
    xeroInvoices
  );

  const durationMs = Date.now() - startTime;

  await supabase.from("audit_log").insert({
    client_id: clientId,
    category: "xero_sync",
    action: "poll_cycle_complete",
    details: {
      invoices_fetched: xeroInvoices.length,
      invoices_saved: invoicesSaved,
      matches_written: matchesWritten,
      duration_ms: durationMs,
    },
  });

  console.log(
    `[XeroPoller] client=${clientId}: ${xeroInvoices.length} fetched, ${invoicesSaved} saved, ${matchesWritten} matched (${durationMs}ms)`
  );

  return {
    invoicesFetched: xeroInvoices.length,
    invoicesSaved,
    matchesWritten,
    durationMs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Vercel handler
// Called by Vercel Cron (vercel.json: "0 * * * *") or manually
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Protect cron endpoint — Vercel sets Authorization header automatically for cron jobs
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = getSupabase();

  // Poll all connected clients, or a specific clientId if provided
  const clientId = req.query.clientId || null;

  if (clientId) {
    try {
      const result = await pollAndReconcileForClient(supabase, clientId);
      return res.json({ clientId, ...result });
    } catch (err) {
      console.error("[XeroPoller] Error:", err.message);
      await supabase.from("audit_log").insert({
        client_id: clientId,
        category: "xero_sync",
        action: "poll_error",
        details: { error: err.message },
      });
      return res.status(500).json({ error: err.message });
    }
  }

  // Poll all clients with Xero connected
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id")
    .not("xero_tenant_id", "is", null);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const results = await Promise.allSettled(
    clients.map((c) => pollAndReconcileForClient(supabase, c.id))
  );

  return res.json({
    polled: clients.length,
    results: results.map((r, i) => ({
      clientId: clients[i].id,
      ...(r.status === "fulfilled" ? r.value : { error: r.reason?.message }),
    })),
  });
}
