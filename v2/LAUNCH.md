# Steve v2 — Launch Day Guide
**Monday 2026-03-23 — For Shaul**

This is your step-by-step checklist to go live. Follow it in order.
Estimated time: 45–60 minutes (most of it is waiting for deploys).

---

## Before You Start — Gather These 6 Things

You will need all of these before running the deploy script. Get them now.

| What | Where to find it |
|---|---|
| **Supabase Project Ref** | supabase.com → your project → Settings → General → "Reference ID" (looks like `abcdefghijklmnop`) |
| **Supabase Anon Key** | supabase.com → project → Settings → API → "anon public" key |
| **Supabase Service Role Key** | Same page → "service_role" key (keep this secret) |
| **Xero Client Secret** | developer.xero.com → App management → Steve app → Client secret |
| **Anthropic API Key** | console.anthropic.com → API Keys (starts with `sk-ant-`) |
| **OpenRouter API Key** | openrouter.ai → Keys (starts with `sk-or-v1-`) — used by the auto-embed edge function |

Note: XERO_CLIENT_ID is already hardcoded (`2AB441B1BB814413ABA1925DC2B5BD3B`). CRON_SECRET is also pre-set. You only need the 6 items above.

**Also required before deploy:** Run `supabase login` in Terminal. The script will fail at the link step if you are not logged into the Supabase CLI.

---

## Step 1 — Verify your machine is ready

Open Terminal and run:

```bash
cd /Users/shual/Desktop/Steve/Code
bash v2/scripts/pre-deploy-check.sh
```

All checks must pass before continuing. If anything fails, fix it first.

Common issues:
- "supabase CLI not found" → `brew install supabase/tap/supabase`
- "vercel CLI not found" → `npm i -g vercel`
- "Node.js too old" → `brew upgrade node`

---

## Step 2 — Run the deploy script

```bash
bash v2/scripts/deploy-day.sh
```

The script will ask you for the 6 items from the table above, one at a time.
It will then:
1. Link your Supabase project
2. Push the database schema and migrations
3. Deploy the auto-embed edge function
4. Set all environment variables in Vercel
5. Deploy the app to production
6. Run smoke tests and print your live URL

The whole process takes about 10–15 minutes. Watch for any red `✗` lines.

---

## Step 3 — Register the Xero Redirect URI (MANUAL — REQUIRED)

**This is the one step the script cannot do for you.**

After the script prints your live URL (e.g. `https://steve-v2.vercel.app`):

1. Go to [developer.xero.com/app/manage](https://developer.xero.com/app/manage)
2. Click on the **Steve** app
3. Go to **Redirect URIs**
4. Add: `https://YOUR-DEPLOY-URL.vercel.app/api/xero-callback`
   (The script prints the exact URI — copy it from the terminal)
5. Save

**If you skip this step, Xero will reject every login attempt with an error.**

---

## Step 4 — Connect Xero

1. Open your live app URL in the browser
2. Sign up / sign in
3. Click **Connect Xero** (the banner at the top)
4. Authorize Steve in Xero
5. You should see "Xero connected! Invoices will sync within the hour."

---

## Step 5 — Test end-to-end

1. Upload a bank statement CSV (or XLSX) using the Upload button
2. Wait for processing (usually under 30 seconds)
3. Check that transactions appear in the results table
4. Confirm one match manually to verify the Confirm button works
5. Check that the stat cards (Matched / Unmatched / Review) update correctly

---

## Step 6 — Smoke test the API (optional but recommended)

Run this from Terminal to confirm all endpoints are healthy:

```bash
curl https://YOUR-DEPLOY-URL.vercel.app/api/health
# Expected: {"status":"ok"}

curl https://YOUR-DEPLOY-URL.vercel.app/api/config
# Expected: {"supabaseUrl":"https://...","supabaseAnonKey":"eyJ..."}
```

---

## Known Manual Steps Summary

| Step | Who | When |
|---|---|---|
| Register Xero Redirect URI in developer portal | Shaul | After Step 2, before Step 4 |
| First Xero connection (OAuth grant) | Shaul | Step 4 |
| First bank statement upload test | Shaul | Step 5 |

---

## If Something Goes Wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Xero connect fails with "invalid redirect URI" | Redirect URI not registered | Complete Step 3 |
| `/api/health` returns `{"status":"misconfigured"}` | Env vars not set in Vercel | Re-run `deploy-day.sh` from Step 6 onwards |
| Frontend shows blank page or config error | Supabase URL/key not deploying | Check Vercel dashboard → Environment Variables |
| Upload fails immediately | File too large (4MB limit) or wrong format | Use CSV or XLSX under 4MB |
| "No Xero tenants found" error | Xero account has no org attached | Log into Xero directly first, confirm org exists |

---

## Architecture Reference

- **Frontend:** Static HTML/CSS/JS served by Vercel (`public/index.html`)
- **Backend:** Vercel Serverless Functions (`api/*.js`) — Node 20
- **Database:** Supabase (Postgres + pgvector + RLS)
- **AI:** Claude API (Anthropic) for statement parsing and reconciliation
- **Xero sync:** Vercel Cron job runs hourly (`api/xero-poll.js`)
- **Embeddings:** Supabase Edge Function `auto-embed` (OpenRouter → generates vectors)

---

*Generated by launch audit — 2026-03-22*
