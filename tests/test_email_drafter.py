import json
import subprocess
import sys
from email.message import EmailMessage
from pathlib import Path

import pytest

from src import email_drafter


SUPPLIER = {"name": "Founding IP", "email": "ap@founding.example"}


class TestDraftMissingInvoices:
    def test_basic_render(self):
        d = email_drafter.draft_missing_invoices(
            SUPPLIER,
            [{"invoice_number": "INV-1", "amount": 100.0, "invoice_date": "2026-01-15"}],
            currency="GBP",
            period="Jan 2026",
        )
        assert d.template == email_drafter.TEMPLATE_MISSING_INVOICES
        assert d.to == "ap@founding.example"
        assert "Founding IP" in d.subject and "1 missing invoice" in d.subject
        assert "Jan 2026" in d.body
        assert "INV-1" in d.body
        assert "GBP 100.00" in d.body
        assert d.metadata["invoice_count"] == 1

    def test_empty_list_renders_none_marker(self):
        d = email_drafter.draft_missing_invoices(SUPPLIER, [])
        assert "(none)" in d.body
        assert d.metadata["invoice_count"] == 0


class TestDraftAmountMismatch:
    def test_basic_render_includes_diff(self):
        d = email_drafter.draft_amount_mismatch(
            SUPPLIER,
            [{"invoice_number": "INV-2", "statement_amount": 120.0, "xero_amount": 100.0}],
            currency="GBP",
        )
        assert d.template == email_drafter.TEMPLATE_AMOUNT_MISMATCH
        assert "INV-2" in d.body
        assert "GBP 120.00" in d.body
        assert "GBP 100.00" in d.body
        assert "GBP 20.00" in d.body  # diff
        assert d.metadata["mismatch_count"] == 1

    def test_missing_xero_amount_omits_diff(self):
        d = email_drafter.draft_amount_mismatch(
            SUPPLIER,
            [{"invoice_number": "INV-3", "statement_amount": 50.0}],
        )
        assert "INV-3" in d.body
        assert "difference" not in d.body


class TestDraftAlreadyPaid:
    def test_basic_render(self):
        d = email_drafter.draft_already_paid(
            SUPPLIER,
            [{"invoice_number": "INV-7", "amount": 200.0, "paid_on": "2026-02-01"}],
            currency="GBP",
        )
        assert d.template == email_drafter.TEMPLATE_ALREADY_PAID
        assert "INV-7" in d.body
        assert "GBP 200.00" in d.body
        assert "2026-02-01" in d.body


class TestDraftPaymentConfirmation:
    def test_total_auto_summed(self):
        d = email_drafter.draft_payment_confirmation(
            SUPPLIER,
            [
                {"invoice_number": "A", "amount": 100.0, "invoice_date": "2026-01-01"},
                {"invoice_number": "B", "amount": 250.0, "invoice_date": "2026-01-15"},
            ],
            currency="GBP",
            payment_date="2026-03-01",
            reference="WIRE-001",
        )
        assert d.template == email_drafter.TEMPLATE_PAYMENT_CONFIRMATION
        assert "A" in d.body and "B" in d.body
        assert "GBP 350.00" in d.body
        assert "2026-03-01" in d.body
        assert "WIRE-001" in d.body
        assert d.metadata["total"] == 350.0

    def test_explicit_total_overrides_sum(self):
        d = email_drafter.draft_payment_confirmation(
            SUPPLIER,
            [{"invoice_number": "A", "amount": 100.0, "invoice_date": "2026-01-01"}],
            total=999.0,
            currency="GBP",
        )
        assert "GBP 999.00" in d.body
        assert d.metadata["total"] == 999.0


class TestDispatch:
    def test_draft_dispatches_by_name(self):
        d = email_drafter.draft(
            email_drafter.TEMPLATE_MISSING_INVOICES,
            SUPPLIER,
            invoices=[{"invoice_number": "X", "amount": 1.0}],
        )
        assert d.template == email_drafter.TEMPLATE_MISSING_INVOICES

    def test_unknown_template_raises(self):
        with pytest.raises(ValueError, match="unknown template"):
            email_drafter.draft("nonsense", SUPPLIER, invoices=[])


class TestSmtpConfig:
    def test_from_env_returns_none_without_required_vars(self):
        assert email_drafter.SmtpConfig.from_env({}) is None
        # host alone is not enough
        assert email_drafter.SmtpConfig.from_env({"STEVE_SMTP_HOST": "h"}) is None

    def test_from_env_with_required_vars(self):
        cfg = email_drafter.SmtpConfig.from_env({
            "STEVE_SMTP_HOST": "smtp.example.com",
            "STEVE_SMTP_FROM": "ap@example.com",
            "STEVE_SMTP_PORT": "2525",
            "STEVE_SMTP_USE_TLS": "false",
        })
        assert cfg is not None
        assert cfg.host == "smtp.example.com"
        assert cfg.port == 2525
        assert cfg.use_tls is False


class TestSendEmail:
    def test_render_only_when_smtp_not_configured(self, monkeypatch):
        monkeypatch.delenv("STEVE_SMTP_HOST", raising=False)
        monkeypatch.delenv("STEVE_SMTP_FROM", raising=False)
        d = email_drafter.draft_missing_invoices(SUPPLIER, [])
        result = email_drafter.send_email(d)
        assert result == {"sent": False, "to": SUPPLIER["email"], "reason": "smtp_not_configured"}

    def test_send_via_transport_hook(self):
        captured = {}

        def transport(msg: EmailMessage, config):
            captured["subject"] = msg["Subject"]
            captured["to"] = msg["To"]
            captured["from"] = msg["From"]
            captured["body"] = msg.get_content()

        d = email_drafter.draft_missing_invoices(
            SUPPLIER,
            [{"invoice_number": "INV-9", "amount": 50.0}],
        )
        cfg = email_drafter.SmtpConfig(
            host="h", port=25, username=None, password=None,
            sender="ap@example.com",
        )
        result = email_drafter.send_email(d, config=cfg, transport=transport)
        assert result["sent"] is True
        assert captured["to"] == "ap@founding.example"
        assert captured["from"] == "ap@example.com"
        assert "INV-9" in captured["body"]

    def test_send_without_to_raises(self):
        d = email_drafter.draft_missing_invoices({"name": "X"}, [])
        with pytest.raises(ValueError, match="no 'to' address"):
            email_drafter.send_email(d)


class TestCLI:
    @pytest.fixture()
    def payload_file(self, tmp_path: Path) -> Path:
        p = tmp_path / "payload.json"
        p.write_text(json.dumps({
            "supplier": SUPPLIER,
            "invoices": [{"invoice_number": "INV-1", "amount": 10.0}],
            "currency": "GBP",
        }))
        return p

    def test_main_renders_draft_to_stdout(self, payload_file: Path, capsys):
        code = email_drafter.main([
            "--type", email_drafter.TEMPLATE_MISSING_INVOICES,
            "--file", str(payload_file),
        ])
        captured = capsys.readouterr()
        assert code == 0
        out = json.loads(captured.out)
        assert out["template"] == email_drafter.TEMPLATE_MISSING_INVOICES
        assert "INV-1" in out["body"]
        assert "delivery" not in out

    def test_main_invalid_template_arg(self, payload_file: Path, capsys):
        with pytest.raises(SystemExit):
            email_drafter.main([
                "--type", "bogus",
                "--file", str(payload_file),
            ])

    def test_module_invocation(self, payload_file: Path):
        proc = subprocess.run(
            [sys.executable, "-m", "src.email_drafter",
             "--type", email_drafter.TEMPLATE_PAYMENT_CONFIRMATION,
             "--file", str(payload_file)],
            capture_output=True, text=True,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        assert proc.returncode == 0, proc.stderr
        out = json.loads(proc.stdout)
        assert out["template"] == email_drafter.TEMPLATE_PAYMENT_CONFIRMATION
