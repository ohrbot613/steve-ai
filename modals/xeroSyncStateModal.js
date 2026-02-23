const mongoose = require("mongoose");

const xeroSyncStateSchema = new mongoose.Schema({
    lastPolledAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    modifiedLast: { type: Date, default: Date.now },
});

const XeroSyncState = mongoose.model("XeroSyncState", xeroSyncStateSchema);
module.exports = XeroSyncState;
