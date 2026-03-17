const { tryCatchAsync } = require("./ErrorController");
const mongoose = require("mongoose");
const Vendor = require("../modals/vendorModal");
const SupplierInvoice = require("../modals/supplierInvoiceModal");

// Alias for compatibility
const Suppliers = Vendor;
const Invoices = SupplierInvoice;

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.getSuppliers = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Math.max(1, Math.min(Number(req.query.page) || 1, 1000));
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 200) : '';
    const offset = (page - 1) * limit;

    const matchStage = search
        ? { name: { $regex: escapeRegex(search), $options: 'i' } }
        : {};

    const suppliers = await Suppliers.aggregate([
        { $match: matchStage },

        // Join logs (excluding superseded and deleted logs)
        {
            $lookup: {
                from: 'statements',              // collection name (plural, lowercase)
                localField: '_id',
                foreignField: 'vendor',  // field in logs
                as: 'logs',
                pipeline: [
                    { $match: { 
                        isDeleted: { $ne: true }
                    } }
                ]
            }
        },

        // Join supplier invoices (excluding deleted invoices)
        {
            $lookup: {
                from: 'supplierinvoices',              // collection name (plural, lowercase)
                localField: '_id',
                foreignField: 'vendorId',  // field in supplier invoices
                as: 'invoices',
                pipeline: [
                    { $match: { 
                        isDeleted: { $ne: true }
                    } }
                ]
            }
        },

        // Count logs and invoices
        {
            $addFields: {
                logCount: { $size: '$logs' },
                invoiceCount: { $size: '$invoices' }
            }
        },

        // Sort A → Z
        { $sort: { name: 1 } },

        // Pagination
        { $skip: offset },
        { $limit: limit },

        // Optional: remove logs and invoices arrays from response
        {
            $project: {
                logs: 0,
                invoices: 0
            }
        }
    ]);

    const total = await Suppliers.countDocuments(matchStage);

    res.status(200).json({
        success: true,
        suppliers,
        pages: Math.ceil(total / limit)
    });
});

exports.getInvoicesBySupplier = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Math.max(1, Math.min(Number(req.query.page) || 1, 1000));
    const supplierId = req.query.supplierId;
    const allowedSortFields = ['invoiceNumber', 'supplierDate', 'xeroDate', 'supplierAmount', 'xeroAmount', 'addedAt', 'paymentStatus', 'difference', 'foundInXero', 'status'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'addedAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
    const allowedPaymentFilters = ['all', 'paid', 'unpaid'];
    const paymentFilter = allowedPaymentFilters.includes(req.query.paymentFilter) ? req.query.paymentFilter : 'all';
    const offset = (page - 1) * limit;

    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({
            success: false,
            message: 'Valid Supplier ID is required'
        });
    }

    // Map frontend sort fields to database fields
    const sortFieldMap = {
        'invoiceNumber': 'invoiceNumber',
        'supplierDate': 'VendorDate',
        'xeroDate': 'xeroDate',
        'supplierAmount': 'vendorAmount',
        'xeroAmount': 'xeroAmount',
        'addedAt': 'createdAt',
        'paymentStatus': 'paymentStatus'
    };

    // Get the actual database field to sort by
    const dbSortField = sortFieldMap[sortBy] || 'createdAt';

    // Helper function to get reconciliation status value for sorting
    function getStatusValue(invoice) {
        const supplierAmount = invoice.vendorAmount;
        const systemAmount = invoice.xeroAmount;
        const hasXeroDate = invoice.xeroDate != null;

        if (!hasXeroDate) {
            return 0; // n/a - lowest priority
        }

        if (supplierAmount != null && systemAmount != null) {
            const tolerance = 0.01;
            const difference = Math.abs(supplierAmount - systemAmount);

            if (difference <= tolerance) {
                return 2; // fully reconciled - highest priority
            } else {
                return 1; // partially reconciled - middle priority
            }
        }

        return 1; // partially reconciled if found in Xero but amounts missing
    }

    // Build sort object (skip if sorting by difference, foundInXero, or status)
    let sortObj = {};
    if (sortBy !== 'difference' && sortBy !== 'foundInXero' && sortBy !== 'status') {
        sortObj[dbSortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
        // Default sort for in-memory sorting
        sortObj = { addedAt: -1 };
    }

    // Build base query - use vendorId to match schema
    let baseQuery = {
        vendorId: supplierId,
        isDeleted: { $ne: true }
    };

    // Add payment status filter
    if (paymentFilter === 'paid') {
        baseQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        baseQuery.paymentStatus = 'unpaid';
    }

    const invoices = await Invoices.find(baseQuery)
        .sort(sortObj)
        .skip(offset)
        .limit(limit)
        .populate('vendorId')
        .populate('statementId');

    // Sort in-memory for computed fields
    if (sortBy === 'difference') {
        invoices.sort((a, b) => {
            const aAmount = a.vendorAmount || 0;
            const bAmount = b.vendorAmount || 0;
            const aXeroAmount = a.xeroAmount || 0;
            const bXeroAmount = b.xeroAmount || 0;
            const aDiff = aAmount - aXeroAmount;
            const bDiff = bAmount - bXeroAmount;
            return sortOrder === 'desc' ? bDiff - aDiff : aDiff - bDiff;
        });
    } else if (sortBy === 'foundInXero') {
        invoices.sort((a, b) => {
            const aFound = a.xeroDate ? 1 : 0;
            const bFound = b.xeroDate ? 1 : 0;
            return sortOrder === 'desc' ? bFound - aFound : aFound - bFound;
        });
    } else if (sortBy === 'status') {
        invoices.sort((a, b) => {
            const aStatus = getStatusValue(a);
            const bStatus = getStatusValue(b);
            return sortOrder === 'desc' ? bStatus - aStatus : aStatus - bStatus;
        });
    }

    // Build total query with payment filter
    let totalQuery = {
        vendorId: supplierId,
        isDeleted: { $ne: true }
    };

    if (paymentFilter === 'paid') {
        totalQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        totalQuery.paymentStatus = 'unpaid';
    }

    const total = await Invoices.countDocuments(totalQuery);

    res.status(200).json({
        success: true,
        invoices,
        pages: Math.ceil(total / limit)
    });
});

exports.getMissedInvoices = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Math.max(1, Math.min(Number(req.query.page) || 1, 1000));
    const supplierId = req.query.supplierId;
    const allowedSortFields = ['invoiceNumber', 'supplierDate', 'xeroDate', 'supplierAmount', 'xeroAmount', 'addedAt', 'paymentStatus', 'difference', 'foundInXero'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'addedAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
    const allowedPaymentFilters = ['all', 'paid', 'unpaid'];
    const paymentFilter = allowedPaymentFilters.includes(req.query.paymentFilter) ? req.query.paymentFilter : 'all';
    const offset = (page - 1) * limit;

    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({
            success: false,
            message: 'Valid Supplier ID is required'
        });
    }

    // Map frontend sort fields to database fields
    const sortFieldMap = {
        'invoiceNumber': 'invoiceNumber',
        'supplierDate': 'VendorDate',
        'xeroDate': 'xeroDate',
        'supplierAmount': 'vendorAmount',
        'xeroAmount': 'xeroAmount',
        'addedAt': 'createdAt',
        'paymentStatus': 'paymentStatus'
    };

    // Get the actual database field to sort by
    const dbSortField = sortFieldMap[sortBy] || 'createdAt';

    // Build sort object
    let sortObj = {};
    if (sortBy !== 'difference' && sortBy !== 'foundInXero' && sortBy !== 'status') {
        sortObj[dbSortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
        sortObj = { createdAt: -1 };
    }

    // Build base query for missed invoices
    // Missed invoices: have xeroDate but no VendorDate and no vendorAmount (found in Xero but not from supplier statement)
    let baseQuery = {
        vendorId: supplierId,
        isDeleted: { $ne: true },
        xeroDate: { $ne: null },
        VendorDate: null,
        vendorAmount: null
    };

    // Add payment status filter
    if (paymentFilter === 'paid') {
        baseQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        baseQuery.paymentStatus = 'unpaid';
    }

    const invoices = await Invoices.find(baseQuery)
        .sort(sortObj)
        .skip(offset)
        .limit(limit)
        .populate('vendorId')
        .populate('statementId');

    // Sort in-memory for computed fields
    if (sortBy === 'difference') {
        invoices.sort((a, b) => {
            const aAmount = a.vendorAmount || 0;
            const bAmount = b.vendorAmount || 0;
            const aXeroAmount = a.xeroAmount || 0;
            const bXeroAmount = b.xeroAmount || 0;
            const aDiff = aAmount - aXeroAmount;
            const bDiff = bAmount - bXeroAmount;
            return sortOrder === 'desc' ? bDiff - aDiff : aDiff - bDiff;
        });
    } else if (sortBy === 'foundInXero') {
        invoices.sort((a, b) => {
            const aFound = a.xeroDate ? 1 : 0;
            const bFound = b.xeroDate ? 1 : 0;
            return sortOrder === 'desc' ? bFound - aFound : aFound - bFound;
        });
    }

    // Build total query with payment filter
    let totalQuery = {
        vendorId: supplierId,
        isDeleted: { $ne: true },
        xeroDate: { $ne: null },
        VendorDate: null,
        vendorAmount: null
    };

    if (paymentFilter === 'paid') {
        totalQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        totalQuery.paymentStatus = 'unpaid';
    }

    const total = await Invoices.countDocuments(totalQuery);

    res.status(200).json({
        success: true,
        invoices,
        pages: Math.ceil(total / limit)
    });
});

exports.getUnmatchedInvoices = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Math.max(1, Math.min(Number(req.query.page) || 1, 1000));
    const supplierId = req.query.supplierId;
    const allowedSortFields = ['invoiceNumber', 'supplierDate', 'xeroDate', 'supplierAmount', 'xeroAmount', 'addedAt', 'paymentStatus', 'difference', 'foundInXero', 'status'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'addedAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
    const allowedPaymentFilters = ['all', 'paid', 'unpaid'];
    const paymentFilter = allowedPaymentFilters.includes(req.query.paymentFilter) ? req.query.paymentFilter : 'all';
    const offset = (page - 1) * limit;

    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({
            success: false,
            message: 'Valid Supplier ID is required'
        });
    }

    // Map frontend sort fields to database fields
    const sortFieldMap = {
        'invoiceNumber': 'invoiceNumber',
        'supplierDate': 'VendorDate',
        'xeroDate': 'xeroDate',
        'supplierAmount': 'vendorAmount',
        'xeroAmount': 'xeroAmount',
        'addedAt': 'createdAt',
        'paymentStatus': 'paymentStatus'
    };

    // Get the actual database field to sort by
    const dbSortField = sortFieldMap[sortBy] || 'createdAt';

    // Build sort object
    let sortObj = {};
    if (sortBy !== 'difference' && sortBy !== 'foundInXero' && sortBy !== 'status') {
        sortObj[dbSortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
        sortObj = { createdAt: -1 };
    }

    // Build base query for unmatched invoices - use vendorId and new field names
    let baseQuery = {
        vendorId: supplierId,
        isDeleted: { $ne: true },
        VendorDate: { $ne: null },
        xeroDate: null
    };

    // Add payment status filter
    if (paymentFilter === 'paid') {
        baseQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        baseQuery.paymentStatus = 'unpaid';
    }

    const invoices = await Invoices.find(baseQuery)
        .sort(sortObj)
        .skip(offset)
        .limit(limit)
        .populate('vendorId')
        .populate('statementId');

    // Sort in-memory for computed fields
    if (sortBy === 'difference') {
        invoices.sort((a, b) => {
            const aAmount = a.vendorAmount || 0;
            const bAmount = b.vendorAmount || 0;
            const aXeroAmount = a.xeroAmount || 0;
            const bXeroAmount = b.xeroAmount || 0;
            const aDiff = aAmount - aXeroAmount;
            const bDiff = bAmount - bXeroAmount;
            return sortOrder === 'desc' ? bDiff - aDiff : aDiff - bDiff;
        });
    } else if (sortBy === 'foundInXero') {
        invoices.sort((a, b) => {
            const aFound = a.xeroDate ? 1 : 0;
            const bFound = b.xeroDate ? 1 : 0;
            return sortOrder === 'desc' ? bFound - aFound : aFound - bFound;
        });
    }

    // Build total query with payment filter
    let totalQuery = {
        vendorId: supplierId,
        isDeleted: { $ne: true },
        VendorDate: { $ne: null },
        xeroDate: null
    };

    if (paymentFilter === 'paid') {
        totalQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        totalQuery.paymentStatus = 'unpaid';
    }

    const total = await Invoices.countDocuments(totalQuery);

    res.status(200).json({
        success: true,
        invoices,
        pages: Math.ceil(total / limit)
    });
});

exports.getMatchedInvoices = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Math.max(1, Math.min(Number(req.query.page) || 1, 1000));
    const supplierId = req.query.supplierId;
    const allowedSortFields = ['invoiceNumber', 'supplierDate', 'xeroDate', 'supplierAmount', 'xeroAmount', 'addedAt', 'paymentStatus', 'difference', 'foundInXero', 'status'];
    const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : 'addedAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
    const allowedPaymentFilters = ['all', 'paid', 'unpaid'];
    const paymentFilter = allowedPaymentFilters.includes(req.query.paymentFilter) ? req.query.paymentFilter : 'all';
    const offset = (page - 1) * limit;

    if (!supplierId || !mongoose.Types.ObjectId.isValid(supplierId)) {
        return res.status(400).json({
            success: false,
            message: 'Valid Supplier ID is required'
        });
    }

    // Map frontend sort fields to database fields
    const sortFieldMap = {
        'invoiceNumber': 'invoiceNumber',
        'supplierDate': 'VendorDate',
        'xeroDate': 'xeroDate',
        'supplierAmount': 'vendorAmount',
        'xeroAmount': 'xeroAmount',
        'addedAt': 'createdAt',
        'paymentStatus': 'paymentStatus'
    };

    // Get the actual database field to sort by
    const dbSortField = sortFieldMap[sortBy] || 'createdAt';

    // Build sort object
    let sortObj = {};
    if (sortBy !== 'difference' && sortBy !== 'foundInXero' && sortBy !== 'status') {
        sortObj[dbSortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
        sortObj = { createdAt: -1 };
    }

    // Build base query for matched invoices - show any item that is reconciled
    let baseQuery = {
        vendorId: supplierId,
        isDeleted: { $ne: true },
        status: 'Reconciled'
    };

    // Add payment status filter
    if (paymentFilter === 'paid') {
        baseQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        baseQuery.paymentStatus = 'unpaid';
    }

    const invoices = await Invoices.find(baseQuery)
        .sort(sortObj)
        .skip(offset)
        .limit(limit)
        .populate('vendorId')
        .populate('statementId');

    // Sort in-memory for computed fields
    if (sortBy === 'difference') {
        invoices.sort((a, b) => {
            const aAmount = a.vendorAmount || 0;
            const bAmount = b.vendorAmount || 0;
            const aXeroAmount = a.xeroAmount || 0;
            const bXeroAmount = b.xeroAmount || 0;
            const aDiff = aAmount - aXeroAmount;
            const bDiff = bAmount - bXeroAmount;
            return sortOrder === 'desc' ? bDiff - aDiff : aDiff - bDiff;
        });
    } else if (sortBy === 'foundInXero') {
        invoices.sort((a, b) => {
            const aFound = a.xeroDate ? 1 : 0;
            const bFound = b.xeroDate ? 1 : 0;
            return sortOrder === 'desc' ? bFound - aFound : aFound - bFound;
        });
    }

    // Build total query with payment filter
    let totalQuery = {
        vendorId: supplierId,
        isDeleted: { $ne: true },
        status: 'Reconciled'
    };

    if (paymentFilter === 'paid') {
        totalQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        totalQuery.paymentStatus = 'unpaid';
    }

    const total = await Invoices.countDocuments(totalQuery);

    res.status(200).json({
        success: true,
        invoices,
        pages: Math.ceil(total / limit)
    });
});
