---
version: alpha
name: Steve AI
description: Finance-grade product design system for a reconciliation control room. Calm, trustworthy, executive, decision-first.
colors:
  primary: "#1E3A5F"
  primaryHover: "#142943"
  secondary: "#3F485A"
  surface: "#FFFFFF"
  surfaceMuted: "#F1F3F8"
  text: "#0B1220"
  textMuted: "#5C6779"
  success: "#0F6B47"
  successSoft: "#E7F5EE"
  warning: "#8B5A00"
  warningSoft: "#FBF3DC"
  danger: "#9B1C1C"
  dangerSoft: "#FCE9E9"
  info: "#1F4E79"
  infoSoft: "#E8F0F8"
  white: "#FFFFFF"
typography:
  display:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: 600
    lineHeight: 44px
    letterSpacing: "-0.02em"
  h1:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 600
    lineHeight: 36px
    letterSpacing: "-0.015em"
  h2:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 600
    lineHeight: 30px
    letterSpacing: "-0.01em"
  h3:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 26px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 22px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  label:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 600
    lineHeight: 18px
  amount:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: 600
    lineHeight: 22px
    fontFeature: "tnum"
  amount-lg:
    fontFamily: JetBrains Mono
    fontSize: 22px
    fontWeight: 600
    lineHeight: 30px
    fontFeature: "tnum"
rounded:
  sm: 4px
  md: 8px
  lg: 12px
  xl: 16px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
components:
  page-title:
    textColor: "{colors.text}"
    typography: "{typography.h1}"
  page-subtitle:
    textColor: "{colors.textMuted}"
    typography: "{typography.body-lg}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 24px
  card-muted:
    backgroundColor: "{colors.surfaceMuted}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 24px
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
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 40px
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 12px
    height: 40px
  badge-success:
    backgroundColor: "{colors.successSoft}"
    textColor: "{colors.success}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 8px
  badge-warning:
    backgroundColor: "{colors.warningSoft}"
    textColor: "{colors.warning}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 8px
  badge-danger:
    backgroundColor: "{colors.dangerSoft}"
    textColor: "{colors.danger}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 8px
  badge-info:
    backgroundColor: "{colors.infoSoft}"
    textColor: "{colors.info}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: 8px
  table-header:
    backgroundColor: "{colors.surfaceMuted}"
    textColor: "{colors.secondary}"
    typography: "{typography.label}"
    padding: 12px
  table-cell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: 12px
  table-cell-amount:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.amount}"
    padding: 12px
  decision-panel:
    backgroundColor: "{colors.infoSoft}"
    textColor: "{colors.info}"
    rounded: "{rounded.xl}"
    padding: 24px
  risk-panel:
    backgroundColor: "{colors.dangerSoft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.xl}"
    padding: 24px
  approval-panel:
    backgroundColor: "{colors.warningSoft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.xl}"
    padding: 24px
  agent-message:
    backgroundColor: "{colors.surfaceMuted}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: 16px
---

## Overview

Steve AI is a reconciliation control room for finance operators. The design should make one thing clear fast: what is safe to pay, what is blocked, and why.

The product is both an app and an agent. The app gives control, evidence, approval, and history. The agent helps read statements, match invoices, recommend payment decisions, and draft follow-up work. The agent must feel contained and reviewable, never magical or unchecked.

The visual tone is calm, finance-grade, executive, and direct. Avoid decorative SaaS styling. Every color, badge, table, and panel should help a user make a payment decision with confidence.

## Colors

- **Primary `#1E3A5F`:** deep navy for main actions, navigation, and durable product identity.
- **Text `#0B1220`:** high-trust ink for decision content.
- **Muted text `#5C6779`:** secondary evidence, timestamps, helper copy, and metadata.
- **Neutral surfaces `#F8F9FC`, `#FFFFFF`, `#F1F3F8`:** quiet finance workspace with minimal visual noise.
- **Success `#0F6B47`:** matched, approved, ready to pay.
- **Warning `#8B5A00`:** needs review, approval pending, due soon.
- **Danger `#9B1C1C`:** do not pay, currency conflict, already-paid risk, serious mismatch.
- **Info `#1F4E79`:** system recommendation, agent explanation, neutral guidance.

Status colors are semantic only. Do not use green, amber, or red for decoration.

Accessible pairings:

| Pair | Use |
|---|---|
| `white` on `primary` | Primary buttons |
| `text` on `surface` | Core reading |
| `success` on `successSoft` | Matched / approved badges |
| `warning` on `warningSoft` | Needs-review badges |
| `danger` on `dangerSoft` | Blocked / do-not-pay badges |
| `info` on `infoSoft` | Agent recommendation panels |

## Typography

Use Inter for product UI and JetBrains Mono for money values. Finance users compare amounts, dates, and invoice numbers all day; numbers must align and scan cleanly.

- `display` and `h1` are for page-level outcomes, not marketing headlines.
- `h2` and `h3` organize sections like Supplier Status, Payment Recommendation, and Evidence.
- `body` is the default reading style.
- `label` is for buttons, column headers, and badges.
- `amount` and `amount-lg` are mandatory for money totals, variance, and payment recommendation values.

## Layout

Use a dashboard/control-room layout:

1. Decision summary first.
2. Risk/blockers second.
3. Evidence table third.
4. Audit/history last.

Spacing should be generous but not luxurious. Use `spacing.md` between related items, `spacing.lg` between cards, and `spacing.xl` between major page sections.

Tables must prioritize comparison: supplier, invoice number, date, ledger amount, statement amount, variance, status, and action.

## Elevation & Depth

Steve AI should feel mostly flat and stable. Use elevation sparingly:

- Cards separate work areas.
- Modals are for approval or correction moments.
- Avoid heavy shadows, floating glass, gradients, or decorative depth.

Depth should signal hierarchy, not style.

## Shapes

Use quiet rounded corners:

- `sm` for badges and compact labels.
- `md` for buttons and inputs.
- `lg` for cards.
- `xl` for decision, risk, and approval panels.

Do not use pill shapes for serious finance decisions unless the element is a small status badge.

## Components

Core components are decision-oriented:

- `decision-panel`: the system recommendation and summary.
- `risk-panel`: hard blockers and do-not-pay explanations.
- `approval-panel`: human approval, rejection, or override note required.
- `table-cell-amount`: all money values.
- `badge-success`, `badge-warning`, `badge-danger`, `badge-info`: reconciliation status.
- `agent-message`: contained Steve AI explanation.

Buttons should be restrained. Use one primary action per screen: approve, generate pack, or run reconciliation. Destructive actions must use `button-danger` and explain consequence before action.

## Do's and Don'ts

Do:

- Lead with the payment decision.
- Show why a recommendation exists.
- Keep the agent explanation next to the evidence.
- Make blocked states impossible to miss.
- Use tabular money values.
- Require notes for overrides and rejection decisions.
- Keep supplier language plain and business-facing.

Don't:

- Hide risk behind a generic success screen.
- Use decorative status colors.
- Make the agent feel like it approved payment by itself.
- Put charts before the decision.
- Use vague copy like "issue detected" without naming the issue.
- Add new colors, shadows, or radii without updating this file.
- Build UI that requires technical knowledge to understand.
