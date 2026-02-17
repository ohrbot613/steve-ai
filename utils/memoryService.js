const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, AIMessage, SystemMessage } = require("@langchain/core/messages");
const { trimMessages } = require("@langchain/core/messages");
const { v4: uuidv4 } = require('uuid');
const Thread = require('../modals/threadModal');
const Message = require('../modals/messageModal');

/**
 * ThreadMemoryService - Manages conversation memory for AI agent threads
 *
 * Handles thread lifecycle: creation, message storage, context retrieval with
 * token-aware windowing, and automatic summarization of older messages.
 */
class ThreadMemoryService {
  constructor(options = {}) {
    this.maxTokens = options.maxTokens || 4000;
    this.summaryModel = options.summaryModel || 'openai/gpt-4o-mini';
    this.defaultMessageLimit = options.defaultMessageLimit || 20;

    // Store OpenRouter config matching LangChainController.js pattern
    this.openRouterConfig = {
      apiKey: process.env.OPEN_ROUTER,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.SITE_URL || "<YOUR_SITE_URL>",
          "X-Title": "PDF Automation",
        },
      },
    };
  }

  /**
   * Create a new thread with UUID v4
   * @param {string} userId - MongoDB ObjectId of the user
   * @returns {Promise<Object>} Created thread document
   */
  async createThread(userId) {
    const threadId = uuidv4();
    const thread = await Thread.create({ threadId, userId });
    return thread;
  }

  /**
   * List threads for a user (threadId and createdAt), newest first
   * @param {string} userId - MongoDB ObjectId of the user
   * @returns {Promise<Array>} Array of { threadId, createdAt }
   */
  async listThreadsForUser(userId) {
    return Thread.find({ userId })
      .sort({ createdAt: -1 })
      .select('threadId createdAt')
      .lean();
  }

  /**
   * Get thread with ownership validation
   * @param {string} threadId - UUID of the thread
   * @param {string} userId - MongoDB ObjectId of the user
   * @returns {Promise<Object>} Thread document
   * @throws {Error} If thread not found or access denied
   */
  async getThread(threadId, userId) {
    const thread = await Thread.findOne({ threadId, userId });
    if (!thread) {
      throw new Error('Thread not found or access denied');
    }
    return thread;
  }

  /**
   * Save a message to a thread
   * @param {string} threadId - UUID of the thread
   * @param {string} role - 'user', 'assistant', or 'system'
   * @param {string} content - Message content
   * @param {Object} metadata - Optional metadata (toolCalls, usage, etc.)
   * @returns {Promise<Object>} Created message document
   */
  async saveMessage(threadId, role, content, metadata = {}) {
    const count = await Message.countDocuments({ threadId });
    const index = count + 1;
    const message = await Message.create({
      threadId,
      role,
      content,
      index,
      metadata
    });
    return message;
  }

  /**
   * Get messages for a thread
   * @param {string} threadId - UUID of the thread
   * @param {Object} options - Query options
   * @param {number} options.limit - Max messages to retrieve (default: defaultMessageLimit)
   * @returns {Promise<Array>} Array of message documents
   */
  async getMessages(threadId, options = {}) {
    const limit = options.limit || this.defaultMessageLimit;

    // Fetch all messages sorted chronologically (oldest first)
    const messages = await Message.find({ threadId })
      .sort({ createdAt: 1 })
      .lean();

    // If limit specified and we have more messages, take the last N
    if (limit && messages.length > limit) {
      return messages.slice(-limit);
    }

    return messages;
  }

  /**
   * Load conversation context with token-aware trimming and summarization
   * This is the primary method Phase 2 will call to get conversation history
   *
   * @param {string} threadId - UUID of the thread
   * @param {string} userId - MongoDB ObjectId of the user (for ownership validation)
   * @returns {Promise<Object>} { messages: LangChain message array, totalMessages, includedMessages, summarized }
   */
  async loadContext(threadId, userId) {
    // Validate ownership
    await this.getThread(threadId, userId);

    // Fetch all messages for the thread
    const rawMessages = await Message.find({ threadId })
      .sort({ createdAt: 1 })
      .lean();

    if (rawMessages.length === 0) {
      return {
        messages: [],
        summary: null,
        totalMessages: 0,
        includedMessages: 0,
        summarized: false
      };
    }

    // Convert to LangChain message objects
    const lcMessages = rawMessages.map(msg => {
      switch (msg.role) {
        case 'user':
          return new HumanMessage(msg.content);
        case 'assistant':
          return new AIMessage(msg.content);
        case 'system':
          return new SystemMessage(msg.content);
        default:
          // Fallback for unknown roles
          return new HumanMessage(msg.content);
      }
    });

    // Create LLM instance for token counting (matching existing config)
    const llm = new ChatOpenAI({
      modelName: this.summaryModel,
      temperature: 0,
      ...this.openRouterConfig,
    });

    // Trim messages based on token count
    const trimmed = await trimMessages(lcMessages, {
      maxTokens: this.maxTokens,
      strategy: 'last',
      tokenCounter: llm,
      allowPartial: false
    });

    // If messages were trimmed, summarize the older ones
    let summary = null;
    if (trimmed.length < lcMessages.length) {
      const olderMessages = lcMessages.slice(0, lcMessages.length - trimmed.length);
      summary = await this._summarizeOlder(olderMessages);
    }

    return {
      messages: summary ? [summary, ...trimmed] : trimmed,
      totalMessages: lcMessages.length,
      includedMessages: trimmed.length,
      summarized: summary !== null
    };
  }

  /**
   * Summarize older messages that were trimmed out
   * Uses domain-specific prompt to preserve critical business details
   *
   * @param {Array} messages - Array of LangChain message objects
   * @returns {Promise<SystemMessage>} Summary as SystemMessage
   * @private
   */
  async _summarizeOlder(messages) {
    // Build conversation text from messages
    const conversationText = messages
      .map(msg => `${msg._getType()}: ${msg.content}`)
      .join('\n\n');

    // Domain-specific summarization prompt
    const summaryPrompt = `Summarize this conversation history concisely.
CRITICAL: Preserve all specific details including:
- Invoice numbers, amounts, dates
- Vendor/supplier names
- File names or document references
- Unresolved questions or pending actions
- Key decisions made
- Any tool results or data lookups performed

Keep the summary under 200 words but do NOT omit specific identifiers.

Conversation:
${conversationText}`;

    // Create LLM instance for summarization
    const llm = new ChatOpenAI({
      modelName: this.summaryModel,
      temperature: 0,
      ...this.openRouterConfig,
    });

    // Generate summary
    const summaryResponse = await llm.invoke([
      new HumanMessage(summaryPrompt)
    ]);

    const summaryContent = summaryResponse.content || summaryResponse.text || '';

    // Return as SystemMessage with clear formatting
    return new SystemMessage(`[Previous conversation summary: ${summaryContent}]`);
  }
}

module.exports = ThreadMemoryService;
