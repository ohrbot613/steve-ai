const { tryCatchAsync } = require("./ErrorController");
const Statements = require("../modals/statementsModal");
const SupplierInvoice = require("../modals/supplierInvoiceModal");
const Process = require("../modals/processModal");
const mongoose = require("mongoose");

// Alias for compatibility
const Invoices = SupplierInvoice;

exports.getAllLogs = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || 'processDateTime';
    const sortOrder = req.query.sortOrder || 'desc';
    const offset = (page - 1) * limit;

    // Map frontend sort fields to database fields
    const sortFieldMap = {
        'supplier': 'vendor.name',
        'statementIssueDate': 'invoiceIssueDate',
        'processDateTime': 'addedAt',
        'status': 'status',
        'reconciled': 'reconciled', 
        'unreconciled': 'unreconciled',
        'total': 'total'  
    };

    const dbSortField = sortFieldMap[sortBy] || 'addedAt';

    // Build sort object for database fields
    let sortObj = {};
    if (sortBy === 'statementIssueDate' || sortBy === 'processDateTime') {
        sortObj[dbSortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
        // Default sort for computed fields or unknown fields (will sort in memory)
        sortObj = { addedAt: sortOrder === 'desc' ? -1 : 1 };
    }

    // Use aggregation to get statements with invoice counts (same structure as getLogs)
    const logs = await Statements.aggregate([
        {
            $match: {
                isDeleted: { $ne: true }
            }
        },
        {
            $lookup: {
                from: 'supplierinvoices',
                localField: '_id',
                foreignField: 'statementId',
                as: 'invoices',
                pipeline: [
                    { $match: { isDeleted: { $ne: true } } }
                ]
            }
        },
        {
            $addFields: {
                // Total: count all supplier invoices for this statement
                total: { $size: '$invoices' },
                // Reconciled: count invoices where status is 'Reconciled'
                reconciled: {
                    $size: {
                        $filter: {
                            input: '$invoices',
                            as: 'invoice',
                            cond: {
                                $eq: ['$$invoice.status', 'Reconciled']
                            }
                        }
                    }
                },
                // Unreconciled: count invoices where status is NOT 'Reconciled'
                unreconciled: {
                    $size: {
                        $filter: {
                            input: '$invoices',
                            as: 'invoice',
                            cond: {
                                $ne: ['$$invoice.status', 'Reconciled']
                            }
                        }
                    }
                },
                // Matched: count invoices where xeroDate exists (found in Xero)
                matched: {
                    $size: {
                        $filter: {
                            input: '$invoices',
                            as: 'invoice',
                            cond: {
                                $ne: ['$$invoice.xeroDate', null]
                            }
                        }
                    }
                },
                // Unmatched: count invoices where xeroDate does not exist (not found in Xero)
                unmatched: {
                    $size: {
                        $filter: {
                            input: '$invoices',
                            as: 'invoice',
                            cond: {
                                $eq: ['$$invoice.xeroDate', null]
                            }
                        }
                    }
                }
            }
        },
        {
            $addFields: {
                // Calculate status based on invoice counts
                status: {
                    $cond: {
                        if: { $eq: ['$total', 0] },
                        then: 'pending',
                        else: {
                            $cond: {
                                if: { $eq: ['$unreconciled', 0] },
                                then: 'completed',
                                else: {
                                    $cond: {
                                        if: { $gt: ['$reconciled', 0] },
                                        then: 'completed',
                                        else: 'failed'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        {
            $lookup: {
                from: 'vendors',
                localField: 'vendor',
                foreignField: '_id',
                as: 'vendorInfo'
            }
        },
        {
            $unwind: {
                path: '$vendorInfo',
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $addFields: {
                // Map vendor to supplier for frontend compatibility
                supplier: {
                    _id: '$vendorInfo._id',
                    name: '$vendorInfo.name'
                }
            }
        },
        {
            $project: {
                invoices: 0,  // Remove invoices array from output
                vendorInfo: 0  // Remove vendorInfo as we have supplier
            }
        },
        {
            $sort: sortObj
        },
        {
            $skip: offset
        },
        {
            $limit: limit * 2  // Fetch more to account for in-memory sorting if needed
        }
    ]);

    // For computed fields, sort in memory
    if (sortBy === 'reconciled' || sortBy === 'unreconciled' || sortBy === 'total' || sortBy === 'status') {
        logs.sort((a, b) => {
            let aValue, bValue;

            if (sortBy === 'reconciled') {
                aValue = a.reconciled || 0;
                bValue = b.reconciled || 0;
            } else if (sortBy === 'unreconciled') {
                aValue = a.unreconciled || 0;
                bValue = b.unreconciled || 0;
            } else if (sortBy === 'total') {
                aValue = a.total || 0;
                bValue = b.total || 0;
            } else if (sortBy === 'status') {
                // Sort by status: completed < failed < other
                const statusOrder = { 'completed': 1, 'failed': 2, 'in_progress': 3, 'started': 4 };
                aValue = statusOrder[a.status] || 99;
                bValue = statusOrder[b.status] || 99;
            }

            if (sortOrder === 'desc') {
                return bValue - aValue;
            } else {
                return aValue - bValue;
            }
        });

        // Limit after sorting for computed fields
        const limitedLogs = logs.slice(0, limit);
        const total = await Statements.countDocuments({
            isDeleted: { $ne: true }
        });

        return res.status(200).json({
            success: true,
            logs: limitedLogs,
            pages: Math.ceil(total / limit)
        });
    }

    const total = await Statements.countDocuments({
        isDeleted: { $ne: true }
    });

    res.status(200).json({
        success: true,
        logs,
        pages: Math.ceil(total / limit)
    });
});

exports.getLogs = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Number(req.query.page) || 1;
    const id = req.query.id;
    const sortBy = req.query.sortBy || 'processDateTime';
    const sortOrder = req.query.sortOrder || 'desc';
    const offset = (page - 1) * limit;

    // Map frontend sort fields to database fields
    const sortFieldMap = {
        'statementIssueDate': 'invoiceIssueDate',
        'processDateTime': 'addedAt',
        'status': 'status',
        'reconciled': 'reconciled', 
        'unreconciled': 'unreconciled',
        'total': 'total'  
    };

    const dbSortField = sortFieldMap[sortBy] || 'addedAt';

    // Build sort object for database fields
    let sortObj = {};
    if (sortBy === 'statementIssueDate' || sortBy === 'processDateTime') {
        sortObj[dbSortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
        // Default sort for computed fields or unknown fields (will sort in memory)
        sortObj = { addedAt: -1 };
    }

    // Convert id to ObjectId if it's a string
    const vendorObjectId = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;

    // Use aggregation to get statements with invoice counts
    const logs = await Statements.aggregate([
        {
            $match: {
                vendor: vendorObjectId,
                isDeleted: { $ne: true }
            }
        },
        {
            $lookup: {
                from: 'supplierinvoices',
                localField: '_id',
                foreignField: 'statementId',
                as: 'invoices',
                pipeline: [
                    { $match: { isDeleted: { $ne: true } } }
                ]
            }
        },
        {
            $addFields: {
                // Total: count all supplier invoices for this statement
                total: { $size: '$invoices' },
                // Reconciled: count invoices where status is 'Reconciled'
                reconciled: {
                    $size: {
                        $filter: {
                            input: '$invoices',
                            as: 'invoice',
                            cond: {
                                $eq: ['$$invoice.status', 'Reconciled']
                            }
                        }
                    }
                },
                // Unreconciled: count invoices where status is NOT 'Reconciled'
                unreconciled: {
                    $size: {
                        $filter: {
                            input: '$invoices',
                            as: 'invoice',
                            cond: {
                                $ne: ['$$invoice.status', 'Reconciled']
                            }
                        }
                    }
                },
                // Matched: count invoices where xeroDate exists (found in Xero)
                matched: {
                    $size: {
                        $filter: {
                            input: '$invoices',
                            as: 'invoice',
                            cond: {
                                $ne: ['$$invoice.xeroDate', null]
                            }
                        }
                    }
                },
                // Unmatched: count invoices where xeroDate does not exist (not found in Xero)
                unmatched: {
                    $size: {
                        $filter: {
                            input: '$invoices',
                            as: 'invoice',
                            cond: {
                                $eq: ['$$invoice.xeroDate', null]
                            }
                        }
                    }
                }
            }
        },
        {
            $addFields: {
                // Calculate status based on invoice counts
                status: {
                    $cond: {
                        if: { $eq: ['$total', 0] },
                        then: 'pending',
                        else: {
                            $cond: {
                                if: { $eq: ['$unreconciled', 0] },
                                then: 'completed',
                                else: {
                                    $cond: {
                                        if: { $gt: ['$reconciled', 0] },
                                        then: 'completed',
                                        else: 'failed'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        {
            $project: {
                invoices: 0  // Remove invoices array from output
            }
        },
        {
            $sort: sortObj
        },
        {
            $skip: offset
        },
        {
            $limit: limit * 2  // Fetch more to account for in-memory sorting if needed
        }
    ]);

    // For computed fields, sort in memory
    if (sortBy === 'reconciled' || sortBy === 'unreconciled' || sortBy === 'total' || sortBy === 'status') {
        logs.sort((a, b) => {
            let aValue, bValue;

            if (sortBy === 'reconciled') {
                aValue = a.reconciled || 0;
                bValue = b.reconciled || 0;
            } else if (sortBy === 'unreconciled') {
                aValue = a.unreconciled || 0;
                bValue = b.unreconciled || 0;
            } else if (sortBy === 'total') {
                aValue = a.total || 0;
                bValue = b.total || 0;
            } else if (sortBy === 'status') {
                // Sort by status: completed < failed < other
                const statusOrder = { 'completed': 1, 'failed': 2, 'in_progress': 3, 'started': 4 };
                aValue = statusOrder[a.status] || 99;
                bValue = statusOrder[b.status] || 99;
            }

            if (sortOrder === 'desc') {
                return bValue - aValue;
            } else {
                return aValue - bValue;
            }
        });

        // Limit after sorting for computed fields
        const limitedLogs = logs.slice(0, limit);
        const total = await Statements.countDocuments({
            vendor: vendorObjectId,
            isDeleted: { $ne: true }
        });

        return res.status(200).json({
            success: true,
            logs: limitedLogs,
            pages: Math.ceil(total / limit)
        });
    }

    const total = await Statements.countDocuments({
        vendor: vendorObjectId,
        isDeleted: { $ne: true }
    });

    res.status(200).json({
        success: true,
        logs,
        pages: Math.ceil(total / limit)
    });
});

exports.deleteLog = tryCatchAsync(async (req, res) => {
    const logId = req.params.id;

    if (!logId) {
        return res.status(400).json({
            success: false,
            message: 'Log ID is required'
        });
    }

    // Find the log
    const log = await Statements.findById(logId);

    if (!log) {
        return res.status(404).json({
            success: false,
            message: 'Log not found'
        });
    }

    // Mark the log as deleted
    await Statements.updateOne({ _id: logId }, { isDeleted: true });

    // Mark all invoices associated with this log as deleted
    await Invoices.updateMany({ statementId: logId }, { isDeleted: true });

    res.status(200).json({
        success: true,
        message: 'Log and associated invoices deleted successfully'
    });
});

exports.getNewerLog = tryCatchAsync(async (req, res) => {
    const logId = req.query.logId;

    if (!logId) {
        return res.status(400).json({
            success: false,
            message: 'Log ID is required'
        });
    }

    // Find the log
    const log = await Statements.findById(logId).populate('vendor');

    if (!log) {
        return res.status(404).json({
            success: false,
            message: 'Log not found'
        });
    }

    // Return the log ID
    return res.status(200).json({
        success: true,
        logId: log._id
    });
});

exports.getAllActivities = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Number(req.query.page) || 1;
    const offset = (page - 1) * limit;

    // Get all processes sorted by createdAt (most recent first)
    const activities = await Process.find()
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean();

    const total = await Process.countDocuments();

    res.status(200).json({
        success: true,
        activities,
        pages: Math.ceil(total / limit)
    });
});
