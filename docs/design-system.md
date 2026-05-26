# Design System — How to Use It

> **Single source of truth: [`DESIGN.md`](../DESIGN.md) at the repo root.**
> **Reviewer for any UI work: the `design` Claude Code subagent (`.claude/agents/design.md`).**

This note is a short guide for **anyone working on Steve AI's UI** — humans and AI agents alike. The substance of the system lives in `DESIGN.md`. This file is just the operating instructions for using it.

## What DESIGN.md is

`DESIGN.md` follows the Google DESIGN.md spec:

- **YAML frontmatter** at the top holds the canonical token values: colors, typography, layout/spacing, elevation, shapes, motion, and a full set of component tokens.
- **Markdown sections** beneath it explain the system in canonical order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts.

If a value isn't in `DESIGN.md`, it isn't part of the design system. There are no "almost-tokens" or "I'll just inline this once" exceptions.

## Component token rules

The frontmatter `components:` section uses only these properties — by design, to keep the system portable to any rendering target (web app, Excel export, PDF report, future mobile):

`backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width`

**Variants are sibling keys, not nested configs.** A primary button's states look like this:

```yaml
button-primary:
  backgroundColor: "{colors.primary}"
  textColor: "{colors.white}"
  typography: "{typography.label}"
  rounded: "{rounded.md}"
  padding: 12px
  height: 40px
button-primary-hover:
  backgroundColor: "{colors.primaryHover}"
  textColor: "{colors.white}"
  typography: "{typography.label}"
  rounded: "{rounded.md}"
  padding: 12px
  height: 40px
```

Never `button-primary: { default: {...}, hover: {...} }`. The flat sibling pattern is what keeps the system mechanically consumable by both tooling and AI agents.

## Workflow

### For human contributors

1. **Before you write a line of UI code**, open `DESIGN.md` and locate the relevant tokens (colors, components, type styles).
2. Reach for an existing component token first. If you can't express what you need, that is a **design system gap**, not a license to inline a value.
3. Open a small PR that **adds the token to `DESIGN.md` in the same commit** as the consuming code. The token change should be the first hunk in the diff.
4. Tag the design owners (founder + design partner) on token-level changes.

### For AI agents working in this repo

Every Claude Code / Cursor / Copilot agent must:

1. **Read `DESIGN.md` before producing any UI** — JSX, CSS, SCSS, inline styles, copy that lands in the UI, exported reports, agent chat surfaces.
2. **Route UI work through the `design` subagent.** From Claude Code, that means invoking the `design` agent (defined in `.claude/agents/design.md`). The design agent reviews against the checklist in its own system prompt and returns a verdict (approve / revise / reject) with token citations.
3. **Never silently introduce a new color, weight, radius, or shadow.** If a new token is needed, propose it as a diff to `DESIGN.md` and call it out for human review.
4. **Use only the documented component property set** (above). No nested variants.

### How to invoke the design subagent (Claude Code)

The `design` subagent is configured at `.claude/agents/design.md`. From any Claude Code session inside this repo, route UI questions to it explicitly:

> "Use the `design` subagent to review the proposed reconciliation table layout against `DESIGN.md`."

The subagent runs on Opus and is scoped to product design, UX, and design-system consistency. It does not write business logic — it reviews UI, proposes token-level changes, and hands engineering work back to other agents.

## When the system needs to grow

A new surface (e.g., a mobile view, a new report type, a customer-facing email) will eventually require tokens the system doesn't have yet. When that happens:

1. Define the **smallest possible addition** that solves the immediate need. Resist the urge to redesign.
2. Add it to `DESIGN.md` as a sibling token where possible.
3. Update the Do's and Don'ts section if the addition introduces a new usage rule (e.g., "never use the print-export-only fill in app surfaces").
4. Note the change in your PR description so it shows up in design history.

## Quick reference

| I need... | Look at... |
|---|---|
| The right color for "matched / approved" | `status.success.*` and `badge-success` |
| The right color for "do not pay" | `status.danger.*` and `badge-danger` |
| A money cell in a table | `table-cell-amount` (uses the `amount` typography style) |
| A page header | `page-title` (h1) + `page-subtitle` (body-lg) |
| Steve's own message in a chat surface | `agent-message` |
| A modal | `modal` + `modal-overlay` + `elevation.lg` |
| A primary action | `button-primary` (+ hover, disabled siblings) |
| A "section label" above a group of cards | `eyebrow` typography style + `section-header` component |
| To know if my color choice is accessible | Colors → Accessible color pairs table in `DESIGN.md` |

## Out of scope for this note

- Token implementation in CSS / Tailwind / SCSS — that's an engineering concern, addressed when the team consolidates `client/scss/` against the token list.
- Marketing site / public-facing surfaces — Steve AI's marketing brand may diverge from the product surface. This file governs the **product** only.
