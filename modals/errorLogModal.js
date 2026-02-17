const mongoose = require("mongoose");

const errorLogSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true
    },
    errorTrace: {
        type: String,
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true
    },
    file: {
        type: String
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "XeroTenants",
        index: true
    },
    location: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
});

const ErrorLog = mongoose.model("ErrorLog", errorLogSchema);

module.exports = ErrorLog;
