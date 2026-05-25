"""Normalization helpers for invoice numbers, amounts, dates, and supplier names.

Pure stdlib. No I/O, no database access.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from typing import Iterable, Optional

_WHITESPACE_RE = re.compile(r"\s+")
_INVOICE_SEP_RE = re.compile(r"[\s\-_/.#:]+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]")
_AMOUNT_CLEAN_RE = re.compile(r"[^0-9.\-]")
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%m/%d/%Y",
    "%d %b %Y",
    "%d %B %Y",
    "%b %d, %Y",
    "%B %d, %Y",
)


def _strip_accents(value: str) -> str:
    nfkd = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def normalize_invoice_number(raw: Optional[str]) -> str:
    """Collapse a free-form invoice number to a comparable key.

    Examples:
        "INV-2026-001" -> "inv2026001"
        " inv 2026 001 " -> "inv2026001"
        "2026/001" -> "2026001"
    """
    if not raw:
        return ""
    value = _strip_accents(str(raw)).lower().strip()
    value = _INVOICE_SEP_RE.sub("", value)
    return _NON_ALNUM_RE.sub("", value)


def normalize_supplier_name(raw: Optional[str]) -> str:
    """Lowercased, accent-stripped, whitespace-collapsed supplier name."""
    if not raw:
        return ""
    value = _strip_accents(str(raw)).lower().strip()
    value = _WHITESPACE_RE.sub(" ", value)
    return value


def parse_amount(raw) -> float:
    """Parse a monetary amount; accepts numbers, "1,234.56", "(123.45)", "$1.23"."""
    if raw is None or raw == "":
        raise ValueError("amount is empty")
    if isinstance(raw, (int, float)):
        return float(raw)
    text = str(raw).strip()
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1]
    text = _AMOUNT_CLEAN_RE.sub("", text)
    if text in ("", "-", "."):
        raise ValueError(f"unparseable amount: {raw!r}")
    value = float(text)
    return -value if negative else value


def parse_date(raw) -> Optional[date]:
    """Parse a date in any of the common formats; return None on failure."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, datetime):
        return raw.date()
    text = str(raw).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    # ISO 8601 with time component, e.g. "2026-05-25T10:00:00".
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def edit_distance(a: str, b: str, *, max_distance: Optional[int] = None) -> int:
    """Levenshtein distance with an optional early-exit cutoff."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    if max_distance is not None and abs(len(a) - len(b)) > max_distance:
        return max_distance + 1

    # Single-row DP for memory efficiency.
    previous = list(range(len(b) + 1))
    for i, ch_a in enumerate(a, start=1):
        current = [i] + [0] * len(b)
        row_min = current[0]
        for j, ch_b in enumerate(b, start=1):
            cost = 0 if ch_a == ch_b else 1
            current[j] = min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + cost,
            )
            if current[j] < row_min:
                row_min = current[j]
        if max_distance is not None and row_min > max_distance:
            return max_distance + 1
        previous = current
    return previous[-1]


def amounts_match(a: float, b: float, *, tolerance: float = 0.01) -> bool:
    """Compare two amounts with an absolute tolerance (default 1 cent)."""
    return abs(a - b) <= tolerance


def dates_within(a: Optional[date], b: Optional[date], *, days: int = 5) -> bool:
    """True if both dates are present and within ``days`` of each other."""
    if a is None or b is None:
        return False
    return abs((a - b).days) <= days


def find_duplicates(values: Iterable[str]) -> set:
    """Return the set of values that appear more than once (empty string ignored)."""
    seen: dict[str, int] = {}
    for v in values:
        if not v:
            continue
        seen[v] = seen.get(v, 0) + 1
    return {v for v, count in seen.items() if count > 1}


__all__ = [
    "amounts_match",
    "dates_within",
    "edit_distance",
    "find_duplicates",
    "normalize_invoice_number",
    "normalize_supplier_name",
    "parse_amount",
    "parse_date",
]
