const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");

router.get("/stats", dashboardController.getDashboardStats);
router.get("/unmatched-invoices-export", dashboardController.getUnmatchedInvoicesExport);
router.get("/dashboard-data", dashboardController.getDashboardData);
router.get("/dashboard-tab-2", dashboardController.getDashboardTab2);
router.get("/dashboard-tab-3", dashboardController.getDashboardTab3);
router.post("/mark-invoices-paid", dashboardController.markInvoicesPaid);
router.post("/undo-mark-invoices-paid", dashboardController.undoMarkInvoicesPaid);
router.get("/xero-sync-status", dashboardController.getXeroSyncStatus);
router.post("/xero-sync-now", dashboardController.syncNowWithXero);
router.delete("/invoices/:id", dashboardController.hardDeleteInvoice);

module.exports = router;
