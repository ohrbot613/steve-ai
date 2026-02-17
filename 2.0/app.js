const express = require("express");
const router = express.Router();

// Ensure 2.0 DB connection is initialized
require("./db");

const mainRoute = require("./routes/mainRoute");

router.use("/", mainRoute);

module.exports = router;
