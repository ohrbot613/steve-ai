const mongoose = require("mongoose");
const conn = require("../db");

const attachmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: "",
      trim: true,
    },
    data: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const userErrorReportSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      default: null,
      index: true,
    },
    userEmail: {
      type: String,
      default: null,
      trim: true,
    },
    userName: {
      type: String,
      default: null,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    screenshot: {
      type: String,
      default: null,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
    },
    hasScreenshot: {
      type: Boolean,
      default: false,
    },
    attachmentsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: [
        "open",
        "reviewed_by_dev",
        "in_dev",
        "fixed",
        "approved_by_client",
        "closed",
      ],
      default: "open",
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

const UserErrorReport = conn.model(
  "UserErrorReport",
  userErrorReportSchema,
  "user-error-reports-2.0"
);

module.exports = UserErrorReport;
