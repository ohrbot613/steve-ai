-- 005_invoices_review_flag.sql
-- Adds review_flag column to invoices table.
-- Written by xero-poll when an invoice cannot be auto-reconciled (e.g. missing_contact).
-- Surfaced on the CFO dashboard so Jeffrey can see WHY an invoice needs attention.

alter table invoices
  add column if not exists review_flag text;
