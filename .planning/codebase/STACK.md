# Technology Stack

**Analysis Date:** 2026-02-08

## Languages

**Primary:**
- JavaScript (Node.js) - Backend server, API endpoints, business logic
- JavaScript/React (ES6+ with JSX) - Frontend client application

**Secondary:**
- HTML/CSS - Templating via EJS (legacy), CSS-in-JS with Tailwind
- YAML/JSON - Configuration and data formats

## Runtime

**Environment:**
- Node.js v16 or higher (from README.md)
- CommonJS modules (backend)
- ES Modules (frontend)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Express.js 5.2.1 - Web server, routing, middleware
- React 19.2.0 - Frontend UI framework
- Vite 7.2.4 - Frontend build tool and dev server

**Backend Utilities:**
- Mongoose 9.0.2 - MongoDB ORM and schema management
- Multer 2.0.2 - File upload handling

**LLM/AI:**
- @langchain/core 1.1.8 - LLM framework foundation
- @langchain/openai 1.2.0 - OpenAI integration
- @langchain/langgraph 1.1.2 - Agentic workflow orchestration
- Langchain 1.1.16 - Main LangChain package

**Data Processing:**
- pdf-parse 2.4.5 - PDF text extraction
- xlsx 0.18.5 - Excel file parsing
- csv-parse 6.1.0 - CSV parsing

**Security:**
- Helmet 8.1.0 - HTTP security headers
- bcrypt 6.0.0 - Password hashing
- jsonwebtoken 9.0.3 - JWT token signing/verification
- express-rate-limit 8.2.1 - API rate limiting
- cookie-parser 1.4.7 - Cookie parsing

**Testing/Dev:**
- PDFKit 0.17.2 - PDF generation (dev dependency)
- ESLint 9.39.1 - Code linting (frontend)
- Vite React plugin 5.1.1 - React HMR support

## Key Dependencies

**Critical:**
- @langchain/openai 1.2.0 - Powers AI agent for document processing and analysis
- Mongoose 9.0.2 - Database layer for all data persistence
- Express 5.2.1 - HTTP server and routing foundation
- pdf-parse 2.4.5 - Core PDF extraction for invoice automation

**Infrastructure:**
- dotenv 17.2.3 - Environment variable management
- axios 1.13.2 - HTTP client for external API calls
- simple-oauth2 5.1.0 - OAuth2 flow for Xero authentication
- xero-node 13.4.0 - Xero API client library

**Monitoring/Observability:**
- @sentry/node 10.38.0 - Backend error tracking
- @sentry/react 10.38.0 - Frontend error tracking
- langfuse 3.38.6 - LLM observability and prompt management
- @copilotkit/runtime 1.51.2 - AI assistant runtime (disabled in current version)
- @copilotkit/shared 1.51.2 - Copilot shared utilities

**Utilities:**
- currency-symbol-map 5.1.0 - Currency symbol lookup
- json2csv 6.0.0-alpha.2 - JSON to CSV conversion
- uuid 13.0.0 - Unique ID generation
- nodemailer 7.0.12 - Email sending capability
- file-type 21.1.1 - MIME type detection
- zod 4.3.5 - Schema validation
- cedar-os 0.1.23 - Design system components (frontend)

## Configuration

**Environment:**
- Configuration via `.env` file (see `.env.example`)
- Critical env vars required:
  - `MONGO_URI` - MongoDB connection string
  - `JWT_SECRET` - JWT signing secret
  - `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI` - Xero OAuth
  - `OPEN_ROUTER` - OpenRouter API key (for LLM fallback)
  - `AI_KEY` - Google AI key
  - `SENTRY_DSN` - Error tracking (optional)
  - `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` - LLM observability
  - `PORT` - Server port (default 3001)

**Build:**
- Backend: Node.js CommonJS with `dotenv` for env loading
- Frontend: Vite config at `client/vite.config.js`
  - Dev proxy: `/api/v1` → `http://localhost:3001`
  - Dev proxy: `/file` → `http://localhost:3001`
  - Build output: `dist/` compiled to `../views/` and `../public/assets/`
- Styling: Tailwind CSS 4.1.18 with PostCSS 8.5.6

**Formatting & Linting:**
- Frontend ESLint with React hooks plugin
- Optional Prettier (not configured in this project)
- Backend: No linting config detected

## Platform Requirements

**Development:**
- Node.js v16+
- npm package manager
- MongoDB (local or cloud)
- Xero tenant account (for full functionality)
- OpenAI or OpenRouter API key (for LLM features)

**Production:**
- Node.js runtime environment
- MongoDB Atlas or self-hosted MongoDB
- Static file serving for React SPA
- Environment variables for all secrets
- Port 3001 (configurable via `PORT` env var)

## API Clients

**External Service Communication:**
- axios 1.13.2 - Used for Xero API calls, Langfuse API calls, external HTTP requests
- simple-oauth2 5.1.0 - Xero OAuth2 authorization code flow
- xero-node 13.4.0 - Xero API SDK
- @openrouter/sdk 0.2.9 - OpenRouter API client

---

*Stack analysis: 2026-02-08*
