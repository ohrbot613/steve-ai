const express = require("express");
const router = express.Router();
const { tryCatchAsync } = require("../../controllers/ErrorController");
const Team = require("../modals/teamModal");
const { getAllVenders, getAllInvoices, getBankBalance, searchSimilarNames, findInvoiceById, getOneSupplier, getOneRandomSupplierDetails, getSupplierByName, paymentRunInvoice } = require("../scripts/scripts");
const authController = require("../../controllers/AuthController");

router.get(
    "/reloading-status",
    tryCatchAsync(async (req, res) => {
        const teamTenantId = req.user?.tenant != null ? String(req.user.tenant) : null;
        if (!teamTenantId) {
            return res.status(200).json({ success: true, reloading: false });
        }
        const team = await Team.findOne({ tenantId: teamTenantId }).select("reloading").lean();
        return res.status(200).json({ success: true, reloading: Boolean(team?.reloading) });
    })
);

// All script routes require authentication
router.use(authController.protect);

// router.get("/connect-xero", connectXero);
router.post("/get-all-vendors", authController.xeroClient, authController.xeroTokenInfo, getAllVenders);
router.get("/get-one-supplier", authController.xeroClient, authController.xeroTokenInfo, getOneSupplier);
router.get("/testing-supplier-single-supplier-details", authController.xeroClient, authController.xeroTokenInfo, getOneRandomSupplierDetails);
router.get("/get-supplier-by-name", authController.xeroClient, authController.xeroTokenInfo, getSupplierByName);
router.post("/get-all-invoices", authController.xeroClient, authController.xeroTokenInfo, getAllInvoices);
router.get("/get-bank-balance", authController.xeroClient, authController.xeroTokenInfo, getBankBalance);

// Find invoices from supplier (vendor) closest to target id and amount; matrix = all Xero invoices for that vendor
router.get("/find-invoice-by-id/:vendorId", findInvoiceById);

// Fuzzy name search in MongoDB (top N similar names; no Xero required)
router.post("/search-similar-names", searchSimilarNames);

// Payment run invoice (needs Xero to fetch supplier payment terms)
router.post("/payment-run-invoice", authController.xeroClient, authController.xeroTokenInfo, paymentRunInvoice);

module.exports = router;
