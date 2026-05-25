import sqlite3
from pathlib import Path

import pytest

from src import db_ops


@pytest.fixture()
def db(tmp_path: Path) -> Path:
    path = tmp_path / "steve.db"
    db_ops.init_db(path)
    return path


def test_init_db_creates_all_tables(db: Path):
    with db_ops.connect(db) as conn:
        names = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
    assert {
        "suppliers",
        "supplier_aliases",
        "statements",
        "statement_invoices",
        "xero_invoices",
        "reconciliations",
        "decisions",
        "audit_log",
    } <= names


def test_seed_loads_nine_suppliers(db: Path):
    with db_ops.connect(db) as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM suppliers").fetchone()["c"]
    assert n == 9


def test_get_supplier_by_alias_case_insensitive(db: Path):
    with db_ops.connect(db) as conn:
        s = db_ops.get_supplier_by_alias(conn, "  FOUNDING ip  ")
    assert s is not None
    assert s["name"] == "Founding IP"


def test_get_supplier_by_alias_via_alias_table(db: Path):
    with db_ops.connect(db) as conn:
        s = db_ops.get_supplier_by_alias(conn, "Med Movers")
    assert s is not None
    assert s["name"] == "Mediterranean Movers"


def test_get_supplier_by_alias_unknown(db: Path):
    with db_ops.connect(db) as conn:
        assert db_ops.get_supplier_by_alias(conn, "Nonexistent Co") is None


def test_create_statement_and_invoices_roundtrip(db: Path):
    with db_ops.connect(db) as conn:
        s = db_ops.get_supplier_by_alias(conn, "Founding IP")
        sid = db_ops.create_statement(
            conn,
            supplier_id=s["id"],
            file_path="/tmp/fake.pdf",
            currency="GBP",
            statement_total=300.0,
        )
        inv_ids = db_ops.add_statement_invoices(
            conn,
            sid,
            [
                {"invoice_number": "INV-2026-001", "amount": 100.0, "currency": "GBP"},
                {"invoice_number": "INV-2026-002", "amount": 200.0, "currency": "GBP"},
            ],
        )
        rows = conn.execute(
            "SELECT * FROM statement_invoices WHERE statement_id = ?", (sid,)
        ).fetchall()
    assert len(inv_ids) == 2
    assert len(rows) == 2
    assert {r["normalized_number"] for r in rows} == {"inv2026001", "inv2026002"}


def test_upsert_xero_invoices_is_idempotent(db: Path):
    with db_ops.connect(db) as conn:
        s = db_ops.get_supplier_by_alias(conn, "Founding IP")
        first = db_ops.upsert_xero_invoices(
            conn,
            s["id"],
            [{
                "xero_invoice_id": "xero-1",
                "invoice_number": "INV-2026-001",
                "amount": 100.0,
                "currency": "GBP",
                "status": "AUTHORISED",
            }],
        )
        again = db_ops.upsert_xero_invoices(
            conn,
            s["id"],
            [{
                "xero_invoice_id": "xero-1",
                "invoice_number": "INV-2026-001",
                "amount": 150.0,  # updated amount
                "currency": "GBP",
                "status": "PAID",
                "paid_amount": 150.0,
            }],
        )
        row = conn.execute("SELECT * FROM xero_invoices WHERE xero_invoice_id = 'xero-1'").fetchone()
    assert first == again  # same row id
    assert row["amount"] == 150.0
    assert row["status"] == "PAID"


def test_create_reconciliation_persists_matches(db: Path):
    with db_ops.connect(db) as conn:
        s = db_ops.get_supplier_by_alias(conn, "Founding IP")
        sid = db_ops.create_statement(conn, supplier_id=s["id"])
        ids = db_ops.create_reconciliation(conn, sid, [
            {
                "statement_invoice_id": None,
                "xero_invoice_id": None,
                "match_status": "MATCHED",
                "match_method": "exact_number",
                "confidence": 0.99,
                "amount_difference": 0.0,
                "reasoning": "ok",
            }
        ])
        rows = conn.execute("SELECT * FROM reconciliations").fetchall()
    assert len(ids) == 1
    assert rows[0]["match_status"] == "MATCHED"


def test_audit_log_is_append_only(db: Path):
    with db_ops.connect(db) as conn:
        db_ops.append_audit_log(
            conn, actor="system", action="test", entity_type="statement", entity_id="1",
            payload={"hello": "world"},
        )
        rows = conn.execute("SELECT * FROM audit_log").fetchall()
    assert len(rows) == 1
    # Direct UPDATE / DELETE on audit_log must fail.
    with db_ops.connect(db) as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE audit_log SET action = 'tampered'")
    with db_ops.connect(db) as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM audit_log")


def test_views_return_open_discrepancies(db: Path):
    with db_ops.connect(db) as conn:
        s = db_ops.get_supplier_by_alias(conn, "Founding IP")
        sid = db_ops.create_statement(conn, supplier_id=s["id"])
        db_ops.create_reconciliation(conn, sid, [
            {"match_status": "MATCHED",   "match_method": "exact_number", "confidence": 0.99},
            {"match_status": "AMBIGUOUS", "match_method": "none",         "confidence": 0.0},
        ])
        open_only = db_ops.get_open_discrepancies(conn)
        status = db_ops.get_supplier_status(conn)
    assert len(open_only) == 1
    assert open_only[0]["match_status"] == "AMBIGUOUS"
    by_name = {s["supplier_name"]: s for s in status}
    assert by_name["Founding IP"]["open_discrepancies"] == 1
