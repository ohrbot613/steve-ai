const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");

router.get("/stats", dashboardController.getDashboardStats);
router.get("/unmatched-invoices-export", dashboardController.getUnmatchedInvoicesExport);
router.get("/dashboard-data", dashboardController.getDashboardData);
router.get("/dashboard-tab-2", dashboardController.getDashboardTab2);

module.exports = router;
