const mongoose = require("mongoose");
const conn = require("../db");

const teamSchema = new mongoose.Schema({
    tenantId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    tenantName: {
        type: String,
        required: true
    },
    authData: {
        accessToken: {
            type: String,
            required: true
        },
        refreshToken: {
            type: String,
            required: true
        },
        expiryTime: {
            type: Date,
            required: true
        }
    },
    lastXeroLookup: {
        type: Date,
        default: null
    },
    bankBalance: {
        type: Number,
        default: null
    },
    lastBankBalanceUpdate: {
        type: Date,
        default: null
    },
    reloading: {
        type: Boolean,
        default: false
    },
    updateInXeroInProgress: {
        type: Boolean,
        default: false
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

teamSchema.pre("save", function (next) {
    this.modifiedLast = Date.now();
    next();
});

const Team = conn.model("Team", teamSchema, "teams-2.0");

module.exports = Team;
