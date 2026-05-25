-- Steve AI reconciliation foundation schema (SQLite)
-- Tables, indexes, views, and append-only audit triggers.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS suppliers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL UNIQUE,
    canonical_name  TEXT    NOT NULL,
    currency        TEXT    NOT NULL DEFAULT 'USD',
    notes           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplier_aliases (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id     INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    alias           TEXT    NOT NULL,
    normalized      TEXT    NOT NULL,
    UNIQUE (supplier_id, normalized)
);
CREATE INDEX IF NOT EXISTS idx_supplier_aliases_normalized ON supplier_aliases(normalized);

CREATE TABLE IF NOT EXISTS statements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    file_path       TEXT,
    period_start    TEXT,
    period_end      TEXT,
    currency        TEXT,
    statement_total REAL,
    status          TEXT    NOT NULL DEFAULT 'PENDING',
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_statements_supplier ON statements(supplier_id);

CREATE TABLE IF NOT EXISTS statement_invoices (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id       INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    invoice_number     TEXT    NOT NULL,
    normalized_number  TEXT    NOT NULL,
    invoice_date       TEXT,
    amount             REAL    NOT NULL,
    currency           TEXT,
    raw                TEXT,
    created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_statement_invoices_statement ON statement_invoices(statement_id);
CREATE INDEX IF NOT EXISTS idx_statement_invoices_normalized ON statement_invoices(normalized_number);

CREATE TABLE IF NOT EXISTS xero_invoices (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id        INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    xero_invoice_id    TEXT    NOT NULL UNIQUE,
    invoice_number     TEXT    NOT NULL,
    normalized_number  TEXT    NOT NULL,
    invoice_date       TEXT,
    amount             REAL    NOT NULL,
    currency           TEXT,
    status             TEXT    NOT NULL DEFAULT 'AUTHORISED', -- AUTHORISED | PAID | VOIDED
    paid_amount        REAL    NOT NULL DEFAULT 0,
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_supplier ON xero_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_normalized ON xero_invoices(normalized_number);
CREATE INDEX IF NOT EXISTS idx_xero_invoices_status ON xero_invoices(status);

CREATE TABLE IF NOT EXISTS reconciliations (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id          INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    statement_invoice_id  INTEGER REFERENCES statement_invoices(id) ON DELETE SET NULL,
    xero_invoice_id       INTEGER REFERENCES xero_invoices(id) ON DELETE SET NULL,
    match_status          TEXT    NOT NULL, -- MATCHED|AMOUNT_MISMATCH|CURRENCY_MISMATCH|ALREADY_PAID|MISSING_FROM_XERO|MISSING_FROM_STATEMENT|AMBIGUOUS
    match_method          TEXT    NOT NULL, -- exact_number|normalized_number|fuzzy_number|amount_date|claude_fuzzy|manual|none
    confidence            REAL    NOT NULL DEFAULT 0,
    amount_difference     REAL    NOT NULL DEFAULT 0,
    reasoning             TEXT,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recon_statement ON reconciliations(statement_id);
CREATE INDEX IF NOT EXISTS idx_recon_status ON reconciliations(match_status);

CREATE TABLE IF NOT EXISTS decisions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id     INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    statement_id    INTEGER REFERENCES statements(id) ON DELETE SET NULL,
    decision_type   TEXT    NOT NULL, -- PAY|HOLD|DISPUTE|MANUAL_REVIEW
    amount          REAL,
    currency        TEXT,
    rationale       TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    actor           TEXT    NOT NULL,
    action          TEXT    NOT NULL,
    entity_type     TEXT    NOT NULL,
    entity_id       TEXT,
    payload         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

-- Append-only enforcement: block UPDATE/DELETE on audit_log.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- Convenience views.
CREATE VIEW IF NOT EXISTS v_supplier_status AS
SELECT
    s.id                AS supplier_id,
    s.name              AS supplier_name,
    s.currency          AS currency,
    (SELECT MAX(created_at) FROM statements st WHERE st.supplier_id = s.id) AS last_statement_at,
    (SELECT COUNT(*) FROM reconciliations r
        JOIN statements st ON st.id = r.statement_id
        WHERE st.supplier_id = s.id AND r.match_status != 'MATCHED') AS open_discrepancies
FROM suppliers s;

CREATE VIEW IF NOT EXISTS v_open_discrepancies AS
SELECT
    r.id              AS reconciliation_id,
    st.supplier_id    AS supplier_id,
    r.statement_id    AS statement_id,
    r.match_status    AS match_status,
    r.match_method    AS match_method,
    r.confidence      AS confidence,
    r.amount_difference AS amount_difference,
    r.reasoning       AS reasoning,
    r.created_at      AS created_at
FROM reconciliations r
JOIN statements st ON st.id = r.statement_id
WHERE r.match_status != 'MATCHED';
