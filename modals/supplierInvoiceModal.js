const mongoose = require("mongoose");

const supplierInvoiceSchema = new mongoose.Schema({
    xeroInvoiceId: {
        type: String,
        required: false,
        // unique: true,
        // sparse: true,
        // index: true
    },
    invoiceNumber: {
        type: String,
        required: true,
        index: true
    },
    projectReference: {
        type: String,
        ref: "Project",
        index: true
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        index: true
    },
    statementId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Statements",
        index: true
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Vendor",
        required: true,
        index: true
    },
    paymentStatus: {
        type: String,
        enum: ["paid", "unpaid"],
        required: true
    },
    status: {
        type: String,
        enum: ["Reconciled", "Unreconciled", "Duplicate", "Missing Reference"],
        required: true
    },
    vendorAmount: {
        type: Number,
        default: null
    },
    xeroAmount: {
        type: Number,
        default: null
    },
    description: {
        type: String,
        default: null
    },
    vendorCurrency: {
        type: String,
        uppercase: true,
        default: null
    },
    xeroCurrency: {
        type: String,
        uppercase: true,
        default: null
    },
    VendorDate: {
        type: Date,
        default: null
    },
    xeroDate: {
        type: Date,
        default: null
    },
    modifiedLast: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    wasPaidOnTime: {
        type: Boolean,
        default: null
    }
});

// Update the modifiedLast field before saving
supplierInvoiceSchema.pre('save', async function() {
    this.modifiedLast = Date.now();
});

const SupplierInvoice = mongoose.model("SupplierInvoices", supplierInvoiceSchema,);

// Migrate old indexes - drop invoiceId and compound invoiceId_tenant indexes
mongoose.connection.on('connected', async () => {
    try {
        const collection = SupplierInvoice.collection;
        const indexes = await collection.indexes();
        
        // Drop old invoiceId_1 index if it exists
        const invoiceIdIndex = indexes.find(idx => idx.name === 'invoiceId_1' || (idx.key && idx.key.invoiceId === 1));
        if (invoiceIdIndex) {
            try {
                await collection.dropIndex('invoiceId_1');
                console.log('✅ Dropped existing invoiceId_1 index');
            } catch (err) {
                if (err.code !== 27 && err.codeName !== 'IndexNotFound') {
                    console.log('⚠️  Note: Could not drop invoiceId_1 index:', err.message);
                }
            }
        }
        
        // Drop old compound invoiceId_1_tenant_1 index if it exists
        const compoundIndex = indexes.find(idx => 
            idx.name === 'invoiceId_1_tenant_1' || 
            (idx.key && idx.key.invoiceId === 1 && idx.key.tenant === 1)
        );
        if (compoundIndex) {
            try {
                await collection.dropIndex('invoiceId_1_tenant_1');
                console.log('✅ Dropped existing invoiceId_1_tenant_1 compound index');
            } catch (err) {
                if (err.code !== 27 && err.codeName !== 'IndexNotFound') {
                    console.log('⚠️  Note: Could not drop invoiceId_1_tenant_1 index:', err.message);
                }
            }
        }
    } catch (err) {
        // Silently ignore - index migration is best-effort
        console.log('⚠️  Index migration error (non-critical):', err.message);
    }
});

module.exports = SupplierInvoice;
