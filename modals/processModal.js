const mongoose = require("mongoose");

const processSchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: ['pending', 'in_progress', 'completed', 'failed'],
            default: 'pending',
            index: true
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            index: true
        },
        processId: {
            type: [String],
            default: [],
            index: true
        },
        description: {
            type: String,
            default: null
        },
        createdAt: {
            type: Date,
            default: Date.now,
            index: true
        },
    },
    {
        timestamps: true // Adds createdAt and updatedAt automatically
    }
);

// Indexes for faster lookups (user, status, processId, createdAt already have index: true on their fields)
processSchema.index({ processId: 1 });
processSchema.index({ status: 1 });
processSchema.index({ process: 1 });
processSchema.index({ createdAt: -1 });

const Process = mongoose.model("Process", processSchema);
module.exports = Process;
