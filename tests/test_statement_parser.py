"""Tests for the statement_parser CLI orchestrator."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from src import db_ops, statement_parser


SAMPLE_TXT = """\
Founding IP — Statement of Account
Statement Period: January 2026

Date         Invoice         Amount
2026-01-05   INV-2026-001    £1,234.56
2026-01-12   INV-2026-002    £   500.00

Statement Total: £1,734.56
"""


@pytest.fixture()
def db(tmp_path: Path) -> Path:
    path = tmp_path / "steve.db"
    db_ops.init_db(path)
    return path


@pytest.fixture()
def sample_file(tmp_path: Path) -> Path:
    p = tmp_path / "founding_jan2026.txt"
    p.write_text(SAMPLE_TXT)
    return p


# ---- run() ------------------------------------------------------------------

class TestRun:
    def test_parse_without_db(self, sample_file: Path):
        result = statement_parser.run(sample_file)
        assert result["invoice_count"] == 2
        assert result["statement_total"] == 1734.56
        # No DB -> aliases not loaded; supplier identified only by filename hit.
        # (Filename normalizes to "founding jan2026.txt" which won't contain
        # any seeded alias on its own, but the heuristic may still match.)
        assert "invoices" in result

    def test_parse_with_db_identifies_supplier(self, sample_file: Path, db: Path):
        result = statement_parser.run(sample_file, db_path=db)
        assert result["supplier_name_detected"] == "Founding IP"
        assert result["supplier_id"] is not None
        assert result["confidence"] > 0.0

    def test_persist_writes_to_db(self, sample_file: Path, db: Path):
        result = statement_parser.run(sample_file, db_path=db, persist=True)
        assert "statement_id" in result
        stmt_id = result["statement_id"]
        with db_ops.connect(db) as conn:
            stmt = conn.execute(
                "SELECT * FROM statements WHERE id = ?", (stmt_id,)
            ).fetchone()
            invs = conn.execute(
                "SELECT * FROM statement_invoices WHERE statement_id = ? ORDER BY id",
                (stmt_id,),
            ).fetchall()
            audit = conn.execute(
                "SELECT * FROM audit_log WHERE entity_type='statement' AND entity_id = ?",
                (str(stmt_id),),
            ).fetchall()
        assert stmt["status"] == "PARSED"
        assert stmt["statement_total"] == 1734.56
        assert stmt["currency"] == "GBP"
        assert len(invs) == 2
        assert {r["normalized_number"] for r in invs} == {"inv2026001", "inv2026002"}
        assert len(audit) == 1

    def test_persist_requires_db(self, sample_file: Path):
        with pytest.raises(ValueError):
            statement_parser.run(sample_file, persist=True)

    def test_supplier_override(self, sample_file: Path, db: Path):
        # Force a different supplier even though the text says Founding IP.
        result = statement_parser.run(
            sample_file, db_path=db, supplier_override="Mediterranean Movers"
        )
        assert result["supplier_name_detected"] == "Mediterranean Movers"
        assert result["confidence"] == 1.0

    def test_missing_file(self, tmp_path: Path):
        with pytest.raises(FileNotFoundError):
            statement_parser.run(tmp_path / "nope.csv")

    def test_claude_hook_is_threaded_through(self, tmp_path: Path, db: Path):
        # File with parseable text and no clear supplier — hook should be called
        # for supplier ID and ignored for invoices (because lines do parse).
        p = tmp_path / "anon.txt"
        p.write_text("Date Invoice Amount\n2026-01-05 INV-001 100.00\n")

        seen: list[str] = []

        def hook(stage, ctx):
            seen.append(stage)
            if stage == "identify_supplier":
                return {"supplier_id": 1, "supplier_name": "Hooked Inc", "confidence": 0.7}
            return None

        result = statement_parser.run(p, db_path=db, claude_hook=hook)
        assert "identify_supplier" in seen
        assert result["supplier_name_detected"] == "Hooked Inc"
        assert result["invoice_count"] == 1


# ---- CLI entry point --------------------------------------------------------

class TestCLI:
    def test_main_prints_json(self, sample_file: Path, capsys: pytest.CaptureFixture):
        code = statement_parser.main(["--file", str(sample_file)])
        captured = capsys.readouterr()
        assert code == 0
        payload = json.loads(captured.out)
        assert payload["invoice_count"] == 2

    def test_main_persists_with_flags(self, sample_file: Path, db: Path, capsys):
        code = statement_parser.main([
            "--file", str(sample_file),
            "--db", str(db),
            "--persist",
        ])
        captured = capsys.readouterr()
        assert code == 0
        payload = json.loads(captured.out)
        assert "statement_id" in payload
        with db_ops.connect(db) as conn:
            count = conn.execute("SELECT COUNT(*) AS c FROM statement_invoices").fetchone()["c"]
        assert count == 2

    def test_main_file_not_found(self, tmp_path: Path, capsys):
        code = statement_parser.main(["--file", str(tmp_path / "missing.txt")])
        captured = capsys.readouterr()
        assert code == 2
        assert "file not found" in captured.err

    def test_module_invocation(self, sample_file: Path):
        # Smoke: running as a module produces JSON on stdout.
        proc = subprocess.run(
            [sys.executable, "-m", "src.statement_parser", "--file", str(sample_file)],
            capture_output=True,
            text=True,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        assert proc.returncode == 0, proc.stderr
        payload = json.loads(proc.stdout)
        assert payload["invoice_count"] == 2
