# Codebase Structure

**Analysis Date:** 2026-02-08

## Directory Layout

```
PDF automation/
├── .git/                         # Git repository
├── .planning/                    # Planning documents (this file location)
├── 2.0/                          # New architecture (v2.0)
│   ├── app.js                   # v2.0 main router
│   ├── db.js                    # v2.0 MongoDB connection
│   ├── controllers/             # v2.0 business logic
│   ├── modals/                  # v2.0 data schemas (renamed from "models")
│   ├── routes/                  # v2.0 request routing
│   ├── scripts/                 # Migration and utility scripts
│   └── utils/                   # v2.0 shared utilities
├── .old/                        # Legacy/archived code (not active)
├── client/                      # React frontend SPA
│   ├── src/                     # Source code
│   │   ├── main.jsx            # Entry point, Sentry + CedarCopilot setup
│   │   ├── App.jsx             # Root component with React Router
│   │   ├── pages/              # Page components (Home, Login, AllStatements, etc)
│   │   ├── componentes/        # Reusable UI components
│   │   ├── contexts/           # React Context for state
│   │   ├── hooks/              # Custom React hooks
│   │   ├── lib/                # Library utilities
│   │   ├── utils/              # Helper functions
│   │   ├── cedar/              # Cedar-OS integration
│   │   ├── copilot/            # AI copilot components (legacy/disabled)
│   │   ├── copilotkit/         # CopilotKit integration (disabled)
│   │   ├── assets/             # Static images, icons
│   │   └── scss/               # Styles
│   ├── public/                 # Static files served as-is
│   ├── dist/                   # Production build output
│   ├── package.json            # Frontend dependencies
│   ├── vite.config.js          # Vite build configuration
│   └── node_modules/           # Frontend dependencies
├── controllers/                 # v1.0 business logic (legacy)
│   ├── agent/                  # AI agent controllers
│   ├── AuthController.js       # Authentication and JWT
│   ├── InvoiceController.js    # PDF parsing and invoice processing
│   ├── LangChainController.js  # LangChain agent orchestration
│   ├── LangGraphController.js  # LangGraph multi-step workflows
│   ├── LogController.js        # Activity and statement logging
│   ├── ErrorController.js      # Error handling utilities
│   └── SupplierController.js   # Vendor/supplier management
├── routes/                      # v1.0 API routing (legacy)
│   ├── authRoutes.js           # POST /api/v1/auth/* endpoints
│   ├── invoiceRoutes.js        # POST/GET /api/v1/invoice/* endpoints
│   ├── viewRoutes.js           # GET / fallback (serves React SPA)
│   ├── agent.js                # GET /api/v1/agent routes
│   ├── langchainRoutes.js      # Disabled LangChain routes
│   ├── reportErrorRoutes.js    # Error reporting endpoints
│   └── copilotkitRoutes.js     # Disabled CopilotKit routes
├── modals/                      # v1.0 data schemas (legacy)
│   ├── supplierInvoiceModal.js # Supplier invoice schema
│   ├── customerInvoiceModal.js # Customer invoice schema
│   ├── vendorModal.js          # Vendor/supplier schema
│   ├── userModal.js            # User account schema
│   ├── errorLogModal.js        # Error logging schema
│   ├── statementsModal.js      # Statement batch schema
│   ├── projectModal.js         # Project schema
│   ├── processModal.js         # Process state schema
│   └── xeroTenantsModal.js     # Xero tenant mapping schema
├── utils/                       # v1.0 shared utilities (legacy)
│   ├── agentTools.js           # LangChain tool definitions (prompt, formatting, matching)
│   └── agentEvaluation.js      # Agent intent/result evaluation logic
├── config/                      # Configuration files
│   └── [configuration files]
├── files/                       # Runtime file storage
├── migrations/                  # Database migration scripts
├── media/                       # Media assets
├── public/                      # Static assets served by Express
│   └── assets/                 # Frontend build artifacts
├── views/                       # EJS templates (legacy, now serves React SPA)
├── app.js                       # Main Express router and middleware
├── server.js                    # Server bootstrap
├── instrument.js               # Sentry instrumentation
├── formatting.js               # PDF text formatting and AI extraction
├── generate-user-manual.js     # Documentation generation script
├── gemini.js                   # Google Gemini integration (unused)
├── .env                        # Environment variables (DO NOT COMMIT)
├── .env.example                # Environment template
├── .gitignore                  # Git ignore rules
├── package.json                # Backend dependencies
├── package-lock.json           # Dependency lock
└── node_modules/               # Backend dependencies
```

## Directory Purposes

**client/:**
- Purpose: Complete React SPA application
- Contains: Pages, components, styles, hooks, utilities
- Key files: `main.jsx` (entry), `App.jsx` (routing), `package.json` (deps)
- Build output: `dist/` (copied to `public/assets/` and `views/` during build)

**controllers/:**
- Purpose: Business logic for v1.0 API endpoints
- Contains: Request handlers for auth, invoices, AI agents, logging
- Key files: `InvoiceController.js` (largest, ~6400 lines), `LangChainController.js`, `AuthController.js`
- Note: v2.0 has separate controllers at `2.0/controllers/`

**routes/:**
- Purpose: API endpoint definitions and routing
- Contains: Express routers mapping HTTP methods to controller functions
- Key files: `invoiceRoutes.js` (most endpoints), `authRoutes.js`, `agent.js`
- Entry point: All routes mounted in `app.js`

**modals/:**
- Purpose: MongoDB schema definitions (Mongoose models)
- Contains: Invoice, vendor, user, statement, log schemas with validation
- Key files: `supplierInvoiceModal.js`, `vendorModal.js`, `userModal.js`
- Note: Terminology "modals" is non-standard (should be "models"), kept for compatibility

**utils/:**
- Purpose: Shared utility functions
- Contains: Agent tool definitions, evaluation logic, formatting helpers
- Key files: `agentTools.js` (agent capability definitions), `agentEvaluation.js` (intent analysis)

**2.0/:**
- Purpose: Next-generation architecture (parallel to v1.0, not replacing it)
- Contains: Controllers, routes, models, utilities for v2.0 endpoints
- Entry: `/api/v2` prefix in main app.js
- Connection: Separate MongoDB database (configured in `2.0/db.js`)

**client/src/pages/:**
- Purpose: Full-page React components
- Contains: `Home.jsx`, `Login.jsx`, `AllStatements.jsx`, `AllInvoices.jsx`, `Activity.jsx`, etc.
- Pattern: Each page handles its own routing, data fetching, state management

**client/src/componentes/:** (Note: typo in folder name - "componentes" not "components")
- Purpose: Reusable UI components
- Contains: `FileUploadWidget.jsx`, `TableWidget.jsx`, `AskSteve.jsx`, `ProtectedRoute.jsx`, modals
- Pattern: Components accept props, emit callbacks, minimal internal state

**client/src/cedar/:**
- Purpose: Cedar-OS copilot integration (alternative to CopilotKit)
- Contains: UI components for chat interface, styling, helpers
- Note: Active integration; CopilotKit components are disabled

## Key File Locations

**Entry Points:**
- `server.js`: Starts Express, connects MongoDB, mounts app.js router
- `client/src/main.jsx`: React app initialization, Sentry setup, CedarCopilot provider
- `app.js`: Mounts all API routes and middleware

**Configuration:**
- `.env`: Environment variables (secrets, API keys, URLs)
- `.env.example`: Template for required environment variables
- `client/vite.config.js`: Frontend build configuration
- `2.0/db.js`: v2.0 database connection

**Core Logic:**
- `controllers/InvoiceController.js`: PDF parsing, validation, invoice extraction (largest file ~6400 lines)
- `controllers/LangChainController.js`: AI agent orchestration and prompt management
- `utils/agentTools.js`: Tool definitions for LLM agents
- `formatting.js`: Text extraction and AI-powered field mapping

**Testing:**
- No dedicated test directory found; test files appear to be in `.old/` or not present
- Integration tests mentioned in `TEST_INTEGRATION.md` but files not found in main codebase

**Database/Models:**
- `modals/supplierInvoiceModal.js`: Supplier invoice data structure
- `modals/vendorModal.js`: Vendor/supplier entity
- `modals/userModal.js`: User account
- `modals/statementsModal.js`: Batch processing state
- `2.0/modals/`: v2.0 parallel models (invoiceModal, vendorModal, teamModal, etc)

## Naming Conventions

**Files:**
- Controllers: PascalCase with "Controller" suffix: `InvoiceController.js`, `AuthController.js`
- Routes: camelCase with "Routes" suffix: `invoiceRoutes.js`, `authRoutes.js`
- Models: camelCase with "Modal" suffix (non-standard): `supplierInvoiceModal.js`, `vendorModal.js`
- Components: PascalCase: `FileUploadWidget.jsx`, `ProtectedRoute.jsx`
- Pages: PascalCase: `Home.jsx`, `SingleStatement.jsx`
- Utils: camelCase: `agentTools.js`, `agentEvaluation.js`

**Directories:**
- Feature-based: `controllers/`, `routes/`, `modals/` group by type
- Subfeatures: `controllers/agent/` for agent-specific logic
- Version-based: `2.0/` for v2.0 architecture
- Frontend structure: `pages/`, `componentes/`, `contexts/`, `hooks/`, `utils/`, `scss/`

**Functions:**
- Controllers: camelCase, descriptive: `parseInvoices()`, `uploadOnly()`, `validateUploadedFiles()`
- Middleware: camelCase: `protect()`, `xeroClient()`, `handleMulterError()`
- Tools: camelCase with "Tool" suffix: `textFormatterTool()`, `getToolsForAgent()`

**Variables:**
- camelCase for local vars: `userMessage`, `mongoUri`, `fileSize`
- UPPER_CASE for constants: `MAX_FILE_SIZE`, `ALLOWED_ORIGINS`
- Prefixed underscores avoided; use full names

## Where to Add New Code

**New Feature (Invoice Processing Enhancement):**
- Primary code: Create new controller method in `controllers/InvoiceController.js`
- Routes: Add route in `routes/invoiceRoutes.js`
- Models: Add/extend schema in `modals/supplierInvoiceModal.js` if needed
- Tests: Create test file (currently no test directory; would go in `tests/` if created)

**New Component (UI Feature):**
- Implementation: Create `.jsx` file in `client/src/componentes/`
- Styling: Create corresponding `.scss` file in `client/src/scss/`
- Context (if state needed): Add to `client/src/contexts/`
- Entry: Import and use in page component or App.jsx routing

**New Agent Tool (AI Capability):**
- Tool definition: Add to `utils/agentTools.js` using LangChain DynamicStructuredTool pattern
- Schema: Define input schema with Zod: `z.object({ field: z.string() })`
- Evaluation: If complex logic, add to `utils/agentEvaluation.js`
- Registration: Register in `getToolsForAgent()` function

**New API Endpoint (v1.0):**
- Route: Define in `routes/[featureName]Routes.js`
- Controller: Add method to `controllers/[Feature]Controller.js`
- Middleware: Add auth/validation middleware in route definition
- Error handling: Wrap with `tryCatchAsync()` in controller

**New Endpoint (v2.0):**
- Route: Add to `2.0/routes/mainRoute.js` or create new route file
- Controller: Create in `2.0/controllers/`
- Model: Create or extend in `2.0/modals/`
- Access: Available at `/api/v2/[endpoint]`

**Utilities/Shared Helpers:**
- Shared helpers: `utils/` (v1.0) or `2.0/utils/` (v2.0)
- Formatting logic: Add to `formatting.js` if PDF/invoice specific
- Frontend helpers: `client/src/utils/`

## Special Directories

**views/:**
- Purpose: EJS template rendering (legacy)
- Generated: Production React build artifacts copied here
- Committed: No (generated during build)

**public/assets/:**
- Purpose: Frontend build artifacts served statically
- Generated: Vite production build output
- Committed: No (generated during build)

**2.0/scripts/:**
- Purpose: Migration and maintenance scripts
- Generated: No
- Committed: Yes

**files/:**
- Purpose: Runtime storage for uploaded PDFs and processed files
- Generated: Yes (user uploads)
- Committed: No (runtime data)

**migrations/:**
- Purpose: Database schema migrations
- Generated: No
- Committed: Yes

**client/dist/:**
- Purpose: Frontend production build output
- Generated: Yes (via `npm run build` in client/)
- Committed: No

---

*Structure analysis: 2026-02-08*
