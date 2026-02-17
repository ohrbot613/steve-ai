const express = require("express");
const router = express.Router();
const invoiceController = require("../controllers/invoiceController");

// Invoice file upload: single PDF or Excel file, parse and return result (like parse file route)
router.post(
    "/invoice-file-upload",
    invoiceController.upload.single("file"),
    invoiceController.handleMulterError,
    invoiceController.invoiceFileUpload,
    invoiceController.completeInvoiceFileUpload
);

router.post(
    "/complete-invoice-file-upload",
    invoiceController.completeInvoiceFileUpload
);


module.exports = router;
