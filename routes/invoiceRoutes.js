const express = require("express");
const router = express.Router();
const authController = require("../controllers/AuthController");
const invoiceController = require("../controllers/InvoiceController");
const logController = require("../controllers/LogController");
const supplierController = require("../controllers/SupplierController");

router.post(
    "/upload-only",
    authController.protect,
    invoiceController.upload.array("files", 50),
    invoiceController.handleMulterError,
    invoiceController.validateUploadedFiles,
    invoiceController.uploadOnly
);
router.post(
    "/parse-invoices",
    authController.protect,
    invoiceController.upload.array("files", 50),
    invoiceController.handleMulterError,
    invoiceController.validateUploadedFiles,
    authController.xeroClient,
    authController.xeroTokenInfo,
    invoiceController.parseInvoices
);
router.get("/get-invoices", authController.protect, invoiceController.getInvoices);
router.get("/get-vendors", authController.protect, supplierController.getSuppliers);
router.get("/get-statements", authController.protect, logController.getLogs);
router.get("/get-all-invoices", authController.protect, invoiceController.getAllInvoices);
router.get("/get-invoices-by-supplier", authController.protect, supplierController.getInvoicesBySupplier);
router.get("/get-missed-invoices", authController.protect, supplierController.getMissedInvoices);
router.get("/get-unmatched-invoices", authController.protect, supplierController.getUnmatchedInvoices);
router.get("/get-matched-invoices", authController.protect, supplierController.getMatchedInvoices);
router.get("/get-all-statements", authController.protect, logController.getAllLogs);
router.get("/get-newer-statement", authController.protect, logController.getNewerLog);
router.get("/get-all-activities", authController.protect, logController.getAllActivities);
router.delete("/delete-statement/:id", authController.protect, logController.deleteLog);
router.delete("/delete-invoice/:id", authController.protect, invoiceController.deleteInvoice);
router.get("/missing-invoices", authController.protect, authController.xeroClient, authController.xeroTokenInfo, invoiceController.findMissedInvoices);
router.post(
    "/pdfSeeing",
    authController.protect,
    invoiceController.upload.single("file"),
    invoiceController.handleMulterError,
    invoiceController.validateUploadedFiles,
    invoiceController.pdfSeeing
);
// router.get("/test", authController.protect, authController.xeroClient, authController.xeroTokenInfo, invoiceController.test);
// router.post("/job-match", authController.protect, authController.xeroClient, authController.xeroTokenInfo, invoiceController.jobMatch);
module.exports = router;
