const mongoose = require("mongoose");

const customerInvoiceSchema = new mongoose.Schema(
    {
        // Xero Invoice ID
        xeroInvoiceId: {
            type: String,
            required: true,
            index: true,
        },
        
        // Invoice Number from Xero
        invoiceNumber: {
            type: String,
            index: true,
        },
        
        // Full Xero invoice data (stored as Mixed type to preserve all fields)
        xeroInvoiceData: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        
        // Common fields extracted for easier querying
        reference: {
            type: String,
            index: true,
        },
        
        total: {
            type: Number,
        },
        
        subTotal: {
            type: Number,
        },
        
        dateString: {
            type: String,
        },
        
        invoiceDate: {
            type: Date,
        },
        
        type: {
            type: String, // ACCREC, ACCPAY, etc.
        },
        
        contactId: {
            type: String,
        },
        
        contactName: {
            type: String,
        },
        
        // Ranking metadata (stored when invoice is part of a job match)
        amountDiff: {
            type: Number,
        },
        
        dateDiff: {
            type: Number, // in days
        },
        
        score: {
            type: Number, // combined ranking score
        },
        
        matchPercentage: {
            type: Number, // Match quality as percentage (0-100), where 100% = perfect match
            min: 0,
            max: 100,
        },
        
        addedAt: {
            type: Date,
            default: Date.now,
        },
        
        isDeleted: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt automatically
    }
);

// Index for faster lookups
customerInvoiceSchema.index({ xeroInvoiceId: 1 });
customerInvoiceSchema.index({ invoiceNumber: 1 });
customerInvoiceSchema.index({ reference: 1 });

const CustomerInvoice = mongoose.model("CustomerInvoice", customerInvoiceSchema);
module.exports = CustomerInvoice;
