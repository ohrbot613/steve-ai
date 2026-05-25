// Small, dependency-free upload helpers extracted from invoiceController.js so
// they can be exercised by the standalone harness at
// 2.0/scripts/test-batch-upload-concurrency.js without pulling in mongoose,
// multer, etc. Keep this file in the same directory as invoiceController.js so
// __dirname-relative paths (steve_files_do_not_delete) resolve identically.

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

// In-process async mutex keyed by a string. Used to serialize the read-modify-write
// section of completeInvoiceFileUploadLogic per supplier (contactId): without this,
// two concurrent batch tasks sharing a supplier reassign each other's invoices and
// the "delete parent statement if empty" cleanup drops one statement from the batch
// (see issues #67 / #68 — N files in, N-1 visible in tab 1).
const _keyedLocks = new Map();
async function withKeyedLock(key, fn) {
    const k = String(key || "");
    if (!k) return await fn();
    const prev = _keyedLocks.get(k) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const chained = prev.then(() => gate);
    _keyedLocks.set(k, chained);
    try {
        await prev;
        return await fn();
    } finally {
        release();
        if (_keyedLocks.get(k) === chained) {
            _keyedLocks.delete(k);
        }
    }
}

function persistUploadedFile(buffer, fileName) {
    const filesDir = path.join(__dirname, "..", "..", "..", "steve_files_do_not_delete");
    if (!fs.existsSync(filesDir)) {
        fs.mkdirSync(filesDir, { recursive: true });
    }
    const safeName = (fileName || "statement").replace(/[^a-zA-Z0-9._-]/g, "_");
    // Random suffix prevents collisions when two files with the same originalname
    // hit this function in the same millisecond (concurrent batch upload).
    const uniqueName = `${Date.now()}-${randomUUID()}-${safeName}`;
    fs.writeFileSync(path.join(filesDir, uniqueName), buffer);
    return uniqueName;
}

module.exports = {
    withKeyedLock,
    persistUploadedFile,
};
