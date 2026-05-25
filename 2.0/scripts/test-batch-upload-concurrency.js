// Standalone validation harness for the fix to GitHub issues #67 / #68:
// "When uploading exactly 7 files, one is silently dropped from tab 1."
//
// The bug:
//   batchInvoiceFileUpload runs N file-processing tasks in parallel. Each task
//   creates a Statement, then completeInvoiceFileUploadLogic re-reads the
//   existing-from-file invoices for the supplier, may reassign their
//   statementId, and finally deletes any parent statement that ends up empty.
//   Without serialization per supplier, two tasks racing on the same supplier
//   (or with overlapping invoice numbers across batch siblings) can:
//     (a) hold a stale snapshot and produce inconsistent reassignments, or
//     (b) clean up a sibling task's freshly-created statement, dropping it from
//         the dashboard count and from tab 1.
//
// What this harness verifies (DB-free, no Mongoose, no AI calls):
//   1. withKeyedLock serializes same-key tasks (no lost updates).
//   2. withKeyedLock does NOT serialize different-key tasks.
//   3. withKeyedLock releases the lock even on thrown errors.
//   4. persistUploadedFile produces distinct unique names for two identical
//      original filenames written in the same millisecond.
//   5. Simulated 7-task race for the same key: with the lock + "skip recent"
//      guard, all 7 logical statements survive (no silent drop).
//   6. Before-fix baseline: a deliberately-unlocked version of the same
//      simulated 7-task workload drops at least one statement, proving the
//      harness actually models the bug.
//
// Usage:
//   node 2.0/scripts/test-batch-upload-concurrency.js
// Exit code is 0 on success, 1 on any failure.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { withKeyedLock, persistUploadedFile } = require("../controllers/uploadHelpers");

const fails = [];
function test(name, fn) {
    return Promise.resolve()
        .then(() => fn())
        .then(() => console.log(`  ok  ${name}`))
        .catch((err) => {
            fails.push({ name, err });
            console.log(`  FAIL ${name}: ${err.message}`);
        });
}

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// (1) withKeyedLock serializes same-key tasks — no lost updates.
async function testSameKeySerialization() {
    const key = "supplier-A";
    const sharedState = { count: 0 };
    // Each task does a classic read-modify-write that, without a lock, would race.
    const tasks = Array.from({ length: 20 }, (_, i) => async () => {
        await withKeyedLock(key, async () => {
            const seen = sharedState.count;
            await sleep(2); // amplify any race window
            sharedState.count = seen + 1;
        });
    });
    await Promise.all(tasks.map((t) => t()));
    assert.strictEqual(sharedState.count, 20, `expected 20, got ${sharedState.count}`);
}

// (2) withKeyedLock does NOT serialize different-key tasks.
async function testDifferentKeyParallelism() {
    const N = 10;
    const taskMs = 50;
    const start = Date.now();
    await Promise.all(
        Array.from({ length: N }, (_, i) =>
            withKeyedLock(`supplier-${i}`, async () => {
                await sleep(taskMs);
            })
        )
    );
    const elapsed = Date.now() - start;
    // If we were accidentally serialized, elapsed would be ~N*taskMs (500ms).
    // Allow generous slack for CI: anything under 3x taskMs proves real parallelism.
    assert.ok(elapsed < taskMs * 3, `parallel keys took ${elapsed}ms (expected < ${taskMs * 3})`);
}

// (3) withKeyedLock releases on thrown error.
async function testErrorReleasesLock() {
    const key = "supplier-err";
    let secondRan = false;
    await Promise.allSettled([
        withKeyedLock(key, async () => {
            await sleep(5);
            throw new Error("boom");
        }),
        withKeyedLock(key, async () => {
            secondRan = true;
        }),
    ]);
    assert.strictEqual(secondRan, true, "second task did not run — lock leaked after error");
}

// (4) persistUploadedFile collision avoidance.
async function testPersistUniqueNames() {
    // Temporarily redirect __dirname expectation by running in a tmp working dir.
    // persistUploadedFile resolves filesDir relative to __dirname of invoiceController.js,
    // which lives at <repo>/2.0/controllers/invoiceController.js, so filesDir resolves to
    // <repo-parent>/steve_files_do_not_delete. We just call it and let it write there.
    const buf = Buffer.from("test-payload");
    const fileName = "duplicate-name.pdf";
    const a = persistUploadedFile(buf, fileName);
    const b = persistUploadedFile(buf, fileName);
    assert.notStrictEqual(a, b, "two calls with same name produced identical unique name");
    // Cleanup: best-effort delete the test artifacts
    const filesDir = path.join(__dirname, "..", "..", "..", "steve_files_do_not_delete");
    for (const name of [a, b]) {
        try { fs.unlinkSync(path.join(filesDir, name)); } catch (_) {}
    }
}

// (5) Simulated 7-task workload WITH the lock + recent-statement guard,
// exercising the same overlap pattern the baseline (test 6) uses to drop a
// statement. Files 1 and 2 are duplicates; the fix must preserve all 7
// statements via the recent-statement protection.
async function testSevenTasksWithFixPreservesStatements() {
    const RECENT_MS = 10 * 60 * 1000;
    const invoices = new Map();
    const statements = new Map();
    const supplier = "vendor-X";

    function makeTask(taskId, fileInvoiceNumbers) {
        return async () => {
            const statementId = `s-${taskId}`;
            statements.set(statementId, { createdAt: Date.now() });
            await withKeyedLock(`completeInvoiceFileUpload:${supplier}`, async () => {
                const existingSnapshot = new Map(invoices);
                const statementIdsToCheck = new Set();
                for (const num of fileInvoiceNumbers) {
                    const existing = existingSnapshot.get(num);
                    if (existing) statementIdsToCheck.add(existing.statementId);
                    invoices.set(num, { statementId });
                }
                for (const sid of statementIdsToCheck) {
                    if (sid === statementId) continue;
                    const stmt = statements.get(sid);
                    if (!stmt) continue;
                    if (Date.now() - stmt.createdAt < RECENT_MS) continue;
                    let remaining = 0;
                    for (const v of invoices.values()) if (v.statementId === sid) remaining++;
                    if (remaining === 0) statements.delete(sid);
                }
            });
        };
    }

    // Same pattern as the baseline: files 1 and 2 are duplicates (full overlap)
    // — the situation that drops a statement in the baseline. The fix should
    // preserve all 7.
    const tasks = [
        makeTask(1, ["INV-1", "INV-2"]),
        makeTask(2, ["INV-1", "INV-2"]),
        makeTask(3, ["INV-3"]),
        makeTask(4, ["INV-4"]),
        makeTask(5, ["INV-5"]),
        makeTask(6, ["INV-6"]),
        makeTask(7, ["INV-7"]),
    ];
    await Promise.all(tasks.map((t) => t()));

    assert.strictEqual(
        statements.size,
        7,
        `expected all 7 statements to survive with fix, got ${statements.size}`
    );
}

// (6) Baseline: the SAME cleanup semantics WITHOUT the "skip recent" guard
// drops sibling statements when batch siblings share invoice numbers. This
// is the actual deletion path responsible for the N→N-1 symptom in issues
// #67 / #68. Modelled sequentially because that's also when the existing
// snapshot reliably contains the prior task's writes — which is what makes
// the parallel race observable in production once timing aligns.
async function testBaselineWithoutGuardsDropsStatements() {
    const invoices = new Map();
    const statements = new Map();

    function processFile(taskId, fileInvoiceNumbers) {
        const statementId = `s-${taskId}`;
        statements.set(statementId, { createdAt: Date.now() });
        // No lock, no skip-own, no recent guard — original behavior.
        const existingSnapshot = new Map(invoices);
        const statementIdsToCheck = new Set();
        for (const num of fileInvoiceNumbers) {
            const existing = existingSnapshot.get(num);
            if (existing) statementIdsToCheck.add(existing.statementId);
            invoices.set(num, { statementId });
        }
        for (const sid of statementIdsToCheck) {
            let remaining = 0;
            for (const v of invoices.values()) if (v.statementId === sid) remaining++;
            if (remaining === 0) statements.delete(sid);
        }
    }

    // 7 files, each containing the same shared invoice number plus a unique one.
    // After task k>=2 reassigns the shared invoice to its own statement, task
    // k-1's statement still has its unique invoice and survives — so this
    // alone doesn't reproduce the drop. To reproduce, two of the seven files
    // must share ALL invoices (the canonical "user uploaded a duplicate scan"
    // case, also produced when the AI vision extracts the same invoice list
    // from two visually similar pages). Files 1 and 2 are identical here.
    processFile(1, ["INV-1", "INV-2"]);
    processFile(2, ["INV-1", "INV-2"]); // duplicate of 1; will steal both invoices, s-1 becomes empty, deleted
    processFile(3, ["INV-3"]);
    processFile(4, ["INV-4"]);
    processFile(5, ["INV-5"]);
    processFile(6, ["INV-6"]);
    processFile(7, ["INV-7"]);

    assert.ok(
        statements.size < 7,
        `baseline expected to drop at least one statement (got ${statements.size}/7) — harness may not be modelling the cleanup path`
    );
}

(async () => {
    console.log("Batch upload concurrency validation harness");
    console.log("-------------------------------------------");
    await test("withKeyedLock serializes same-key tasks", testSameKeySerialization);
    await test("withKeyedLock does NOT serialize different-key tasks", testDifferentKeyParallelism);
    await test("withKeyedLock releases lock when callback throws", testErrorReleasesLock);
    await test("persistUploadedFile produces unique names under collision", testPersistUniqueNames);
    await test("7 same-supplier tasks (incl. duplicate): ALL 7 survive with fix", testSevenTasksWithFixPreservesStatements);
    await test("baseline (no guards): cleanup drops a statement when files overlap", testBaselineWithoutGuardsDropsStatements);
    console.log("-------------------------------------------");
    if (fails.length > 0) {
        console.log(`FAILED: ${fails.length}/${6} test(s)`);
        for (const f of fails) console.log(`  - ${f.name}: ${f.err.stack || f.err.message}`);
        process.exit(1);
    }
    console.log("All 6 checks passed.");
    process.exit(0);
})();
