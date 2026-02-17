const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage } = require("@langchain/core/messages");
const { createAgent } = require("langchain");
const agentTools = require("./agentToolsController");
const agentDbTools = require("./agentDbTools");
const ThreadMemoryService = require("../../utils/memoryService");

const systemPrompt =
  "You are a helpful financial assistant with access to database query tools and utility tools. " +
  "Available tools: " +
  "get_db_schema (returns all model fields, types, and relationships for Statement, Invoice, Vendor—call when you need to know exact field names or how tables relate), " +
  "get_current_date (today's date/time), " +
  "text_to_uppercase (convert text to ALL CAPS), " +
  "detect_statement_upload (check if user wants to upload a statement), " +
  "query_statements (search statements by date range or vendor), " +
  "query_invoices (search invoices by statement, status, vendor, or date range), " +
  "query_vendors (search vendors by name or xeroId), " +
  "search_similar_vendors (find similar vendor names when the given name does not match; it chooses the correct one and returns selectedVendor—use that vendor for follow-up queries). " +
  "Think step by step: use query tools when the user asks about financial data, invoices, statements, vendors, or suppliers. " +
  "Use get_db_schema when you need to see all modal fields and relationships to build correct queries. " +
  "For vendor-related invoice queries, use query_invoices with vendorName or contactId. " +
  "When a vendor name does not match, call search_similar_vendors; then use the returned selectedVendor (its xeroId/contactId and name) in your next query_invoices or query_statements call. If you need to pick a different match, call search_similar_vendors again with selectIndex (0=first, 1=second, etc). " +
  "Always answer based on the data returned by tools, not assumptions.";

const memoryService = new ThreadMemoryService();

/** GET /agent/threads – list all threads for the authenticated user */
exports.listThreads = async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required.",
    });
  }
  try {
    const threads = await memoryService.listThreadsForUser(userId);
    return res.json({
      success: true,
      threads: threads.map((t) => ({ threadId: t.threadId, createdAt: t.createdAt })),
    });
  } catch (error) {
    console.error("[Agent] listThreads error:", error.message || error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to list threads",
    });
  }
};

/** GET /agent/threads/:threadId/messages – get messages for a thread (ownership validated) */
exports.getThreadMessages = async (req, res) => {
  const { threadId } = req.params;
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required.",
    });
  }
  try {
    await memoryService.getThread(threadId, userId);
    const messages = await memoryService.getMessages(threadId, { limit: 10000 });
    const items = messages.map((msg) => ({
      index: msg.index,
      type: msg.role === "assistant" ? "agent" : msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    }));
    return res.json({
      success: true,
      messages: items,
    });
  } catch (error) {
    if (error.message === "Thread not found or access denied") {
      return res.status(404).json({
        success: false,
        error: error.message,
      });
    }
    console.error("[Agent] getThreadMessages error:", error.message || error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to get messages",
    });
  }
};

/** POST /agent/new-chat – create a new thread for the authenticated user only */
exports.newChat = async (req, res) => {
  const userId = req.user?._id;
  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required. You can only create chats for yourself.",
    });
  }
  try {
    const thread = await memoryService.createThread(userId);
    return res.json({
      success: true,
      threadId: thread.threadId,
    });
  } catch (error) {
    console.error("[Agent] newChat error:", error.message || error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to create thread",
    });
  }
};

exports.runAgent = async (req, res) => {
  let userMessage =
    req.body?.prompt ??
    req.body?.message ??
    req.body?.content ??
    req.query?.message ??
    req.query?.prompt;

  const threadId = req.body?.threadId ?? req.query?.threadId;
  const userId = req.user?._id;

  if (req.file && typeof userMessage === "string") {
    userMessage = userMessage + " [User attached a file: " + (req.file.originalname || "file") + "]";
  }

  console.log("[Agent] runAgent called", {
    hasMessage: !!userMessage,
    messageLength: typeof userMessage === "string" ? userMessage.length : 0,
    hasFile: !!req.file,
    threadId: threadId || null,
  });

  if (!userMessage || typeof userMessage !== "string") {
    console.warn("[Agent] Invalid request: missing or non-string prompt/message");
    return res.status(400).json({
      success: false,
      error:
        "Provide a 'prompt', 'message', or 'content' in body or query.",
    });
  }

  if (threadId && !userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication required to use a conversation thread.",
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

    const agent = createAgent({
      model: llm,
      tools: [...agentTools.tools, ...agentDbTools.dbTools],
      systemPrompt,
    });

    let messagesToSend;

    const MAX_CONTEXT_MESSAGES = 20; // Cap to avoid OpenRouter 400 on large payloads (system + tools + history)

    if (threadId && userId) {
      // Load conversation context for this thread (validates ownership)
      const { messages: contextMessages } = await memoryService.loadContext(threadId, userId);
      const capped = contextMessages.length > MAX_CONTEXT_MESSAGES
        ? contextMessages.slice(-MAX_CONTEXT_MESSAGES)
        : contextMessages;
      const newUserMessage = new HumanMessage(userMessage);
      messagesToSend = [...capped, newUserMessage];
      await memoryService.saveMessage(threadId, "user", userMessage);
      console.log("[Agent] Using thread context", {
        threadId,
        contextCount: contextMessages.length,
        sentCount: capped.length,
      });
    } else {
      messagesToSend = [new HumanMessage(userMessage)];
    }

    console.log("[Agent] Invoking agent with message:", userMessage.slice(0, 200) + (userMessage.length > 200 ? "…" : ""));

    const result = await agent.invoke({
      messages: messagesToSend,
    });

    const finalMessages = result?.messages ?? [];
    const lastMessage = finalMessages[finalMessages.length - 1];
    const content =
      lastMessage?.content != null
        ? typeof lastMessage.content === "string"
          ? lastMessage.content
          : String(lastMessage.content)
        : "";

    if (threadId && userId) {
      await memoryService.saveMessage(threadId, "assistant", content);
    }

    console.log("[Agent] Agent completed", { messageCount: finalMessages.length });
    console.log("[Agent] Responding successfully", { contentLength: content.length });
    return res.json({
      success: true,
      content,
      messages: finalMessages.length,
    });
  } catch (error) {
    const status = error?.status ?? error?.response?.status;
    const body = error?.response?.data ?? error?.data ?? error?.cause;
    console.error("[Agent] Agent error:", error.message || error);
    if (status || body) {
      console.error("[Agent] Provider response:", { status, body: typeof body === "object" ? JSON.stringify(body).slice(0, 500) : body });
    }
    return res.status(500).json({
      success: false,
      error: error.message || "Agent failed",
    });
  }
};

