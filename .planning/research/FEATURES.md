# Feature Landscape

**Domain:** AI Chat Conversation Threading
**Researched:** 2026-02-09
**Confidence:** MEDIUM

## Table Stakes

Features users expect. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Thread ID generation & persistence | Every AI chat (ChatGPT, Claude, etc.) automatically creates and maintains conversation threads. Users expect chats to "just work" without manual thread management. | Low | Generate UUID on first message, store in DB with user context. Backend responsibility. |
| Conversation continuation | Users expect to continue where they left off. If you ask "What's my invoice total?" then "Can you break that down?", the AI should know what "that" means. | Medium | Load last N messages (typically 10-20) from DB and include in LLM context. LangChain has built-in support via message history. |
| Context window management | Users expect the AI to remember "enough" history without infinite token costs. Standard pattern: recent messages in full + summary of older context. | Medium | Implement truncation/summarization logic. OpenAI recommends "auto" truncation or "last_messages" strategy. Store summaries to avoid regenerating. |
| New conversation action | Users need a way to start fresh when context gets muddled or switching topics. "New chat" button is ubiquitous. | Low | Frontend clears threadId from state, next message creates new thread. No backend changes needed. |
| Message persistence | Users expect their conversation history to survive refresh/logout. ChatGPT/Claude save everything. Missing this = feels broken. | Low | Store all messages (user + AI) with threadId, userId, timestamp in MongoDB. Standard CRUD pattern. |
| Automatic thread attachment | After first message, subsequent messages must auto-include threadId. Requiring users to manually pass thread IDs = terrible UX. | Low | Frontend state management: store threadId from first response, include in all subsequent requests in that session. |

## Differentiators

Features that set product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Tool use memory across thread | Agent remembers what tools were used, what data was retrieved in previous messages. "Show me that invoice again" without re-querying. | Medium | Store tool call results in thread metadata. LangChain agents support this via extended message types. Requires careful token management. |
| Intelligent summarization | Smart compression of old context that preserves key facts (invoice numbers, decisions made, action items). Better than simple truncation. | High | Use LLM to generate summaries of message chunks. Cache summaries to avoid regenerating. Adds LLM call overhead but significantly better context preservation. |
| Thread context injection | Include relevant past threads when user references old conversations. "Remember when we discussed supplier X last week?" | High | Requires RAG/vector search across all user threads. Out of scope for v1 but powerful differentiator. WebSearch shows this is where Claude/ChatGPT are heading. |
| Adaptive context window | Dynamically adjust how many messages to load based on conversation complexity/token count. | Medium | Monitor token usage, increase/decrease history window size. Prevents context degradation while managing costs. Research shows effective windows are 60-70% of claimed max. |
| Conversation branching | Allow users to edit past messages and create alternate conversation paths. Advanced feature seen in ChatGPT. | High | Requires versioning message trees, UI complexity. Anti-feature for v1 (see below) but valuable later. |
| Session persistence across devices | Continue conversation from phone, laptop, tablet. | Low-Medium | Already achievable if thread storage is server-side (it is). Just need consistent userId across devices. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Thread list/history UI in v1 | Frontend complexity, scope creep, not validated user need yet. ChatGPT waited months to add this. | Defer to v2. Focus on core threading mechanics first. Users can have one ongoing thread — that's sufficient for validation. |
| Real-time/WebSocket streaming | Adds infrastructure complexity (connection management, scaling). Current request/response works fine. Users don't expect streaming in business tools. | Stick with HTTP POST. Response might take 2-5 seconds but that's acceptable. Add streaming only if users complain about wait times. |
| Multi-user shared threads | Collaboration features add complexity: permissions, concurrent edits, notifications. Not a validated need for PDF automation use case. | Single-user threads only. Each user's conversation with AskSteve is private. If collaboration is needed later, build it separately. |
| Infinite context windows | "Just send everything to the LLM" sounds simple but: (1) expensive, (2) degrades quality (lost-in-middle problem), (3) most context is irrelevant. | Implement windowed memory: last 10-20 messages + summary. Research shows this is industry standard for good reason. |
| Automatic thread naming/titles | Seems nice ("give threads auto-generated titles like ChatGPT") but adds LLM calls, UI complexity, and users rarely care about names until they have multiple threads. | Defer. In v1, users have one active thread. When thread list UI is built (v2), add naming then. |
| Thread deletion/archival | Users might want to delete conversations but: (1) legal/compliance considerations in business context, (2) "undo delete" complexity, (3) not validated need. | Defer. Keep all threads. Add soft-delete later if requested. Data retention is actually a feature in business tools. |
| Message editing | Editing past messages creates complexity: what happens to subsequent messages? Do you re-run the conversation? Branch it? | Not in v1. If user wants to "redo" something, they start a new thread. Conversation branching is a v2+ feature. |
| Cross-thread search | "Find all conversations where I mentioned Invoice X" sounds useful but requires full-text search infrastructure, relevance ranking, UI. | Defer. Users can scroll their thread history when that UI exists. For v1, single active thread doesn't need search. |

## Feature Dependencies

```
Thread ID generation
    └──requires──> Message persistence (need threadId to save messages)
                       └──requires──> MongoDB schema for threads/messages

Conversation continuation
    └──requires──> Message persistence (load history from DB)
    └──requires──> Context window management (truncate/summarize to fit token limits)

Tool use memory
    └──requires──> Conversation continuation (need message history)
    └──enhances──> Agent utility (better answers with remembered context)

Intelligent summarization
    └──requires──> Context window management (summarize what doesn't fit in window)
    └──conflicts with──> Infinite context (mutual exclusion - either truncate or don't)

Session persistence
    └──requires──> Server-side thread storage (already planned via MongoDB)
    └──requires──> Authentication (userId to scope threads)
```

### Dependency Notes

- **Thread ID generation → Message persistence:** Can't save messages without knowing which thread they belong to. ThreadId is the foreign key.
- **Conversation continuation → Context window management:** Can't just load all history — must implement windowing or costs explode. Research shows context degradation beyond 60-70% of window.
- **Tool use memory → Conversation continuation:** Requires message history to be loaded. Extension of core memory feature.
- **Intelligent summarization conflicts with infinite context:** These are mutually exclusive approaches. Pick one. Research strongly recommends summarization.

## MVP Recommendation

### Launch With (v1)

Prioritize:
1. **Thread ID generation & persistence** — Core infrastructure. Without this, nothing else works.
2. **Message persistence** — Store all messages under threadId. Table stakes for any threading system.
3. **Conversation continuation** — Load last N messages as context. This is the whole point of threading.
4. **Context window management** — Last 10-20 messages in full. Simple truncation (no summarization yet). Prevents runaway costs.
5. **New conversation action** — Frontend clears threadId. Users need an "escape hatch" when context gets confused.
6. **Automatic thread attachment** — Frontend tracks threadId, includes it automatically. Critical for UX.

**Rationale:** These six features are the minimum viable conversation threading system. Everything else is enhancement or future. This matches the PROJECT.md scope exactly.

### Add After Validation (v1.x)

- **Intelligent summarization** — Once basic threading is working and users are hitting context limits. Trigger: Users report AI "forgetting" important info from earlier in thread.
- **Tool use memory** — When users ask "show me that invoice again" and AI can't. Trigger: Support requests about having to repeat queries.
- **Adaptive context window** — When cost analysis shows we're wasting tokens or hitting limits. Trigger: Monthly bill review or performance monitoring.

### Future Consideration (v2+)

- **Thread list/history UI** — When users have multiple threads and need to find old ones. Trigger: User feedback requesting "I want to see my past conversations."
- **Thread context injection** — When users reference old threads. Requires RAG infrastructure. Trigger: Feature request or competitive pressure.
- **Conversation branching** — When users want to explore "what if" scenarios. Advanced feature. Trigger: Power users requesting it explicitly.
- **Session persistence across devices** — Already technically possible but needs device identity. Trigger: Users reporting "I can't continue my conversation from my phone."

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Thread ID generation | HIGH | LOW | P1 |
| Message persistence | HIGH | LOW | P1 |
| Conversation continuation | HIGH | MEDIUM | P1 |
| Context window management | HIGH | MEDIUM | P1 |
| New conversation action | HIGH | LOW | P1 |
| Automatic thread attachment | HIGH | LOW | P1 |
| Intelligent summarization | MEDIUM | HIGH | P2 |
| Tool use memory | MEDIUM | MEDIUM | P2 |
| Adaptive context window | MEDIUM | MEDIUM | P2 |
| Thread list/history UI | MEDIUM | HIGH | P3 |
| Thread context injection | LOW | HIGH | P3 |
| Conversation branching | LOW | HIGH | P3 |
| Session persistence (devices) | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch (MVP features)
- P2: Should have, add when cost/quality issues appear
- P3: Nice to have, defer until validated user need

## Competitor Feature Analysis

| Feature | ChatGPT | Claude | AskSteve (planned) |
|---------|---------|--------|-------------------|
| Thread persistence | Yes, automatic | Yes, automatic | Yes, automatic (P1) |
| Context continuation | Yes, full history | Yes, with RAG | Yes, windowed (P1) |
| New conversation | Yes, "New chat" button | Yes, "New conversation" | Yes, clear threadId (P1) |
| Thread list UI | Yes, sidebar | Yes, sidebar | No (deferred to v2) |
| Thread naming | Yes, auto-generated | Yes, auto-generated | No (deferred) |
| Message editing | Yes, with branching | No | No (deferred) |
| Cross-thread search | Yes, search bar | Yes, with RAG | No (deferred) |
| Conversation branching | Yes | No | No (deferred) |
| Real-time streaming | Yes, token-by-token | Yes, token-by-token | No (HTTP POST sufficient) |
| Multi-user threads | No | No | No (not planned) |

**Our Approach:** Ship the core mechanics (persistence, continuation, windowing) without the UI/UX polish. ChatGPT and Claude took months to add features like thread lists and auto-naming. We validate the core value first, add polish later based on user feedback.

## Implementation Notes

### Thread ID Format
- Use UUID v4 for thread IDs (128-bit, globally unique, no collision risk)
- Example: `550e8400-e29b-41d4-a716-446655440000`
- Store as string in MongoDB (indexed for fast lookup)

### Context Window Sizing
- Research shows effective context is 60-70% of claimed maximum
- For GPT-4 (8K context): safe working limit is ~5K tokens
- Recommendation: Last 10-20 messages in full (~2-4K tokens) + 500-token summary of older messages
- Monitor actual token usage and adjust

### Message Storage Schema
```
Thread {
  threadId: String (UUID, indexed)
  userId: String (indexed, for auth)
  createdAt: Date
  updatedAt: Date
  metadata: {
    messageCount: Number
    lastMessageAt: Date
    summaryGenerated: Boolean
  }
}

Message {
  messageId: String (UUID)
  threadId: String (foreign key to Thread)
  userId: String (redundant but useful for queries)
  role: String ('user' | 'assistant' | 'system')
  content: String
  timestamp: Date
  metadata: {
    toolCalls: Array (if agent used tools)
    tokenCount: Number
    model: String
  }
}
```

### LangChain Integration
- Use `RunnableWithMessageHistory` for conversation memory
- Store messages as `HumanMessage` / `AIMessage` objects
- LangChain automatically handles message formatting for LLM
- Documentation: https://python.langchain.com/docs/versions/migrating_memory/

### Frontend State Management
```javascript
// On component mount: threadId = null
// On first message send: receive { threadId, response }
// Store threadId in component state
// On subsequent messages: include threadId in POST body
// On "New conversation" click: threadId = null
```

## Research Confidence Assessment

| Aspect | Confidence | Source |
|--------|------------|--------|
| Table stakes features | HIGH | Multiple sources show ChatGPT, Claude, OpenAI Threads API all implement identical core patterns. Industry convergence. |
| Context window management | HIGH | Official OpenAI docs + multiple technical articles confirm windowing + summarization is standard. Token limits are real constraint. |
| Anti-features (what to avoid) | MEDIUM | Based on ChatGPT/Claude evolution timeline (they shipped core first, added UI later). WebSearch findings + common sense. |
| LangChain integration patterns | MEDIUM | Official LangChain docs confirm patterns but migration guide shows they're deprecating old approaches. Verify latest APIs. |
| MongoDB schema | MEDIUM | Standard relational data model. No threading-specific MongoDB research, just applying best practices. |
| Differentiators | LOW | Speculative features based on industry trends (RAG for cross-thread search, adaptive windows). Not validated with users. |

## Gaps to Address

**Areas where research was inconclusive:**
- Optimal number of messages in context window (10? 20? 50?). Research says "depends on use case" but doesn't give specifics for business/invoice domain.
- Summarization quality: Do LLM-generated summaries actually preserve important invoice numbers, supplier names, etc.? Or do they lose critical details?
- Thread timeout: Should threads auto-expire after N days? Or keep forever? No consensus in research.

**Topics needing phase-specific research later:**
- When thread list UI is built: pagination patterns, infinite scroll vs load more, search implementation
- When intelligent summarization is added: best prompt for summary generation, chunk size for summarization, caching strategy
- When adaptive windows are implemented: metrics to monitor (latency? token cost? quality?), thresholds for adjusting window size

## Sources

**Official Documentation (HIGH confidence):**
- [OpenAI Threads API Reference](https://platform.openai.com/docs/api-reference/threads) — Official thread architecture patterns
- [LangChain Short-term Memory Docs](https://docs.langchain.com/oss/python/langchain/short-term-memory) — Thread-based conversation memory
- [Microsoft Agent Framework Multi-Turn Conversations](https://learn.microsoft.com/en-us/agent-framework/user-guide/agents/multi-turn-conversation) — Thread concepts and patterns
- [OpenAI Context Engineering Session Memory](https://cookbook.openai.com/examples/agents_sdk/session_memory) — Context window management strategies

**Technical Implementation Guides (MEDIUM confidence):**
- [A Practical Guide to the OpenAI Threads API](https://www.eesel.ai/blog/openai-threads-api) — Thread implementation patterns
- [LangChain Memory Tutorial 2026](https://langchain-tutorials.github.io/langchain-memory-tutorial-2026/) — Migration from old ConversationBufferMemory
- [Building Memory into AI Chat Applications](https://getstream.io/blog/ai-chat-memory/) — Message threading with parent_id
- [Session Management for AI Conversation Apps Guide](https://medium.com/@aslam.develop912/master-session-management-for-ai-apps-a-practical-guide-with-backend-frontend-code-examples-cb36c676ea77) — Session persistence patterns

**Context Window Research (HIGH confidence):**
- [Context Window Management Strategies (Maxim AI)](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) — Hierarchical summarization, selective injection
- [Context Length Comparison: AI Models 2026 (Elvex)](https://www.elvex.com/blog/context-length-comparison-ai-models-2026) — Effective vs claimed context windows
- [Context Window Management Strategies (APXML)](https://apxml.com/courses/langchain-production-llm/chapter-3-advanced-memory-management/context-window-management) — Production patterns

**Product/UX Research (MEDIUM confidence):**
- [Navigating the Chat Thread UI: A User-Centric Approach](https://www.oreateai.com/blog/navigating-the-chat-thread-ui-a-usercentric-approach/8bf38222a01e623d75fe8ee6d54c5424) — Thread UI patterns
- [Comparing Conversational AI Tool User Interfaces 2025](https://intuitionlabs.ai/articles/conversational-ai-ui-comparison-2025) — Feature comparison across products
- [Rethinking How We Manage AI Conversations (Medium)](https://medium.com/@MyDigitalMusings/rethinking-how-we-manage-ai-conversations-a756ba220842) — Thread management best practices

**Common Mistakes (MEDIUM confidence):**
- [Best Practices for AI Agent Implementations 2026](https://onereach.ai/blog/best-practices-for-ai-agent-implementations/) — Testing, evaluation, memory design pitfalls
- [Common AI Agent Development Mistakes](https://www.wildnetedge.com/blogs/common-ai-agent-development-mistakes-and-how-to-avoid-them) — Integration issues, insufficient training
- [Why AI Agent Pilots Fail in Production (Composio)](https://composio.dev/blog/why-ai-agent-pilots-fail-2026-integration-roadmap) — Data pipeline failures, governance

**Memory Implementation Examples (MEDIUM confidence):**
- [Claude's Memory Implementation](https://simonwillison.net/2025/Sep/12/claude-memory/) — RAG-based conversation search vs ChatGPT's approach
- [Using Claude's Chat Search and Memory](https://support.claude.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context) — Cross-conversation context
- [Building Persistent Conversational AI Chatbot with Temporal](https://temporal.io/blog/building-a-persistent-conversational-ai-chatbot-with-temporal) — Stateless, scalable architecture

**Infrastructure (MEDIUM confidence):**
- [Building Real-Time AI Chat: Infrastructure for WebSockets, LLM Streaming, and Session Management](https://render.com/articles/real-time-ai-chat-websockets-infrastructure) — Real-time architecture (relevant for anti-features)
- [AI Chat With Long History](https://www.jenova.ai/en/resources/ai-chat-with-long-history) — Persistent memory across sessions
- [Build Smarter AI Agents: Redis Memory Management](https://redis.io/blog/build-smarter-ai-agents-manage-short-term-and-long-term-memory-with-redis/) — In-memory caching for recent history

---
*Feature research for: AI Chat Conversation Threading (AskSteve)*
*Researched: 2026-02-09*
