-- Migration: 003_auto_embed_trigger.sql
-- Sets up pg_net HTTP webhooks to trigger the auto-embed Edge Function on INSERT.
-- Run AFTER schema.sql and AFTER deploying the auto-embed Edge Function.
--
-- Prerequisites:
--   1. pg_net extension enabled (Supabase enables this by default)
--   2. auto-embed Edge Function deployed:
--      supabase functions deploy auto-embed --no-verify-jwt
--   3. Replace the two placeholder values below:
--      <YOUR_SUPABASE_PROJECT_REF>  — e.g. abcdefghijklmnop
--      <YOUR_SUPABASE_ANON_KEY>     — from Settings > API in Supabase dashboard
--        (anon key is fine here; the function itself uses service role internally)

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFIGURATION — update these before running
-- ─────────────────────────────────────────────────────────────────────────────

-- Store project ref + key as session config so the triggers can reference them
-- without hard-coding in every function body.
-- After replacing placeholders, run this file in the Supabase SQL editor.

do $$
begin
  -- Verify pg_net is available
  if not exists (
    select 1 from pg_extension where extname = 'pg_net'
  ) then
    raise exception 'pg_net extension is not enabled. Enable it in Supabase dashboard → Extensions.';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TRIGGER FUNCTION — shared by both tables
-- Fires an async HTTP POST to the auto-embed Edge Function via pg_net.
-- pg_net sends the request in the background; does not block the INSERT.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function trigger_auto_embed()
returns trigger
language plpgsql
security definer
as $$
declare
  project_ref  text := '<YOUR_SUPABASE_PROJECT_REF>';
  anon_key     text := '<YOUR_SUPABASE_ANON_KEY>';
  edge_fn_url  text;
  payload      jsonb;
  request_id   bigint;
begin
  -- Build the Edge Function URL
  edge_fn_url := 'https://' || project_ref || '.supabase.co/functions/v1/auto-embed';

  -- Build the webhook payload (mirrors Supabase Database Webhook format)
  payload := jsonb_build_object(
    'type',       TG_OP,
    'table',      TG_TABLE_NAME,
    'schema',     TG_TABLE_SCHEMA,
    'record',     row_to_json(NEW),
    'old_record', null
  );

  -- Fire async HTTP POST via pg_net (non-blocking)
  select net.http_post(
    url     := edge_fn_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body    := payload::text
  ) into request_id;

  -- Log the outbound request ID for debugging (visible in pg_net.requests table)
  raise log 'auto-embed webhook fired for %.% id=% pg_net_request=%',
    TG_TABLE_NAME, NEW.id, NEW.id, request_id;

  return NEW;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ATTACH TRIGGER: invoices
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists invoices_auto_embed on invoices;

create trigger invoices_auto_embed
  after insert on invoices
  for each row
  execute function trigger_auto_embed();

-- ─────────────────────────────────────────────────────────────────────────────
-- ATTACH TRIGGER: bank_transactions
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists bank_transactions_auto_embed on bank_transactions;

create trigger bank_transactions_auto_embed
  after insert on bank_transactions
  for each row
  execute function trigger_auto_embed();

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER: re-embed all existing rows that are missing embeddings
-- Run manually once after deploying, to back-fill any rows inserted before
-- this trigger was active.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function backfill_missing_embeddings()
returns void
language plpgsql
as $$
declare
  inv_row  record;
  btx_row  record;
  project_ref  text := '<YOUR_SUPABASE_PROJECT_REF>';
  anon_key     text := '<YOUR_SUPABASE_ANON_KEY>';
  edge_fn_url  text;
  payload      jsonb;
begin
  edge_fn_url := 'https://' || project_ref || '.supabase.co/functions/v1/auto-embed';

  -- Back-fill invoices
  for inv_row in
    select * from invoices
    where embedding is null
      and embedding_content is not null
      and trim(embedding_content) <> ''
  loop
    payload := jsonb_build_object(
      'type',       'INSERT',
      'table',      'invoices',
      'schema',     'public',
      'record',     row_to_json(inv_row),
      'old_record', null
    );
    perform net.http_post(
      url     := edge_fn_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := payload::text
    );
  end loop;

  -- Back-fill bank_transactions
  for btx_row in
    select * from bank_transactions
    where embedding is null
      and embedding_content is not null
      and trim(embedding_content) <> ''
  loop
    payload := jsonb_build_object(
      'type',       'INSERT',
      'table',      'bank_transactions',
      'schema',     'public',
      'record',     row_to_json(btx_row),
      'old_record', null
    );
    perform net.http_post(
      url     := edge_fn_url,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || anon_key
      ),
      body := payload::text
    );
  end loop;

  raise notice 'backfill_missing_embeddings: webhook requests dispatched';
end;
$$;

-- To run the back-fill:
-- select backfill_missing_embeddings();

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY: check pg_net outbound requests (useful for debugging)
-- select id, method, url, status_code, error_msg, created
-- from net._http_response
-- order by created desc
-- limit 20;
-- ─────────────────────────────────────────────────────────────────────────────
