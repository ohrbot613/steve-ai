/**
 * Migration Script: Old Invoice/Job Format -> New SupplierInvoice/CustomerInvoice Format
 * 
 * This script migrates data from the old database format to the new format:
 * 
 * Schema Migrations:
 * ─────────────────────────────────────────────────────────────────────────────
 * OLD FORMAT                          NEW FORMAT
 * ─────────────────────────────────────────────────────────────────────────────
 * Invoices                     ->     SupplierInvoices
 * Job                          ->     CustomerInvoice  
 * Supplier                     ->     Vendor
 * Logs (combined table)        ->     Statements (file uploads only)
 *                              ->     Process (actions/status tracking)
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * Key Changes:
 * - Old `Logs` table combined file uploads AND action tracking
 * - New schema splits this into `Statements` (files) and `Process` (actions)
 * - Invoice.log reference now maps to Statement ID
 * 
 * Usage:
 *   node migrations/migrateOldToNew.js --oldDb=<old_mongo_uri> [--newDb=<new_mongo_uri>] [--dry-run]
 * 
 * Options:
 *   --oldDb       MongoDB URI for the old/private database (required)
 *   --newDb       MongoDB URI for the new database (defaults to MONGO_URI in .env)
 *   --dry-run     Run without making changes to see what would be migrated
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.replace('--', '').split('=');
    acc[key] = value || true;
    return acc;
}, {});

const OLD_DB_URI = args.oldDb;
const NEW_DB_URI = args.newDb || process.env.MONGO_URI;
const DRY_RUN = args['dry-run'] || false;

if (!OLD_DB_URI) {
    console.error('❌ Error: --oldDb parameter is required');
    console.error('Usage: node migrations/migrateOldToNew.js --oldDb=<mongodb_uri> [--newDb=<mongodb_uri>] [--dry-run]');
    process.exit(1);
}

if (!NEW_DB_URI) {
    console.error('❌ Error: No new database URI provided. Set MONGO_URI in .env or use --newDb parameter');
    process.exit(1);
}

// ============================================================================
// OLD SCHEMAS (from the private/old database)
// ============================================================================

// Old Invoice Schema (from .old/invoiceModal.js)
const oldInvoiceSchema = new mongoose.Schema({
    invoiceDate: { type: Date },
    invoiceXeroDate: { type: Date },
    invoiceNumber: { type: String, required: true, index: true },
    activityDescription: { type: String, default: null },
    amountXero: {
        type: {
            amount: { type: Number, required: true },
            taxFees: { type: Number, required: true },
        },
    },
    amount: {
        type: {
            amount: { type: Number, required: true },
            taxFees: { type: Number, required: true },
        },
    },
    currency: { type: String, required: true, uppercase: true },
    paymentStatus: { type: String, enum: ["paid", "unpaid"], required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    log: { type: mongoose.Schema.Types.ObjectId, ref: "Statements" },
    addedAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
});

// Old Job Schema (from .old/jobModal.js)
const oldJobSchema = new mongoose.Schema({
    sourceInvoiceNumber: { type: String, required: true, index: true },
    sourceInvoiceId: { type: String, index: true },
    sourceInvoiceData: { type: mongoose.Schema.Types.Mixed },
    contactDetails: { type: mongoose.Schema.Types.Mixed },
    rankedInvoices: [{
        customerInvoice: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerInvoice", required: true },
        rank: { type: Number, required: true },
        amountDiff: { type: Number },
        dateDiff: { type: Number },
        score: { type: Number },
        matchPercentage: { type: Number, min: 0, max: 100 },
    }],
    searchReference: { type: String },
    totalMatches: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'matched', 'completed', 'failed'], default: 'pending' },
    addedAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

// Old Supplier Schema
const oldSupplierSchema = new mongoose.Schema({
    name: { type: String, required: true },
    xeroId: { type: String },
    email: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
});

// Old Logs Schema (combined statements + actions in old format)
const oldLogsSchema = new mongoose.Schema({
    status: { type: String, enum: ['started', 'completed', 'failed'], default: 'started' },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    total: { type: Number, default: 0 },
    unmatched: { type: Number, default: 0 },
    file: { type: String },
    invoiceIssueDate: { type: Date },
    addedAt: { type: Date, default: Date.now },
    isSuperseded: { type: Boolean, default: false },
});

// ============================================================================
// NEW SCHEMAS (for the current database)
// ============================================================================

// New SupplierInvoice Schema
const newSupplierInvoiceSchema = new mongoose.Schema({
    xeroInvoiceId: { type: String, required: false },
    invoiceNumber: { type: String, required: true, index: true },
    projectReference: { type: String, ref: "Project", index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", index: true },
    statementId: { type: mongoose.Schema.Types.ObjectId, ref: "Statements", index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", required: true, index: true },
    paymentStatus: { type: String, enum: ["paid", "unpaid"], required: true },
    status: { type: String, enum: ["Reconciled", "Unreconciled", "Duplicate", "Missing Reference"], required: true },
    vendorAmount: { type: Number, default: null },
    xeroAmount: { type: Number, default: null },
    description: { type: String, default: null },
    vendorCurrency: { type: String, uppercase: true, default: null },
    xeroCurrency: { type: String, uppercase: true, default: null },
    VendorDate: { type: Date, default: null },
    xeroDate: { type: Date, default: null },
    modifiedLast: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
    wasPaidOnTime: { type: Boolean, default: null }
});

// New CustomerInvoice Schema
const newCustomerInvoiceSchema = new mongoose.Schema({
    xeroInvoiceId: { type: String, required: true, index: true },
    invoiceNumber: { type: String, index: true },
    xeroInvoiceData: { type: mongoose.Schema.Types.Mixed, required: true },
    reference: { type: String, index: true },
    total: { type: Number },
    subTotal: { type: Number },
    dateString: { type: String },
    invoiceDate: { type: Date },
    type: { type: String },
    contactId: { type: String },
    contactName: { type: String },
    amountDiff: { type: Number },
    dateDiff: { type: Number },
    score: { type: Number },
    matchPercentage: { type: Number, min: 0, max: 100 },
    addedAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

// New Vendor Schema
const newVendorSchema = new mongoose.Schema({
    name: { type: String, required: true },
    xeroId: { type: String, required: true },
    email: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    lastInvoiceMissCheck: { type: Date, default: Date.now },
});

// New Statements Schema (file uploads only - split from old Logs)
const newStatementsSchema = new mongoose.Schema({
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
    file: { type: String },
    invoiceIssueDate: { type: Date },
    addedAt: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
});

// New Process Schema (actions/status tracking - split from old Logs)
const newProcessSchema = new mongoose.Schema({
    status: { type: String, enum: ['pending', 'in_progress', 'completed', 'failed'], default: 'pending', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    processId: { type: [String], default: [], index: true },
    description: { type: String, default: null },
    // Migration metadata - to link back to original data
    migratedFrom: { type: String, default: null }, // 'old_logs'
    originalLogId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Preserved fields from old Logs
    total: { type: Number, default: 0 },
    unmatched: { type: Number, default: 0 },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", index: true },
    statementId: { type: mongoose.Schema.Types.ObjectId, ref: "Statements", index: true },
    createdAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

// ============================================================================
// DATABASE CONNECTIONS
// ============================================================================

let oldConnection = null;
let newConnection = null;

async function connectDatabases() {
    console.log('\n📡 Connecting to databases...');
    
    // Connect to old database
    oldConnection = await mongoose.createConnection(OLD_DB_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to OLD database');

    // Connect to new database
    newConnection = await mongoose.createConnection(NEW_DB_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to NEW database');

    return { oldConnection, newConnection };
}

async function closeDatabases() {
    if (oldConnection) await oldConnection.close();
    if (newConnection) await newConnection.close();
    console.log('\n📡 Database connections closed');
}

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

/**
 * Migrate Suppliers to Vendors
 */
async function migrateSuppliers(OldSupplier, NewVendor) {
    console.log('\n🔄 Migrating Suppliers -> Vendors...');
    
    const suppliers = await OldSupplier.find({}).lean();
    console.log(`   Found ${suppliers.length} suppliers to migrate`);
    
    const supplierToVendorMap = new Map(); // oldSupplierId -> newVendorId
    let migrated = 0;
    let skipped = 0;

    for (const supplier of suppliers) {
        // Check if vendor already exists with same xeroId
        const existingVendor = await NewVendor.findOne({ 
            $or: [
                { xeroId: supplier.xeroId },
                { name: supplier.name }
            ]
        });

        if (existingVendor) {
            supplierToVendorMap.set(supplier._id.toString(), existingVendor._id);
            skipped++;
            continue;
        }

        if (!DRY_RUN) {
            const newVendor = await NewVendor.create({
                name: supplier.name,
                xeroId: supplier.xeroId || `MIGRATED_${supplier._id}`,
                email: supplier.email,
                createdAt: supplier.createdAt || new Date(),
                lastInvoiceMissCheck: new Date(),
            });
            supplierToVendorMap.set(supplier._id.toString(), newVendor._id);
        } else {
            supplierToVendorMap.set(supplier._id.toString(), `DRY_RUN_${supplier._id}`);
        }
        migrated++;
    }

    console.log(`   ✅ Migrated: ${migrated}, Skipped (already exist): ${skipped}`);
    return supplierToVendorMap;
}

/**
 * Migrate old Logs -> new Statements + Process (split into two tables)
 * Old Logs combined file uploads AND action tracking
 * New schema separates these into Statements (files) and Process (actions)
 */
async function migrateLogs(OldLogs, NewStatements, NewProcess, supplierToVendorMap) {
    console.log('\n🔄 Migrating Logs -> Statements + Process (split)...');
    
    const logs = await OldLogs.find({}).lean();
    console.log(`   Found ${logs.length} logs to migrate`);
    
    const logToStatementMap = new Map(); // oldLogId -> newStatementId
    const logToProcessMap = new Map(); // oldLogId -> newProcessId
    let statementsCreated = 0;
    let processesCreated = 0;
    let skipped = 0;

    for (const log of logs) {
        const vendorId = supplierToVendorMap.get(log.supplier?.toString());
        
        // Check if statement already exists for this file
        let statementId = null;
        if (log.file) {
            // In dry-run mode, skip database lookups since we're using placeholder IDs
            if (DRY_RUN) {
                logToStatementMap.set(log._id.toString(), `DRY_RUN_STATEMENT_${log._id}`);
                statementsCreated++;
            } else if (vendorId) {
                const existingStatement = await NewStatements.findOne({ 
                    file: log.file,
                    vendor: vendorId
                });

                if (existingStatement) {
                    statementId = existingStatement._id;
                    logToStatementMap.set(log._id.toString(), existingStatement._id);
                } else {
                    // Create Statement record (file upload part)
                    const newStatement = await NewStatements.create({
                        vendor: vendorId,
                        file: log.file,
                        invoiceIssueDate: log.invoiceIssueDate,
                        addedAt: log.addedAt || new Date(),
                        isDeleted: log.isSuperseded || false,
                    });
                    statementId = newStatement._id;
                    logToStatementMap.set(log._id.toString(), newStatement._id);
                    statementsCreated++;
                }
            }
        }

        // In dry-run mode, skip database lookups
        if (DRY_RUN) {
            logToProcessMap.set(log._id.toString(), `DRY_RUN_PROCESS_${log._id}`);
            processesCreated++;
            continue;
        }

        // Check if process already exists for this log
        const existingProcess = await NewProcess.findOne({ 
            originalLogId: log._id 
        });

        if (existingProcess) {
            logToProcessMap.set(log._id.toString(), existingProcess._id);
            skipped++;
            continue;
        }

        // Map old status to new status
        let newStatus = 'pending';
        if (log.status === 'started') newStatus = 'in_progress';
        else if (log.status === 'completed') newStatus = 'completed';
        else if (log.status === 'failed') newStatus = 'failed';

        // Create Process record (action/status part)
        const newProcess = await NewProcess.create({
            status: newStatus,
            user: null, // Old format didn't track user
            processId: [],
            description: `Migrated from old Logs. Total: ${log.total || 0}, Unmatched: ${log.unmatched || 0}`,
            migratedFrom: 'old_logs',
            originalLogId: log._id,
            total: log.total || 0,
            unmatched: log.unmatched || 0,
            vendorId: vendorId,
            statementId: statementId,
            createdAt: log.addedAt || new Date(),
        });
        logToProcessMap.set(log._id.toString(), newProcess._id);
        processesCreated++;
    }

    console.log(`   ✅ Statements created: ${statementsCreated}`);
    console.log(`   ✅ Processes created: ${processesCreated}`);
    console.log(`   ⏭️  Skipped (already exist): ${skipped}`);
    
    return { logToStatementMap, logToProcessMap };
}

/**
 * Migrate old Invoices to new SupplierInvoices
 * Note: invoice.log in old schema pointed to Logs (now split into Statements + Process)
 */
async function migrateInvoices(OldInvoice, NewSupplierInvoice, supplierToVendorMap, logToStatementMap) {
    console.log('\n🔄 Migrating Invoices -> SupplierInvoices...');
    
    const invoices = await OldInvoice.find({}).lean();
    const totalCount = invoices.length;
    console.log(`   Found ${totalCount} invoices to migrate`);
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    let processed = 0;

    for (const invoice of invoices) {
        processed++;
        
        try {
            // Get the vendor ID from supplier mapping
            const vendorId = supplierToVendorMap.get(invoice.supplier?.toString());
            
            if (!vendorId) {
                console.warn(`   ⚠️  No vendor found for supplier ${invoice.supplier} (Invoice: ${invoice.invoiceNumber})`);
                errors++;
                continue;
            }

            // In dry-run mode, skip database lookups since we're using placeholder IDs
            if (!DRY_RUN) {
                // Check if invoice already exists
                const existingInvoice = await NewSupplierInvoice.findOne({ 
                    invoiceNumber: invoice.invoiceNumber,
                    vendorId: vendorId
                });

                if (existingInvoice) {
                    skipped++;
                    continue;
                }
            }

            // Determine reconciliation status based on xero data
            let status = "Unreconciled";
            if (invoice.invoiceXeroDate && invoice.amountXero) {
                const amountDiff = Math.abs((invoice.amount?.amount || 0) - (invoice.amountXero?.amount || 0));
                status = amountDiff < 0.01 ? "Reconciled" : "Unreconciled";
            }

            // Map old invoice.log (which was Logs) to new Statement ID
            const statementId = logToStatementMap.get(invoice.log?.toString()) || null;

            const newInvoiceData = {
                xeroInvoiceId: null, // Old format didn't have this
                invoiceNumber: invoice.invoiceNumber,
                projectReference: invoice.activityDescription || null, // Map activity description to project reference
                projectId: null,
                statementId: statementId, // Now points to new Statements table (split from old Logs)
                vendorId: vendorId,
                paymentStatus: invoice.paymentStatus || "unpaid",
                status: status,
                vendorAmount: invoice.amount?.amount || null,
                xeroAmount: invoice.amountXero?.amount || null,
                description: invoice.activityDescription,
                vendorCurrency: invoice.currency || null,
                xeroCurrency: invoice.currency || null, // Assume same currency
                VendorDate: invoice.invoiceDate || null,
                xeroDate: invoice.invoiceXeroDate || null,
                modifiedLast: new Date(),
                createdAt: invoice.addedAt || new Date(),
                isDeleted: invoice.isDeleted || false,
            };

            if (!DRY_RUN) {
                await NewSupplierInvoice.create(newInvoiceData);
            }
            migrated++;

        } catch (err) {
            console.error(`   ❌ Error migrating invoice ${invoice.invoiceNumber}: ${err.message}`);
            errors++;
        }

        // Progress update
        const progress = Math.round((processed / totalCount) * 100);
        process.stdout.write(`\r   Progress: ${progress}% (${processed}/${totalCount})`);
    }

    console.log(`\n   ✅ Migrated: ${migrated}, Skipped: ${skipped}, Errors: ${errors}`);
    return migrated;
}

/**
 * Migrate Job rankedInvoices to CustomerInvoices
 */
async function migrateJobsToCustomerInvoices(OldJob, NewCustomerInvoice) {
    console.log('\n🔄 Migrating Jobs -> CustomerInvoices...');
    
    const jobs = await OldJob.find({}).lean();
    const totalCount = jobs.length;
    console.log(`   Found ${totalCount} jobs to process`);
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    let processed = 0;

    for (const job of jobs) {
        processed++;
        
        try {
            // If job has sourceInvoiceData, create a CustomerInvoice from it
            if (job.sourceInvoiceData) {
                const xeroInvoiceId = job.sourceInvoiceId || job.sourceInvoiceData?.InvoiceID;
                
                if (!xeroInvoiceId) {
                    console.warn(`   ⚠️  No xeroInvoiceId for job ${job._id}`);
                    errors++;
                    continue;
                }

                // In dry-run mode, skip database lookups
                if (!DRY_RUN) {
                    // Check if already exists
                    const existingInvoice = await NewCustomerInvoice.findOne({ 
                        xeroInvoiceId: xeroInvoiceId 
                    });

                    if (existingInvoice) {
                        skipped++;
                        continue;
                    }
                }

                const invoiceData = job.sourceInvoiceData;
                
                const newCustomerInvoice = {
                    xeroInvoiceId: xeroInvoiceId,
                    invoiceNumber: invoiceData.InvoiceNumber || job.sourceInvoiceNumber,
                    xeroInvoiceData: invoiceData,
                    reference: invoiceData.Reference || job.searchReference,
                    total: invoiceData.Total || null,
                    subTotal: invoiceData.SubTotal || null,
                    dateString: invoiceData.DateString || null,
                    invoiceDate: invoiceData.Date ? new Date(invoiceData.Date) : null,
                    type: invoiceData.Type || null,
                    contactId: job.contactDetails?.ContactID || invoiceData.Contact?.ContactID,
                    contactName: job.contactDetails?.Name || invoiceData.Contact?.Name,
                    // Get ranking info from first ranked invoice if available
                    amountDiff: job.rankedInvoices?.[0]?.amountDiff || null,
                    dateDiff: job.rankedInvoices?.[0]?.dateDiff || null,
                    score: job.rankedInvoices?.[0]?.score || null,
                    matchPercentage: job.rankedInvoices?.[0]?.matchPercentage || null,
                    addedAt: job.addedAt || new Date(),
                    isDeleted: job.isDeleted || false,
                };

                if (!DRY_RUN) {
                    await NewCustomerInvoice.create(newCustomerInvoice);
                }
                migrated++;
            }
        } catch (err) {
            console.error(`   ❌ Error migrating job ${job._id}: ${err.message}`);
            errors++;
        }

        // Progress update
        const progress = Math.round((processed / totalCount) * 100);
        process.stdout.write(`\r   Progress: ${progress}% (${processed}/${totalCount})`);
    }

    console.log(`\n   ✅ Migrated: ${migrated}, Skipped: ${skipped}, Errors: ${errors}`);
    return migrated;
}

// ============================================================================
// MAIN MIGRATION RUNNER
// ============================================================================

async function runMigration() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║         Invoice Migration: Old Format -> New Format            ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    
    if (DRY_RUN) {
        console.log('\n🔔 DRY RUN MODE - No changes will be made to the database');
    }
    
    console.log(`\n📋 Configuration:`);
    console.log(`   Old DB: ${OLD_DB_URI.replace(/\/\/.*:.*@/, '//<credentials>@')}`);
    console.log(`   New DB: ${NEW_DB_URI.replace(/\/\/.*:.*@/, '//<credentials>@')}`);

    try {
        await connectDatabases();

        // Create models on each connection
        // OLD DATABASE MODELS
        const OldInvoice = oldConnection.model('Invoices', oldInvoiceSchema, 'invoices');
        const OldJob = oldConnection.model('Job', oldJobSchema, 'jobs');
        const OldSupplier = oldConnection.model('Supplier', oldSupplierSchema, 'suppliers');
        const OldLogs = oldConnection.model('Logs', oldLogsSchema, 'logs'); // Old: Logs = Statements + Actions combined
        
        // NEW DATABASE MODELS
        const NewSupplierInvoice = newConnection.model('SupplierInvoices', newSupplierInvoiceSchema, 'supplierinvoices');
        const NewCustomerInvoice = newConnection.model('CustomerInvoice', newCustomerInvoiceSchema, 'customerinvoices');
        const NewVendor = newConnection.model('Vendor', newVendorSchema, 'vendors');
        const NewStatements = newConnection.model('Statements', newStatementsSchema, 'statements'); // New: Just file uploads
        const NewProcess = newConnection.model('Process', newProcessSchema, 'processes'); // New: Just actions/status

        // Run migrations in order
        const startTime = Date.now();

        // 1. Migrate Suppliers -> Vendors first (need mapping for invoices)
        const supplierToVendorMap = await migrateSuppliers(OldSupplier, NewVendor);

        // 2. Migrate old Logs -> new Statements + Process (split into two tables)
        const { logToStatementMap, logToProcessMap } = await migrateLogs(
            OldLogs, NewStatements, NewProcess, supplierToVendorMap
        );

        // 3. Migrate Invoices -> SupplierInvoices (use logToStatementMap for the log->statement reference)
        await migrateInvoices(OldInvoice, NewSupplierInvoice, supplierToVendorMap, logToStatementMap);

        // 4. Migrate Jobs -> CustomerInvoices
        await migrateJobsToCustomerInvoices(OldJob, NewCustomerInvoice);
        
        console.log('\n📋 Migration Summary:');
        console.log(`   - Suppliers -> Vendors: ${supplierToVendorMap.size} mapped`);
        console.log(`   - Logs -> Statements: ${logToStatementMap.size} mapped`);
        console.log(`   - Logs -> Processes: ${logToProcessMap.size} mapped`);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log(`║              Migration Complete! (${duration}s)                    ║`);
        console.log('╚════════════════════════════════════════════════════════════════╝');

        if (DRY_RUN) {
            console.log('\n🔔 This was a DRY RUN. Run without --dry-run to apply changes.');
        }

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await closeDatabases();
    }
}

// Run the migration
runMigration();
