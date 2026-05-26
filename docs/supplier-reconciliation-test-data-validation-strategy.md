# Steve AI Supplier Reconciliation: Synthetic Test Data + Validation Strategy

## Goal

Steve can become trustworthy before real supplier data arrives by treating reconciliation like a judged system: every synthetic supplier pack has a known answer key, every run is scored, and every edge case that could create a bad CFO/AP decision is deliberately injected.

This is not just “mock data”. It is a validation harness that asks: **if we already know the right supplier balance, invoice matches, discrepancies, payment recommendation, Excel pack, emails, and audit trail, does Steve reproduce them every time?**

## Founder/product framing

Until live supplier statements are available, we should sell and build confidence around three claims:

1. **Steve does not guess silently.** It must either match correctly or surface reviewable discrepancies with a clear reason.
2. **Steve protects payment decisions.** Currency issues, paid invoices, duplicates, ambiguous matches, and amount mismatches must block or constrain recommendations.
3. **Steve produces CFO-grade evidence.** The Excel pack, email drafts, and audit/status records must explain exactly why each invoice is payable, disputed, missing, or on hold.

Synthetic data should therefore model both happy-path supplier statements and the messy reality AP teams face: invoice number variations, credits, duplicates, partial payments, statement totals that do not add up, late/early payments, exchange-rate differences, and parser weirdness.

## Test-data architecture

### 1. Synthetic supplier personas

Create 8-12 reusable mock supplier personas. Names can include **Founding IP**, **Stalker IP**, and **KHIP** as fake personas, but all data should be synthetic and clearly labelled.

Each persona should have:

- Supplier name and aliases.
- Currency/currencies.
- Payment terms: net 30, net 60, EOM, custom.
- Statement format: CSV-like, Excel-like, PDF/text-like.
- Invoice numbering style.
- Normal behaviour profile: clean, messy, high-volume, multi-currency, lots of credits, legal/IP style retainers, etc.

Example personas:

| Persona | Purpose | Typical data |
|---|---|---|
| Founding IP | Clean baseline supplier | GBP, INV-1001 style, net 30, mostly exact matches |
| Stalker IP | Messy invoice-number supplier | Prefix/suffix variants, typos, duplicate-looking references |
| KHIP | Currency/terms stress supplier | USD/EUR/GBP mixed, EOM terms, FX/rounding cases |
| Volume Vendor | Scale/performance | 1k-10k invoices, mostly exact, few planted issues |
| Credit Note Supplier | Credits/negative rows | Credit notes, refunds, netted statement totals |
| Partial Pay Supplier | Payment-risk cases | paid_amount, partial payments, already-paid, overpaid |
| Subscription Vendor | Recurring invoices | same amounts/dates each month, ambiguous amount/date matches |
| Bad Statement Vendor | Parser/input quality | missing columns, OCR errors, date format chaos |

### 2. Canonical data objects

For every scenario, generate four artifacts:

1. **Supplier statement rows** — what the supplier says is outstanding.
2. **Xero-style ledger rows** — what accounting system says exists/paid/unpaid.
3. **Ground truth answer key** — expected match row for each invoice and expected business decision.
4. **Expected outputs** — payment tier totals, email buckets, Excel summary totals, status/audit events.

Minimum schema:

```json
{
  "scenario_id": "FOUNDING-IP-001-clean-exact",
  "supplier": { "name": "Founding IP", "currency": "GBP", "terms_type": "net", "terms_days": 30 },
  "statement": {
    "period_start": "2026-04-01",
    "period_end": "2026-04-30",
    "statement_total": 350.00,
    "invoices": []
  },
  "xero": { "invoices": [] },
  "ground_truth": {
    "expected_status_counts": { "MATCHED": 3 },
    "expected_payment": { "strict": 100.00, "conservative": 250.00, "aggressive": 350.00 },
    "must_block_payment": false,
    "expected_email_templates": []
  }
}
```

## Scenario catalogue

Build scenarios in layers so failures are easy to diagnose.

### A. Matcher correctness

Cover every status the engine emits:

- `MATCHED`: exact invoice number, amount, currency.
- `MATCHED` via normalized number: `INV-001`, `inv001`, `Invoice 001`.
- `MATCHED` via fuzzy number: one/two-character typo.
- `MATCHED` via amount+date: no reliable invoice number but same amount within date window.
- `AMOUNT_MISMATCH`: same invoice number, different amount.
- `CURRENCY_MISMATCH`: same invoice/amount, different currency.
- `ALREADY_PAID`: Xero invoice status `PAID`, still appears on statement.
- `MISSING_FROM_XERO`: supplier statement includes invoice absent from ledger.
- `MISSING_FROM_STATEMENT`: ledger includes unpaid invoice absent from supplier statement.
- `AMBIGUOUS`: duplicates on statement or Xero side.

Add adversarial cases:

- Same amount and close dates across multiple invoices.
- Duplicate invoice numbers with different amounts.
- Invoice-number collision across suppliers.
- Leading zeros: `000123` vs `123`.
- Separator variants: `INV/2026/001`, `INV-2026-001`, `INV 2026 001`.
- Credit notes with negative values.
- Zero-value invoices.
- Rounding differences: 100, 100.00, 100.004, 99.995.
- Tax-inclusive vs tax-exclusive amount differences.

### B. Statement balance and discrepancy math

Validate that statement totals and calculated balances explain all variance:

- Declared total equals row sum.
- Declared total differs from row sum.
- Missing invoice exactly explains variance.
- Amount mismatch exactly explains variance.
- Multiple small issues combine to variance.
- Unexplained variance remains after all known discrepancies.
- Paid/partial-paid values affect unpaid Xero total correctly.

### C. Payment recommendation safety

Test payment tiers and payment blocking:

- Net terms: due date = invoice date + N days.
- EOM terms: due date rolled to month end.
- Strict/conservative/aggressive tier cutoffs.
- Payment includes only `MATCHED` invoices.
- Payment excludes mismatches, missing, ambiguous, paid, and currency mismatch rows.
- Any `CURRENCY_MISMATCH` blocks the whole payment run.
- Large invoice warnings where one invoice dominates tier total.
- HOLD/EXTEND/TIGHTEN behaviour if exposed in product flow.
- Edge dates: leap year, month end, invoice on today, due tomorrow, overdue by one day.

### D. Parser/input robustness

Even without real PDFs, create synthetic files in CSV/XLSX/text forms:

- Header synonyms: `Invoice No`, `Inv #`, `Reference`, `Document Number`.
- Date formats: ISO, UK, US, `01-Apr-2026`, invalid dates.
- Amount formats: `£1,234.56`, `(123.45)`, `CR 123.45`, trailing minus.
- Mixed casing and extra whitespace.
- Missing supplier name; supplier inferred from alias or override.
- Statement with no invoice rows.
- Corrupted/unsupported file returns clean error.
- OCR-style noise: `INV-I001` vs `INV-1001`, `O` vs `0`, split lines.

### E. Excel pack validation

For every representative scenario, open the generated workbook and verify:

- Five tabs exist in order: Summary, Invoice Matching, Payment Schedule, Discrepancies, Audit Log.
- Every reconciliation result appears exactly once.
- Colour/status mapping is correct for each match status.
- Summary totals equal ground truth.
- Payment schedule excludes unsafe invoices.
- Discrepancies tab contains all review-needed rows.
- Audit Log tab contains parse/reconcile/payment/excel events.
- Currency/date formatting works for GBP/USD/EUR/EGP and unknown currencies.

### F. Email/status/audit validation

Validate the operational outputs, not just the matcher:

- Missing-invoice email generated only when `MISSING_FROM_XERO` exists.
- Amount-mismatch email generated only when `AMOUNT_MISMATCH` exists.
- Already-paid email generated when supplier statement asks for a paid invoice.
- Payment confirmation email only for selected safe payment tier.
- Status query shows supplier discrepancy counts and confidence correctly.
- Audit log is append-only and records source, actor, action, entity, payload.

### G. Scale and reliability

Run seeded randomized tests nightly:

- 10 suppliers × 100 invoices.
- 50 suppliers × 1,000 invoices.
- One stress supplier × 10,000 invoices.
- Randomly inject 0-20% discrepancies with known answer key.
- Repeat with same seed to guarantee reproducibility.
- Track runtime, memory, and result drift.

## Ground-truth generator design

Implement a deterministic generator, not hand-written fixtures only.

Recommended CLI:

```bash
python -m tools.generate_recon_fixtures \
  --scenario mixed_discrepancies \
  --supplier "Founding IP" \
  --invoice-count 250 \
  --seed 42 \
  --out tests/fixtures/generated/founding-ip-mixed-250
```

Output folder:

```text
tests/fixtures/generated/founding-ip-mixed-250/
  statement.csv
  statement.xlsx
  statement.json
  xero.json
  expected.json
  README.md
```

Generator features:

- Seeded randomness for reproducibility.
- Scenario templates with explicit injected defects.
- Stable IDs linking statement rows to Xero rows.
- Ground-truth status for each invoice pair.
- Expected balance totals and payment tier totals.
- Expected email templates and counts.
- Data provenance comments: what was injected and why.

Core approach:

1. Generate a clean ledger of invoices.
2. Copy it into a supplier statement.
3. Apply controlled mutations: typo invoice number, amount delta, missing row, duplicate, paid status, currency flip, credit note, date shift.
4. Write both input datasets.
5. Write the answer key at the same time the mutation is applied.
6. Run Steve and compare outputs to the answer key.

## Validation harness

Add a single test helper that executes the full Steve flow for a fixture:

1. Initialize test DB.
2. Seed or create supplier persona.
3. Ingest statement or insert statement rows directly for matcher tests.
4. Load Xero JSON.
5. Run reconciliation with terms/today.
6. Optionally generate Excel and emails.
7. Compare actual output against `expected.json`.

Assertions should include:

- Status counts match expected.
- Each input invoice appears exactly once in result rows.
- No statement invoice or Xero invoice is double-matched.
- Expected specific pairs are matched together.
- Amount differences equal expected values.
- `needs_review` contains every non-`MATCHED` row.
- Payment blocked when expected; otherwise total equals expected tier total.
- Email template set equals expected.
- Excel workbook totals/status rows match expected.
- Audit log includes required events.

## Acceptance metrics before live supplier data

Steve is “synthetic-data trustworthy” when it passes these gates:

| Area | Acceptance bar |
|---|---:|
| Exact/normalized matches | 100% correct on answer-key fixtures |
| Fuzzy/amount-date matches | ≥98% correct where scenario is intentionally unambiguous |
| Unsafe payment prevention | 100% block/exclude for currency mismatch, amount mismatch, ambiguous, missing, already paid |
| Discrepancy recall | 100% of planted discrepancies appear in `needs_review` |
| Silent bad payments | 0 tolerated |
| Balance math | 100% exact to penny/cent after rounding rule |
| Excel pack structure | 100% workbook/tab/status/total checks pass |
| Email routing | 100% correct template buckets |
| Repeatability | Same seed produces byte/logically identical expected data |
| Scale | 10k-invoice supplier completes within agreed performance budget |

The most important product metric is not fuzzy-match accuracy. It is: **false-safe rate = 0**. If Steve is uncertain, it should ask for review, not recommend payment.

## Implementation roadmap

### Phase 1 — Foundation, 1-2 days

- Create 20 hand-authored golden fixtures covering all matcher statuses.
- Add `expected.json` format.
- Add fixture runner tests around matcher/payment/email/excel/audit.
- Use existing mock suppliers such as Founding IP for continuity.

### Phase 2 — Generator, 2-4 days

- Build seeded generator for clean ledger + controlled mutations.
- Emit statement CSV/XLSX/text plus Xero JSON and answer key.
- Add 50-100 generated scenarios to CI, small enough to run fast.

### Phase 3 — Stress suite, 1-2 days

- Add nightly/optional large-volume tests.
- Track runtime and memory.
- Save failure artifacts for inspection: inputs, expected, actual, Excel pack.

### Phase 4 — Product validation pack, ongoing

- Keep 5-10 demo-ready synthetic supplier packs that look realistic.
- Use them in founder demos and design-partner walkthroughs.
- When real supplier data arrives, map real failures back into synthetic scenario templates so the regression suite grows permanently.

## How this answers “can we trust it without live data?”

We cannot prove live accuracy without live data. But we can prove Steve’s reconciliation logic is trustworthy under controlled truth conditions:

- We know the correct answer before Steve runs.
- We inject the exact mistakes CFO/AP teams fear.
- We require Steve to explain uncertainty instead of hiding it.
- We validate the whole workflow, not only invoice matching.
- We make every future real-data bug reproducible as a synthetic regression.

That gives Shaul a defensible pre-live-data story: **Steve is not validated on supplier reality yet, but it is validated against a broad, repeatable, CFO-risk-focused simulation suite with zero tolerance for silent bad payment recommendations.**
