const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        threadId: {
            type: String,
            required: true,
            index: true
        },
        role: {
            type: String,
            required: true,
            enum: ['user', 'assistant', 'system']
        },
        content: {
            type: String,
            required: true
        },
        index: {
            type: Number,
            default: null
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
            toolCalls: {
                type: [mongoose.Schema.Types.Mixed],
                default: undefined
            },
            usage: {
                type: mongoose.Schema.Types.Mixed,
                default: undefined
            }
        }
    },
    {
        timestamps: true // Adds createdAt and updatedAt automatically
    }
);

// Compound index for chronological retrieval of messages within a thread
messageSchema.index({ threadId: 1, createdAt: 1 });
// Compound index for ordering by conversation position
messageSchema.index({ threadId: 1, index: 1 });

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;
