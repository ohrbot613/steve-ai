#!/usr/bin/env python3
"""Run a deterministic local Steve AI reconciliation sample.

This is the credentials-free proof that Steve AI's current app backbone can run
from supplier statement + Xero-style data to payment recommendation, email
Drafts, Excel packs, status and audit output.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src import audit_logger, db_ops, reconciliation_app, status_query  # noqa: E402
from src.normalizer import parse_date  # noqa: E402


def _json_safe(value: Any) -> Any:
    """Convert nested date/Path-like values to JSON-friendly primitives."""
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_json_safe(payload), indent=2, sort_keys=True) + "\n")


def _load_expected(fixture_dir: Path) -> dict:
    return json.loads((fixture_dir / "expected.json").read_text())


def _status_counts(reconcile_result: dict) -> dict[str, int]:
    rows = reconcile_result["reconciliation"]["results"]
    return dict(Counter(row["match_status"] for row in rows))


def _supplier_dirs(fixture_root: Path) -> list[Path]:
    return sorted(p for p in fixture_root.iterdir() if p.is_dir())


def run_sample(fixture_root: Path, out_dir: Path, *, keep_existing: bool = False, excel: bool = True) -> dict:
    if out_dir.exists() and not keep_existing:
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    db_path = out_dir / "steve.db"
    init_result = reconciliation_app.cmd_init(db_path)
    _write_json(out_dir / "init.json", init_result)

    supplier_summaries: list[dict] = []
    for fixture_dir in _supplier_dirs(fixture_root):
        expected = _load_expected(fixture_dir)
        supplier_slug = fixture_dir.name
        supplier_out = out_dir / supplier_slug
        supplier_out.mkdir(parents=True, exist_ok=True)

        with db_ops.connect(db_path) as conn:
            db_ops.upsert_supplier(
                conn,
                expected["supplier"],
                currency=expected.get("currency", "USD"),
            )

        ingest = reconciliation_app.cmd_ingest_statement(
            db_path,
            fixture_dir / "statement.csv",
            supplier_override=expected["supplier"],
        )
        load_xero = reconciliation_app.cmd_load_xero_file(
            db_path,
            expected["supplier"],
            fixture_dir / "xero_invoices.json",
        )
        excel_path = supplier_out / "reconciliation.xlsx" if excel else None
        reconcile = reconciliation_app.cmd_reconcile(
            db_path,
            int(ingest["statement_id"]),
            terms_days=int(expected["terms_days"]),
            terms_type=expected["terms_type"],
            tier=expected["tier"],
            today=parse_date(expected["today"]),
            draft_emails=True,
            excel_path=excel_path,
        )

        counts = _status_counts(reconcile)
        selected_tier = reconcile["payment"].get("selected_tier") or {}
        draft_templates = [d.get("template") for d in reconcile.get("drafts", [])]
        supplier_summary = {
            "fixture": supplier_slug,
            "supplier": expected["supplier"],
            "statement_id": ingest["statement_id"],
            "status_counts": counts,
            "payment_total": selected_tier.get("total", 0),
            "payment_invoice_count": selected_tier.get("invoice_count", 0),
            "payment_blocked_reason": reconcile["payment"].get("blocked_reason"),
            "draft_templates": draft_templates,
            "excel_output": reconcile.get("excel_output"),
        }

        _write_json(supplier_out / "ingest.json", ingest)
        _write_json(supplier_out / "load_xero.json", load_xero)
        _write_json(supplier_out / "reconcile.json", reconcile)
        _write_json(supplier_out / "summary.json", supplier_summary)
        supplier_summaries.append(supplier_summary)

    status = {"suppliers": status_query.get_supplier_status(db_path)}
    discrepancies = {"open_discrepancies": status_query.get_open_discrepancies(db_path)}
    audit_entries = audit_logger.query_audit_log(db_path)
    audit = {"count": len(audit_entries), "entries": [entry.to_dict() for entry in audit_entries]}
    summary = {
        "db_path": str(db_path),
        "fixture_root": str(fixture_root),
        "supplier_count": len(supplier_summaries),
        "suppliers": supplier_summaries,
        "status": status,
        "open_discrepancy_count": len(discrepancies["open_discrepancies"]),
        "audit_count": audit["count"],
    }

    _write_json(out_dir / "summary.json", summary)
    _write_json(out_dir / "status.json", status)
    _write_json(out_dir / "discrepancies.json", discrepancies)
    _write_json(out_dir / "audit.json", audit)
    (out_dir / "summary.md").write_text(_summary_markdown(summary) + "\n")
    return summary


def _summary_markdown(summary: dict) -> str:
    lines = [
        "# Steve AI sample reconciliation run",
        "",
        f"Database: `{summary['db_path']}`",
        f"Suppliers processed: **{summary['supplier_count']}**",
        f"Open discrepancies: **{summary['open_discrepancy_count']}**",
        f"Audit events: **{summary['audit_count']}**",
        "",
        "| Supplier | Status counts | Payment | Blocked? | Drafts |",
        "|---|---:|---:|---|---|",
    ]
    for s in summary["suppliers"]:
        counts = ", ".join(f"{k}: {v}" for k, v in sorted(s["status_counts"].items()))
        blocked = s.get("payment_blocked_reason") or "No"
        drafts = ", ".join(s.get("draft_templates") or []) or "None"
        lines.append(
            f"| {s['supplier']} | {counts} | {s['payment_total']} | {blocked} | {drafts} |"
        )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Steve AI's local synthetic reconciliation sample.")
    parser.add_argument("--fixture", default=str(ROOT / "tests/fixtures/sample_pipeline"), help="Fixture root directory")
    parser.add_argument("--out", default=str(ROOT / "artifacts/sample_pipeline"), help="Output directory")
    parser.add_argument("--keep-existing", action="store_true", help="Do not delete an existing output directory first")
    parser.add_argument("--no-excel", action="store_true", help="Skip Excel workbook generation")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    summary = run_sample(
        Path(args.fixture),
        Path(args.out),
        keep_existing=args.keep_existing,
        excel=not args.no_excel,
    )
    print(json.dumps(_json_safe(summary), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
