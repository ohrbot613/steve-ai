const ProcessLog = require("../modals/processLogModal");
const User = require("../../modals/userModal");
const { tryCatchAsync } = require("../../controllers/ErrorController");

/**
 * Log a process with a description, an array of IDs, and optional user.
 * @param {string} description
 * @param {Array<string|import('mongoose').Types.ObjectId|number>} [ids=[]]
 * @param {import('mongoose').Types.ObjectId|null|undefined} [userId]
 * @returns {Promise<import('../modals/processLogModal')>}
 */
async function logProcess(description, ids = [], userId = null) {
    const doc = await ProcessLog.create({
        description: String(description),
        ids: Array.isArray(ids) ? ids : [ids],
        user: userId || undefined,
    });
    return doc;
}

exports.logProcess = logProcess;

exports.list = tryCatchAsync(async (req, res) => {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
        ProcessLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        ProcessLog.countDocuments(),
    ]);
    const pages = Math.max(1, Math.ceil(total / limit));

    // Resolve user names from main app User model (process logs store user ObjectId)
    const userIds = [...new Set(logs.map((l) => l.user).filter(Boolean))];
    let userMap = {};
    if (userIds.length > 0) {
        const users = await User.find({ _id: { $in: userIds } })
            .select("name email")
            .lean();
        userMap = Object.fromEntries(users.map((u) => [String(u._id), { name: u.name, email: u.email }]));
    }

    const logsWithUser = logs.map((log) => {
        const userDetail = log.user ? userMap[String(log.user)] : null;
        return {
            ...log,
            userDetail: userDetail || null,
        };
    });

    return res.status(200).json({ success: true, logs: logsWithUser, pages });
});

exports.create = tryCatchAsync(async (req, res) => {
    const { description, ids } = req.body;
    if (!description || typeof description !== "string" || !description.trim()) {
        return res.status(400).json({ success: false, message: "description is required and must be a non-empty string." });
    }
    const userId = req.user?._id ?? req.body.user ?? null;
    const doc = await logProcess(description.trim(), Array.isArray(ids) ? ids : ids != null ? [ids] : [], userId);
    return res.status(201).json({ success: true, log: doc });
});
