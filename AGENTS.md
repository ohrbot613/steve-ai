# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

Steve AI is a PDF automation / invoice management system with Xero accounting integration. It's a Node.js monorepo: Express backend + React (Vite) frontend.

### Services

| Service | Port | Command | Notes |
|---------|------|---------|-------|
| Backend (Express) | 3001 | `npm run dev` (from root) | Uses nodemon for auto-reload |
| Frontend (Vite) | 3000 | `cd client && npm run dev` | Proxies `/api/v1`, `/api/v2`, `/file` to backend |
| MongoDB | 27017 | `sudo mongod --dbpath /data/db --logpath /var/log/mongodb/mongod.log --fork` | Must be started before backend |

### Startup Order

1. Start MongoDB first (backend exits with `process.exit(1)` if MongoDB is unreachable).
2. Start backend: `npm run dev` from repo root.
3. Start frontend: `cd client && npm run dev`.

### Environment Setup

- Copy `.env.example` to `.env` and configure. For local dev, set `MONGO_URI=mongodb://localhost:27017/steve-ai-dev` and `MONGO_URI_2=mongodb://localhost:27017/steve-ai-dev-v2`.
- `JWT_SECRET` can be any string for local dev.
- External API keys (OPEN_ROUTER, XERO_*, LANGFUSE_*, SENTRY_*) are optional for basic dev — the app starts without them.

### Non-obvious Caveats

- `nodemon` is not in root `devDependencies` — it must be installed globally (`npm install -g nodemon`).
- `rsync` is required for the client `postbuild` script (`npm run build` in `client/`). Install with `sudo apt-get install -y rsync` if missing.
- The client build copies assets to `views/` and `public/assets/` via the `postbuild` script; the backend serves these for the production SPA. During dev, use the Vite dev server on port 3000 instead.
- There are two MongoDB connections: v1 uses `MONGO_URI` (default mongoose), v2 uses `MONGO_URI_2` (separate `mongoose.createConnection`). If `MONGO_URI_2` is unset, the v2 connection logs a warning but doesn't crash.
- Mongoose duplicate-index warnings on startup are benign (pre-existing in schema definitions).
- The `[XeroPoller] Xero not connected — skipping cycle` log on startup is expected when Xero credentials aren't configured.
- No systemd is available in the cloud VM; start MongoDB with `--fork` flag as shown above.

### Lint / Test / Build

- **Lint (client):** `cd client && npx eslint .` — pre-existing lint errors exist in the codebase.
- **Build (client):** `cd client && npm run build` — runs Vite build + copies output to `views/` and `public/assets/`.
- **No automated test suite** is configured in this codebase (no test scripts in either `package.json`).

### Creating a Test User

There is no public signup endpoint. To create a user for local dev, run from the repo root:
```js
node -e "
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect('mongodb://localhost:27017/steve-ai-dev');
  const User = require('./modals/userModal');
  const hash = await bcrypt.hash('testpassword123', 10);
  await User.create({ name: 'Dev User', email: 'dev@test.com', password: hash });
  console.log('User created');
  await mongoose.disconnect();
})();
"
```
Then log in at `http://localhost:3000/login` with `dev@test.com` / `testpassword123`.
