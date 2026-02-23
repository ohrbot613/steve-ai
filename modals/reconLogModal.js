const mongoose = require("mongoose");

const reconLogSchema = new mongoose.Schema({
    ranAt: { type: Date, default: Date.now },
    durationMs: { type: Number, default: null },
    newInvoicesFetched: { type: Number, default: 0 },
    invoicesSaved: { type: Number, default: 0 },
    matchesWritten: { type: Number, default: 0 },
    error: { type: String, default: null },
});

const ReconLog = mongoose.model("ReconLog", reconLogSchema);
module.exports = ReconLog;
