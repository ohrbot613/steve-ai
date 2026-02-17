const mongoose = require("mongoose");

const exceptionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ["Cost Without Revenue", "Margin Anomaly", "Duplicate Invoice", "Missing Supplier Invoice"],
        required: true,
        index: true
    },
    quantifiedImpact: {
        type: Number
    },
    projectReference: {
        type: String,
        ref: "Project",
        required: true,
        index: true
    },
    confidenceScore: {
        type: Number,
        min: 0,
        max: 100
    },
    resolutionStatus: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Exception = mongoose.model("Exception", exceptionSchema);

module.exports = Exception;
