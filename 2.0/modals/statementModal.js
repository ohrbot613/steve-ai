const mongoose = require("mongoose");
const conn = require("../db");

const statementSchema = new mongoose.Schema(
    {
        contactId: {
            type: String,
            default: null,
            index: true,
        },
        file: {
            type: String,
            default: null,
        },
        dateOnFile: {
            type: Date,
            default: null,
            index: true,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        modifiedLast: {
            type: Date,
            default: Date.now,
        },
    }
);

const Statement = conn.model("Statement", statementSchema, "statements-2.0");
module.exports = Statement;
