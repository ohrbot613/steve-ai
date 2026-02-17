const { DynamicStructuredTool } = require("@langchain/core/tools");
const { z } = require("zod");

// Tool 1: get current date/time
exports.getCurrentDateTool = new DynamicStructuredTool({
  name: "get_current_date",
  description:
    "Get the current date and time. Use when the user asks what day it is, today's date, or the time.",
  schema: z.object({}),
  func: async () => {
    const result = new Date().toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "short",
    });
    console.log("[AgentTool] get_current_date", { result });
    return result;
  },
});

// Tool 2: convert text to uppercase
exports.textToUppercaseTool = new DynamicStructuredTool({
  name: "text_to_uppercase",
  description:
    "Convert text to uppercase. Use when the user wants text in ALL CAPS.",
  schema: z.object({
    text: z.string().describe("The text to convert to uppercase"),
  }),
  func: async ({ text }) => {
    const result = text.toUpperCase();
    console.log("[AgentTool] text_to_uppercase", { textLength: text?.length, resultLength: result?.length });
    return result;
  },
});

// Tool 3: detect statement upload intent and whether user passed a file
exports.detectStatementUploadTool = new DynamicStructuredTool({
  name: "detect_statement_upload",
  description:
    "Detect if the user wants to upload a statement and if they passed a file. Use when processing user messages about statements, documents, or file uploads.",
  schema: z.object({
    userMessage: z.string().describe("The user's message or request to analyze"),
    hasFile: z
      .boolean()
      .describe("Whether the user attached or passed a file in this request"),
  }),
  func: async ({ userMessage, hasFile }) => {
    console.log("[AgentTool] detect_statement_upload", { hasFile, userMessageLength: (userMessage || "").length });
    const lower = (userMessage || "").toLowerCase();
    const statementKeywords = [
      "statement",
      "statement of account",
      "upload statement",
      "statement upload",
      "add statement",
      "attach statement",
      "my statement",
      "account statement",
    ];
    const uploadKeywords = ["upload", "attach", "add", "submit", "send", "file"];
    const wantsToUploadStatement =
      statementKeywords.some((k) => lower.includes(k)) ||
      (uploadKeywords.some((k) => lower.includes(k)) &&
        (lower.includes("statement") || lower.includes("account")));
    const result = {
      wantsToUploadStatement: !!wantsToUploadStatement,
      passedFile: !!hasFile,
      readyForStatementUpload: wantsToUploadStatement && hasFile,
    };
    console.log("[AgentTool] detect_statement_upload result", result);
    return JSON.stringify(result);
  },
});

exports.tools = [
  exports.getCurrentDateTool,
  exports.textToUppercaseTool,
  exports.detectStatementUploadTool,
];
