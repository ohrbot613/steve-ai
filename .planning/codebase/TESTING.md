# Testing Patterns

**Analysis Date:** 2026-02-08

## Test Framework

**Runner:**
- Not detected in package.json
- No jest.config.js, vitest.config.js, or test runner configuration found
- No test files (*.test.js, *.spec.js) found in source directories (excluding node_modules)

**Status:** Testing infrastructure not currently implemented

**Assertion Library:**
- Not configured

**Run Commands:**
- No test scripts defined in `package.json`
- Current scripts: `npm start` (node server.js), `npm run dev` (nodemon server.js)

## Test File Organization

**Location:**
- No test files detected in codebase

**Naming:**
- No established pattern yet

**Structure:**
- Not applicable

## Testing Strategy (Current State)

**Manual Testing Approach:**
The project appears to rely on manual testing rather than automated test suites. Evidence:
- No test framework installed or configured
- Controllers use error handlers but no unit tests
- Complex business logic (invoice parsing, AI formatting) lacks automated test coverage
- API endpoints tested via HTTP requests (likely manual or via Postman/Thunder Client)

**Error Handling Validates Runtime Behavior:**
Rather than unit tests, the codebase uses:
- Global error handler middleware that catches and logs issues
- Sentry integration for production error tracking
- Console logging for development debugging
- Try-catch blocks for critical operations

Example from `InvoiceController.js` handling multer errors:
```javascript
exports.handleMulterError = async (err, req, res, next) => {
    if (err) {
        try {
            const logDoc = await Statements.create({
                tenant: req.user?.tenant,
                status: 'failed',
                file: fileName,
                errors: [{
                    timestamp: new Date(),
                    step: 'multer_file_upload',
                    message: err.message || String(err),
                    stack: err.stack || undefined,
                }],
                errorMessage: err.message || String(err),
                errorStack: err.stack || undefined,
            });
        } catch (err) {
            // Handle logging failure
        }
    }
};
```

## Mocking

**Framework:**
- No mocking library detected (sinon, jest.mock, vitest.mock, etc.)

**Patterns:**
- Not established

**What Would Need Mocking:**
- Database calls (Mongoose queries)
- External API calls (Xero API, OpenRouter, Google AI)
- File system operations (pdf-parse, xlsx reading)
- Authentication (JWT verification)

## Fixtures and Factories

**Test Data:**
- No fixture files detected
- No factory functions for creating test objects
- Manual data creation would be necessary if tests were added

**Location:**
- Recommended location: `/tests/fixtures/` or `/tests/factories/`

## Integration Testing

**Current Approach:**
- Manual integration testing through HTTP requests
- API endpoints tested end-to-end without isolated unit tests
- Database state tested via Mongoose operations

**Example Scenario:**
Invoice upload workflow:
1. File upload to `/api/v1/invoice/upload` with multer
2. File type validation via `file-type` package
3. PDF/XLSX parsing (pdf-parse, xlsx libraries)
4. AI-based formatting with Google Gemini/OpenRouter
5. Database storage in MongoDB
6. Response sent to client

No automated test validates this flow - relies on manual testing and error logging.

## Coverage

**Requirements:**
- No coverage targets enforced
- No `.nyc_config` or coverage configuration
- No coverage reports generated

**View Coverage:**
- Not applicable (no test framework)

## Recommended Testing Setup

**To Add Testing Infrastructure:**

1. **Install test framework:**
```bash
npm install --save-dev vitest @vitest/ui
# or
npm install --save-dev jest ts-jest
```

2. **Configuration file needed:**
- `vitest.config.js` or `jest.config.js`

3. **Mocking setup:**
- Install mocking library: `npm install --save-dev sinon` or use jest.mock()
- Mock Mongoose: Create factory for test data
- Mock external APIs: Use nock or similar for HTTP mocking

4. **Test structure to adopt:**
```javascript
// Example: tests/controllers/AuthController.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { protect } from '../../controllers/AuthController';

describe('AuthController', () => {
  describe('protect middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = { cookies: {}, headers: {} };
      res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      next = vi.fn();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should reject requests without token', async () => {
      await protect(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });
});
```

## Critical Paths Needing Tests

**High Priority** (Complex business logic, frequent changes):
- `formatting.js` - AI-based invoice formatting logic
- `InvoiceController.js` - File upload, validation, storage pipeline
- `controllers/agent/*` - LangChain/LangGraph agent logic
- `AuthController.js` - JWT protection, Xero OAuth flow

**Medium Priority** (API endpoints, data access):
- `SupplierController.js` - Supplier aggregation queries
- `LangChainController.js` - AI agent invocations
- Route handlers for CRUD operations

**Lower Priority** (Utilities, helpers):
- `utils/agentTools.js` - Tool definitions for agents
- `utils/currencyUtils.js` - Currency conversion
- Model schemas and pre-save hooks

## Error Testing Pattern

**Current approach:**
Errors logged to database and Sentry, but not tested

**Pattern needed:**
```javascript
it('should return 400 when file is invalid type', async () => {
    req.files = [{
        mimetype: 'application/json',
        buffer: Buffer.from('invalid')
    }];

    await validateUploadedFiles(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
            success: false,
            message: expect.stringContaining('PDF and XLSX')
        })
    );
});
```

## Database Testing

**Would require:**
- Test MongoDB instance (in-memory or containerized)
- Test data factories for models
- Transaction rollback between tests

**Current workaround:**
- Migration scripts handle schema changes
- Error logging captures database issues
- Development uses real MongoDB instance

## Async Testing

**How async operations currently handled:**
- `tryCatchAsync` wrapper ensures errors caught and passed to error handler
- No explicit async/await testing patterns

**Pattern needed:**
```javascript
it('should handle async invoice parsing', async () => {
    const buffer = /* PDF buffer */;
    const result = await formatWithAIToStandardJSON(buffer.toString());

    expect(result).toHaveProperty('invoices');
    expect(Array.isArray(result.invoices)).toBe(true);
});
```

## API Testing

**Current approach:**
- Manual HTTP testing (likely via Postman, curl, or Thunder Client)
- Browser-based testing of client features

**Would need:**
- Supertest or similar for integration testing
- Test API fixtures for known request/response patterns
- Mock external APIs (Xero, OpenRouter, Sentry)

Example pattern:
```javascript
import request from 'supertest';
import app from '../../app';

describe('POST /api/v1/invoice/upload', () => {
    it('should accept PDF files', async () => {
        const response = await request(app)
            .post('/api/v1/invoice/upload')
            .set('Authorization', `Bearer ${testToken}`)
            .attach('files', pdfBuffer, 'test.pdf');

        expect(response.status).toBe(200);
    });
});
```

## Performance Testing

**Not currently implemented:**

Would be useful for:
- File upload size limits (currently 10MB per file, 50 file max)
- AI formatting request timeouts
- Database aggregation pipeline performance
- Concurrent invoice processing

## Frontend Testing

**Client framework:** React with Vite

**Current state:**
- No React testing library configured
- No component tests for modals, widgets, or pages
- Manual browser testing required

**Would need:**
```bash
npm install --save-dev @testing-library/react @testing-library/jest-dom vitest
```

**Test pattern needed:**
```javascript
import { render, screen } from '@testing-library/react';
import FileUploadWidget from '../../componentes/FileUploadWidget';

describe('FileUploadWidget', () => {
    it('should accept PDF files via drag-and-drop', () => {
        const { container } = render(
            <FileUploadWidget onClose={() => {}} onUploadComplete={() => {}} />
        );

        const dropZone = container.querySelector('[data-testid="drop-zone"]');
        expect(dropZone).toBeInTheDocument();
    });
});
```

## CI/CD Testing

**Current status:**
- No CI pipeline detected (no GitHub Actions, GitLab CI, etc.)
- No pre-commit hooks configured
- No automated test runs on PR/push

**Would need:**
- GitHub Actions workflow to run tests on every push
- Pre-commit hook to validate code before commits
- Coverage reports published on PRs

---

*Testing analysis: 2026-02-08*

**Note:** This project prioritizes getting features working over test coverage. As features mature and multiple teams work on code, implementing automated tests will become increasingly valuable to prevent regressions and ensure API compatibility.
