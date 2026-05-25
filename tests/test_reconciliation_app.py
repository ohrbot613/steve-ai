import json
import subprocess
import sys
from pathlib import Path

import pytest

from src import (
    audit_logger,
    db_ops,
    email_drafter,
    matcher,
    payment,
    reconciliation_app,
)


@pytest.fixture()
def db(tmp_path: Path) -> Path:
    path = tmp_path / "steve.db"
    reconciliation_app.cmd_init(path)
    return path


@pytest.fixture()
def supplier(db: Path) -> dict:
    with db_ops.connect(db) as conn:
        return db_ops.get_supplier_by_alias(conn, "Founding IP")


@pytest.fixture()
def statement_id(db: Path, supplier: dict) -> int:
    """Insert a statement + invoices directly (avoids needing a real file)."""
    with db_ops.connect(db) as conn:
        sid = db_ops.create_statement(
            conn,
            supplier_id=supplier["id"],
            currency="GBP",
            statement_total=350.0,
        )
        db_ops.add_statement_invoices(conn, sid, [
            {"invoice_number": "INV-1001", "amount": 100.0, "currency": "GBP",
             "invoice_date": "2026-01-15"},
            {"invoice_number": "INV-1002", "amount": 250.0, "currency": "GBP",
             "invoice_date": "2026-01-20"},
            {"invoice_number": "INV-1003", "amount": 75.0, "currency": "GBP",
             "invoice_date": "2026-01-25"},
        ])
    return sid


@pytest.fixture()
def xero_loaded(db: Path, supplier: dict, statement_id: int) -> dict:
    """One match, one amount mismatch, one missing-from-statement."""
    invoices = [
        {"xero_invoice_id": "x1", "invoice_number": "INV-1001",
         "amount": 100.0, "currency": "GBP", "status": "AUTHORISED",
         "invoice_date": "2026-01-15"},
        {"xero_invoice_id": "x2", "invoice_number": "INV-1002",
         "amount": 240.0, "currency": "GBP", "status": "AUTHORISED",
         "invoice_date": "2026-01-20"},
        {"xero_invoice_id": "x99", "invoice_number": "INV-9999",
         "amount": 500.0, "currency": "GBP", "status": "AUTHORISED",
         "invoice_date": "2026-01-30"},
    ]
    return reconciliation_app.cmd_load_xero(db, "Founding IP", invoices)


class TestInit:
    def test_init_seeds_and_logs(self, tmp_path: Path):
        db = tmp_path / "fresh.db"
        result = reconciliation_app.cmd_init(db)
        assert result["seeded"] is True
        assert result["suppliers"] >= 1
        entries = audit_logger.query_audit_log(db)
        assert any(e.action == audit_logger.ACTION_CORRECTION_APPLIED for e in entries)

    def test_init_is_idempotent(self, tmp_path: Path):
        db = tmp_path / "fresh.db"
        reconciliation_app.cmd_init(db)
        reconciliation_app.cmd_init(db)  # should not raise
        with db_ops.connect(db) as conn:
            n = conn.execute("SELECT COUNT(*) AS c FROM suppliers").fetchone()["c"]
        assert n >= 1


class TestLoadXero:
    def test_loads_and_logs(self, db: Path, supplier: dict):
        result = reconciliation_app.cmd_load_xero(db, "Founding IP", [
            {"xero_invoice_id": "x1", "invoice_number": "I1", "amount": 10.0,
             "currency": "GBP", "status": "AUTHORISED"},
        ])
        assert result["supplier_id"] == supplier["id"]
        assert result["loaded"] == 1
        entries = audit_logger.query_audit_log(
            db, action=audit_logger.ACTION_XERO_INVOICES_LOADED,
        )
        assert len(entries) == 1

    def test_load_from_file(self, db: Path, tmp_path: Path):
        path = tmp_path / "xero.json"
        path.write_text(json.dumps([
            {"xero_invoice_id": "x1", "invoice_number": "I1", "amount": 10.0,
             "currency": "GBP", "status": "AUTHORISED"},
        ]))
        result = reconciliation_app.cmd_load_xero_file(db, "Founding IP", path)
        assert result["loaded"] == 1

    def test_unknown_supplier_raises(self, db: Path):
        with pytest.raises(ValueError, match="not found"):
            reconciliation_app.cmd_load_xero(db, "Nobody Inc", [])


class TestReconcileFlow:
    def test_match_results_persisted_and_audited(
        self, db: Path, supplier: dict, statement_id: int, xero_loaded: dict,
    ):
        result = reconciliation_app.cmd_reconcile(db, statement_id)
        statuses = [r["match_status"] for r in result["reconciliation"]["results"]]
        assert matcher.MATCHED in statuses
        assert matcher.AMOUNT_MISMATCH in statuses
        assert matcher.MISSING_FROM_XERO in statuses
        assert matcher.MISSING_FROM_STATEMENT in statuses

        with db_ops.connect(db) as conn:
            n = conn.execute(
                "SELECT COUNT(*) AS c FROM reconciliations WHERE statement_id = ?",
                (statement_id,),
            ).fetchone()["c"]
        assert n == len(result["reconciliation"]["results"])

        entries = audit_logger.query_audit_log(
            db, action=audit_logger.ACTION_RECONCILIATION_RUN,
        )
        assert len(entries) == 1
        assert entries[0].payload["supplier_id"] == supplier["id"]

    def test_payment_tier_computed_when_terms_given(
        self, db: Path, statement_id: int, xero_loaded: dict,
    ):
        result = reconciliation_app.cmd_reconcile(
            db, statement_id,
            terms_days=30, terms_type=payment.TERMS_NET,
            tier=payment.TIER_AGGRESSIVE,
            today=__import__("datetime").date(2026, 5, 1),
        )
        tier = result["payment"]["selected_tier"]
        assert tier is not None
        # Only INV-1001 was MATCHED (INV-1002 was AMOUNT_MISMATCH).
        assert tier["invoice_count"] == 1
        assert tier["total"] == 100.0

        entries = audit_logger.query_audit_log(
            db, action=audit_logger.ACTION_PAYMENT_CALCULATED,
        )
        assert len(entries) == 1
        assert entries[0].payload["tier"] == payment.TIER_AGGRESSIVE

    def test_drafts_one_email_per_relevant_bucket(
        self, db: Path, statement_id: int, xero_loaded: dict,
    ):
        result = reconciliation_app.cmd_reconcile(
            db, statement_id,
            terms_days=30, terms_type=payment.TERMS_NET,
            today=__import__("datetime").date(2026, 5, 1),
            draft_emails=True,
        )
        drafts = result["drafts"]
        templates = {d["template"] for d in drafts}
        # missing INV-1003, amount mismatch on INV-1002, plus payment confirmation
        # for matched INV-1001. ALREADY_PAID bucket is empty.
        assert email_drafter.TEMPLATE_MISSING_INVOICES in templates
        assert email_drafter.TEMPLATE_AMOUNT_MISMATCH in templates
        assert email_drafter.TEMPLATE_PAYMENT_CONFIRMATION in templates

        entries = audit_logger.query_audit_log(
            db, action=audit_logger.ACTION_EMAIL_DRAFTED,
        )
        assert len(entries) == len(drafts)

    def test_excel_generated_when_requested(
        self, db: Path, statement_id: int, xero_loaded: dict, tmp_path: Path,
    ):
        out = tmp_path / "recon.xlsx"
        result = reconciliation_app.cmd_reconcile(
            db, statement_id,
            terms_days=30, terms_type=payment.TERMS_NET,
            today=__import__("datetime").date(2026, 5, 1),
            excel_path=out,
        )
        assert result["excel_output"] == str(out)
        assert out.exists() and out.stat().st_size > 0

        entries = audit_logger.query_audit_log(
            db, action=audit_logger.ACTION_EXCEL_GENERATED,
        )
        assert len(entries) == 1

    def test_currency_mismatch_blocks_payment(
        self, db: Path, supplier: dict,
    ):
        with db_ops.connect(db) as conn:
            sid = db_ops.create_statement(
                conn, supplier_id=supplier["id"], currency="GBP",
                statement_total=100.0,
            )
            db_ops.add_statement_invoices(conn, sid, [
                {"invoice_number": "INV-A", "amount": 100.0, "currency": "GBP",
                 "invoice_date": "2026-01-01"},
            ])
        reconciliation_app.cmd_load_xero(db, "Founding IP", [
            {"xero_invoice_id": "x1", "invoice_number": "INV-A",
             "amount": 100.0, "currency": "USD", "status": "AUTHORISED",
             "invoice_date": "2026-01-01"},
        ])
        result = reconciliation_app.cmd_reconcile(
            db, sid,
            terms_days=30, terms_type=payment.TERMS_NET,
        )
        assert result["payment"]["selected_tier"] is None
        assert "CURRENCY_MISMATCH" in result["payment"]["blocked_reason"]

    def test_reconcile_unknown_statement_raises(self, db: Path):
        with pytest.raises(ValueError, match="not found"):
            reconciliation_app.cmd_reconcile(db, 9999)


class TestCLI:
    def test_init_subcommand(self, tmp_path: Path, capsys):
        db = tmp_path / "x.db"
        code = reconciliation_app.main(["--db", str(db), "init"])
        captured = capsys.readouterr()
        assert code == 0
        out = json.loads(captured.out)
        assert out["suppliers"] >= 1

    def test_load_xero_subcommand(self, db: Path, tmp_path: Path, capsys):
        path = tmp_path / "xero.json"
        path.write_text(json.dumps([
            {"xero_invoice_id": "x1", "invoice_number": "I1", "amount": 1.0,
             "currency": "GBP", "status": "AUTHORISED"},
        ]))
        code = reconciliation_app.main([
            "--db", str(db), "load-xero",
            "--supplier", "Founding IP", "--file", str(path),
        ])
        captured = capsys.readouterr()
        assert code == 0
        out = json.loads(captured.out)
        assert out["loaded"] == 1

    def test_reconcile_subcommand(
        self, db: Path, statement_id: int, xero_loaded: dict, capsys,
    ):
        code = reconciliation_app.main([
            "--db", str(db), "reconcile",
            "--statement-id", str(statement_id),
            "--terms-days", "30", "--terms-type", "net",
            "--today", "2026-05-01",
            "--draft-emails",
        ])
        captured = capsys.readouterr()
        assert code == 0
        out = json.loads(captured.out)
        assert out["statement_id"] == statement_id
        assert len(out["drafts"]) >= 1

    def test_status_subcommand_delegates(self, db: Path, capsys):
        code = reconciliation_app.main(["--db", str(db), "status", "--json"])
        captured = capsys.readouterr()
        assert code == 0
        data = json.loads(captured.out)
        assert "suppliers" in data

    def test_audit_subcommand_delegates(self, db: Path, capsys):
        # The init call already wrote an audit entry.
        code = reconciliation_app.main(["--db", str(db), "audit"])
        captured = capsys.readouterr()
        assert code == 0
        data = json.loads(captured.out)
        assert data["count"] >= 1

    def test_unknown_supplier_returns_error(self, db: Path, capsys, tmp_path: Path):
        path = tmp_path / "xero.json"
        path.write_text("[]")
        code = reconciliation_app.main([
            "--db", str(db), "load-xero",
            "--supplier", "Nobody Inc", "--file", str(path),
        ])
        captured = capsys.readouterr()
        assert code == 1
        assert "not found" in captured.err

    def test_module_invocation(self, tmp_path: Path):
        db = tmp_path / "x.db"
        proc = subprocess.run(
            [sys.executable, "-m", "src.reconciliation_app",
             "--db", str(db), "init"],
            capture_output=True, text=True,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        assert proc.returncode == 0, proc.stderr
        out = json.loads(proc.stdout)
        assert out["suppliers"] >= 1
