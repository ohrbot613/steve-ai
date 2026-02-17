const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema({
    projectReference: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "XeroTenants",
        required: true,
        index: true
    },
    status: {
        type: Boolean,
        default: false
    },
    billinglogic: {
        type: {
            type: String,
            enum: ["FIXED", "COST_PLUS", "PERCENTAGE", "RETAINER"]
        },
        amount: {
            type: Number
        },
        currency: {
            type: String // Stored as code (e.g., USD, EUR, NGN, etc.)
        }
    },
    totalRevenue: {
        type: Number,
        default: 0 // The amount of revenue actually recognized in the invoices
    },
    totalCosts: {
        type: Number,
        default: 0
    },
    expectedRevenue: {
        type: Number,
        default: 0 // What is calculated based on the billing logic (the markup logic)
    },
    modifiedLast: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Update the modifiedLast field before saving
projectSchema.pre('save', function(next) {
    this.modifiedLast = Date.now();
    next();
});

const Project = mongoose.model("Project", projectSchema);

module.exports = Project;
