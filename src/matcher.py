"""Deterministic invoice matching engine.

Two-pass design:
  1. Deterministic rules (no API): exact / normalized-number / fuzzy (edit dist <=2)
     / amount+date / already-paid / duplicate / currency mismatch.
  2. Optional Claude fuzzy pass — pluggable via ``fuzzy_hook`` so tests stay
     hermetic and the network dependency is opt-in.

Every input invoice appears in the output exactly once.  Outputs are dict rows
shaped for :func:`db_ops.create_reconciliation`.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, Optional, Sequence

from .normalizer import (
    amounts_match,
    dates_within,
    edit_distance,
    find_duplicates,
    normalize_invoice_number,
    parse_amount,
    parse_date,
)

# ---- statuses (mirror schema) ------------------------------------------------
MATCHED = "MATCHED"
AMOUNT_MISMATCH = "AMOUNT_MISMATCH"
CURRENCY_MISMATCH = "CURRENCY_MISMATCH"
ALREADY_PAID = "ALREADY_PAID"
MISSING_FROM_XERO = "MISSING_FROM_XERO"
MISSING_FROM_STATEMENT = "MISSING_FROM_STATEMENT"
AMBIGUOUS = "AMBIGUOUS"

# ---- methods -----------------------------------------------------------------
METHOD_EXACT = "exact_number"
METHOD_NORMALIZED = "normalized_number"
METHOD_FUZZY = "fuzzy_number"
METHOD_AMOUNT_DATE = "amount_date"
METHOD_CLAUDE = "claude_fuzzy"
METHOD_NONE = "none"

# ---- confidence floors -------------------------------------------------------
CONF_EXACT = 0.99
CONF_NORMALIZED = 0.95
CONF_FUZZY = 0.90
CONF_AMOUNT_DATE = 0.75
HUMAN_REVIEW_FLOOR = 0.75

FuzzyHook = Callable[[list[dict], list[dict]], list[dict]]


@dataclass
class _Side:
    """Internal staging record so matching can mutate state without touching inputs."""
    row_id: Optional[int]
    invoice_number: str
    normalized: str
    amount: float
    currency: Optional[str]
    invoice_date: object  # datetime.date or None
    status: str  # for xero side; statement side fills "STATEMENT"
    paid_amount: float = 0.0
    matched: bool = False
    flagged_status: Optional[str] = None  # forces this status (e.g. AMBIGUOUS)


def _stage(invoice: dict, *, default_status: str) -> _Side:
    number = invoice.get("invoice_number") or invoice.get("number") or ""
    normalized = invoice.get("normalized_number") or normalize_invoice_number(number)
    return _Side(
        row_id=invoice.get("id") or invoice.get("statement_invoice_id") or invoice.get("xero_invoice_id"),
        invoice_number=str(number),
        normalized=normalized,
        amount=parse_amount(invoice["amount"]),
        currency=(invoice.get("currency") or None),
        invoice_date=parse_date(invoice.get("invoice_date")),
        status=str(invoice.get("status", default_status)).upper(),
        paid_amount=float(invoice.get("paid_amount", 0) or 0),
    )


def _match_row(
    *,
    statement: Optional[_Side],
    xero: Optional[_Side],
    status: str,
    method: str,
    confidence: float,
    reasoning: str,
) -> dict:
    amount_diff = 0.0
    if statement and xero:
        amount_diff = round(statement.amount - xero.amount, 2)
    elif statement:
        amount_diff = round(statement.amount, 2)
    elif xero:
        amount_diff = round(-xero.amount, 2)
    return {
        "statement_invoice_id": statement.row_id if statement else None,
        "xero_invoice_id": xero.row_id if xero else None,
        "match_status": status,
        "match_method": method,
        "confidence": round(confidence, 4),
        "amount_difference": amount_diff,
        "reasoning": reasoning,
    }


def _resolve_matched_status(s: _Side, x: _Side) -> tuple[str, float, str]:
    """Given two paired invoices, pick the final status/confidence/reason."""
    if s.currency and x.currency and s.currency.upper() != x.currency.upper():
        return CURRENCY_MISMATCH, 0.5, f"Currency mismatch: {s.currency} vs {x.currency}"
    if x.status == "PAID":
        return ALREADY_PAID, 0.95, "Xero invoice already marked PAID"
    if not amounts_match(s.amount, x.amount):
        diff = round(s.amount - x.amount, 2)
        return AMOUNT_MISMATCH, 0.7, f"Amounts differ by {diff}"
    return MATCHED, CONF_EXACT, "Exact amount + invoice-number match"


def _pass1_exact(
    statements: list[_Side],
    xeros: list[_Side],
) -> list[dict]:
    results: list[dict] = []
    # Build lookup by normalized number on xero side (skipping flagged duplicates).
    xero_by_norm: dict[str, list[_Side]] = {}
    for x in xeros:
        if x.matched or x.flagged_status:
            continue
        xero_by_norm.setdefault(x.normalized, []).append(x)

    for s in statements:
        if s.matched or s.flagged_status:
            continue
        if not s.normalized:
            continue
        candidates = xero_by_norm.get(s.normalized, [])
        if len(candidates) != 1:
            continue
        x = candidates[0]
        if x.matched:
            continue
        status, conf, reason = _resolve_matched_status(s, x)
        method = METHOD_EXACT if s.invoice_number == x.invoice_number else METHOD_NORMALIZED
        results.append(_match_row(
            statement=s, xero=x,
            status=status, method=method,
            confidence=conf, reasoning=reason,
        ))
        s.matched = True
        x.matched = True
        xero_by_norm[s.normalized] = []
    return results


def _pass2_fuzzy(
    statements: list[_Side],
    xeros: list[_Side],
) -> list[dict]:
    results: list[dict] = []
    remaining_x = [x for x in xeros if not x.matched and not x.flagged_status]
    for s in statements:
        if s.matched or s.flagged_status:
            continue
        best: Optional[tuple[int, _Side]] = None
        for x in remaining_x:
            if x.matched:
                continue
            if not s.normalized or not x.normalized:
                continue
            d = edit_distance(s.normalized, x.normalized, max_distance=2)
            if d > 2:
                continue
            if best is None or d < best[0]:
                best = (d, x)
        if best is None:
            continue
        d, x = best
        status, _, reason_match = _resolve_matched_status(s, x)
        # Fuzzy match floor is 0.90 even when amounts match.
        confidence = CONF_FUZZY if d <= 2 else CONF_NORMALIZED
        reasoning = f"Fuzzy number match (edit distance {d}); {reason_match}"
        results.append(_match_row(
            statement=s, xero=x,
            status=status, method=METHOD_FUZZY,
            confidence=confidence, reasoning=reasoning,
        ))
        s.matched = True
        x.matched = True
    return results


def _pass3_amount_date(
    statements: list[_Side],
    xeros: list[_Side],
    *,
    date_window_days: int = 5,
) -> list[dict]:
    results: list[dict] = []
    for s in statements:
        if s.matched or s.flagged_status:
            continue
        for x in xeros:
            if x.matched or x.flagged_status:
                continue
            if not amounts_match(s.amount, x.amount):
                continue
            if not dates_within(s.invoice_date, x.invoice_date, days=date_window_days):
                continue
            status, _, _ = _resolve_matched_status(s, x)
            reasoning = (
                f"Amount + date match (within {date_window_days} days); "
                f"numbers '{s.invoice_number}' vs '{x.invoice_number}'"
            )
            results.append(_match_row(
                statement=s, xero=x,
                status=status, method=METHOD_AMOUNT_DATE,
                confidence=CONF_AMOUNT_DATE, reasoning=reasoning,
            ))
            s.matched = True
            x.matched = True
            break
    return results


def _flag_duplicates(items: list[_Side]) -> None:
    dupes = find_duplicates(i.normalized for i in items)
    if not dupes:
        return
    for i in items:
        if i.normalized in dupes:
            i.flagged_status = AMBIGUOUS


def _emit_unmatched(
    statements: list[_Side],
    xeros: list[_Side],
) -> list[dict]:
    out: list[dict] = []
    for s in statements:
        if s.matched:
            continue
        if s.flagged_status == AMBIGUOUS:
            out.append(_match_row(
                statement=s, xero=None,
                status=AMBIGUOUS, method=METHOD_NONE,
                confidence=0.0,
                reasoning=f"Duplicate normalized invoice number '{s.normalized}' on statement side",
            ))
        else:
            out.append(_match_row(
                statement=s, xero=None,
                status=MISSING_FROM_XERO, method=METHOD_NONE,
                confidence=0.0,
                reasoning="No matching Xero invoice found",
            ))
    for x in xeros:
        if x.matched:
            continue
        if x.status == "PAID":
            out.append(_match_row(
                statement=None, xero=x,
                status=ALREADY_PAID, method=METHOD_NONE,
                confidence=0.9,
                reasoning="Xero invoice already paid and not on statement",
            ))
        elif x.flagged_status == AMBIGUOUS:
            out.append(_match_row(
                statement=None, xero=x,
                status=AMBIGUOUS, method=METHOD_NONE,
                confidence=0.0,
                reasoning=f"Duplicate normalized invoice number '{x.normalized}' on Xero side",
            ))
        else:
            out.append(_match_row(
                statement=None, xero=x,
                status=MISSING_FROM_STATEMENT, method=METHOD_NONE,
                confidence=0.0,
                reasoning="Xero invoice not present on statement",
            ))
    return out


def _balance_summary(
    statements: list[_Side],
    xeros: list[_Side],
    results: list[dict],
    *,
    statement_total: Optional[float],
) -> dict:
    sum_statement = round(sum(s.amount for s in statements), 2)
    sum_xero_unpaid = round(
        sum(x.amount - x.paid_amount for x in xeros if x.status != "PAID"),
        2,
    )
    matched_rows = [r for r in results if r["match_status"] == MATCHED]
    sum_matched = round(sum(
        next((s.amount for s in statements if s.row_id == r["statement_invoice_id"]), 0.0)
        for r in matched_rows
    ), 2)
    unexplained = round(sum_statement - sum_matched - sum(
        abs(r["amount_difference"]) for r in results
        if r["match_status"] in (AMOUNT_MISMATCH, MISSING_FROM_XERO)
    ), 2)
    declared = round(statement_total, 2) if statement_total is not None else sum_statement
    declared_variance = round(declared - sum_statement, 2)
    return {
        "statement_declared_total": declared,
        "statement_sum": sum_statement,
        "xero_unpaid_sum": sum_xero_unpaid,
        "matched_sum": sum_matched,
        "declared_vs_sum_variance": declared_variance,
        "unexplained_variance": unexplained,
    }


def _overall_confidence(results: list[dict]) -> str:
    discrepancies = [r for r in results if r["match_status"] != MATCHED]
    has_currency = any(r["match_status"] == CURRENCY_MISMATCH for r in results)
    if has_currency:
        return "LOW"
    n = len(discrepancies)
    if n <= 2:
        return "HIGH"
    if n <= 5:
        return "MEDIUM"
    return "LOW"


def match_invoices(
    statement_invoices: Iterable[dict],
    xero_invoices: Iterable[dict],
    *,
    statement_total: Optional[float] = None,
    fuzzy_hook: Optional[FuzzyHook] = None,
    date_window_days: int = 5,
) -> dict:
    """Run deterministic + (optional) fuzzy matching.

    Returns ``{"results": [...], "balance": {...}, "overall_confidence": "HIGH|MEDIUM|LOW",
    "needs_review": [...]}``. ``results`` contains exactly one row per input
    invoice on each side (paired matches contain both ids).
    """
    statements = [_stage(i, default_status="STATEMENT") for i in statement_invoices]
    xeros = [_stage(i, default_status="AUTHORISED") for i in xero_invoices]

    _flag_duplicates(statements)
    _flag_duplicates(xeros)

    results: list[dict] = []
    results.extend(_pass1_exact(statements, xeros))
    results.extend(_pass2_fuzzy(statements, xeros))
    results.extend(_pass3_amount_date(statements, xeros, date_window_days=date_window_days))

    if fuzzy_hook is not None:
        leftover_s = [_side_to_dict(s) for s in statements if not s.matched and not s.flagged_status]
        leftover_x = [_side_to_dict(x) for x in xeros if not x.matched and not x.flagged_status]
        if leftover_s and leftover_x:
            extra = fuzzy_hook(leftover_s, leftover_x)
            for row in extra:
                validated = _validate_hook_row(row, statements, xeros)
                if validated is None:
                    continue
                results.append(validated)

    results.extend(_emit_unmatched(statements, xeros))
    balance = _balance_summary(statements, xeros, results, statement_total=statement_total)
    overall = _overall_confidence(results)
    needs_review = [
        r for r in results
        if r["match_status"] != MATCHED or r["confidence"] < HUMAN_REVIEW_FLOOR
    ]
    return {
        "results": results,
        "balance": balance,
        "overall_confidence": overall,
        "needs_review": needs_review,
    }


def _side_to_dict(side: _Side) -> dict:
    return {
        "id": side.row_id,
        "invoice_number": side.invoice_number,
        "normalized_number": side.normalized,
        "amount": side.amount,
        "currency": side.currency,
        "invoice_date": side.invoice_date.isoformat() if side.invoice_date else None,
        "status": side.status,
    }


def _validate_hook_row(row: dict, statements: list[_Side], xeros: list[_Side]) -> Optional[dict]:
    """Programmatic guard for Claude-returned matches: no duplicates, sane shape."""
    s_id = row.get("statement_invoice_id")
    x_id = row.get("xero_invoice_id")
    s = next((s for s in statements if s.row_id == s_id), None)
    x = next((x for x in xeros if x.row_id == x_id), None)
    if s is None or x is None:
        return None
    if s.matched or x.matched:
        return None  # hook tried to double-book; drop silently
    confidence = float(row.get("confidence", 0.0))
    if confidence < HUMAN_REVIEW_FLOOR:
        return None
    status, _, reason = _resolve_matched_status(s, x)
    s.matched = True
    x.matched = True
    return _match_row(
        statement=s, xero=x,
        status=status, method=METHOD_CLAUDE,
        confidence=confidence,
        reasoning=row.get("reasoning") or reason,
    )


__all__ = [
    "ALREADY_PAID",
    "AMBIGUOUS",
    "AMOUNT_MISMATCH",
    "CURRENCY_MISMATCH",
    "MATCHED",
    "METHOD_AMOUNT_DATE",
    "METHOD_CLAUDE",
    "METHOD_EXACT",
    "METHOD_FUZZY",
    "METHOD_NONE",
    "METHOD_NORMALIZED",
    "MISSING_FROM_STATEMENT",
    "MISSING_FROM_XERO",
    "match_invoices",
]
