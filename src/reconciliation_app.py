"""End-to-end reconciliation orchestrator CLI.

Glues the existing engine modules into a single workflow without adding any
new dependencies:

* ``init``              — create the SQLite schema (and seed suppliers)
* ``ingest-statement``  — parse + persist a supplier statement file
* ``load-xero``         — upsert Xero invoices for a supplier from JSON
* ``reconcile``         — run matching on a stored statement, persist results,
                          optionally compute a payment tier, draft emails, and
                          generate an Excel workbook
* ``status``            — print supplier/discrepancy overview (delegates to
                          :mod:`status_query` formatters)
* ``audit``             — query the append-only audit log
                          (delegates to :mod:`audit_logger`)

The orchestrator is the *only* place where the modules are wired together.
Each subcommand also has a programmatic entry point (``cmd_*``) so tests can
exercise the flow without going through argparse.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

from . import (
    audit_logger,
    db_ops,
    email_drafter,
    matcher,
    payment,
    statement_parser,
    status_query,
)


# ---- helpers -----------------------------------------------------------------

def _require_supplier(conn: sqlite3.Connection, name_or_id) -> dict:
    """Resolve a supplier by id or name/alias; raise ValueError if not found."""
    if isinstance(name_or_id, int) or (isinstance(name_or_id, str) and name_or_id.isdigit()):
        sid = int(name_or_id)
        row = conn.execute("SELECT * FROM suppliers WHERE id = ?", (sid,)).fetchone()
        if row is None:
            raise ValueError(f"supplier id {sid} not found")
        return {k: row[k] for k in row.keys()}
    row = db_ops.get_supplier_by_alias(conn, str(name_or_id))
    if row is None:
        raise ValueError(f"supplier {name_or_id!r} not found (try `init` to seed first)")
    return row


def _load_statement_record(conn: sqlite3.Connection, statement_id: int) -> dict:
    row = conn.execute("SELECT * FROM statements WHERE id = ?", (statement_id,)).fetchone()
    if row is None:
        raise ValueError(f"statement id {statement_id} not found")
    return {k: row[k] for k in row.keys()}


def _load_statement_invoices(conn: sqlite3.Connection, statement_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM statement_invoices WHERE statement_id = ? ORDER BY id",
        (statement_id,),
    ).fetchall()
    return [{k: r[k] for k in r.keys()} for r in rows]


def _load_xero_invoices(conn: sqlite3.Connection, supplier_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM xero_invoices WHERE supplier_id = ? ORDER BY id",
        (supplier_id,),
    ).fetchall()
    return [{k: r[k] for k in r.keys()} for r in rows]


# ---- subcommand: init --------------------------------------------------------

def cmd_init(db_path: str | Path, *, seed: bool = True) -> dict:
    """Apply the schema; idempotent (CREATE IF NOT EXISTS everywhere)."""
    db_ops.init_db(db_path, seed=seed)
    with db_ops.connect(db_path) as conn:
        n = conn.execute("SELECT COUNT(*) AS c FROM suppliers").fetchone()["c"]
        audit_logger.log_event_conn(
            conn,
            actor="reconciliation_app",
            action=audit_logger.ACTION_CORRECTION_APPLIED,
            entity_type="database",
            entity_id=str(Path(db_path)),
            payload={"event": "init_db", "seeded_suppliers": n, "seed_loaded": seed},
        )
    return {"db_path": str(db_path), "suppliers": n, "seeded": seed}


# ---- subcommand: ingest-statement -------------------------------------------

def cmd_ingest_statement(
    db_path: str | Path,
    file_path: str | Path,
    *,
    supplier_override: Optional[str] = None,
) -> dict:
    """Parse ``file_path``, persist statement + statement_invoices, log audit.

    Returns the parsed statement dict (with ``statement_id``).
    """
    result = statement_parser.run(
        file_path,
        db_path=db_path,
        persist=True,
        supplier_override=supplier_override,
    )
    return result


# ---- subcommand: load-xero --------------------------------------------------

def cmd_load_xero(
    db_path: str | Path,
    supplier: str,
    invoices: Sequence[dict],
) -> dict:
    """Upsert Xero invoices for ``supplier`` from an in-memory list."""
    with db_ops.connect(db_path) as conn:
        sup = _require_supplier(conn, supplier)
        ids = db_ops.upsert_xero_invoices(conn, sup["id"], invoices)
        audit_logger.log_event_conn(
            conn,
            actor="reconciliation_app",
            action=audit_logger.ACTION_XERO_INVOICES_LOADED,
            entity_type="supplier",
            entity_id=str(sup["id"]),
            payload={"supplier_id": sup["id"], "invoice_count": len(ids)},
        )
    return {"supplier_id": sup["id"], "supplier_name": sup["name"], "loaded": len(ids)}


def cmd_load_xero_file(
    db_path: str | Path,
    supplier: str,
    file_path: str | Path,
) -> dict:
    """Load Xero invoices from a JSON file (list of invoice dicts)."""
    data = json.loads(Path(file_path).read_text())
    if isinstance(data, dict):
        data = data.get("invoices") or []
    if not isinstance(data, list):
        raise ValueError("Xero JSON must be a list of invoice objects (or {invoices: [...]})")
    return cmd_load_xero(db_path, supplier, data)


# ---- email grouping (used by reconcile) -------------------------------------

def _group_results_for_email(
    results: Sequence[dict],
    statement_invoices_by_id: dict,
    xero_invoices_by_id: dict,
) -> dict[str, list[dict]]:
    """Slice matcher rows into the four template buckets the drafter needs."""
    missing: list[dict] = []
    mismatch: list[dict] = []
    already_paid: list[dict] = []
    matched: list[dict] = []
    for row in results:
        status = row.get("match_status")
        s_inv = statement_invoices_by_id.get(row.get("statement_invoice_id")) or {}
        x_inv = xero_invoices_by_id.get(row.get("xero_invoice_id")) or {}
        if status == matcher.MATCHED:
            matched.append({
                "id": x_inv.get("id") or s_inv.get("id"),
                "invoice_number": x_inv.get("invoice_number") or s_inv.get("invoice_number"),
                "amount": x_inv.get("amount") or s_inv.get("amount"),
                "currency": x_inv.get("currency") or s_inv.get("currency"),
                "invoice_date": x_inv.get("invoice_date") or s_inv.get("invoice_date"),
            })
        elif status == matcher.MISSING_FROM_XERO:
            if s_inv:
                missing.append({
                    "invoice_number": s_inv.get("invoice_number"),
                    "amount": s_inv.get("amount"),
                    "currency": s_inv.get("currency"),
                    "invoice_date": s_inv.get("invoice_date"),
                })
        elif status == matcher.AMOUNT_MISMATCH:
            mismatch.append({
                "invoice_number": (s_inv.get("invoice_number")
                                   or x_inv.get("invoice_number")),
                "statement_amount": s_inv.get("amount"),
                "xero_amount": x_inv.get("amount"),
                "invoice_date": s_inv.get("invoice_date") or x_inv.get("invoice_date"),
            })
        elif status == matcher.ALREADY_PAID and s_inv:
            already_paid.append({
                "invoice_number": s_inv.get("invoice_number") or x_inv.get("invoice_number"),
                "amount": x_inv.get("amount") or s_inv.get("amount"),
                "currency": x_inv.get("currency") or s_inv.get("currency"),
                "paid_on": x_inv.get("updated_at"),
            })
    return {
        "missing": missing,
        "mismatch": mismatch,
        "already_paid": already_paid,
        "matched": matched,
    }


def _draft_emails(
    supplier: dict,
    buckets: dict[str, list[dict]],
    *,
    currency: Optional[str],
    payment_tier: Optional[dict],
) -> list[dict]:
    drafts: list[dict] = []
    if buckets["missing"]:
        drafts.append(email_drafter.draft_missing_invoices(
            supplier, buckets["missing"], currency=currency,
        ).to_dict())
    if buckets["mismatch"]:
        drafts.append(email_drafter.draft_amount_mismatch(
            supplier, buckets["mismatch"], currency=currency,
        ).to_dict())
    if buckets["already_paid"]:
        drafts.append(email_drafter.draft_already_paid(
            supplier, buckets["already_paid"], currency=currency,
        ).to_dict())
    if payment_tier and payment_tier.get("invoices"):
        drafts.append(email_drafter.draft_payment_confirmation(
            supplier,
            payment_tier["invoices"],
            total=payment_tier.get("total"),
            currency=currency,
        ).to_dict())
    return drafts


# ---- subcommand: reconcile --------------------------------------------------

def cmd_reconcile(
    db_path: str | Path,
    statement_id: int,
    *,
    terms_days: Optional[int] = None,
    terms_type: Optional[str] = None,
    tier: str = payment.TIER_STRICT,
    today=None,
    draft_emails: bool = False,
    excel_path: Optional[str | Path] = None,
) -> dict:
    """Run the end-to-end reconciliation for one stored statement.

    Flow:
      1. Load statement + its invoices + that supplier's Xero invoices.
      2. Run :func:`matcher.match_invoices` and persist the rows.
      3. If currency gate passes and terms are provided, compute payment tiers.
      4. Optionally draft emails (one per non-empty bucket).
      5. Optionally generate an Excel workbook.
      6. Append an audit entry summarising the run.
    """
    with db_ops.connect(db_path) as conn:
        statement_row = _load_statement_record(conn, statement_id)
        if statement_row["supplier_id"] is None:
            raise ValueError(
                f"statement {statement_id} has no supplier_id — assign one before reconciling"
            )
        supplier = _require_supplier(conn, statement_row["supplier_id"])
        statement_invoices = _load_statement_invoices(conn, statement_id)
        xero_invoices = _load_xero_invoices(conn, supplier["id"])

        reconciliation = matcher.match_invoices(
            statement_invoices,
            xero_invoices,
            statement_total=statement_row.get("statement_total"),
        )
        db_ops.create_reconciliation(conn, statement_id, reconciliation["results"])

        audit_logger.log_event_conn(
            conn,
            actor="reconciliation_app",
            action=audit_logger.ACTION_RECONCILIATION_RUN,
            entity_type="statement",
            entity_id=str(statement_id),
            payload={
                "supplier_id": supplier["id"],
                "result_count": len(reconciliation["results"]),
                "overall_confidence": reconciliation["overall_confidence"],
                "needs_review": len(reconciliation["needs_review"]),
            },
        )

    # Re-open for tier / email / excel work (read-only, so a fresh connection
    # keeps the writes above committed and isolates failures here).
    statement_invoices_by_id = {i["id"]: i for i in statement_invoices}
    xero_invoices_by_id = {i["id"]: i for i in xero_invoices}
    currency = statement_row.get("currency") or supplier.get("currency")

    payment_tier: Optional[dict] = None
    tiers: Optional[dict] = None
    blocked_reason: Optional[str] = None
    if terms_days is not None and terms_type is not None:
        if not payment.check_currency_gate(reconciliation):
            blocked_reason = "CURRENCY_MISMATCH in reconciliation — payment skipped"
        else:
            matched_buckets = _group_results_for_email(
                reconciliation["results"],
                statement_invoices_by_id,
                xero_invoices_by_id,
            )
            matched_invoices = [
                m for m in matched_buckets["matched"] if m.get("invoice_date")
            ]
            if matched_invoices:
                tiers = payment.calculate_payment_tiers(
                    matched_invoices,
                    terms_days=terms_days,
                    terms_type=terms_type,
                    today=today,
                )
                payment_tier = tiers.get(tier)
                with db_ops.connect(db_path) as conn:
                    audit_logger.log_event_conn(
                        conn,
                        actor="reconciliation_app",
                        action=audit_logger.ACTION_PAYMENT_CALCULATED,
                        entity_type="statement",
                        entity_id=str(statement_id),
                        payload={
                            "supplier_id": supplier["id"],
                            "tier": tier,
                            "total": payment_tier["total"] if payment_tier else 0,
                            "invoice_count": (payment_tier["invoice_count"]
                                              if payment_tier else 0),
                        },
                    )

    buckets = _group_results_for_email(
        reconciliation["results"],
        statement_invoices_by_id,
        xero_invoices_by_id,
    )

    drafts: list[dict] = []
    if draft_emails:
        drafts = _draft_emails(supplier, buckets, currency=currency,
                               payment_tier=payment_tier)
        if drafts:
            with db_ops.connect(db_path) as conn:
                for d in drafts:
                    audit_logger.log_event_conn(
                        conn,
                        actor="reconciliation_app",
                        action=audit_logger.ACTION_EMAIL_DRAFTED,
                        entity_type="supplier",
                        entity_id=str(supplier["id"]),
                        payload={
                            "supplier_id": supplier["id"],
                            "template": d["template"],
                            "subject": d["subject"],
                        },
                    )

    excel_output: Optional[str] = None
    if excel_path is not None:
        try:
            from . import excel_gen  # lazy import — keep openpyxl optional
            statement_dict = {
                **statement_row,
                "statement_invoices": statement_invoices,
                "xero_invoices": xero_invoices,
            }
            audit_rows = []
            with db_ops.connect(db_path) as conn:
                rows = conn.execute(
                    "SELECT * FROM audit_log WHERE entity_type = 'statement' "
                    "AND entity_id = ? ORDER BY id",
                    (str(statement_id),),
                ).fetchall()
                audit_rows = [{k: r[k] for k in r.keys()} for r in rows]
            written = excel_gen.generate_reconciliation_workbook(
                supplier=supplier,
                statement=statement_dict,
                reconciliation_results=reconciliation,
                payment_tier=payment_tier,
                audit_entries=audit_rows,
                output_path=excel_path,
            )
            excel_output = str(written)
            with db_ops.connect(db_path) as conn:
                audit_logger.log_event_conn(
                    conn,
                    actor="reconciliation_app",
                    action=audit_logger.ACTION_EXCEL_GENERATED,
                    entity_type="statement",
                    entity_id=str(statement_id),
                    payload={"supplier_id": supplier["id"], "output": excel_output},
                )
        except ImportError as exc:
            blocked_reason = (blocked_reason or "") + f"; excel skipped: {exc}"

    return {
        "statement_id": statement_id,
        "supplier": {"id": supplier["id"], "name": supplier["name"]},
        "reconciliation": reconciliation,
        "payment": {
            "tier": tier if payment_tier else None,
            "selected_tier": payment_tier,
            "all_tiers": tiers,
            "blocked_reason": blocked_reason,
        },
        "drafts": drafts,
        "excel_output": excel_output,
    }


# ---- argparse plumbing ------------------------------------------------------

def _build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="reconciliation_app",
        description=(
            "Steve AI reconciliation orchestrator — connects parse, match, "
            "payment, email, audit and Excel into one CLI."
        ),
    )
    ap.add_argument("--db", required=True, help="Path to SQLite DB")
    sub = ap.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="Initialize the DB schema (and seed suppliers)")
    p_init.add_argument("--no-seed", action="store_true", help="Skip supplier seed insert")

    p_ing = sub.add_parser("ingest-statement", help="Parse + persist a statement file")
    p_ing.add_argument("--file", required=True)
    p_ing.add_argument("--supplier", help="Force supplier by name/alias")

    p_xero = sub.add_parser("load-xero", help="Upsert Xero invoices from a JSON file")
    p_xero.add_argument("--supplier", required=True, help="Supplier name/alias/id")
    p_xero.add_argument("--file", required=True,
                        help="JSON list of invoice dicts (or {invoices: [...]})")

    p_rec = sub.add_parser("reconcile", help="Run the full reconciliation flow")
    p_rec.add_argument("--statement-id", type=int, required=True)
    p_rec.add_argument("--terms-days", type=int)
    p_rec.add_argument("--terms-type", choices=[payment.TERMS_EOM, payment.TERMS_NET])
    p_rec.add_argument(
        "--tier",
        choices=[payment.TIER_STRICT, payment.TIER_CONSERVATIVE, payment.TIER_AGGRESSIVE],
        default=payment.TIER_STRICT,
    )
    p_rec.add_argument("--today", help="Override 'today' as YYYY-MM-DD")
    p_rec.add_argument("--draft-emails", action="store_true")
    p_rec.add_argument("--excel", help="Path for the generated .xlsx workbook")

    p_status = sub.add_parser("status", help="Supplier / discrepancy summary")
    p_status.add_argument("--supplier", help="Limit to a single supplier (name/alias)")
    p_status.add_argument("--discrepancies", action="store_true")
    p_status.add_argument("--json", action="store_true")

    p_audit = sub.add_parser("audit", help="Query the append-only audit log")
    p_audit.add_argument("--actor")
    p_audit.add_argument("--action")
    p_audit.add_argument("--entity-type")
    p_audit.add_argument("--entity-id")
    p_audit.add_argument("--supplier", type=int)
    p_audit.add_argument("--limit", type=int)
    p_audit.add_argument("--export-csv")

    return ap


def _dispatch(args) -> int:
    if args.command == "init":
        result = cmd_init(args.db, seed=not args.no_seed)
        json.dump(result, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0
    if args.command == "ingest-statement":
        result = cmd_ingest_statement(args.db, args.file, supplier_override=args.supplier)
        json.dump(result, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0
    if args.command == "load-xero":
        result = cmd_load_xero_file(args.db, args.supplier, args.file)
        json.dump(result, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0
    if args.command == "reconcile":
        from .normalizer import parse_date
        result = cmd_reconcile(
            args.db,
            args.statement_id,
            terms_days=args.terms_days,
            terms_type=args.terms_type,
            tier=args.tier,
            today=parse_date(args.today) if args.today else None,
            draft_emails=args.draft_emails,
            excel_path=args.excel,
        )
        json.dump(result, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0
    if args.command == "status":
        return status_query.main(_status_argv(args))
    if args.command == "audit":
        return audit_logger.main(_audit_argv(args))
    raise AssertionError(f"unknown command {args.command!r}")


def _status_argv(args) -> list[str]:
    out = ["--db", args.db]
    if args.supplier:
        out += ["--supplier", args.supplier]
    if args.discrepancies:
        out.append("--discrepancies")
    if args.json:
        out.append("--json")
    return out


def _audit_argv(args) -> list[str]:
    out = ["--db", args.db]
    if args.actor:
        out += ["--actor", args.actor]
    if args.action:
        out += ["--action", args.action]
    if args.entity_type:
        out += ["--entity-type", args.entity_type]
    if args.entity_id:
        out += ["--entity-id", str(args.entity_id)]
    if args.supplier is not None:
        out += ["--supplier", str(args.supplier)]
    if args.limit is not None:
        out += ["--limit", str(args.limit)]
    if args.export_csv:
        out += ["--export-csv", args.export_csv]
    return out


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        return _dispatch(args)
    except FileNotFoundError as exc:
        print(f"error: file not found: {exc}", file=sys.stderr)
        return 2
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except sqlite3.Error as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = [
    "cmd_init",
    "cmd_ingest_statement",
    "cmd_load_xero",
    "cmd_load_xero_file",
    "cmd_reconcile",
    "main",
]
