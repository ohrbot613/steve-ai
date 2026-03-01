# SimpleApp Modularization Map

## Current issue
`client/src/pages/SimpleApp.jsx` currently combines data fetching, mutations, modal orchestration, keyboard handlers, table rendering, and notifications in one file.

## Target module layout
- `client/src/pages/simpleApp/hooks/useDashboardData.js`
  - `dashboard-data`, `tab-2`, `tab-3` fetch and optimistic update helpers.
- `client/src/pages/simpleApp/hooks/useStatementsData.js`
  - Statement list fetching, paging, and deletion flows.
- `client/src/pages/simpleApp/hooks/useUploadFlow.js`
  - File validation, upload handlers, unresolved supplier queue.
- `client/src/pages/simpleApp/hooks/useGlobalFeedback.js`
  - Unified toast feedback with auto-dismiss and optional actions.
- `client/src/pages/simpleApp/components/SummaryCards.jsx`
  - Header totals and latest upload information.
- `client/src/pages/simpleApp/components/AttentionTable.jsx`
  - Attention tab rendering and selection actions.
- `client/src/pages/simpleApp/components/ReconciledTable.jsx`
  - Reconciled tab rows and mark-paid/undo actions.
- `client/src/pages/simpleApp/components/StatementsTable.jsx`
  - Statement list and per-row actions.
- `client/src/pages/simpleApp/components/modals/*`
  - Manual supplier modal, email modal, shared modal wrapper.

## Migration order
1. Extract feedback/toast state and remove direct `alert(...)` usage.
2. Extract dashboard fetch hooks without changing response shape.
3. Split tab renderers into separate memoized components.
4. Move modal logic into dedicated components/hooks.
5. Keep `SimpleApp.jsx` as orchestration shell only.

## Guardrails
- Preserve existing API payload contracts and action semantics.
- Keep all current keyboard shortcuts and accessibility labels.
- Require no visual regressions in upload + reconciliation flows before merging.
