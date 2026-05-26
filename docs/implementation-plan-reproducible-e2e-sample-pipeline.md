# Implementation Plan: Reproducible Local E2E Sample Pipeline

## Selected next step

Build a **one-command, fully local sample reconciliation pipeline** around the existing Python reconciliation CLI (`src/reconciliation_app.py`).

This is the highest-value feasible next step today because it advances the CLI runner / reproducible end-to-end sample pipeline goals from issues #30/#40 without external credentials, live Xero, WhatsApp, OpenClaw, or private supplier data. The repo already has the core CLI orchestration (`init`, `ingest-statement`, `load-xero`, `reconcile`, `status`, `audit`) and unit tests; what is missing is a checked-in synthetic fixture pack plus a script/test that proves a fresh checkout can run the whole workflow end-to-end and produce stable artifacts.

## Outcome

After implementation, a developer should be able to run:

```bash
python scripts/run_sample_reconciliation.py --out /tmp/steve-sample-run
```

and get a deterministic local run containing:

```text
/tmp/steve-sample-run/
  steve.db
  ingest.json
  load_xero.json
  reconcile.json
  status.json
  audit.json
  reconciliation.xlsx        # if openpyxl is available
  summary.md
```

The command must use only synthetic data committed in `tests/fixtures/sample_pipeline/`.

## Current repo facts to rely on

- Python reconciliation orchestrator exists: `src/reconciliation_app.py`.
- Existing CLI subcommands:
  - `init`
  - `ingest-statement`
  - `load-xero`
  - `reconcile`
  - `status`
  - `audit`
- Parser supports CSV/text locally via stdlib paths: `src/parser.py`, `src/statement_parser.py`.
- SQLite DB layer exists: `src/db_ops.py`.
- Email, payment, audit, status, and Excel modules already have tests under `tests/`.
- No fixture directory currently exists for a committed reproducible sample pipeline.

## Scope

### In scope

- Synthetic local fixture pack.
- One-command runner script.
- Machine-readable output artifacts.
- Deterministic assertions against expected status counts / payment totals / email drafts.
- Pytest coverage for the sample pipeline.
- README/docs showing how Claude Code or a developer can run it.

### Out of scope

- Live Xero OAuth or API calls.
- WhatsApp/OpenClaw integrations.
- MongoDB/Express/React changes.
- Real supplier PDFs or private supplier data.
- Large synthetic generator framework. This plan creates one golden sample pack first; a generator can come later.

## Files to create

### Fixture pack

Create:

```text
tests/fixtures/sample_pipeline/
  README.md
  statement.csv
  xero_invoices.json
  expected.json
```

#### `tests/fixtures/sample_pipeline/statement.csv`

Use a simple CSV table that the existing parser can understand. Include supplier name text only if useful, but pass `--supplier "Founding IP"` in the runner to avoid relying on filename/text heuristics.

Recommended rows:

```csv
Invoice No,Invoice Date,Amount,Currency
INV-1001,2026-01-15,100.00,GBP
INV-1002,2026-01-20,250.00,GBP
INV-1003,2026-01-25,75.00,GBP
INV-PAID,2026-01-10,50.00,GBP
```

This produces a statement total of `475.00` if/when parser total extraction supports it; the runner/test should not depend on statement total unless it is explicitly parsed.

#### `tests/fixtures/sample_pipeline/xero_invoices.json`

Use Xero-shaped local JSON only, not live Xero:

```json
[
  {
    "xero_invoice_id": "xero-1001",
    "invoice_number": "INV-1001",
    "amount": 100.0,
    "currency": "GBP",
    "status": "AUTHORISED",
    "invoice_date": "2026-01-15"
  },
  {
    "xero_invoice_id": "xero-1002",
    "invoice_number": "INV-1002",
    "amount": 240.0,
    "currency": "GBP",
    "status": "AUTHORISED",
    "invoice_date": "2026-01-20"
  },
  {
    "xero_invoice_id": "xero-paid",
    "invoice_number": "INV-PAID",
    "amount": 50.0,
    "currency": "GBP",
    "status": "PAID",
    "invoice_date": "2026-01-10"
  },
  {
    "xero_invoice_id": "xero-9999",
    "invoice_number": "INV-9999",
    "amount": 500.0,
    "currency": "GBP",
    "status": "AUTHORISED",
    "invoice_date": "2026-01-30"
  }
]
```

Expected matcher coverage:

- `MATCHED`: `INV-1001`
- `AMOUNT_MISMATCH`: `INV-1002`
- `MISSING_FROM_XERO`: `INV-1003`
- `ALREADY_PAID`: `INV-PAID`
- `MISSING_FROM_STATEMENT`: `INV-9999`

#### `tests/fixtures/sample_pipeline/expected.json`

Create explicit assertions for the runner and test:

```json
{
  "supplier": "Founding IP",
  "terms_days": 30,
  "terms_type": "net",
  "tier": "aggressive",
  "today": "2026-05-01",
  "expected_status_counts": {
    "MATCHED": 1,
    "AMOUNT_MISMATCH": 1,
    "MISSING_FROM_XERO": 1,
    "ALREADY_PAID": 1,
    "MISSING_FROM_STATEMENT": 1
  },
  "expected_payment": {
    "tier": "aggressive",
    "invoice_count": 1,
    "total": 100.0,
    "blocked_reason": null
  },
  "expected_email_templates": [
    "missing_invoices",
    "amount_mismatch",
    "already_paid",
    "payment_confirmation"
  ],
  "must_create_audit_actions": [
    "parse",
    "xero_invoices_loaded",
    "reconciliation_run",
    "payment_calculated",
    "email_drafted"
  ]
}
```

If actual constants differ, adapt the fixture to the constants in `src/email_drafter.py` and `src/audit_logger.py`; do not invent new constants.

### Runner script

Create:

```text
scripts/run_sample_reconciliation.py
```

Responsibilities:

1. Parse args:
   - `--fixture tests/fixtures/sample_pipeline` default.
   - `--out` required or default to `artifacts/sample_pipeline`.
   - `--no-excel` optional to skip workbook generation.
   - `--keep-existing` optional; default behavior should delete/recreate the output directory for reproducibility.
2. Create output directory.
3. Initialize SQLite DB via `reconciliation_app.cmd_init(db_path)`.
4. Ingest `statement.csv` using `reconciliation_app.cmd_ingest_statement(...)` with `supplier_override="Founding IP"` from `expected.json`.
5. Load `xero_invoices.json` with `reconciliation_app.cmd_load_xero_file(...)`.
6. Reconcile with:
   - `terms_days=30`
   - `terms_type=payment.TERMS_NET` or the fixture value mapped to the constant
   - `tier=payment.TIER_AGGRESSIVE`
   - `today=2026-05-01`
   - `draft_emails=True`
   - `excel_path=<out>/reconciliation.xlsx` unless `--no-excel`
7. Query status and audit using programmatic helpers where available, or by invoking the existing CLI functions and capturing JSON/CSV-safe output.
8. Write deterministic artifacts:
   - `ingest.json`
   - `load_xero.json`
   - `reconcile.json`
   - `status.json`
   - `audit.json`
   - `summary.md`
9. Validate actual output against `expected.json` and exit non-zero with clear error messages if expectations fail.
10. Print a short success line with output path.

Implementation notes:

- Prefer direct Python function calls over subprocess calls. This keeps tests faster and makes failures easier to debug.
- Ensure repo imports work when script is run from any cwd:
  - Resolve `repo_root = Path(__file__).resolve().parents[1]`.
  - Insert `repo_root` into `sys.path` if needed.
- Use `json.dump(..., indent=2, sort_keys=True, default=str)` for stable artifacts.
- For status/audit, if existing APIs return text only, store a structured minimal JSON produced from DB queries rather than parsing human output.
- Excel is useful but should not make the whole script unusable if optional dependencies are missing. If workbook generation raises an ImportError, record `excel_skipped` in `summary.md` and continue unless the test environment has `openpyxl` installed.

### Test file

Create:

```text
tests/test_sample_pipeline.py
```

Test cases:

1. `test_sample_pipeline_runner_creates_expected_artifacts`
   - Run the runner’s main/programmatic function with `tmp_path` as output.
   - Assert files exist:
     - `steve.db`
     - `ingest.json`
     - `load_xero.json`
     - `reconcile.json`
     - `status.json`
     - `audit.json`
     - `summary.md`
   - Assert `reconcile.json` has expected status counts.
   - Assert payment tier total is `100.0` and invoice count is `1`.
   - Assert draft email templates match `expected_email_templates`.
   - Assert audit actions include parse/load/reconcile/payment/email.

2. `test_sample_pipeline_is_reproducible`
   - Run the pipeline twice into two different temp dirs.
   - Compare normalized `reconcile.json` outputs after stripping environment-specific paths / generated timestamps / DB IDs if necessary.
   - At minimum compare:
     - status counts
     - payment result
     - draft template list
     - supplier name

3. Optional if easy: `test_sample_pipeline_cli_entrypoint`
   - Use `subprocess.run([sys.executable, "scripts/run_sample_reconciliation.py", "--out", tmp_path])`.
   - Assert exit code `0` and output artifacts exist.

## Documentation updates

### Add to `README.md`

Add a short section near local development:

````md
## Run the local sample reconciliation pipeline

This uses only synthetic fixtures and does not require Xero, MongoDB, WhatsApp, OpenClaw, or private supplier data.

```bash
python scripts/run_sample_reconciliation.py --out /tmp/steve-sample-run
```

Outputs include JSON snapshots, a local SQLite DB, audit/status summaries, and an Excel workbook when Excel dependencies are installed.
````

### Add fixture README

`tests/fixtures/sample_pipeline/README.md` should explain:

- Data is synthetic.
- Which statuses are intentionally covered.
- Expected payment safety behavior: only the matched authorized invoice is payable; mismatch/missing/paid/unmatched rows are not payable.
- How to regenerate/run the sample.

## Task sequence for Claude Code

1. **Inspect constants**
   - Open `src/matcher.py`, `src/payment.py`, `src/email_drafter.py`, and `src/audit_logger.py`.
   - Confirm exact status/action/template constant strings before finalizing `expected.json`.

2. **Create fixture directory**
   - Add `tests/fixtures/sample_pipeline/README.md`.
   - Add `statement.csv`.
   - Add `xero_invoices.json`.
   - Add `expected.json` using real constants.

3. **Implement runner**
   - Add `scripts/run_sample_reconciliation.py`.
   - Expose a programmatic function like:
     - `run_sample_pipeline(fixture_dir: Path, out_dir: Path, include_excel: bool = True) -> dict`
   - Keep `main(argv=None) -> int` thin and testable.
   - Write all artifacts under `out_dir`.
   - Add built-in expectation validation.

4. **Implement tests**
   - Add `tests/test_sample_pipeline.py`.
   - Use `tmp_path`, not repo-local generated files.
   - Import and call `run_sample_pipeline` directly for the main test.
   - Add a subprocess smoke test only if it is stable in the existing test environment.

5. **Update README**
   - Add local sample pipeline command and what it produces.

6. **Run tests**
   - Start with targeted tests:
     ```bash
     pytest tests/test_sample_pipeline.py tests/test_reconciliation_app.py -q
     ```
   - Then run the full Python test suite if fast enough:
     ```bash
     pytest -q
     ```

7. **Manual smoke run**
   - Run:
     ```bash
     python scripts/run_sample_reconciliation.py --out /tmp/steve-sample-run
     ```
   - Inspect `/tmp/steve-sample-run/summary.md` and `reconcile.json`.

## Validation details

### Status count validation

Calculate counts from:

```python
result["reconciliation"]["results"][i]["match_status"]
```

Compare to `expected_status_counts` exactly.

### Payment validation

Validate:

```python
result["payment"]["tier"] == "aggressive"
result["payment"]["selected_tier"]["invoice_count"] == 1
result["payment"]["selected_tier"]["total"] == 100.0
result["payment"]["blocked_reason"] is None
```

### Email validation

Validate draft templates from:

```python
[draft["template"] for draft in result["drafts"]]
```

Sort both sides before comparison unless order is explicitly important.

### Audit validation

Use `audit_logger.query_audit_log(db_path)` or direct DB query to collect `action` values. Assert expected action set is a subset of actual actions.

### Reproducibility normalization

Do not compare raw full artifacts if they include:

- absolute file paths,
- SQLite row IDs,
- timestamps,
- generated workbook binary content.

Instead compare a normalized summary object:

```json
{
  "supplier": "Founding IP",
  "status_counts": {...},
  "payment": {...},
  "draft_templates": [...]
}
```

Write this object to `summary.json` as an additional artifact if useful.

## Acceptance criteria

Implementation is complete when:

1. `python scripts/run_sample_reconciliation.py --out /tmp/steve-sample-run` succeeds on a fresh checkout with no external credentials.
2. The runner produces deterministic JSON artifacts and a human-readable `summary.md`.
3. The sample exercises at least these statuses:
   - `MATCHED`
   - `AMOUNT_MISMATCH`
   - `MISSING_FROM_XERO`
   - `ALREADY_PAID`
   - `MISSING_FROM_STATEMENT`
4. Payment recommendation includes only the safe matched authorized invoice (`INV-1001`, total `100.0`).
5. Mismatch, missing, already-paid, and missing-from-statement rows are excluded from payment.
6. Email drafts are produced for the expected non-empty buckets.
7. Audit log includes parse, Xero-load, reconciliation, payment, and email events.
8. `pytest tests/test_sample_pipeline.py tests/test_reconciliation_app.py -q` passes.
9. README documents the sample pipeline command.
10. No live Xero, WhatsApp, OpenClaw, MongoDB Atlas, or private supplier data is required.

## Risks and mitigations

- **Parser may skip CSV rows because headers/format are not recognized.**
  - Mitigation: Use the existing parser-supported pattern: invoice number, date, amount, currency columns. Confirm with a targeted parser test or adjust CSV cells, not parser logic, unless there is a clear parser bug.

- **Excel dependency may be absent.**
  - Mitigation: Make Excel optional in the runner and tests. If `openpyxl` is installed, assert workbook exists; otherwise assert `summary.md` records that Excel was skipped.

- **Expected constants may differ from names in this plan.**
  - Mitigation: Claude Code must inspect source constants first and use actual values from `src/*`.

- **Raw output may contain nondeterministic fields.**
  - Mitigation: Compare normalized summaries in reproducibility tests.

## Follow-up after this plan

Once this golden sample pipeline exists, the next buildable step is a deterministic fixture generator (`scripts/generate_synthetic_reconciliation_cases.py`) that emits many scenario packs in the same fixture shape. The sample runner should be designed so it can later accept any generated fixture directory with `statement.csv`, `xero_invoices.json`, and `expected.json`.
