"""SQLite wrapper for the reconciliation foundation.

All persistence the matcher/parser need lives here so the SQL schema stays in
one place.  Connections are short-lived: open per call, close on exit.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional, Sequence

from .normalizer import normalize_invoice_number, normalize_supplier_name

_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = _ROOT / "db" / "init_db.sql"
SEED_PATH = _ROOT / "db" / "seed_suppliers.sql"


def _row_to_dict(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in row.keys()}


@contextmanager
def connect(db_path: str | Path) -> Iterator[sqlite3.Connection]:
    """Open a SQLite connection with sensible defaults and dict-shaped rows."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db(db_path: str | Path, *, seed: bool = True) -> None:
    """Apply schema (and optional supplier seed) to ``db_path``."""
    schema = SCHEMA_PATH.read_text()
    with connect(db_path) as conn:
        conn.executescript(schema)
        if seed and SEED_PATH.exists():
            conn.executescript(SEED_PATH.read_text())


# ---------- suppliers ----------------------------------------------------------

def get_supplier_by_alias(conn: sqlite3.Connection, name: str) -> Optional[dict]:
    """Lookup a supplier by canonical name OR any alias (case/whitespace insensitive)."""
    normalized = normalize_supplier_name(name)
    if not normalized:
        return None
    row = conn.execute(
        """
        SELECT s.* FROM suppliers s
        WHERE s.canonical_name = ?
        UNION
        SELECT s.* FROM suppliers s
        JOIN supplier_aliases a ON a.supplier_id = s.id
        WHERE a.normalized = ?
        LIMIT 1
        """,
        (normalized, normalized),
    ).fetchone()
    return _row_to_dict(row) if row else None


def upsert_supplier(conn: sqlite3.Connection, name: str, currency: str = "USD") -> int:
    """Insert a supplier if missing; return its id."""
    canonical = normalize_supplier_name(name)
    cur = conn.execute(
        "INSERT OR IGNORE INTO suppliers (name, canonical_name, currency) VALUES (?, ?, ?)",
        (name, canonical, currency),
    )
    if cur.lastrowid:
        return cur.lastrowid
    row = conn.execute("SELECT id FROM suppliers WHERE canonical_name = ?", (canonical,)).fetchone()
    return int(row["id"])


# ---------- statements ---------------------------------------------------------

def create_statement(
    conn: sqlite3.Connection,
    *,
    supplier_id: Optional[int],
    file_path: Optional[str] = None,
    period_start: Optional[str] = None,
    period_end: Optional[str] = None,
    currency: Optional[str] = None,
    statement_total: Optional[float] = None,
    status: str = "PENDING",
) -> int:
    cur = conn.execute(
        """
        INSERT INTO statements
            (supplier_id, file_path, period_start, period_end, currency, statement_total, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (supplier_id, file_path, period_start, period_end, currency, statement_total, status),
    )
    return int(cur.lastrowid)


def add_statement_invoices(
    conn: sqlite3.Connection,
    statement_id: int,
    invoices: Iterable[dict],
) -> list[int]:
    """Bulk-insert parsed statement lines; returns inserted row ids in order."""
    ids: list[int] = []
    for inv in invoices:
        number = inv.get("invoice_number") or inv.get("number") or ""
        normalized = inv.get("normalized_number") or normalize_invoice_number(number)
        cur = conn.execute(
            """
            INSERT INTO statement_invoices
                (statement_id, invoice_number, normalized_number, invoice_date, amount, currency, raw)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                statement_id,
                number,
                normalized,
                inv.get("invoice_date"),
                float(inv["amount"]),
                inv.get("currency"),
                json.dumps(inv.get("raw")) if inv.get("raw") is not None else None,
            ),
        )
        ids.append(int(cur.lastrowid))
    return ids


# ---------- xero invoices ------------------------------------------------------

def upsert_xero_invoices(
    conn: sqlite3.Connection,
    supplier_id: int,
    invoices: Iterable[dict],
) -> list[int]:
    """Upsert by xero_invoice_id; returns row ids in order."""
    ids: list[int] = []
    for inv in invoices:
        number = inv.get("invoice_number") or ""
        normalized = inv.get("normalized_number") or normalize_invoice_number(number)
        xero_id = inv["xero_invoice_id"]
        conn.execute(
            """
            INSERT INTO xero_invoices
                (supplier_id, xero_invoice_id, invoice_number, normalized_number,
                 invoice_date, amount, currency, status, paid_amount, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(xero_invoice_id) DO UPDATE SET
                invoice_number = excluded.invoice_number,
                normalized_number = excluded.normalized_number,
                invoice_date = excluded.invoice_date,
                amount = excluded.amount,
                currency = excluded.currency,
                status = excluded.status,
                paid_amount = excluded.paid_amount,
                updated_at = datetime('now')
            """,
            (
                supplier_id,
                xero_id,
                number,
                normalized,
                inv.get("invoice_date"),
                float(inv["amount"]),
                inv.get("currency"),
                inv.get("status", "AUTHORISED"),
                float(inv.get("paid_amount", 0)),
            ),
        )
        row = conn.execute(
            "SELECT id FROM xero_invoices WHERE xero_invoice_id = ?", (xero_id,)
        ).fetchone()
        ids.append(int(row["id"]))
    return ids


# ---------- reconciliations ----------------------------------------------------

def create_reconciliation(
    conn: sqlite3.Connection,
    statement_id: int,
    matches: Sequence[dict],
) -> list[int]:
    """Persist matcher output rows; returns inserted ids in order."""
    ids: list[int] = []
    for m in matches:
        cur = conn.execute(
            """
            INSERT INTO reconciliations
                (statement_id, statement_invoice_id, xero_invoice_id, match_status,
                 match_method, confidence, amount_difference, reasoning)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                statement_id,
                m.get("statement_invoice_id"),
                m.get("xero_invoice_id"),
                m["match_status"],
                m.get("match_method", "none"),
                float(m.get("confidence", 0.0)),
                float(m.get("amount_difference", 0.0)),
                m.get("reasoning"),
            ),
        )
        ids.append(int(cur.lastrowid))
    return ids


# ---------- decisions / audit --------------------------------------------------

def create_decision(
    conn: sqlite3.Connection,
    *,
    supplier_id: int,
    decision_type: str,
    statement_id: Optional[int] = None,
    amount: Optional[float] = None,
    currency: Optional[str] = None,
    rationale: Optional[str] = None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO decisions
            (supplier_id, statement_id, decision_type, amount, currency, rationale)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (supplier_id, statement_id, decision_type, amount, currency, rationale),
    )
    return int(cur.lastrowid)


def append_audit_log(
    conn: sqlite3.Connection,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    payload: Optional[Any] = None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO audit_log (actor, action, entity_type, entity_id, payload)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            actor,
            action,
            entity_type,
            entity_id,
            json.dumps(payload) if payload is not None else None,
        ),
    )
    return int(cur.lastrowid)


# ---------- read views ---------------------------------------------------------

def get_supplier_status(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM v_supplier_status").fetchall()
    return [_row_to_dict(r) for r in rows]


def get_open_discrepancies(conn: sqlite3.Connection, supplier_id: Optional[int] = None) -> list[dict]:
    if supplier_id is None:
        rows = conn.execute("SELECT * FROM v_open_discrepancies ORDER BY created_at DESC").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM v_open_discrepancies WHERE supplier_id = ? ORDER BY created_at DESC",
            (supplier_id,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


__all__ = [
    "SCHEMA_PATH",
    "SEED_PATH",
    "add_statement_invoices",
    "append_audit_log",
    "connect",
    "create_decision",
    "create_reconciliation",
    "create_statement",
    "get_open_discrepancies",
    "get_supplier_by_alias",
    "get_supplier_status",
    "init_db",
    "upsert_supplier",
    "upsert_xero_invoices",
]
