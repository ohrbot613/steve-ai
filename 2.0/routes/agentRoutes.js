const express = require("express");
const multer = require("multer");
const router = express.Router();
const agentController = require("../controllers/agentController");
const agentPlanController = require("../controllers/agentPlanController");
const authController = require("../../controllers/AuthController");
// Optional single file upload (field name "file") so form-data works for agent/run
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
}).single("file");

// GET /agent/threads – list threads for authenticated user
router.get("/threads", authController.protect, agentController.listThreads);
// GET /agent/threads/:threadId/messages – get messages for a thread (ownership validated)
router.get("/threads/:threadId/messages", authController.protect, agentController.getThreadMessages);

// POST /agent/new-chat – body: { userId } – returns { threadId } for new conversation
router.post("/new-chat", authController.protect, agentController.newChat);

// POST /agent/run – body: JSON { prompt/message/content } OR form-data: message + optional file
router.post("/run", authController.protect, (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message || "File upload error" });
    }
    next();
  });
}, agentController.runAgent);

// Plan lifecycle routes
router.post("/plan", agentPlanController.createPlan);
router.post("/plan/:id/execute", agentPlanController.executePlan);
router.post("/plan/:id/resume", agentPlanController.resumePlan);
router.get("/plan/:id/status", agentPlanController.getPlanStatus);

module.exports = router;
