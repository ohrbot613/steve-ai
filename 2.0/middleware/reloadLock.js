const { tryCatchAsync } = require("../../controllers/ErrorController");
const Team = require("../modals/teamModal");

/**
 * Block all requests when Team.reloading is true for the current user's tenant.
 * Skip the reload endpoints themselves (get-all-vendors, get-all-invoices).
 */
const reloadLock = tryCatchAsync(async (req, res, next) => {
    const path = req.path || "";
    if (path === "/scripts/get-all-vendors" || path === "/scripts/get-all-invoices" || path === "/scripts/reloading-status") {
        return next();
    }

    const teamTenantId = req.user?.tenant != null ? String(req.user.tenant) : null;
    if (!teamTenantId) {
        return next();
    }

    const team = await Team.findOne({ tenantId: teamTenantId }).select("reloading").lean();
    if (team?.reloading) {
        return res.status(503).json({
            success: false,
            code: "RELOADING",
            message: "The site is currently reloading data from Xero. Please wait—you cannot use the site until this finishes.",
        });
    }

    next();
});

module.exports = reloadLock;
