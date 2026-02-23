require("dotenv").config();
require("./instrument");
const express = require("express");
const Sentry = require("@sentry/node");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const appRoutes = require("./app");
const { errorHandler } = require("./controllers/ErrorController");
const xeroPollingService = require("./services/xeroPollingService");
const app = express();
app.set('trust proxy', 1);
const path = require("path");



(async () => {
    try {
        const mongoUri = process.env.MONGO_URI;
        
        if (!mongoUri) {
            throw new Error("MONGO_URI environment variable is not set. Please set it in your production environment variables or .env file.");
        }
        
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log("MongoDB connected successfully");
        xeroPollingService.start();
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        process.exit(1); // Exit process if database connection fails
   }   
})()

// EJS view engine configuration removed - we're serving React SPA now
// app.set("view engine", "ejs");
// app.set("views", path.join(__dirname, "views"));

app.use(cookieParser());
app.use(appRoutes);
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}
app.use(errorHandler);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`PDF server running on http://localhost:${PORT}`);
});
