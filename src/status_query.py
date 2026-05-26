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



# ---- corrections -------------------------------------------------------------

def _require_supplier(conn: sqlite3.Connection, supplier: int | str) -> dict:
    if isinstance(supplier, int) or (isinstance(supplier, str) and supplier.isdigit()):
        row = conn.execute("SELECT * FROM suppliers WHERE id = ?", (int(supplier),)).fetchone()
    else:
        return db_ops.get_supplier_by_alias(conn, str(supplier))
    return {k: row[k] for k in row.keys()} if row else None


def change_statement_supplier(
    db_path: str | Path,
    statement_id: int,
    supplier: int | str,
    *,
    actor: str = "status_query",
    note: Optional[str] = None,
) -> dict:
    """Move a statement to the correct supplier and audit the correction."""
    from . import audit_logger

    with db_ops.connect(db_path) as conn:
        st = conn.execute("SELECT * FROM statements WHERE id = ?", (statement_id,)).fetchone()
        if st is None:
            raise ValueError(f"statement id {statement_id} not found")
        sup = _require_supplier(conn, supplier)
        if sup is None:
            raise ValueError(f"supplier {supplier!r} not found")
        old_supplier_id = st["supplier_id"]
        conn.execute(
            "UPDATE statements SET supplier_id = ? WHERE id = ?",
            (sup["id"], statement_id),
        )
        audit_logger.log_event_conn(
            conn,
            actor=actor,
            action=audit_logger.ACTION_CORRECTION_APPLIED,
            entity_type="statement",
            entity_id=str(statement_id),
            payload={
                "correction": "change_statement_supplier",
                "statement_id": statement_id,
                "old_supplier_id": old_supplier_id,
                "new_supplier_id": sup["id"],
                "note": note,
            },
        )
    return {
        "statement_id": statement_id,
        "old_supplier_id": old_supplier_id,
        "new_supplier_id": sup["id"],
        "supplier_name": sup["name"],
    }


def delete_statement_invoice(
    db_path: str | Path,
    statement_invoice_id: int,
    *,
    actor: str = "status_query",
    note: Optional[str] = None,
) -> dict:
    """Delete an incorrect statement invoice line and audit the correction."""
    from . import audit_logger

    with db_ops.connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM statement_invoices WHERE id = ?",
            (statement_invoice_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f"statement invoice id {statement_invoice_id} not found")
        payload_invoice = {k: row[k] for k in row.keys()}
        # Remove dependent reconciliation rows for this statement line so open
        # discrepancy views do not keep showing a deleted invoice.
        deleted_recons = conn.execute(
            "DELETE FROM reconciliations WHERE statement_invoice_id = ?",
            (statement_invoice_id,),
        ).rowcount
        conn.execute("DELETE FROM statement_invoices WHERE id = ?", (statement_invoice_id,))
        audit_logger.log_event_conn(
            conn,
            actor=actor,
            action=audit_logger.ACTION_CORRECTION_APPLIED,
            entity_type="statement_invoice",
            entity_id=str(statement_invoice_id),
            payload={
                "correction": "delete_statement_invoice",
                "deleted_invoice": payload_invoice,
                "deleted_reconciliations": deleted_recons,
                "note": note,
            },
        )
    return {
        "statement_invoice_id": statement_invoice_id,
        "deleted_reconciliations": deleted_recons,
    }


def resolve_discrepancy(
    db_path: str | Path,
    reconciliation_id: int,
    *,
    resolution: str = "MATCHED",
    actor: str = "status_query",
    note: Optional[str] = None,
) -> dict:
    """Mark a discrepancy as manually resolved and audit the decision."""
    from . import audit_logger

    valid = set(STATUS_LABELS) | {"MATCHED"}
    if resolution not in valid:
        raise ValueError(f"resolution must be one of {sorted(valid)}, got {resolution!r}")
    with db_ops.connect(db_path) as conn:
        row = conn.execute(
            "SELECT * FROM reconciliations WHERE id = ?",
            (reconciliation_id,),
        ).fetchone()
        if row is None:
            raise ValueError(f"reconciliation id {reconciliation_id} not found")
        old_status = row["match_status"]
        reasoning = row["reasoning"] or ""
        suffix = f"Manual resolution: {note or resolution}"
        new_reasoning = (reasoning + "\n" + suffix).strip()
        conn.execute(
            """
            UPDATE reconciliations
            SET match_status = ?, match_method = 'manual', reasoning = ?
            WHERE id = ?
            """,
            (resolution, new_reasoning, reconciliation_id),
        )
        audit_logger.log_event_conn(
            conn,
            actor=actor,
            action=audit_logger.ACTION_CORRECTION_APPLIED,
            entity_type="reconciliation",
            entity_id=str(reconciliation_id),
            payload={
                "correction": "resolve_discrepancy",
                "old_status": old_status,
                "new_status": resolution,
                "note": note,
            },
        )
    return {
        "reconciliation_id": reconciliation_id,
        "old_status": old_status,
        "new_status": resolution,
    }


def mark_reconciled_without_statement(
    db_path: str | Path,
    supplier: int | str,
    xero_invoice_id: int | str,
    *,
    actor: str = "status_query",
    note: Optional[str] = None,
) -> dict:
    """Manually mark a Xero invoice as reconciled even without a statement."""
    from . import audit_logger

    with db_ops.connect(db_path) as conn:
        sup = _require_supplier(conn, supplier)
        if sup is None:
            raise ValueError(f"supplier {supplier!r} not found")
        row = conn.execute(
            """
            SELECT * FROM xero_invoices
            WHERE supplier_id = ? AND (id = ? OR xero_invoice_id = ? OR invoice_number = ?)
            """,
            (sup["id"], str(xero_invoice_id), str(xero_invoice_id), str(xero_invoice_id)),
        ).fetchone()
        if row is None:
            raise ValueError(f"xero invoice {xero_invoice_id!r} not found for supplier {sup['name']}")
        statement_id = db_ops.create_statement(
            conn,
            supplier_id=sup["id"],
            file_path="manual:no_statement",
            currency=row["currency"],
            statement_total=row["amount"],
            status="RECONCILED_WITHOUT_STATEMENT",
        )
        recon_id = db_ops.create_reconciliation(conn, statement_id, [{
            "statement_invoice_id": None,
            "xero_invoice_id": row["id"],
            "match_status": "MATCHED",
            "match_method": "manual",
            "confidence": 1.0,
            "amount_difference": 0.0,
            "reasoning": note or "Manually marked reconciled without supplier statement.",
        }])[0]
        audit_logger.log_event_conn(
            conn,
            actor=actor,
            action=audit_logger.ACTION_CORRECTION_APPLIED,
            entity_type="reconciliation",
            entity_id=str(recon_id),
            payload={
                "correction": "mark_reconciled_without_statement",
                "supplier_id": sup["id"],
                "xero_invoice_id": row["id"],
                "statement_id": statement_id,
                "note": note,
            },
        )
    return {
        "supplier_id": sup["id"],
        "statement_id": statement_id,
        "reconciliation_id": recon_id,
        "xero_invoice_id": row["id"],
    }

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
    group.add_argument(
        "--change-statement-supplier",
        type=int,
        metavar="STATEMENT_ID",
        help="Correction: move a statement to --to-supplier",
    )
    group.add_argument(
        "--delete-invoice",
        type=int,
        metavar="STATEMENT_INVOICE_ID",
        help="Correction: delete an incorrect statement invoice line",
    )
    group.add_argument(
        "--resolve-discrepancy",
        type=int,
        metavar="RECONCILIATION_ID",
        help="Correction: mark a discrepancy resolved",
    )
    group.add_argument(
        "--reconcile-without-statement",
        metavar="SUPPLIER",
        help="Correction: mark a Xero invoice reconciled without a statement",
    )
    ap.add_argument("--to-supplier", help="Supplier name/id for --change-statement-supplier")
    ap.add_argument("--xero-invoice", help="Xero invoice id/number for --reconcile-without-statement")
    ap.add_argument("--resolution", default="MATCHED", help="Resolution status for --resolve-discrepancy")
    ap.add_argument("--note", help="Human note to store with correction audit entry")
    ap.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    return ap


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        if args.change_statement_supplier is not None:
            if not args.to_supplier:
                print("error: --to-supplier is required", file=sys.stderr)
                return 1
            result = change_statement_supplier(
                args.db, args.change_statement_supplier, args.to_supplier, note=args.note,
            )
            if args.json:
                json.dump(result, sys.stdout, indent=2, default=str)
            else:
                print(
                    f"Statement {result['statement_id']} moved to "
                    f"{result['supplier_name']} (supplier #{result['new_supplier_id']})."
                )
        elif args.delete_invoice is not None:
            result = delete_statement_invoice(args.db, args.delete_invoice, note=args.note)
            if args.json:
                json.dump(result, sys.stdout, indent=2, default=str)
            else:
                print(
                    f"Deleted statement invoice {result['statement_invoice_id']} "
                    f"and {result['deleted_reconciliations']} related reconciliation row(s)."
                )
        elif args.resolve_discrepancy is not None:
            result = resolve_discrepancy(
                args.db, args.resolve_discrepancy, resolution=args.resolution, note=args.note,
            )
            if args.json:
                json.dump(result, sys.stdout, indent=2, default=str)
            else:
                print(
                    f"Resolved reconciliation {result['reconciliation_id']}: "
                    f"{result['old_status']} -> {result['new_status']}."
                )
        elif args.reconcile_without_statement is not None:
            if not args.xero_invoice:
                print("error: --xero-invoice is required", file=sys.stderr)
                return 1
            result = mark_reconciled_without_statement(
                args.db, args.reconcile_without_statement, args.xero_invoice, note=args.note,
            )
            if args.json:
                json.dump(result, sys.stdout, indent=2, default=str)
            else:
                print(
                    f"Marked Xero invoice {result['xero_invoice_id']} reconciled "
                    f"without statement via reconciliation {result['reconciliation_id']}."
                )
        elif args.supplier:
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
    "resolve_discrepancy",
    "mark_reconciled_without_statement",
    "delete_statement_invoice",
    "change_statement_supplier",
    "format_open_discrepancies",
    "format_supplier_overview",
    "format_supplier_status",
    "get_open_discrepancies",
    "get_supplier_by_name",
    "get_supplier_status",
    "main",
    "supplier_overview",
]
