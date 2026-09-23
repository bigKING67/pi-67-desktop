# Workbench polish, first batch

Status: completed
Owner: Codex
Started: 2026-09-23

## Goal and acceptance
Implement the approved first batch: quieter navigation, aligned 248/320px desktop
panes and 800px reading track, flatter composer controls with explicit safety and
intent controls, file filters behind a labelled disclosure, compact stopped state
and product-facing readiness copy. Preserve dark/light parity and keyboard access.

## Scope and delivery
Renderer CSS/components/localization, corresponding authority and focused tests.
Local implementation and macOS unsigned preview only; no commit/push/distribution.
Second-batch activity/results changes are excluded. No protocol/dependency changes.

## Live findings and decisions
Existing panes are CSS-sized, not resizable, and visibility is session-local.
Preserve that behavior instead of silently introducing persistence or resetting
existing workflows. Width dragging/new-user default migration is deferred.
Keep React Aria primitives. Thinking remains one-click selectable in Parameters.
Keep authoritative state, pending/error behavior, model/provider identity and
ASK/AUTO/YOLO plus Execute/Plan visible. No automatic inspector tab switching.

## WIP and rollback
Existing theme changes and unrelated AGENTS/PRODUCT/agent-host test/provenance/
preview files are dirty; preserve all. Roll back only this batch's hunks, never
whole-file restore or reset. No user data migration or settings writes.

## Checkpoints
- [x] Implementation and authority
- [x] Focused type/tests, aggregate source gate, browser matrix and visual review
- [x] macOS packaged smoke and native appearance

## Evidence
Baseline: current native light screenshot and neutral-theme browser artifacts.
Route: L2 web/Electron renderer, design-craft, current DESIGN authorities evolved
only within the accepted first batch; main agent, existing React Aria kept.
Windows unverified. No performance improvement claimed.

## Validation progress
- Renderer/test typechecks, changed-file type-aware lint, structure, references,
  architecture/dead-code/transport/workflow checks passed. Source build passed.
- Browser suites cover Inspector CRUD/search/filter, Provider/model switching,
  theme contrast, shell focus, responsive panel geometry, workbench restore,
  long names, event projection and notification recovery. Failed stale size/copy
  assertions were updated to the accepted design; underlying behavioral checks
  were preserved. Vite rebuild interference was isolated and rerun successfully.
- New light/dark matrix exercises 1440/1000/720px, no horizontal overflow, visible
  model/parameter/send controls, 800px cap, filter keyboard open/Escape/focus return.
- browser67 static three-pane capture reviewed; hidden-page screenshot is static
  appearance only. Finalized exact managed tab: closed=1 verified=1 remaining=0.
  Playwright screenshots reviewed for dark wide and light narrow; existing shell
  focus/hover checks pass. Artifacts: artifacts/visual-review/workbench-polish/.
- Existing React Aria Select/Menu/Dialog primitives kept; filter disclosure matches
  the existing file-menu surface. Both provisional/live parameter controls agree.
  Semantic status and authorization controls retained; no extra animation added.
- Aggregate first run captured the old thinking-label assertion before correction;
  its other 5737 tests passed. Fresh complete coverage rerun passed: 882 files / 5738 tests; 9 files / 24 tests skipped; branch coverage 78.45%.
- Current-version packaged/Electron readiness selectors updated for `就绪`;
  legacy installed-upgrade selectors preserved. Packaging targeted tests 10/10
  passed; packaging lint and test typecheck passed. Baseline HEAD is
  `70162447ed1d7fd6b5253f0c86039ab365daf72c`; local source is dirty, not a release.
- First packaged smoke exposed over-broad ready-phase abbreviation: post-resume
  synchronization text was hidden. Corrected only the ordinary SDK-ready label;
  other ready-phase details stay visible. Renderer typecheck/lint passed after
  this correction; new package/smoke in progress. Full unit coverage above predates
  this narrow presentation correction; packaged recovery scenario is its regression.
- Final preview command passed build, container checks, complete packaged smoke
  (including power-resume resync), identity creation and artifact launch, PID 10499.
  app.asar SHA-256: `fe82f3d138f1c04884a6360117c8ef6818080f6b4de5bc9310ed7589cc04957d`.
  Receipt: artifacts/release/macos-preview-candidate-identity.json.
- Native Computer Use confirms dark shell widths, compact stopped view and filter
  entry. The user-profile catalog was still loading in the capture; hydrated
  navigation/state behavior is covered by browser fixtures and isolated packaged
  smoke, not claimed from that native screenshot. Windows remains unverified.
- Scoped visual consistency passes in reviewed light/dark browser states and native
  shell. No performance claim, no commit/push/upload/release. Second batch deferred.
