const express = require("express");
const router = express.Router();
const path = require("path");
const viewController = require("../controllers/ViewController");
const authController = require("../controllers/AuthController");


router.get("/file/:file", authController.protect, viewController.file);


router.use((req, res, next) => {
    // Never serve HTML for asset URLs — browser expects CSS/JS; avoids "MIME type text/html" errors
    if (req.path.startsWith("/assets/")) {
        return res.status(404).send("Not found");
    }
    console.log("Catch-all route hit", req.path, req.method);
    res.sendFile(path.join(__dirname, "../views/index.html"));
});

module.exports = router;
