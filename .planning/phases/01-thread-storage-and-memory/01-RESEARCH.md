# Phase 1: Thread Storage and Memory - Research

**Researched:** 2026-02-09
**Domain:** MongoDB/Mongoose data modeling, LangChain conversation memory, token-based context windows
**Confidence:** HIGH

## Summary

This phase creates the data foundation for conversation threading: MongoDB collections for threads and messages, a memory service that loads conversation history with token-aware windowing, and summarization for older context. The existing stack (Mongoose, LangChain, uuid) already provides all necessary dependencies.

**Key insight:** Avoid unbounded array growth — store messages in a separate collection, not embedded in thread documents. Use LangChain's `trimMessages` utility with token counting (not legacy memory classes) for context window management.

**Primary recommendation:** Build custom MongoDB chat message history (extend `BaseChatMessageHistory` pattern) rather than use LangChain's built-in `MongoDBChatMessageHistory` (which has known issues with summarization). Use separate collections for threads and messages following MongoDB best practices.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mongoose | 9.0.2 | MongoDB ODM | Already in use, provides schema validation and timestamps |
| langchain | 1.1.16 | Agent framework | Already in use, provides message types (HumanMessage/AIMessage) |
| @langchain/core | 1.1.8 | Core utilities | Provides trimMessages for token-aware windowing |
| @langchain/openai | 1.2.0 | OpenAI integration | Already in use, provides token counting for context management |
| uuid | 13.0.0 | Thread ID generation | Already in use, cryptographically secure UUID v4 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| js-tiktoken | Latest | Token counting | If need standalone token counting (but @langchain/openai provides this) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom implementation | LangChain MongoDBChatMessageHistory | Built-in has known issue with ConversationSummaryBufferMemory (GitHub #21610) — custom gives control |
| Message count limit | Token-based limit with trimMessages | Token-based is more accurate for API costs and prevents context overflow |
| Embedded messages | Separate message collection | Embedding violates MongoDB's unbounded array anti-pattern |

**Installation:**
```bash
# No new packages needed — all dependencies already installed
```

## Architecture Patterns

### Recommended Project Structure
```
modals/                           # Existing pattern: "modals" not "models"
├── threadModal.js                # Thread metadata
├── messageModal.js               # Individual messages
└── [existing modals]

utils/
├── memoryService.js              # Memory loading + summarization
└── [existing utils]

controllers/
├── LangChainController.js        # Modified to use thread context
└── [existing controllers]
```

### Pattern 1: Separate Collections (Threads + Messages)
**What:** Store thread metadata in one collection, messages in another with threadId reference
**When to use:** Always — avoids MongoDB's unbounded array anti-pattern

**Thread Schema:**
```javascript
// modals/threadModal.js
const mongoose = require("mongoose");

const threadSchema = new mongoose.Schema({
    threadId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    }
}, {
    timestamps: true  // Auto-adds createdAt, updatedAt
});

// Compound index for ownership queries
threadSchema.index({ threadId: 1, userId: 1 });

module.exports = mongoose.model("Thread", threadSchema);
```

**Message Schema:**
```javascript
// modals/messageModal.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
    threadId: {
        type: String,
        required: true,
        index: true
    },
    role: {
        type: String,
        required: true,
        enum: ['user', 'assistant', 'system']
    },
    content: {
        type: String,
        required: true
    },
    metadata: {
        toolCalls: [{ type: mongoose.Schema.Types.Mixed }],
        usage: { type: mongoose.Schema.Types.Mixed }
    }
}, {
    timestamps: true
});

// Index for chronological retrieval
messageSchema.index({ threadId: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
```

### Pattern 2: Token-Aware Context Loading with trimMessages
**What:** Use LangChain's `trimMessages` utility to manage context window by token count, not message count
**When to use:** Every agent invocation that includes conversation history

**Example:**
```javascript
// utils/memoryService.js
const { trimMessages } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");
const Message = require("../modals/messageModal");

async function loadThreadContext(threadId, options = {}) {
    const {
        maxTokens = 4000,        // Reserve tokens for history
        strategy = 'last',        // Keep most recent messages
        includeSummary = true     // Include summary of older messages
    } = options;

    // Load all messages for thread
    const messages = await Message.find({ threadId })
        .sort({ createdAt: 1 })
        .lean();

    // Convert to LangChain message objects
    const lcMessages = messages.map(msg => {
        if (msg.role === 'user') {
            return new HumanMessage(msg.content);
        } else {
            return new AIMessage(msg.content);
        }
    });

    // Initialize LLM for token counting
    const llm = new ChatOpenAI({
        modelName: process.env.OPENAI_MODEL || 'gpt-4'
    });

    // Trim to token limit
    const trimmedMessages = await trimMessages(lcMessages, {
        maxTokens,
        strategy,
        tokenCounter: llm,
        allowPartial: false
    });

    return {
        messages: trimmedMessages,
        totalMessages: messages.length,
        includedMessages: trimmedMessages.length
    };
}

module.exports = { loadThreadContext };
```

### Pattern 3: Conversation Summarization
**What:** When context exceeds window, summarize older messages and include summary
**When to use:** When trimmedMessages.length < totalMessages.length

**Example:**
```javascript
async function summarizeOlderContext(messages, cutoffIndex) {
    const olderMessages = messages.slice(0, cutoffIndex);

    const summaryPrompt = `Summarize this conversation history concisely.
Focus on: key decisions, important context, entity names (invoice numbers, vendors, amounts),
and unresolved questions. Keep it under 200 words.

Conversation:
${olderMessages.map(m => `${m.role}: ${m.content}`).join('\n\n')}`;

    const llm = new ChatOpenAI({
        modelName: 'gpt-4o-mini',  // Use cheaper model for summarization
        temperature: 0
    });

    const summary = await llm.invoke(summaryPrompt);
    return new AIMessage(`[Previous conversation summary: ${summary.content}]`);
}
```

### Pattern 4: Thread Ownership Validation
**What:** Always validate that userId matches thread.userId before allowing access
**When to use:** Every thread retrieval operation

**Example:**
```javascript
async function getThreadWithOwnership(threadId, userId) {
    const thread = await Thread.findOne({ threadId, userId });

    if (!thread) {
        throw new Error('Thread not found or access denied');
    }

    return thread;
}
```

### Anti-Patterns to Avoid
- **Embedding messages in thread document:** Violates MongoDB unbounded array rule, hits 16MB document limit
- **Using ConversationBufferWindowMemory:** Deprecated pattern, use trimMessages instead
- **Message count limits without token awareness:** Causes API errors when context exceeds model limits
- **UUID v1 for thread IDs:** Leaks timestamp/MAC address — use UUID v4 (cryptographically random)
- **Skipping ownership validation:** Security vulnerability — users could access others' threads

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom BPE tokenizer | @langchain/openai's built-in counter or js-tiktoken | OpenAI's tiktoken is 3-6x faster, matches API exactly |
| UUID generation | Math.random() or timestamp-based | uuid package (v4) or crypto.randomUUID() | Cryptographically secure, collision probability ~1 in 2^122 |
| Message trimming | Manual array slicing by count | LangChain trimMessages utility | Handles partial messages, token counting, multiple strategies |
| Timestamps | Manual Date.now() fields | Mongoose `timestamps: true` | Automatic, immutable createdAt, auto-updating updatedAt |
| MongoDB 16MB limit handling | Custom chunking logic | Separate collections pattern | Well-documented MongoDB best practice |

**Key insight:** LangChain's memory abstractions have evolved — modern pattern is manual message management + trimMessages, not the legacy ConversationBufferWindowMemory classes.

## Common Pitfalls

### Pitfall 1: Unbounded Array Growth in Thread Document
**What goes wrong:** Embedding messages array in thread document eventually hits MongoDB's 16MB limit, causing write failures
**Why it happens:** Seems natural to store related data together (one-to-many relationship)
**How to avoid:** Use separate Message collection with threadId reference — MongoDB best practice for unbounded relationships
**Warning signs:** Documents growing over time, slow queries on threads with many messages

### Pitfall 2: Message Count vs Token Count
**What goes wrong:** Loading "last 20 messages" might exceed model's token limit if messages are long
**Why it happens:** Intuitive to count messages, but models charge/limit by tokens
**How to avoid:** Always use token-based limits with trimMessages and a token counter
**Warning signs:** API errors about context length, unexpected high token costs

### Pitfall 3: MongoDBChatMessageHistory + Summarization Bug
**What goes wrong:** LangChain's built-in MongoDBChatMessageHistory doesn't properly trim when used with ConversationSummaryBufferMemory — sends full history even after summarization
**Why it happens:** Known issue (GitHub langchain#21610) in the integration between these classes
**How to avoid:** Build custom message loading using Message.find() + trimMessages pattern
**Warning signs:** Token usage stays high even with summarization enabled

### Pitfall 4: Missing Ownership Validation
**What goes wrong:** Users can access/modify other users' threads by guessing thread IDs
**Why it happens:** Thread ID validation without userId check
**How to avoid:** Always query with both threadId AND userId: `Thread.findOne({ threadId, userId })`
**Warning signs:** Security audit flags, no userId in thread queries

### Pitfall 5: Summarization Prompt Lacks Specificity
**What goes wrong:** Generic "summarize this" prompts lose critical business context (invoice numbers, amounts, vendor names)
**Why it happens:** Using vague summarization instructions
**How to avoid:** Prompt must specify what to preserve: "Extract and preserve all invoice numbers, amounts, vendor names, dates, and unresolved questions"
**Warning signs:** Agent loses context about specific invoices/amounts after summarization

### Pitfall 6: Not Handling Summary as System Message
**What goes wrong:** Summary text appears as regular AI message, confusing the model about conversation flow
**Why it happens:** Inserting summary as AIMessage without clear demarcation
**How to avoid:** Wrap summary in clear markers like `[Previous conversation summary: ...]` or use SystemMessage type
**Warning signs:** Model references "previous response" incorrectly after summary

## Code Examples

Verified patterns from official sources and research:

### Thread Creation with UUID v4
```javascript
// Source: https://github.com/uuidjs/uuid
const { v4: uuidv4 } = require('uuid');
const Thread = require('../modals/threadModal');

async function createThread(userId) {
    const thread = await Thread.create({
        threadId: uuidv4(),  // e.g., "a3d74aca-0ce6-4521-a30b-bae0fd1bb558"
        userId
    });

    return thread;
}
```

### Saving Messages to MongoDB
```javascript
const Message = require('../modals/messageModal');

async function saveMessage(threadId, role, content, metadata = {}) {
    const message = await Message.create({
        threadId,
        role,     // 'user' | 'assistant' | 'system'
        content,
        metadata
    });

    return message;
}

// Usage in agent controller
await saveMessage(threadId, 'user', userInput);
const agentResponse = await agent.invoke(input);
await saveMessage(threadId, 'assistant', agentResponse.output, {
    toolCalls: agentResponse.toolCalls,
    usage: agentResponse.usage
});
```

### Complete Memory Service with Summarization
```javascript
// Source: https://js.langchain.com/docs/how_to/trim_messages/
const { trimMessages } = require("@langchain/core/messages");
const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, AIMessage, SystemMessage } = require("@langchain/core/messages");
const Message = require("../modals/messageModal");

class ThreadMemoryService {
    constructor(options = {}) {
        this.maxTokens = options.maxTokens || 4000;
        this.summaryModel = options.summaryModel || 'gpt-4o-mini';
        this.countingModel = options.countingModel || 'gpt-4';
    }

    async loadContext(threadId, userId) {
        // Load all messages (chronological)
        const messages = await Message.find({ threadId })
            .sort({ createdAt: 1 })
            .lean();

        if (messages.length === 0) {
            return { messages: [], summary: null };
        }

        // Convert to LangChain format
        const lcMessages = messages.map(msg => {
            const MessageClass = msg.role === 'user' ? HumanMessage : AIMessage;
            return new MessageClass(msg.content);
        });

        // Token-aware trimming
        const llm = new ChatOpenAI({ modelName: this.countingModel });
        const trimmedMessages = await trimMessages(lcMessages, {
            maxTokens: this.maxTokens,
            strategy: 'last',
            tokenCounter: llm,
            allowPartial: false
        });

        // If messages were trimmed, summarize what was cut
        let summary = null;
        if (trimmedMessages.length < lcMessages.length) {
            const cutIndex = lcMessages.length - trimmedMessages.length;
            summary = await this._summarizeOlder(lcMessages.slice(0, cutIndex));
        }

        return {
            messages: summary ? [summary, ...trimmedMessages] : trimmedMessages,
            totalMessages: lcMessages.length,
            includedMessages: trimmedMessages.length,
            summarized: summary !== null
        };
    }

    async _summarizeOlder(messages) {
        const conversationText = messages
            .map(m => `${m._getType()}: ${m.content}`)
            .join('\n\n');

        const summaryPrompt = `Summarize this conversation history concisely.
CRITICAL: Preserve all specific details including:
- Invoice numbers, amounts, dates
- Vendor/supplier names
- File names or document references
- Unresolved questions or pending actions
- Key decisions made

Keep the summary under 200 words but do NOT omit specific identifiers.

Conversation:
${conversationText}`;

        const llm = new ChatOpenAI({
            modelName: this.summaryModel,
            temperature: 0
        });

        const summary = await llm.invoke(summaryPrompt);
        return new SystemMessage(`[Previous conversation summary: ${summary.content}]`);
    }
}

module.exports = ThreadMemoryService;
```

### Thread Ownership Validation Middleware
```javascript
// utils/threadMiddleware.js
const Thread = require('../modals/threadModal');

async function validateThreadOwnership(req, res, next) {
    const { threadId } = req.body;
    const userId = req.user._id;  // From auth middleware

    if (!threadId) {
        return next();  // New thread, no validation needed
    }

    const thread = await Thread.findOne({ threadId, userId });

    if (!thread) {
        return res.status(403).json({
            error: 'Thread not found or access denied'
        });
    }

    req.thread = thread;
    next();
}

module.exports = { validateThreadOwnership };
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ConversationBufferWindowMemory | trimMessages + manual loading | LangChain v0.2+ | More flexible, better token control, works with any storage |
| Embedded message arrays | Separate message collection | MongoDB best practice | Avoids 16MB limit, better query performance |
| Message count limits | Token-based limits with tiktoken | As LLMs became mainstream | Prevents context overflow, matches API billing |
| ConversationSummaryMemory | Custom summarization with specific prompts | Ongoing refinement | Better preservation of business-critical details |

**Deprecated/outdated:**
- **ConversationBufferWindowMemory**: Still works but deprecated in favor of manual message management + trimMessages
- **Embedding messages in thread doc**: Never recommended by MongoDB, but common mistake
- **langchain-community MongoDBChatMessageHistory**: Moved to langchain-mongodb package (v0.0.25+), but has known bugs with summarization

## Open Questions

1. **How many tokens should we reserve for context vs response?**
   - What we know: Typical models have 8K-128K context windows, need tokens for both input and output
   - What's unclear: Optimal split for this use case (invoice processing with tool use)
   - Recommendation: Start with 4000 tokens for history, monitor actual usage, adjust based on average tool response sizes

2. **Should summarization be synchronous or asynchronous?**
   - What we know: Summarization adds latency to agent response
   - What's unclear: Whether users will tolerate wait time or need background processing
   - Recommendation: Start synchronous (simpler), move to async if users complain about latency (>3s response time)

3. **How to handle tool use metadata in summarization?**
   - What we know: Tool calls contain structured data (invoice lookups, etc.)
   - What's unclear: Whether to include tool call results in summary or just final AI responses
   - Recommendation: Include tool results in summary prompt — they contain business facts (invoice amounts, etc.)

4. **Should we index threadId + createdAt as compound index?**
   - What we know: Most queries are "get messages for thread, ordered by time"
   - What's unclear: Whether MongoDB's default behavior with separate indexes is sufficient
   - Recommendation: Add compound index after testing with realistic data volumes (>1000 messages/thread)

## Sources

### Primary (HIGH confidence)
- [LangChain JS trim_messages documentation](https://js.langchain.com/docs/how_to/trim_messages/) - Token-aware message trimming
- [LangChain ConversationSummaryBufferMemory API](https://v03.api.js.langchain.com/classes/langchain.memory.ConversationSummaryBufferMemory.html) - Legacy memory patterns
- [MongoDB Avoid Unbounded Arrays](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/unbounded-arrays/) - Schema anti-patterns
- [Mongoose Timestamps Documentation](https://mongoosejs.com/docs/timestamps.html) - Auto-timestamp best practices
- [UUID npm package](https://www.npmjs.com/package/uuid) - UUID v4 generation

### Secondary (MEDIUM confidence)
- [MongoDB Chat Schema Design Forum](https://www.mongodb.com/community/forums/t/advice-for-chat-schema-design/114166) - Community patterns for chat storage
- [LangChain MongoDBChatMessageHistory Issue #21610](https://github.com/langchain-ai/langchain/issues/21610) - Known bug with summarization
- [Token Counting Guide 2025](https://www.propelcode.ai/blog/token-counting-tiktoken-anthropic-gemini-guide-2025) - tiktoken usage patterns
- [MongoDB Schema Design Best Practices](https://www.mongodb.com/developer/products/mongodb/mongodb-schema-design-best-practices/) - Data modeling principles

### Tertiary (LOW confidence)
- [Medium: Implement ConversationSummaryBufferMemory](https://medium.com/@itsuki.enjoy/implement-langchain-conversationsummarybuffermemory-in-next-js-using-typescript-b956a15e4103) - Practical example but not official docs
- [Prompt Engineering for Summarization](https://www.promptingguide.ai/prompts/text-summarization) - General guidance, not LangChain-specific

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already installed, versions verified from package.json
- Architecture: HIGH - MongoDB patterns are official best practices, LangChain patterns from official docs
- Pitfalls: HIGH - Unbounded array and MongoDBChatMessageHistory bug verified from official MongoDB/GitHub sources
- Token limits: MEDIUM - Optimal values depend on usage patterns, will need tuning
- Summarization prompts: MEDIUM - Best practices exist but domain-specific tuning needed

**Research date:** 2026-02-09
**Valid until:** ~30 days (stable domain, but LangChain updates frequently — verify before Phase 2)

**Next phase dependencies:**
- Phase 2 (API Integration) will consume this data layer through controller modifications
- Memory service must be independently testable before API integration
- Thread/Message models must support atomic operations for concurrent requests
