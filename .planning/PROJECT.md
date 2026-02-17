# PDF Automation — Conversation Threading

## What This Is

An enhancement to the existing PDF automation platform's AI chat system (AskSteve). Adds conversation threading so users can have ongoing, context-aware conversations with the AI agent. Each conversation gets a unique thread ID, messages are persisted to MongoDB, and the AI agent has memory of the conversation — loading the last N messages in full and summarizing older messages for context.

## Core Value

Users can have continuous, context-aware conversations with the AI agent that persist across sessions — the agent remembers what was discussed and can build on previous context.

## Requirements

### Validated

<!-- Existing capabilities from codebase -->

- ✓ AI agent chat (AskSteve sidebar) — existing
- ✓ LangChain agent with tool use — existing
- ✓ PDF/invoice parsing and processing — existing
- ✓ JWT authentication and session management — existing
- ✓ MongoDB data persistence — existing
- ✓ Express.js REST API with v1/v2 routing — existing
- ✓ React frontend with context-based state — existing

### Active

- [ ] Thread ID generation — backend creates a new thread ID when no threadId is sent
- [ ] Thread ID in request body — frontend sends threadId alongside message in POST body
- [ ] Auto-attach thread ID — after first message creates a thread, all subsequent messages in that chat session automatically include the thread ID
- [ ] Message persistence — all messages (user + AI) saved to MongoDB under their thread
- [ ] Conversation memory — AI agent loads last N messages in full as context
- [ ] Conversation summarization — older messages beyond the window are summarized and included as context
- [ ] Thread persistence — threads survive across sessions, users can resume conversations
- [ ] New conversation action — user can start a fresh thread (clear current thread ID)

### Out of Scope

- Thread list/history UI — deferred to future (users want this later, not now)
- Threading for non-AI features — only applies to AskSteve chat
- Real-time/WebSocket messaging — current HTTP request/response is sufficient
- Multi-user threads — threads are per-user, no shared conversations
- Thread deletion/archival — not needed for v1

## Context

The existing AskSteve chat system sends messages to `/api/v1/langchain/test-agent` with a message and sessionId. Currently, each message is essentially stateless — no persistent conversation history. The LangChain agent already supports tool use for invoice lookup, supplier matching, etc. The sessionId exists but doesn't appear to store conversation history in the database.

The v2.0 architecture exists alongside v1.0. This feature should be built in whatever version the chat currently lives in (v1.0 routes).

**Key technical context:**
- LangChain agent already has a message structure (HumanMessage/AIMessage)
- MongoDB via Mongoose is the persistence layer
- Frontend uses React context for state management
- Agent uses OpenRouter for LLM calls

## Constraints

- **Tech stack**: Must use existing stack (Express.js, React, MongoDB/Mongoose, LangChain)
- **API compatibility**: Existing chat endpoint behavior should not break for clients that don't send threadId
- **Token management**: Must implement windowed memory (last N messages + summary) to avoid excessive token costs
- **Authentication**: Thread access must be scoped to the authenticated user

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Thread ID in request body (not header/param) | Keeps it simple, consistent with existing message body pattern | — Pending |
| Full messages + summary for older context | Balances conversation quality with token costs | — Pending |
| MongoDB for thread storage | Already using Mongoose, no new dependencies | — Pending |
| AI chat only (not app-wide) | Focused scope, avoid over-engineering | — Pending |
| No thread history UI in v1 | Ship core threading first, add UI later | — Pending |

---
*Last updated: 2026-02-09 after initialization*
