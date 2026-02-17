const { mongoose } = require("mongoose");

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
        lastInvoiceMissCheck: {
            type: Date,
            default: Date.now,
        },
    },

);
const Vendor = mongoose.model("Vendor", vendorSchema, "vendors");
module.exports = Vendor;
