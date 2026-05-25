"""Tests for src/payment.py — payment-tier calculator.

Maps directly to the acceptance criteria in issue #28:
  * 90-day EOM Jan 15 -> Apr 30
  * 60-day net Jan 15 -> Mar 16
  * Three tiers produce correct invoice lists and totals
  * HOLD removes invoice and recalculates
  * EXTEND / TIGHTEN adjust window correctly
  * Large invoice warning triggers at >40%
  * Currency mismatch blocks calculation entirely
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

from src import payment


# ---- helpers ----------------------------------------------------------------

def _inv(id_, number, amount, invoice_date, *, currency="USD"):
    return {
        "id": id_,
        "invoice_number": number,
        "amount": amount,
        "invoice_date": invoice_date,
        "currency": currency,
    }


# ---- calculate_due_date -----------------------------------------------------

class TestCalculateDueDate:
    def test_90_day_eom_jan_15_returns_apr_30(self):
        # End of Jan = Jan 31; +90 days = Apr 30 (Feb 2026 has 28 days).
        assert payment.calculate_due_date("2026-01-15", 90, "eom") == date(2026, 4, 30)

    def test_60_day_net_jan_15_returns_mar_16(self):
        # Jan 15 + 60 days = Mar 16 (Feb 2026 has 28 days: 16+28+16=60).
        assert payment.calculate_due_date("2026-01-15", 60, "net") == date(2026, 3, 16)

    def test_eom_handles_month_with_30_days(self):
        # Apr 10 + 30 = May 10; end of May = May 31.
        assert payment.calculate_due_date("2026-04-10", 30, "eom") == date(2026, 5, 31)

    def test_eom_rolls_into_next_month(self):
        # Jan 20 + 15 = Feb 4; end of Feb 2026 = Feb 28.
        assert payment.calculate_due_date("2026-01-20", 15, "eom") == date(2026, 2, 28)

    def test_net_zero_days(self):
        assert payment.calculate_due_date("2026-01-15", 0, "net") == date(2026, 1, 15)

    def test_accepts_date_object(self):
        assert payment.calculate_due_date(date(2026, 1, 15), 60, "net") == date(2026, 3, 16)

    def test_case_insensitive_terms_type(self):
        assert payment.calculate_due_date("2026-01-15", 60, "NET") == date(2026, 3, 16)
        assert payment.calculate_due_date("2026-01-15", 90, "EOM") == date(2026, 4, 30)

    def test_invalid_terms_type_raises(self):
        with pytest.raises(ValueError, match="terms_type"):
            payment.calculate_due_date("2026-01-15", 30, "weekly")

    def test_invalid_date_raises(self):
        with pytest.raises(ValueError, match="invoice_date"):
            payment.calculate_due_date("not-a-date", 30, "net")

    def test_negative_terms_days_raises(self):
        with pytest.raises(ValueError, match="terms_days"):
            payment.calculate_due_date("2026-01-15", -5, "net")


# ---- calculate_payment_tiers ------------------------------------------------

class TestCalculatePaymentTiers:
    """All tests pin ``today`` so they don't depend on the system clock."""

    def test_three_tiers_with_increasing_invoice_counts(self):
        # today = May 1. With net-30:
        #   A due Apr 15 (overdue)     -> in strict, conservative, aggressive
        #   B due May 5 (within 7d)    -> in conservative, aggressive
        #   C due May 25 (within 30d)  -> in aggressive only
        #   D due Jun 10 (beyond 30d)  -> in none
        matched = [
            _inv(1, "A", 100.0, "2026-03-16"),  # net30 -> Apr 15
            _inv(2, "B", 200.0, "2026-04-05"),  # net30 -> May 5
            _inv(3, "C", 300.0, "2026-04-25"),  # net30 -> May 25
            _inv(4, "D", 400.0, "2026-05-11"),  # net30 -> Jun 10
        ]
        tiers = payment.calculate_payment_tiers(
            matched, terms_days=30, terms_type="net", today=date(2026, 5, 1),
        )
        assert [i["invoice_number"] for i in tiers["strict"]["invoices"]] == ["A"]
        assert [i["invoice_number"] for i in tiers["conservative"]["invoices"]] == ["A", "B"]
        assert [i["invoice_number"] for i in tiers["aggressive"]["invoices"]] == ["A", "B", "C"]

    def test_three_tier_totals_are_correct(self):
        matched = [
            _inv(1, "A", 100.0, "2026-03-16"),
            _inv(2, "B", 200.0, "2026-04-05"),
            _inv(3, "C", 300.0, "2026-04-25"),
            _inv(4, "D", 400.0, "2026-05-11"),
        ]
        tiers = payment.calculate_payment_tiers(
            matched, terms_days=30, terms_type="net", today=date(2026, 5, 1),
        )
        assert tiers["strict"]["total"] == 100.0
        assert tiers["conservative"]["total"] == 300.0
        assert tiers["aggressive"]["total"] == 600.0
        assert tiers["aggressive"]["invoice_count"] == 3

    def test_cutoff_dates_match_window(self):
        tiers = payment.calculate_payment_tiers(
            [], terms_days=30, terms_type="net", today=date(2026, 5, 1),
        )
        assert tiers["strict"]["cutoff_date"] == "2026-05-01"
        assert tiers["conservative"]["cutoff_date"] == "2026-05-08"
        assert tiers["aggressive"]["cutoff_date"] == "2026-05-31"

    def test_eom_terms_apply_to_every_invoice(self):
        # Jan 15 + 90-day EOM -> Apr 30. With today=Apr 30 it lands in strict.
        matched = [_inv(1, "A", 500.0, "2026-01-15")]
        tiers = payment.calculate_payment_tiers(
            matched, terms_days=90, terms_type="eom", today=date(2026, 4, 30),
        )
        assert tiers["strict"]["invoice_count"] == 1
        assert tiers["strict"]["invoices"][0]["due_date"] == "2026-04-30"

    def test_window_overrides_apply(self):
        matched = [_inv(1, "A", 100.0, "2026-03-16")]  # due Apr 15
        tiers = payment.calculate_payment_tiers(
            matched, terms_days=30, terms_type="net",
            today=date(2026, 5, 1),
            windows={"strict": 0, "conservative": 3, "aggressive": 10},
        )
        # Cutoff for aggressive becomes May 11 — A (due Apr 15) is included.
        assert tiers["aggressive"]["invoice_count"] == 1
        assert tiers["aggressive"]["cutoff_date"] == "2026-05-11"

    def test_empty_input_returns_empty_tiers(self):
        tiers = payment.calculate_payment_tiers(
            [], terms_days=30, terms_type="net", today=date(2026, 5, 1),
        )
        for name in ("strict", "conservative", "aggressive"):
            assert tiers[name]["invoices"] == []
            assert tiers[name]["total"] == 0.0
            assert tiers[name]["invoice_count"] == 0

    def test_missing_invoice_date_raises(self):
        with pytest.raises(ValueError, match="invoice_date"):
            payment.calculate_payment_tiers(
                [{"id": 1, "invoice_number": "X", "amount": 100.0}],
                terms_days=30, terms_type="net", today=date(2026, 5, 1),
            )


# ---- adjust_tier ------------------------------------------------------------

class TestAdjustTier:
    @pytest.fixture()
    def matched(self):
        return [
            _inv(1, "A", 100.0, "2026-03-16"),  # net30 -> Apr 15 (overdue on May 1)
            _inv(2, "B", 200.0, "2026-04-05"),  # net30 -> May 5
            _inv(3, "C", 300.0, "2026-04-25"),  # net30 -> May 25
        ]

    @pytest.fixture()
    def tiers(self, matched):
        return payment.calculate_payment_tiers(
            matched, terms_days=30, terms_type="net", today=date(2026, 5, 1),
        )

    def test_hold_removes_invoice_and_recalculates_total(self, tiers):
        before = tiers["aggressive"]
        assert before["invoice_count"] == 3
        assert before["total"] == 600.0

        after = payment.adjust_tier(before, "HOLD", 2)  # remove invoice id=2 (B)
        assert [i["invoice_number"] for i in after["invoices"]] == ["A", "C"]
        assert after["total"] == 400.0
        assert after["invoice_count"] == 2

    def test_hold_unknown_invoice_is_noop(self, tiers):
        before = tiers["aggressive"]
        after = payment.adjust_tier(before, "HOLD", 9999)
        assert after["invoice_count"] == before["invoice_count"]
        assert after["total"] == before["total"]

    def test_extend_widens_window_and_adds_invoices(self, matched, tiers):
        # conservative (window=7, cutoff May 8) has [A, B]; extend by 30 -> cutoff Jun 7
        # which now includes C (due May 25).
        before = tiers["conservative"]
        assert before["invoice_count"] == 2

        after = payment.adjust_tier(
            before, "EXTEND", 30,
            source_invoices=matched,
            terms_days=30, terms_type="net",
            today=date(2026, 5, 1),
        )
        assert after["window_days"] == 37
        assert after["cutoff_date"] == "2026-06-07"
        assert [i["invoice_number"] for i in after["invoices"]] == ["A", "B", "C"]
        assert after["total"] == 600.0

    def test_tighten_narrows_window_and_drops_invoices(self, matched, tiers):
        # aggressive (window=30, cutoff May 31) has [A, B, C]; tighten by 25
        # -> window=5, cutoff May 6 -> drops C, keeps A and B.
        before = tiers["aggressive"]
        assert before["invoice_count"] == 3

        after = payment.adjust_tier(
            before, "TIGHTEN", 25,
            source_invoices=matched,
            terms_days=30, terms_type="net",
            today=date(2026, 5, 1),
        )
        assert after["window_days"] == 5
        assert after["cutoff_date"] == "2026-05-06"
        assert [i["invoice_number"] for i in after["invoices"]] == ["A", "B"]
        assert after["total"] == 300.0

    def test_tighten_below_zero_clamps_to_zero(self, matched, tiers):
        before = tiers["conservative"]  # window=7
        after = payment.adjust_tier(
            before, "TIGHTEN", 100,
            source_invoices=matched,
            terms_days=30, terms_type="net",
            today=date(2026, 5, 1),
        )
        assert after["window_days"] == 0
        # Only the overdue invoice (A) remains.
        assert [i["invoice_number"] for i in after["invoices"]] == ["A"]

    def test_extend_without_source_raises(self, tiers):
        with pytest.raises(ValueError, match="source_invoices"):
            payment.adjust_tier(tiers["strict"], "EXTEND", 5)

    def test_unknown_action_raises(self, tiers):
        with pytest.raises(ValueError, match="unknown action"):
            payment.adjust_tier(tiers["strict"], "SHRUG", 1)


# ---- flag_large_invoices ----------------------------------------------------

class TestFlagLargeInvoices:
    def test_flags_invoice_over_40_percent_threshold(self):
        # 500 of 1000 total = 50% > 40% -> flagged.
        invoices = [
            {"id": 1, "invoice_number": "BIG", "amount": 500.0},
            {"id": 2, "invoice_number": "MED", "amount": 300.0},
            {"id": 3, "invoice_number": "SMALL", "amount": 200.0},
        ]
        warnings = payment.flag_large_invoices(invoices, total=1000.0)
        assert len(warnings) == 1
        assert warnings[0]["invoice_number"] == "BIG"
        assert warnings[0]["share_of_total"] == 0.5
        assert warnings[0]["threshold"] == 0.40

    def test_does_not_flag_invoice_at_exactly_40_percent(self):
        # Spec says ">40%", not ">=". With three 400s (40% each, 1200 total)
        # none should flag.
        invoices = [
            {"id": 1, "invoice_number": "A", "amount": 400.0},
            {"id": 2, "invoice_number": "B", "amount": 400.0},
            {"id": 3, "invoice_number": "C", "amount": 400.0},
        ]
        warnings = payment.flag_large_invoices(invoices, total=1200.0)
        assert warnings == []

    def test_flags_invoice_just_over_40_percent_boundary(self):
        # 401 / 1000 = 40.1% > 40% -> flagged; 400 / 1000 = 40% -> not.
        invoices = [
            {"id": 1, "invoice_number": "OVER", "amount": 401.0},
            {"id": 2, "invoice_number": "EDGE", "amount": 400.0},
            {"id": 3, "invoice_number": "REST", "amount": 199.0},
        ]
        warnings = payment.flag_large_invoices(invoices, total=1000.0)
        assert [w["invoice_number"] for w in warnings] == ["OVER"]

    def test_flags_multiple_invoices(self):
        invoices = [
            {"id": 1, "invoice_number": "BIG1", "amount": 450.0},
            {"id": 2, "invoice_number": "BIG2", "amount": 410.0},
            {"id": 3, "invoice_number": "SMALL", "amount": 140.0},
        ]
        warnings = payment.flag_large_invoices(invoices, total=1000.0)
        assert {w["invoice_number"] for w in warnings} == {"BIG1", "BIG2"}

    def test_custom_threshold(self):
        invoices = [
            {"id": 1, "invoice_number": "QUARTER", "amount": 260.0},
            {"id": 2, "invoice_number": "REST", "amount": 740.0},
        ]
        # At 0.40 only REST flags; at 0.25 both flag.
        assert {w["invoice_number"] for w in payment.flag_large_invoices(
            invoices, 1000.0, threshold=0.25,
        )} == {"QUARTER", "REST"}

    def test_zero_total_returns_no_warnings(self):
        assert payment.flag_large_invoices(
            [{"id": 1, "invoice_number": "A", "amount": 100.0}],
            total=0.0,
        ) == []

    def test_invalid_threshold_raises(self):
        with pytest.raises(ValueError, match="threshold"):
            payment.flag_large_invoices([{"id": 1, "amount": 1}], total=10.0, threshold=1.5)


# ---- check_currency_gate ----------------------------------------------------

class TestCheckCurrencyGate:
    def test_returns_true_when_no_currency_mismatch(self):
        recon = {"results": [
            {"match_status": "MATCHED"},
            {"match_status": "AMOUNT_MISMATCH"},
            {"match_status": "MISSING_FROM_XERO"},
        ]}
        assert payment.check_currency_gate(recon) is True

    def test_returns_false_on_any_currency_mismatch(self):
        recon = {"results": [
            {"match_status": "MATCHED"},
            {"match_status": "CURRENCY_MISMATCH"},
            {"match_status": "MATCHED"},
        ]}
        assert payment.check_currency_gate(recon) is False

    def test_accepts_bare_list(self):
        assert payment.check_currency_gate([{"match_status": "MATCHED"}]) is True
        assert payment.check_currency_gate([{"match_status": "CURRENCY_MISMATCH"}]) is False

    def test_empty_reconciliation_is_safe(self):
        assert payment.check_currency_gate({"results": []}) is True
        assert payment.check_currency_gate([]) is True

    def test_status_is_case_insensitive(self):
        assert payment.check_currency_gate([{"match_status": "currency_mismatch"}]) is False


# ---- end-to-end: matcher output -> payment tiers ----------------------------

class TestIntegration:
    def test_currency_mismatch_in_recon_blocks_payment(self):
        """The two pieces compose: gate first, then tier-calc."""
        from src import matcher

        recon = matcher.match_invoices(
            [{"id": 1, "invoice_number": "X", "amount": 100.0, "currency": "USD"}],
            [{"id": 11, "invoice_number": "X", "amount": 100.0, "currency": "EUR",
              "status": "AUTHORISED", "paid_amount": 0}],
        )
        assert payment.check_currency_gate(recon) is False

    def test_warnings_chain_off_calculated_tiers(self):
        matched = [
            _inv(1, "WHALE", 600.0, "2026-04-05"),  # 60% of conservative total
            _inv(2, "MID", 200.0, "2026-04-05"),
            _inv(3, "SMALL", 200.0, "2026-04-05"),
        ]
        tiers = payment.calculate_payment_tiers(
            matched, terms_days=30, terms_type="net", today=date(2026, 5, 1),
        )
        warnings = payment.flag_large_invoices(
            tiers["conservative"]["invoices"], tiers["conservative"]["total"],
        )
        assert len(warnings) == 1
        assert warnings[0]["invoice_number"] == "WHALE"


# ---- CLI smoke --------------------------------------------------------------

class TestCLI:
    @pytest.fixture()
    def input_file(self, tmp_path: Path) -> Path:
        payload = {
            "matched_invoices": [
                {"id": 1, "invoice_number": "A", "amount": 100.0,
                 "invoice_date": "2026-03-16", "currency": "USD"},
                {"id": 2, "invoice_number": "B", "amount": 200.0,
                 "invoice_date": "2026-04-05", "currency": "USD"},
            ],
            "reconciliation": {"results": [{"match_status": "MATCHED"}]},
        }
        p = tmp_path / "matched.json"
        p.write_text(json.dumps(payload))
        return p

    def test_main_prints_tier_json(self, input_file: Path, capsys):
        code = payment.main([
            "--file", str(input_file),
            "--terms-days", "30",
            "--terms-type", "net",
            "--today", "2026-05-01",
        ])
        captured = capsys.readouterr()
        assert code == 0
        out = json.loads(captured.out)
        assert out["blocked"] is False
        assert set(out["tiers"].keys()) == {"strict", "conservative", "aggressive"}
        assert out["tiers"]["aggressive"]["invoice_count"] == 2

    def test_main_blocks_on_currency_mismatch(self, tmp_path: Path, capsys):
        payload = {
            "matched_invoices": [],
            "reconciliation": {"results": [{"match_status": "CURRENCY_MISMATCH"}]},
        }
        p = tmp_path / "blocked.json"
        p.write_text(json.dumps(payload))
        code = payment.main([
            "--file", str(p),
            "--terms-days", "30",
            "--terms-type", "net",
        ])
        captured = capsys.readouterr()
        assert code == 3
        out = json.loads(captured.out)
        assert out["blocked"] is True
        assert "CURRENCY_MISMATCH" in out["reason"]

    def test_main_file_not_found(self, tmp_path: Path, capsys):
        code = payment.main([
            "--file", str(tmp_path / "nope.json"),
            "--terms-days", "30",
            "--terms-type", "net",
        ])
        captured = capsys.readouterr()
        assert code == 2
        assert "file not found" in captured.err

    def test_module_invocation(self, input_file: Path):
        proc = subprocess.run(
            [sys.executable, "-m", "src.payment",
             "--file", str(input_file),
             "--terms-days", "30",
             "--terms-type", "net",
             "--today", "2026-05-01"],
            capture_output=True, text=True,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        assert proc.returncode == 0, proc.stderr
        out = json.loads(proc.stdout)
        assert out["tiers"]["aggressive"]["total"] == 300.0
