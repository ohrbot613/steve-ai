const mongoose = require("mongoose");

const uri = process.env.MONGO_URI_2;
if (!uri) {
  console.warn("2.0 DB: No MONGO_URI_2 or MONGO_URI set. Set MONGO_URI_2 in .env for a separate 2.0 database.");
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
