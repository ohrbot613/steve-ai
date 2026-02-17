# Architecture

**Analysis Date:** 2026-02-08

## Pattern Overview

**Overall:** Layered Express.js backend with React frontend. Dual-version architecture (1.0 and 2.0) with separate databases and route hierarchies.

**Key Characteristics:**
- Express.js REST API with modular controllers and routes
- React SPA (Single Page Application) with routing and context-based state
- Middleware-driven request processing (auth, file validation, error handling)
- MongoDB for data persistence with Mongoose schemas
- LangChain/LangGraph integration for AI-powered agent workflows
- Multi-tenant capable with user/tenant context

## Layers

**Presentation (Frontend):**
- Purpose: User interface for PDF processing, invoice management, and AI-powered chat
- Location: `client/src/`
- Contains: React components, pages, hooks, contexts, utilities
- Depends on: Backend API via `/api/v1/` and `/api/v2/` routes
- Used by: End users via web browser

**Routing & Middleware:**
- Purpose: Request routing, authentication, authorization, security headers
- Location: `app.js`, `routes/`, `server.js`
- Contains: Express routers for auth, invoices, agents, view rendering
- Depends on: Controller layer for business logic
- Used by: Incoming HTTP requests

**Business Logic (Controllers):**
- Purpose: Handle invoice parsing, PDF extraction, AI agent orchestration, user management
- Location: `controllers/`, `controllers/agent/`
- Contains: InvoiceController, LangChainController, AuthController, ErrorController, etc.
- Depends on: Data models, utils (agentTools, agentEvaluation), external APIs
- Used by: Route handlers

**Data Persistence:**
- Purpose: MongoDB schema definitions and data models
- Location: `modals/` (contains schemas), `2.0/modals/` (v2.0 schemas)
- Contains: Mongoose models for invoices, vendors, statements, users, tenants
- Depends on: MongoDB connection via mongoose
- Used by: Controllers for CRUD operations

**Utilities & Tools:**
- Purpose: Shared logic for AI agent tools, evaluation, formatting, agent orchestration
- Location: `utils/`, `formatting.js`
- Contains: agentTools (tool definitions), agentEvaluation (intent/result analysis), text formatting
- Depends on: LangChain libraries, external AI APIs
- Used by: Controllers (especially LangChainController, InvoiceController)

**Configuration & Setup:**
- Purpose: Environment management, instrumentation, database initialization
- Location: `config/`, `.env`, `instrument.js`, `server.js`
- Contains: Environment variables, Sentry initialization, Langfuse setup
- Depends on: External services (Sentry, Langfuse, MongoDB)
- Used by: Application startup and request processing

## Data Flow

**File Upload & Invoice Processing:**

1. User uploads PDF/XLSX via `FileUploadWidget` (frontend)
2. Frontend POSTs to `/api/v1/invoice/parse-invoices` or `/api/v1/invoice/upload-only`
3. Middleware stack: `authController.protect` → `multer upload` → `validateUploadedFiles` → `xeroClient` → `xeroTokenInfo`
4. `InvoiceController.parseInvoices()` receives request with files
5. Controller extracts text via `pdf-parse`, validates MIME types
6. Controller calls `formatting.js` functions for AI-powered field extraction
7. Data structured into JSON and saved to MongoDB via `SupplierInvoice` model
8. Response returns parsed invoices to frontend
9. Frontend displays results in `TableWidget` or updates `Home` page state

**AI Agent Chat Flow:**

1. User types message in `AskSteve` component (frontend sidebar)
2. Frontend sends POST to `/api/v1/langchain/test-agent` with message and sessionId
3. `LangChainController.langchainAgent()` receives request
4. Controller initializes LLM (ChatOpenAI with OpenRouter)
5. Fetches prompt template from Langfuse if configured
6. Loads agent tools via `getToolsForAgent()` (agentTools.js)
7. LangChain agent executes loop: message → LLM → tool execution → evaluation
8. Tools available: text formatting, invoice lookup, supplier matching, etc.
9. Controller returns final response JSON to frontend
10. Frontend displays assistant message in chat bubble

**Dual Architecture (v1.0 vs v2.0):**

- **v1.0** (legacy): Main routing via `app.js` → `routes/` → `controllers/` → `modals/`
- **v2.0** (new): Mounted at `/api/v2` via `app.js` line 108
  - Separate Express router at `2.0/app.js`
  - Separate database connection at `2.0/db.js`
  - Independent controllers at `2.0/controllers/`
  - Independent models at `2.0/modals/`
  - Routes defined in `2.0/routes/`

**State Management:**

- Backend: Request-scoped context via middleware (tenant, user, xeroClient)
- Frontend: React Context (import via `client/src/contexts/`)
- Session: localStorage for UI state (sidebar open/close), sessionStorage for sessionId

## Key Abstractions

**Error Handling Wrapper:**
- Purpose: Consistent async error catching and logging
- Examples: `ErrorController.tryCatchAsync()` wraps all controller methods
- Pattern: `tryCatchAsync(async (req, res, next) => { ... })` catches and passes to error handler

**Multer File Upload:**
- Purpose: Handle PDF/XLSX file uploads with validation
- Examples: Defined in `InvoiceController` with memory storage
- Pattern: Validates MIME type, checks file signatures, enforces size limits (10MB per file, 50 files max)

**Authentication Middleware:**
- Purpose: Verify JWT tokens, set user/tenant context, manage Xero OAuth
- Examples: `AuthController.protect`, `authController.xeroClient`, `authController.xeroTokenInfo`
- Pattern: Middleware stack applied to protected routes

**LangChain Agent Orchestration:**
- Purpose: Build and execute agents with tool use
- Examples: `LangChainController.langchainAgent()`, tools in `agentTools.js`
- Pattern: Create LLM instance → load tools → invoke agent.invoke() → return response

**Mongoose Schema Pre-hooks:**
- Purpose: Auto-generate IDs, timestamps, derived fields on save
- Examples: `supplierInvoiceSchema.pre('save', async function() { ... })`
- Pattern: Mongoose pre-save hooks for data normalization

## Entry Points

**Server Bootstrap:**
- Location: `server.js`
- Triggers: Node process start via `npm start` or `node server.js`
- Responsibilities: Load env vars, connect MongoDB, initialize middleware, start Express on PORT

**Frontend App:**
- Location: `client/src/main.jsx`
- Triggers: Vite dev server or production build
- Responsibilities: Initialize React, Sentry, CedarCopilot wrapper, render root App component

**Main Backend Router:**
- Location: `app.js`
- Triggers: Imported and mounted in `server.js` via `require('./app')`
- Responsibilities: Apply security headers (Helmet), CORS, rate limiting, mount all route handlers

**API Routes (v1.0):**
- Auth: `/api/v1/auth` → `routes/authRoutes.js`
- Invoices: `/api/v1/invoice` → `routes/invoiceRoutes.js`
- AI Agent: `/api/v1/agent` → `routes/agent.js`
- View fallback: `/` → `routes/viewRoutes.js` (serves React SPA)

**API Routes (v2.0):**
- All v2.0 routes: `/api/v2/*` → `2.0/app.js` → `2.0/routes/mainRoute.js`

**Frontend Routes (React Router):**
- `Login` page: `/login`
- Dashboard: `/` or `/suppliers`
- Statements: `/statements`
- Invoices: `/invoices`
- Activity: `/activity`
- Protected routes wrapped with `ProtectedRoute` component

## Error Handling

**Strategy:** Centralized error handler with consistent error response format.

**Patterns:**
- All controllers wrapped with `tryCatchAsync()` which catches exceptions
- Errors passed to `ErrorController.errorHandler()` middleware
- Multer errors caught in `handleMulterError()` middleware with database logging
- Frontend error boundary via Sentry integration
- HTTP responses include status, success flag, and message

**Error Flow:**
1. Error thrown in controller
2. `tryCatchAsync` catches it
3. Error passed to `next(error)`
4. `errorHandler` middleware formats response
5. Response includes error details (sanitized in production)

## Cross-Cutting Concerns

**Logging:**
- Backend: Sentry for exception tracking, Langfuse for agent invocation traces
- Frontend: Sentry for client-side errors, console logs for development
- Instrumented via `instrument.js` and Sentry initialization in `main.jsx`

**Validation:**
- File uploads: MIME type + file signature verification (pdf-parse, file-type)
- Invoices: Schema validation in `InvoiceController`, Mongoose schema defaults
- Auth: JWT validation via `jsonwebtoken`, Xero OAuth flow

**Authentication:**
- JWT-based for user sessions (manage via `AuthController`)
- OAuth2 with Xero for accounting integration (stored in request context)
- Session context passed through middleware stack

**Rate Limiting:**
- API limiter: 1000 requests per 15 minutes
- Auth limiter: 5 login attempts per 15 minutes (blocks successful logins)
- Applied at `app.js` lines 101-108

---

*Architecture analysis: 2026-02-08*
