const { default: mongoose } = require("mongoose");

const StatementsSchema = new mongoose.Schema(
    {
        tenant: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "XeroTenants",
            index: true
        },
        vendor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vendor",
        },
        file: {
            type: String,
        },
        invoiceIssueDate: {
            type: Date,
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

);
const Statements = mongoose.model("Statements", StatementsSchema);
module.exports = Statements;
