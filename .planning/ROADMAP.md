# Roadmap: Conversation Threading (AskSteve)

## Overview

This roadmap delivers persistent, context-aware conversation threading for the AskSteve AI chat. Phase 1 builds the data foundation (thread/message models, memory management service with windowed loading and summarization). Phase 2 wires threading into the existing LangChain agent endpoint with backward compatibility. Phase 3 completes the user experience by updating the React frontend to track threads and provide a "New Chat" action.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Thread Storage and Memory** - Data models, persistence services, and conversation memory loading
- [ ] **Phase 2: Backend API Integration** - Wire threading into the LangChain agent endpoint with backward compatibility
- [ ] **Phase 3: Frontend Integration** - React UI updates to track threads and enable new conversations

## Phase Details

### Phase 1: Thread Storage and Memory
**Goal**: The data layer can create threads, persist messages, and load conversation context with windowed memory -- all independently testable without touching the existing agent flow
**Depends on**: Nothing (first phase)
**Requirements**: THRD-01, THRD-02, THRD-03, MSG-01, MSG-02, MSG-03, MSG-04, MEM-01, MEM-02, MEM-03, MEM-04
**Success Criteria** (what must be TRUE):
  1. A new thread can be created in MongoDB with a UUID, userId, and timestamps -- and retrieved by ID with ownership validation
  2. User and AI messages can be saved to a thread and retrieved in chronological order with role, content, and metadata intact
  3. The memory service loads the last N messages (default 20) as full LangChain message objects for a given thread
  4. When a thread exceeds the context window, older messages are summarized and the summary is included alongside recent messages
  5. Context loading respects token-based limits (not just message count) to prevent exceeding model capacity
**Plans:** 2 plans

Plans:
- [x] 01-01-PLAN.md -- Thread and Message MongoDB models with indexes
- [x] 01-02-PLAN.md -- Memory management service with windowed loading and summarization

### Phase 2: Backend API Integration
**Goal**: The existing chat endpoint supports threaded conversations -- creating threads on first message, loading memory on continuation, persisting all messages -- while remaining backward compatible for clients that do not send a threadId
**Depends on**: Phase 1
**Requirements**: API-01, API-02, API-03, API-04
**Success Criteria** (what must be TRUE):
  1. Sending a message without threadId creates a new thread and returns the threadId in the response
  2. Sending a message with a valid threadId loads that thread's conversation history and the AI responds with full context
  3. Existing API clients that never send threadId continue to work exactly as before (stateless mode, no regression)
  4. Thread ownership is enforced -- a user cannot access or continue another user's thread via the API
**Plans**: TBD

Plans:
- [ ] 02-01: Integrate threading into LangChain controller with backward compatibility

### Phase 3: Frontend Integration
**Goal**: Users can have persistent, threaded conversations in the AskSteve chat -- the thread survives page refresh, and users can start fresh conversations at will
**Depends on**: Phase 2
**Requirements**: FE-01, FE-02, FE-03, FE-04, THRD-04
**Success Criteria** (what must be TRUE):
  1. After sending the first message, all subsequent messages in that session automatically continue the same thread without user intervention
  2. Refreshing the page preserves the current thread -- the user returns to the same conversation
  3. Clicking "New Chat" clears the current thread and starts a fresh conversation with no prior context
  4. Chat messages are displayed from the server response (backend is source of truth), not from localStorage
**Plans**: TBD

Plans:
- [ ] 03-01: Update AskSteve React components for thread tracking and new chat action

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Thread Storage and Memory | 2/2 | ✓ Complete | 2026-02-09 |
| 2. Backend API Integration | 0/1 | Not started | - |
| 3. Frontend Integration | 0/1 | Not started | - |
| 5. Fix Xero bank balance mismatch | 1/1 | ✓ Complete | 2026-02-10 |

### Phase 4: Stream AI responses from backend to frontend
**Goal**: AI responses stream token-by-token from backend to frontend via Server-Sent Events (SSE) -- users see the response appear progressively like ChatGPT instead of waiting for the complete response
**Depends on**: Phase 3
**Success Criteria** (what must be TRUE):
  1. Backend SSE endpoint streams LangChain agent tokens to the client in real-time with keep-alive heartbeats
  2. Client disconnect aborts agent execution and cleans up resources (no memory leaks)
  3. Complete AI response is persisted to MongoDB after stream finishes (buffer-then-save, no partial messages)
  4. Frontend displays tokens progressively as they arrive, with streaming cursor and tool status indicators
  5. Thread ID is returned on stream completion and used for subsequent messages
  6. Existing non-streaming endpoint continues to work unchanged (backward compatibility)
**Plans:** 2 plans

Plans:
- [ ] 04-01-PLAN.md -- Backend SSE streaming service with better-sse, LangChain integration, and message persistence
- [ ] 04-02-PLAN.md -- Frontend useStreamingChat hook and AskSteve component update for progressive token display

### Phase 5: Fix Xero bank balance mismatch on dashboard

**Goal:** Dashboard displays live bank balance from Xero API instead of hardcoded value -- with proper currency formatting, loading state, and graceful handling when Xero is not connected
**Depends on:** Phase 4
**Plans:** 1 plan

Plans:
- [x] 05-01-PLAN.md -- Wire existing backend bank balance endpoint to dashboard Top component

### Phase 6: Fix Xero statement balance mismatch with dashboard values

**Goal:** Dashboard clearly distinguishes between Xero-computed balance and bank statement balance -- fixing the silent fallback in report parsing, removing debug artifacts, and showing both values when they differ so users understand the discrepancy
**Depends on:** Phase 5
**Plans:** 1 plan

Plans:
- [ ] 06-01-PLAN.md -- Fix backend report parsing fallback, clean up debug logs, and update frontend to show balance source with mismatch indicator

### Phase 7: Add supplier reconciliation dashboard with view toggle

**Goal:** A supplier reconciliation dashboard is the default view on the Dashboard page -- with dark theme, three-tab supplier table (Latest Batch, Needs Attention, Reconciled), expandable rows with problem and reconciled flows, status badges with stale escalation, and a toggle to switch back to the existing stats dashboard. Frontend-only with mock data shaped for future API swap.
**Depends on:** Phase 6
**Plans:** 2 plans

Plans:
- [ ] 07-01-PLAN.md -- Dashboard toggle infrastructure, Google Fonts, extract existing stats view
- [ ] 07-02-PLAN.md -- ReconciliationDashboard component with tabs, supplier table, expandable rows, status system, and visual verification

---
*Roadmap created: 2026-02-09*
*Last updated: 2026-02-17*
