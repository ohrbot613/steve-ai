const mongoose = require("mongoose");

const threadSchema = new mongoose.Schema(
    {
        threadId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        }
    },
    {
        timestamps: true // Adds createdAt and updatedAt automatically
    }
);

// Compound index for ownership validation queries
threadSchema.index({ threadId: 1, userId: 1 });

const Thread = mongoose.model("Thread", threadSchema);
module.exports = Thread;
