// api/xero-auth.js — Vercel Serverless Function
// Initiates Xero OAuth 2.0 flow for a logged-in client.
// Ported from controllers/AuthController.js (v1) — state now stored in
// Supabase instead of an httpOnly cookie.

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.contacts",
  "accounting.transactions",
  "accounting.reports.read",
].join(" ");

// State token lives 10 minutes (same as v1 cookie TTL)
const STATE_TTL_MS = 10 * 60 * 1000;

function getSupabase() {
  // Service role — needed to write state before user redirect
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── 1. Authenticate caller via Supabase JWT ─────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization header" });
  }
  const jwt = authHeader.slice(7);

  // Verify JWT and get user
  const supabaseAnon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );
  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser();
  if (authError || !user) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const clientId = user.id;
  const supabase = getSupabase();

  // ── 2. Generate CSRF state token ────────────────────────────────────────────
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  // Store state in Supabase (replaces v1 httpOnly cookie)
  const { error: updateError } = await supabase
    .from("clients")
    .update({
      xero_oauth_state: state,
      xero_oauth_state_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId);

  if (updateError) {
    console.error("[XeroAuth] Failed to save state:", updateError.message);
    return res.status(500).json({ error: "Could not initiate Xero connection" });
  }

  // ── 3. Build Xero authorization URL ────────────────────────────────────────
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID,
    redirect_uri: process.env.XERO_REDIRECT_URI,
    scope: XERO_SCOPES,
    state,
  });

  const authUrl = `${XERO_AUTH_URL}?${params.toString()}`;

  // ── 4. Redirect to Xero ─────────────────────────────────────────────────────
  return res.redirect(302, authUrl);
}
