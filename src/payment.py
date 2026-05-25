"""Payment calculator — turn matched invoices + terms into payable tiers.

Pure stdlib. Sits between the matcher (which decides what to pay against) and
the dashboard (which presents pay-now suggestions to the CFO).

Flow::

    reconciliation = matcher.match_invoices(...)
    if not payment.check_currency_gate(reconciliation):
        # surface CURRENCY_MISMATCH to user, stop
        ...
    matched = [enriched dicts with id, amount, invoice_date, currency]
    tiers = payment.calculate_payment_tiers(matched, terms_days=30, terms_type="net")
    warnings = payment.flag_large_invoices(tiers["aggressive"]["invoices"],
                                           tiers["aggressive"]["total"])
"""
from __future__ import annotations

import argparse
import calendar
import json
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable, Optional, Sequence

from .normalizer import parse_amount, parse_date

# ---- terms types -------------------------------------------------------------
TERMS_EOM = "eom"
TERMS_NET = "net"

# ---- tier names --------------------------------------------------------------
TIER_STRICT = "strict"
TIER_CONSERVATIVE = "conservative"
TIER_AGGRESSIVE = "aggressive"

# Default windows in days from "today". A tier includes every matched invoice
# whose due date is on-or-before (today + window_days).
DEFAULT_WINDOWS = {
    TIER_STRICT: 0,        # overdue + due today only
    TIER_CONSERVATIVE: 7,  # plus due within the next week
    TIER_AGGRESSIVE: 30,   # plus due within the next month
}

# ---- adjust_tier actions -----------------------------------------------------
ACTION_HOLD = "HOLD"
ACTION_EXTEND = "EXTEND"
ACTION_TIGHTEN = "TIGHTEN"

LARGE_INVOICE_DEFAULT_THRESHOLD = 0.40


# ---- due date ----------------------------------------------------------------

def calculate_due_date(invoice_date, terms_days: int, terms_type: str) -> date:
    """Compute the due date for a single invoice.

    ``terms_type``:
      * ``"net"`` -> invoice_date + ``terms_days`` days
        (e.g. Jan 15 + 60-day net -> Mar 16)
      * ``"eom"`` -> (invoice_date + ``terms_days``) rolled forward to the
        last day of that month — the standard "N days, end of month" AP
        convention (e.g. Jan 15 + 90-day EOM = Apr 15 -> Apr 30).
    """
    d = parse_date(invoice_date)
    if d is None:
        raise ValueError(f"invoice_date is required and must be parseable, got {invoice_date!r}")
    if terms_days < 0:
        raise ValueError(f"terms_days must be non-negative, got {terms_days}")
    kind = terms_type.lower()
    shifted = d + timedelta(days=terms_days)
    if kind == TERMS_NET:
        return shifted
    if kind == TERMS_EOM:
        last_day = calendar.monthrange(shifted.year, shifted.month)[1]
        return date(shifted.year, shifted.month, last_day)
    raise ValueError(f"terms_type must be 'eom' or 'net', got {terms_type!r}")


# ---- invoice enrichment ------------------------------------------------------

@dataclass
class _Invoice:
    """Internal staging: every input normalized once so tier math is trivial."""
    id: object  # stable identifier used by HOLD (xero_invoice_id or invoice_number)
    invoice_number: str
    invoice_date: date
    due_date: date
    amount: float
    currency: Optional[str]
    raw: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "invoice_number": self.invoice_number,
            "invoice_date": self.invoice_date.isoformat(),
            "due_date": self.due_date.isoformat(),
            "amount": round(self.amount, 2),
            "currency": self.currency,
        }


def _stable_id(inv: dict) -> object:
    return (
        inv.get("id")
        or inv.get("xero_invoice_id")
        or inv.get("statement_invoice_id")
        or inv.get("invoice_number")
    )


def _enrich(invoices: Iterable[dict], terms_days: int, terms_type: str) -> list[_Invoice]:
    out: list[_Invoice] = []
    for raw in invoices:
        number = str(raw.get("invoice_number") or raw.get("number") or "")
        invoice_date = parse_date(raw.get("invoice_date"))
        if invoice_date is None:
            raise ValueError(
                f"invoice {number or _stable_id(raw)!r} is missing a parseable invoice_date"
            )
        out.append(_Invoice(
            id=_stable_id(raw),
            invoice_number=number,
            invoice_date=invoice_date,
            due_date=calculate_due_date(invoice_date, terms_days, terms_type),
            amount=parse_amount(raw["amount"]),
            currency=raw.get("currency"),
            raw=dict(raw),
        ))
    return out


# ---- tiers -------------------------------------------------------------------

def _build_tier(
    name: str,
    invoices: list[_Invoice],
    *,
    today: date,
    window_days: int,
) -> dict:
    cutoff = today + timedelta(days=window_days)
    selected = [i for i in invoices if i.due_date <= cutoff]
    return {
        "name": name,
        "window_days": window_days,
        "cutoff_date": cutoff.isoformat(),
        "invoices": [i.to_dict() for i in selected],
        "total": round(sum(i.amount for i in selected), 2),
        "invoice_count": len(selected),
    }


def calculate_payment_tiers(
    matched_invoices: Sequence[dict],
    terms_days: int,
    terms_type: str,
    *,
    today: Optional[date] = None,
    windows: Optional[dict[str, int]] = None,
) -> dict:
    """Bucket matched invoices into strict / conservative / aggressive tiers.

    Each tier is everything due on-or-before ``today + window_days``. The
    standard windows are 0 / 7 / 30 days; override via ``windows=`` for tests
    or per-CFO policy. ``today`` defaults to ``date.today()``.
    """
    today = today or date.today()
    win = dict(DEFAULT_WINDOWS)
    if windows:
        win.update(windows)
    enriched = _enrich(matched_invoices, terms_days, terms_type)
    return {
        TIER_STRICT: _build_tier(
            TIER_STRICT, enriched, today=today, window_days=win[TIER_STRICT],
        ),
        TIER_CONSERVATIVE: _build_tier(
            TIER_CONSERVATIVE, enriched, today=today, window_days=win[TIER_CONSERVATIVE],
        ),
        TIER_AGGRESSIVE: _build_tier(
            TIER_AGGRESSIVE, enriched, today=today, window_days=win[TIER_AGGRESSIVE],
        ),
    }


# ---- adjustments -------------------------------------------------------------

def adjust_tier(
    tier: dict,
    action: str,
    value,
    *,
    source_invoices: Optional[Sequence[dict]] = None,
    terms_days: Optional[int] = None,
    terms_type: Optional[str] = None,
    today: Optional[date] = None,
) -> dict:
    """Mutate a tier in place (returning a fresh dict).

    * ``HOLD <invoice_id>`` — drop that invoice from the tier and recompute total.
    * ``EXTEND <days>``     — widen the window by ``days`` and re-pick from
      ``source_invoices`` (the original matched set).
    * ``TIGHTEN <days>``    — narrow the window by ``days`` and re-pick from
      ``source_invoices``.

    EXTEND / TIGHTEN need ``source_invoices``, ``terms_days``, ``terms_type``
    so the tier can be rebuilt against the full pool — without them the
    function would only ever be able to *shrink* a tier.
    """
    act = action.upper()
    if act == ACTION_HOLD:
        kept = [i for i in tier["invoices"] if i.get("id") != value]
        new_total = round(sum(i["amount"] for i in kept), 2)
        return {
            **tier,
            "invoices": kept,
            "total": new_total,
            "invoice_count": len(kept),
        }
    if act in (ACTION_EXTEND, ACTION_TIGHTEN):
        if source_invoices is None or terms_days is None or terms_type is None:
            raise ValueError(
                f"{act} requires source_invoices, terms_days and terms_type so the "
                "tier can be rebuilt against the full matched pool"
            )
        days = int(value)
        if days < 0:
            raise ValueError(f"{act} value must be non-negative, got {days}")
        delta = days if act == ACTION_EXTEND else -days
        new_window = max(tier["window_days"] + delta, 0)
        today = today or date.today()
        enriched = _enrich(source_invoices, terms_days, terms_type)
        return _build_tier(
            tier["name"], enriched, today=today, window_days=new_window,
        )
    raise ValueError(f"unknown action {action!r}; expected HOLD / EXTEND / TIGHTEN")


# ---- large invoice warnings --------------------------------------------------

def flag_large_invoices(
    tier_invoices: Sequence[dict],
    total: float,
    threshold: float = LARGE_INVOICE_DEFAULT_THRESHOLD,
) -> list[dict]:
    """Return one warning per invoice whose amount exceeds ``threshold * total``.

    The default 0.40 threshold mirrors the spec: any single invoice >40% of the
    tier total is large enough to warrant CFO eyes before release. If ``total``
    is zero or negative we return no warnings (nothing to compare against).
    """
    if total <= 0:
        return []
    if not (0 < threshold <= 1):
        raise ValueError(f"threshold must be in (0, 1], got {threshold}")
    cutoff = threshold * total
    warnings: list[dict] = []
    for inv in tier_invoices:
        amount = float(inv.get("amount", 0))
        if amount > cutoff:
            share = round(amount / total, 4)
            warnings.append({
                "invoice_id": inv.get("id"),
                "invoice_number": inv.get("invoice_number"),
                "amount": round(amount, 2),
                "share_of_total": share,
                "threshold": threshold,
                "message": (
                    f"Invoice {inv.get('invoice_number')!r} is "
                    f"{share:.1%} of tier total ({amount:.2f} of {total:.2f}) — "
                    f"exceeds {threshold:.0%} threshold"
                ),
            })
    return warnings


# ---- currency gate -----------------------------------------------------------

def check_currency_gate(reconciliation) -> bool:
    """True if it's safe to compute payment tiers, False if any CURRENCY_MISMATCH.

    Accepts either a full matcher payload (``{"results": [...]}``) or a bare
    list of match-rows. A single currency mismatch blocks the entire payment
    run — paying in the wrong currency turns reconciliation guesswork into a
    wire-transfer mistake.
    """
    if isinstance(reconciliation, dict):
        rows = reconciliation.get("results") or []
    else:
        rows = list(reconciliation)
    for row in rows:
        if str(row.get("match_status", "")).upper() == "CURRENCY_MISMATCH":
            return False
    return True


# ---- CLI ---------------------------------------------------------------------

def _load_input(path: Path) -> dict:
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("input JSON must be an object")
    return data


def _build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=(
            "Compute strict/conservative/aggressive payment tiers from a "
            "matched-invoice JSON file."
        )
    )
    ap.add_argument(
        "--file",
        required=True,
        help=(
            'JSON with {"matched_invoices": [...], optional '
            '"reconciliation": {...}}. Each invoice needs invoice_number, '
            "invoice_date, amount, currency."
        ),
    )
    ap.add_argument("--terms-days", type=int, required=True)
    ap.add_argument("--terms-type", choices=[TERMS_EOM, TERMS_NET], required=True)
    ap.add_argument(
        "--today",
        help="Override 'today' as YYYY-MM-DD (defaults to system date)",
    )
    ap.add_argument(
        "--threshold",
        type=float,
        default=LARGE_INVOICE_DEFAULT_THRESHOLD,
        help="Large-invoice warning threshold as a fraction (default 0.40)",
    )
    return ap


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        payload = _load_input(Path(args.file))
    except FileNotFoundError as exc:
        print(f"error: file not found: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    recon = payload.get("reconciliation")
    if recon is not None and not check_currency_gate(recon):
        json.dump(
            {"blocked": True, "reason": "CURRENCY_MISMATCH in reconciliation"},
            sys.stdout, indent=2,
        )
        sys.stdout.write("\n")
        return 3

    today = parse_date(args.today) if args.today else None
    try:
        tiers = calculate_payment_tiers(
            payload.get("matched_invoices") or [],
            terms_days=args.terms_days,
            terms_type=args.terms_type,
            today=today,
        )
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    warnings = {
        name: flag_large_invoices(t["invoices"], t["total"], threshold=args.threshold)
        for name, t in tiers.items()
    }
    json.dump(
        {"tiers": tiers, "warnings": warnings, "blocked": False},
        sys.stdout, indent=2, default=str,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = [
    "ACTION_EXTEND",
    "ACTION_HOLD",
    "ACTION_TIGHTEN",
    "DEFAULT_WINDOWS",
    "LARGE_INVOICE_DEFAULT_THRESHOLD",
    "TERMS_EOM",
    "TERMS_NET",
    "TIER_AGGRESSIVE",
    "TIER_CONSERVATIVE",
    "TIER_STRICT",
    "adjust_tier",
    "calculate_due_date",
    "calculate_payment_tiers",
    "check_currency_gate",
    "flag_large_invoices",
    "main",
]
