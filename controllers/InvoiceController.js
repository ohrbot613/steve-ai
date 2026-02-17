const { fileTypeFromBuffer } = require("file-type");
const { tryCatchAsync, AppError } = require("./ErrorController");
const fs = require("fs");
const XLSX = require('xlsx');
const mongoose = require("mongoose");
const { PDFParse } = require("pdf-parse");
const { findMatchingCompanyWithAI, formatWithAIToStandardJSON, findMatchingCompanyWithAIFromAList, checkMultipleInvoiceNumbers, extractPotentialInvoiceIds, guessBestInvoiceIdFormat } = require("../formatting");
const axios = require("axios");
const Vendor = require("../modals/vendorModal");
const SupplierInvoice = require("../modals/supplierInvoiceModal");

// Aliases for compatibility - note: schema fields may not match exactly
// These will need to be updated to match actual schema or models need to be created
const Suppliers = Vendor;
const Invoices = SupplierInvoice;
const Statements = require("../modals/statementsModal");
const CustomerInvoice = require("../modals/customerInvoiceModal");
// const Job = require("../modals/jobModal");
const Process = require("../modals/processModal");
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // for unique IDs
const multer = require('multer');
const { type } = require("os");

const storage = multer.memoryStorage();


// File filter to only accept PDF and XLSX
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true); // accept file
    } else {
        cb(new Error('Only PDF and XLSX files are allowed'), false); // reject file
    }
};

exports.upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB per file
        files: 50
    }
});

// Verify file signatures to prevent spoofed mimetypes
exports.validateUploadedFiles = tryCatchAsync(async (req, res, next) => {
    const files = req.files && req.files.length > 0 ? req.files : (req.file ? [req.file] : []);
    if (files.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'No files uploaded'
        });
    }

    for (const file of files) {
        const detected = await fileTypeFromBuffer(file.buffer);
        const isPdf = detected?.ext === 'pdf' && detected?.mime === 'application/pdf';
        const isXlsx = detected?.ext === 'xlsx' && detected?.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        if (!isPdf && !isXlsx) {
            return res.status(400).json({
                success: false,
                message: 'Invalid file type. Only PDF and XLSX files are allowed.'
            });
        }
    }

    next();
});

// Middleware to handle multer errors and log them to database
exports.handleMulterError = async (err, req, res, next) => {
    if (err) {
        // Create log entry for multer error
        try {
            const fileName = req.file?.originalname || 'unknown';
            const fileSize = req.file?.size || 0;
            const fileMimetype = req.file?.mimetype || 'unknown';

            const logDoc = await Statements.create({
                tenant: req.user?.tenant,
                status: 'failed',
                file: fileName,
                errors: [{
                    timestamp: new Date(),
                    step: 'multer_file_upload',
                    message: err.message || String(err),
                    stack: err.stack || undefined,
                    details: {
                        fileName: fileName,
                        fileSize: fileSize,
                        fileMimetype: fileMimetype,
                        multerError: true,
                    }
                }],
                errorMessage: err.message || String(err),
                errorStack: err.stack || undefined,
                errorTimestamp: new Date(),
                errorDetails: {
                    fileName: fileName,
                    fileSize: fileSize,
                    fileMimetype: fileMimetype,
                    multerError: true,
                }
            });

            return res.status(400).json({
                success: false,
                message: err.message || 'File upload error',
                logId: logDoc._id.toString()
            });
        } catch (logError) {
            console.error('Failed to log multer error to database:', logError);
            // Fallback response if logging fails
            return res.status(400).json({
                success: false,
                message: err.message || 'File upload error'
            });
        }
    }
    next();
};




exports.getInvoices = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Number(req.query.page) || 1;
    const id = req.query.id;
    const sortBy = req.query.sortBy || 'systemDate';
    const sortOrder = req.query.sortOrder || 'asc';
    const paymentFilter = req.query.paymentFilter || 'all'; // 'all', 'paid', 'unpaid'
    const offset = (page - 1) * limit;

    // Map frontend sort fields to database fields
    const sortFieldMap = {
        'referenceId': 'invoiceNumber',
        'supplierDate': 'VendorDate',
        'systemDate': 'xeroDate',
        'supplierAmount': 'vendorAmount',
        'systemAmount': 'xeroAmount',
        'paymentStatus': 'paymentStatus'
    };

    // Get the actual database field to sort by
    const dbSortField = sortFieldMap[sortBy] || 'xeroDate';

    // Build sort object (skip if sorting by computed fields)
    let sortObj = {};
    if (sortBy !== 'foundInSystem' && sortBy !== 'status') {
        sortObj[dbSortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
        // Default sort for in-memory sorting
        sortObj = { xeroDate: sortOrder === 'desc' ? -1 : 1 };
    }

    // Build base query
    let baseQuery = {
        statementId: id,
        isDeleted: { $ne: true }
    };

    // Add payment status filter
    if (paymentFilter === 'paid') {
        baseQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        baseQuery.paymentStatus = 'unpaid';
    }

    // #region agent log
    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:141',message:'Before populate - checking schema paths',data:{schemaPaths:Object.keys(Invoices.schema.paths),query:baseQuery},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const invoices = await Invoices.find(baseQuery)
        .sort(sortObj)
        .populate('vendorId')
        .populate('statementId')
        .skip(offset)
        .limit(limit);
    // #region agent log
    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:147',message:'After populate query (should fail here)',data:{invoiceCount:invoices?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

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

    // If sorting by foundInSystem, we need to sort in-memory since it's a computed field
    if (sortBy === 'foundInSystem') {
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
        statementId: id,
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

exports.getAllInvoices = tryCatchAsync(async (req, res) => {
    const limit = 50;
    const page = Number(req.query.page) || 1;
    const sortBy = req.query.sortBy || 'addedAt';
    const sortOrder = req.query.sortOrder || 'desc';
    const filter = req.query.filter || 'all'; // 'all', 'matched', 'missed' (amounts don't match), 'unmatched' (not found in Xero)
    const paymentFilter = req.query.paymentFilter || 'all'; // 'all', 'paid', 'unpaid'
    const offset = (page - 1) * limit;

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

    // Helper function to check if invoice matches filter criteria
    function matchesFilter(invoice) {
        const supplierAmount = invoice.vendorAmount;
        const systemAmount = invoice.xeroAmount;
        const hasXeroDate = invoice.xeroDate != null;

        if (filter === 'all') {
            return true;
        } else if (filter === 'missed') {
            // Found in Xero BUT amounts don't match (or amounts missing)
            if (!hasXeroDate) return false;
            if (supplierAmount == null || systemAmount == null) return true;
            const tolerance = 0.01;
            const difference = Math.abs(supplierAmount - systemAmount);
            return difference > tolerance;
        } else if (filter === 'matched') {
            // Found in Xero AND amounts match
            if (!hasXeroDate) return false;
            if (supplierAmount == null || systemAmount == null) return false;
            const tolerance = 0.01;
            const difference = Math.abs(supplierAmount - systemAmount);
            return difference <= tolerance;
        } else if (filter === 'unmatched') {
            // Not found in Xero
            return !hasXeroDate;
        }
        return true;
    }

    // Build base query
    let baseQuery = {
        isDeleted: { $ne: true }
    };

    // Add filter conditions for 'unmatched' (can be done at DB level - not found in Xero)
    if (filter === 'unmatched') {
        baseQuery.xeroDate = null;
    } else if (filter === 'matched' || filter === 'missed') {
        // For matched/missed, we need xeroDate to exist
        baseQuery.xeroDate = { $ne: null };
    }

    // Add payment status filter
    if (paymentFilter === 'paid') {
        baseQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        baseQuery.paymentStatus = 'unpaid';
    }
    // If paymentFilter is 'all', don't add any payment status condition

    // Build sort object (skip if sorting by supplier, difference, foundInXero, or status)
    let sortObj = {};
    if (sortBy !== 'supplier' && sortBy !== 'difference' && sortBy !== 'foundInXero' && sortBy !== 'status') {
        sortObj[dbSortField] = sortOrder === 'desc' ? -1 : 1;
    } else {
        // Default sort for in-memory sorting
        sortObj = { createdAt: -1 };
    }

    // Fetch invoices with base query
    // #region agent log
    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:320',message:'Before populate - checking schema paths',data:{schemaPaths:Object.keys(Invoices.schema.paths),query:baseQuery},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    let invoices = await Invoices.find(baseQuery)
        .sort(sortObj)
        .skip(offset)
        .limit(limit * 2) // Fetch more to account for filtering
        .populate('vendorId')
        .populate('statementId');
    // #region agent log
    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:328',message:'After populate query (should fail here)',data:{invoiceCount:invoices?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    // Apply additional filtering for matched/missed (requires amount comparison)
    if (filter === 'matched' || filter === 'missed') {
        invoices = invoices.filter(matchesFilter);
    }

    // Sort in-memory for computed fields or populated fields
    if (sortBy === 'supplier') {
        invoices.sort((a, b) => {
            const aName = (a.vendorId?.name || '').toLowerCase();
            const bName = (b.vendorId?.name || '').toLowerCase();
            if (sortOrder === 'desc') {
                return bName.localeCompare(aName);
            } else {
                return aName.localeCompare(bName);
            }
        });
    } else if (sortBy === 'difference') {
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

    // Limit to requested page size after filtering
    invoices = invoices.slice(0, limit);

    // Count total matching invoices for pagination
    let totalQuery = {
        isDeleted: { $ne: true }
    };
    
    if (filter === 'unmatched') {
        totalQuery.xeroDate = null;
    } else if (filter === 'matched' || filter === 'missed') {
        totalQuery.xeroDate = { $ne: null };
    }

    // Add payment status filter to total query
    if (paymentFilter === 'paid') {
        totalQuery.paymentStatus = 'paid';
    } else if (paymentFilter === 'unpaid') {
        totalQuery.paymentStatus = 'unpaid';
    }

    // For matched/missed, we need to count after filtering
    let total;
    if (filter === 'matched' || filter === 'missed') {
        // Get all invoices matching the base query to count filtered results
        // #region agent log
        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:386',message:'Before populate - checking schema paths',data:{schemaPaths:Object.keys(Invoices.schema.paths),query:totalQuery},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        const allMatchingInvoices = await Invoices.find(totalQuery)
            .populate('vendorId')
            .populate('statementId');
        // #region agent log
        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:391',message:'After populate query (should fail here)',data:{invoiceCount:allMatchingInvoices?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        const filteredInvoices = allMatchingInvoices.filter(matchesFilter);
        total = filteredInvoices.length;
    } else {
        total = await Invoices.countDocuments(totalQuery);
    }

    res.status(200).json({
        success: true,
        invoices,
        pages: Math.ceil(total / limit)
    });
});

exports.deleteInvoice = tryCatchAsync(async (req, res) => {
    const invoiceId = req.params.id;

    if (!invoiceId) {
        return res.status(400).json({
            success: false,
            message: 'Invoice ID is required'
        });
    }

    // Find the invoice
    const invoice = await Invoices.findById(invoiceId);

    if (!invoice) {
        return res.status(404).json({
            success: false,
            message: 'Invoice not found'
        });
    }

    // Get the statement ID before deleting
    const logId = invoice.statementId;

    // Determine if invoice is matched (has both invoiceDate and invoiceXeroDate) or unmatched
    const isMatched = invoice.invoiceDate != null && invoice.invoiceXeroDate != null;
    const isUnmatched = invoice.invoiceDate != null && invoice.invoiceXeroDate == null;

    // Mark the invoice as deleted
    await Invoices.updateOne({ _id: invoiceId }, { isDeleted: true });

    // Update log counts
    if (logId) {
        const updateFields = {
            $inc: { total: -1 }
        };

        if (isMatched) {
            updateFields.$inc.matched = -1;
        } else if (isUnmatched) {
            updateFields.$inc.unmatched = -1;
        }

        await Statements.updateOne({ _id: logId }, updateFields);
    }

    res.status(200).json({
        success: true,
        message: 'Invoice deleted successfully'
    });
});

/**
 * Parse invoices from PDF or Excel files and return them
 * This route only parses files and returns invoice data without saving to database
 */
// Helper function to log errors to database
async function logErrorToDatabase(processDoc, step, error, additionalDetails = {}, statementId = null) {
    try {
        if (processDoc && processDoc._id) {
            // Add statement ID to processId array if provided and not already present
            if (statementId) {
                const statementIdStr = statementId.toString();
                await Process.findByIdAndUpdate(
                    processDoc._id,
                    {
                        $set: { status: 'failed' },
                        $addToSet: { processId: statementIdStr } // $addToSet only adds if not already present
                    }
                );
            } else {
                // Just update status if no statement ID
                await Process.findByIdAndUpdate(
                    processDoc._id,
                    { $set: { status: 'failed' } }
                );
            }
        }
    } catch (logError) {
        // If logging fails, at least log to console
        console.error('Failed to log error to database:', logError);
        console.error('Original error:', error);
    }
    return processDoc;
}

// Helper function to process a single invoice file
async function processSingleInvoiceFile(file, reqContext) {
    // This function contains the extracted logic from parseInvoices
    // It processes a single file and returns the result object (doesn't send response)
    // #region agent log
    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:487',message:'processSingleInvoiceFile entry',data:{fileName:file?.originalname,reqContextKeys:Object.keys(reqContext),hasXeroToken:!!reqContext?.xeroAccessToken,hasTenantId:!!reqContext?.xeroTenantId,hasProcessDoc:!!reqContext?.processDoc,currentFileIndex:reqContext?.currentFileIndex,totalFiles:reqContext?.totalFiles},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const xeroAccessToken = reqContext.xeroAccessToken;
    const xeroTenantId = reqContext.xeroTenantId;
    
    // Create log entry at the very start - before any processing
    let logDoc = null;
    const fileName = file?.originalname || 'unknown';
    const fileSize = file?.size || 0;
    const fileMimetype = file?.mimetype || 'unknown';

    try {
        // Create initial log entry
        logDoc = await Statements.create({
            tenant: reqContext?.tenant,
            status: 'started',
            file: fileName,
    
        });
        
        // Add statement ID to process
        if (reqContext.processDoc && logDoc && logDoc._id) {
            try {
                await Process.findByIdAndUpdate(
                    reqContext.processDoc._id,
                    {
                        $addToSet: { processId: logDoc._id.toString() }
                    }
                );
            } catch (processUpdateError) {
                console.error('Failed to add statement ID to process:', processUpdateError);
            }
        }
    } catch (logCreationError) {
        console.error('Failed to create initial log entry:', logCreationError);
        // Continue anyway - we'll try to create log later if needed
    }

    const fileBuffer = file.buffer;

    // Helper function for logging (only in development)
    const isDevelopment = process.env.NODE_ENV !== 'production';
    function log(...args) {
        if (isDevelopment) {
            console.log(...args);
        }
    }

    // Helper function for retry logic with error context passing
    async function retryWithBackoff(logic, maxAttempts = 3, errorMessage = 'Operation failed', getErrorContext = null, stepName = 'retry_operation') {
        let attempts = 0;
        let lastError;
        let errorContext = null;

        while (attempts < maxAttempts) {
            attempts++;
            try {
                // Pass error context to logic function if available
                return await logic(errorContext);
            } catch (err) {
                lastError = err;
                log(`Attempt ${attempts} failed:`, err.message);

                // Log each failed attempt to database
                try {
                    await logErrorToDatabase(reqContext.processDoc, `${stepName}_attempt_${attempts}`, err, {
                        fileName: fileName,
                        attempt: attempts,
                        maxAttempts: maxAttempts,
                    }, logDoc?._id);
                } catch (logErr) {
                    // If logging fails, continue anyway
                    console.error('Failed to log retry attempt error:', logErr);
                }

                // Get error context for next attempt if function provided
                if (getErrorContext && attempts < maxAttempts) {
                    errorContext = getErrorContext(err);
                    log(`   - Retrying with error context: ${errorContext}`);
                }

                if (attempts < maxAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                }
            }
        }

        const finalError = new Error(`${errorMessage} after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
        // Log final failure
        try {
            await logErrorToDatabase(reqContext.processDoc, `${stepName}_final_failure`, finalError, {
                fileName: fileName,
                attempts: maxAttempts,
                lastError: lastError?.message,
            }, logDoc?._id);
        } catch (logErr) {
            console.error('Failed to log final retry failure:', logErr);
        }
        throw finalError;
    }

    // Helper function to parse AI response
    function parseAIResponse(format, source) {
        // Clean up the response - remove markdown code blocks if present
        let cleanedFormat = format.replace(/```json/gi, '').replace(/```/gi, '').trim();

        // Try to parse JSON
        let invoicesObj;
        try {
            invoicesObj = JSON.parse(cleanedFormat);
        } catch (parseError) {
            // If parsing fails, try to extract JSON from the response
            const jsonMatch = cleanedFormat.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                invoicesObj = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error(`Unable to extract valid JSON from ${source} AI response`);
            }
        }

        // Validate structure
        if (!invoicesObj || !invoicesObj.invoices || !Array.isArray(invoicesObj.invoices)) {
            throw new Error(`Invalid invoice structure returned from ${source} AI`);
        }

        // Process invoices and ensure each has a unique invoice number
        const processedInvoices = invoicesObj.invoices.map((inv, index) => ({
            invoiceDate: inv.invoiceDate || null,
            invoiceNumber: inv.invoiceNumber || null,
            potentialInvoiceIds: Array.isArray(inv.potentialInvoiceIds) ? inv.potentialInvoiceIds : 
                (inv.invoiceNumber ? [inv.invoiceNumber] : []),
            activityDescription: inv.activityDescription || null,
            amount: {
                amount: typeof inv.amount?.amount === 'number' ? inv.amount.amount :
                    typeof inv.amount === 'number' ? inv.amount : null,
            },
            currency: inv.currency || null,
            paymentStatus: inv.paymentStatus || null
        }));

        // Validate unique invoice numbers
        const invoiceNumberMap = new Map();
        const duplicates = [];
        const invoiceNumbers = new Set();

        processedInvoices.forEach((inv, index) => {
            const invNum = inv.invoiceNumber;
            if (invNum) {
                invoiceNumbers.add(invNum);
                if (invoiceNumberMap.has(invNum)) {
                    duplicates.push({
                        invoiceNumber: invNum,
                        indices: [invoiceNumberMap.get(invNum), index]
                    });
                } else {
                    invoiceNumberMap.set(invNum, index);
                }
            }
        });

        // Check if ALL invoices share the same invoice number (single invoice with multiple line items)
        // If so, combine them into one invoice
        if (duplicates.length > 0 && invoiceNumbers.size === 1) {
            const singleInvoiceNumber = Array.from(invoiceNumbers)[0];
            log(`   - All ${processedInvoices.length} rows share the same invoice number "${singleInvoiceNumber}"`);
            log(`   - Combining into a single invoice`);

            // Combine all invoices into one - sum all amounts together
            let totalAmount = 0;
            let totalTaxFees = 0;

            processedInvoices.forEach(inv => {
                // Add up the amount
                const amount = inv.amount?.amount;
                if (typeof amount === 'number') {
                    totalAmount += amount;
                }

                // Add up the tax_fees
                const tax = inv.amount?.tax_fees;
                if (typeof tax === 'number') {
                    totalTaxFees += tax;
                }
            });

            // Collect all potential invoice IDs from all invoices being combined
            const allPotentialIds = new Set();
            processedInvoices.forEach(inv => {
                if (inv.potentialInvoiceIds && Array.isArray(inv.potentialInvoiceIds)) {
                    inv.potentialInvoiceIds.forEach(id => allPotentialIds.add(id));
                }
                if (inv.invoiceNumber) {
                    allPotentialIds.add(inv.invoiceNumber);
                }
            });
            
            const combinedInvoice = {
                invoiceDate: processedInvoices[0]?.invoiceDate || null,
                invoiceNumber: singleInvoiceNumber,
                potentialInvoiceIds: Array.from(allPotentialIds),
                activityDescription: processedInvoices
                    .map(inv => inv.activityDescription)
                    .filter(Boolean)
                    .join('; ') || processedInvoices[0]?.activityDescription || null,
                amount: {
                    amount: totalAmount,
            
                },
                currency: processedInvoices[0]?.currency || null,
                paymentStatus: processedInvoices[0]?.paymentStatus || null
            };

            return {
                fileDate: invoicesObj.fileDate || null,
                invoices: [combinedInvoice]
            };
        }

        // If duplicates found but not all are the same, merge them by invoice number
        if (duplicates.length > 0) {
            log(`   - Duplicate invoice numbers detected, merging into single items`);
            
            // Group invoices by invoice number
            const invoiceGroups = new Map();
            
            processedInvoices.forEach((inv, index) => {
                const invNum = inv.invoiceNumber;
                if (invNum) {
                    if (!invoiceGroups.has(invNum)) {
                        invoiceGroups.set(invNum, []);
                    }
                    invoiceGroups.get(invNum).push(inv);
                }
                // Invoices without invoice numbers are not considered duplicates
                // They will be kept separate (handled below)
            });
            
            // Combine invoices with the same invoice number
            const mergedInvoices = [];
            
            invoiceGroups.forEach((group, invNum) => {
                if (group.length === 1) {
                    // No duplicates, keep as-is
                    mergedInvoices.push(group[0]);
                } else {
                    // Multiple invoices with same number - merge them
                    log(`   - Merging ${group.length} invoices with invoice number "${invNum}"`);
                    
                    let totalAmount = 0;
                    let totalTaxFees = 0;
                    const descriptions = [];
                    
                    group.forEach(inv => {
                        // Sum amounts
                        const amount = inv.amount?.amount;
                        if (typeof amount === 'number') {
                            totalAmount += amount;
                        }
                        
                                        
                        // Collect descriptions
                        if (inv.activityDescription) {
                            descriptions.push(inv.activityDescription);
                        }
                    });
                    
                    // Collect all potential invoice IDs from all invoices being merged
                    const allPotentialIds = new Set();
                    group.forEach(inv => {
                        if (inv.potentialInvoiceIds && Array.isArray(inv.potentialInvoiceIds)) {
                            inv.potentialInvoiceIds.forEach(id => allPotentialIds.add(id));
                        }
                        if (inv.invoiceNumber) {
                            allPotentialIds.add(inv.invoiceNumber);
                        }
                    });
                    
                    const mergedInvoice = {
                        invoiceDate: group[0]?.invoiceDate || null,
                        invoiceNumber: invNum,
                        potentialInvoiceIds: Array.from(allPotentialIds),
                        activityDescription: descriptions.filter(Boolean).join('; ') || group[0]?.activityDescription || null,
                        amount: {
                            amount: totalAmount,
                        },
                        currency: group[0]?.currency || null,
                        paymentStatus: group[0]?.paymentStatus || null
                    };
                    
                    mergedInvoices.push(mergedInvoice);
                }
            });
            
            // Add invoices without invoice numbers separately (they are not duplicates)
            processedInvoices.forEach(inv => {
                if (!inv.invoiceNumber) {
                    mergedInvoices.push(inv);
                }
            });
            
            return {
                fileDate: invoicesObj.fileDate || null,
                invoices: mergedInvoices
            };
        }

        return {
            fileDate: invoicesObj.fileDate || null,
            invoices: processedInvoices
        };
    }

    // Save file to disk
    function saveFile(fileBuffer, fileName) {
        const folderPath = path.join(__dirname, "../../steve_files_do_not_delete");
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }

        const fileExtension = path.extname(fileName) || '.pdf';
        const uniqueName = uuidv4() + fileExtension;
        const savePath = path.join(folderPath, uniqueName);
        fs.writeFileSync(savePath, fileBuffer);
        return uniqueName;
    }

    // Delete old file from disk when duplicate is detected
    // Only deletes if the old log has no remaining invoices (excluding the current invoice being updated)
    async function deleteOldFile(oldLogId, currentInvoiceId) {
        try {
            if (!oldLogId) return;
            
            // Check if there are any other invoices still using this log (excluding the current one being updated)
            const query = {
                log: oldLogId,
                isDeleted: { $ne: true }
            };
            
            if (currentInvoiceId) {
                query._id = { $ne: currentInvoiceId };
            }
            
          
            
            const oldLog = await Statements.findById(oldLogId).select('file').lean();
            if (!oldLog || !oldLog.file) return;
            
            const folderPath = path.join(__dirname, "../../steve_files_do_not_delete");
            const oldFilePath = path.join(folderPath, oldLog.file);
            
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
                log(`   🗑️  Deleted old file: ${oldLog.file}`);
            }
        } catch (deleteError) {
            // Log error but don't fail the process
            log(`   ⚠️  Failed to delete old file: ${deleteError.message}`);
        }
    }

    // Helper function to extract text from image-based PDF using AI vision
    async function extractTextFromImagePDF(fileBuffer, fileName) {
        console.log('[extractTextFromImagePDF] Starting AI vision extraction for image-based PDF:', fileName);
        
        // Get OpenRouter API key from environment
        const openRouterKey = process.env.OPEN_ROUTER;
        if (!openRouterKey) {
            throw new Error('OpenRouter API key not configured');
        }

        // Convert PDF buffer to base64 data URL format
        const base64Pdf = fileBuffer.toString('base64');
        const fileDataUrl = `data:application/pdf;base64,${base64Pdf}`;

        console.log(`[extractTextFromImagePDF] Processing file: ${fileName}, size: ${fileBuffer.length} bytes`);

        try {
            const extractionPrompt = `You are an expert at extracting text from scanned/image-based PDF documents using OCR. Your task is to extract ALL text content from this PDF document with 100% accuracy.

CRITICAL REQUIREMENTS:
1. Extract EVERY piece of text visible in the document - do not skip anything
2. Process ALL pages in the document - extract text from every single page
3. Preserve the EXACT text as it appears - do not modify, summarize, or interpret
4. Maintain original formatting, spacing, and line breaks where possible
5. Extract text from ALL areas: headers, footers, body content, tables, sidebars, margins
6. Preserve ALL numbers exactly as shown (including leading zeros, decimal points, currency symbols)
7. Preserve ALL dates exactly as shown (do not reformat dates)
8. Preserve ALL special characters, symbols, and punctuation exactly
9. Extract text from tables maintaining their structure and alignment
10. Include ALL labels, headers, column names, and metadata
11. Do NOT skip any text, even if it seems redundant or appears multiple times
12. Do NOT summarize or paraphrase - extract the literal text only
13. If text is unclear or partially visible, include what you can see and mark uncertainty with [unclear] if needed

EXTRACTION GUIDELINES:
- For tables: Extract all cell contents, maintaining row and column structure
- For headers/footers: Include all text even if it repeats on multiple pages
- For invoices/statements: Extract ALL invoice numbers, dates, amounts, descriptions, references
- For multi-page documents: Extract text from every page in order
- For mixed content: Extract both structured data (tables) and unstructured text (paragraphs)
- For numbers: Preserve exact format (e.g., "001234" not "1234", "$1,234.56" not "1234.56")
- For dates: Preserve exact format (e.g., "15/10/2024" not "2024-10-15")
- For codes/IDs: Preserve exactly as shown including hyphens, letters, case (e.g., "INV-2024-001")

OUTPUT FORMAT:
Return ONLY the extracted text content. Do not include:
- Explanations or commentary
- Markdown formatting
- Code blocks
- Any text that wasn't in the original document

Just return the raw extracted text exactly as it appears in the document, maintaining readability and structure.`;

            const requestBody = {
                model: 'google/gemini-2.5-flash',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: extractionPrompt,
                            },
                            {
                                type: 'file',
                                file: {
                                    filename: fileName,
                                    file_data: fileDataUrl,
                                },
                            },
                        ],
                    },
                ],
                plugins: [
                    {
                        id: 'file-parser',
                        pdf: {
                            engine: 'mistral-ocr',
                        },
                    },
                ],
            };

            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                requestBody,
                {
                    headers: {
                        Authorization: `Bearer ${openRouterKey}`,
                        'Content-Type': 'application/json',
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                }
            );

            // Extract the text content from the response
            const extractedText = response.data?.choices?.[0]?.message?.content || '';
            const trimmedText = extractedText.trim();
            
            console.log(`[extractTextFromImagePDF] API response received`);
            console.log(`[extractTextFromImagePDF] Extracted text length: ${extractedText.length} characters`);
            console.log(`[extractTextFromImagePDF] Trimmed text length: ${trimmedText.length} characters`);
            
            // Validate that we got meaningful text
            if (!extractedText || trimmedText.length === 0) {
                console.error(`[extractTextFromImagePDF] ERROR: No text extracted from PDF`);
                throw new Error('AI vision extraction returned empty text. The PDF may be unreadable or the OCR engine failed.');
            }
            
            // Check if the response looks like an error message rather than extracted text
            const lowerText = extractedText.toLowerCase();
            if (lowerText.includes('error') && lowerText.includes('cannot') || 
                lowerText.includes('unable to') && lowerText.length < 200) {
                console.warn(`[extractTextFromImagePDF] WARNING: Response may be an error message: ${extractedText.substring(0, 200)}`);
            }
            
            // Log a sample of extracted text for debugging (first 500 characters)
            console.log(`[extractTextFromImagePDF] Sample of extracted text (first 500 chars):`);
            console.log(extractedText.substring(0, 500));
            
            return extractedText;
        } catch (error) {
            console.error(`[extractTextFromImagePDF] Error calling OpenRouter API:`, error.message);
            
            // Provide more detailed error information
            if (error.response) {
                console.error(`[extractTextFromImagePDF] API Response Status:`, error.response.status);
                console.error(`[extractTextFromImagePDF] API Response Data:`, JSON.stringify(error.response.data, null, 2));
                throw new Error(`Failed to extract text from image-based PDF: API returned status ${error.response.status}. ${error.response.data?.error?.message || error.message}`);
            } else if (error.request) {
                console.error(`[extractTextFromImagePDF] No response received from API`);
                throw new Error(`Failed to extract text from image-based PDF: No response from AI vision service. Please check your network connection and API key.`);
            } else {
                throw new Error(`Failed to extract text from image-based PDF using AI vision: ${error.message}`);
            }
        }
    }

    // Parse file based on type
    async function parseFile(fileBuffer, fileName) {
        console.log('[parseFile] Step 1: Starting file parsing for:', fileName);
        console.log('[parseFile] Step 2: File buffer size:', fileBuffer?.length, 'bytes');
        
        const fileType = await fileTypeFromBuffer(fileBuffer);
        console.log('[parseFile] Step 3: Detected file type:', fileType);

        if (!fileType) {
            console.log('[parseFile] ERROR: Unable to determine file type');
            throw new Error('Unable to determine file type');
        }

        console.log('[parseFile] Step 4: File extension is:', fileType.ext);

        if (fileType.ext === 'xlsx' || fileType.ext === 'xls') {
            console.log('[parseFile] Step 5: Processing Excel file');
            // Parse Excel file from buffer
            const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
            console.log('[parseFile] Step 6: Workbook loaded, sheet names:', workbook.SheetNames);
            const allRecords = [];

            workbook.SheetNames.forEach(sheetName => {
                console.log('[parseFile] Step 7: Processing sheet:', sheetName);
                const sheet = workbook.Sheets[sheetName];
                const records = XLSX.utils.sheet_to_json(sheet, {
                    defval: null,
                    raw: false, // Convert all values to strings for better AI processing
                    dateNF: 'yyyy-mm-dd' // Date format
                });
                console.log('[parseFile] Step 8: Found', records.length, 'records in sheet:', sheetName);
                records.forEach(r => {
                    r.sheetName = sheetName;
                    r._source = 'excel';
                });
                allRecords.push(...records);
            });

            console.log('[parseFile] Step 9: Total Excel records:', allRecords.length);
            console.log('[parseFile] Step 10: Returning Excel data');
            return {
                type: 'excel',
                data: allRecords,
                raw: JSON.stringify(allRecords, null, 2)
            };
        } else if (fileType.ext === 'pdf') {
            console.log('[parseFile] Step 5: Processing PDF file');
            // Parse PDF file from buffer
            const parser = new PDFParse({ data: fileBuffer });
            console.log('[parseFile] Step 6: PDF parser created');
            
            const fileData = await parser.getText();
            console.log('[parseFile] Step 7: PDF text extracted, length:', fileData?.text?.length, 'characters');
            console.log('[parseFile] Step 7b: RAW PDF DATA START ===============');
            console.log(fileData?.text);
            console.log('[parseFile] Step 7c: RAW PDF DATA END =================');
            
            // Check if PDF is image-based (scanned PDF with no extractable text)
            const extractedText = fileData?.text || '';
            const trimmedText = extractedText.trim();
            
            // If text is empty or very minimal (less than 50 characters), it's likely image-based
            if (trimmedText.length < 50) {
                console.log('[parseFile] PDF appears to be image-based (scanned PDF) - using AI vision to extract text');
                if (parser.destroy) {
                    await parser.destroy();
                }
                
                // Use AI vision to extract text from image-based PDF
                const aiExtractedText = await extractTextFromImagePDF(fileBuffer, fileName);
                
                if (!aiExtractedText || aiExtractedText.trim().length === 0) {
                    throw new Error('Failed to extract text from image-based PDF. The AI vision extraction returned no text.');
                }
                
                console.log('[parseFile] Step 9: Returning PDF data (extracted via AI vision)');
                return {
                    type: 'pdf',
                    data: aiExtractedText,
                    raw: aiExtractedText
                };
            }
            
            if (parser.destroy) {
                console.log('[parseFile] Step 8: Destroying PDF parser');
                await parser.destroy();
            }

            console.log('[parseFile] Step 9: Returning PDF data');
            return {
                type: 'pdf',
                data: fileData.text,
                raw: fileData.text
            };
        } else {
            console.log('[parseFile] ERROR: Unsupported file type:', fileType.ext);
            throw new Error(`Unsupported file type: ${fileType.ext}. Only PDF and Excel files are supported.`);
        }
    }

    // Helper function to convert fileDate to valid Date
    function toValidDate(value) {
        if (!value) return null;
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date;
    }

    // Enhanced company name extraction and variation generation
    function generateCompanyVariations(companyName) {
        if (!companyName || companyName.trim().length === 0) {
            return [];
        }

        const variations = new Set();
        const cleanName = companyName.trim();

        // Add original
        variations.add(cleanName);

        // Remove common suffixes and add variations
        const suffixes = ['ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'plc', 'pty', 'pty ltd'];
        let baseName = cleanName;
        for (const suffix of suffixes) {
            const regex = new RegExp(`\\s+${suffix}\\.?$`, 'i');
            if (regex.test(baseName)) {
                baseName = baseName.replace(regex, '').trim();
                variations.add(baseName);
                variations.add(`${baseName} ${suffix}`);
                variations.add(`${baseName} ${suffix}.`);
            }
        }

        // Split into words and create variations
        const words = cleanName.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0);

        if (words.length > 0) {
            // All words
            variations.add(words.join(' '));
            variations.add(words.join('').toLowerCase());

            // Case variations
            variations.add(words.map(w => w.toLowerCase()).join(' '));
            variations.add(words.map(w => w.toUpperCase()).join(' '));
            variations.add(words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '));

            // Individual words (for partial matching)
            words.forEach(word => {
                if (word.length > 2) {
                    variations.add(word.toLowerCase());
                    variations.add(word.toUpperCase());
                    variations.add(word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
                }
            });

            // First word + last word (common pattern)
            if (words.length > 1) {
                variations.add(`${words[0]} ${words[words.length - 1]}`);
            }
        }

        return Array.from(variations).filter(v => v.length > 0);
    }

    // Extract company name from document
    async function extractCompanyName(fileName, content) {
        const email = ''; // Can be extracted from request if available
        const contentPreview = typeof content === 'string'
            ? content.substring(0, 3000)
            : JSON.stringify(content).substring(0, 3000);

        const companyName = await retryWithBackoff(async () => {
            const name = await findMatchingCompanyWithAI(email, fileName, contentPreview);
            return name && name.trim().length > 0 ? name.trim() : null;
        }, 3, 'Failed to extract company name');

        return companyName;
    }

    // Find matching Xero contact (if Xero credentials available)
    async function findXeroContact(companyName, fileName, accessToken, tenantId) {
        if (!accessToken || !tenantId || !companyName) {
            return null;
        }

        try {
            const variations = generateCompanyVariations(companyName);
            const searchTerms = variations
                .filter(term => term.trim().length > 0 && term.length > 2)
                .slice(0, 20); // Limit to avoid URL length issues

            if (searchTerms.length === 0) {
                return null;
            }

            // Build Xero query
            const filter = searchTerms
                .map(term => `Name.Contains("${encodeURIComponent(term)}")`)
                .join(" OR ");

            const url = `https://api.xero.com/api.xro/2.0/Contacts?where=${filter}`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json'
                },
                timeout: 10000
            });

            const allContacts = response?.data?.Contacts || [];
            const contactsWithBalance = allContacts.filter(ct => ct.Balances);
            if (contactsWithBalance.length === 0) {
                log(`   - Found ${allContacts.length} contacts but none with balances`);
                return null;
            }

            // Use AI to find best match
            const bestMatch = await retryWithBackoff(async () => {
                const matchResult = await findMatchingCompanyWithAIFromAList(
                    companyName,
                    fileName,
                    '',
                    contactsWithBalance
                );

                // Extract JSON from response, handling cases where there's text before/after the JSON
                const cleaned = matchResult.replace(/```json/gi, '').replace(/```/gi, '').trim();
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error("No JSON object found in AI response");
                }
                const matchData = JSON.parse(jsonMatch[0]);

                // Validate GUID format
                const isXeroContactId = (id) =>
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

                if (!isXeroContactId(matchData.id)) {
                    throw new Error("Invalid contact ID format");
                }


                return {
                    contactId: matchData.id,
                    contact: contactsWithBalance.find(ct => ct.ContactID === matchData.id)
                };
            }, 3, 'Failed to match company with Xero contact');

            return bestMatch;
        } catch (error) {
            log(`   - Xero contact search failed: ${error.message}`);
            return null;
        }
    }

    // Save file first
    let newFileName;
    try {
        newFileName = saveFile(fileBuffer, fileName);
        if (logDoc && logDoc._id) {
            await Statements.updateOne(
                { _id: logDoc._id },
                { $set: { file: newFileName } }
            );
        }
    } catch (saveError) {
        await logErrorToDatabase(reqContext.processDoc, 'file_save', saveError, {
            fileName: fileName,
            fileSize: fileSize,
        }, logDoc?._id);
        throw saveError;
    }

    let companyInfo = null;
    let supplierInfo = null;

    try {
        // Parse the file
        let parsedData;
        try {
            parsedData = await parseFile(fileBuffer, fileName);
        } catch (parseError) {
            await logErrorToDatabase(reqContext.processDoc, 'file_parsing', parseError, {
            fileName: fileName,
            savedFileName: newFileName,
            fileSize: fileSize,
            }, logDoc?._id);
            throw parseError;
        }
        log('\n=== PARSING FILE ===');
        log(`File: ${fileName}`);
        log(`Saved as: ${newFileName}`);
        log(`Type: ${parsedData.type}`);
        log(`Data length: ${parsedData.raw.length} characters\n`);

        // Extract company name first (needed for Xero contact lookup)
        log('=== EXTRACTING COMPANY NAME ===');
        let companyName;
        try {
            companyName = await extractCompanyName(fileName, parsedData.raw);
        } catch (companyError) {
            await logErrorToDatabase(reqContext.processDoc, 'company_extraction', companyError, {
                fileName: fileName,
                savedFileName: newFileName,
            }, logDoc?._id);
            companyName = null;
        }

        if (companyName) {
            log(`✅ Company Name: ${companyName}`);
            companyInfo = { name: companyName };

            // Find matching Xero contact (credentials are required via middleware)
            const accessToken = xeroAccessToken;
            const tenantId = xeroTenantId;

            log('=== SEARCHING XERO CONTACTS ===');
            let xeroMatch;
            try {
                xeroMatch = await findXeroContact(companyName, fileName, accessToken, tenantId);
            } catch (xeroError) {
                await logErrorToDatabase(reqContext.processDoc, 'xero_contact_search', xeroError, {
                    fileName: fileName,
                    companyName: companyName,
                }, logDoc?._id);
                xeroMatch = null;
            }

            
            if (xeroMatch) {
                log(`✅ Found Xero Contact: ${xeroMatch.contact.Name} (${xeroMatch.contactId})`);
                companyInfo.xeroContactId = xeroMatch.contactId;
                companyInfo.xeroContactName = xeroMatch.contact.Name;
                
                // Find or create vendor
                supplierInfo = await Vendor.findOne({ xeroId: xeroMatch.contactId });
                if (!supplierInfo) {
                    supplierInfo = await Vendor.create({
                        xeroId: xeroMatch.contactId,
                        name: xeroMatch.contact.Name,
                        email: xeroMatch.contact.EmailAddress
                    });
                    log(`✅ Created new vendor: ${supplierInfo.name}`);
                } else {
                    log(`✅ Found existing vendor: ${supplierInfo.name}`);
                }
                
                // Update statement with vendor ID
                if (logDoc && logDoc._id && supplierInfo && supplierInfo._id) {
                    await Statements.updateOne(
                        { _id: logDoc._id },
                        { $set: { vendor: supplierInfo._id } }
                    );
                }
            } else {
                log('⚠️  No matching Xero contact found');
            }
        } else {
            log('⚠️  Could not extract company name');
        }

        // Extract potential invoice IDs from file BEFORE checking if it's a list or single invoice
        log('\n=== EXTRACTING POTENTIAL INVOICE IDs ===');
        let potentialInvoiceIds = [];
        let selectedInvoiceIdFormat = null;
        
        try {
            // For Excel files, send more structured data; for PDFs, send more text
            let contentForIdExtraction;
            if (parsedData.type === 'excel') {
                // For Excel, send the full JSON structure (it's already structured)
                // Limit to first 50 rows to avoid token limits, but include all columns
                const excelData = parsedData.data || [];
                const limitedData = excelData.slice(0, 50); // First 50 rows should be enough
                contentForIdExtraction = JSON.stringify(limitedData, null, 2);
                if (excelData.length > 50) {
                    log(`   - Processing first 50 rows of ${excelData.length} total rows for ID extraction`);
                }
            } else {
                // For PDF, send more text (up to 15000 chars to get more context)
                contentForIdExtraction = typeof parsedData.raw === 'string'
                    ? parsedData.raw.substring(0, 15000)
                    : JSON.stringify(parsedData.raw).substring(0, 15000);
                if (parsedData.raw.length > 15000) {
                    log(`   - Processing first 15000 characters of ${parsedData.raw.length} total for ID extraction`);
                }
            }
            
            const extractedIds = await retryWithBackoff(
                async () => {
                    return await extractPotentialInvoiceIds(contentForIdExtraction, fileName);
                },
                3,
                'Failed to extract potential invoice IDs'
            );
            
            potentialInvoiceIds = extractedIds.potentialIds || [];
            log(`✅ Extracted ${potentialInvoiceIds.length} potential invoice IDs`);
            if (potentialInvoiceIds.length > 0) {
                log(`   - Sample IDs: ${potentialInvoiceIds.slice(0, 15).join(', ')}`);
                if (potentialInvoiceIds.length > 15) {
                    log(`   - ... and ${potentialInvoiceIds.length - 15} more`);
                }
            } else {
                log('⚠️  No invoice IDs extracted - this may affect matching accuracy');
            }
        } catch (idExtractionError) {
            await logErrorToDatabase(reqContext.processDoc, 'invoice_id_extraction', idExtractionError, {
                fileName: fileName,
                fileType: parsedData.type,
            }, logDoc?._id);
            log('⚠️  Failed to extract potential invoice IDs, continuing without ID matching');
        }

        // Get ALL invoices from Xero (not just unpaid) to check matches
        let allXeroInvoices = [];
        let xeroInvoiceNumbers = [];
        if (supplierInfo && companyInfo?.xeroContactId) {
            log('\n=== FETCHING ALL INVOICES FROM XERO (FOR ID MATCHING) ===');
            try {
                const accessToken = xeroAccessToken;
                const tenantId = xeroTenantId;
                const contactId = companyInfo.xeroContactId;

                async function getAllInvoicesFromXero() {
                    // Get a wider date range for ID matching (19 months ago)
                    const today = new Date();
                    const fromDateObj = new Date(today);
                    fromDateObj.setMonth(today.getMonth() - 19);
                    const fromDate = `${fromDateObj.getFullYear()},${String(fromDateObj.getMonth() + 1).padStart(2, '0')},${String(fromDateObj.getDate()).padStart(2, '0')}`;
                    
                    const where = `Contact.ContactID == Guid("${contactId}")`;
                    const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}`;
                    
                    const invoiceResponse = await axios.get(invoiceUrl, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Xero-tenant-id': tenantId,
                            Accept: 'application/json',
                        },
                    });

                    return invoiceResponse.data.Invoices || [];
                }

                allXeroInvoices = await getAllInvoicesFromXero();
                xeroInvoiceNumbers = allXeroInvoices.map(inv => inv.InvoiceNumber || '').filter(Boolean);
                
                log(`✅ Found ${allXeroInvoices.length} total invoices from Xero (including paid and unpaid)`);
                if (xeroInvoiceNumbers.length > 0) {
                    log(`   - Sample Invoice Numbers: ${xeroInvoiceNumbers.slice(0, 10).join(', ')}`);
                }
            } catch (xeroFetchError) {
                log(`⚠️  Failed to fetch Xero invoices for ID matching: ${xeroFetchError.message}`);
            }
        }

        // Check which potential IDs match in Xero
        function normalizeInvoiceNumberForMatching(invoiceNumber) {
            if (!invoiceNumber) return '';
            return invoiceNumber.toString().replace(/\D/g, '');
        }

        function getInvoiceNumberVariationsForMatching(invoiceNumber) {
            if (!invoiceNumber) return new Set();
            const variations = new Set();
            const normalized = invoiceNumber.toString().trim();
            
            variations.add(normalized);
            variations.add(normalized.toLowerCase());
            variations.add(normalized.toUpperCase());
            
            const digitsOnly = normalizeInvoiceNumberForMatching(normalized);
            if (digitsOnly) {
                variations.add(digitsOnly);
            }
            
            return variations;
        }

        let matchedIds = [];
        let unmatchedIds = [];
        
        if (potentialInvoiceIds.length > 0 && xeroInvoiceNumbers.length > 0) {
            log('\n=== CHECKING POTENTIAL IDs AGAINST XERO ===');
            
            // Create a map of Xero invoice numbers by all variations
            const xeroIdMap = new Map();
            xeroInvoiceNumbers.forEach(xeroId => {
                const variations = getInvoiceNumberVariationsForMatching(xeroId);
                variations.forEach(variation => {
                    if (variation) {
                        if (!xeroIdMap.has(variation)) {
                            xeroIdMap.set(variation, []);
                        }
                        xeroIdMap.get(variation).push(xeroId);
                    }
                });
            });

            // Check each potential ID
            potentialInvoiceIds.forEach(potentialId => {
                const variations = getInvoiceNumberVariationsForMatching(potentialId);
                let foundMatch = false;
                
                for (const variation of variations) {
                    if (xeroIdMap.has(variation)) {
                        matchedIds.push({
                            potentialId: potentialId,
                            matchedXeroIds: xeroIdMap.get(variation),
                            matchVariation: variation
                        });
                        foundMatch = true;
                        break;
                    }
                }
                
                if (!foundMatch) {
                    unmatchedIds.push(potentialId);
                }
            });

            log(`✅ Found ${matchedIds.length} potential IDs that match in Xero`);
            log(`⚠️  Found ${unmatchedIds.length} potential IDs that don't match in Xero`);
            
            if (matchedIds.length > 0) {
                log(`   - Matched IDs: ${matchedIds.slice(0, 5).map(m => m.potentialId).join(', ')}`);
            }
        }

        // If nothing matches, use AI to guess the best ID format
        if (matchedIds.length === 0 && potentialInvoiceIds.length > 0 && xeroInvoiceNumbers.length > 0) {
            log('\n=== NO MATCHES FOUND - USING AI TO GUESS BEST ID FORMAT ===');
            try {
                const formatGuess = await retryWithBackoff(
                    async () => {
                        return await guessBestInvoiceIdFormat(potentialInvoiceIds, xeroInvoiceNumbers, fileName);
                    },
                    3,
                    'Failed to guess invoice ID format'
                );
                
                selectedInvoiceIdFormat = formatGuess;
                log(`✅ AI Suggested Format: ${formatGuess.selectedFormat}`);
                log(`   - Example ID: ${formatGuess.exampleId}`);
                log(`   - Confidence: ${(formatGuess.confidence * 100).toFixed(1)}%`);
                log(`   - Reason: ${formatGuess.reason}`);
            } catch (guessError) {
                log(`⚠️  Failed to guess ID format: ${guessError.message}`);
                // Use first potential ID as fallback
                selectedInvoiceIdFormat = {
                    selectedFormat: 'exact_as_shown',
                    exampleId: potentialInvoiceIds[0] || '',
                    confidence: 0.5,
                    reason: 'Using first potential ID as fallback'
                };
            }
        } else if (matchedIds.length > 0) {
            // Use the most common matched ID format
            const idFrequency = new Map();
            matchedIds.forEach(match => {
                const id = match.potentialId;
                idFrequency.set(id, (idFrequency.get(id) || 0) + 1);
            });
            
            const mostCommonId = Array.from(idFrequency.entries())
                .sort((a, b) => b[1] - a[1])[0]?.[0];
            
            if (mostCommonId) {
                selectedInvoiceIdFormat = {
                    selectedFormat: 'matched_in_xero',
                    exampleId: mostCommonId,
                    confidence: 0.9,
                    reason: `Most common ID format that matches in Xero (${idFrequency.get(mostCommonId)} matches)`
                };
                log(`✅ Selected ID Format: ${mostCommonId} (most common match)`);
            }
        }

        // Check if file has multiple invoice numbers
        log('\n=== CHECKING INVOICE COUNT ===');
        let invoiceCountCheck;
        try {
            invoiceCountCheck = await retryWithBackoff(
                async () => {
                    // Use a preview of the content for the check (first 5000 characters should be enough)
                    const contentPreview = typeof parsedData.raw === 'string'
                        ? parsedData.raw.substring(0, 5000)
                        : JSON.stringify(parsedData.raw).substring(0, 5000);
                    return await checkMultipleInvoiceNumbers(contentPreview, fileName);
                },
                3,
                'Failed to check invoice count'
            );
        } catch (countCheckError) {
            await logErrorToDatabase(reqContext.processDoc, 'invoice_count_check', countCheckError, {
                fileName: fileName,
                savedFileName: newFileName,
            }, logDoc?._id);
            throw countCheckError;
        }

        console.log(invoiceCountCheck);


        log(`✅ Invoice Count Check (AI-based):`);
        log(`   - Has Multiple Invoices: ${invoiceCountCheck.hasMultipleInvoices}`);
        log(`   - Invoice Count: ${invoiceCountCheck.invoiceCount || 'Unknown'}`);
        log(`   - Reason: ${invoiceCountCheck.reason}\n`);

        // Format data with AI to extract invoices
        log('\n=== EXTRACTING INVOICES ===');
        if (invoiceCountCheck.hasMultipleInvoices === true) {
            log(`   - File contains MULTIPLE invoices - will extract each row separately`);
        } else if (invoiceCountCheck.hasMultipleInvoices === false) {
            log(`   - File contains SINGLE invoice - will extract from header/title`);
        }
        
        // Log selected ID format if available
        if (selectedInvoiceIdFormat) {
            log(`   - Using ID format: ${selectedInvoiceIdFormat.selectedFormat} (${selectedInvoiceIdFormat.exampleId})`);
        }
        
        // Log pre-extracted IDs that will be passed to AI
        if (potentialInvoiceIds.length > 0) {
            log(`   - Pre-extracted ${potentialInvoiceIds.length} potential IDs will be included: ${potentialInvoiceIds.slice(0, 10).join(', ')}${potentialInvoiceIds.length > 10 ? '...' : ''}`);
        }
        
        let formattedInvoices;
        try {
            formattedInvoices = await retryWithBackoff(
                async (errorContext) => {
                    // Pass the pre-extracted potential IDs to help the AI include them
                    const format = await formatWithAIToStandardJSON(parsedData.raw, fileName, errorContext, invoiceCountCheck, potentialInvoiceIds);
                    return parseAIResponse(format, 'AI');
                },
                3,
                'Failed to format invoices with AI',
                // Function to extract error context from the error
                (err) => {
                    // If error message contains duplicate information, pass it to AI
                    if (err.message && err.message.includes('Duplicate invoice numbers')) {
                        return err.message;
                    }
                    return null;
                }
            );
        } catch (aiFormatError) {
            await logErrorToDatabase(reqContext.processDoc, 'ai_formatting', aiFormatError, {
                fileName: fileName,
                savedFileName: newFileName,
                invoiceCountCheck: invoiceCountCheck,
            }, logDoc?._id);
            throw aiFormatError;
        }

        // Get file date and update existing log
        const fileDate = toValidDate(formattedInvoices.fileDate);
        if (logDoc && logDoc._id) {
            await Statements.updateOne(
                { _id: logDoc._id },
                {
                    $set: {
                        invoiceIssueDate: fileDate,
                        vendor: supplierInfo?._id || undefined
                    }
                }
            );
        } else {
            // Create log if it doesn't exist
            logDoc = await Statements.create({
                tenant: reqContext?.tenant,
                file: newFileName,
                invoiceIssueDate: fileDate,
                vendor: supplierInfo?._id || undefined,
            });
        }
        
        // Add statement ID to process
        if (reqContext.processDoc && logDoc && logDoc._id) {
            try {
                await Process.findByIdAndUpdate(
                    reqContext.processDoc._id,
                    {
                        $addToSet: { processId: logDoc._id.toString() }
                    }
                );
            } catch (processUpdateError) {
                console.error('Failed to add statement ID to process:', processUpdateError);
            }
        }

        log('✅ AI Extraction Success:');
        log(`   - File Date: ${formattedInvoices.fileDate}`);
        log(`   - Invoice Count: ${formattedInvoices.invoices.length}`);
        if (formattedInvoices.invoices.length > 0) {
            log(`   - Sample Invoice Numbers: ${formattedInvoices.invoices.slice(0, 5).map(i => i.invoiceNumber).filter(Boolean).join(', ')}`);
        }

        // Get invoices from Xero if supplier was found (use already fetched allXeroInvoices if available)
        let xeroInvoices = [];
        if (supplierInfo && companyInfo?.xeroContactId) {
            log('\n=== FETCHING INVOICES FROM XERO ===');
            try {
                // If we already fetched all invoices earlier, use those, otherwise fetch now
                let invoicesArray = allXeroInvoices;
                
                if (invoicesArray.length === 0) {
                    const accessToken = xeroAccessToken;
                    const tenantId = xeroTenantId;
                    const contactId = companyInfo.xeroContactId;

                    // Get invoices from Xero using same logic as parseFiles
                    async function getInvoicesFromXero() {
                        // Get file issue date
                        const fileIssueDate = fileDate ? new Date(fileDate) : null;

                        // Get last invoice date from database (last check date)
                        const lastInvoiceFromSupplier = await SupplierInvoice.findOne({ vendorId: supplierInfo._id }).sort({ createdAt: -1 });
                        const lastCheckDate = lastInvoiceFromSupplier?.createdAt ? new Date(lastInvoiceFromSupplier.createdAt) : null;

                        // Use the earlier of the two dates, or default to 19 months ago if neither exists
                        let fromDateObj;
                        if (fileIssueDate && lastCheckDate) {
                            fromDateObj = fileIssueDate < lastCheckDate ? fileIssueDate : lastCheckDate;
                            log(`   - File issue date: ${fileIssueDate.toISOString().split('T')[0]}`);
                            log(`   - Last check date: ${lastCheckDate.toISOString().split('T')[0]}`);
                            log(`   - Using earlier date: ${fromDateObj.toISOString().split('T')[0]}`);
                        } else if (fileIssueDate) {
                            fromDateObj = fileIssueDate;
                            log(`   - Using file issue date: ${fromDateObj.toISOString().split('T')[0]}`);
                        } else if (lastCheckDate) {
                            fromDateObj = lastCheckDate;
                            log(`   - Using last check date: ${fromDateObj.toISOString().split('T')[0]}`);
                        } else {
                            // Default fallback: 19 months ago
                            const today = new Date();
                            fromDateObj = new Date(today);
                            fromDateObj.setMonth(today.getMonth() - 19);
                            log(`   - No file or check date found, using default: ${fromDateObj.toISOString().split('T')[0]}`);
                        }

                        const where = `Contact.ContactID == Guid("${contactId}")`;
                        log(`   - Xero query: ${where}`);

                        const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}`;
                        const invoiceResponse = await axios.get(invoiceUrl, {
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                                'Xero-tenant-id': tenantId,
                                Accept: 'application/json',
                            },
                        });

                        return invoiceResponse.data.Invoices || [];
                    }

                    try {
                        invoicesArray = await getInvoicesFromXero();
                    } catch (xeroFetchError) {
                        await logErrorToDatabase(reqContext.processDoc, 'xero_invoice_fetch', xeroFetchError, {
                            fileName: fileName,
                            contactId: contactId,
                        }, logDoc?._id);
                        invoicesArray = [];
                    }
                }

                // Include ALL invoices from Xero (both paid and unpaid)
                // Determine payment status based on AmountDue
                log(`📊 Processing Xero invoices: ${invoicesArray.length} total (including paid and unpaid)`);

                // Format Xero invoices to match file invoice format
                // Preserve original invoice numbers - they should be unique per record
                xeroInvoices = invoicesArray.map(inv => {
                    // Determine payment status: unpaid if AmountDue > 0, otherwise paid
                    const amountDue = parseFloat(inv.AmountDue || 0);
                    const paymentStatus = amountDue > 0 ? 'unpaid' : 'paid';
                    
                    return {
                        invoiceDate: new Date(inv.DateString).toLocaleDateString('en-GB'),
                        invoiceNumber: inv.InvoiceNumber || null, // Keep original invoice number
                        activityDescription: inv.LineItems?.[0]?.Description || null,
                        amount: {
                            amount: inv.SubTotal || 0,
                            tax_fees: inv.TotalTax || 0
                        },
                        currency: inv.CurrencyCode || null,
                        paymentStatus: paymentStatus,
                        InvoiceID: inv.InvoiceID || null, // Preserve Xero Invoice ID
                    };
                });

                log(`✅ Found ${xeroInvoices.length} invoices from Xero`);
                if (xeroInvoices.length > 0) {
                    log(`   - Sample Invoice Numbers: ${xeroInvoices.slice(0, 5).map(i => i.invoiceNumber).filter(Boolean).join(', ')}`);
                }
            } catch (xeroError) {
                log(`⚠️  Failed to fetch Xero invoices: ${xeroError.message}`);
            }
        } else {
            log('⚠️  Skipping Xero invoice fetch - no supplier or contact ID');
        }

        // Match invoices from file and Xero
        function normalizeInvoiceNumber(invoiceNumber) {
            if (!invoiceNumber) return '';
            // Remove all non-digit characters for comparison
            return invoiceNumber.toString().replace(/\D/g, '');
        }

        function getInvoiceNumberVariations(invoiceNumber) {
            if (!invoiceNumber) return new Set();
            const variations = new Set();
            const normalized = invoiceNumber.toString().trim();

            // Original
            variations.add(normalized);

            // Lowercase
            variations.add(normalized.toLowerCase());

            // Uppercase
            variations.add(normalized.toUpperCase());

            // Digits only (normalized)
            const digitsOnly = normalizeInvoiceNumber(normalized);
            if (digitsOnly) {
                variations.add(digitsOnly);
            }

            // Remove common prefixes/suffixes and get digits
            const withoutPrefix = normalized.replace(/^(INV|INVOICE|REF|REFERENCE|DOC|DOCUMENT|#|NO|NUMBER)[\s\-_]*/i, '');
            if (withoutPrefix !== normalized) {
                variations.add(withoutPrefix);
                variations.add(normalizeInvoiceNumber(withoutPrefix));
            }

            // Remove common suffixes
            const withoutSuffix = normalized.replace(/[\s\-_]*(INV|INVOICE|REF|REFERENCE|DOC|DOCUMENT)?$/i, '');
            if (withoutSuffix !== normalized) {
                variations.add(withoutSuffix);
                variations.add(normalizeInvoiceNumber(withoutSuffix));
            }

            return variations;
        }

        function matchInvoices(fileInvoices, xeroInvoices) {
            console.log('\n=== STARTING INVOICE MATCHING WITH MULTIPLE POTENTIAL IDs ===');
            console.log(`📊 Total file invoices: ${fileInvoices.length}`);
            console.log(`📊 Total Xero invoices: ${xeroInvoices.length}`);

            const matched = [];
            const unmatchedFile = [];
            const unmatchedXero = [];

            // Create maps with all variations as keys - store index for tracking
            const xeroMap = new Map(); // variation -> [invoices]
            const xeroInvoicesWithIndex = xeroInvoices.map((inv, idx) => ({ ...inv, _index: idx }));
            const fileInvoicesWithIndex = fileInvoices.map((inv, idx) => ({ ...inv, _index: idx }));

            // Index Xero invoices by all variations
            console.log('\n🔍 Indexing Xero invoices by variations...');
            xeroInvoicesWithIndex.forEach(xeroInv => {
                const originalNumber = xeroInv.invoiceNumber || '';
                const variations = getInvoiceNumberVariations(originalNumber);
                variations.forEach(variation => {
                    if (variation) {
                        if (!xeroMap.has(variation)) {
                            xeroMap.set(variation, []);
                        }
                        xeroMap.get(variation).push(xeroInv);
                    }
                });
            });
            console.log(`✅ Indexed ${xeroMap.size} unique variations from Xero invoices`);

            // Track which invoices have been matched by index
            const matchedXeroIndices = new Set();
            const matchedFileIndices = new Set();

            // Helper function to parse date string to Date object
            function parseDate(dateStr) {
                if (!dateStr) return null;
                try {
                    // Handle dd/mm/yyyy format
                    if (dateStr.includes('/')) {
                        const parts = dateStr.split('/');
                        if (parts.length === 3) {
                            const day = parseInt(parts[0], 10);
                            const month = parseInt(parts[1], 10) - 1;
                            const year = parseInt(parts[2], 10);
                            const date = new Date(year, month, day);
                            if (!isNaN(date.getTime())) return date;
                        }
                    }
                    // Try standard Date parsing
                    const date = new Date(dateStr);
                    if (!isNaN(date.getTime())) return date;
                } catch (e) {
                    // Invalid date
                }
                return null;
            }

            // Helper function to check if two dates are within a window
            function datesWithinWindow(date1, date2, daysWindow = 7) {
                if (!date1 || !date2) return false;
                const diffMs = Math.abs(date1.getTime() - date2.getTime());
                const diffDays = diffMs / (1000 * 60 * 60 * 24);
                return diffDays <= daysWindow;
            }

            // Helper function to check if two amounts match (with tolerance)
            function amountsMatch(amount1, amount2, tolerance = 0.01) {
                if (amount1 == null || amount2 == null) return false;
                const diff = Math.abs(amount1 - amount2);
                return diff <= tolerance;
            }

            // STEP 0: For each file invoice, try all potential IDs and find the one with most matches
            console.log('\n🔍 STEP 0: Analyzing potential invoice IDs for each file invoice...');
            const selectedInvoiceIds = new Map(); // fileInv._index -> { selectedId, matchCount, allResults }

            fileInvoicesWithIndex.forEach((fileInv, fileIdx) => {
                console.log(`\n📄 Processing file invoice #${fileIdx + 1}:`);
                
                // Get all potential invoice IDs
                const potentialIds = fileInv.potentialInvoiceIds || [];
                const primaryId = fileInv.invoiceNumber || '';
                
                // Combine primary ID with potential IDs, removing duplicates
                const allPotentialIds = new Set();
                if (primaryId) allPotentialIds.add(primaryId);
                if (Array.isArray(potentialIds)) {
                    potentialIds.forEach(id => {
                        if (id && id.trim()) allPotentialIds.add(id.trim());
                    });
                }
                
                const uniqueIds = Array.from(allPotentialIds);
                console.log(`   Found ${uniqueIds.length} potential invoice ID(s): ${uniqueIds.join(', ')}`);

                if (uniqueIds.length === 0) {
                    console.log(`   ⚠️  No invoice IDs found for this invoice`);
                    selectedInvoiceIds.set(fileInv._index, {
                        selectedId: null,
                        matchCount: 0,
                        allResults: []
                    });
                    return;
                }

                // Test each potential ID and count matches
                const idResults = [];
                uniqueIds.forEach((potentialId, idIdx) => {
                    console.log(`   Testing ID #${idIdx + 1}: "${potentialId}"`);
                    const variations = getInvoiceNumberVariations(potentialId);
                    let matchCount = 0;
                    const matchingXeroInvoices = [];

                    variations.forEach(variation => {
                        if (xeroMap.has(variation)) {
                            const matchingXero = xeroMap.get(variation);
                            matchingXero.forEach(xeroInv => {
                                if (!matchingXeroInvoices.find(x => x._index === xeroInv._index)) {
                                    matchingXeroInvoices.push(xeroInv);
                                    matchCount++;
                                }
                            });
                        }
                    });

                    console.log(`      → Found ${matchCount} potential match(es) in Xero`);
                    idResults.push({
                        id: potentialId,
                        matchCount: matchCount,
                        matchingXeroInvoices: matchingXeroInvoices
                    });
                });

                // Select the ID with the most matches
                idResults.sort((a, b) => {
                    // First sort by match count (descending)
                    if (b.matchCount !== a.matchCount) {
                        return b.matchCount - a.matchCount;
                    }
                    // If match counts are equal, prefer the primary invoiceNumber
                    if (a.id === primaryId) return -1;
                    if (b.id === primaryId) return 1;
                    // Otherwise prefer longer IDs (more specific)
                    return b.id.length - a.id.length;
                });
                const bestId = idResults[0];
                
                console.log(`   ✅ Selected ID: "${bestId.id}" with ${bestId.matchCount} match(es)`);
                if (idResults.length > 1) {
                    console.log(`   📊 Comparison:`);
                    idResults.forEach(result => {
                        const isSelected = result.id === bestId.id ? ' ← SELECTED' : '';
                        const isPrimary = result.id === primaryId ? ' (primary)' : '';
                        console.log(`      - "${result.id}": ${result.matchCount} match(es)${isPrimary}${isSelected}`);
                    });
                }

                selectedInvoiceIds.set(fileInv._index, {
                    selectedId: bestId.id,
                    matchCount: bestId.matchCount,
                    allResults: idResults,
                    matchingXeroInvoices: bestId.matchingXeroInvoices
                });
            });

            console.log(`\n✅ Completed potential ID analysis for all ${fileInvoicesWithIndex.length} file invoices`);

            // Analyze best ID patterns to determine if this is a single statement or list
            function analyzeStatementType(selectedInvoiceIds, totalInvoices) {
                if (totalInvoices === 0) {
                    return {
                        isList: null,
                        confidence: 0,
                        reason: 'No invoices to analyze',
                        uniqueBestIds: 0,
                        totalInvoices: 0,
                        matchCountStats: { average: 0, min: 0, max: 0 }
                    };
                }

                // Collect all selected IDs and their match counts
                const selectedIds = [];
                const matchCounts = [];
                const idFrequency = new Map();

                selectedInvoiceIds.forEach((selection) => {
                    if (selection && selection.selectedId) {
                        const id = selection.selectedId;
                        selectedIds.push(id);
                        matchCounts.push(selection.matchCount || 0);
                        
                        // Count frequency of each ID
                        idFrequency.set(id, (idFrequency.get(id) || 0) + 1);
                    }
                });

                const uniqueBestIds = idFrequency.size;
                const mostCommonIdCount = Math.max(...Array.from(idFrequency.values()));
                const uniqueIdRatio = uniqueBestIds / totalInvoices;

                // Calculate match count statistics
                const matchCountStats = {
                    average: matchCounts.length > 0 
                        ? matchCounts.reduce((a, b) => a + b, 0) / matchCounts.length 
                        : 0,
                    min: matchCounts.length > 0 ? Math.min(...matchCounts) : 0,
                    max: matchCounts.length > 0 ? Math.max(...matchCounts) : 0
                };

                // Determine if it's a list or single statement
                // Logic: If many unique IDs (>50% of invoices have different best IDs) → LIST
                // If most invoices share the same best ID → SINGLE
                let isList = false;
                let confidence = 0;
                let reason = '';

                if (uniqueBestIds === 1) {
                    // All invoices share the same best ID - definitely single statement
                    isList = false;
                    confidence = 0.95;
                    reason = `All ${totalInvoices} invoice(s) share the same best ID "${Array.from(idFrequency.keys())[0]}"`;
                } else if (uniqueIdRatio > 0.5) {
                    // More than 50% of invoices have different best IDs - likely a list
                    isList = true;
                    confidence = Math.min(0.9, 0.5 + (uniqueIdRatio - 0.5) * 0.8);
                    reason = `${uniqueBestIds} unique best IDs found across ${totalInvoices} invoice(s) (${(uniqueIdRatio * 100).toFixed(1)}% unique)`;
                } else if (mostCommonIdCount / totalInvoices > 0.7) {
                    // More than 70% share the same ID - likely single statement
                    isList = false;
                    confidence = 0.8;
                    reason = `${mostCommonIdCount} out of ${totalInvoices} invoice(s) share the same best ID`;
                } else {
                    // Ambiguous case - use match count patterns as tiebreaker
                    // High match counts might indicate list (multiple invoices matching)
                    // Low match counts might indicate single (one invoice, fewer matches)
                    if (matchCountStats.average > 1 && uniqueBestIds > 1) {
                        isList = true;
                        confidence = 0.6;
                        reason = `Multiple unique IDs (${uniqueBestIds}) with average match count of ${matchCountStats.average.toFixed(1)}`;
                    } else {
                        isList = false;
                        confidence = 0.6;
                        reason = `Mixed pattern: ${uniqueBestIds} unique IDs but ${mostCommonIdCount} share the most common ID`;
                    }
                }

                return {
                    isList,
                    confidence,
                    reason,
                    uniqueBestIds,
                    totalInvoices,
                    matchCountStats
                };
            }

            const statementType = analyzeStatementType(selectedInvoiceIds, fileInvoicesWithIndex.length);
            console.log(`\n📊 Statement Type Analysis:`);
            console.log(`   - Type: ${statementType.isList ? 'LIST' : 'SINGLE STATEMENT'}`);
            console.log(`   - Confidence: ${(statementType.confidence * 100).toFixed(1)}%`);
            console.log(`   - Reason: ${statementType.reason}`);
            console.log(`   - Unique Best IDs: ${statementType.uniqueBestIds} out of ${statementType.totalInvoices}`);
            console.log(`   - Match Count Stats: avg=${statementType.matchCountStats.average.toFixed(1)}, min=${statementType.matchCountStats.min}, max=${statementType.matchCountStats.max}`);

            // STEP 1: Match by Reference ID (invoice number) using selected IDs - STRONG MATCH
            console.log('\n🔍 STEP 1: Matching invoices using selected IDs...');
            fileInvoicesWithIndex.forEach((fileInv) => {
                const selection = selectedInvoiceIds.get(fileInv._index);
                if (!selection || !selection.selectedId) {
                    console.log(`   ⚠️  Invoice #${fileInv._index + 1}: No selected ID, skipping`);
                    const { _index, ...fileInvClean } = fileInv;
                    unmatchedFile.push(fileInvClean);
                    return;
                }

                const selectedId = selection.selectedId;
                const fileVariations = getInvoiceNumberVariations(selectedId);
                console.log(`   📄 Invoice #${fileInv._index + 1}: Using selected ID "${selectedId}"`);

                let foundMatch = false;
                // Try variations in order of specificity (most specific first)
                const sortedVariations = Array.from(fileVariations).sort((a, b) => {
                    // Prefer exact matches, then normalized, then digits-only
                    if (a === selectedId) return -1;
                    if (b === selectedId) return 1;
                    const aDigits = normalizeInvoiceNumber(a);
                    const bDigits = normalizeInvoiceNumber(b);
                    if (aDigits === selectedId.replace(/\D/g, '')) return -1;
                    if (bDigits === selectedId.replace(/\D/g, '')) return 1;
                    return b.length - a.length; // Longer matches are more specific
                });

                for (const variation of sortedVariations) {
                    if (xeroMap.has(variation)) {
                        const matchingXero = xeroMap.get(variation);
                        // Find first unmatched Xero invoice
                        const xeroMatch = matchingXero.find(x => !matchedXeroIndices.has(x._index));

                        if (xeroMatch && !matchedXeroIndices.has(xeroMatch._index)) {
                            // Remove _index before adding to result
                            const { _index: fileIdx, ...fileInvClean } = fileInv;
                            const { _index: xeroIdx, ...xeroInvClean } = xeroMatch;

                            // Update invoiceNumber in fileInvClean to use the selected ID
                            fileInvClean.invoiceNumber = selectedId;

                            matched.push({
                                fileInvoice: fileInvClean,
                                xeroInvoice: xeroInvClean,
                                matchKey: variation,
                                matchType: 'referenceId',
                                fileInvoiceNumber: selectedId,
                                xeroInvoiceNumber: xeroMatch.invoiceNumber || ''
                            });
                            matchedXeroIndices.add(xeroMatch._index);
                            matchedFileIndices.add(fileInv._index);
                            foundMatch = true;
                            console.log(`      ✅ Matched with Xero invoice: "${xeroMatch.invoiceNumber}" (using variation: "${variation}")`);
                            break;
                        }
                    }
                }

                if (!foundMatch) {
                    console.log(`      ⚠️  No match found for selected ID "${selectedId}"`);
                    const { _index, ...fileInvClean } = fileInv;
                    fileInvClean.invoiceNumber = selectedId; // Use selected ID even if no match
                    unmatchedFile.push(fileInvClean);
                }
            });

            // STEP 2: Fallback heuristic matching for unmatched invoices
            // Match using date ± window + amount (for invoices not matched by Reference ID)
            console.log(`\n🔍 STEP 2: Heuristic matching (date + amount) for unmatched invoices...`);
            const remainingUnmatchedFile = fileInvoicesWithIndex.filter(
                inv => !matchedFileIndices.has(inv._index)
            );
            const remainingUnmatchedXero = xeroInvoicesWithIndex.filter(
                inv => !matchedXeroIndices.has(inv._index)
            );

            console.log(`   📊 Remaining unmatched file invoices: ${remainingUnmatchedFile.length}`);
            console.log(`   📊 Remaining unmatched Xero invoices: ${remainingUnmatchedXero.length}`);

            // Try to match remaining file invoices with remaining Xero invoices
            remainingUnmatchedFile.forEach((fileInv, idx) => {
                if (matchedFileIndices.has(fileInv._index)) return; // Already matched

                const selection = selectedInvoiceIds.get(fileInv._index);
                const invoiceId = selection?.selectedId || fileInv.invoiceNumber || 'Unknown';
                console.log(`   📄 Attempting heuristic match for invoice #${fileInv._index + 1} (ID: "${invoiceId}")`);

                const fileDate = parseDate(fileInv.invoiceDate);
                const fileAmount = fileInv.amount?.amount;

                // Skip if we don't have both date and amount for heuristic matching
                if (!fileDate || fileAmount == null) {
                    console.log(`      ⚠️  Skipping - missing date or amount (date: ${fileInv.invoiceDate}, amount: ${fileAmount})`);
                    return;
                }

                // Find best match from unmatched Xero invoices
                let bestMatch = null;
                let bestMatchIndex = -1;

                remainingUnmatchedXero.forEach((xeroInv, xeroIdx) => {
                    if (matchedXeroIndices.has(xeroInv._index)) return; // Already matched

                    const xeroDate = parseDate(xeroInv.invoiceDate);
                    const xeroAmount = xeroInv.amount?.amount;

                    // Skip if we don't have both date and amount
                    if (!xeroDate || xeroAmount == null) return;

                    // Check if dates are within window (default ±7 days)
                    const dateMatch = datesWithinWindow(fileDate, xeroDate, 7);
                    // Check if amounts match (default tolerance ±0.01)
                    const amountMatch = amountsMatch(fileAmount, xeroAmount, 0.01);

                    // Both date and amount must match for heuristic match
                    if (dateMatch && amountMatch) {
                        bestMatch = xeroInv;
                        bestMatchIndex = xeroInv._index;
                    }
                });

                // If we found a heuristic match, add it
                if (bestMatch && bestMatchIndex !== -1) {
                    const { _index: fileIdxToRemove, ...fileInvClean } = fileInv;
                    const { _index: xeroIdxToRemove, ...xeroInvClean } = bestMatch;

                    // Use selected ID if available
                    const selection = selectedInvoiceIds.get(fileInv._index);
                    if (selection?.selectedId) {
                        fileInvClean.invoiceNumber = selection.selectedId;
                    }

                    matched.push({
                        fileInvoice: fileInvClean,
                        xeroInvoice: xeroInvClean,
                        matchKey: `date+amount`,
                        matchType: 'heuristic',
                        fileInvoiceNumber: fileInvClean.invoiceNumber || '',
                        xeroInvoiceNumber: bestMatch.invoiceNumber || ''
                    });
                    matchedXeroIndices.add(bestMatchIndex);
                    matchedFileIndices.add(fileInv._index);

                    console.log(`      ✅ Heuristic match found with Xero invoice: "${bestMatch.invoiceNumber}"`);

                    // Remove from unmatched arrays
                    const unmatchedFileIdx = unmatchedFile.findIndex(inv =>
                        (inv.invoiceNumber || '') === (fileInvClean.invoiceNumber || '') &&
                        (inv.invoiceDate || '') === (fileInv.invoiceDate || '')
                    );
                    if (unmatchedFileIdx !== -1) unmatchedFile.splice(unmatchedFileIdx, 1);
                } else {
                    console.log(`      ⚠️  No heuristic match found`);
                }
            });

            // STEP 3: Fuzzy/partial matching for invoice numbers
            // If file invoice number contains most of Xero invoice number or vice versa
            console.log(`\n🔍 STEP 3: Fuzzy/partial matching for remaining unmatched invoices...`);
            
            // Helper function to check if one string contains most of another
            function containsMostOf(container, contained, threshold = 0.7) {
                if (!container || !contained) return false;
                // Normalize both strings - remove non-alphanumeric and lowercase
                const containerNorm = container.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const containedNorm = contained.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                
                if (containerNorm.length === 0 || containedNorm.length === 0) return false;
                
                // Check if container includes contained
                if (containerNorm.includes(containedNorm)) {
                    return true;
                }
                
                // Check if contained starts with or ends with container (partial match)
                if (containedNorm.startsWith(containerNorm) || containedNorm.endsWith(containerNorm)) {
                    // Make sure the match is substantial (at least threshold of the shorter one)
                    const matchRatio = containerNorm.length / containedNorm.length;
                    return matchRatio >= threshold;
                }
                
                return false;
            }
            
            // Helper function to calculate similarity score for partial matches
            function getPartialMatchScore(str1, str2) {
                if (!str1 || !str2) return 0;
                const norm1 = str1.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                const norm2 = str2.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                
                if (norm1.length === 0 || norm2.length === 0) return 0;
                
                // Check if one contains the other
                if (norm1.includes(norm2)) {
                    return norm2.length / norm1.length; // How much of norm1 is covered by norm2
                }
                if (norm2.includes(norm1)) {
                    return norm1.length / norm2.length; // How much of norm2 is covered by norm1
                }
                
                // Check prefix/suffix match
                const shorter = norm1.length <= norm2.length ? norm1 : norm2;
                const longer = norm1.length > norm2.length ? norm1 : norm2;
                
                // Check how many characters match from start
                let prefixMatch = 0;
                for (let i = 0; i < shorter.length && i < longer.length; i++) {
                    if (shorter[i] === longer[i]) prefixMatch++;
                    else break;
                }
                
                // Check how many characters match from end
                let suffixMatch = 0;
                for (let i = 0; i < shorter.length && i < longer.length; i++) {
                    if (shorter[shorter.length - 1 - i] === longer[longer.length - 1 - i]) suffixMatch++;
                    else break;
                }
                
                const bestMatch = Math.max(prefixMatch, suffixMatch);
                return bestMatch / shorter.length;
            }

            // Get current unmatched invoices (after STEP 2)
            const stillUnmatchedFile = fileInvoicesWithIndex.filter(
                inv => !matchedFileIndices.has(inv._index)
            );
            const stillUnmatchedXero = xeroInvoicesWithIndex.filter(
                inv => !matchedXeroIndices.has(inv._index)
            );

            console.log(`   📊 Still unmatched file invoices: ${stillUnmatchedFile.length}`);
            console.log(`   📊 Still unmatched Xero invoices: ${stillUnmatchedXero.length}`);

            stillUnmatchedFile.forEach((fileInv) => {
                if (matchedFileIndices.has(fileInv._index)) return; // Already matched

                const selection = selectedInvoiceIds.get(fileInv._index);
                const fileInvNumber = selection?.selectedId || fileInv.invoiceNumber || '';
                
                if (!fileInvNumber) {
                    console.log(`   ⚠️  Invoice #${fileInv._index + 1}: No invoice number, skipping fuzzy match`);
                    return;
                }

                console.log(`   📄 Attempting fuzzy match for invoice #${fileInv._index + 1} (ID: "${fileInvNumber}")`);

                let bestFuzzyMatch = null;
                let bestFuzzyScore = 0;
                let bestMatchDirection = '';

                stillUnmatchedXero.forEach((xeroInv) => {
                    if (matchedXeroIndices.has(xeroInv._index)) return; // Already matched

                    const xeroInvNumber = xeroInv.invoiceNumber || '';
                    if (!xeroInvNumber) return;

                    // Check if file number contains most of Xero number
                    const fileContainsXero = containsMostOf(fileInvNumber, xeroInvNumber, 0.7);
                    // Check if Xero number contains most of file number
                    const xeroContainsFile = containsMostOf(xeroInvNumber, fileInvNumber, 0.7);

                    if (fileContainsXero || xeroContainsFile) {
                        const score = getPartialMatchScore(fileInvNumber, xeroInvNumber);
                        const direction = fileContainsXero ? 'file contains xero' : 'xero contains file';
                        
                        console.log(`      🔍 Potential fuzzy match: "${xeroInvNumber}" (score: ${(score * 100).toFixed(1)}%, ${direction})`);

                        if (score > bestFuzzyScore) {
                            bestFuzzyScore = score;
                            bestFuzzyMatch = xeroInv;
                            bestMatchDirection = direction;
                        }
                    }
                });

                // Accept fuzzy match if score is at least 70%
                if (bestFuzzyMatch && bestFuzzyScore >= 0.7) {
                    const { _index: fileIdxToRemove, ...fileInvClean } = fileInv;
                    const { _index: xeroIdxToRemove, ...xeroInvClean } = bestFuzzyMatch;

                    // Use selected ID if available
                    if (selection?.selectedId) {
                        fileInvClean.invoiceNumber = selection.selectedId;
                    }

                    matched.push({
                        fileInvoice: fileInvClean,
                        xeroInvoice: xeroInvClean,
                        matchKey: `fuzzy:${bestMatchDirection}`,
                        matchType: 'fuzzy',
                        fileInvoiceNumber: fileInvClean.invoiceNumber || '',
                        xeroInvoiceNumber: bestFuzzyMatch.invoiceNumber || '',
                        fuzzyScore: bestFuzzyScore
                    });
                    matchedXeroIndices.add(bestFuzzyMatch._index);
                    matchedFileIndices.add(fileInv._index);

                    console.log(`      ✅ Fuzzy match found: "${bestFuzzyMatch.invoiceNumber}" (score: ${(bestFuzzyScore * 100).toFixed(1)}%, ${bestMatchDirection})`);

                    // Remove from unmatchedFile array if it was added earlier
                    const unmatchedFileIdx = unmatchedFile.findIndex(inv =>
                        (inv.invoiceNumber || '') === (fileInvClean.invoiceNumber || '') ||
                        (inv.invoiceNumber || '') === (fileInv.invoiceNumber || '')
                    );
                    if (unmatchedFileIdx !== -1) unmatchedFile.splice(unmatchedFileIdx, 1);
                } else if (bestFuzzyMatch) {
                    console.log(`      ⚠️  Best fuzzy match "${bestFuzzyMatch.invoiceNumber}" score too low: ${(bestFuzzyScore * 100).toFixed(1)}%`);
                } else {
                    console.log(`      ⚠️  No fuzzy match found`);
                }
            });

            // Collect all unmatched Xero invoices (those not matched in any step)
            console.log(`\n📊 Collecting unmatched Xero invoices...`);
            xeroInvoicesWithIndex.forEach((xeroInv) => {
                if (!matchedXeroIndices.has(xeroInv._index)) {
                    const { _index, ...xeroInvClean } = xeroInv;
                    unmatchedXero.push(xeroInvClean);
                }
            });

            // Final summary
            console.log(`\n=== INVOICE MATCHING SUMMARY ===`);
            console.log(`✅ Total matched: ${matched.length}`);
            console.log(`⚠️  Unmatched from file: ${unmatchedFile.length}`);
            console.log(`⚠️  Unmatched from Xero: ${unmatchedXero.length}`);
            
            const referenceIdMatches = matched.filter(m => m.matchType === 'referenceId').length;
            const heuristicMatches = matched.filter(m => m.matchType === 'heuristic').length;
            const fuzzyMatches = matched.filter(m => m.matchType === 'fuzzy').length;
            console.log(`   - Reference ID matches: ${referenceIdMatches}`);
            console.log(`   - Heuristic matches: ${heuristicMatches}`);
            console.log(`   - Fuzzy/partial matches: ${fuzzyMatches}`);
            
            // Summary of ID selection
            let totalIdsTested = 0;
            let totalIdsWithMatches = 0;
            selectedInvoiceIds.forEach((selection, idx) => {
                if (selection.allResults) {
                    totalIdsTested += selection.allResults.length;
                    if (selection.matchCount > 0) totalIdsWithMatches++;
                }
            });
            console.log(`\n📊 ID Selection Statistics:`);
            console.log(`   - Total potential IDs tested: ${totalIdsTested}`);
            console.log(`   - Invoices with at least one matching ID: ${totalIdsWithMatches}`);
            console.log(`   - Average IDs per invoice: ${(totalIdsTested / fileInvoicesWithIndex.length).toFixed(2)}`);

            return {
                matched,
                unmatchedFile,
                unmatchedXero,
                matchCount: matched.length,
                unmatchedFileCount: unmatchedFile.length,
                unmatchedXeroCount: unmatchedXero.length,
                statementType: statementType
            };
        }

        // Perform matching
        const matchingResults = matchInvoices(formattedInvoices.invoices, xeroInvoices);

        log('\n=== INVOICE MATCHING RESULTS ===');
        log(`✅ Matched: ${matchingResults.matchCount} invoices`);

        // Count matches by type
        const referenceIdMatches = matchingResults.matched.filter(m => m.matchType === 'referenceId').length;
        const heuristicMatches = matchingResults.matched.filter(m => m.matchType === 'heuristic').length;
        const fuzzyMatches = matchingResults.matched.filter(m => m.matchType === 'fuzzy').length;

        if (referenceIdMatches > 0) {
            log(`   - Reference ID matches (strong): ${referenceIdMatches}`);
        }
        if (heuristicMatches > 0) {
            log(`   - Heuristic matches (date + amount): ${heuristicMatches}`);
        }
        if (fuzzyMatches > 0) {
            log(`   - Fuzzy/partial matches: ${fuzzyMatches}`);
        }

        log(`⚠️  Unmatched from file: ${matchingResults.unmatchedFileCount}`);
        log(`⚠️  Unmatched from Xero: ${matchingResults.unmatchedXeroCount}`);

        // Log statement type determination from best ID analysis
        if (matchingResults.statementType) {
            log(`\n📊 Statement Type Determination (from Best ID Analysis):`);
            log(`   - Type: ${matchingResults.statementType.isList ? 'LIST' : 'SINGLE STATEMENT'}`);
            log(`   - Confidence: ${(matchingResults.statementType.confidence * 100).toFixed(1)}%`);
            log(`   - Reason: ${matchingResults.statementType.reason}`);
            log(`   - Unique Best IDs: ${matchingResults.statementType.uniqueBestIds} out of ${matchingResults.statementType.totalInvoices}`);
            
            // Compare with AI-based invoiceCountCheck if available
            if (invoiceCountCheck && invoiceCountCheck.hasMultipleInvoices !== null) {
                const aiSaysList = invoiceCountCheck.hasMultipleInvoices === true;
                const idAnalysisSaysList = matchingResults.statementType.isList === true;
                const agreement = aiSaysList === idAnalysisSaysList;
                log(`   - Comparison with AI analysis: ${agreement ? '✅ AGREES' : '⚠️  DISAGREES'}`);
                log(`     * AI says: ${aiSaysList ? 'LIST' : 'SINGLE'}`);
                log(`     * Best ID analysis says: ${idAnalysisSaysList ? 'LIST' : 'SINGLE'}`);
            }
        }

        if (matchingResults.matched.length > 0) {
            log(`   - Sample matches:`);
            matchingResults.matched.slice(0, 5).forEach(m => {
                const matchTypeLabel = m.matchType === 'referenceId' ? 'Reference ID' : 'Heuristic (date+amount)';
                log(`     File: "${m.fileInvoiceNumber}" ↔ Xero: "${m.xeroInvoiceNumber}" (${matchTypeLabel})`);
            });
        }

        // Save all invoices to database if supplier exists
        if (supplierInfo && supplierInfo._id) {
            log('\n=== SAVING INVOICES TO DATABASE ===');

            // Helper function to convert date string to Date object
            function parseDate(dateStr) {
                if (!dateStr) return null;
                try {
                    // Handle dd/mm/yyyy format
                    if (dateStr.includes('/')) {
                        const parts = dateStr.split('/');
                        if (parts.length === 3) {
                            const day = parseInt(parts[0], 10);
                            const month = parseInt(parts[1], 10) - 1;
                            const year = parseInt(parts[2], 10);
                            const date = new Date(year, month, day);
                            if (!isNaN(date.getTime())) return date;
                        }
                    }
                    // Try standard Date parsing
                    const date = new Date(dateStr);
                    if (!isNaN(date.getTime())) return date;
                } catch (e) {
                    // Invalid date
                }
                return null;
            }

            // Helper function to normalize invoice number for comparison
            function normalizeInvoiceNumberForDB(invoiceNumber) {
                if (!invoiceNumber) return '';
                return invoiceNumber.toString().trim().replace(/\D/g, '');
            }

            // Helper function to find existing invoice by number (for same supplier)
            async function findExistingInvoice(invoiceNumber, supplierId) {
                if (!invoiceNumber) return null;

                const normalized = normalizeInvoiceNumberForDB(invoiceNumber);
                if (!normalized) return null;

                // First try exact match
                const exactMatch = await SupplierInvoice.findOne({
                    vendorId: supplierId,
                    invoiceNumber: invoiceNumber,
                    isDeleted: { $ne: true }
                });
                if (exactMatch) return exactMatch;

                // Then try normalized match - get all invoices for this supplier and compare normalized numbers
                const allInvoices = await SupplierInvoice.find({
                    vendorId: supplierId,
                    invoiceNumber: { $exists: true, $ne: null },
                    isDeleted: { $ne: true }
                });

                for (const inv of allInvoices) {
                    if (inv.invoiceNumber) {
                        const invNormalized = normalizeInvoiceNumberForDB(inv.invoiceNumber);
                        if (invNormalized === normalized) {
                            return inv;
                        }
                    }
                }

                return null;
            }

            // Save matched invoices
            let updatedCount = 0;
            let createdCount = 0;

            // Safety check: ensure matched is an array
            const matchedInvoices = Array.isArray(matchingResults.matched) ? matchingResults.matched : [];
            log(`   📊 About to save ${matchedInvoices.length} matched invoices (matchCount: ${matchingResults.matchCount})`);

            for (const match of matchedInvoices) {
                // Extract invoice number before try block so it's available in catch
                let invoiceNumber = null;
                try {
                    // #region agent log
                    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2229',message:'Entering matched invoice loop',data:{matchedCount:matchedInvoices.length,index:matchedInvoices.indexOf(match)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    const fileInv = match.fileInvoice;
                    const xeroInv = match.xeroInvoice;
                    invoiceNumber = xeroInv ? xeroInv.invoiceNumber : (fileInv ? fileInv.invoiceNumber : null);

                    // #region agent log
                    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2235',message:'Invoice number extracted',data:{invoiceNumber:invoiceNumber,hasXeroInv:!!xeroInv,hasFileInv:!!fileInv},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                    // #endregion

                    if (!invoiceNumber) {
                        log(`   ⚠️  Skipping invoice without invoice number`);
                        // #region agent log
                        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2238',message:'Skipping - no invoice number',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
                        // #endregion
                        continue;
                    }

                    // Check if invoice already exists
                    const existingInvoice = await findExistingInvoice(invoiceNumber, supplierInfo._id);

                    // #region agent log
                    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2243',message:'Found existing invoice',data:{existingInvoice:existingInvoice?existingInvoice._id:null,hasExisting:!!existingInvoice,isDeleted:existingInvoice?.isDeleted},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion

                    // Determine payment status: prefer file invoice status, then Xero invoice status, default to 'unpaid'
                    const paymentStatus = fileInv?.paymentStatus || xeroInv?.paymentStatus || 'unpaid';
                    
                    const vendorDate = fileInv ? parseDate(fileInv.invoiceDate) : null;
                    const xeroDate = xeroInv ? parseDate(xeroInv.invoiceDate) : null;
                    const vendorAmount = fileInv?.amount?.amount ?? null;
                    const xeroAmount = xeroInv?.amount?.amount ?? null;
                    const vendorCurrency = fileInv?.currency || xeroInv?.currency || null;
                    const status = (vendorDate && xeroDate) ? 'Reconciled' : 'Unreconciled';
                    console.log("existingInvoice📧", existingInvoice);
                    if (existingInvoice && !existingInvoice.isDeleted) {
                        // Update existing invoice
                        const invoiceData = {
                            VendorDate: vendorDate,
                            xeroDate: xeroDate,
                            invoiceNumber: invoiceNumber,
                            description: fileInv ? fileInv.activityDescription : null,
                            vendorAmount: vendorAmount,
                            xeroAmount: xeroAmount,
                            vendorCurrency: vendorCurrency,
                            xeroCurrency: xeroInv?.currency || null,
                            paymentStatus: paymentStatus,
                            status: status,
                            vendorId: supplierInfo._id,
                            statementId: logDoc?._id,
                            xeroInvoiceId: xeroInv?.InvoiceID || null
                        };
                        await SupplierInvoice.updateOne(
                            { _id: existingInvoice._id },
                            { $set: invoiceData }
                        );
                        updatedCount++;
                        log(`   ✅ Updated existing invoice: ${invoiceNumber}`);
                    } else {
                        // #region agent log
                        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2276',message:'Entering else block to create invoice',data:{invoiceNumber:invoiceNumber,supplierInfoId:supplierInfo?supplierInfo._id:null,paymentStatus:paymentStatus,status:status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                        // #endregion
                        // Create new invoice (either doesn't exist or is deleted)
                        const generatedInvoiceId = uuidv4();
                        // #region agent log
                        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2305',message:'Generated invoiceId UUID',data:{generatedInvoiceId:generatedInvoiceId,type:typeof generatedInvoiceId,isNull:generatedInvoiceId===null,isUndefined:generatedInvoiceId===undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                        // #endregion
                        const invoiceData = {
                            vendorDate: vendorDate,
                            xeroDate: xeroDate,
                            invoiceNumber: invoiceNumber,
                            description: fileInv ? fileInv.activityDescription : null,
                            vendorAmount: vendorAmount,
                            xeroAmount: xeroAmount,
                            vendorCurrency: vendorCurrency,
                            xeroCurrency: xeroInv?.currency || null,
                            paymentStatus: paymentStatus,
                            status: status,
                            vendorId: supplierInfo._id,
                            statementId: logDoc?._id,
                            xeroInvoiceId: xeroInv?.InvoiceID || null
                        };
                        // #region agent log
                        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2322',message:'invoiceData before create',data:{invoiceId:invoiceData.invoiceId,hasInvoiceId:'invoiceId' in invoiceData,invoiceIdType:typeof invoiceData.invoiceId,invoiceDataKeys:Object.keys(invoiceData)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                        // #endregion
                        // #region agent log
                        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2325',message:'About to call SupplierInvoice.create',data:{invoiceData:invoiceData},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                        // #endregion
                     const test =   await SupplierInvoice.create(invoiceData);
                     console.log("test📧", test);
                        // #region agent log
                        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2293',message:'SupplierInvoice.create completed',data:{createdCountBefore:createdCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                        // #endregion
                        createdCount++;
                        // #region agent log
                        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2294',message:'Incremented createdCount',data:{createdCountAfter:createdCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                        // #endregion
                        log(`   ➕ Created new invoice: ${invoiceNumber}`);
                    }
                } catch (invoiceSaveError) {
                    console.log("invoiceSaveError📧", invoiceSaveError);
                    // #region agent log
                    fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2342',message:'Exception caught in invoice save',data:{error:invoiceSaveError?.message,errorCode:invoiceSaveError?.code,errorName:invoiceSaveError?.name,errorKeyPattern:invoiceSaveError?.keyPattern,errorKeyValue:invoiceSaveError?.keyValue,invoiceNumber:invoiceNumber},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    await logErrorToDatabase(reqContext.processDoc, 'invoice_save', invoiceSaveError, {
                        fileName: fileName,
                        invoiceNumber: invoiceNumber,
                        step: 'matched_invoice_save',
                    }, logDoc?._id);
                    // Continue with next invoice
                }
            }

            // Save unmatched file invoices (only invoices from file, not unmatched Xero invoices)
            const unmatchedFileInvoices = Array.isArray(matchingResults.unmatchedFile) ? matchingResults.unmatchedFile : [];
            log(`   📊 About to save ${unmatchedFileInvoices.length} unmatched file invoices`);
            
            for (const fileInv of unmatchedFileInvoices) {
                try {
                if (!fileInv.invoiceNumber) {
                    log(`   ⚠️  Skipping invoice without invoice number`);
                    continue;
                }

                // Check if invoice already exists
                const existingInvoice = await findExistingInvoice(fileInv.invoiceNumber, supplierInfo._id);

                // Determine payment status: use file invoice status, default to 'unpaid' if not provided
                const paymentStatus = fileInv.paymentStatus || 'unpaid';
                
                const vendorDate = parseDate(fileInv.invoiceDate);
                const vendorAmount = fileInv.amount?.amount ?? null;
                const vendorCurrency = fileInv.currency || null;
                const status = 'Unreconciled';
                
                if (existingInvoice && !existingInvoice.isDeleted) {
                    // Update existing invoice
                    const invoiceData = {
                        VendorDate: vendorDate,
                        xeroDate: null,
                        invoiceNumber: fileInv.invoiceNumber,
                        description: fileInv.activityDescription,
                        vendorAmount: vendorAmount,
                        xeroAmount: null,
                        vendorCurrency: vendorCurrency,
                        xeroCurrency: null,
                        paymentStatus: paymentStatus,
                        status: status,
                        vendorId: supplierInfo._id,
                        statementId: logDoc?._id
                    };
                    await SupplierInvoice.updateOne(
                        { _id: existingInvoice._id },
                        { $set: invoiceData }
                    );
                    updatedCount++;
                    log(`   ✅ Updated existing invoice: ${fileInv.invoiceNumber}`);
                } else {
                    // Create new invoice (either doesn't exist or is deleted)
                    const invoiceData = {
                        VendorDate: vendorDate,
                        xeroDate: null,
                        invoiceNumber: fileInv.invoiceNumber,
                        description: fileInv.activityDescription,
                        vendorAmount: vendorAmount,
                        xeroAmount: null,
                        vendorCurrency: vendorCurrency,
                        xeroCurrency: null,
                        paymentStatus: paymentStatus,
                        status: status,
                        vendorId: supplierInfo._id,
                        statementId: logDoc?._id
                    };
                    await SupplierInvoice.create(invoiceData);
                    createdCount++;
                    log(`   ➕ Created new invoice: ${fileInv.invoiceNumber}`);
                }
                } catch (invoiceSaveError) {
                    await logErrorToDatabase(reqContext.processDoc, 'invoice_save', invoiceSaveError, {
                        fileName: fileName,
                        invoiceNumber: fileInv.invoiceNumber,
                        step: 'unmatched_invoice_save',
                    }, logDoc?._id);
                    // Continue with next invoice
                }
            }

            // Note: Unmatched Xero invoices are NOT saved to database
            // Only matched invoices and unmatched file invoices are saved

            const totalProcessed = updatedCount + createdCount;
            const totalFromFile = formattedInvoices.invoices.length;
            const matchedCount = matchingResults.matchCount;
            
            // #region agent log
            fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2382',message:'Final counts before logging',data:{updatedCount:updatedCount,createdCount:createdCount,totalProcessed:totalProcessed,matchedCount:matchedCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            
            log(`✅ Processed ${totalProcessed} invoices to database:`);
            log(`   - Updated existing: ${updatedCount}`);
            log(`   - Created new: ${createdCount}`);
            log(`   - Matched: ${matchedCount} out of ${totalFromFile} from file`);
            log(`   - Unmatched from file: ${matchingResults.unmatchedFileCount}`);
            log(`   - Unmatched from Xero: ${matchingResults.unmatchedXeroCount} (not saved)`);

            // Update log with completed status
            // unmatched count only includes unmatched file invoices (not unmatched Xero)
            await Statements.updateOne(
                { _id: logDoc._id },
                {
                    status: 'completed',
                    total: totalProcessed,
                    unmatched: matchingResults.unmatchedFileCount,
                    matched: matchedCount,
                    totalFromFile: totalFromFile
                }
            );

        } else {
            log('⚠️  Skipping database save - no supplier found');
        }

        // Update process document with file count and final status
        if (reqContext.processDoc) {
            try {
                const currentFileIndex = reqContext.currentFileIndex || 1;
                const totalFiles = reqContext.totalFiles || 1;
                const isCompleted = currentFileIndex >= totalFiles;
                
                // Ensure statement ID is in processId array (in case it wasn't added earlier)
                const updateData = {
                    description: `${currentFileIndex} statement(s) out of ${totalFiles} statements uploaded (${fileName})`,
                    status: isCompleted ? 'completed' : 'in_progress'
                };
                
                if (logDoc && logDoc._id) {
                    updateData.$addToSet = { processId: logDoc._id.toString() };
                }
                
                await Process.findByIdAndUpdate(reqContext.processDoc._id, updateData);
            } catch (processUpdateError) {
                console.error('Failed to update process document:', processUpdateError);
            }
        }

        // Return the parsed invoices
        const returnValue = {
            success: true,
            fileName: fileName,
            savedFileName: newFileName,
            fileType: parsedData.type,
            fileDate: formattedInvoices.fileDate,
            invoiceCount: formattedInvoices.invoices.length,
            xeroInvoiceCount: xeroInvoices.length,
            invoiceCountCheck: invoiceCountCheck, // Include the invoice count check result
            logId: logDoc._id,
            company: companyInfo,
            supplier: supplierInfo ? {
                id: supplierInfo._id,
                name: supplierInfo.name,
                xeroId: supplierInfo.xeroId
            } : null,
            invoices: formattedInvoices.invoices,
            xeroInvoices: xeroInvoices,
            matching: {
                matched: matchingResults.matched,
                unmatchedFile: matchingResults.unmatchedFile,
                unmatchedXero: matchingResults.unmatchedXero,
                stats: {
                    totalMatched: matchingResults.matchCount,
                    unmatchedFileCount: matchingResults.unmatchedFileCount,
                    unmatchedXeroCount: matchingResults.unmatchedXeroCount
                },
                statementType: matchingResults.statementType // Best ID analysis result
            },
            statementType: matchingResults.statementType, // Best ID analysis result (also at top level for easy access)
            savedToDatabase: supplierInfo && supplierInfo._id ? true : false
        };
        // #region agent log
        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2462',message:'processSingleInvoiceFile returning result',data:{returnKeys:Object.keys(returnValue),success:returnValue.success,invoiceCount:returnValue.invoiceCount,hasInvoices:Array.isArray(returnValue.invoices),hasMatching:!!returnValue.matching},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        return returnValue;

    } catch (error) {
        // Log error to database with comprehensive details
        await logErrorToDatabase(reqContext.processDoc, 'general_error', error, {
            fileName: fileName,
            savedFileName: newFileName,
            fileSize: fileSize,
            fileMimetype: fileMimetype,
            supplierId: supplierInfo?._id?.toString(),
            companyName: companyInfo?.name,
            step: 'processSingleInvoiceFile',
            timestamp: new Date(),
        }, logDoc?._id);

        // Also log to console for debugging
        console.error('Error parsing invoices:', {
            message: error.message,
            stack: isDevelopment ? error.stack : undefined,
            fileName: fileName,
            savedFileName: newFileName,
            supplierId: supplierInfo?._id?.toString(),
            logId: logDoc?._id?.toString()
        });

        // Update process document with file count and final status (even on error)
        if (reqContext.processDoc) {
            try {
                const currentFileIndex = reqContext.currentFileIndex || 1;
                const totalFiles = reqContext.totalFiles || 1;
                
                const updateData = {
                    description: `${currentFileIndex} statements(s) out of ${totalFiles} statements uploaded (${fileName})`,
                    status: 'failed'
                };
                
                // Ensure statement ID is in processId array if logDoc exists
                if (logDoc && logDoc._id) {
                    updateData.$addToSet = { processId: logDoc._id.toString() };
                }
                
                await Process.findByIdAndUpdate(reqContext.processDoc._id, updateData);
            } catch (processUpdateError) {
                console.error('Failed to update process document:', processUpdateError);
            }
        }

        // #region agent log
        fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2506',message:'processSingleInvoiceFile throwing error',data:{errorMessage:error?.message,errorName:error?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        throw error;
    }
}

// Upload only endpoint - saves files without processing
exports.uploadOnly = tryCatchAsync(async (req, res) => {
    const files = req.files && req.files.length > 0 ? req.files : (req.file ? [req.file] : []);
    
    if (files.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'No files uploaded'
        });
    }

    const folderPath = path.join(__dirname, "../../steve_files_do_not_delete");
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    const uploadedFiles = [];
    
    for (const file of files) {
        const fileExtension = path.extname(file.originalname) || '.pdf';
        const uniqueName = uuidv4() + fileExtension;
        const savePath = path.join(folderPath, uniqueName);
        
        fs.writeFileSync(savePath, file.buffer);
        
        uploadedFiles.push({
            originalName: file.originalname,
            savedName: uniqueName,
            size: file.size,
            mimetype: file.mimetype
        });
    }

    return res.json({
        success: true,
        message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
        files: uploadedFiles
    });
});

exports.parseInvoices = tryCatchAsync(async (req, res) => {
    console.log('parseInvoices', req.files);
    // Create process entry
    let processDoc = null;
    try {
        processDoc = await Process.create({
            status: 'in_progress',
            user: req.user?._id,
            description: `Processing ${req.files?.length || (req.file ? 1 : 0)} statements(s)`
        });
    } catch (processCreationError) {
        console.error('Failed to create process entry:', processCreationError);
        // Continue anyway
    }
    
    // Support both single file (req.file) and batch upload (req.files)
    const files = req.files && req.files.length > 0 ? req.files : (req.file ? [req.file] : []);
    
    if (files.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'No files uploaded'
        });
    }

    // If single file, process with existing logic (backward compatible)
    if (files.length === 1) {
        req.file = files[0];
        try {
            // #region agent log
            fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2538',message:'parseInvoices single file - calling processSingleInvoiceFile',data:{fileName:files[0]?.originalname,hasXeroToken:!!req.xeroAccessToken,hasTenantId:!!req.xeroTenantId,hasProcessDoc:!!processDoc},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            const reqContext = {
                xeroAccessToken: req.xeroAccessToken,
                xeroTenantId: req.xeroTenantId,
                processDoc: processDoc,
                tenant: req.user?.tenant,
                currentFileIndex: 1,
                totalFiles: 1
            };
            // #region agent log
            fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2545',message:'parseInvoices single file - reqContext prepared',data:{reqContextKeys:Object.keys(reqContext),hasProcessDoc:!!reqContext.processDoc,hasXeroToken:!!reqContext.xeroAccessToken,hasTenantId:!!reqContext.xeroTenantId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            const result = await processSingleInvoiceFile(files[0], reqContext);
            // #region agent log
            fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2549',message:'parseInvoices single file - processSingleInvoiceFile returned',data:{resultKeys:Object.keys(result),hasSuccess:result?.success!==undefined,hasInvoices:Array.isArray(result?.invoices),invoiceCount:result?.invoiceCount},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            return res.status(200).json(result);
        } catch (error) {
            // #region agent log
            fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2550',message:'parseInvoices single file - error caught',data:{errorMessage:error?.message,errorName:error?.name},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to parse invoices',
                error: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    } else {
        const results = [];
        const errors = [];
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                // #region agent log
                fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2563',message:'parseInvoices batch - calling processSingleInvoiceFile',data:{fileName:file?.originalname,fileIndex:i+1,totalFiles:files.length,hasProcessDoc:!!processDoc},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                const result = await processSingleInvoiceFile(file, {
                    xeroAccessToken: req.xeroAccessToken,
                    xeroTenantId: req.xeroTenantId,
                    processDoc: processDoc,
                    tenant: req.user?.tenant,
                    currentFileIndex: i + 1,
                    totalFiles: files.length
                });
                // #region agent log
                fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2571',message:'parseInvoices batch - processSingleInvoiceFile returned',data:{fileName:file?.originalname,resultKeys:Object.keys(result),hasSuccess:result?.success!==undefined,hasInvoices:Array.isArray(result?.invoices)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                
                results.push({
                    fileName: file.originalname,
                    success: true,
                    ...result
                });
            } catch (error) {
                // #region agent log
                fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'InvoiceController.js:2578',message:'parseInvoices batch - error caught',data:{fileName:file?.originalname,errorMessage:error?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                errors.push({
                    fileName: file.originalname,
                    success: false,
                    error: error.message || 'Failed to process file'
                });
            }
        }
        
        return res.status(200).json({
            success: true,
            batch: true,
            totalFiles: files.length,
            successful: results.length,
            failed: errors.length,
            results: results,
            errors: errors.length > 0 ? errors : undefined
        });
    }
});


exports.test = tryCatchAsync(async (req, res) => {
    const accessToken = req.xeroAccessToken;
    const tenantId = req.xeroTenantId;
    const supplierId = '160c3fba-15f3-43ea-b0cd-fdfa284d976e';

   
    // Get specific invoice by ID
    const invoiceId = 'fbfeb002-39e3-4ec9-af99-fc903c7109ca';
    const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`;

    // Helper function to handle rate limiting with Retry-After header
    const makeRequestWithRetry = async (url, config, maxRetries = 3) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await axios.get(url, config);
                return response;
            } catch (error) {
                // Check if it's a 429 rate limit error
                if (error.response?.status === 429) {
                    const retryAfter = error.response.headers['retry-after'] || error.response.headers['Retry-After'];
                    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60; // Default to 60 seconds if header missing

                    console.log(`Rate limit hit (429). Waiting ${waitSeconds} seconds before retry ${attempt + 1}/${maxRetries}...`);

                    // Wait for the specified time
                    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

                    // Continue to next iteration (retry)
                    continue;
                }

                // For other errors, throw immediately
                throw error;
            }
        }

        // If we've exhausted all retries, throw the last error
        throw new Error(`Request failed after ${maxRetries} retries`);
    };

    try {
        // Fetch invoice by ID with rate limit handling
        const invoiceResponse = await makeRequestWithRetry(invoiceUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });

        // Extract invoice from response (could be in Invoices array or single Invoice object)
        const invoice = invoiceResponse.data.Invoices?.[0] || invoiceResponse.data.Invoice || invoiceResponse.data;
        console.log(`Fetched invoice ${invoiceId}`);

        // Fetch additional data for the invoice
        const additionalData = {};

        // Fetch payments for this invoice
        try {
            const paymentsUrl = `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}/Payments`;
            const paymentsResponse = await makeRequestWithRetry(paymentsUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                },
            });
            additionalData.payments = paymentsResponse.data.Payments || [];
            console.log(`Found ${additionalData.payments.length} payment(s) for invoice ${invoiceId}`);
        } catch (paymentError) {
            console.error(`Error fetching payments for invoice ${invoiceId}:`, paymentError.message);
            additionalData.payments = [];
        }

        // Fetch linked transactions for this invoice
        try {
            const linkedTransactionsWhere = `SourceTransactionID == Guid("${invoiceId}") OR TargetTransactionID == Guid("${invoiceId}")`;
            const linkedTransactionsUrl = `https://api.xero.com/api.xro/2.0/LinkedTransactions?where=${encodeURIComponent(linkedTransactionsWhere)}`;
            const linkedTransactionsResponse = await makeRequestWithRetry(linkedTransactionsUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                },
            });
            additionalData.linkedTransactions = linkedTransactionsResponse.data.LinkedTransactions || [];
            console.log(`Found ${additionalData.linkedTransactions.length} linked transaction(s) for invoice ${invoiceId}`);
        } catch (linkedError) {
            console.error(`Error fetching linked transactions for invoice ${invoiceId}:`, linkedError.message);
            additionalData.linkedTransactions = [];
        }

        // Fetch contact details if contact ID exists
        if (invoice.Contact && invoice.Contact.ContactID) {
            try {
                const contactUrl = `https://api.xero.com/api.xro/2.0/Contacts/${invoice.Contact.ContactID}`;
                const contactResponse = await makeRequestWithRetry(contactUrl, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Xero-tenant-id': tenantId,
                        Accept: 'application/json',
                    },
                });
                additionalData.contactDetails = contactResponse.data.Contacts?.[0] || contactResponse.data.Contacts || contactResponse.data;
                console.log(`Fetched contact details for invoice ${invoiceId}`);
            } catch (contactError) {
                console.error(`Error fetching contact details for invoice ${invoiceId}:`, contactError.message);
                additionalData.contactDetails = null;
            }
        }

        res.status(200).json({
            success: true,
            message: 'Invoice fetched successfully with additional data',
            invoiceId: invoiceId,
            invoice: invoice,
            payments: additionalData.payments,
            linkedTransactions: additionalData.linkedTransactions,
            contactDetails: additionalData.contactDetails
        });
    } catch (error) {
        console.error('Failed to fetch invoice from Xero:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch invoice from Xero',
            error: error.message,
            invoiceId: invoiceId
        });
    }
});

exports.getInvoiceByReference = tryCatchAsync(async (req, res) => {
    const accessToken = req.xeroAccessToken;
    const tenantId = req.xeroTenantId;
    const referenceId = req.query.referenceId || req.params.referenceId;

    // Check if Xero credentials are available
    if (!accessToken || !tenantId) {
        return res.status(401).json({
            success: false,
            message: 'Xero authentication required. Missing access token or tenant ID.',
            hasAccessToken: !!accessToken,
            hasTenantId: !!tenantId
        });
    }

    // Check if reference ID is provided
    if (!referenceId) {
        return res.status(400).json({
            success: false,
            message: 'Reference ID is required. Provide it as query parameter: ?referenceId=YOUR_REFERENCE_ID'
        });
    }

    // Helper function to handle rate limiting with Retry-After header
    const makeRequestWithRetry = async (url, config, maxRetries = 3) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await axios.get(url, config);
                return response;
            } catch (error) {
                // Check if it's a 429 rate limit error
                if (error.response?.status === 429) {
                    const retryAfter = error.response.headers['retry-after'] || error.response.headers['Retry-After'];
                    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;

                    console.log(`Rate limit hit (429). Waiting ${waitSeconds} seconds before retry ${attempt + 1}/${maxRetries}...`);
                    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
                    continue;
                }
                throw error;
            }
        }
        throw new Error(`Request failed after ${maxRetries} retries`);
    };

    try {
        // Search for invoices by Reference or InvoiceNumber
        // Xero API allows filtering by Reference field
        const where = `Reference == "${referenceId}" OR InvoiceNumber == "${referenceId}"`;
        const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}`;

        const invoiceResponse = await makeRequestWithRetry(invoiceUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });

        const allInvoices = invoiceResponse.data.Invoices || [];
        
        // Filter to only get unpaid invoices from Xero
        // An invoice is unpaid if AmountDue > 0 (there's still an amount due)
        const invoices = allInvoices.filter(inv => {
            const amountDue = parseFloat(inv.AmountDue || 0);
            return amountDue > 0;
        });
        
        console.log(`Found ${allInvoices.length} invoice(s) with reference ID: ${referenceId}, ${invoices.length} unpaid`);

        res.status(200).json({
            success: true,
            message: 'Invoices fetched successfully',
            referenceId: referenceId,
            invoiceCount: invoices.length,
            invoices: invoices
        });
    } catch (error) {
        console.error('Failed to fetch invoices by reference ID from Xero:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch invoices by reference ID from Xero',
            error: error.message,
            referenceId: referenceId
        });
    }
});


/**
 * Calculate match percentage (0-100%) based on amount and date differences
 * Note: Customer invoices are expected to be HIGHER than supplier invoices due to profit margins
 * and being sent BEFORE the supplier invoice, so higher amounts are treated more favorably.
 * @param {Number} amountDiff - Absolute difference in amount
 * @param {Number} dateDiff - Absolute difference in days
 * @param {Number} sourceAmount - Source supplier invoice amount
 * @param {Number} customerAmount - Customer invoice amount
 * @returns {Number} Match percentage between 0 and 100
 */
const calculateMatchPercentage = (amountDiff, dateDiff, sourceAmount, customerAmount) => {
    // Amount match percentage (weight: 90%)
    // Customer invoices are expected to be HIGHER due to profit margins
    // So we treat higher amounts more favorably than lower amounts
    let amountMatchPercent = 100;
    
    if (sourceAmount > 0) {
        const isCustomerHigher = customerAmount > sourceAmount;
        const amountDiffPercent = (amountDiff / sourceAmount) * 100;
        
        if (isCustomerHigher) {
            // Customer invoice is higher (EXPECTED - due to profit margin)
            // Treat this more favorably
            if (amountDiffPercent <= 5) {
                // Within 5% higher = 100% match (reasonable profit margin)
                amountMatchPercent = 100;
            } else if (amountDiffPercent <= 10) {
                // 5-10% higher: 95-100% (still good profit margin)
                amountMatchPercent = 100 - ((amountDiffPercent - 5) * 1);
            } else if (amountDiffPercent <= 20) {
                // 10-20% higher: 90-95% (higher but reasonable margin)
                amountMatchPercent = 95 - ((amountDiffPercent - 10) * 0.5);
            } else if (amountDiffPercent <= 30) {
                // 20-30% higher: 85-90% (high margin but acceptable)
                amountMatchPercent = 90 - ((amountDiffPercent - 20) * 0.5);
            } else if (amountDiffPercent <= 50) {
                // 30-50% higher: 70-85% (very high margin)
                amountMatchPercent = 85 - ((amountDiffPercent - 30) * 0.75);
            } else {
                // >50% higher: 0-70% (unusually high, likely not a match)
                amountMatchPercent = Math.max(0, 70 - ((amountDiffPercent - 50) * 1.4));
            }
        } else {
            // Customer invoice is LOWER (UNUSUAL - should be penalized more)
            // This is unexpected since customer invoices should be higher
            if (amountDiffPercent <= 1) {
                // Within 1% lower = 95% match (very close, slight penalty)
                amountMatchPercent = 95;
            } else if (amountDiffPercent <= 5) {
                // 1-5% lower: 85-95% (penalize for being lower)
                amountMatchPercent = 95 - ((amountDiffPercent - 1) * 2.5);
            } else if (amountDiffPercent <= 10) {
                // 5-10% lower: 70-85% (significant penalty)
                amountMatchPercent = 85 - ((amountDiffPercent - 5) * 3);
            } else if (amountDiffPercent <= 20) {
                // 10-20% lower: 50-70% (large penalty)
                amountMatchPercent = 70 - ((amountDiffPercent - 10) * 2);
            } else {
                // >20% lower: 0-50% (very unlikely to be a match)
                amountMatchPercent = Math.max(0, 50 - ((amountDiffPercent - 20) * 2.5));
            }
        }
    } else if (amountDiff > 0) {
        // If source amount is 0 but there's a difference, it's not a match
        amountMatchPercent = 0;
    }

    // Date match percentage (weight: 10%)
    // Perfect match (0 days) = 100%, decreases as days increase
    let dateMatchPercent = 100;
    if (dateDiff === Infinity || dateDiff === null || isNaN(dateDiff)) {
        // No date available = neutral (50%)
        dateMatchPercent = 50;
    } else if (dateDiff === 0) {
        dateMatchPercent = 100;
    } else if (dateDiff <= 1) {
        // Same day or 1 day difference = 100%
        dateMatchPercent = 100;
    } else if (dateDiff <= 7) {
        // 1-7 days: 90-100%
        dateMatchPercent = 100 - ((dateDiff - 1) * 1.67);
    } else if (dateDiff <= 30) {
        // 7-30 days: 60-90%
        dateMatchPercent = 90 - ((dateDiff - 7) * 1.3);
    } else if (dateDiff <= 90) {
        // 30-90 days: 30-60%
        dateMatchPercent = 60 - ((dateDiff - 30) * 0.5);
    } else {
        // >90 days: 0-30%
        dateMatchPercent = Math.max(0, 30 - ((dateDiff - 90) * 0.33));
    }

    // Combine with weights: 90% amount, 10% date
    const matchPercentage = (amountMatchPercent * 0.9) + (dateMatchPercent * 0.1);
    
    // Ensure it's between 0 and 100
    return Math.max(0, Math.min(100, Math.round(matchPercentage * 100) / 100));
};

exports.jobMatch = tryCatchAsync(async (req, res) => {
    const accessToken = req.xeroAccessToken;
    const tenantId = req.xeroTenantId;
 
    // Get invoice by invoice number (using first invoice from array)
    let invoiceByNumber = null;
    const searchInvoiceNumber = '2556654'; 
    const invoiceId = '6963ba32ca9ee24f688c8e9c'

    const getSupplerInvoiceByInvoiceId = await (async () => {
        const where = `InvoiceNumber == "${searchInvoiceNumber}"`;
        const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}`;
        const invoiceResponse = await axios.get(invoiceUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });

        const invoices = invoiceResponse.data.Invoices || [];
        if (invoices.length === 0) {
            throw new AppError(`No invoice found with invoice number "${searchInvoiceNumber}"`, 404);
        }

        invoiceByNumber = invoices[0];

        // Get the full invoice details using the InvoiceID
        const invoiceId = invoiceByNumber.InvoiceID;
        if (!invoiceId) {
            // Return partial invoice if no ID available (not an error case)
            return invoiceByNumber;
        }

        const fullInvoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`;
        const fullInvoiceResponse = await axios.get(fullInvoiceUrl, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Xero-tenant-id': tenantId,
                Accept: 'application/json',
            },
        });

        const fullInvoice = fullInvoiceResponse.data.Invoices?.[0] || null;
        if (fullInvoice) {
            return fullInvoice;
        } else {
            // Return partial invoice as fallback if full details not found
            return invoiceByNumber;
        }
    })();

    // Fetch and print contact details for the search invoice
    let contactDetails = null;
    if (getSupplerInvoiceByInvoiceId.Contact && getSupplerInvoiceByInvoiceId.Contact.ContactID) {
        try {
            const contactId = getSupplerInvoiceByInvoiceId.Contact.ContactID;
            const contactUrl = `https://api.xero.com/api.xro/2.0/Contacts/${contactId}`;
            
            const contactResponse = await axios.get(contactUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                },
            });

            contactDetails = contactResponse.data.Contacts?.[0] || null;
            
            if (contactDetails) {
                console.log('=== Contact Details for Search Invoice ===');
                console.log('Contact ID:', contactDetails.ContactID);
                console.log('Name:', contactDetails.Name);
                console.log('Email:', contactDetails.EmailAddress || 'N/A');
                console.log('Phone:', contactDetails.Phones?.[0]?.PhoneNumber || 'N/A');
                console.log('Address:', contactDetails.Addresses?.[0]?.AddressLine1 || 'N/A');
                console.log('City:', contactDetails.Addresses?.[0]?.City || 'N/A');
                console.log('Postal Code:', contactDetails.Addresses?.[0]?.PostalCode || 'N/A');
                console.log('Country:', contactDetails.Addresses?.[0]?.Country || 'N/A');
                console.log('Contact Status:', contactDetails.ContactStatus || 'N/A');
                console.log('Is Supplier:', contactDetails.IsSupplier || false);
                console.log('Is Customer:', contactDetails.IsCustomer || false);
                console.log('Full Contact Object:', JSON.stringify(contactDetails, null, 2));
                console.log('==========================================');
            }
        
        } catch (error) {
            console.error('Error fetching contact details from Xero:', error.message);
            console.log('Partial contact info from invoice:', {
                ContactID: getSupplerInvoiceByInvoiceId.Contact?.ContactID,
                Name: getSupplerInvoiceByInvoiceId.Contact?.Name,
                Email: getSupplerInvoiceByInvoiceId.Contact?.EmailAddress
            });
        }
    } else {
        console.log('No contact information available in the invoice');
    }

    const foundInvoices = await (async () => {
        try {
            // Search by Reference field only (with null guard for optional field) and filter for ACCREC type
            const where = `Reference != null AND Reference == "${getSupplerInvoiceByInvoiceId.LineItems[0].Description}" AND Type == "ACCREC"`;
            const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}`;

            const invoiceResponse = await axios.get(invoiceUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                },
            });

            const invoices = invoiceResponse.data.Invoices || [];
            
            // Get full details for each invoice found
            const fullInvoices = await Promise.all(
                invoices.map(async (invoice) => {
                    const invoiceId = invoice.InvoiceID;
                    if (!invoiceId) {
                        // Return partial invoice if no ID available
                        return invoice;
                    }

                    try {
                        const fullInvoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`;
                        const fullInvoiceResponse = await axios.get(fullInvoiceUrl, {
                            headers: {
                                Authorization: `Bearer ${accessToken}`,
                                'Xero-tenant-id': tenantId,
                                Accept: 'application/json',
                            },
                        });

                        const fullInvoice = fullInvoiceResponse.data.Invoices?.[0] || null;
                        return fullInvoice || invoice; // Return full invoice or fallback to partial
                    } catch (error) {
                        console.error(`Error fetching full details for invoice ${invoiceId}:`, error.message);
                        return invoice; // Return partial invoice on error
                    }
                })
            );

            return fullInvoices;
        } catch (error) {
            console.log(error);
            console.error(`Error searching for variation "$" in Xero:`, error.message);
            return [];
        }
    })()
        
    // Rank invoices by amount closeness, then by date closeness
    const sourceAmount = parseFloat(getSupplerInvoiceByInvoiceId.Total || getSupplerInvoiceByInvoiceId.SubTotal || 0);
    const sourceDate = getSupplerInvoiceByInvoiceId.DateString ? new Date(getSupplerInvoiceByInvoiceId.DateString) : null;
    
    // Keep ranking metadata with invoices
    const rankedInvoicesWithMetadata = foundInvoices
        .map(invoice => {
            const invoiceAmount = parseFloat(invoice.Total || invoice.SubTotal || 0);
            const invoiceDate = invoice.DateString ? new Date(invoice.DateString) : null;
            
            // Calculate amount difference (absolute value)
            const amountDiff = Math.abs(sourceAmount - invoiceAmount);
            
            // Calculate date difference in days (absolute value)
            let dateDiff = Infinity;
            if (sourceDate && invoiceDate && !isNaN(sourceDate.getTime()) && !isNaN(invoiceDate.getTime())) {
                dateDiff = Math.abs((sourceDate - invoiceDate) / (1000 * 60 * 60 * 24)); // Convert to days
            }
            
            // Calculate match percentage
            // Pass customerAmount so we can determine if it's higher (expected) or lower (unusual)
            const matchPercentage = calculateMatchPercentage(amountDiff, dateDiff, sourceAmount, invoiceAmount);
            
            return {
                invoice,
                amountDiff,
                dateDiff,
                // Combined score: amount difference is primary (multiplied by 1000 to give it more weight)
                // date difference is secondary (in days)
                score: amountDiff * 1000 + dateDiff,
                matchPercentage: matchPercentage
            };
        })
        .sort((a, b) => {
            // Sort by score (lower is better - closer amounts and dates)
            // If scores are equal, prefer the one with closer date
            if (Math.abs(a.score - b.score) < 0.01) {
                return a.dateDiff - b.dateDiff;
            }
            return a.score - b.score;
        });
    
    // Extract just the invoices for response
    const rankedInvoices = rankedInvoicesWithMetadata.map(item => item.invoice);
    
    console.log('Ranked invoices:', rankedInvoices.map(inv => ({
        ref: inv.Reference,
        amount: inv.Total || inv.SubTotal,
        date: inv.DateString,
        amountDiff: Math.abs(sourceAmount - parseFloat(inv.Total || inv.SubTotal || 0))
    })));

    // Check if job already exists for this invoice and clean up old data
    const sourceInvoiceId = getSupplerInvoiceByInvoiceId.InvoiceID;
    let deletedJobsCount = 0;
    let deletedSupplierInvoicesCount = 0;

    try {
        // Find all existing jobs for this source invoice (by invoice ID or invoice number)
        const existingJobs = await Job.find({
            $or: [
                { sourceInvoiceId: sourceInvoiceId },
                { sourceInvoiceNumber: searchInvoiceNumber }
            ],
            isDeleted: { $ne: true }
        }).populate('rankedInvoices.supplierInvoice');

        if (existingJobs.length > 0) {
            console.log(`Found ${existingJobs.length} existing job(s) for invoice ${searchInvoiceNumber}. Cleaning up...`);

            // Collect all supplier invoice IDs from all existing jobs
            const supplierInvoiceIdsToDelete = [];
            for (const existingJob of existingJobs) {
                if (existingJob.rankedInvoices && existingJob.rankedInvoices.length > 0) {
                    for (const rankedInvoice of existingJob.rankedInvoices) {
                        if (rankedInvoice.supplierInvoice) {
                            // Handle both populated documents and ObjectId references
                            let invoiceId;
                            if (typeof rankedInvoice.supplierInvoice === 'object' && rankedInvoice.supplierInvoice._id) {
                                // Populated document
                                invoiceId = rankedInvoice.supplierInvoice._id;
                            } else {
                                // ObjectId reference
                                invoiceId = rankedInvoice.supplierInvoice;
                            }
                            if (invoiceId) {
                                supplierInvoiceIdsToDelete.push(invoiceId);
                            }
                        }
                    }
                }
            }

            // Delete all linked supplier invoices (remove duplicates)
            const uniqueSupplierInvoiceIds = [...new Set(supplierInvoiceIdsToDelete.map(id => id.toString()))];
            if (uniqueSupplierInvoiceIds.length > 0) {
                const deleteResult = await SupplierInvoice.deleteMany({
                    _id: { $in: uniqueSupplierInvoiceIds },
                    isDeleted: { $ne: true }
                });
                deletedSupplierInvoicesCount = deleteResult.deletedCount;
                console.log(`Deleted ${deletedSupplierInvoicesCount} supplier invoice(s) linked to old job(s)`);
            }

            // Delete all existing jobs
            const jobDeleteResult = await Job.deleteMany({
                $or: [
                    { sourceInvoiceId: sourceInvoiceId },
                    { sourceInvoiceNumber: searchInvoiceNumber }
                ],
                isDeleted: { $ne: true }
            });
            deletedJobsCount = jobDeleteResult.deletedCount;
            console.log(`Deleted ${deletedJobsCount} existing job(s) for invoice ${searchInvoiceNumber}`);
        }
    } catch (error) {
        console.error('Error cleaning up existing jobs and supplier invoices:', error.message);
        // Continue with creating new records even if cleanup fails
    }

    // Save ranked invoices to SupplierInvoice model and create Job record
    const savedSupplierInvoices = [];
    const rankedInvoiceRefs = [];

    for (let i = 0; i < rankedInvoicesWithMetadata.length; i++) {
        const { invoice, amountDiff, dateDiff, score, matchPercentage } = rankedInvoicesWithMetadata[i];
        const xeroInvoiceId = invoice.InvoiceID;

        if (!xeroInvoiceId) {
            console.warn('Skipping invoice without InvoiceID:', invoice.InvoiceNumber || 'Unknown');
            continue;
        }

        try {
            // Find or create vendor from contact
            let vendor = null;
            const contactId = invoice.Contact?.ContactID;
            if (contactId) {
                vendor = await Vendor.findOne({ xeroId: contactId });
                if (!vendor) {
                    // Create vendor if it doesn't exist
                    vendor = await Vendor.create({
                        xeroId: contactId,
                        name: invoice.Contact?.Name || 'Unknown Vendor'
                    });
                }
            }

            if (!vendor) {
                console.warn(`Skipping invoice ${invoice.InvoiceNumber || 'Unknown'}: No vendor found for contact ${contactId}`);
                continue;
            }

            // Find or create supplier invoice
            let supplierInvoice = await SupplierInvoice.findOne({ 
                invoiceNumber: invoice.InvoiceNumber || '',
                vendorId: vendor._id
            });

            const invoiceData = {
                invoiceNumber: invoice.InvoiceNumber || null,
                vendorId: vendor._id,
                paymentStatus: invoice.Status === 'PAID' || invoice.Status === 'AUTHORISED' ? 'paid' : 'unpaid',
                status: 'Unreconciled',
                vendorAmount: invoice.Total || invoice.SubTotal || null,
                xeroAmount: invoice.Total || invoice.SubTotal || null,
                description: invoice.Reference || invoice.LineItems?.[0]?.Description || null,
                vendorCurrency: invoice.CurrencyCode || null,
                xeroCurrency: invoice.CurrencyCode || null,
                VendorDate: invoice.DateString ? new Date(invoice.DateString) : null,
                xeroDate: invoice.DateString ? new Date(invoice.DateString) : null,
            };

            if (supplierInvoice) {
                // Update existing supplier invoice
                Object.assign(supplierInvoice, invoiceData);
                await supplierInvoice.save();
            } else {
                // Create new supplier invoice
                supplierInvoice = await SupplierInvoice.create(invoiceData);
            }

            savedSupplierInvoices.push(supplierInvoice);

            // Add to ranked invoices array with rank (1-based index)
            rankedInvoiceRefs.push({
                supplierInvoice: supplierInvoice._id,
                rank: i + 1, // Rank starts at 1
                amountDiff: amountDiff,
                dateDiff: dateDiff,
                score: score,
                matchPercentage: matchPercentage,
            });
        } catch (error) {
            console.error(`Error saving supplier invoice ${xeroInvoiceId}:`, error.message);
        }
    }

    // Create Job record
    let job;
    try {
        const searchReference = getSupplerInvoiceByInvoiceId.LineItems?.[0]?.Description || null;

        job = await Job.create({
            sourceInvoiceNumber: searchInvoiceNumber,
            sourceInvoiceId: sourceInvoiceId || null,
            sourceInvoiceData: getSupplerInvoiceByInvoiceId,
            contactDetails: contactDetails,
            rankedInvoices: rankedInvoiceRefs,
            searchReference: searchReference,
            totalMatches: rankedInvoiceRefs.length,
            status: rankedInvoiceRefs.length > 0 ? 'matched' : 'pending',
        });

        console.log(`Job created with ID: ${job._id}, ${rankedInvoiceRefs.length} ranked invoices saved`);
    } catch (error) {
        console.error('Error creating job record:', error.message);
        // Continue even if job creation fails
    }

    res.status(200).json({
        success: true,
        message: 'Invoice search completed',
        invoiceByNumber: getSupplerInvoiceByInvoiceId,
        contactDetails: contactDetails, // Full contact details from Xero
        foundInvoices: rankedInvoices, // Ranked by amount and date closeness
        jobId: job?._id || null, // Return job ID if created
        savedSupplierInvoicesCount: savedSupplierInvoices.length,
        deletedJobsCount: deletedJobsCount, // Number of old jobs deleted
        deletedSupplierInvoicesCount: deletedSupplierInvoicesCount, // Number of old supplier invoices deleted
        // searchedVariations: variations,
        // foundInvoices: foundInvoices.map(inv =>( {ref: inv.Reference , type: inv.Type, contact: inv.Contact.Name})),
        // totalFound: rankedInvoices.length
    });
});

exports.findMissedInvoices = tryCatchAsync(async (req, res) => {
    const supplierId = req.query.supplierId;
    const accessToken = req.xeroAccessToken;
    const tenantId = req.xeroTenantId;

    if (!supplierId) {
        throw new AppError('Supplier ID is required', 400);
    }

    // Get supplier from database
    const supplier = await Vendor.findById(supplierId);
    
    if (!supplier) {
        throw new AppError('Supplier not found', 404);
    }

    if (!supplier.xeroId) {
        throw new AppError('Supplier does not have a Xero ID', 400);
    }

    // Get lastInvoiceMissCheck, use today if null
    const lastInvoiceMissCheck = supplier.lastInvoiceMissCheck || new Date();

    console.log('supplierId', supplierId);
    console.log('supplier', supplier);
    console.log('lastInvoiceMissCheck', lastInvoiceMissCheck);

    // Get all invoices from Xero for this supplier with pagination
    const allInvoices = [];
    let page = 1;
    const pageSize = 100;
    let hasMorePages = true;

    while (hasMorePages) {
        try {
            // Build where clause: filter by contact ID and type ACCPAY (supplier invoices/bills)
            const where = `Contact.ContactID == Guid("${supplier.xeroId}") AND Type == "ACCPAY"`;
            const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}&page=${page}&pageSize=${pageSize}`;
            
            const invoiceResponse = await axios.get(invoiceUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Xero-tenant-id': tenantId,
                    Accept: 'application/json',
                },
            });

            const invoices = invoiceResponse.data.Invoices || [];
            
            if (invoices.length === 0) {
                hasMorePages = false;
            } else {
                allInvoices.push(...invoices);
                if (invoices.length < pageSize) {
                    hasMorePages = false;
                } else {
                    page++;
                }
            }
        } catch (error) {
            console.error(`Error fetching page ${page} from Xero:`, error.message);
            throw new AppError(`Failed to fetch invoices from Xero: ${error.message}`, 500);
        }
    }

    console.log(`Found ${allInvoices.length} total invoices from Xero for supplier ${supplier.name}`);

    // Get all existing invoice IDs for this supplier from SupplierInvoice database
    const existingInvoices = await SupplierInvoice.find({
        vendorId: supplierId,
        isDeleted: { $ne: true },
        xeroInvoiceId: { $exists: true, $ne: null }
    }).select('xeroInvoiceId').lean();

    const existingInvoiceIds = new Set(
        existingInvoices.map(inv => inv.xeroInvoiceId).filter(Boolean)
    );

    console.log(`Found ${existingInvoiceIds.size} existing supplier invoices in database for supplier ${supplier.name}`);

    // Map through Xero invoices and find ones that don't exist in our database
    const missedInvoices = [];
    
    for (const xeroInvoice of allInvoices) {
        const invoiceId = xeroInvoice.InvoiceID;
        
        if (!invoiceId) {
            continue; // Skip invoices without InvoiceID
        }

        // Check if we have this invoice ID in our database
        if (!existingInvoiceIds.has(invoiceId)) {
            missedInvoices.push(xeroInvoice);
        }
    }

    console.log(`Found ${missedInvoices.length} missed invoices (not in database)`);

    // Create invoices in database for missed invoices
    const createdInvoices = [];
    
    for (const xeroInvoice of missedInvoices) {
        try {
            // Parse date from Xero DateString
            const invoiceXeroDate = xeroInvoice.DateString ? new Date(xeroInvoice.DateString) : null;
            
            // Validate date - skip if invalid or missing
            if (!invoiceXeroDate || isNaN(invoiceXeroDate.getTime())) {
                console.warn(`Skipping invoice ${xeroInvoice.InvoiceNumber || xeroInvoice.InvoiceID}: Invalid or missing DateString`);
                continue;
            }
            
            // Parse amounts from Xero - use SubTotal if available, otherwise calculate from Total - TotalTax
            // This matches the pattern used elsewhere in the codebase
            const xeroAmount = parseFloat(xeroInvoice.SubTotal || (xeroInvoice.Total ? (parseFloat(xeroInvoice.Total || 0) - parseFloat(xeroInvoice.TotalTax || 0)) : 0));
            
            // Validate amount - skip if zero or negative (might indicate missing data)
            if (!xeroAmount || xeroAmount <= 0) {
                console.warn(`Skipping invoice ${xeroInvoice.InvoiceNumber || xeroInvoice.InvoiceID}: Invalid or missing amount (${xeroAmount})`);
                continue;
            }
            
            // Determine payment status: "PAID" = paid, otherwise unpaid
            const paymentStatus = xeroInvoice.Status === 'PAID' ? 'paid' : 'unpaid';
            
            // Get currency code, default to USD if not provided
            const currency = (xeroInvoice.CurrencyCode || 'USD').toUpperCase();
            
            // Create invoice data using new database model structure
            const invoiceData = {
                vendorId: supplierId,
                VendorDate: null, // No supplier date available
                xeroDate: invoiceXeroDate, // Date from Xero
                invoiceNumber: xeroInvoice.InvoiceNumber,
                description: null, // Not available from Xero invoice
                vendorAmount: null, // No supplier amount available
                xeroAmount: xeroAmount,
                vendorCurrency: null, // No supplier currency available
                xeroCurrency: currency,
                paymentStatus: paymentStatus,
                status: 'Unreconciled', // Required field - these are missed invoices not yet reconciled
                statementId: null, // These invoices aren't from a statement/log file
                xeroInvoiceId: xeroInvoice.InvoiceID || null
            };

            // Create the invoice using SupplierInvoice model
            const createdInvoice = await SupplierInvoice.create(invoiceData);
            createdInvoices.push(createdInvoice);
            
            console.log(`Created invoice: ${xeroInvoice.InvoiceNumber} for supplier ${supplier.name} (Date: ${invoiceXeroDate.toISOString().split('T')[0]}, Amount: ${xeroAmount})`);
        } catch (error) {
            console.error(`Error creating invoice ${xeroInvoice.InvoiceNumber}:`, error.message);
            // Continue with other invoices even if one fails
        }
    }

    console.log(`Successfully created ${createdInvoices.length} invoices in database`);

    // Update lastInvoiceMissCheck timestamp
    supplier.lastInvoiceMissCheck = new Date();
    await supplier.save();
    
    res.status(200).json({
        success: true,
        message: 'Find missed invoices request received',
        supplierId: supplierId,
        supplier: supplier,
        totalXeroInvoices: allInvoices.length,
        existingInvoicesCount: existingInvoiceIds.size,
        missedInvoicesCount: missedInvoices.length,
        createdInvoicesCount: createdInvoices.length,
        missedInvoices: missedInvoices,
        createdInvoices: createdInvoices.map(inv => ({
            _id: inv._id,
            invoiceNumber: inv.invoiceNumber,
            VendorDate: inv.VendorDate,
            vendorAmount: inv.vendorAmount,
            xeroAmount: inv.xeroAmount
        }))
    });
});

exports.pdfSeeing = tryCatchAsync(async (req, res) => {
    // Check if file was uploaded
    if (!req.file) {
        throw new AppError('No PDF file uploaded', 400);
    }

    // Check if file is a PDF
    if (req.file.mimetype !== 'application/pdf') {
        throw new AppError('File must be a PDF', 400);
    }

    // Validate buffer exists and has data
    if (!req.file.buffer || req.file.buffer.length === 0) {
        throw new AppError('File buffer is empty', 400);
    }

    // Get OpenRouter API key from environment
    const openRouterKey = process.env.OPEN_ROUTER;
    if (!openRouterKey) {
        throw new AppError('OpenRouter API key not configured', 500);
    }

    // Convert PDF buffer to base64 data URL format
    const base64Pdf = req.file.buffer.toString('base64');
    const fileName = req.file.originalname || 'document.pdf';
    const fileDataUrl = `data:application/pdf;base64,${base64Pdf}`;

    console.log(`[pdfSeeing] Processing file: ${fileName}, size: ${req.file.buffer.length} bytes, base64 length: ${base64Pdf.length}`);

    // Call OpenRouter API to extract text from PDF
    let response;
    try {
        // Try with file_data (snake_case) as some APIs use this format
        const requestBody = {
            model: 'google/gemini-2.5-flash',
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Extract all text from this PDF exactly.',
                        },
                        {
                            type: 'file',
                            file: {
                                filename: fileName,
                                file_data: fileDataUrl,
                            },
                        },
                    ],
                },
            ],
            plugins: [
                {
                    id: 'file-parser',
                    pdf: {
                        engine: 'mistral-ocr',
                    },
                },
            ],
        };

        response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            requestBody,
            {
                headers: {
                    Authorization: `Bearer ${openRouterKey}`,
                    'Content-Type': 'application/json',
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            }
        );
    } catch (error) {
        console.error(`Error calling OpenRouter API:`, error.message);

    }

    // Extract the text content from the response
    const extractedText = response.data?.choices?.[0]?.message?.content || '';

    res.status(200).json({

        extractedText: extractedText,
    });
});
