const express = require("express");
const router = express.Router();
const vendorController = require("../controllers/vendorController");

router.get("/get-vendors", vendorController.getVendors);
router.get("/get-vendor-counts", vendorController.getVendorCounts);

module.exports = router;