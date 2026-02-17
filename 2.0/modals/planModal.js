const mongoose = require("mongoose");
const conn = require("../db");

const stepSchema = new mongoose.Schema(
    {
        stepNumber: {
            type: Number,
            required: true,
        },
        description: {
            type: String,
            required: true,
        },
        tool: {
            type: String,
            default: null,
        },
        status: {
            type: String,
            enum: ["pending", "executing", "completed", "failed", "skipped"],
            default: "pending",
        },
        result: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        error: {
            type: String,
            default: null,
        },
        startedAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    { _id: false }
);

const planSchema = new mongoose.Schema(
    {
        userId: {
            type: String,
            required: true,
            index: true,
        },
        goal: {
            type: String,
            required: true,
        },
        steps: {
            type: [stepSchema],
            required: true,
            validate: {
                validator: function (v) {
                    return v && v.length > 0;
                },
                message: "Plan must have at least one step",
            },
        },
        status: {
            type: String,
            enum: ["pending", "executing", "paused", "completed", "failed"],
            default: "pending",
            required: true,
        },
        currentStepIndex: {
            type: Number,
            default: 0,
        },
        startedAt: {
            type: Date,
            default: null,
        },
        pausedAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: { createdAt: true, updatedAt: "modifiedLast" } }
);

planSchema.index({ userId: 1, status: 1 });

const Plan = conn.model("Plan", planSchema, "plans-2.0");
module.exports = Plan;
