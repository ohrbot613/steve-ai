const mongoose = require("mongoose");

// Fall back to MONGO_URI so the 2.0 connection still works when only the
// primary URI is configured (matches what the warning historically promised).
const uri = process.env.MONGO_URI_2 || process.env.MONGO_URI;
if (!uri) {
  console.error("2.0 DB: Neither MONGO_URI_2 nor MONGO_URI is set. 2.0 endpoints will return 500.");
}

const conn = mongoose.createConnection(uri, {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});

conn.on("connected", () => {
  console.log("MongoDB 2.0 connected");
});
conn.on("error", (err) => {
  console.error("MongoDB 2.0 connection error:", err.message);
});

module.exports = conn;
