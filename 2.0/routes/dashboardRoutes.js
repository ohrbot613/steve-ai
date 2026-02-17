const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");

router.get("/stats", dashboardController.getDashboardStats);
router.get("/unmatched-invoices-export", dashboardController.getUnmatchedInvoicesExport);

module.exports = router;
