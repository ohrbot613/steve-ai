const express = require("express");
const router = express.Router();
const authController = require("../controllers/AuthController");
const mainAgentController = require("../controllers/agent/mainAgentController");
router.get("/test-agent", authController.protect, authController.xeroClient, authController.xeroTokenInfo, mainAgentController.mainAgent);


module.exports = router;