const mongoose = require("mongoose");
const conn = require("../db");

const processLogSchema = new mongoose.Schema(
    {
        description: {
            type: String,
            required: true,
        },
        ids: {
            type: [mongoose.Schema.Types.Mixed],
            default: [],
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: false }
);

const ProcessLog = conn.model("ProcessLog", processLogSchema, "process-logs-2.0");
module.exports = ProcessLog;
