const express = require("express");
const router = express.Router();
const authController = require("../controllers/AuthController");
const langChainController = require("../controllers/LangChainController");
const { getToolMetadata } = require("../utils/agentTools");

// SSE streaming endpoint (must be GET for EventSource API)
router.get("/stream", authController.protect, authController.xeroClient, authController.xeroTokenInfo, langChainController.streamingAgent);

router.post("/langchain-agent", authController.protect, langChainController.langchainAgent);
router.get("/test-tools", authController.protect, langChainController.testTools);
router.get("/prompts", authController.protect, langChainController.getAllPrompts);

// Simple unauthenticated test endpoint
router.post("/test-agent", authController.protect, authController.xeroClient, authController.xeroTokenInfo, langChainController.langchainAgent);

module.exports = router;

