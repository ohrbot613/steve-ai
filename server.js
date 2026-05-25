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

// Surface async crashes that would otherwise be invisible in production logs and
// leave Passenger in a restart loop with no diagnostic.
process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandledRejection:", reason && reason.message ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
    console.error("[fatal] uncaughtException:", err && err.message ? err.message : err);
});

(async () => {
    try {
        const mongoUri = process.env.MONGO_URI;

        if (!mongoUri) {
            console.error("[startup] MONGO_URI is not set. DB-backed routes will return 5xx until it is configured.");
            return;
        }

        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        if (process.env.NODE_ENV !== 'production') console.log("MongoDB connected successfully");
        xeroPollingService.start();
    } catch (error) {
        // Stay up so the HTTP listener can still serve static assets, health checks,
        // and clear error responses instead of dropping every request as a 500
        // while cPanel/Passenger thrashes through restart loops.
        console.error("[startup] MongoDB connection failed:", error && error.message ? error.message.replace(/mongodb(\+srv)?:\/\/[^@]*@/i, "mongodb$1://***@") : error);
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
    if (process.env.NODE_ENV !== 'production') console.log(`Server running on http://localhost:${PORT}`);
});
