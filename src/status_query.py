"""Business-friendly status queries over the reconciliation DB.

Reads the two convenience views (``v_supplier_status``,
``v_open_discrepancies``) and turns them into plain English summaries the
CFO/console can show without knowing the schema.

Same data also returned as plain dicts for programmatic callers.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Optional

from . import db_ops

# ---- match-status to plain English -------------------------------------------
STATUS_LABELS = {
    "MATCHED": "Matched cleanly",
    "AMOUNT_MISMATCH": "Amount disagrees with Xero",
    "CURRENCY_MISMATCH": "Currency disagrees with Xero",
    "ALREADY_PAID": "Already paid in Xero",
    "MISSING_FROM_XERO": "On statement, missing in Xero",
    "MISSING_FROM_STATEMENT": "In Xero, missing from statement",
    "AMBIGUOUS": "Ambiguous — needs human review",
}


def _label(status: Optional[str]) -> str:
    return STATUS_LABELS.get(status or "", status or "Unknown")


# ---- queries -----------------------------------------------------------------

def get_supplier_status(db_path: str | Path) -> list[dict]:
    """All suppliers + last statement timestamp + open discrepancy count."""
    with db_ops.connect(db_path) as conn:
        return db_ops.get_supplier_status(conn)


def get_open_discrepancies(
    db_path: str | Path,
    supplier_id: Optional[int] = None,
) -> list[dict]:
    """All open (non-MATCHED) reconciliation rows, optionally filtered."""
    with db_ops.connect(db_path) as conn:
        return db_ops.get_open_discrepancies(conn, supplier_id)


def get_supplier_by_name(db_path: str | Path, name: str) -> Optional[dict]:
    """Resolve a supplier by canonical name or alias."""
    with db_ops.connect(db_path) as conn:
        return db_ops.get_supplier_by_alias(conn, name)


def supplier_overview(db_path: str | Path, supplier_id: int) -> dict:
    """Single supplier: status row + open discrepancies grouped by status."""
    with db_ops.connect(db_path) as conn:
        status_rows = db_ops.get_supplier_status(conn)
        supplier_row = next(
            (s for s in status_rows if s["supplier_id"] == supplier_id),
            None,
        )
        discrepancies = db_ops.get_open_discrepancies(conn, supplier_id)
    by_status: dict[str, list[dict]] = {}
    for d in discrepancies:
        by_status.setdefault(d["match_status"], []).append(d)
    return {
        "supplier": supplier_row,
        "open_discrepancies": discrepancies,
        "discrepancies_by_status": by_status,
        "discrepancy_count": len(discrepancies),
    }


# ---- formatting --------------------------------------------------------------

def format_supplier_status(rows: list[dict]) -> str:
    """Human-readable table of all suppliers + their reconciliation state."""
    if not rows:
        return "No suppliers found."
    lines = [f"Supplier status ({len(rows)} supplier(s)):", ""]
    name_w = max(len(r["supplier_name"]) for r in rows)
    for r in rows:
        name = r["supplier_name"].ljust(name_w)
        currency = r.get("currency") or "?"
        last = r.get("last_statement_at") or "never"
        opens = r.get("open_discrepancies") or 0
        flag = "OK" if opens == 0 else f"{opens} open"
        lines.append(
            f"  {name}  [{currency}]  last statement: {last:<20}  {flag}"
        )
    return "\n".join(lines)


def format_open_discrepancies(rows: list[dict]) -> str:
    """One-line-per-discrepancy view with friendly labels."""
    if not rows:
        return "No open discrepancies."
    lines = [f"Open discrepancies ({len(rows)} total):", ""]
    for r in rows:
        diff = r.get("amount_difference") or 0
        diff_clause = f" diff {diff:+.2f}" if diff else ""
        reasoning = (r.get("reasoning") or "").strip()
        if len(reasoning) > 80:
            reasoning = reasoning[:77] + "..."
        lines.append(
            f"  #{r['reconciliation_id']:<5} supplier {r['supplier_id']:<3} "
            f"statement {r['statement_id']:<5} "
            f"{_label(r['match_status']):<35}{diff_clause}"
        )
        if reasoning:
            lines.append(f"          -> {reasoning}")
    return "\n".join(lines)


def format_supplier_overview(overview: dict) -> str:
    """Per-supplier summary: status header + grouped discrepancy buckets."""
    supplier = overview.get("supplier")
    if not supplier:
        return "Supplier not found."
    lines = [
        f"Supplier: {supplier['supplier_name']}  [{supplier.get('currency') or '?'}]",
        f"  Last statement received: {supplier.get('last_statement_at') or 'never'}",
        f"  Open discrepancies: {overview['discrepancy_count']}",
    ]
    by_status = overview["discrepancies_by_status"]
    if not by_status:
        lines.append("  -> All clear.")
        return "\n".join(lines)
    lines.append("")
    for status, rows in sorted(by_status.items()):
        lines.append(f"  {_label(status)} ({len(rows)}):")
        for r in rows:
            diff = r.get("amount_difference") or 0
            tag = f" diff {diff:+.2f}" if diff else ""
            lines.append(f"    - reconciliation #{r['reconciliation_id']}{tag}")
    return "\n".join(lines)


# ---- CLI ---------------------------------------------------------------------

def _build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=(
            "Read supplier + reconciliation status from the SQLite DB. "
            "Defaults to a friendly text view; use --json for raw output."
        )
    )
    ap.add_argument("--db", required=True, help="Path to SQLite DB")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--all", action="store_true", help="List every supplier (default)")
    group.add_argument("--supplier", help="Supplier name or alias for an overview")
    group.add_argument(
        "--discrepancies",
        action="store_true",
        help="List all open discrepancies (optionally filter with --supplier)",
    )
    ap.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    return ap


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        if args.supplier:
            supplier = get_supplier_by_name(args.db, args.supplier)
            if supplier is None:
                print(f"error: supplier {args.supplier!r} not found", file=sys.stderr)
                return 1
            if args.discrepancies:
                rows = get_open_discrepancies(args.db, supplier["id"])
                if args.json:
                    json.dump({"supplier": supplier, "open_discrepancies": rows},
                              sys.stdout, indent=2, default=str)
                else:
                    print(format_open_discrepancies(rows))
            else:
                overview = supplier_overview(args.db, supplier["id"])
                if args.json:
                    json.dump(overview, sys.stdout, indent=2, default=str)
                else:
                    print(format_supplier_overview(overview))
        elif args.discrepancies:
            rows = get_open_discrepancies(args.db)
            if args.json:
                json.dump({"open_discrepancies": rows}, sys.stdout, indent=2, default=str)
            else:
                print(format_open_discrepancies(rows))
        else:
            rows = get_supplier_status(args.db)
            if args.json:
                json.dump({"suppliers": rows}, sys.stdout, indent=2, default=str)
            else:
                print(format_supplier_status(rows))
    except sqlite3.Error as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = [
    "STATUS_LABELS",
    "format_open_discrepancies",
    "format_supplier_overview",
    "format_supplier_status",
    "get_open_discrepancies",
    "get_supplier_by_name",
    "get_supplier_status",
    "main",
    "supplier_overview",
]
