import json
import subprocess
import sys
from pathlib import Path

import pytest

from src import db_ops, status_query


@pytest.fixture()
def db(tmp_path: Path) -> Path:
    path = tmp_path / "steve.db"
    db_ops.init_db(path)
    return path


@pytest.fixture()
def db_with_data(db: Path) -> Path:
    with db_ops.connect(db) as conn:
        sup = db_ops.get_supplier_by_alias(conn, "Founding IP")
        sid = db_ops.create_statement(
            conn, supplier_id=sup["id"], statement_total=300.0, currency="GBP",
        )
        db_ops.create_reconciliation(conn, sid, [
            {"match_status": "MATCHED", "match_method": "exact_number",
             "confidence": 0.99, "amount_difference": 0.0, "reasoning": "ok"},
            {"match_status": "AMOUNT_MISMATCH", "match_method": "exact_number",
             "confidence": 0.7, "amount_difference": 20.0,
             "reasoning": "amounts differ by 20"},
            {"match_status": "MISSING_FROM_XERO", "match_method": "none",
             "confidence": 0.0, "amount_difference": 100.0,
             "reasoning": "no Xero match"},
        ])
    return db


class TestSupplierStatus:
    def test_lists_all_seeded_suppliers(self, db: Path):
        rows = status_query.get_supplier_status(db)
        names = {r["supplier_name"] for r in rows}
        assert "Founding IP" in names
        assert len(rows) == 9

    def test_open_discrepancy_count_excludes_matched(self, db_with_data: Path):
        rows = status_query.get_supplier_status(db_with_data)
        by_name = {r["supplier_name"]: r for r in rows}
        assert by_name["Founding IP"]["open_discrepancies"] == 2


class TestOpenDiscrepancies:
    def test_returns_only_open(self, db_with_data: Path):
        rows = status_query.get_open_discrepancies(db_with_data)
        assert len(rows) == 2
        assert all(r["match_status"] != "MATCHED" for r in rows)

    def test_filter_by_supplier(self, db_with_data: Path):
        with db_ops.connect(db_with_data) as conn:
            sup = db_ops.get_supplier_by_alias(conn, "Founding IP")
        rows = status_query.get_open_discrepancies(db_with_data, sup["id"])
        assert len(rows) == 2


class TestSupplierOverview:
    def test_groups_by_status(self, db_with_data: Path):
        with db_ops.connect(db_with_data) as conn:
            sup = db_ops.get_supplier_by_alias(conn, "Founding IP")
        overview = status_query.supplier_overview(db_with_data, sup["id"])
        assert overview["discrepancy_count"] == 2
        assert set(overview["discrepancies_by_status"].keys()) == {
            "AMOUNT_MISMATCH", "MISSING_FROM_XERO",
        }


class TestFormatting:
    def test_status_table_includes_currency_and_count(self, db_with_data: Path):
        rows = status_query.get_supplier_status(db_with_data)
        text = status_query.format_supplier_status(rows)
        assert "Founding IP" in text
        assert "GBP" in text
        assert "2 open" in text

    def test_discrepancies_friendly_labels(self, db_with_data: Path):
        rows = status_query.get_open_discrepancies(db_with_data)
        text = status_query.format_open_discrepancies(rows)
        assert "Amount disagrees" in text
        assert "missing in Xero" in text

    def test_overview_all_clear_for_supplier_without_discrepancies(self, db: Path):
        with db_ops.connect(db) as conn:
            sup = db_ops.get_supplier_by_alias(conn, "Cairo Logistics")
        overview = status_query.supplier_overview(db, sup["id"])
        text = status_query.format_supplier_overview(overview)
        assert "All clear" in text


class TestCLI:
    def test_all_text_output(self, db: Path, capsys):
        code = status_query.main(["--db", str(db)])
        captured = capsys.readouterr()
        assert code == 0
        assert "Founding IP" in captured.out

    def test_all_json_output(self, db: Path, capsys):
        code = status_query.main(["--db", str(db), "--json"])
        captured = capsys.readouterr()
        assert code == 0
        data = json.loads(captured.out)
        assert len(data["suppliers"]) == 9

    def test_supplier_lookup(self, db_with_data: Path, capsys):
        code = status_query.main([
            "--db", str(db_with_data), "--supplier", "Founding IP",
        ])
        captured = capsys.readouterr()
        assert code == 0
        assert "Founding IP" in captured.out
        assert "Open discrepancies: 2" in captured.out

    def test_supplier_not_found(self, db: Path, capsys):
        code = status_query.main(["--db", str(db), "--supplier", "Nonexistent"])
        captured = capsys.readouterr()
        assert code == 1
        assert "not found" in captured.err

    def test_discrepancies_global(self, db_with_data: Path, capsys):
        code = status_query.main(["--db", str(db_with_data), "--discrepancies"])
        captured = capsys.readouterr()
        assert code == 0
        assert "Open discrepancies (2 total)" in captured.out

    def test_module_invocation(self, db: Path):
        proc = subprocess.run(
            [sys.executable, "-m", "src.status_query",
             "--db", str(db), "--json"],
            capture_output=True, text=True,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        assert proc.returncode == 0, proc.stderr
        data = json.loads(proc.stdout)
        assert "suppliers" in data
