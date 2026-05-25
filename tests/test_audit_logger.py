import csv
import io
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from src import audit_logger, db_ops


@pytest.fixture()
def db(tmp_path: Path) -> Path:
    path = tmp_path / "steve.db"
    db_ops.init_db(path)
    return path


def _seed_events(db_path: Path) -> None:
    audit_logger.log_event(
        db_path,
        actor="parser",
        action=audit_logger.ACTION_STATEMENT_PARSED,
        entity_type="statement",
        entity_id="1",
        payload={"supplier_id": 1, "invoice_count": 3},
    )
    audit_logger.log_event(
        db_path,
        actor="reconciliation_app",
        action=audit_logger.ACTION_RECONCILIATION_RUN,
        entity_type="statement",
        entity_id="1",
        payload={"supplier_id": 1, "result_count": 5},
    )
    audit_logger.log_event(
        db_path,
        actor="reconciliation_app",
        action=audit_logger.ACTION_PAYMENT_CALCULATED,
        entity_type="statement",
        entity_id="2",
        payload={"supplier_id": 2, "tier": "strict", "total": 1000.0},
    )


class TestLogEvent:
    def test_writes_entry(self, db: Path):
        rid = audit_logger.log_event(
            db,
            actor="test",
            action=audit_logger.ACTION_EMAIL_DRAFTED,
            entity_type="supplier",
            entity_id="1",
            payload={"hello": "world"},
        )
        assert rid >= 1
        entries = audit_logger.query_audit_log(db)
        assert len(entries) == 1
        assert entries[0].action == audit_logger.ACTION_EMAIL_DRAFTED
        assert entries[0].payload == {"hello": "world"}

    def test_log_event_conn_reuses_connection(self, db: Path):
        with db_ops.connect(db) as conn:
            audit_logger.log_event_conn(
                conn,
                action=audit_logger.ACTION_EXCEL_GENERATED,
                entity_type="statement",
                entity_id="42",
                payload={"output": "/tmp/x.xlsx"},
            )
        entries = audit_logger.query_audit_log(db)
        assert entries[0].entity_id == "42"
        assert entries[0].actor == audit_logger.DEFAULT_ACTOR

    def test_immutability_still_enforced(self, db: Path):
        audit_logger.log_event(
            db, action="test", entity_type="x", entity_id="1",
        )
        with db_ops.connect(db) as conn:
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute("UPDATE audit_log SET action = 'tampered'")
        with db_ops.connect(db) as conn:
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute("DELETE FROM audit_log")


class TestQuery:
    def test_filter_by_action(self, db: Path):
        _seed_events(db)
        entries = audit_logger.query_audit_log(
            db, action=audit_logger.ACTION_RECONCILIATION_RUN,
        )
        assert len(entries) == 1
        assert entries[0].entity_id == "1"

    def test_filter_by_actor(self, db: Path):
        _seed_events(db)
        entries = audit_logger.query_audit_log(db, actor="parser")
        assert len(entries) == 1
        assert entries[0].action == audit_logger.ACTION_STATEMENT_PARSED

    def test_filter_by_entity(self, db: Path):
        _seed_events(db)
        entries = audit_logger.query_audit_log(
            db, entity_type="statement", entity_id="1",
        )
        assert len(entries) == 2

    def test_filter_by_supplier_via_payload(self, db: Path):
        _seed_events(db)
        entries = audit_logger.query_audit_log(db, supplier_id=2)
        assert len(entries) == 1
        assert entries[0].action == audit_logger.ACTION_PAYMENT_CALCULATED

    def test_limit_and_order(self, db: Path):
        _seed_events(db)
        desc = audit_logger.query_audit_log(db, order="desc", limit=2)
        assert [e.id for e in desc] == sorted([e.id for e in desc], reverse=True)
        assert len(desc) == 2


class TestExportCsv:
    def test_export_to_file(self, db: Path, tmp_path: Path):
        _seed_events(db)
        out = tmp_path / "audit.csv"
        entries = audit_logger.query_audit_log(db)
        n = audit_logger.export_csv(entries, out)
        assert n == 3
        rows = list(csv.DictReader(out.open()))
        assert len(rows) == 3
        assert rows[0]["action"] == audit_logger.ACTION_STATEMENT_PARSED
        # payload is round-trippable JSON
        assert json.loads(rows[0]["payload"]) == {"invoice_count": 3, "supplier_id": 1}

    def test_export_to_stringio(self, db: Path):
        _seed_events(db)
        entries = audit_logger.query_audit_log(db)
        buf = io.StringIO()
        audit_logger.export_csv(entries, buf)
        text = buf.getvalue()
        assert text.splitlines()[0].startswith("id,created_at,actor")


class TestCLI:
    def test_query_emits_json(self, db: Path, capsys):
        _seed_events(db)
        code = audit_logger.main(["--db", str(db)])
        captured = capsys.readouterr()
        assert code == 0
        out = json.loads(captured.out)
        assert out["count"] == 3
        assert {e["action"] for e in out["entries"]} >= {
            audit_logger.ACTION_STATEMENT_PARSED,
            audit_logger.ACTION_RECONCILIATION_RUN,
        }

    def test_supplier_filter(self, db: Path, capsys):
        _seed_events(db)
        code = audit_logger.main(["--db", str(db), "--supplier", "2"])
        captured = capsys.readouterr()
        assert code == 0
        out = json.loads(captured.out)
        assert out["count"] == 1

    def test_export_csv_to_file(self, db: Path, tmp_path: Path):
        _seed_events(db)
        out = tmp_path / "out.csv"
        code = audit_logger.main([
            "--db", str(db),
            "--export-csv", str(out),
        ])
        assert code == 0
        rows = list(csv.DictReader(out.open()))
        assert len(rows) == 3

    def test_module_invocation(self, db: Path):
        _seed_events(db)
        proc = subprocess.run(
            [sys.executable, "-m", "src.audit_logger",
             "--db", str(db), "--action", audit_logger.ACTION_PAYMENT_CALCULATED],
            capture_output=True, text=True,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        assert proc.returncode == 0, proc.stderr
        out = json.loads(proc.stdout)
        assert out["count"] == 1
