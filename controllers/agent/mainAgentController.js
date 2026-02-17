const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage } = require("@langchain/core/messages");
const { DynamicStructuredTool } = require("@langchain/core/tools");
const { z } = require("zod");
const { createAgent } = require("langchain");
const { tryCatchAsync } = require("../ErrorController");

// Two basic tools defined on this page
const textToUppercaseTool = new DynamicStructuredTool({
  name: "text_to_uppercase",
  description: "Convert text to uppercase. Use when the user wants text in ALL CAPS.",
  schema: z.object({
    text: z.string().describe("The text to convert to uppercase"),
  }),
  func: async ({ text }) => text.toUpperCase(),
});

const getCurrentDateTool = new DynamicStructuredTool({
  name: "get_current_date",
  description: "Get the current date and time. Use when the user asks what day it is, today's date, or the time.",
  schema: z.object({}),
  func: async () => {
    return new Date().toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "short",
    });
  },
});

const tools = [textToUppercaseTool, getCurrentDateTool];

exports.mainAgent = tryCatchAsync(async (req, res, next) => {
  const userMessage =
    req.body?.prompt ?? req.body?.message ?? req.body?.content ?? req.query?.message ?? req.query?.prompt;

  if (!userMessage || typeof userMessage !== "string") {
    return res.status(400).json({
      success: false,
      error: "Provide a 'prompt', 'message', or 'content' in body or query.",
    });
  }

  try {
    const llm = new ChatOpenAI({
      modelName: "openai/gpt-3.5-turbo",
      temperature: 0,
      apiKey: process.env.OPEN_ROUTER,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.SITE_URL || "<YOUR_SITE_URL>",
          "X-Title": "PDF Automation",
        },
      },
    });

    const systemPrompt =
      "You are a helpful assistant with two tools: text_to_uppercase (convert text to ALL CAPS) and get_current_date (today's date/time). " +
      "Think step by step: use a tool only when the user asks for uppercase text or the current date/time; otherwise answer directly.";

    const agent = createAgent({
      model: llm,
      tools,
      systemPrompt,
    });

    const result = await agent.invoke({
      messages: [new HumanMessage(userMessage)],
    });
    const finalMessages = result?.messages ?? [];
    const lastMessage = finalMessages[finalMessages.length - 1];
    const content =
      lastMessage?.content != null
        ? (typeof lastMessage.content === "string" ? lastMessage.content : String(lastMessage.content))
        : "";

    return res.json({
      success: true,
      content,
      messages: finalMessages.length,
    });
  } catch (error) {
    next(error);
  }
});
