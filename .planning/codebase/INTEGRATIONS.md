# External Integrations

**Analysis Date:** 2026-02-08

## APIs & External Services

**Accounting/Finance:**
- Xero - Accounting software integration for invoice matching and reconciliation
  - SDK/Client: `xero-node` v13.4.0
  - Auth: OAuth2 via `simple-oauth2` v5.1.0
  - Env vars: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`
  - Endpoints: Used in `controllers/AuthController.js` for OAuth flow
  - API base: `https://api.xero.com` (connections, invoices, organization data)

**LLM/AI Services:**
- OpenAI - Primary LLM provider for agent reasoning
  - SDK/Client: `@langchain/openai` v1.2.0
  - Auth: API key (OPENAI_API_KEY inferred from LangChain patterns)
  - Used in: `controllers/LangChainController.js`, `controllers/agent/mainAgentController.js`
  - Model: ChatOpenAI class for conversation-based reasoning

- OpenRouter - Fallback/alternative LLM routing
  - SDK/Client: `@openrouter/sdk` v0.2.9
  - Auth: `OPEN_ROUTER` env var
  - Used for LLM inference when specified

- Google AI - Secondary AI provider
  - Auth: `AI_KEY` env var
  - Used for fallback AI operations

**LLM Observability & Prompts:**
- Langfuse - LLM observability, prompt management, and tracing
  - SDK/Client: `langfuse` v3.38.6
  - Auth: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`
  - Base URL: `LANGFUSE_HOST` (default: `https://cloud.langfuse.com`)
  - API calls: `/api/public/v2/prompts` for prompt fetching
  - Usage: Prompt retrieval, LLM call tracing in `controllers/LangChainController.js`

**Deprecated AI Components (Commented Out):**
- CopilotKit - AI copilot framework (currently disabled)
  - SDK: `@copilotkit/runtime` v1.51.2, `@copilotkit/react-core`, `@copilotkit/react-ui`
  - Routes: `routes/copilotkitRoutes.js` (not in active use)

## Data Storage

**Primary Database:**
- MongoDB
  - Connection: `MONGO_URI` env var (e.g., `mongodb+srv://username:password@cluster.mongodb.net/`)
  - Client: Mongoose v9.0.2 (ODM layer)
  - Collections managed:
    - Users (`modals/userModal.js`)
    - Suppliers/Vendors (`modals/vendorModal.js`)
    - Supplier Invoices (`modals/supplierInvoiceModal.js`)
    - Statements (`modals/statementsModal.js`)
    - Customer Invoices (`modals/customerInvoiceModal.js`)
    - Xero Tenants (`modals/xeroTenantsModal.js`)
    - Processes (`modals/processModal.js`)
    - Error Logs (`modals/errorLogModal.js`)

**File Storage:**
- Local filesystem
  - Upload directory: `/files/` (relative path in project)
  - Handled by: Multer v2.0.2 middleware
  - Supported formats: PDF, Excel (XLSX), CSV
  - Files processed via `controllers/InvoiceController.js`

**Caching:**
- Not explicitly configured (in-memory or session-based only)

## Authentication & Identity

**Primary Auth Provider:**
- Custom JWT-based authentication
  - Implementation: `controllers/AuthController.js`
  - Signing key: `JWT_SECRET` env var
  - Token storage: Cookies (`token` cookie) or Authorization header
  - Middleware: `authController.protect` middleware validates all protected routes

**Secondary Auth Provider:**
- Xero OAuth2
  - Flow: Authorization Code Grant (OAuth2)
  - Provider: Xero Identity Service (`https://identity.xero.com`)
  - Scopes: `openid profile email offline_access accounting.contacts accounting.transactions`
  - Implementation: `AuthController.js` methods `registerXero()`, `registerXeroCallback()`
  - Token storage: XeroTenants collection in MongoDB
  - Token refresh: Automatic via refresh token

**User Management:**
- User model in MongoDB with bcrypt-hashed passwords
- Multi-tenant support via XeroTenants collection
- User-Tenant relationship maintained in User model

## Monitoring & Observability

**Error Tracking & Performance:**
- Sentry
  - Backend: `@sentry/node` v10.38.0
  - Frontend: `@sentry/react` v10.38.0
  - Configuration: Optional (`SENTRY_DSN` env var)
  - Setup: `instrument.js` initializes Sentry before app load
  - Error handler: Express error handler in `server.js`
  - CSP directives: Sentry endpoints allowed in `app.js` helmet config

**LLM Tracing:**
- Langfuse (see LLM/AI section above)
  - Tracks agent invocations and prompt executions

**Logging:**
- Console-based (default Node.js console)
- Debug instrumentation: Cursor/IDE debug points
- Remote logging: Debug instrumentation found in `controllers/InvoiceController.js`
  - Endpoint: `http://127.0.0.1:7247/ingest/` (local debug during development)

## CI/CD & Deployment

**Hosting:**
- Self-hosted Node.js server
- Port: 3001 (configurable)
- Frontend served as static SPA via Vite build output

**CI Pipeline:**
- Not detected in repository

**Build Process:**
- Backend: Direct Node.js execution (`node server.js` or `nodemon server.js`)
- Frontend: Vite build pipeline
  - Command: `npm run build` in `client/` directory
  - Postbuild: Copies dist to backend served paths (`../views/` and `../public/assets/`)

## Environment Configuration

**Required env vars (from `.env.example`):**
- `OPEN_ROUTER` - OpenRouter API key
- `AI_KEY` - Google AI API key
- `XERO_CLIENT_ID` - Xero OAuth client ID
- `XERO_CLIENT_SECRET` - Xero OAuth client secret
- `XERO_REDIRECT_URI` - OAuth callback URL
- `JWT_SECRET` - JWT signing secret
- `PORT` - Server port (default 3001)
- `MONGO_URI` - MongoDB connection string
- `MONGO_USER` - MongoDB username (if needed)
- `MONGO_PASS` - MongoDB password (if needed)
- `SENTRY_DSN` - Sentry error tracking (optional)

**Secrets location:**
- `.env` file (local development)
- Environment variables (production deployment)
- Never committed to git (see `.gitignore`)

## Webhooks & Callbacks

**Incoming:**
- Xero OAuth Callback
  - Endpoint: `/api/v1/auth/register-xero-callback` (from `XERO_REDIRECT_URI` env var)
  - Route: `routes/authRoutes.js` - `registerXeroCallback()`
  - Method: GET with authorization code parameter
  - Handling: Token exchange, tenant lookup, user association

**Outgoing:**
- Sentry Error Reports
  - Endpoint: `/api/v1/report-error` (from frontend)
  - Route: `routes/reportErrorRoutes.js`
  - Method: POST with error payload
  - Sending to Sentry: Optional if `SENTRY_DSN` configured

## API Rate Limiting

**Configuration:**
- Express rate limit middleware enabled
- Config location: `app.js` via `express-rate-limit` v8.2.1
- Applied to: All API routes (configurable per route)

## Security Headers

**Helmet.js Configuration** (production mode):
- Content Security Policy (CSP) enabled
  - Default source: `'self'`
  - Style source: `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com`
  - Font source: `'self'`, `https://fonts.gstatic.com`
  - Script source: `'self'`
  - Image source: `'self'`, `data:`, `https:`
  - Connect source: `'self'`, Xero API, Sentry endpoints
- Cross-Origin Embedder Policy: Disabled for external resources
- Other headers: Standard security defaults

---

*Integration audit: 2026-02-08*
