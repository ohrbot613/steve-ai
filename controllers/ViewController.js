const { tryCatchAsync } = require("./ErrorController");
const Statements = require("../modals/statementsModal");
const Statement2 = require("../2.0/modals/statementModal");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
exports.home = tryCatchAsync(async (req, res) => {
    res.status(200).render("home");
});
exports.login = tryCatchAsync(async (req, res) => {
    res.status(200).render("login");
});

exports.logs = tryCatchAsync(async (req, res) => {
    res.status(200).render("logs");
});

exports.statements = tryCatchAsync(async (req, res) => {
    res.status(200).render("statements");
});

exports.allStatements = tryCatchAsync(async (req, res) => {
    res.status(200).render("allStatements");
});


exports.allLogs = tryCatchAsync(async (req, res) => {
    res.status(200).render("allLogs");
});


exports.file = tryCatchAsync(async (req, res) => {
    const fileId = req.params.file; // statement id (v1 or v2)

    // Validate ObjectId format to prevent NoSQL injection
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
        return res.status(400).send('Invalid file identifier');
    }

    // Try v1 Statements first
    const query = { _id: fileId };
    if (req.user?.tenant) {
        query.tenant = req.user.tenant;
    }
    let item = await Statements.findOne(query);

    // If not found in v1, try 2.0 Statement (supplier-logs Statements tab uses 2.0)
    if (!item) {
        const item2 = await Statement2.findOne({ _id: fileId, isDeleted: { $ne: true } }).lean();
        if (item2?.file) item = { file: item2.file };
    }

    if (!item || !item.file) return res.status(404).send('File not found');

    // Prevent path traversal — strip directory components
    const safeFilename = path.basename(item.file);
    const allowedDir = path.resolve(__dirname, "../../steve_files_do_not_delete");
    const filePath = path.resolve(allowedDir, safeFilename);

    // Verify resolved path stays inside the allowed directory
    if (!filePath.startsWith(allowedDir + path.sep)) {
        return res.status(400).send('Invalid file path');
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    // Determine file type
    const ext = path.extname(filePath).toLowerCase();
    let contentType = '';
    if (ext === '.pdf') contentType = 'application/pdf';
    else if (ext === '.xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    else return res.status(400).send('Unsupported file type');

    res.setHeader('Content-Type', contentType);

    // PDF: inline so modern browsers can display in a new tab; others: attachment to download
    const disposition = ext === '.pdf' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(safeFilename)}"`);

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
});
