exports.tryCatchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}

exports.AppError = class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

// Helper function to safely serialize error objects without circular references
const serializeError = (err) => {
    // Handle Boom errors (from @hapi/wreck)
    if (err.isBoom) {
        return {
            statusCode: err.output?.statusCode || err.statusCode || 500,
            error: err.output?.payload?.error || 'Internal Server Error',
            message: err.output?.payload?.message || err.message || 'An error occurred',
            // Include payload if it exists and is serializable
            payload: err.data?.payload || null
        };
    }

    // Handle standard Error objects
    const errorInfo = {
        message: err.message || 'An error occurred',
        name: err.name || 'Error',
        statusCode: err.statusCode || 500
    };

    // Include additional error data if it exists and is safe to serialize
    if (err.data && typeof err.data === 'object') {
        try {
            // Try to extract safe properties from err.data
            if (err.data.payload) {
                errorInfo.payload = err.data.payload;
            }
            if (err.data.error) {
                errorInfo.error = err.data.error;
            }
        } catch (e) {
            // If we can't extract, just ignore
        }
    }

    return errorInfo;
};

exports.errorHandler = (err, req, res, next) => {
    // Log error server-side only (never send full error to client)
    if (process.env.NODE_ENV !== 'production') {
        console.error("Error:", err);
    }

    // Send to Sentry when DSN is configured
    if (process.env.SENTRY_DSN) {
        const Sentry = require("@sentry/node");
        Sentry.withScope((scope) => {
            scope.setTag("path", req.path);
            scope.setTag("method", req.method);
            if (req.user?.id) scope.setUser({ id: String(req.user.id) });
            Sentry.captureException(err);
        });
    }

    // If it's an AppError, send its message
    if (err instanceof exports.AppError) {
        return res.status(err.statusCode).json({
            status: err.status,
            message: err.message
        });
    }

    // Determine status code
    const statusCode = err.isBoom 
        ? (err.output?.statusCode || err.statusCode || 500)
        : (err.statusCode || 500);

    // Serialize error safely
    const errorResponse = serializeError(err);

    // Fallback for unknown errors — hide internal details in production
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(statusCode).json({
        status: statusCode >= 500 ? "error" : "fail",
        message: (isProduction && statusCode >= 500)
            ? "Something went wrong!"
            : (errorResponse.message || "Something went wrong!"),
        ...(!isProduction && errorResponse.payload && { payload: errorResponse.payload }),
        ...(!isProduction && errorResponse.error && { error: errorResponse.error })
    });
};