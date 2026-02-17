const mongoose = require("mongoose");

const xeroTenantsSchema = new mongoose.Schema({
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
        },
        scope: { type: String } // Scopes actually granted by Xero (set on connect/refresh)
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
xeroTenantsSchema.pre('save', function(next) {
    this.modifiedLast = Date.now();
    next();
});

const XeroTenants = mongoose.model("XeroTenants", xeroTenantsSchema);

module.exports = XeroTenants;
