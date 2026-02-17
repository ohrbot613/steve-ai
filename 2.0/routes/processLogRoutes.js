const express = require("express");
const router = express.Router();
const processLogController = require("../controllers/processLogController");

router.get("/", processLogController.list);

module.exports = router;
