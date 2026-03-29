// api/xero-callback.js — Vercel Serverless Function
// Handles Xero OAuth 2.0 callback after user grants permission.
// Ported from controllers/AuthController.js (v1) — state validated against
// Supabase instead of an httpOnly cookie.

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const XERO_ORG_URL = "https://api.xero.com/api.xro/2.0/Organisation";

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── Xero token exchange ───────────────────────────────────────────────────────

async function exchangeCodeForTokens(code) {
  const credentials = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString("base64");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.XERO_REDIRECT_URI,
  });

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

// ── Fetch Xero tenant info ────────────────────────────────────────────────────

async function getXeroTenantInfo(accessToken) {
  // Get tenant list
  const connectionsRes = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (!connectionsRes.ok) {
    throw new Error(`Connections fetch failed: ${connectionsRes.status}`);
  }

  const connections = await connectionsRes.json();
  if (!connections?.length) {
    throw new Error("No Xero tenants found for this account");
  }

  const tenantId = connections[0].tenantId;

  // Fetch org name
  const orgRes = await fetch(XERO_ORG_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });

  let tenantName = connections[0].tenantName || "Unknown Organisation";
  if (orgRes.ok) {
    const orgData = await orgRes.json();
    tenantName = orgData?.Organisations?.[0]?.Name || tenantName;
  }

  return { tenantId, tenantName };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code, state, error: xeroError } = req.query;

  // Handle user-denied access
  if (xeroError) {
    console.warn("[XeroCallback] User denied access:", xeroError);
    return res.redirect(302, `${process.env.NEXT_PUBLIC_APP_URL}?xero=denied`);
  }

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state parameter" });
  }

  const supabase = getSupabase();

  // ── 1. Find client by matching state token ──────────────────────────────────
  const { data: clients, error: fetchError } = await supabase
    .from("clients")
    .select("id, xero_oauth_state, xero_oauth_state_expires_at")
    .not("xero_oauth_state", "is", null);

  if (fetchError || !clients?.length) {
    console.error("[XeroCallback] State lookup failed:", fetchError?.message);
    return res.redirect(302, `${process.env.NEXT_PUBLIC_APP_URL}?xero=error&reason=state_not_found`);
  }

  // Find the client whose stored state matches, using timing-safe comparison
  const stateBuffer = Buffer.from(state);
  let matchedClient = null;

  for (const c of clients) {
    if (!c.xero_oauth_state) continue;
    const storedBuffer = Buffer.from(c.xero_oauth_state);
    if (
      storedBuffer.length === stateBuffer.length &&
      crypto.timingSafeEqual(storedBuffer, stateBuffer)
    ) {
      matchedClient = c;
      break;
    }
  }

  if (!matchedClient) {
    console.warn("[XeroCallback] No matching state token found");
    return res.redirect(302, `${process.env.NEXT_PUBLIC_APP_URL}?xero=error&reason=invalid_state`);
  }

  // ── 2. Validate state expiry ────────────────────────────────────────────────
  const expiresAt = matchedClient.xero_oauth_state_expires_at
    ? new Date(matchedClient.xero_oauth_state_expires_at)
    : null;

  if (!expiresAt || expiresAt < new Date()) {
    console.warn("[XeroCallback] State token expired for client:", matchedClient.id);
    return res.redirect(302, `${process.env.NEXT_PUBLIC_APP_URL}?xero=error&reason=state_expired`);
  }

  const clientId = matchedClient.id;

  // ── 3. Exchange code for tokens ─────────────────────────────────────────────
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err) {
    console.error("[XeroCallback] Token exchange error:", err.message);
    return res.redirect(302, `${process.env.NEXT_PUBLIC_APP_URL}?xero=error&reason=token_exchange`);
  }

  // ── 4. Fetch tenant info ────────────────────────────────────────────────────
  let tenantInfo;
  try {
    tenantInfo = await getXeroTenantInfo(tokens.access_token);
  } catch (err) {
    console.error("[XeroCallback] Tenant fetch error:", err.message);
    return res.redirect(302, `${process.env.NEXT_PUBLIC_APP_URL}?xero=error&reason=tenant_fetch`);
  }

  // ── 5. Persist tokens to Supabase ──────────────────────────────────────────
  const tokenExpiresAt = new Date(
    Date.now() + (tokens.expires_in || 1800) * 1000
  ).toISOString();

  const { error: saveError } = await supabase
    .from("clients")
    .update({
      xero_tenant_id: tenantInfo.tenantId,
      xero_access_token: tokens.access_token,
      xero_refresh_token: tokens.refresh_token,
      xero_token_expires_at: tokenExpiresAt,
      xero_scope: tokens.scope || null,
      xero_connected_at: new Date().toISOString(),
      // Clear used state token
      xero_oauth_state: null,
      xero_oauth_state_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  if (saveError) {
    console.error("[XeroCallback] Token save error:", saveError.message);
    return res.redirect(302, `${process.env.NEXT_PUBLIC_APP_URL}?xero=error&reason=save_failed`);
  }

  // ── 6. Audit log ────────────────────────────────────────────────────────────
  await supabase.from("audit_log").insert({
    client_id: clientId,
    category: "xero_auth",
    action: "oauth_connected",
    details: {
      tenant_id: tenantInfo.tenantId,
      tenant_name: tenantInfo.tenantName,
    },
  });

  // ── 7. Redirect to dashboard ────────────────────────────────────────────────
  return res.redirect(302, `${process.env.NEXT_PUBLIC_APP_URL}?xero=connected`);
}
