const mongoose = require("mongoose");
const conn = require("../db");

const invoiceSchema = new mongoose.Schema(
    {
        invoiceNumber: {
            type: String,
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            default: null,
        },
        status: {
            type: String,
            enum: ["paid", "unpaid"],
            default: "unpaid",
        },
        jobNumber: {
            type: String,
            default: null,
        },
        description: {
            type: String,
            default: null,
        },
        contactId: {
            type: String,
            default: null,
        },
        currency: {
            type: String,
            default: null,
        },
        date: {
            type: Date,
            default: null,
        },
        dueDate: {
            type: Date,
            default: null,
        },
        fromXero: {
            type: Boolean,
            default: false,
        },
        modifiedLast: {
            type: Date,
            default: Date.now,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        statementId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            ref: "Statement",
        },
    }
);

// Speeds up "qualifying suppliers" query: distinct contactId where isDeleted ne true and (unpaid or fromXero false)
invoiceSchema.index({ isDeleted: 1, status: 1, fromXero: 1 });
invoiceSchema.index({ contactId: 1, isDeleted: 1 });

const Invoice = conn.model("Invoice", invoiceSchema, "invoices-2.0");
module.exports = Invoice;
