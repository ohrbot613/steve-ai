require('dotenv').config();
const mongoose = require("mongoose");
const Invoices = require("../modals/invoiceModal");
const SupplierInvoice = require("../modals/supplierInvoiceModal");
const { v4: uuidv4 } = require("uuid");

/**
 * Migration script to transform Invoices documents to supplierInvoices format
 * 
 * This script:
 * 1. Reads all Invoices documents
 * 2. Transforms data to supplierInvoices format
 * 3. Maps fields according to the new schema
 * 4. Sets default status to "Unreconciled" (requires manual review)
 * 5. Generates invoiceId (UUID)
 * 6. Maps supplier to vendorId
 * 
 * Note: projectReference needs to be set manually or derived from project matching logic
 * 
 * Run with: node migrations/migrateInvoicesToSupplierInvoices.js
 */

async function migrateInvoicesToSupplierInvoices() {
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

        // Find all Invoices documents (excluding deleted ones)
        const invoices = await Invoices.find({ isDeleted: { $ne: true } });
        console.log(`Found ${invoices.length} invoice(s) to migrate`);

        if (invoices.length === 0) {
            console.log("No invoices found. Migration complete (nothing to migrate).");
            await mongoose.disconnect();
            return;
        }

        let successCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        // Transform each Invoice to SupplierInvoice
        for (const invoice of invoices) {
            try {
                // Skip if invoiceNumber is missing
                if (!invoice.invoiceNumber) {
                    console.warn(`⚠️  Skipping invoice ${invoice._id}: missing invoiceNumber`);
                    skippedCount++;
                    continue;
                }

                // Skip if supplier is missing
                if (!invoice.supplier) {
                    console.warn(`⚠️  Skipping invoice ${invoice._id}: missing supplier reference`);
                    skippedCount++;
                    continue;
                }

                // Skip if amount is missing
                if (!invoice.amount || !invoice.amount.amount) {
                    console.warn(`⚠️  Skipping invoice ${invoice._id}: missing amount`);
                    skippedCount++;
                    continue;
                }

                // Check if supplierInvoice already exists (by invoiceNumber and vendorId)
                const existingInvoice = await SupplierInvoice.findOne({
                    invoiceNumber: invoice.invoiceNumber,
                    vendorId: invoice.supplier
                });

                if (existingInvoice) {
                    console.log(`⏭️  Invoice ${invoice.invoiceNumber} already migrated. Skipping...`);
                    skippedCount++;
                    continue;
                }

                // Generate invoiceId (UUID)
                const invoiceId = uuidv4();

                // Create new SupplierInvoice document
                const supplierInvoice = new SupplierInvoice({
                    invoiceId: invoiceId,
                    invoiceNumber: invoice.invoiceNumber,
                    projectReference: null, // Needs to be set manually or derived from project matching
                    vendorId: invoice.supplier,
                    status: "Unreconciled", // Default status - requires manual review
                    amount: invoice.amount.amount,
                    currency: invoice.currency || "USD",
                    Date: invoice.invoiceDate || invoice.invoiceXeroDate || invoice.addedAt,
                    modifiedLast: invoice.addedAt,
                    createdAt: invoice.addedAt,
                });

                await supplierInvoice.save();
                successCount++;
                console.log(`✅ Migrated invoice: ${invoice.invoiceNumber} (${invoiceId})`);

            } catch (error) {
                console.error(`❌ Error migrating invoice ${invoice._id}:`, error.message);
                errorCount++;
            }
        }

        console.log("\n📊 Migration Summary:");
        console.log(`   ✅ Successfully migrated: ${successCount}`);
        console.log(`   ⏭️  Skipped: ${skippedCount}`);
        console.log(`   ❌ Errors: ${errorCount}`);
        console.log("\n✅ Migration completed!");
        console.log("Note: Invoices documents have been preserved. You can delete them after verifying the migration.");
        console.log("⚠️  Important: projectReference fields need to be set manually or through project matching logic.");

    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("MongoDB connection closed");
    }
}

// Run migration
migrateInvoicesToSupplierInvoices();
