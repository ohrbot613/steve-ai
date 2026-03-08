const mongoose = require("mongoose");
const conn = require("../db");

const vendorSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true
        },
        xeroId: {
            type: String,
            required: true
        },
        email: {
            type: String,
            default: null
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        team: {
            type: String,
            default: null
        },
        supplier: {
            type: Boolean,
            default: false
        },
        status: {
            type: String,
            enum: ["active", "inactive"],
            default: "active"
        },
        isDeleted: {
            type: Boolean,
            default: false
        },   
        modifiedLast: {
            type: Date,
            default: Date.now,
        },
        paymentTerms: {
            day: {
                type: Number,
                default: null
            },
            type: {
                type: String,
                default: null
            },
        },
        currency: {
            type: String,
            default: "unknown"
        },
        contactedAt: {
            type: [
                {
                    date: { type: Date, required: true },
                    invoiceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Invoice" }],
                },
            ],
            default: [],
        },
    },

);
vendorSchema.index({ xeroId: 1, isDeleted: 1, supplier: 1 });
vendorSchema.index({ isDeleted: 1 });
const Vendor = conn.model("Vendor", vendorSchema, "vendors-2.0");
module.exports = Vendor;
