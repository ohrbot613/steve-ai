# Requirements: Conversation Threading (AskSteve)

**Defined:** 2026-02-09
**Core Value:** Users can have continuous, context-aware conversations with the AI agent that persist across sessions -- the agent remembers what was discussed and can build on previous context.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Thread Management

- [x] **THRD-01**: Backend generates a unique thread ID (UUID v4) when a message is sent without a threadId
- [x] **THRD-02**: Thread is persisted to MongoDB with userId, createdAt, updatedAt metadata
- [x] **THRD-03**: Thread ownership is validated -- users can only access their own threads
- [ ] **THRD-04**: User can start a new conversation by clearing the current thread (frontend "New Chat" action)

### Message Persistence

- [x] **MSG-01**: All user messages are saved to MongoDB under their thread ID with timestamp
- [x] **MSG-02**: All AI agent responses are saved to MongoDB under their thread ID with timestamp
- [x] **MSG-03**: Messages include role (user/assistant), content, and metadata (tool calls if any)
- [x] **MSG-04**: Messages are retrievable by thread ID in chronological order

### Conversation Memory

- [x] **MEM-01**: AI agent loads the last N messages (configurable, default 20) in full as context before responding
- [x] **MEM-02**: Messages beyond the window are summarized and included as condensed context
- [x] **MEM-03**: Context window uses token-based limits (not just message count) to prevent exceeding model limits
- [x] **MEM-04**: Agent maintains awareness of conversation topic and previous tool results within the window

### API Integration

- [ ] **API-01**: Existing chat endpoint accepts optional threadId in POST request body
- [ ] **API-02**: When threadId is absent, backend creates a new thread and returns the threadId in the response
- [ ] **API-03**: When threadId is present, backend loads thread memory and continues the conversation
- [ ] **API-04**: Existing clients without threadId continue to work (backward compatibility -- stateless mode)

### Frontend Integration

- [ ] **FE-01**: Frontend stores threadId after first message response and auto-includes it in subsequent requests
- [ ] **FE-02**: Frontend provides a "New Chat" button that clears the current threadId
- [ ] **FE-03**: Chat messages displayed from server response (backend is source of truth, not localStorage)
- [ ] **FE-04**: Thread persists across page refresh (threadId stored in sessionStorage)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Memory

- **AMEM-01**: Intelligent summarization with fact extraction that preserves invoice numbers, amounts, vendor names
- **AMEM-02**: Adaptive context window that dynamically adjusts history based on token usage
- **AMEM-03**: Tool use memory -- agent remembers tool results from earlier in thread without re-querying

### Thread History UI

- **THUI-01**: User can view a list of past conversation threads
- **THUI-02**: Threads display auto-generated titles based on first message content
- **THUI-03**: User can search/filter past threads
- **THUI-04**: User can click a thread to resume that conversation

### Cross-Device Persistence

- **XDEV-01**: User can continue conversations from different devices/browsers

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Real-time/WebSocket streaming | HTTP POST sufficient for business tool; adds infrastructure complexity |
| Multi-user shared threads | No validated need for invoice processing; per-user only |
| Thread deletion/archival | Data retention is a feature in business tools; defer |
| Message editing/branching | Creates complex state management; users start new thread instead |
| Cross-thread search/RAG | Requires vector search infrastructure; defer to v2+ |
| Automatic thread naming | Not useful until thread list UI exists; defer |
| Infinite context windows | Causes quality degradation and cost explosion; use windowed memory |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| THRD-01 | Phase 1 | ✓ Done |
| THRD-02 | Phase 1 | ✓ Done |
| THRD-03 | Phase 1 | ✓ Done |
| THRD-04 | Phase 3 | Pending |
| MSG-01 | Phase 1 | ✓ Done |
| MSG-02 | Phase 1 | ✓ Done |
| MSG-03 | Phase 1 | ✓ Done |
| MSG-04 | Phase 1 | ✓ Done |
| MEM-01 | Phase 1 | ✓ Done |
| MEM-02 | Phase 1 | ✓ Done |
| MEM-03 | Phase 1 | ✓ Done |
| MEM-04 | Phase 1 | ✓ Done |
| API-01 | Phase 2 | Pending |
| API-02 | Phase 2 | Pending |
| API-03 | Phase 2 | Pending |
| API-04 | Phase 2 | Pending |
| FE-01 | Phase 3 | Pending |
| FE-02 | Phase 3 | Pending |
| FE-03 | Phase 3 | Pending |
| FE-04 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 20 total
- Mapped to phases: 20
- Unmapped: 0

---
*Requirements defined: 2026-02-09*
*Last updated: 2026-02-09 after Phase 1 completion*
