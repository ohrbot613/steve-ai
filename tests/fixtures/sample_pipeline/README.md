# Steve AI sample reconciliation fixtures

Synthetic supplier data for the local end-to-end reconciliation demo. These files contain no private supplier data and require no live Xero, WhatsApp, OpenClaw, or email credentials.

Suppliers covered:

- `founding_ip` — clean matched supplier, safe payment recommendation.
- `stalker_ip` — mixed supplier with a missing statement/Xero discrepancy and a safe partial payment.
- `khip` — currency mismatch safety case; payment must be blocked.

Run the demo with:

```bash
python scripts/run_sample_reconciliation.py --out /tmp/steve-sample-run
```
