require('dotenv').config();
const mongoose = require("mongoose");
const XeroConfig = require("../modals/xeroConfigModal");
const XeroTenants = require("../modals/xeroTenantsModal");
const axios = require("axios");

/**
 * Migration script to transform XeroConfig documents to xeroTenants format
 * 
 * This script:
 * 1. Reads all XeroConfig documents (typically only one exists)
 * 2. Transforms data to xeroTenants format
 * 3. Fetches tenant name from Xero API if possible
 * 4. Creates xeroTenants documents
 * 
 * Run with: node migrations/migrateXeroConfigToTenants.js
 */

async function fetchTenantName(accessToken, tenantId) {
    try {
        const response = await axios.get("https://api.xero.com/api.xro/2.0/Organisation", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });
        
        if (response.data && response.data.Organisations && response.data.Organisations.length > 0) {
            return response.data.Organisations[0].Name || `Tenant ${tenantId}`;
        }
    } catch (error) {
        console.warn(`Could not fetch tenant name from Xero API: ${error.message}`);
    }
    return `Tenant ${tenantId}`;
}

async function migrateXeroConfigToTenants() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error("MONGO_URI environment variable is not set");
        }

        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log("MongoDB connected successfully");

        // Find all XeroConfig documents
        const xeroConfigs = await XeroConfig.find({});
        console.log(`Found ${xeroConfigs.length} XeroConfig document(s) to migrate`);

        if (xeroConfigs.length === 0) {
            console.log("No XeroConfig documents found. Migration complete (nothing to migrate).");
            await mongoose.disconnect();
            return;
        }

        // Transform each XeroConfig to XeroTenants
        for (const config of xeroConfigs) {
            console.log(`Migrating XeroConfig for tenantId: ${config.tenantId}`);

            // Check if tenant already exists
            const existingTenant = await XeroTenants.findOne({ tenantId: config.tenantId });
            if (existingTenant) {
                console.log(`Tenant ${config.tenantId} already exists. Skipping...`);
                continue;
            }

            // Fetch tenant name from Xero API if possible
            let tenantName = `Tenant ${config.tenantId}`;
            try {
                tenantName = await fetchTenantName(config.access_token, config.tenantId);
            } catch (error) {
                console.warn(`Could not fetch tenant name, using default: ${tenantName}`);
            }

            // Create new XeroTenants document
            const xeroTenant = new XeroTenants({
                tenantId: config.tenantId,
                tenantName: tenantName,
                authData: {
                    accessToken: config.access_token,
                    refreshToken: config.refresh_token,
                    expiryTime: config.expires_at,
                },
                modifiedLast: config.updatedAt || config.createdAt,
                createdAt: config.createdAt,
            });

            await xeroTenant.save();
            console.log(`✅ Successfully migrated tenant: ${tenantName} (${config.tenantId})`);
        }

        console.log("\n✅ Migration completed successfully!");
        console.log("Note: XeroConfig documents have been preserved. You can delete them after verifying the migration.");

    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("MongoDB connection closed");
    }
}

// Run migration
migrateXeroConfigToTenants();
