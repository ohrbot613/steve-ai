const express = require("express");
const router = express.Router();
const authController = require("../../controllers/AuthController");
const reloadLock = require("../middleware/reloadLock");
const { syncIncrementalInvoicesFromXero } = require("../scripts/scripts");
const vendorRoutes = require("./vendorRoutes");
const scriptsRoutes = require("./scriptsRoutes");
const supplierLogsRoutes = require("./supplierLogsRoutes");
const dashboardRoutes = require("./dashboardRoutes");
const invoiceRoutes = require("./invoiceRoutes");
const processLogRoutes = require("./processLogRoutes");

router.use(authController.protect);
router.use(authController.xeroClient);
router.use(authController.optionalXeroTokenInfo);

router.use((req, res, next) => {
    const p = Promise.resolve(syncIncrementalInvoicesFromXero(req));
    p.catch((err) => console.error("[API 2.0] parallel task error", err));
    next();
});

router.use(reloadLock);
router.use("/vendor", vendorRoutes);
router.use("/process-logs", processLogRoutes);
router.use("/scripts", scriptsRoutes);
router.use("/supplier-logs", supplierLogsRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/invoice", invoiceRoutes);

module.exports = router;