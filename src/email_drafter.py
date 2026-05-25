"""Email drafting for supplier reconciliation outcomes.

Four templates the CFO sends after a reconciliation run:

* ``missing_invoices``     — invoices on supplier statement not found in Xero
* ``amount_mismatch``      — invoices found in both but amounts differ
* ``already_paid``         — supplier billed for something already paid in Xero
* ``payment_confirmation`` — confirm what is being paid in this cycle

Each ``draft_*`` returns a :class:`Draft` (subject + plain-text body + ``to``).
The default mode is render-only.  Sending is opt-in via :func:`send_email`,
which reads SMTP credentials from environment variables (never from files).
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import sys
from dataclasses import dataclass, field
from email.message import EmailMessage
from pathlib import Path
from typing import Iterable, Optional, Sequence

# ---- template names ----------------------------------------------------------
TEMPLATE_MISSING_INVOICES = "missing_invoices"
TEMPLATE_AMOUNT_MISMATCH = "amount_mismatch"
TEMPLATE_ALREADY_PAID = "already_paid"
TEMPLATE_PAYMENT_CONFIRMATION = "payment_confirmation"

TEMPLATES = (
    TEMPLATE_MISSING_INVOICES,
    TEMPLATE_AMOUNT_MISMATCH,
    TEMPLATE_ALREADY_PAID,
    TEMPLATE_PAYMENT_CONFIRMATION,
)

# ---- env var names -----------------------------------------------------------
ENV_SMTP_HOST = "STEVE_SMTP_HOST"
ENV_SMTP_PORT = "STEVE_SMTP_PORT"
ENV_SMTP_USER = "STEVE_SMTP_USER"
ENV_SMTP_PASSWORD = "STEVE_SMTP_PASSWORD"
ENV_SMTP_FROM = "STEVE_SMTP_FROM"
ENV_SMTP_USE_TLS = "STEVE_SMTP_USE_TLS"


@dataclass
class Draft:
    """A rendered email — never sent unless the caller asks for it."""
    template: str
    subject: str
    body: str
    to: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "template": self.template,
            "subject": self.subject,
            "body": self.body,
            "to": self.to,
            "metadata": self.metadata,
        }


# ---- helpers -----------------------------------------------------------------

def _fmt_amount(amount, currency: Optional[str]) -> str:
    try:
        value = float(amount)
    except (TypeError, ValueError):
        return str(amount)
    if currency:
        return f"{currency} {value:,.2f}"
    return f"{value:,.2f}"


def _supplier_name(supplier) -> str:
    if isinstance(supplier, dict):
        return supplier.get("name") or supplier.get("supplier_name") or "Supplier"
    return str(supplier) if supplier else "Supplier"


def _supplier_email(supplier) -> Optional[str]:
    if isinstance(supplier, dict):
        return supplier.get("email") or supplier.get("contact_email")
    return None


def _line_for_invoice(inv: dict, *, default_currency: Optional[str] = None) -> str:
    number = inv.get("invoice_number") or inv.get("number") or "(no number)"
    amount = inv.get("amount")
    currency = inv.get("currency") or default_currency
    date = inv.get("invoice_date") or inv.get("date") or ""
    pieces = [f"- {number}"]
    if date:
        pieces.append(f"dated {date}")
    if amount is not None:
        pieces.append(f"for {_fmt_amount(amount, currency)}")
    return " ".join(pieces)


# ---- templates ---------------------------------------------------------------

def draft_missing_invoices(
    supplier,
    invoices: Sequence[dict],
    *,
    period: Optional[str] = None,
    currency: Optional[str] = None,
    to: Optional[str] = None,
) -> Draft:
    """Ask the supplier for the underlying invoices we cannot find in Xero."""
    name = _supplier_name(supplier)
    period_clause = f" for {period}" if period else ""
    lines = [_line_for_invoice(i, default_currency=currency) for i in invoices]
    body = (
        f"Hi {name} team,\n\n"
        f"We are reconciling your statement{period_clause} and the following "
        f"line items are not yet in our accounting system:\n\n"
        + ("\n".join(lines) if lines else "  (none)")
        + "\n\nCould you please resend the supporting invoices (PDFs) so we "
        "can process payment?\n\nThanks,\nAccounts Payable"
    )
    subject = f"{name}: please resend {len(invoices)} missing invoice(s)"
    return Draft(
        template=TEMPLATE_MISSING_INVOICES,
        subject=subject,
        body=body,
        to=to or _supplier_email(supplier),
        metadata={"invoice_count": len(invoices), "period": period},
    )


def draft_amount_mismatch(
    supplier,
    mismatches: Sequence[dict],
    *,
    currency: Optional[str] = None,
    to: Optional[str] = None,
) -> Draft:
    """Flag invoices where the statement amount and Xero amount disagree.

    Each entry in ``mismatches`` should provide ``invoice_number``,
    ``statement_amount``, ``xero_amount`` (and optional ``invoice_date``).
    """
    name = _supplier_name(supplier)
    rows: list[str] = []
    for m in mismatches:
        number = m.get("invoice_number") or "(no number)"
        statement_amount = m.get("statement_amount", m.get("amount"))
        xero_amount = m.get("xero_amount")
        diff = None
        if statement_amount is not None and xero_amount is not None:
            try:
                diff = round(float(statement_amount) - float(xero_amount), 2)
            except (TypeError, ValueError):
                diff = None
        line = (
            f"- {number}: statement says "
            f"{_fmt_amount(statement_amount, currency)}, "
            f"our records show {_fmt_amount(xero_amount, currency)}"
        )
        if diff is not None:
            line += f" (difference {_fmt_amount(diff, currency)})"
        rows.append(line)
    body = (
        f"Hi {name} team,\n\n"
        f"While reconciling your statement we noticed the following "
        f"amount discrepancies:\n\n"
        + ("\n".join(rows) if rows else "  (none)")
        + "\n\nCould you confirm the correct amount for each, or send a "
        "revised invoice if applicable?\n\nThanks,\nAccounts Payable"
    )
    subject = f"{name}: amount discrepancy on {len(mismatches)} invoice(s)"
    return Draft(
        template=TEMPLATE_AMOUNT_MISMATCH,
        subject=subject,
        body=body,
        to=to or _supplier_email(supplier),
        metadata={"mismatch_count": len(mismatches)},
    )


def draft_already_paid(
    supplier,
    invoices: Sequence[dict],
    *,
    currency: Optional[str] = None,
    to: Optional[str] = None,
) -> Draft:
    """Tell the supplier these invoices have already been settled."""
    name = _supplier_name(supplier)
    lines = []
    for inv in invoices:
        number = inv.get("invoice_number") or "(no number)"
        amount = inv.get("amount") or inv.get("paid_amount")
        paid_on = inv.get("paid_on") or inv.get("payment_date")
        parts = [f"- {number}"]
        if amount is not None:
            parts.append(f"for {_fmt_amount(amount, currency)}")
        if paid_on:
            parts.append(f"paid on {paid_on}")
        lines.append(" ".join(parts))
    body = (
        f"Hi {name} team,\n\n"
        f"Your statement lists the following invoice(s) as outstanding, "
        f"but our records show they have already been paid:\n\n"
        + ("\n".join(lines) if lines else "  (none)")
        + "\n\nPlease check your end and let us know if there is a "
        "discrepancy. Otherwise, please update your statement.\n\n"
        "Thanks,\nAccounts Payable"
    )
    subject = f"{name}: {len(invoices)} invoice(s) already paid"
    return Draft(
        template=TEMPLATE_ALREADY_PAID,
        subject=subject,
        body=body,
        to=to or _supplier_email(supplier),
        metadata={"invoice_count": len(invoices)},
    )


def draft_payment_confirmation(
    supplier,
    invoices: Sequence[dict],
    *,
    total: Optional[float] = None,
    currency: Optional[str] = None,
    payment_date: Optional[str] = None,
    reference: Optional[str] = None,
    to: Optional[str] = None,
) -> Draft:
    """Confirm an upcoming/just-released payment run."""
    name = _supplier_name(supplier)
    lines = [_line_for_invoice(i, default_currency=currency) for i in invoices]
    computed_total = total
    if computed_total is None:
        try:
            computed_total = round(sum(float(i.get("amount", 0)) for i in invoices), 2)
        except (TypeError, ValueError):
            computed_total = None
    date_clause = f" on {payment_date}" if payment_date else ""
    ref_clause = f" (reference: {reference})" if reference else ""
    body = (
        f"Hi {name} team,\n\n"
        f"This is to confirm the following payment{date_clause}{ref_clause}:\n\n"
        + ("\n".join(lines) if lines else "  (none)")
        + (f"\n\nTotal: {_fmt_amount(computed_total, currency)}"
           if computed_total is not None else "")
        + "\n\nPlease let us know once the funds arrive.\n\n"
        "Thanks,\nAccounts Payable"
    )
    subject = (
        f"{name}: payment of {_fmt_amount(computed_total, currency)}"
        if computed_total is not None
        else f"{name}: payment confirmation"
    )
    return Draft(
        template=TEMPLATE_PAYMENT_CONFIRMATION,
        subject=subject,
        body=body,
        to=to or _supplier_email(supplier),
        metadata={
            "invoice_count": len(invoices),
            "total": computed_total,
            "payment_date": payment_date,
            "reference": reference,
        },
    )


def draft(template: str, supplier, **kwargs) -> Draft:
    """Dispatch by template name."""
    if template == TEMPLATE_MISSING_INVOICES:
        return draft_missing_invoices(supplier, kwargs.pop("invoices", []), **kwargs)
    if template == TEMPLATE_AMOUNT_MISMATCH:
        return draft_amount_mismatch(supplier, kwargs.pop("mismatches", []), **kwargs)
    if template == TEMPLATE_ALREADY_PAID:
        return draft_already_paid(supplier, kwargs.pop("invoices", []), **kwargs)
    if template == TEMPLATE_PAYMENT_CONFIRMATION:
        return draft_payment_confirmation(supplier, kwargs.pop("invoices", []), **kwargs)
    raise ValueError(
        f"unknown template {template!r}; expected one of {TEMPLATES}"
    )


# ---- SMTP (opt-in) -----------------------------------------------------------

@dataclass
class SmtpConfig:
    host: str
    port: int
    username: Optional[str]
    password: Optional[str]
    sender: str
    use_tls: bool = True

    @classmethod
    def from_env(cls, env: Optional[dict] = None) -> Optional["SmtpConfig"]:
        """Build a config from env vars. Returns None when SMTP is not set up.

        Required: ``STEVE_SMTP_HOST`` and ``STEVE_SMTP_FROM`` — without those
        the caller is presumed to be in render-only mode.
        """
        env = env if env is not None else os.environ
        host = env.get(ENV_SMTP_HOST)
        sender = env.get(ENV_SMTP_FROM)
        if not host or not sender:
            return None
        try:
            port = int(env.get(ENV_SMTP_PORT, "587"))
        except ValueError:
            port = 587
        use_tls = env.get(ENV_SMTP_USE_TLS, "true").lower() not in ("0", "false", "no")
        return cls(
            host=host,
            port=port,
            username=env.get(ENV_SMTP_USER),
            password=env.get(ENV_SMTP_PASSWORD),
            sender=sender,
            use_tls=use_tls,
        )


def send_email(
    draft_obj: Draft,
    *,
    config: Optional[SmtpConfig] = None,
    transport=None,
) -> dict:
    """Send ``draft_obj`` over SMTP. ``transport`` is a hook for tests.

    Returns ``{"sent": bool, "to": ..., "reason": ...}``. Raises ``ValueError``
    when the draft has no recipient.
    """
    if not draft_obj.to:
        raise ValueError("cannot send email: draft has no 'to' address")
    config = config or SmtpConfig.from_env()
    if config is None:
        return {"sent": False, "to": draft_obj.to, "reason": "smtp_not_configured"}

    msg = EmailMessage()
    msg["Subject"] = draft_obj.subject
    msg["From"] = config.sender
    msg["To"] = draft_obj.to
    msg.set_content(draft_obj.body)

    if transport is not None:
        transport(msg, config)
        return {"sent": True, "to": draft_obj.to, "reason": "transport_hook"}

    with smtplib.SMTP(config.host, config.port) as smtp:
        if config.use_tls:
            smtp.starttls()
        if config.username and config.password:
            smtp.login(config.username, config.password)
        smtp.send_message(msg)
    return {"sent": True, "to": draft_obj.to, "reason": "smtp"}


# ---- CLI ---------------------------------------------------------------------

def _load_payload(path: Optional[str]) -> dict:
    if not path or path == "-":
        return json.loads(sys.stdin.read() or "{}")
    return json.loads(Path(path).read_text())


def _build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description=(
            "Render one of the four supplier email templates. Reads payload "
            "JSON from --file (or stdin) and prints the draft as JSON."
        )
    )
    ap.add_argument("--type", required=True, choices=list(TEMPLATES))
    ap.add_argument(
        "--file",
        help="Path to JSON payload with template-specific fields (use '-' for stdin)",
    )
    ap.add_argument(
        "--send",
        action="store_true",
        help="Also send via SMTP using STEVE_SMTP_* env vars (default: render only)",
    )
    return ap


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    try:
        payload = _load_payload(args.file)
    except FileNotFoundError as exc:
        print(f"error: file not found: {exc}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"error: invalid JSON: {exc}", file=sys.stderr)
        return 1

    supplier = payload.get("supplier") or {}
    kwargs = {k: v for k, v in payload.items() if k != "supplier"}
    try:
        d = draft(args.type, supplier, **kwargs)
    except (TypeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    output = d.to_dict()
    if args.send:
        try:
            output["delivery"] = send_email(d)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1

    json.dump(output, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = [
    "Draft",
    "SmtpConfig",
    "TEMPLATES",
    "TEMPLATE_ALREADY_PAID",
    "TEMPLATE_AMOUNT_MISMATCH",
    "TEMPLATE_MISSING_INVOICES",
    "TEMPLATE_PAYMENT_CONFIRMATION",
    "draft",
    "draft_already_paid",
    "draft_amount_mismatch",
    "draft_missing_invoices",
    "draft_payment_confirmation",
    "main",
    "send_email",
]
