const express = require("express");
const router = express.Router();
const supplierLogsController = require("../controllers/supplierLogsController");

router.get("/statements", supplierLogsController.getStatementsByVendor);
router.get("/statements/:id/invoices", supplierLogsController.getInvoicesByStatementId);
router.get("/all-statements", supplierLogsController.getAllStatements);
router.get("/statement-contact-ids", supplierLogsController.getStatementContactIds);
router.get("/statement-transfer", supplierLogsController.statementTransfer);
router.get("/all-invoices", supplierLogsController.getAllInvoices);
router.delete("/statements/:id", supplierLogsController.deleteStatement);
router.delete("/invoices/:id", supplierLogsController.deleteInvoice);
router.get("/invoices", supplierLogsController.getInvoicesBySupplier);
router.get("/missed-invoices", supplierLogsController.getMissedInvoices);
router.get("/unmatched-invoices", supplierLogsController.getUnmatchedInvoices);
router.get("/matched-invoices", supplierLogsController.getMatchedInvoices);

module.exports = router;
