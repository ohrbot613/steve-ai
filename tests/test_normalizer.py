from datetime import date

import pytest

from src.normalizer import (
    amounts_match,
    dates_within,
    edit_distance,
    find_duplicates,
    normalize_invoice_number,
    normalize_supplier_name,
    parse_amount,
    parse_date,
)


class TestNormalizeInvoiceNumber:
    def test_strips_separators_and_lowercases(self):
        assert normalize_invoice_number("INV-2026-001") == "inv2026001"
        assert normalize_invoice_number("inv 2026 001") == "inv2026001"
        assert normalize_invoice_number("2026/001") == "2026001"
        assert normalize_invoice_number("#INV.2026.001") == "inv2026001"

    def test_handles_empty_and_none(self):
        assert normalize_invoice_number(None) == ""
        assert normalize_invoice_number("") == ""
        assert normalize_invoice_number("   ") == ""

    def test_strips_accents(self):
        assert normalize_invoice_number("FACTÚRA-9") == "factura9"


class TestNormalizeSupplierName:
    def test_basic(self):
        assert normalize_supplier_name("  Cairo  Logistics  ") == "cairo logistics"
        assert normalize_supplier_name("Founding I.P.") == "founding i.p."
        assert normalize_supplier_name(None) == ""


class TestParseAmount:
    def test_numeric_passthrough(self):
        assert parse_amount(1234.56) == 1234.56
        assert parse_amount(42) == 42.0

    def test_commas_and_currency(self):
        assert parse_amount("$1,234.56") == 1234.56
        assert parse_amount("EGP 12,345.00") == 12345.0

    def test_parens_means_negative(self):
        assert parse_amount("(123.45)") == -123.45

    def test_invalid(self):
        with pytest.raises(ValueError):
            parse_amount("")
        with pytest.raises(ValueError):
            parse_amount("abc")


class TestParseDate:
    def test_iso(self):
        assert parse_date("2026-05-25") == date(2026, 5, 25)

    def test_uk(self):
        assert parse_date("25/05/2026") == date(2026, 5, 25)

    def test_text_month(self):
        assert parse_date("25 May 2026") == date(2026, 5, 25)
        assert parse_date("May 25, 2026") == date(2026, 5, 25)

    def test_iso_with_time(self):
        assert parse_date("2026-05-25T10:00:00") == date(2026, 5, 25)

    def test_invalid_returns_none(self):
        assert parse_date("not-a-date") is None
        assert parse_date(None) is None
        assert parse_date("") is None

    def test_passthrough_date_object(self):
        d = date(2026, 5, 25)
        assert parse_date(d) is d


class TestEditDistance:
    def test_identical(self):
        assert edit_distance("inv2026001", "inv2026001") == 0

    def test_single_edit(self):
        assert edit_distance("inv2026001", "inv2026002") == 1

    def test_two_edits(self):
        assert edit_distance("inv2026001", "inv2026020") == 2

    def test_max_distance_cutoff(self):
        # Should early-exit and return cutoff+1 when distance exceeds limit.
        assert edit_distance("abc", "xyz123", max_distance=2) == 3

    def test_empty(self):
        assert edit_distance("", "abc") == 3
        assert edit_distance("abc", "") == 3


class TestAmountsMatch:
    def test_exact(self):
        assert amounts_match(100.00, 100.00)

    def test_within_cent(self):
        assert amounts_match(100.00, 100.009)

    def test_outside_cent(self):
        assert not amounts_match(100.00, 100.02)


class TestDatesWithin:
    def test_within_window(self):
        assert dates_within(date(2026, 5, 25), date(2026, 5, 28), days=5)

    def test_outside_window(self):
        assert not dates_within(date(2026, 5, 25), date(2026, 6, 5), days=5)

    def test_none(self):
        assert not dates_within(None, date(2026, 5, 25))
        assert not dates_within(date(2026, 5, 25), None)


class TestFindDuplicates:
    def test_basic(self):
        assert find_duplicates(["a", "b", "a", "c", "b"]) == {"a", "b"}

    def test_ignores_empty(self):
        assert find_duplicates(["", "", "a"]) == set()
