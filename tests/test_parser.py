"""Tests for src.parser — text + CSV fixtures, no real PDFs required."""
from __future__ import annotations

from pathlib import Path

import pytest

from src import db_ops, parser

# ---- shared fixtures ---------------------------------------------------------

FOUNDING_IP_TEXT = """\
Founding IP Ltd — Statement of Account
Statement Period: January 2026
Account No: FND-0042

Date         Invoice         Description                      Amount
2026-01-05   INV-2026-001    Trademark filing                 £1,234.56
2026-01-12   INV-2026-002    Renewal fees                     £   500.00
2026-01-20   INV-2026-003    Advisory hours                   £  2,750.00
2026-01-28   INV-2026-004    Disbursements                    £   179.44

                                              Statement Total: £4,664.00
"""

NILE_PRINT_CSV = (
    "Invoice,Date,Description,Amount,Currency\n"
    "NP-2026-101,2026-01-08,Brochures,1500.00,EGP\n"
    "NP-2026-102,2026-01-15,Business cards,250.50,EGP\n"
    "NP-2026-103,2026-01-22,Posters,3,200.00,EGP\n"  # comma in amount, quoted? handled below
)
# Use a properly-quoted version so csv module is happy.
NILE_PRINT_CSV = (
    "Invoice,Date,Description,Amount,Currency\n"
    "NP-2026-101,2026-01-08,Brochures,1500.00,EGP\n"
    "NP-2026-102,2026-01-15,Business cards,250.50,EGP\n"
    "NP-2026-103,2026-01-22,Posters,3200.00,EGP\n"
    "Statement Total,,,4950.50,EGP\n"
)


@pytest.fixture()
def founding_txt(tmp_path: Path) -> Path:
    p = tmp_path / "founding_ip_jan2026.txt"
    p.write_text(FOUNDING_IP_TEXT)
    return p


@pytest.fixture()
def nile_csv(tmp_path: Path) -> Path:
    p = tmp_path / "nile_print_jan2026.csv"
    p.write_text(NILE_PRINT_CSV)
    return p


@pytest.fixture()
def db(tmp_path: Path) -> Path:
    path = tmp_path / "steve.db"
    db_ops.init_db(path)
    return path


# ---- parse_file dispatch -----------------------------------------------------

class TestParseFile:
    def test_text_file(self, founding_txt: Path):
        parsed = parser.parse_file(founding_txt)
        assert parsed.source == "text"
        assert "Founding IP" in parsed.text
        assert parsed.tables == []

    def test_csv_file(self, nile_csv: Path):
        parsed = parser.parse_file(nile_csv)
        assert parsed.source == "csv"
        assert parsed.tables and parsed.tables[0][0][0] == "Invoice"

    def test_unknown_extension_falls_to_text(self, tmp_path: Path):
        p = tmp_path / "weird.xyz"
        p.write_text("hello world")
        parsed = parser.parse_file(p)
        assert parsed.source == "text"
        assert "hello" in parsed.text


# ---- supplier identification -------------------------------------------------

class TestIdentifySupplier:
    def test_filename_match_wins(self, db: Path):
        with db_ops.connect(db) as conn:
            aliases = parser.load_known_aliases(conn)
        out = parser.identify_supplier(
            text="generic statement content with no obvious brand",
            filename="founding_ip_jan2026.pdf",
            known_aliases=aliases,
        )
        assert out["supplier_name"] == "Founding IP"
        assert out["confidence"] >= 0.9
        assert out["method"] == "filename"

    def test_text_match_via_alias(self, db: Path):
        with db_ops.connect(db) as conn:
            aliases = parser.load_known_aliases(conn)
        out = parser.identify_supplier(
            text="Statement issued by Med Movers for January.",
            filename="statement.pdf",
            known_aliases=aliases,
        )
        assert out["supplier_name"] == "Mediterranean Movers"
        assert out["method"] == "text"
        assert 0.7 <= out["confidence"] < 0.95

    def test_unknown_returns_none(self, db: Path):
        with db_ops.connect(db) as conn:
            aliases = parser.load_known_aliases(conn)
        out = parser.identify_supplier(
            text="Some unrelated content here.",
            filename="invoice.pdf",
            known_aliases=aliases,
        )
        assert out["supplier_id"] is None
        assert out["confidence"] == 0.0
        assert out["method"] == "none"

    def test_claude_hook_is_called_only_when_deterministic_fails(self, db: Path):
        with db_ops.connect(db) as conn:
            aliases = parser.load_known_aliases(conn)

        calls: list[tuple[str, dict]] = []

        def hook(stage: str, ctx: dict):
            calls.append((stage, ctx))
            return {"supplier_id": 999, "supplier_name": "Hooked Co", "confidence": 0.8}

        # Deterministic hit -> hook not invoked.
        parser.identify_supplier(
            text="from Cairo Logistics",
            filename="x.pdf",
            known_aliases=aliases,
            claude_hook=hook,
        )
        assert calls == []

        # Deterministic miss -> hook invoked.
        out = parser.identify_supplier(
            text="opaque supplier name",
            filename="x.pdf",
            known_aliases=aliases,
            claude_hook=hook,
        )
        assert calls and calls[0][0] == "identify_supplier"
        assert out["supplier_id"] == 999
        assert out["method"] == "claude"


# ---- invoice line extraction -------------------------------------------------

class TestExtractInvoices:
    def test_text_lines(self, founding_txt: Path):
        parsed = parser.parse_file(founding_txt)
        rows = parser.extract_invoices(parsed.text)
        numbers = {r["invoice_number"] for r in rows}
        assert {"INV-2026-001", "INV-2026-002", "INV-2026-003", "INV-2026-004"} <= numbers
        first = next(r for r in rows if r["invoice_number"] == "INV-2026-001")
        assert first["amount"] == 1234.56
        assert first["currency"] == "GBP"
        assert first["invoice_date"] == "2026-01-05"
        assert first["normalized_number"] == "inv2026001"

    def test_csv_tables(self, nile_csv: Path):
        parsed = parser.parse_file(nile_csv)
        rows = parser.extract_invoices(parsed.text, parsed.tables)
        numbers = {r["invoice_number"] for r in rows}
        assert {"NP-2026-101", "NP-2026-102", "NP-2026-103"} <= numbers
        last = next(r for r in rows if r["invoice_number"] == "NP-2026-103")
        assert last["amount"] == 3200.00

    def test_duplicate_lines_are_coalesced(self):
        text = (
            "INV-001 2026-01-05 100.00\n"
            "INV-001 2026-01-05 100.00\n"   # duplicate
            "INV-002 2026-01-05 200.00\n"
        )
        rows = parser.extract_invoices(text)
        numbers = [r["invoice_number"] for r in rows]
        assert numbers.count("INV-001") == 1
        assert "INV-002" in numbers

    def test_claude_hook_invoked_when_no_rows_extracted(self):
        def hook(stage, ctx):
            assert stage == "extract_invoices"
            return {"invoices": [
                {"invoice_number": "CL-1", "amount": 42.0, "currency": "USD"}
            ]}

        rows = parser.extract_invoices("nothing parseable here", claude_hook=hook)
        assert rows and rows[0]["invoice_number"] == "CL-1"
        assert rows[0]["normalized_number"] == "cl1"


# ---- statement totals --------------------------------------------------------

class TestExtractStatementTotal:
    def test_total_with_currency_symbol(self, founding_txt: Path):
        text = founding_txt.read_text()
        out = parser.extract_statement_total(text)
        assert out["total"] == 4664.0
        assert out["currency"] == "GBP"

    def test_period_extraction(self, founding_txt: Path):
        out = parser.extract_statement_total(founding_txt.read_text())
        assert out["period"] == "January 2026"

    def test_missing_total_returns_none(self):
        out = parser.extract_statement_total("just some random text\nno total here")
        assert out == {"total": None, "currency": None, "period": None}


# ---- top-level parse_statement ----------------------------------------------

class TestParseStatement:
    def test_full_text_pipeline(self, founding_txt: Path, db: Path):
        with db_ops.connect(db) as conn:
            aliases = parser.load_known_aliases(conn)
        result = parser.parse_statement(founding_txt, known_aliases=aliases)
        assert result.supplier_name_detected == "Founding IP"
        assert result.supplier_id is not None
        assert result.invoice_count == 4
        assert result.statement_total == 4664.0
        assert result.currency == "GBP"
        assert result.statement_period == "January 2026"
        assert result.source == "text"

    def test_full_csv_pipeline(self, nile_csv: Path, db: Path):
        with db_ops.connect(db) as conn:
            aliases = parser.load_known_aliases(conn)
        result = parser.parse_statement(nile_csv, known_aliases=aliases)
        # Filename doesn't carry "nile" -> may match via cell text or be None.
        assert result.invoice_count == 3
        assert result.currency == "EGP"
        assert result.source == "csv"


# ---- excel path (only when openpyxl is installed) ----------------------------

class TestExcel:
    def test_excel_roundtrip(self, tmp_path: Path):
        openpyxl = pytest.importorskip("openpyxl")
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Invoice", "Date", "Amount", "Currency"])
        ws.append(["INV-2026-001", "2026-01-05", 100.0, "GBP"])
        ws.append(["INV-2026-002", "2026-01-12", 200.0, "GBP"])
        path = tmp_path / "founding.xlsx"
        wb.save(str(path))

        parsed = parser.parse_file(path)
        assert parsed.source == "excel"
        rows = parser.extract_invoices(parsed.text, parsed.tables)
        numbers = {r["invoice_number"] for r in rows}
        assert {"INV-2026-001", "INV-2026-002"} <= numbers
