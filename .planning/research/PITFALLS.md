# Pitfalls Research

**Domain:** LangChain Conversation Threading & Memory Management
**Researched:** 2026-02-09
**Confidence:** MEDIUM

## Critical Pitfalls

### Pitfall 1: Unbounded Conversation Buffer Growth

**What goes wrong:**
ConversationBufferMemory stores the entire conversation history in memory without any processing or limits. After 100 interactions, memory usage can exceed 50MB for text-heavy conversations. In production with business users processing invoices (who may have extended sessions), the buffer grows linearly with each message, eventually causing crashes or context window overflow.

**Why it happens:**
Developers choose ConversationBufferMemory for simplicity during initial implementation, assuming they'll "add limits later." The issue only surfaces after deployment when real users have long sessions. Additionally, invoice processing conversations can be lengthy (clarifications, corrections, multi-document batches), making unbounded growth worse than typical chat scenarios.

**How to avoid:**
- Use ConversationBufferWindowMemory with explicit k parameter (last N messages)
- Implement ConversationSummaryBufferMemory (summarizes old messages, keeps recent ones raw)
- Add explicit memory.clear() calls when starting new invoice/task contexts
- Set hard limits: max_messages_per_thread or max_tokens_per_thread
- For MongoDB persistence: implement TTL indexes on message collections

**Warning signs:**
- Memory usage increases linearly over time in production
- Longer user sessions cause slower responses
- Token limit exceeded errors appearing sporadically
- MongoDB message collections growing unbounded (check collection stats)
- Response time degradation correlating with thread message count

**Phase to address:**
Phase 1 (Thread Storage Foundation) - Set hard limits from the start. Implement windowed memory or summary buffer, NOT plain buffer memory.

---

### Pitfall 2: Summary Memory Cascade Errors

**What goes wrong:**
ConversationSummaryMemory calls an LLM to summarize conversation history at every step. Small summarization errors compound over time. Critical invoice details (amounts, dates, vendor names, line items) get omitted or corrupted in summaries. When users ask "what was the total for ABC Corp last week?", the summarized context no longer contains that information, causing hallucinations or "I don't recall" responses. Additionally, the LLM cost of summarization at every turn can exceed the cost of the actual user queries.

**Why it happens:**
LLMs are not perfect at summarization. They suffer from "attention middle blindness" - paying most attention to the first and last parts of context, often skipping middle content. Progressive summarization builds up small errors until final output completely misses the point. For structured invoice data, this is catastrophic - losing "$1,234.56" vs "$1,234" matters.

**How to avoid:**
- Use hybrid approach: ConversationSummaryBufferMemory (summary for old, raw for recent)
- Keep critical structured data (invoice amounts, IDs, dates) in separate state, NOT in summarized conversation
- Implement fact extraction before summarization: pull out key entities/numbers into metadata
- Test summarization quality: assert critical data survives N rounds of summarization
- Consider NOT summarizing at all if using windowed memory (last 10-20 messages) + proper context
- Monitor LLM costs: if summarization costs > 30% of total, you're over-summarizing

**Warning signs:**
- Users report agent "forgetting" previously stated invoice amounts or details
- Increasing hallucinations in responses about prior conversation context
- LLM costs spike unexpectedly (summarization adding hidden costs)
- Agent gives different answers to same question asked at different points in thread
- Test showing summary of 50-message thread loses critical facts

**Phase to address:**
Phase 2 (Windowed Memory) - If implementing summarization, include fact extraction and validation. Otherwise, prefer windowed approach for invoice domain where precision matters.

---

### Pitfall 3: Race Conditions in Concurrent Thread Access

**What goes wrong:**
When multiple requests for the same thread_id arrive simultaneously (user double-clicks submit, multiple browser tabs, or rapid messages), MongoDB read-modify-write operations interleave incorrectly. Messages get lost, duplicated, or arrive out of order. Tool responses become mismatched with tool calls. For invoice processing, this means extracted data gets associated with wrong documents or invoices get processed twice.

**Why it happens:**
MongoDB is not ACID-transactional by default across multiple operations. The pattern `messages = fetch(thread_id) → messages.append(new_msg) → save(thread_id, messages)` has a race window. LangChain's basic message history implementations don't include locking. Concurrent users are assumed but not properly handled. React frontends can send duplicate requests if not debounced.

**How to avoid:**
- Use MongoDB transactions for read-modify-write on message history
- Implement optimistic locking: store version number, fail if version changed
- Use atomic MongoDB operations: `$push` instead of fetch-modify-update
- Add request deduplication: idempotency keys on message submissions
- Implement in-memory or Redis-based locks per thread_id for write operations
- Frontend: debounce message submissions, disable button during processing
- LangGraph checkpoint system provides better concurrency handling than raw MongoDBChatMessageHistory

**Warning signs:**
- Intermittent duplicate messages appearing in conversation history
- Tool responses appearing before tool calls in message sequence
- "Lost messages" reports from users (sent but not in history)
- MongoDB write conflicts or version errors in logs
- Inconsistent state when viewing same thread from multiple clients simultaneously

**Phase to address:**
Phase 1 (Thread Storage Foundation) - Use atomic MongoDB operations from day one. Phase 3 (Production Hardening) - Add distributed locking if high concurrency expected.

---

### Pitfall 4: Thread ID Management Chaos

**What goes wrong:**
Developers implement multiple inconsistent patterns for thread ID generation and scoping. Some requests use session_id, others thread_id, others conversation_id. Thread IDs leak across users (security issue). The stateless-to-stateful migration breaks because existing API doesn't have thread_id parameter, so it gets auto-generated differently on each call, preventing actual statefulness.

**Why it happens:**
LangChain documentation uses session_id in examples but RunnableWithMessageHistory expects it in config.configurable, leading to confusion. The backend generates UUIDs as thread IDs but frontend doesn't persist them across page refreshes. Mobile app uses different ID scheme than web. User authentication IDs get conflated with conversation thread IDs.

**How to avoid:**
- Single source of truth: use thread_id consistently everywhere (backend, frontend, database)
- Clear ownership: "Who generates thread IDs?" Answer: Client (frontend) should generate and persist on first message, OR backend generates and returns in response for client to store
- API design: Make thread_id optional for backward compat, but if absent, create NEW thread every time (stateless mode), else use provided ID (stateful mode)
- Format: Use UUIDs (v4) prefixed with "thread_" for easy identification: "thread_f47ac10b-58cc-4372-a567-0e02b2c3d479"
- Validation: Reject thread IDs belonging to different user_id (security)
- Metadata propagation: Include thread_id in LangChain config metadata for entire trace

**Warning signs:**
- New thread created on every message despite sending thread_id
- User A can access User B's threads (CRITICAL security bug)
- Frontend console shows "undefined thread_id" errors
- Database has orphaned threads (no messages, never used again)
- Observability tools (LangSmith, Langfuse) show fragmented traces instead of continuous threads
- Thread IDs have inconsistent formats (some UUIDs, some integers, some null)

**Phase to address:**
Phase 1 (Thread Storage Foundation) - Define thread ID scheme, generation responsibility, and validation. Document it clearly.

---

### Pitfall 5: Backward Compatibility Breaking Changes

**What goes wrong:**
Adding mandatory thread_id parameter breaks all existing API clients. Stateless agents that worked before now fail with "missing thread_id" errors. Users with bookmarked API calls or scripts get 400 errors. Mobile app version mismatch causes crashes. The migration is all-or-nothing instead of gradual.

**Why it happens:**
Developers add new parameters as required instead of optional. The urge to "force everyone to new stateful mode" overrides backward compatibility concerns. No versioning strategy (v1 vs v2 endpoints). Testing only covers new stateful path, not mixed stateless/stateful scenarios.

**How to avoid:**
- Make thread_id OPTIONAL in API
- Behavior: if thread_id provided → stateful mode (retrieve history), if absent → stateless mode (no history, just respond)
- Alternatively: separate endpoints `/chat` (stateless) vs `/chat/threads/:thread_id/messages` (stateful)
- Version headers: Accept api-version: 2025-02-09 to opt into new behavior
- Response headers: Return x-thread-id even in stateless mode (ephemeral, not persisted) so clients can upgrade gracefully
- Deployment: run both modes in parallel, slowly deprecate stateless over months, not hours
- Documentation: clear migration guide with code examples for both modes

**Warning signs:**
- Existing integrations fail immediately after deployment
- Support tickets spike with "API broken" reports
- curl examples in old docs no longer work
- Third-party integrations (Zapier, Make.com) break
- Error rates jump 50%+ on deployment
- No gradual rollout - binary working/broken state

**Phase to address:**
Phase 1 (Thread Storage Foundation) - Design API with optional thread_id from start. Phase 4 (Backward Compatibility Layer) - Implement and test both modes.

---

### Pitfall 6: Token Limit Miscalculation

**What goes wrong:**
Developers count messages (e.g., "keep last 10 messages") instead of tokens. Invoice processing messages are token-heavy: extracted JSON with 50+ line items can be 2000+ tokens in a single message. 10 messages × 2000 tokens = 20,000 tokens, exceeding many model context limits. The agent fails mid-conversation with cryptic "context_length_exceeded" errors. Summarization is triggered but happens too late (already exceeded limit).

**Why it happens:**
Message count is easier to reason about than tokens. LangChain's ConversationBufferWindowMemory uses message count (k parameter), not token count. Developers test with short messages ("Hello", "How are you?") but production has long structured data. Token counting libraries give different results than LLM actual usage. System prompts, tool definitions, and retrieval context consume tokens but aren't accounted for in "conversation memory" calculations.

**How to avoid:**
- Use ConversationTokenBufferMemory (token-based limit) not ConversationBufferWindowMemory (message-based)
- Calculate total budget: model_limit - system_prompt_tokens - tool_definitions_tokens - retrieval_buffer - safety_margin
- For GPT-4: 8k context → reserve 2k for prompt/tools, 1k for response, 1k safety = 4k for conversation history max
- Count tokens server-side using tiktoken (OpenAI) or model-specific tokenizer
- Implement early warning: if history > 75% of limit, trigger summarization or pruning
- Log actual token usage per request in production to tune limits empirically
- Don't trust client-side token counting (use server-side)

**Warning signs:**
- Sporadic "context_length_exceeded" errors in production logs
- Errors correlate with invoice-heavy conversations (lots of extracted data)
- Errors appear mid-conversation, not at start
- Token count in error message significantly exceeds expected based on message count
- Model API returns 400 errors inconsistently

**Phase to address:**
Phase 2 (Windowed Memory) - Implement token-based limits with proper calculation. Phase 3 (Production Hardening) - Add monitoring and auto-pruning.

---

### Pitfall 7: MongoDB Schema Evolution Nightmares

**What goes wrong:**
Initial implementation stores messages as simple array: `{thread_id: "123", messages: [...]}`. Later, need to add metadata (user_id, timestamp, source), but existing threads have no migration path. Queries become impossible: "show all threads for user_id X" requires full collection scan because user_id isn't indexed. Adding user_id retroactively to millions of threads is slow and risky. Schema changes require application downtime.

**Why it happens:**
Initial design focuses on "make it work" not "make it scalable." MongoDB's schemaless nature creates false confidence that schema can evolve easily. No migration strategy from day one. Not thinking about queries beyond simple thread_id lookup. Not considering access patterns: filter by user, by date range, by status.

**How to avoid:**
- Design schema upfront for known access patterns:
  ```json
  {
    "thread_id": "thread_abc123",
    "user_id": "user_xyz",
    "created_at": ISODate("2025-02-09T10:00:00Z"),
    "updated_at": ISODate("2025-02-09T10:05:00Z"),
    "status": "active",
    "metadata": {
      "invoice_count": 5,
      "total_messages": 23
    },
    "messages": [
      {
        "message_id": "msg_001",
        "role": "user",
        "content": "...",
        "timestamp": ISODate("..."),
        "token_count": 45
      }
    ]
  }
  ```
- Create indexes BEFORE launch: `{user_id: 1, created_at: -1}`, `{thread_id: 1}` (unique)
- Implement message size limits: if messages array > 100 items, paginate or archive old messages
- Consider separate collections: threads (metadata) + messages (actual content with thread_id foreign key)
- Use MongoDB schema versioning: `schema_version: 1` field for migration tracking
- Plan for TTL: `{created_at: 1}` with TTL for auto-cleanup of old threads (e.g., 90 days)

**Warning signs:**
- Queries taking > 1 second that should be instant (missing indexes)
- "Need to add user_id to existing threads" but no clear path
- Can't answer basic analytics: "How many active threads per user?"
- MongoDB document size exceeding 16MB limit (unlikely but possible for very long threads)
- Collection scans in MongoDB profiler/explain output
- Schema changes require "pause the app, migrate, resume" instead of rolling changes

**Phase to address:**
Phase 1 (Thread Storage Foundation) - Design proper schema with metadata and indexes from day one. Include migration strategy.

---

### Pitfall 8: Ignoring LangChain's Deprecation Path

**What goes wrong:**
Implementation uses ConversationBufferMemory and ConversationSummaryMemory, which are deprecated since LangChain 0.3.1. The code works initially but breaks on framework updates. Migration guides assume LangGraph usage, but codebase doesn't use LangGraph, causing confusion. Security patches or bug fixes require upgrading LangChain, which forces rewriting memory layer mid-project.

**Why it happens:**
Online tutorials and StackOverflow answers are outdated (from 2023-2024) and still reference deprecated classes. LangChain's documentation has migration guides but they're buried. Developers copy-paste working code without checking deprecation warnings. Python deprecation warnings are suppressed in production logs.

**How to avoid:**
- Check LangChain's current recommended approach: RunnableWithMessageHistory + LangGraph persistence (as of 2025+)
- Use LangChain's built-in SummarizationMiddleware for agents instead of ConversationSummaryMemory
- If using ConversationBufferMemory: migrate to RunnableWithMessageHistory with MongoDB-backed history factory
- Review LangChain migration guides: https://python.langchain.com/docs/versions/migrating_memory/
- Pin LangChain version initially (e.g., langchain==0.3.x) to avoid surprise breakage, but plan migration path
- Enable deprecation warnings in development: `python -W default::DeprecationWarning`
- Allocate time in roadmap for framework migration (treat as tech debt paydown)

**Warning signs:**
- DeprecationWarning flooding logs after LangChain update
- "This method is deprecated, use X instead" but X doesn't exist or isn't documented
- Migration guide references LangGraph but codebase uses pure LangChain
- Community support dries up for old memory classes
- New LangChain features incompatible with deprecated memory layer

**Phase to address:**
Phase 1 (Thread Storage Foundation) - Use current best practices (RunnableWithMessageHistory) not deprecated classes. Phase 3 (Production Hardening) - Ensure version pinning and update strategy.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use ConversationBufferMemory without limits | Fast to implement, works in demo | Production crashes from unbounded growth, memory leaks | Never - always set limits |
| Store all messages in single MongoDB document | Simple schema, no joins needed | 16MB document limit, slow queries, schema evolution pain | Only if guaranteed < 100 messages/thread |
| Client-generated thread IDs without validation | No round-trip latency, works offline | Security risk (ID collisions, access other users' threads) | Only for single-user desktop apps |
| Ignore token counting, use message count | Easier to implement and understand | Context limit exceeded errors in production | Never for invoice/structured data domains |
| In-memory message history during development | No database setup needed, instant feedback | Complete rewrite needed for production, testing not realistic | Acceptable for initial prototyping (< 1 week) |
| Hardcode LangChain memory class instead of configurable | Fewer abstractions, simpler code | Can't A/B test memory strategies, hard to upgrade | Never - use factory pattern from start |
| Skip MongoDB indexes "until we have data" | Faster initial development | Catastrophic performance issues after launch, can't add indexes on large collections without downtime | Never - indexes are cheap upfront |
| Thread IDs default to user session ID | One less ID to manage | User can't have multiple conversations, mobile app breaks (sessions die) | Only for strictly single-conversation-per-user apps |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MongoDB | Using fetch-modify-save pattern for messages instead of atomic $push | Use `collection.update_one({"thread_id": tid}, {"$push": {"messages": msg}})` for atomicity |
| LangChain RunnableWithMessageHistory | Forgetting to pass session_id in config.configurable | Always invoke with `config={"configurable": {"session_id": thread_id}}` |
| LangChain + MongoDB | Creating new MongoClient on every message | Use connection pooling: create client once, reuse across requests |
| Express.js + async handlers | Not handling async errors in message history fetch | Use express-async-errors or wrap all async routes in try-catch |
| React frontend | Generating new thread_id on every component render | Store thread_id in component state/localStorage, persist across renders |
| MongoDB TTL indexes | Setting TTL on wrong field (e.g., updated_at instead of created_at) | TTL should be on created_at for "delete threads older than X days" |
| LangSmith/Langfuse tracing | Not propagating thread_id to child runs | Include thread_id in config metadata: `config={"metadata": {"session_id": tid}}` |
| OpenAI API + long threads | Not catching specific "context_length_exceeded" error | Check error.code === 'context_length_exceeded', trigger pruning/summarization |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading entire thread history on every message | Response time increases with thread length | Implement pagination: load last N messages, load more on demand | > 50 messages/thread or > 100 threads/user |
| No MongoDB indexes on user_id or created_at | Queries slow down as threads collection grows | Create compound index: `{user_id: 1, created_at: -1}` | > 10,000 threads total |
| Synchronous LLM calls for summarization | Summarization blocks user message, causing UI freezes | Async/background summarization: user message returns immediately, summary happens in background job | Always - never block user on summarization |
| Storing base64-encoded PDFs in message content | MongoDB doc size explodes, queries slow | Store files in GridFS or S3, store only references in messages | Any PDF > 1MB or > 10 PDFs/thread |
| Full collection scans for "list user's threads" | Acceptable latency at 100 threads, slow at 10,000+ | Index on user_id + pagination with limit/skip | > 1,000 threads per user |
| Not implementing message history trimming | First 100 threads work fine, then sudden failures | Auto-trim: archive messages older than N days or when thread > M messages | > 500 messages/thread or > 10GB total collection size |
| Using ConversationSummaryMemory without caching | Every message triggers full conversation summarization | Cache summaries in MongoDB, only re-summarize on new messages | > 20 messages/thread (summarization cost > query cost) |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not validating thread_id ownership | User A can access User B's invoice conversations by guessing thread IDs | Always verify `thread.user_id === authenticated_user_id` before queries |
| Storing PII in summarized conversation | GDPR violation: summaries retained after message deletion | Scrub PII before summarization OR don't summarize at all, use windowed memory |
| Thread IDs sequential/predictable (thread_1, thread_2) | Enumeration attacks: iterate IDs to access all threads | Use UUIDv4 for thread IDs: cryptographically random, non-enumerable |
| No rate limiting on thread creation | User creates millions of threads, DoS attack | Rate limit: max 10 new threads/hour per user, max 100 active threads/user |
| Logging full message history (including extracted invoice data) | Sensitive financial data leaked to logs, compliance violation | Log only metadata (thread_id, message_count, timestamp), never content |
| No expiration on threads | Indefinite retention violates data minimization | Implement TTL: auto-delete threads after 90 days (or per compliance requirement) |
| Thread metadata leaking via error messages | Error: "Thread thread_abc123 belongs to user john@example.com" reveals others' data | Generic errors: "Thread not found" instead of "Access denied" (avoid info disclosure) |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent thread creation | User doesn't know a new conversation started, expects continuation | UI feedback: "Started new conversation" banner or thread switcher |
| No thread list/history UI | User processes 5 invoices, can't find "that conversation from Tuesday" | Implement thread list: show recent threads with preview, search, date |
| Thread continues forever | 200-message thread is overwhelming, user can't find relevant parts | Auto-suggest new thread: "Start fresh conversation?" after 50 messages or 1 hour |
| No loading state while fetching history | User clicks on old thread, sees blank screen for 2-3 seconds, assumes broken | Show skeleton loader while fetching: "Loading conversation history..." |
| Context switches without warning | Agent forgets previous context when memory window shifts, user confused | Notify user: "Earlier messages archived" or show scrollback to load older |
| No way to clear/reset thread | User wants fresh start but stuck in long confused thread | Provide "Start new conversation" button prominently in UI |
| Thread previews show raw JSON | Thread list shows: `{"invoice_id": "INV-001", "amount": 1234}` | Extract human-readable preview: "Invoice INV-001 for $1,234.00" |
| No indication of thread state | User doesn't know if thread is still active, completed, or errored | Show status badge: "Active", "Completed", "Error - retry?" |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Thread Storage:** Often missing user_id field — verify every thread document includes owner for security
- [ ] **MongoDB Indexes:** Often missing compound index on (user_id, created_at) — verify explain() shows index usage, not COLLSCAN
- [ ] **Token Limits:** Often missing system prompt token accounting — verify limit = model_max - system - tools - safety, not just model_max
- [ ] **Backward Compatibility:** Often missing stateless mode handling — verify API works with AND without thread_id parameter
- [ ] **Race Conditions:** Often missing atomic operations for message append — verify using $push not fetch-modify-save
- [ ] **Error Handling:** Often missing specific context_length_exceeded handling — verify catching and handling this error explicitly
- [ ] **Memory Cleanup:** Often missing thread expiration/archival — verify TTL index exists or cron job for cleanup
- [ ] **Thread Ownership Validation:** Often missing authorization check — verify every thread query filters by authenticated user
- [ ] **Frontend Thread Persistence:** Often missing localStorage/sessionStorage — verify thread_id survives page refresh
- [ ] **Observability:** Often missing thread_id in logs/traces — verify LangSmith/Langfuse groups messages by thread correctly
- [ ] **Message Pagination:** Often missing UI for loading older messages — verify users can access full thread history, not just recent
- [ ] **Schema Migrations:** Often missing version field and migration plan — verify schema_version field exists, upgrade path documented

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Unbounded buffer growth | MEDIUM | 1. Deploy message limit hotfix 2. Identify threads > 1000 messages 3. Batch-summarize or archive old messages 4. Monitor memory usage drop |
| Summary cascade errors | HIGH | 1. Disable summarization 2. Switch to windowed memory 3. Rebuild affected threads from raw messages 4. Implement fact extraction if re-enabling summary |
| Race conditions | LOW-MEDIUM | 1. Add optimistic locking (version field) 2. Retry logic on conflict 3. Audit affected threads for duplicates/gaps 4. Manual dedup if needed |
| Thread ID chaos | HIGH | 1. Audit: map all ID schemes in use 2. Pick canonical scheme 3. Create migration: old_id → new_id mapping 4. Dual-write period 5. Cutover |
| Breaking backward compat | MEDIUM | 1. Hotfix: make param optional 2. Version both APIs (v1 stateless, v2 stateful) 3. Communicate migration timeline 4. Monitor adoption |
| Token limit exceeded | LOW | 1. Implement emergency pruning: keep only last 5 messages on error 2. Add proper token counting 3. Backfill token_count field 4. Set correct limits |
| Bad MongoDB schema | HIGH | 1. Design target schema 2. Write migration script (add user_id, indexes) 3. Test on staging copy 4. Migrate in batches (1000 docs/batch) 5. Validate |
| Using deprecated LangChain classes | MEDIUM | 1. Pin current LangChain version 2. Allocate sprint for migration 3. Follow official migration guide 4. Test thoroughly 5. Upgrade in stages |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Unbounded buffer growth | Phase 2 (Windowed Memory) | Load test: run 500-message thread, verify memory stable, no crashes |
| Summary cascade errors | Phase 2 (Windowed Memory) | Test: 50-message thread with invoice data, verify key facts in final summary |
| Race conditions | Phase 1 (Thread Storage) + Phase 3 (Production Hardening) | Concurrent test: 10 simultaneous messages to same thread, verify all saved correctly |
| Thread ID chaos | Phase 1 (Thread Storage) | Code review: grep for session_id, thread_id, conversation_id - should be single pattern |
| Breaking backward compat | Phase 4 (Backward Compatibility) | Integration test: old API calls (no thread_id) still work, new calls use thread_id |
| Token limit exceeded | Phase 2 (Windowed Memory) | Test: send invoice with 3000 tokens, verify limit calculation prevents overflow |
| Bad MongoDB schema | Phase 1 (Thread Storage) | Migration test: add user_id to 1M threads in < 1 hour without downtime |
| Deprecated LangChain classes | Phase 1 (Thread Storage) | Dependency audit: no DeprecationWarnings, using RunnableWithMessageHistory |

---

## Sources

**LangChain Memory:**
- [LangChain Short-term Memory Docs](https://docs.langchain.com/oss/python/langchain/short-term-memory)
- [Conversational Memory for LLMs with Langchain | Pinecone](https://www.pinecone.io/learn/series/langchain/langchain-conversational-memory/)
- [How to Fix Memory Problems in LangChain | Medium](https://medium.com/@hadiyolworld007/how-to-fix-memory-problems-in-langchain-yes-chat-history-too-610e04dcfa69)
- [Common LangChain Memory Leaks and How to Fix Them | Markaicode](https://markaicode.com/langchain-memory-leaks-fix/)

**Token Management:**
- [LangChain Token Limitation Handling Strategies | Medium](https://medium.com/@techie_chandan/langchain-token-limitation-handling-strategies-1056db9e11d6)
- [Context Window Management Strategies](https://apxml.com/courses/langchain-production-llm/chapter-3-advanced-memory-management/context-window-management)
- [Top Techniques to Manage Context Lengths in LLMs](https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms)

**Conversation Summarization:**
- [Stop LLM Summarization From Failing Users | Galileo](https://galileo.ai/blog/llm-summarization-production-guide)
- [Why LLMs Fail in Multi-Turn Conversations | PromptHub](https://www.prompthub.us/blog/why-llms-fail-in-multi-turn-conversations-and-how-to-fix-it)
- [LLM Chat History Summarization Guide 2025](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)
- [How Long Contexts Fail](https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html)

**LangChain Agents & Threading:**
- [How to Manage Conversation History in a ReAct Agent](https://langchain-ai.github.io/langgraph/how-tos/create-react-agent-manage-message-history/)
- [Handle High Concurrency in LangChain Apps](https://apxml.com/courses/langchain-production-llm/chapter-6-optimizing-scaling-langchain/handling-high-concurrency)

**MongoDB Integration:**
- [MongoDB Chat Message History | LangChain](https://python.langchain.com/docs/integrations/memory/mongodb_chat_message_history/)
- [Powering Long-Term Memory for Agents with LangGraph and MongoDB](https://www.mongodb.com/company/blog/product-release-announcements/powering-long-term-memory-for-agents-langgraph)
- [Performance Best Practices: Indexing | MongoDB](https://www.mongodb.com/company/blog/performance-best-practices-indexing)
- [Avoiding Common Pitfalls in MongoDB Indexing | Medium](https://medium.com/@farihatulmaria/avoiding-common-pitfalls-in-mongodb-indexing-an-advanced-guide-e27a4c1a77c7)

**Thread/Session Management:**
- [Configure Threads - LangChain Docs](https://docs.langchain.com/langsmith/threads)
- [Sessions (Chats, Threads, etc.) - Langfuse](https://langfuse.com/docs/observability/features/sessions)
- [RunnableWithMessageHistory — LangChain Documentation](https://python.langchain.com/api_reference/core/runnables/langchain_core.runnables.history.RunnableWithMessageHistory.html)

**API Design & Backward Compatibility:**
- [Stateful Agents Replace Stateless Chat](https://anandchowdhary.com/notes/2025/stateful-agents-replace-stateless-chat)
- [OpenAI Conversation State Docs](https://platform.openai.com/docs/guides/conversation-state)
- [How to Make REST APIs Backward-Compatible | InfoWorld](https://www.infoworld.com/article/2261134/how-to-make-your-rest-apis-backward-compatible.html)

---
*Pitfalls research for: LangChain Conversation Threading & Memory Management*
*Researched: 2026-02-09*
