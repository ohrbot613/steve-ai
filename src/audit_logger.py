"""Append-only audit log helpers + a query/export CLI.

The ``audit_log`` table is enforced append-only at the schema level
(UPDATE/DELETE triggers raise). This module gives the rest of the codebase a
small typed API for writing entries and a CLI for reading them.

Standard action types live in :data:`ACTIONS` so the rest of the app does not
sprinkle ad-hoc strings.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

from . import db_ops

# ---- standardized action types (Handbook §13) --------------------------------
ACTION_STATEMENT_PARSED = "statement.parsed"
ACTION_STATEMENT_PERSISTED = "statement.persisted"
ACTION_XERO_INVOICES_LOADED = "xero.invoices_loaded"
ACTION_RECONCILIATION_RUN = "reconciliation.run"
ACTION_RECONCILIATION_REVIEWED = "reconciliation.reviewed"
ACTION_PAYMENT_CALCULATED = "payment.calculated"
ACTION_PAYMENT_RELEASED = "payment.released"
ACTION_EMAIL_DRAFTED = "email.drafted"
ACTION_EMAIL_SENT = "email.sent"
ACTION_EXCEL_GENERATED = "excel.generated"
ACTION_DECISION_RECORDED = "decision.recorded"
ACTION_CORRECTION_APPLIED = "correction.applied"

ACTIONS = (
    ACTION_STATEMENT_PARSED,
    ACTION_STATEMENT_PERSISTED,
    ACTION_XERO_INVOICES_LOADED,
    ACTION_RECONCILIATION_RUN,
    ACTION_RECONCILIATION_REVIEWED,
    ACTION_PAYMENT_CALCULATED,
    ACTION_PAYMENT_RELEASED,
    ACTION_EMAIL_DRAFTED,
    ACTION_EMAIL_SENT,
    ACTION_EXCEL_GENERATED,
    ACTION_DECISION_RECORDED,
    ACTION_CORRECTION_APPLIED,
)

DEFAULT_ACTOR = "system"


@dataclass
class AuditEntry:
    """Public-shaped audit row (payload deserialized from JSON)."""
    id: int
    actor: str
    action: str
    entity_type: str
    entity_id: Optional[str]
    payload: Any
    created_at: str

    @classmethod
    def from_row(cls, row) -> "AuditEntry":
        payload_raw = row["payload"]
        try:
            payload = json.loads(payload_raw) if payload_raw else None
        except (TypeError, ValueError):
            payload = payload_raw
        return cls(
            id=row["id"],
            actor=row["actor"],
            action=row["action"],
            entity_type=row["entity_type"],
            entity_id=row["entity_id"],
            payload=payload,
            created_at=row["created_at"],
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "actor": self.actor,
            "action": self.action,
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "payload": self.payload,
            "created_at": self.created_at,
        }


# ---- write -------------------------------------------------------------------

def log_event(
    db_path: str | Path,
    *,
    actor: str = DEFAULT_ACTOR,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    payload: Optional[Any] = None,
) -> int:
    """Append a single audit entry, opening its own connection.

    For callers already inside a ``db_ops.connect(...)`` block, use
    :func:`db_ops.append_audit_log` directly — this wrapper exists for the
    one-shot write case (CLI, tests, opportunistic logging).
    """
    with db_ops.connect(db_path) as conn:
        return db_ops.append_audit_log(
            conn,
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            payload=payload,
        )


def log_event_conn(
    conn: sqlite3.Connection,
    *,
    actor: str = DEFAULT_ACTOR,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    payload: Optional[Any] = None,
) -> int:
    """Append-only write on an existing connection — thin pass-through."""
    return db_ops.append_audit_log(
        conn,
        actor=actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
    )


# ---- query -------------------------------------------------------------------

def query_audit_log(
    db_path: str | Path,
    *,
    actor: Optional[str] = None,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    supplier_id: Optional[int] = None,
    limit: Optional[int] = None,
    order: str = "ASC",
) -> list[AuditEntry]:
    """Filtered read of the audit log.

    ``supplier_id`` is a convenience that resolves to entries whose ``payload``
    JSON contains the matching id (covers both ``"supplier_id": N`` and
    explicit ``entity_type='supplier'`` rows).
    """
    where: list[str] = []
    params: list[Any] = []
    if actor:
        where.append("actor = ?")
        params.append(actor)
    if action:
        where.append("action = ?")
        params.append(action)
    if entity_type:
        where.append("entity_type = ?")
        params.append(entity_type)
    if entity_id is not None:
        where.append("entity_id = ?")
        params.append(str(entity_id))
    if since:
        where.append("created_at >= ?")
        params.append(since)
    if until:
        where.append("created_at <= ?")
        params.append(until)
    if supplier_id is not None:
        # Match either entity-type=supplier or payload that embeds the id.
        where.append(
            "((entity_type = 'supplier' AND entity_id = ?) "
            "OR payload LIKE ?)"
        )
        params.extend([str(supplier_id), f'%"supplier_id": {supplier_id}%'])

    sql = "SELECT * FROM audit_log"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += f" ORDER BY id {'DESC' if order.upper() == 'DESC' else 'ASC'}"
    if limit is not None:
        sql += " LIMIT ?"
        params.append(int(limit))

    with db_ops.connect(db_path) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [AuditEntry.from_row(r) for r in rows]


# ---- export ------------------------------------------------------------------

CSV_FIELDS = ("id", "created_at", "actor", "action", "entity_type", "entity_id", "payload")


def export_csv(entries: Iterable[AuditEntry], destination) -> int:
    """Write entries as CSV to a file path or file-like object. Returns count."""
    close_after = False
    if isinstance(destination, (str, Path)):
        fh = open(destination, "w", newline="", encoding="utf-8")
        close_after = True
    else:
        fh = destination
    try:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        writer.writeheader()
        count = 0
        for entry in entries:
            payload = entry.payload
            if payload is not None and not isinstance(payload, str):
                payload = json.dumps(payload, sort_keys=True, default=str)
            writer.writerow({
                "id": entry.id,
                "created_at": entry.created_at,
                "actor": entry.actor,
                "action": entry.action,
                "entity_type": entry.entity_type,
                "entity_id": entry.entity_id,
                "payload": payload,
            })
            count += 1
    finally:
        if close_after:
            fh.close()
    return count


# ---- CLI ---------------------------------------------------------------------

def _build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=(
            "Query the append-only audit_log table. Output is JSON by default; "
            "use --export-csv <path> to write a CSV instead."
        )
    )
    ap.add_argument("--db", required=True, help="Path to SQLite DB")
    ap.add_argument("--actor")
    ap.add_argument("--action", help="One of the standardized action types")
    ap.add_argument("--entity-type")
    ap.add_argument("--entity-id")
    ap.add_argument("--since", help="ISO datetime (e.g. 2026-01-01)")
    ap.add_argument("--until", help="ISO datetime (e.g. 2026-12-31T23:59:59)")
    ap.add_argument("--supplier", type=int, help="Supplier id (matches payload or entity)")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--order", choices=["asc", "desc"], default="asc")
    ap.add_argument(
        "--export-csv",
        help="Write results to this path as CSV; '-' for stdout",
    )
    return ap


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        entries = query_audit_log(
            args.db,
            actor=args.actor,
            action=args.action,
            entity_type=args.entity_type,
            entity_id=args.entity_id,
            since=args.since,
            until=args.until,
            supplier_id=args.supplier,
            limit=args.limit,
            order=args.order,
        )
    except sqlite3.Error as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.export_csv:
        if args.export_csv == "-":
            export_csv(entries, sys.stdout)
        else:
            count = export_csv(entries, args.export_csv)
            print(f"wrote {count} row(s) to {args.export_csv}", file=sys.stderr)
        return 0

    json.dump(
        {"count": len(entries), "entries": [e.to_dict() for e in entries]},
        sys.stdout,
        indent=2,
        default=str,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = [
    "ACTIONS",
    "ACTION_CORRECTION_APPLIED",
    "ACTION_DECISION_RECORDED",
    "ACTION_EMAIL_DRAFTED",
    "ACTION_EMAIL_SENT",
    "ACTION_EXCEL_GENERATED",
    "ACTION_PAYMENT_CALCULATED",
    "ACTION_PAYMENT_RELEASED",
    "ACTION_RECONCILIATION_REVIEWED",
    "ACTION_RECONCILIATION_RUN",
    "ACTION_STATEMENT_PARSED",
    "ACTION_STATEMENT_PERSISTED",
    "ACTION_XERO_INVOICES_LOADED",
    "AuditEntry",
    "CSV_FIELDS",
    "DEFAULT_ACTOR",
    "export_csv",
    "log_event",
    "log_event_conn",
    "main",
    "query_audit_log",
]
