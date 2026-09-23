# Neutral dark theme

Status: completed
Owner: Codex
Started: 2026-09-23
Last updated: 2026-09-23

## Goal and acceptance

Implement the approved Grok Bot / Geist-informed neutral dark theme: near-black
canvas, gray surfaces and selection, light primary actions, readable secondary
text. Preserve semantic status, focus, and code colors. Normal enabled text must
meet 4.5:1 against its actual surface. Verify settings, composer, navigation,
menus, selected/hover/disabled/focus states, and light/system theme behavior.

## Delivery boundary and non-goals

Local renderer/CSS and authority changes, relevant tests, browser visual review,
and macOS unsigned packaged preview. No commit, push, upload, release, new theme
option, layout change, dependency, protocol, or persisted-state change.

## Evidence and affected boundaries

- Base HEAD: `70162447ed1d7fd6b5253f0c86039ab365daf72c`; implementation is dirty-tree
  local preview evidence, not a clean exact-SHA distributable candidate.
- Existing user screenshot and unchanged pre-edit tokens establish the baseline:
  green-tinted backgrounds, borders and text, with dim metadata.
- Official reference values were read in the planning conversation through
  browser67; Grok evidence is an article demo, not its authenticated product.
- Frontend route: L2/system, approved authority evolution, main serial;
  actual skills: design-craft and browser67. No delegated agents.
- Pre-existing WIP: AGENTS.md, DESIGN.md, PRODUCT.md, agent-host attachment test,
  external-references.md, untracked design-preview/, two prior plans and design
  interaction reference guide. Preserve all of it; append only scoped authority
  and reference changes. Runtime/security boundaries are unchanged.

## Decisions

- Target values live in DESIGN.dark.md and existing semantic tokens.
- Composer dark background uses surface-muted; light remains surface-raised.
- Primary controls already pair accent fill with canvas-colored content.
- Keep green for success/additions, other semantic colors and syntax unchanged.

## Checkpoints and validation

- [x] Baseline, authority, source routing and reference decisions inspected.
- [x] Implement scoped palette, composer surface, authority/reference updates.
- [x] Renderer typecheck, theme tests, contrast/state/theme E2E and source gate.
- [x] Browser visual review of synthetic workbench and settings in both themes.
- [x] macOS unsigned preview: package, smoke, identity, open, native inspection.

## Rollback

Reverse only this task's token/composer and documentation hunks; remove only its
new test/plan if requested. Never restore entire dirty authority files. A failed
packaged preview does not authorize publishing, profile reset or artifact cleanup.

## Risks and unknowns

Mixed-color components need rendered inspection after changing accent to white.
Source tests and browser fixtures do not prove packaged/native behavior. Windows
manual validation is unavailable locally and will remain explicitly unverified.

## Closeout

- Theme-controller unit tests: 6 passed. Renderer typecheck passed.
- Renderer bootstrap + final dark-theme contrast/action/theme-switch E2E: 2 passed.
  Settings layout/state matrix: all 6 cases passed (light/dark × 1440/1000/720).
- Final test typecheck and type-aware lint passed. Source static gates passed,
  including architecture, dependency boundaries, provenance, structure and transport.
- Initial unconstrained aggregate had 3 Host failures (two timeouts, one missing
  response); all 13 tests in those three files passed with one worker. The bounded
  two-worker coverage run passed: 882 files / 5738 tests, 9 files / 24 tests skipped;
  branches 78.45%, statements 84.02%, functions 87.24%, lines 87.65%.
  The first E2E attempt also overlapped a
  protocol dist rebuild; discard it as interference, not theme evidence.
- The source gate found Composer.module.css exceeded its existing limit by one
  line; the single-property dark shell rule now uses the file's existing compact
  rule style with identical semantics. Structure gate passed afterward.
- Visual review: neutral canvas/sidebar/composer hierarchy; light primary action
  with dark content; readable text, selected items, focus ring, contextual menu
  and settings; no observed blocking inconsistency in reviewed states. Light
  settings remain unchanged. Browser fixtures are synthetic; no model request.
- Contrast: primary/canvas and primary action 16.91:1; tertiary/active 5.11:1.
  Light token block equals HEAD byte-for-byte. Dark role contrast and actual
  enabled/hovered send-button contrast are checked by the new browser regression.
- Screenshots: `artifacts/visual-review/neutral-dark/neutral-dark-composer.png`,
  `neutral-dark-settings.png`, `unchanged-light-settings.png`; browser67 captures
  `browser-dark-menu.png`, `browser-dark-settings.png`, `browser-light-settings.png`.
  `verification.json` binds their dimensions and hashes (all ignored output).
- browser67 Chrome managed validation tab finalized: closed=1, verified=1,
  remaining_unkept=0, errors=0; user's unrelated tabs preserved.
- `corepack pnpm run preview:mac:unsigned` passed: build, DMG/ZIP native container
  verification, full packaged smoke, candidate identity and new artifact launch.
  Version 0.1.0-alpha.41, Pi 0.86.1, darwin/arm64; source.clean=false is recorded.
  Identity: `artifacts/release/macos-preview-candidate-identity.json`.
  app.asar SHA-256: `652084b5a49af53c574fe711ff9342ab0d96bd6b6b5d0f831f0a612c052b5817`.
- Native Computer Use screenshots confirm the old green baseline changed to
  neutral near-black panels and a light primary action in the new bundle.
  Follow-up native pointer control returned `noWindowsAvailable` despite the
  verified running artifact; no expanded manual native interaction claim is made.
  Interaction/state acceptance comes from Chromium tests, browser67 observations
  and packaged smoke. Windows remains unverified.
- System consistency verdict: pass for the scoped palette, reviewed browser
  surfaces and native rendered appearance; no blocking visual issue observed.
- No commit, push, upload or release. Existing unrelated WIP preserved.

## Authorized light-theme follow-up

The user subsequently approved extending the neutral palette to light mode.
This supersedes the earlier light-token-preservation boundary, not the dark result.
Keep the same layout, controls, semantic status/focus/code colors and delivery
boundary. No new runtime, dependency, API or persisted-state changes.

- [x] White canvas, neutral gray surfaces/text/borders/shadows and black primary
  actions implemented in the existing light tokens; DESIGN.md updated.
- [x] Both-theme contrast/action/system/manual-switch tests and settings matrix.
- [x] Browser visual review and refreshed macOS packaged preview/native screenshot.

Extend the existing regression to both themes in renderer-neutral-theme.spec.ts.
Use the same scoped rollback rules. Prior dark-only evidence above remains
historical; current light acceptance must use new screenshots and receipts.

Follow-up evidence:
- Renderer and test typechecks, type-aware test lint, structure and references pass.
- 6 settings cases passed; bootstrap plus both theme contrast/action/theme-switch
  cases passed. The initial hover sample was too early in the CSS transition;
  the regression now waits for the computed hover color before asserting, keeping
  the original contrast and state-distinction checks.
- Browser visual review passes for the scoped neutral light workbench/settings;
  browser67 tab finalized (closed=1, verified=1, remaining=0). Dark regression passes.
- New screenshots/manifest: `artifacts/visual-review/neutral-theme/`.
- Only CSS values, authority/docs and the browser regression changed in this
  follow-up. The preceding full unit/coverage result above is not a new run;
  no runtime TypeScript or unit-test input changed. Packaging smoke is rerun.
- Refreshed macOS unsigned preview passed build, archive verification and packaged
  Electron smoke; the repository artifact reopened successfully (PID 55072).
  app.asar SHA-256: `2e70fa93b2a987a8a38062cead44cd7529e5762ae20d23ef5139de3783ca69bd`.
  Identity: `artifacts/release/macos-preview-candidate-identity.json`.
- Native Computer Use screenshot confirms the user-reported light screen now has
  a black Open Conversation button with white text, neutral gray selected row and
  side panels, and a white conversation canvas. No blocking visual issue observed.
  Windows remains unverified. No commit, push, upload or release performed.
