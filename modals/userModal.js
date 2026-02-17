const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    tenant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "XeroTenants"
    },
    resetToken: { type: String, default: null },
    resetTokenTTL: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

module.exports = User;
