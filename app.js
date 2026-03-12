const express = require("express");
const router = express.Router();
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const authRoutes = require('./routes/authRoutes');// middleware (optional but common)
const invoiceRoutes = require('./routes/invoiceRoutes');// middleware (optional but common)
const viewRoutes = require('./routes/viewRoutes');// middleware (optional but common)
const langchainRoutes = require('./routes/langchainRoutes');// middleware (optional but common)
const agentRoutes = require('./routes/agent');// middleware (optional but common)
const path = require("path");

// Security headers with Helmet (all environments)
router.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.xero.com", "https://identity.xero.com", "https://*.ingest.sentry.io"],
    },
  } : false, // Disable CSP in dev (Vite HMR needs inline scripts) but keep all other headers
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting: stricter in production, relaxed in development
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 100000,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limit for authentication endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 10 : 100000,
  message: {
    status: 'error',
    message: 'Too many login attempts from this IP, please try again after 15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
});

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : (process.env.NODE_ENV === 'production' ? ['https://dev.epikaai.com'] : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3001']);

router.use((req, res, next) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  let isSameOrigin = false;
  if (origin && host) {
    try {
      isSameOrigin = new URL(origin).host === host;
    } catch (_) { /* ignore malformed Origin */ }
  }

  if (!origin || isSameOrigin || allowedOrigins.includes(origin)) {
    // Never combine wildcard '*' with credentials — only reflect a known origin
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-copilotcloud-public-api-key');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
  } else {
    return res.status(403).json({
      status: 'error',
      message: 'Origin not allowed'
    });
  }

  next();
});

// Body parsing middleware - limit payload size to prevent DoS
// report-error needs larger limit for screenshot + file attachments (base64)
router.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/v1/report-error') {
    return express.json({ limit: '50mb' })(req, res, next);
  }
  return express.json({ limit: '10mb' })(req, res, next);
});
router.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory (path relative to this file so it works regardless of process cwd on deploy)
router.use(express.static(path.join(__dirname, "public")));

// Note: client/dist is not served directly - files are copied to views/ and public/assets/ during build



// Apply rate limiters in all environments (limits are already relaxed in dev)
router.use("/api", apiLimiter);
router.use("/api/v1/auth/login", authLimiter);
router.use("/api/v1/auth", authRoutes);
router.use("/api/v1",  require("./routes/reportErrorRoutes"));
router.use("/api/v1/invoice",  invoiceRoutes);
router.use("/api/file",  invoiceRoutes);
router.use("/api/v1/langchain", langchainRoutes);
router.use("/api/v1/agent",  agentRoutes);
router.use("/api/v2",  require("./2.0/app"));

// CopilotKit routes
// const copilotkitRoutes = require('./routes/copilotkitRoutes');
// router.use("/api/v1/copilotkit", apiLimiter, copilotkitRoutes);

// View routes (includes /file/:file and catch-all for React app)
// Must be last to catch all non-API routes
router.use("/", viewRoutes);
module.exports = router;
