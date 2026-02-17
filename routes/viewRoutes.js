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


fetch('http://127.0.0.1:7242/ingest/2c1ebcd6-def4-40f4-961d-27e83d539bc4',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'viewRoutes.js:26',message:'Router module loaded',data:{routesRegistered:2},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
// #endregion

module.exports = router;
