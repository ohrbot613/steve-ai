# Steve AI — Agent Context

> Invoice reconciliation app for CFOs. Matches bank statements against Xero invoices.
> This file is the entry point for any AI agent (Claude Code, Cursor, Copilot) working in this repo.

## Owner
**Insperanto Ltd / Recharge** — Shaul (founder), Yitzchak (developer)

## Shared Knowledge Vault
The full project context, decisions, and team info lives in the Obsidian vault:
- **Vault location:** ~/Desktop/dot-claude/
- **Steve project doc:** ~/Desktop/dot-claude/projects/Steve AI.md
- **Architecture details:** ~/Desktop/dot-claude/resources/Steve Architecture.md
- **Dev tracking:** ~/Desktop/dot-claude/areas/Development.md

Read those before making architectural decisions.

## Architecture
- **Frontend:** React (client/)
- **Backend:** Express/Node.js (server.js, routes/, controllers/, services/)
- **Database:** MongoDB Atlas (steveTests)
- **Integrations:** Xero (OAuth, polling, cron jobs for auto-reconcile)
- **Auth:** JWT (User model)

## Key Paths
| What | Where |
|---|---|
| Entry point | server.js |
| API routes | routes/ |
| Business logic | controllers/ + services/ |
| React frontend | client/ |
| DB models | (check for models/ or within services/) |
| Config | config/ |
| Migrations | migrations/ |

## Current Status
- Phase 8 complete (auto-reconcile Xero invoices, 30min cron + fuzzy matching)
- 20+ security vulnerabilities identified but unfixed (March 5-8, 2026)
- Design partner Jeffrey unhappy with data accuracy and UX
- Pending: Phase 2/3 (thread API wiring + frontend), Phase 6 (Xero statement balance fix)

## Known Issues
- Security vulnerabilities need fixing before any production deployment
- Data accuracy problems reported by design partner
- UX needs improvement per Jeffrey's feedback
- Migration from v1 SupplierInvoice to v2 Invoice model in progress

## Code Standards
- No console.log in production code (use proper logging)
- All API endpoints need input validation
- Auth middleware on all protected routes
- Test coverage expected for new features

## Memory Integration
When you learn something important about this project (decisions, architecture changes, bugs found):
1. Update ~/Desktop/dot-claude/projects/Steve AI.md if it's project status
2. Update ~/Desktop/dot-claude/resources/Steve Architecture.md if it's technical
3. Push preferences/soft context to Mem0: `~/.openclaw/scripts/mem0-push.sh "fact" project`

## GitHub
- Repo: ohrbot613/steve-ai
- Active branches: main, dev, app-1-5
- Linear team: Epic agents (EPI)
