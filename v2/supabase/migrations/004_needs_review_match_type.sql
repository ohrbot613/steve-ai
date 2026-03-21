-- Migration 004: Add 'needs_review' to reconciliations.match_type check constraint
-- Required: reconcile.js writes match_type='needs_review' for ID matches where
-- amounts differ by 5-50%. Without this the DB rejects those rows with a
-- check constraint violation.

alter table reconciliations
  drop constraint if exists reconciliations_match_type_check;

alter table reconciliations
  add constraint reconciliations_match_type_check
  check (match_type in ('exact_id', 'semantic', 'manual', 'unmatched', 'needs_review'));
