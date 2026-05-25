"""CLI orchestrator: file in -> ParsedStatement JSON out, optional DB persist.

Usage::

    python -m src.statement_parser --file statement.pdf
    python -m src.statement_parser --file statement.csv --db steve.db --persist
    python -m src.statement_parser --file statement.xlsx --supplier "Founding IP"

The CLI never reaches out to Claude. A caller wiring in a hook should import
:func:`run` directly and pass ``claude_hook=...``.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from . import db_ops, parser


def run(
    file_path: str | Path,
    *,
    db_path: Optional[str | Path] = None,
    persist: bool = False,
    supplier_override: Optional[str] = None,
    claude_hook: Optional[parser.ClaudeHook] = None,
) -> dict:
    """Parse ``file_path``; optionally identify supplier against ``db_path`` and persist.

    Returns the parsed statement as a plain dict (the same shape the CLI prints).
    When ``persist=True`` and ``db_path`` is set, also stores ``statements`` +
    ``statement_invoices`` rows and includes ``statement_id`` in the response.
    """
    p = Path(file_path)
    if not p.exists():
        raise FileNotFoundError(p)

    known_aliases = None
    forced_supplier: Optional[dict] = None
    if db_path is not None:
        with db_ops.connect(db_path) as conn:
            known_aliases = parser.load_known_aliases(conn)
            if supplier_override:
                row = db_ops.get_supplier_by_alias(conn, supplier_override)
                if row is not None:
                    forced_supplier = {
                        "supplier_id": row["id"],
                        "supplier_name": row["name"],
                        "currency": row["currency"],
                    }

    statement = parser.parse_statement(
        p,
        known_aliases=known_aliases,
        claude_hook=claude_hook,
    )

    if forced_supplier is not None:
        statement.supplier_id = forced_supplier["supplier_id"]
        statement.supplier_name_detected = forced_supplier["supplier_name"]
        statement.supplier_confidence = 1.0
        if not statement.currency:
            statement.currency = forced_supplier["currency"]

    result = statement.to_dict()

    if persist:
        if db_path is None:
            raise ValueError("--persist requires --db <path>")
        result["statement_id"] = _persist(db_path, statement, str(p))

    return result


def _persist(db_path: str | Path, statement: parser.ParsedStatement, file_path: str) -> int:
    """Write the parsed statement + invoice rows; return new statement id."""
    with db_ops.connect(db_path) as conn:
        statement_id = db_ops.create_statement(
            conn,
            supplier_id=statement.supplier_id,
            file_path=file_path,
            currency=statement.currency,
            statement_total=statement.statement_total,
            status="PARSED" if statement.invoices else "EMPTY",
        )
        if statement.invoices:
            db_ops.add_statement_invoices(conn, statement_id, statement.invoices)
        db_ops.append_audit_log(
            conn,
            actor="statement_parser",
            action="parse",
            entity_type="statement",
            entity_id=str(statement_id),
            payload={
                "supplier_id": statement.supplier_id,
                "supplier_confidence": statement.supplier_confidence,
                "invoice_count": statement.invoice_count,
                "source": statement.source,
            },
        )
    return statement_id


def _build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Parse a supplier statement file.")
    ap.add_argument("--file", required=True, help="Path to PDF/Excel/CSV/text statement")
    ap.add_argument("--db", help="SQLite DB path (enables alias lookup + persistence)")
    ap.add_argument(
        "--persist",
        action="store_true",
        help="Insert parsed rows into the statements / statement_invoices tables",
    )
    ap.add_argument(
        "--supplier",
        help="Force a supplier by name/alias (looked up in --db); skips heuristic match",
    )
    return ap


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        result = run(
            args.file,
            db_path=args.db,
            persist=args.persist,
            supplier_override=args.supplier,
        )
    except FileNotFoundError as exc:
        print(f"error: file not found: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # surface a clean error from the CLI
        print(f"error: {exc}", file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
