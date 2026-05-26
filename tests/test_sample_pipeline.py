import json
import subprocess
import sys
from pathlib import Path

from scripts.run_sample_reconciliation import run_sample


ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ROOT = ROOT / "tests/fixtures/sample_pipeline"


def _load_json(path: Path):
    return json.loads(path.read_text())


def test_sample_pipeline_programmatic_run(tmp_path):
    out = tmp_path / "sample-run"
    summary = run_sample(FIXTURE_ROOT, out)

    assert summary["supplier_count"] == 3
    assert (out / "steve.db").exists()
    assert (out / "summary.json").exists()
    assert (out / "summary.md").exists()
    assert (out / "status.json").exists()
    assert (out / "audit.json").exists()

    by_supplier = {item["supplier"]: item for item in summary["suppliers"]}

    founding = by_supplier["Founding IP"]
    assert founding["status_counts"] == {"MATCHED": 2}
    assert founding["payment_total"] == 300.0
    assert founding["payment_blocked_reason"] is None
    assert founding["draft_templates"] == ["payment_confirmation"]
    assert Path(founding["excel_output"]).exists()

    stalker = by_supplier["Stalker IP"]
    assert stalker["status_counts"] == {
        "MATCHED": 1,
        "MISSING_FROM_STATEMENT": 1,
        "MISSING_FROM_XERO": 1,
    }
    assert stalker["payment_total"] == 150.0
    assert "missing_invoices" in stalker["draft_templates"]
    assert "payment_confirmation" in stalker["draft_templates"]

    khip = by_supplier["KHIP"]
    assert khip["status_counts"] == {"CURRENCY_MISMATCH": 1}
    assert khip["payment_total"] == 0
    assert "CURRENCY_MISMATCH" in khip["payment_blocked_reason"]
    assert khip["draft_templates"] == []

    audit = _load_json(out / "audit.json")
    actions = {entry["action"] for entry in audit["entries"]}
    assert {"parse", "xero.invoices_loaded", "reconciliation.run", "payment.calculated", "email.drafted"} <= actions


def test_sample_pipeline_script_cli(tmp_path):
    out = tmp_path / "cli-run"
    result = subprocess.run(
        [sys.executable, "scripts/run_sample_reconciliation.py", "--out", str(out)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    payload = json.loads(result.stdout)
    assert payload["supplier_count"] == 3
    assert (out / "summary.json").exists()
    assert (out / "founding_ip" / "reconcile.json").exists()
    assert (out / "stalker_ip" / "reconciliation.xlsx").exists()
    assert (out / "khip" / "summary.json").exists()
