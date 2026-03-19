-- Steve AI v2 — Supabase Schema
-- Architecture: Vercel + Supabase + Claude API
-- Stack replaces LangChain/MongoDB/Express with ~1000 lines total

-- ────────────────────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ────────────────────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ────────────────────────────────────────────────────────────────────────────
-- CORE BUSINESS TABLES
-- ────────────────────────────────────────────────────────────────────────────

-- clients — one row per tenant, RLS isolates all data below
create table if not exists clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text unique not null,
  xero_tenant_id text,
  xero_access_token text,
  xero_refresh_token text,
  xero_token_expires_at timestamptz,
  xero_scope text,
  xero_connected_at timestamptz,
  xero_last_polled_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- invoices — from Xero, auto-embedded for semantic matching
create table if not exists invoices (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  xero_invoice_id text,
  invoice_number text,
  contact_id text,
  contact_name text,
  amount numeric(12,2),
  currency text default 'GBP',
  status text check (status in ('paid', 'unpaid', 'voided')) default 'unpaid',
  date date,
  due_date date,
  description text,
  from_xero boolean default false,
  -- embedding for semantic matching (auto-populated via Supabase)
  embedding vector(1536),
  -- raw content used for embedding generation
  embedding_content text generated always as (
    coalesce(invoice_number, '') || ' ' ||
    coalesce(contact_name, '') || ' ' ||
    coalesce(description, '')
  ) stored,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- bank_transactions — uploaded by CFO (PDF/XLSX parsed by Claude)
create table if not exists bank_transactions (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  upload_id uuid,
  invoice_number text,
  potential_invoice_ids jsonb default '[]',
  contact_name text,
  activity_description text,
  amount numeric(12,2),
  tax_fees numeric(12,2) default 0,
  currency text,
  payment_status text check (payment_status in ('paid', 'unpaid')) default 'unpaid',
  transaction_date date,
  file_date date,
  -- embedding for semantic matching
  embedding vector(1536),
  embedding_content text generated always as (
    coalesce(invoice_number, '') || ' ' ||
    coalesce(contact_name, '') || ' ' ||
    coalesce(activity_description, '')
  ) stored,
  created_at timestamptz default now()
);

-- reconciliations — match results with audit trail
create table if not exists reconciliations (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  bank_transaction_id uuid references bank_transactions(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  match_type text check (match_type in ('exact_id', 'semantic', 'manual', 'unmatched')),
  confidence numeric(3,2),
  match_reason text,
  -- manual override
  overridden_by_user boolean default false,
  override_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- uploads — track each file upload session
create table if not exists uploads (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  file_name text not null,
  file_type text,
  storage_path text,
  status text check (status in ('pending', 'processing', 'done', 'error')) default 'pending',
  error_message text,
  transactions_extracted integer default 0,
  created_at timestamptz default now()
);

-- agent_conversations — chat history per client session
create table if not exists agent_conversations (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  role text check (role in ('user', 'assistant')) not null,
  content text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- audit_log — every action, who, when, what
create table if not exists audit_log (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade,
  category text, -- 'xero_sync', 'upload', 'reconcile', 'manual_override', 'auth'
  action text not null,
  details jsonb default '{}',
  conversation_id uuid,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- AGENT FACTORY TABLES (Shaul's Layer)
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists skills (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  description text,
  category text, -- 'reconciliation', 'email_drafting', 'payment_prep', etc.
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists skill_versions (
  id uuid primary key default uuid_generate_v4(),
  skill_id uuid references skills(id) on delete cascade not null,
  version integer not null,
  prompt text not null,
  notes text,
  created_at timestamptz default now(),
  unique(skill_id, version)
);

create table if not exists prompts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  description text,
  created_at timestamptz default now()
);

create table if not exists prompt_versions (
  id uuid primary key default uuid_generate_v4(),
  prompt_id uuid references prompts(id) on delete cascade not null,
  version integer not null,
  body text not null,
  notes text,
  created_at timestamptz default now(),
  unique(prompt_id, version)
);

create table if not exists learning_facts (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  category text,
  fact text not null,
  confidence numeric(3,2) default 1.0,
  created_at timestamptz default now()
);

create table if not exists agent_runs (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade,
  skill_slug text,
  status text check (status in ('running', 'done', 'error')) default 'running',
  input jsonb,
  output jsonb,
  duration_ms integer,
  error text,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- ROW-LEVEL SECURITY
-- ────────────────────────────────────────────────────────────────────────────

alter table clients enable row level security;
alter table invoices enable row level security;
alter table bank_transactions enable row level security;
alter table reconciliations enable row level security;
alter table uploads enable row level security;
alter table agent_conversations enable row level security;
alter table audit_log enable row level security;
alter table learning_facts enable row level security;
alter table agent_runs enable row level security;

-- clients: users can only see their own row
create policy "client_self" on clients
  for all using (auth.uid()::text = id::text);

-- child tables: isolated by client_id matching auth user id
create policy "invoices_by_client" on invoices
  for all using (client_id = auth.uid());

create policy "bank_transactions_by_client" on bank_transactions
  for all using (client_id = auth.uid());

create policy "reconciliations_by_client" on reconciliations
  for all using (client_id = auth.uid());

create policy "uploads_by_client" on uploads
  for all using (client_id = auth.uid());

create policy "conversations_by_client" on agent_conversations
  for all using (client_id = auth.uid());

create policy "audit_by_client" on audit_log
  for all using (client_id = auth.uid());

create policy "facts_by_client" on learning_facts
  for all using (client_id = auth.uid());

create policy "runs_by_client" on agent_runs
  for all using (client_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- AUTO-EMBEDDING TRIGGERS
-- (Supabase auto-embeddings via pg_net + Edge Functions — configure in dashboard)
-- Tables: invoices (embedding_content), bank_transactions (embedding_content)
-- ────────────────────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────────────────────
-- SEMANTIC SEARCH FUNCTION
-- Match bank transactions against invoices using vector similarity
-- ────────────────────────────────────────────────────────────────────────────

create or replace function match_invoices(
  query_embedding vector(1536),
  client_id_filter uuid,
  match_threshold float default 0.7,
  match_count int default 5
)
returns table (
  id uuid,
  invoice_number text,
  contact_name text,
  amount numeric,
  status text,
  similarity float
)
language sql stable
as $$
  select
    i.id,
    i.invoice_number,
    i.contact_name,
    i.amount,
    i.status,
    1 - (i.embedding <=> query_embedding) as similarity
  from invoices i
  where i.client_id = client_id_filter
    and i.embedding is not null
    and 1 - (i.embedding <=> query_embedding) > match_threshold
  order by i.embedding <=> query_embedding
  limit match_count;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────────────────────

create index if not exists idx_invoices_client on invoices(client_id);
create index if not exists idx_invoices_number on invoices(client_id, invoice_number);
create index if not exists idx_bank_tx_client on bank_transactions(client_id);
create index if not exists idx_bank_tx_upload on bank_transactions(upload_id);
create index if not exists idx_reconciliations_client on reconciliations(client_id);
create index if not exists idx_audit_client on audit_log(client_id, created_at desc);

-- Vector indexes (IVFFlat — set lists based on expected row count)
create index if not exists idx_invoices_embedding on invoices
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index if not exists idx_bank_tx_embedding on bank_transactions
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ────────────────────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ────────────────────────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_updated_at before update on clients
  for each row execute function set_updated_at();

create trigger invoices_updated_at before update on invoices
  for each row execute function set_updated_at();

create trigger reconciliations_updated_at before update on reconciliations
  for each row execute function set_updated_at();
