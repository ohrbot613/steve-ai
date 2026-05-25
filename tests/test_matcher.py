from src import matcher


def _stmt(id_, number, amount, *, date=None, currency="GBP"):
    return {
        "id": id_,
        "invoice_number": number,
        "amount": amount,
        "currency": currency,
        "invoice_date": date,
    }


def _xero(id_, number, amount, *, date=None, currency="GBP", status="AUTHORISED", paid=0.0):
    return {
        "id": id_,
        "invoice_number": number,
        "amount": amount,
        "currency": currency,
        "invoice_date": date,
        "status": status,
        "paid_amount": paid,
    }


def _by_pair(results):
    """Return rows keyed by (statement_invoice_id, xero_invoice_id)."""
    return {(r["statement_invoice_id"], r["xero_invoice_id"]): r for r in results}


def test_exact_match_full_confidence():
    out = matcher.match_invoices(
        [_stmt(1, "INV-2026-001", 100.0)],
        [_xero(11, "INV-2026-001", 100.0)],
    )
    rows = _by_pair(out["results"])
    row = rows[(1, 11)]
    assert row["match_status"] == matcher.MATCHED
    assert row["match_method"] == matcher.METHOD_EXACT
    assert row["confidence"] == matcher.CONF_EXACT
    assert out["overall_confidence"] == "HIGH"


def test_normalized_format_difference_still_matches():
    # Different raw strings, identical normalized form -> normalized method.
    out = matcher.match_invoices(
        [_stmt(1, "INV-2026-001", 100.0)],
        [_xero(11, "inv 2026 001", 100.0)],
    )
    row = _by_pair(out["results"])[(1, 11)]
    assert row["match_status"] == matcher.MATCHED
    assert row["match_method"] == matcher.METHOD_NORMALIZED


def test_fuzzy_edit_distance_within_two():
    # inv2026001 vs inv2026020 — edit distance 2
    out = matcher.match_invoices(
        [_stmt(1, "INV-2026-001", 100.0)],
        [_xero(11, "INV-2026-020", 100.0)],
    )
    row = _by_pair(out["results"])[(1, 11)]
    assert row["match_status"] == matcher.MATCHED
    assert row["match_method"] == matcher.METHOD_FUZZY
    assert row["confidence"] == matcher.CONF_FUZZY


def test_amount_date_match_when_numbers_diverge():
    out = matcher.match_invoices(
        [_stmt(1, "REF-AAA-XYZ", 250.0, date="2026-05-20")],
        [_xero(11, "TOTALLY-DIFFERENT-1234", 250.0, date="2026-05-23")],
    )
    row = _by_pair(out["results"])[(1, 11)]
    assert row["match_status"] == matcher.MATCHED
    assert row["match_method"] == matcher.METHOD_AMOUNT_DATE
    assert row["confidence"] == matcher.CONF_AMOUNT_DATE


def test_amount_mismatch_is_flagged_not_matched():
    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0)],
        [_xero(11, "INV-001", 105.0)],
    )
    row = _by_pair(out["results"])[(1, 11)]
    assert row["match_status"] == matcher.AMOUNT_MISMATCH
    assert row["amount_difference"] == -5.0


def test_currency_mismatch_is_blocking():
    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0, currency="GBP")],
        [_xero(11, "INV-001", 100.0, currency="EGP")],
    )
    row = _by_pair(out["results"])[(1, 11)]
    assert row["match_status"] == matcher.CURRENCY_MISMATCH
    assert out["overall_confidence"] == "LOW"


def test_already_paid_xero_invoice():
    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0)],
        [_xero(11, "INV-001", 100.0, status="PAID", paid=100.0)],
    )
    row = _by_pair(out["results"])[(1, 11)]
    assert row["match_status"] == matcher.ALREADY_PAID


def test_already_paid_only_on_xero_side():
    # Xero has an unrelated paid invoice — must appear as ALREADY_PAID, not skipped.
    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0)],
        [
            _xero(11, "INV-001", 100.0),
            _xero(12, "INV-OLD-PAID", 50.0, status="PAID", paid=50.0),
        ],
    )
    statuses = {(r["statement_invoice_id"], r["xero_invoice_id"]): r["match_status"]
                for r in out["results"]}
    assert statuses[(1, 11)] == matcher.MATCHED
    assert statuses[(None, 12)] == matcher.ALREADY_PAID


def test_duplicate_invoice_numbers_flagged_ambiguous_on_both_sides():
    # Statement and Xero each have two invoices with the same normalized number.
    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0), _stmt(2, "INV-001", 100.0)],
        [_xero(11, "INV-001", 100.0), _xero(12, "INV-001", 100.0)],
    )
    statuses = [r["match_status"] for r in out["results"]]
    assert statuses.count(matcher.AMBIGUOUS) == 4
    assert matcher.MATCHED not in statuses


def test_missing_from_xero_and_from_statement():
    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0), _stmt(2, "INV-ONLY-STMT", 50.0)],
        [_xero(11, "INV-001", 100.0), _xero(12, "INV-ONLY-XERO", 75.0)],
    )
    statuses = {(r["statement_invoice_id"], r["xero_invoice_id"]): r["match_status"]
                for r in out["results"]}
    assert statuses[(1, 11)] == matcher.MATCHED
    assert statuses[(2, None)] == matcher.MISSING_FROM_XERO
    assert statuses[(None, 12)] == matcher.MISSING_FROM_STATEMENT


def test_every_invoice_appears_on_output_exactly_once():
    stmts = [_stmt(i, f"INV-{i:03}", 100.0 + i) for i in range(1, 11)]
    xeros = [_xero(100 + i, f"INV-{i:03}", 100.0 + i) for i in range(1, 11)]
    out = matcher.match_invoices(stmts, xeros)
    stmt_ids = {r["statement_invoice_id"] for r in out["results"] if r["statement_invoice_id"]}
    xero_ids = {r["xero_invoice_id"] for r in out["results"] if r["xero_invoice_id"]}
    assert stmt_ids == {s["id"] for s in stmts}
    assert xero_ids == {x["id"] for x in xeros}


def test_balance_summary_explains_variance():
    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0), _stmt(2, "INV-002", 50.0)],
        [_xero(11, "INV-001", 100.0)],
        statement_total=150.0,
    )
    b = out["balance"]
    assert b["statement_declared_total"] == 150.0
    assert b["statement_sum"] == 150.0
    assert b["matched_sum"] == 100.0
    assert b["declared_vs_sum_variance"] == 0.0


def test_overall_confidence_buckets():
    # 0 discrepancies -> HIGH
    out = matcher.match_invoices(
        [_stmt(i, f"INV-{i}", 10.0) for i in range(1, 4)],
        [_xero(100 + i, f"INV-{i}", 10.0) for i in range(1, 4)],
    )
    assert out["overall_confidence"] == "HIGH"
    # 4 discrepancies -> MEDIUM
    out = matcher.match_invoices(
        [_stmt(i, f"INV-{i}", 10.0) for i in range(1, 5)],
        [],
    )
    assert out["overall_confidence"] == "MEDIUM"
    # 6 -> LOW
    out = matcher.match_invoices(
        [_stmt(i, f"INV-{i}", 10.0) for i in range(1, 7)],
        [],
    )
    assert out["overall_confidence"] == "LOW"


def test_fuzzy_hook_is_invoked_for_leftovers_only():
    seen_calls: list[tuple[list, list]] = []

    def hook(unmatched_stmts, unmatched_xeros):
        seen_calls.append((list(unmatched_stmts), list(unmatched_xeros)))
        # Tell the matcher: stmt 2 maps to xero 12 with high confidence.
        return [{
            "statement_invoice_id": 2,
            "xero_invoice_id": 12,
            "confidence": 0.92,
            "reasoning": "Claude paired these",
        }]

    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0), _stmt(2, "WEIRD-XX", 200.0)],
        [_xero(11, "INV-001", 100.0), _xero(12, "TOTALLY-OTHER", 200.0)],
        fuzzy_hook=hook,
    )
    assert len(seen_calls) == 1
    stmts_in, xeros_in = seen_calls[0]
    # Hook only saw the leftover pair.
    assert [s["id"] for s in stmts_in] == [2]
    assert [x["id"] for x in xeros_in] == [12]
    row = _by_pair(out["results"])[(2, 12)]
    assert row["match_method"] == matcher.METHOD_CLAUDE
    assert row["confidence"] == 0.92


def test_fuzzy_hook_low_confidence_rows_are_rejected():
    def hook(stmts, xeros):
        return [{
            "statement_invoice_id": 2,
            "xero_invoice_id": 12,
            "confidence": 0.5,  # below 0.75 floor
            "reasoning": "weak guess",
        }]

    out = matcher.match_invoices(
        [_stmt(1, "INV-001", 100.0), _stmt(2, "WEIRD-XX", 200.0)],
        [_xero(11, "INV-001", 100.0), _xero(12, "TOTALLY-OTHER", 200.0)],
        fuzzy_hook=hook,
    )
    statuses = {(r["statement_invoice_id"], r["xero_invoice_id"]): r["match_status"]
                for r in out["results"]}
    # Hook row rejected -> stmt 2 and xero 12 fall through as unmatched.
    assert statuses[(2, None)] == matcher.MISSING_FROM_XERO
    assert statuses[(None, 12)] == matcher.MISSING_FROM_STATEMENT


def test_realistic_batch_hits_85_percent_auto_match():
    # 20 invoices: 17 clean exact, 1 fuzzy, 2 anomalies.
    stmts, xeros = [], []
    for i in range(1, 18):
        stmts.append(_stmt(i, f"INV-2026-{i:03}", 100.0 + i))
        xeros.append(_xero(100 + i, f"INV-2026-{i:03}", 100.0 + i))
    # 1 fuzzy (edit distance 1)
    stmts.append(_stmt(18, "INV-2026-018", 50.0))
    xeros.append(_xero(118, "INV-2026-019", 50.0))  # last digit differs by 1
    # 1 missing from xero, 1 missing from statement (anomalies)
    stmts.append(_stmt(19, "INV-ONLY-STMT", 25.0))
    xeros.append(_xero(119, "INV-ONLY-XERO", 25.0))

    out = matcher.match_invoices(stmts, xeros)
    matched = [r for r in out["results"] if r["match_status"] == matcher.MATCHED]
    # 17 exact + 1 fuzzy = 18 matches out of 20 inputs per side -> 90%.
    assert len(matched) >= 18
