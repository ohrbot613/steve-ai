# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Steve AI is an intelligent PDF automation system for processing invoices and statements with Xero integration. It consists of:

- **Backend**: Node.js/Express server on port 3001 (`npm run dev` at root)
- **Frontend**: React/Vite SPA on port 3000 (`npm run dev` in `client/`)

See `README.md` for full API endpoints, project structure, and configuration details.

### Running services

1. **MongoDB** must be running before starting the backend. Start with:
   ```
   mongod --dbpath /data/db --fork --logpath /var/log/mongod.log --logappend
   ```
2. **Backend**: `npm run dev` (uses nodemon, auto-reloads on file changes)
3. **Frontend**: `cd client && npx vite --host 0.0.0.0` (Vite dev server proxies `/api/v1`, `/api/v2`, `/file` to backend)

### Non-obvious caveats

- The backend **exits immediately** (`process.exit(1)`) if MongoDB is unreachable. Always ensure `mongod` is running first.
- The v2.0 sub-app warns about a missing `MONGO_URI_2` but does not crash — this is expected.
- There is no public signup route. To create a test user, insert directly into MongoDB:
  ```
  mongosh mongodb://localhost:27017/steve-ai-dev --eval "
  const bcrypt = require('/workspace/node_modules/bcrypt');
  db.users.insertOne({ name: 'Dev User', email: 'dev@test.com', password: bcrypt.hashSync('password123', 10) });
  "
  ```
- The `.env` file at root needs at minimum: `MONGO_URI`, `JWT_SECRET`, and `PORT`. External API keys (OpenRouter, Xero, Langfuse) are optional for basic dev but required for AI/reconciliation features.
- Mongoose duplicate index warnings on startup are non-critical and can be ignored.
- The Xero polling service starts automatically but skips cycles if Xero isn't connected — this is expected.

### Lint / Test / Build

- **Lint (client)**: `cd client && npx eslint .` — pre-existing lint errors exist in the codebase (37 errors, 6 warnings as of setup).
- **Build (client)**: `npm run build` in `client/` — builds and copies assets to `views/` and `public/assets/`.
- No automated test framework is configured in this codebase.
