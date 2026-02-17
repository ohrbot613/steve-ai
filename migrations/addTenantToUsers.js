require('dotenv').config();
const mongoose = require("mongoose");
const User = require("../modals/userModal");
const XeroConfig = require("../modals/xeroConfigModal");
const XeroTenants = require("../modals/xeroTenantsModal");

/**
 * Migration script to add tenant field to existing user documents
 * 
 * This script:
 * 1. Finds the default tenant (from XeroConfig or XeroTenants)
 * 2. Updates all user documents with the tenant field
 * 3. Uses the first available tenant as default
 * 
 * Run with: node migrations/addTenantToUsers.js
 */

async function addTenantToUsers() {
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

        // Find the default tenant
        // First try to find from XeroTenants
        let defaultTenant = await XeroTenants.findOne({});
        
        // If no XeroTenants exists, try to get from XeroConfig and create XeroTenants
        if (!defaultTenant) {
            console.log("No XeroTenants found. Checking XeroConfig...");
            const xeroConfig = await XeroConfig.findOne({});
            
            if (xeroConfig) {
                // Create XeroTenants from XeroConfig
                defaultTenant = await XeroTenants.findOne({ tenantId: xeroConfig.tenantId });
                
                if (!defaultTenant) {
                    console.log("Creating XeroTenants from XeroConfig...");
                    defaultTenant = new XeroTenants({
                        tenantId: xeroConfig.tenantId,
                        tenantName: `Tenant ${xeroConfig.tenantId}`,
                        authData: {
                            accessToken: xeroConfig.access_token,
                            refreshToken: xeroConfig.refresh_token,
                            expiryTime: xeroConfig.expires_at,
                        },
                        modifiedLast: xeroConfig.updatedAt || xeroConfig.createdAt,
                        createdAt: xeroConfig.createdAt,
                    });
                    await defaultTenant.save();
                    console.log(`✅ Created XeroTenants from XeroConfig: ${defaultTenant.tenantId}`);
                }
            }
        }

        if (!defaultTenant) {
            console.warn("⚠️  No tenant found. Users will be updated without tenant field.");
            console.warn("   You may need to run migrateXeroConfigToTenants.js first, or create tenants manually.");
        } else {
            console.log(`Using tenant: ${defaultTenant.tenantName} (${defaultTenant._id})`);
        }

        // Find all users without tenant field
        const users = await User.find({ 
            $or: [
                { tenant: { $exists: false } },
                { tenant: null }
            ]
        });
        console.log(`Found ${users.length} user(s) without tenant field`);

        if (users.length === 0) {
            console.log("All users already have tenant field. Migration complete.");
            await mongoose.disconnect();
            return;
        }

        let updatedCount = 0;
        let skippedCount = 0;

        // Update each user
        for (const user of users) {
            try {
                if (defaultTenant) {
                    user.tenant = defaultTenant._id;
                    await user.save();
                    updatedCount++;
                    console.log(`✅ Updated user: ${user.email} (${user._id})`);
                } else {
                    console.log(`⏭️  Skipping user ${user.email}: no tenant available`);
                    skippedCount++;
                }
            } catch (error) {
                console.error(`❌ Error updating user ${user._id}:`, error.message);
            }
        }

        console.log("\n📊 Migration Summary:");
        console.log(`   ✅ Updated: ${updatedCount}`);
        console.log(`   ⏭️  Skipped: ${skippedCount}`);
        console.log("\n✅ Migration completed!");

    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("MongoDB connection closed");
    }
}

// Run migration
addTenantToUsers();
