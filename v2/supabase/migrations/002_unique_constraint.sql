-- Migration 002: Add UNIQUE constraint to reconciliations.bank_transaction_id
-- Run in Supabase SQL editor AFTER schema.sql
-- Required: reconcile.js uses upsert on bank_transaction_id (line ~147)

alter table reconciliations
  add constraint reconciliations_bank_transaction_id_key
  unique (bank_transaction_id);
