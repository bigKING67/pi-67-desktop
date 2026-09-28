# Workbench reading-first (direction A) promotion

Status: phase 1 implemented; phase 2 awaiting a product decision
Owner: main
Started: 2026-09-28
Last updated: 2026-09-28

## Selection
Direction A「阅读优先」from `apps/renderer/design-preview` (`?preview=baseline`), selected by the owner
on 2026-09-28 by accepting the agent recommendation ("按你建议继续"). The default preview entry
`agent-workspace/`（67 工作伙伴）is a later, undocumented prototype and is **not** part of this selection.

## Why phased
A as prototyped conflicts with accepted contracts, so it is absorbed as a direction, not copied:
- process folded while running and on interruption vs PRODUCT.md:110-112 and DESIGN.md:425-440;
- inline approval card vs DESIGN.md:2176 (Safety Approval is a dedicated dialog and protocol);
- 17/29/10px sizes and 1.85-1.9 line height vs DESIGN.md:294-304 roles and the 11px floor;
- green (baseline) / purple (agent-workspace) dark accents vs DESIGN.dark.md:47-57;
- ⌘/Ctrl+Enter send and an ASK option vs DESIGN.md:1803, 1810-1816;
- brand mark in the answer author line vs DESIGN.md:134-135;
- "成果" artifacts have no production data model; inventing them in the renderer would break
  "Pi JSONL remains the conversation source of truth" (DESIGN.md:431-432).

## Phase 1 — reading-first within current contracts (proposed)
Goal: the final answer reads as the primary result and surrounding chrome gets quieter, with no
contract change except the DESIGN.md text that describes the new emphasis.
- Final answer emphasis: stronger lead paragraph and spacing using existing roles (16/18px tokens,
  body line height 1.75); author, actions and timestamp quieter.
- Process summary: quieter single-line summary styling. Keep the rules: expanded while running,
  expanded on failure/cancel/loss/missing answer, auto-collapse only after a visible final answer,
  at most four inline live steps.
- Empty/new state: A's calmer welcome and starter layout using existing copy and roles.
- Reading measure: keep 800px (A's 760-820px is within noise).
- Inspector: unchanged (320px, same breakpoints); no new region.
- Composer: visual spacing only; keep Enter to send, 停止 rightmost, AUTO/YOLO.
- Dark mode: parity through existing tokens; no new accent.
Non-goals: artifacts pane, inline approval, key-binding or brand changes, agent-workspace features.

Likely files: transcript/TranscriptProcessGroup.tsx(+css), transcript/Transcript.tsx(+css),
transcript/MessageCard.module.css, transcript/MarkdownView.module.css, composer/Composer.module.css,
DESIGN.md / DESIGN.dark.md (Transcript, Composer sections). No protocol or persistence change.

## Phase 2 — results on demand (needs a separate product decision)
Define a "成果" projection from authoritative Pi data (write/edit Tool results or Changes), decide
where it opens (central file surface vs Inspector tab; never a fourth permanent region), and add
PRODUCT.md/DESIGN.md contracts before any UI. Not started.

## Acceptance (phase 1)
- Contracts above unchanged except the deliberate DESIGN.md emphasis text, updated in the same change.
- Existing transcript/process/composer unit tests and e2e specs pass unchanged in behavior
  (renderer-workbench*, renderer-operation-settlement, renderer-streaming-markdown, renderer-markdown,
  renderer-transcript-navigation, renderer-message-actions, renderer-appearance, renderer-responsive-workspace).
- browser67 screenshots (light/dark × 1440/1040/760 × new/running/completed/failed) with path, size
  and sha256, reviewed against A baseline screenshots; virtualized scroll anchoring and "回到最新"
  unchanged; Reduced Motion respected.
- Packaged macOS smoke passes; Windows evidence reported as unverified unless run.

## Rollback
Phase 1 is CSS/presentation plus DESIGN.md text; revert the phase commits. No migration.
The prototype directory stays untracked until phase 1 lands, then is removed with its plan
marked superseded, unless the owner asks to keep it.

## Risks
Virtuoso row height changes on fold/settle; answer emphasis must stay Markdown rendered through
the worker parser, not a synthesized summary; the prototype's own evidence does not cover keyboard,
screen reader, real lifecycle, Electron or Windows.

## Phase 1 result (2026-09-28)
Owner confirmed phase 1 ("开始第一阶段") and approved fixture-backed Playwright captures for this
review because browser67 cannot provide the Electron preload bridge and mock Agent Host.

Changed: MessageCard (answer class: 22/26px rhythm, quiet secondary author line, section-role lead
paragraph when the answer opens with a paragraph), TranscriptProcessGroup (support/medium summary,
hairline above; expansion rules untouched), Transcript empty state (left-aligned column, display
heading, flat 44px starter rows with trailing arrow and focus ring), DESIGN.md, DESIGN.dark.md.
Unchanged by design: NewSessionIntentSurface (already a left-aligned display-heading column),
Inspector, composer, approval dialog, keys, tokens, protocol and persistence.

Evidence: 24 before + 24 after captures (light/dark × 1440/1040/760 × empty/running/completed/failed)
in `artifacts/visual-review/reading-first/` with `manifest.json` (path, size, sha256). Inspected:
after light-1440 completed/empty, dark-1440 failed/running, dark-760 completed, light-760 failed,
dark-1040 empty, plus before light-1440 and dark-760 completed. Failed stays expanded with its
warning outcome; running stays expanded; the streaming answer already uses the lead style so the
settle does not resize it. `check` (5804 tests) and the full renderer e2e (276) pass.

Observation (kept): at ≤760px the process summary stacks label and counts on two lines. This is a
deliberate existing rule that keeps long outcome labels and 查看未成功步骤 readable; phase 1 did
not change responsive behaviour. The prototype stays untracked for phase 2 reference.
Unverified: packaged Electron, Windows, screen reader.

