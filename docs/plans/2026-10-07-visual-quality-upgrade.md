# Visual quality upgrade

Status: in progress
Owner: Claude Code
Started: 2026-10-07
Last updated: 2026-10-07

## Goal
Converge every Renderer surface on the DESIGN `Visual quality bar`: restrained,
content-first presentation calibrated against Grok Bot, Manus, Cursor, Linear,
Vercel and Magpie, with Settings › 模型 (2026-10-06) as the in-product exemplar.

## Non-goals
No change to Product behavior, Protocol, runtime, authorization, recovery or
information architecture beyond what a phase explicitly states. No new component
library, Tailwind, shadcn or AI SDK dependency. No copying of reference branding,
pixels or assets. Message actions stay visible at rest rather than hover-only.

## Acceptance criteria
- Each phase updates DESIGN (and DESIGN.dark when applicable) in the same change.
- Each touched surface satisfies the eight quality-bar rules in light and dark.
- Keyboard, focus-visible, Reduced Motion, 200% zoom and long Chinese/English
  strings keep working; targeted unit/e2e tests cover changed visible behavior.
- Evidence comes from the packaged macOS preview (`preview:mac:unsigned`) with
  light and dark screenshots; browser preview alone does not close a phase.
- The user reviews each phase before it is committed; one phase per commit series
  so a phase can be reverted without touching the others.

## Phases
| Phase | Scope | State |
| --- | --- | --- |
| 0 Rules | DESIGN `Visual quality bar`, Color wording, this plan | done (uncommitted) |
| 1 Quiet chrome | Origin line, turn hairlines, thinking value, context ring, Prompt Stash, palette highlight, unnamed subtitle | committed `f1db0215` |
| 2 Layout | Inspector closed by default, centered empty entry, centered stopped/resume surface | committed `f7ecf0a4`, `68cf9fb9` |
| 3 Agent experience | Execution timeline compaction done (`3ea6a086`). Remaining: tool step and expanded-output framing, decision cards (approval, plan confirmation), error/thinking colored edges → tints. Capture a packaged running-state screenshot first, then offer two directions | in progress |
| 4 Remaining surfaces | Dialogs and context overlays, Team Chat, Inspector panels (Files, Changes, Memory), Composer pickers, remaining Settings editors (Provider configuration, Extension management), light-mode surface step | pending |

Settings quiet-list convergence (`1c420581`) already covers the Settings catalogs
and is re-audited, not redone, in phase 4.

## Current evidence
Renderer CSS border declarations concentrate in Provider configuration (18),
Extension management (16), Composer (14), context overlays (13), Memory
Inspector (13), Team Chat (11), Settings primitives (11) and dialogs (10)
(2026-10-07 `grep` count, a triage signal rather than a defect list).
Light-mode `canvas` and `surface` are both `#ffffff`, so phase 4 must either add
a surface step or rely on the light-mode hairline allowance.

## Decisions
- 2026-10-07: full convergence rather than touch-only adoption (user decision).
- 2026-10-07: tool steps are unframed timeline rows; decision cards are the one
  framed Transcript element; status tints replace colored edges.
- Light mode may keep low-contrast hairlines where no surface step exists;
  dark mode separates by luminance.

## Rollback
Each phase lands as its own commits; revert that phase's commits. Token value
changes are confined to one commit per phase so they can be reverted alone.

## Checkpoints
- [x] Phase 0 rules and plan
- [x] Phase 1 quiet chrome
- [x] Phase 2 layout
- [ ] Phase 3 running-state screenshot and two directions
- [ ] Phase 3 implementation and packaged evidence
- [ ] Phase 4 surface audit and implementation
