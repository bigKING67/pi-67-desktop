# Visual quality upgrade

Status: in progress
Owner: Claude Code
Started: 2026-10-07
Last updated: 2026-10-08

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
| 0 Rules | DESIGN `Visual quality bar`, Color wording, this plan | committed `72506802` |
| 1 Quiet chrome | Origin line, turn hairlines, thinking value, context ring, Prompt Stash, palette highlight, unnamed subtitle | committed `f1db0215` |
| 2 Layout | Inspector closed by default, centered empty entry, centered stopped/resume surface | committed `f7ecf0a4`, `68cf9fb9` |
| 3 Agent experience | Timeline compaction (`3ea6a086`). Direction A "quiet timeline" chosen over a pinned progress strip: one-line reasoning preview, no visible success marks, medium tool names, 32px rows, no request hairline, tints instead of colored edges, UI-face timestamps, lifted plan card | done (this commit series) |
| 4 Remaining surfaces | Approval dialog (done), Inspector panels and Composer pickers (done), dialogs and context overlays (done), Team Chat (done), Inspector explanatory lines → ⓘ (done, reusing SettingsInfo), wide content: breakout rejected after packaged review, cells break between words instead (done), remaining Settings editors (Provider configuration, Extension management), Tool summary width cap (done), light-mode surface step | in progress |
| 5 Settings convergence | Audit of all 16 categories in both themes (packaged, isolated profile). Batch A shared primitives: borderless luminance cards (light mode gains a real step), title-only page headers with one content offset, quiet disabled primary, one refresh language, two-line Provider rows with the Profile note in ⓘ (`48d27a86`). Batch B page groups: usage tiles/panels, memory-mode choices, shortcut list, one-line Lark notice, Chinese source roles, title-restating descriptions removed (`34d415ee`). Extension marketplace and single extension tab level (`6e5c7104`). Inset row hairlines after the Cursor reference (`02d3a035`). Batch C Extension package list/detail (`08d742b1`); batch D Provider configuration editor (`c323c27a`). Closeout: OpenAI strategy disclosure is a SettingsDetails, no double rule under 文件与诊断, Settings resource reload is an icon action sharing `useSessionResourceReload` with the workbench button | done |
| 6 Residual audit | 2026-10-08 static sweep after Alpha.47: letter-spacing removed from caption labels, dead monospace rail heading deleted, three colored status edges turned into tints; radius gains `--radius-inline` (4px) and `--radius-compact` (6px) roles (user decision) and every literal radius maps onto a role except chart marks, the 18px user bubble and the 1px progress track. Packaged review follow-ups: Provider sync status shows only `配置需要处理`, catalog refresh (cloud download) and configuration reload (refresh) get distinct icons, and the extension marketplace keeps meta aligned by giving the install button or its replacing status one end slot | done (packaged macOS; user review pending) |

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
- 2026-10-07: approval dialog restyled without removing security copy or changing
  actions. Follow-up outside visual scope: in one packaged run after reopening a
  conversation, `停止整个任务` was absent because the request did not map to exactly one
  `waiting-approval` Task; eligibility logic is unchanged and needs a runtime check.
- 2026-10-07 Inspector + Composer batch: accepted audit findings (nested frames,
  colored edges, uppercase/letter-spacing, non-code monospace, per-row semibold, raw
  radii, hover borders, popover dividers, bordered secondary buttons) and fixed three
  undefined shadow tokens (`--shadow-popover`, `--shadow-overlay`, `--shadow-color`);
  added `--shadow-segment` for selected segments. Deferred to the light-mode step:
  `.context-pane` edge and Files tab-strip/header dividers; spacing literal → token
  conversions. Not adopted: moving the Memory boundary copy into ⓘ (private/team
  boundary must stay visible) and removing the context-pressure border
  (DESIGN.dark mandates the border role).
- 2026-10-07 dialogs/overlays + Team Chat batch: fixed undefined `--shadow-dialog`,
  `--on-accent` (dark-on-dark search button in light mode) and `--font-mono`; refusal
  notice and toasts lose colored edges; Agent badge raised to the 11px minimum. Kept:
  menu danger separator, Team Chat contract borders (Work Card, Agent cards, webhook
  hairlines, day separators, avatar tile rings). Deferred: tooltip shadow weight,
  Doctor per-row pass icons, keyboard-help heading icon, provider subtitle id/count
  split, credential pane separation in light mode, and re-examining older Team Chat
  border mandates against the quality bar.
- 2026-10-07 light-mode workbench pass (Settings stays with Phase 5): code roles follow
  the UI theme via dual-theme Shiki tokens (user decision), Doctor pass icons hidden in
  place, keyboard-help heading icon removed, tooltips use the softer composer shadow.
  The 8 native `<select>` elements outside Settings now use the shared select
  component (`8f0722b6`).
- 2026-10-07: AUTO reasons stay on tool rows (PRODUCT security traceability), even
  though the direction-A mock omitted them.

- 2026-10-08: the light-mode surface step needs no token change. Light mode already
  separates regions by luminance: the navigation rail and the Inspector pane sit on
  `surface-muted` against white content, and Settings cards step onto `surface-muted`
  (Phase 5). Canvas and surface stay `#ffffff` as DESIGN Color specifies; the rail and
  pane keep their light-mode hairline under the light-mode allowance.
- 2026-10-08: Auto model selects keep the shared 300px column; the closed trigger leads
  with the model and shows the Provider as tertiary detail that truncates first, and the
  list groups models under Provider sections.
- 2026-10-08: still open: Phase 3 light-mode packaged evidence and the deferred items
  listed above.

## Rollback
Each phase lands as its own commits; revert that phase's commits. Token value
changes are confined to one commit per phase so they can be reverted alone.

## Checkpoints
- [x] Phase 0 rules and plan
- [x] Phase 1 quiet chrome
- [x] Phase 2 layout
- [x] Phase 3 running-state screenshot and two directions (A chosen 2026-10-07)
- [x] Phase 3 implementation and packaged evidence (macOS dark; light unverified)
- [ ] Phase 4 surface audit and implementation
- [x] Phase 5 Settings convergence (batches A–D and closeout; packaged macOS dark + light)
- [x] Phase 6 residual audit (labels, status edges, radius roles)
