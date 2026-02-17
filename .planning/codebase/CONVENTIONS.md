# Coding Conventions

**Analysis Date:** 2026-02-08

## Naming Patterns

**Files:**
- Controllers: PascalCase (e.g., `AuthController.js`, `InvoiceController.js`, `SupplierController.js`)
- Models/Modals: PascalCase with "Modal" suffix (e.g., `userModal.js`, `vendorModal.js`, `supplierInvoiceModal.js`)
- Routes: camelCase with "Routes" suffix (e.g., `authRoutes.js`, `invoiceRoutes.js`, `viewRoutes.js`)
- Utilities: camelCase (e.g., `agentTools.js`, `agentEvaluation.js`, `currencyUtils.js`, `exportUtils.js`)
- CSS Modules: camelCase with `.module.scss` extension (e.g., `FileUploadWidget.module.scss`, `Modal.module.scss`)

**Functions:**
- Async handlers: camelCase prefix with action (e.g., `handleUpload`, `handleDragOver`, `handleDrop`, `handleFileSelect`)
- Exported handlers: camelCase starting with verb (e.g., `protect`, `login`, `logout`, `createUserForTenant`, `getSuppliers`, `getInvoicesBySupplier`)
- Helper/utility functions: camelCase (e.g., `setRequestContext`, `clearRequestContext`, `createZodSchemaFromJSON`)

**Variables:**
- camelCase for local variables (e.g., `limit`, `offset`, `searchQuery`, `uploadProgress`, `validFiles`)
- CONSTANT_CASE for configuration constants (e.g., `JWT_SECRET`, `MONGO_URI`, `SENTRY_DSN`)
- env vars in SCREAMING_SNAKE_CASE accessed via `process.env.VAR_NAME`

**Types:**
- Schema fields: camelCase (e.g., `invoiceNumber`, `vendorAmount`, `xeroAmount`, `paymentStatus`)
- Component props: PascalCase when referring to named props (e.g., `onClose`, `onUploadComplete`)

## Code Style

**Formatting:**
- No explicit formatter configured (Prettier/ESLint config not found)
- Inconsistent spacing observed across codebase - use standard Node.js conventions
- Tab width appears to be 4 spaces or 2 spaces (varies by file)
- Semicolons used consistently throughout

**Linting:**
- No ESLint config file detected (`.eslintrc*`)
- No Prettier config file detected
- Manual code review approach implied

**Indentation & Spacing:**
- Generally 2-4 space indentation observed
- Single space before conditionals: `if (condition)`, `for (item of list)`
- No space after function keyword in arrow functions: `(req, res) => { ... }`

## Import Organization

**Backend (CommonJS - require):**

Order observed in controllers and routes:
1. Third-party packages (e.g., `express`, `mongoose`, `axios`)
2. Internal utilities and middleware (e.g., `require("./ErrorController")`)
3. Models/Modals (e.g., `require("../modals/userModal")`)

Example from `AuthController.js`:
```javascript
const { AuthorizationCode } = require('simple-oauth2');
const { tryCatchAsync } = require('./ErrorController');
const axios = require("axios");
const User = require('../modals/userModal');
const XeroTenants = require('../modals/xeroTenantsModal');
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
```

**Frontend (ES6 imports - React):**

Order observed in React components:
1. React core imports
2. Third-party UI/animation libraries
3. Relative imports (styles, hooks, components)

Example from `FileUploadWidget.jsx`:
```javascript
import React, { useState, useRef } from 'react';
import { Upload, X, File, CheckCircle2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import styles from '../scss/FileUploadWidget.module.scss';
```

**Path Aliases:**
- Relative paths used throughout (e.g., `../controllers/`, `../modals/`)
- No alias mapping detected in tsconfig/webpack

## Error Handling

**Backend Patterns:**

Primary error handling wrapper: `tryCatchAsync` - custom middleware wrapper defined in `ErrorController.js`
```javascript
exports.tryCatchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};
```

Usage pattern in controllers:
```javascript
exports.protect = tryCatchAsync(async (req, res, next) => {
    // async logic here
});
```

Custom error class: `AppError` for operational errors
```javascript
exports.AppError = class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
        this.isOperational = true;
    }
}
```

Global error handler: Centralized `errorHandler` middleware in `ErrorController.js`
- Logs to console
- Sends to Sentry when `SENTRY_DSN` env var configured
- Handles both `AppError` and generic Error objects
- Serializes error objects safely to avoid circular references
- Returns structured JSON response with status and message

**Error Response Format:**
```javascript
{
    status: 'error' | 'fail',
    message: 'Error description',
    payload?: {...},
    error?: {...}
}
```

**Frontend Error Handling:**
- Try-catch blocks wrapped around async operations
- Error state managed with `useState` (e.g., `isUploading`, `uploadSuccess`)
- User feedback via alerts and modal state
- Sentry integration for client-side error tracking (when `VITE_SENTRY_DSN` configured)

## Logging

**Framework:** `console` object for logging

**Patterns:**
- `console.log()` for informational messages (database connections, migrations, general info)
- `console.error()` for errors: `console.error("Error 💥:", err)`
- `console.warn()` for warnings
- Emoji decorators used in output (✅, ❌, ⚠️, 🔵, 📊)
- Structured logging: migrations log step-by-step progress

**Integration:**
- Sentry error handler captures exceptions when `SENTRY_DSN` is set
- Sentry context includes: request path, method, user ID if authenticated

Example from `ErrorController.js`:
```javascript
console.error("Error 💥:", err);
if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
        scope.setTag("path", req.path);
        scope.setTag("method", req.method);
        if (req.user?.id) scope.setUser({ id: String(req.user.id) });
        Sentry.captureException(err);
    });
}
```

## Comments

**When to Comment:**
- Complex business logic (e.g., invoice matching, AI formatting)
- Non-obvious field purposes (e.g., `// Aliases for compatibility`)
- Migration notes explaining schema changes
- Alternative implementations that were rejected

**JSDoc/TSDoc:**
- Not used systematically
- Some function declarations have inline comments explaining parameters
- Example: comments explaining context setup in `agentTools.js`:
```javascript
/**
 * Set the current request context for tools to access
 */
function setRequestContext(context) {
  currentRequestContext = context;
}
```

**Minimal commenting observed** - code is expected to be self-documenting through naming

## Function Design

**Size:**
- Range: 10-300+ lines observed
- Most handler functions 50-150 lines
- Large aggregate pipelines accepted in query builders (pipeline arrays can be 50+ lines)

**Parameters:**
- Standard Express pattern: `(req, res, next)` for route handlers
- Query parameters extracted from `req.query`
- Body parsed by middleware before reaching controller
- Async functions use `.catch(next)` pattern from `tryCatchAsync` wrapper

**Return Values:**
- Routes return via `res.status().json()` for APIs
- Functions return data objects or null
- No explicit return statements in error cases (handled by global error middleware)

Example from `SupplierController.js`:
```javascript
exports.getSuppliers = tryCatchAsync(async (req, res) => {
    const suppliers = await Suppliers.aggregate([...]);
    const total = await Suppliers.countDocuments(matchStage);

    res.status(200).json({
        success: true,
        suppliers,
        total,
        page,
        pages: Math.ceil(total / limit)
    });
});
```

## Module Design

**Exports:**

Backend (CommonJS):
```javascript
module.exports = ClassName;  // For models/modals
module.exports = router;      // For route files
module.exports = { func1, func2, func3 };  // For utilities and controllers
```

Frontend (ES6):
```javascript
export default ComponentName;  // Default export for components
export { namedExport };        // Named exports for utils
```

**Barrel Files:**
- Not used; each file is imported directly
- Routes combined at application level in `app.js`
- Models imported individually where needed

**Controller Organization:**
- One file per domain area (AuthController, InvoiceController, SupplierController)
- Multiple exports per file: `exports.methodName = tryCatchAsync(async (req, res) => { ... })`
- Related helpers remain in same file or in dedicated utility files

**Model Organization:**
- One schema definition per file with matching export
- Pre-save hooks defined inline (`schema.pre('save', ...)`)
- Migration logic added to connection event handlers

## Type Safety

**No TypeScript** - project uses CommonJS with JavaScript

**Runtime Validation:**
- Zod schemas used in agent tools (`z.string()`, `z.enum()`, `z.boolean()`)
- File type validation with `file-type` package (MIME type checking)
- Manual type checking: `typeof`, `Array.isArray()`, `instanceof`

## Database Conventions

**Model Names:**
- Mongoose models capitalized: `User`, `Vendor`, `SupplierInvoice`
- Schema field names camelCase: `invoiceNumber`, `vendorAmount`
- Enum values lowercase with hyphens: `"paid"`, `"unpaid"`, `"Reconciled"`, `"Unreconciled"`

**Indexing:**
- Applied to frequently queried fields: `.index: true`
- Example: `invoiceNumber`, `vendorId`, `projectId` all indexed

**Timestamps:**
- Standard fields: `createdAt`, `modifiedLast`, `updatedAt`
- Initialized with `default: Date.now`
- Pre-save hooks update timestamps

---

*Convention analysis: 2026-02-08*
