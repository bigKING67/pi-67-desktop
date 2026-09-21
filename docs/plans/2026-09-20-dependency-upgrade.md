# Desktop dependency upgrade and performance comparison

Status: complete — local dependency upgrade, authorized cleanup and macOS preview delivered; measured performance exceptions and Windows certification remain open
Owner: Codex
Started: 2026-09-20
Last updated: 2026-09-21

## Goal and acceptance

Upgrade Electron to 43.7.3, React/React DOM and their types to 19.3.0,
Vite to 8.3.0, its React plugin to 6.1.1, and all four Pi suite pins to 0.86.1.
Keep TypeScript 7.0.2 and React Compiler 1.0.0. Preserve Desktop behavior while
adopting SDK transcript semantics; add the bounded usage-entry protocol source
and regenerate the schema revision. Verify compatible production rendering and local
macOS runtime behavior; measure before/after with the existing performance budgets.

## Delivery boundary

- Local implementation, isolated offline tests, macOS packaging/smoke and preview.
- No commit, push, remote CI dispatch, upload, signing, release or promotion.
- No paid Provider calls or user Session/credential fixtures.
- Windows and real-model SDK certification remain unverified; the SDK is a local
  upgrade candidate, not a fully certified supported-version assertion.
- No native UI rewrite, Electron 44, unrelated dependency sweep or new runtime.

## Current evidence and WIP

Starting HEAD: `5b0bfac4853168560e7c049368a8f6e1c74393d5`, branch `main`, dirty.
Existing changes: AGENTS.md, DESIGN.md, PRODUCT.md,
apps/agent-host/src/prompt-attachment-access.test.ts,
docs/provenance/external-references.md, renderer design-preview, existing local
artifact/workbench plans and design-interaction references. Preserve unrelated content.
On 2026-09-21 the user authorized bounded design-preview config fixes, updating
stale E2E contracts, production audit remediation and the standard macOS preview.
Performance budget optimization remains a separate task.
Protected-file hashes and baseline lock identity are stored in ignored
`artifacts/performance/dependency-upgrade-2026-09-20/baseline-identity.json`.

## Checkpoints

- [x] Baseline: production build and ten-sample standard performance scenarios.
- [x] Electron batch: all declarations aligned, native boundary tests/build.
- [x] React batch: renderer types, query subscriptions, transcript and input tests.
- [x] Toolchain batch: Compiler/Babel/Rolldown compatibility and production build.
- [x] Pi batch: release review, exact pins, SDK/Session/Extension regression tests.
- [x] Final source gate, production Renderer E2E and local Electron E2E.
- [x] After measurements and evidence closeout for the three desktop batches.
- [x] Final SDK macOS packaged smoke.
- [x] Normal macOS preview after aggregate gates clear.

## Validation and evidence

Use affected-package checks first, then final `check:source`; dependency changes
require full validation routing. Use production Renderer E2E and native-only
Playwright configuration. Performance reports use separate batch filenames and
at least ten samples, fixed synthetic fixtures and the same host; record p50/p95,
source/lock identity and budget failures without weakening budgets. Tests and
synthetic browser results do not prove physical IME or Windows behavior.

Read the Pi compatibility and candidate distribution contracts before their
operations. Real-model smoke and Windows certification are explicitly excluded
from this delivery and must remain visible in compatibility documentation.

## Rollback

Keep batches sequential. Fix introduced regressions within scope; if a batch
cannot be made compatible, reverse only this task's batch changes and matching
lockfile changes. Never reset/revert unrelated WIP. Preserve passing earlier
batches and report any baseline failures separately. Public API, persistence or
product changes required by an upgrade trigger a scope decision before adoption.

## Progress

- 2026-09-20: Scope approved including SDK with explicit Windows/paid-model gaps.
  Live Git/WIP and manifest locations rechecked; no dependency edits yet.

- Baseline harness repair: executable lookup still used the old product name on
  both platforms. Aligned it with existing electron-builder New Money names and
  added packager/harness agreement coverage in the branding contract test.
- Baseline Node Session-open/projection/catalog/tail suites passed; production
  Renderer ten-sample suite passed. Packaged Electron sampling is in progress.
- SDK source review: 0.86.0 changes provider input to TranscriptContext, persists
  prompt/tool updates, and defaults paid cache warming to streaming. This crosses
  the accepted no-product/persistence-change boundary. User clarification is
  pending for runtime-only suppression of warming plus transcript adaptation;
  other batches continue. No SDK dependency edits before that decision.

- Baseline complete (ten samples): Node and Renderer gates pass. Existing packaged
  failures: clean-profile launch p95 3214.518 ms / 3000 ms, Welcome assets
  0.729 / 0.60 MiB, runtime assets 0.513 / 0.40 MiB, Welcome working set
  353.891 / 350 MiB. These predate dependency edits; do not claim a passing
  baseline or weaken budgets. Electron batch started after all samples ended.

- Electron 43.7.3: Desktop/Host typechecks and builds pass; 20 targeted tests and
  both native shell/Profile authority E2E scenarios pass. Actual Electron CLI
  reports v43.7.3.
- React 19.3.0/types: renderer typecheck/build and 138 tests across 30 files pass.
- Vite 8.3.0/plugin-react 6.1.1 installed; obsolete 6.0.4 release-age exception
  removed. Frozen install passes. Final source and production Renderer E2E gates
  in progress; Compiler remains 1.0.0 and its preset remains enabled.

- Full check:source reached lint and failed on pre-existing untracked renderer
  design-preview (unused ChevronDown, missing PNG/CSS declarations). Supplemental
  lint excluding only that protected WIP passes; it is not aggregate-gate PASS.
  Architecture also fails on its vite.config.ts importing node:url. No WIP edits.
- Production Renderer bootstrap failed on an unhandled enterprise.identity.get
  mock. Reproduced against assets extracted from the exact pre-upgrade app.asar;
  added the schema-valid signed-out default, retaining explicit test overrides
  and unknown-command failure. Full Renderer E2E resumed.
- Production audit reports nine high xmldom 0.9.11 advisories in the unchanged
  officeparser chain; existing workspace override pins that version. This is an
  existing separate dependency risk, not silently expanded into this upgrade.
- Dead-code, references, structure, production transport, workflow PowerShell,
  pinned Actions and Extension Adapter verification pass.
- browser67 managed-tab check could not render the standalone production page
  without Electron/mock preload bridge (root empty); not UI PASS. Exact managed
  tab finalized and closed, zero remaining; no user tabs modified.

- Unit/integration coverage run: 869 files / 5682 tests passed; 9 files / 24 tests
  skipped by environment. This standalone invocation used Vitest default workers
  (CLI separator did not select 2); no timeout/failure observed. Full check:source
  remains blocked by protected design-preview lint, irrespective of this result.

- Final native E2E: 7 passed on macOS arm64 / Electron 43.7.3. Production
  Renderer E2E: 220 passed, 1 skipped, 14 failed after the mock bootstrap repair.
  Re-ran the exact failing cases against the extracted pre-upgrade renderer:
  all 14 failures reproduce (plus one passing case). Failures concern stale
  command-list assertions and account/settings selectors; no claim of full E2E
  PASS. Upgraded renderer dist restored after comparison.
- Packaged smoke reached the final memory-settings stage, then failed with a
  process-close timeout. One isolated rerun of that stage passed encrypted save,
  secret-free readback, reveal/hide, cold-process readback and explicit private
  activation. Full smoke remains a failed invocation; isolated pass does not
  erase the timeout or establish its root cause. All credentials were synthetic
  and the test enforced a temporary userData profile.
- Post-upgrade Renderer ten-sample measurement passes every budget. Projection
  p95 404.3 -> 414.3 ms; composer input-to-paint p95 8.6 -> 8.5 ms; retained heap
  after ten switches p95 delta 4.074 -> 4.082 MiB. No material speedup established.
  Node performance inputs are unchanged with the SDK held; retain baseline
  Node evidence without an unnecessary rerun. Electron comparison in progress.
- All 28 protected WIP file hashes remain unchanged. No commit, push or release.

## Desktop batch closeout

Electron comparison completed with ten samples. Warm launch p50 817.757 ->
772.827 ms; p95 921.337 -> 785.054 ms. Clean launch p95 3214.518 -> 489.931 ms,
but its baseline outlier prevents attributing the entire reduction to upgrades.
Three budgets remain failed: Welcome assets 0.753 / 0.60 MiB (before 0.729),
runtime initialization assets 0.500 / 0.40 MiB (before 0.513), Welcome working
set p95 354.969 / 350 MiB (before 353.891). No budget changes or claimed broad
performance win. Full metric table and evidence limitations:
`artifacts/performance/dependency-upgrade-2026-09-20/comparison.md`.

Source-quality/architecture, existing Renderer E2E and production audit remain
failed as detailed above. The full smoke invocation also remains failed despite
the isolated memory-stage pass. Final preview was not run because relevant gates
have not passed. Existing source/product WIP was not changed to bypass gates.
Scoped diff whitespace check passes and all 28 protected hashes still match.

The initial SDK hold below was superseded by explicit user authorization and the
0.86.1 implementation checkpoint. These local batches are not a release.

- 2026-09-20: User explicitly requested proceeding with the SDK upgrade. Scope now
  includes suppressing optional paid cache warming through supported runtime
  settings and adapting upstream transcript semantics, with targeted regressions.
  Previous pending-scope checkpoint is superseded; no renewed permission needed.

## SDK implementation checkpoint

- All four Pi family pins are now 0.86.1. pnpm added exact release-age exceptions
  for that newly released upstream family (including Chord and telemetry).
  Upstream Chord introduces esbuild; its binary install script is explicitly
  admitted and frozen installation passes. No general dependency sweep.
- Desktop Session settings use a runtime-only view returning cache warming off,
  including after resource reload. Disk/global settings remain byte-identical in
  the regression. Shared settings writes remain visible between Task views.
- Adopt upstream normalized TranscriptContext in synthetic providers and stream
  tests. JSON Tool fixtures use the SDK's JSON types. DeepSeek catalog test tracks
  the upstream rename to deepseek-flash without registering a local model alias.
- System/tool transcript records remain Pi-owned, hidden from conversation pages
  and conversation stats, with body-free Session tree descriptions. Catalog
  message-entry metadata intentionally remains aligned with SDK cold discovery.
  Imported standalone usage entries contribute to totals through usage-entry;
  protocol schema revision regenerated.
- Real SDK synthetic prompt/reopen/branch regression passes: structured sections
  and tools persist; run-local forced prompt projection is reapplied by Desktop
  Extensions on resume. Existing forced prompts are not falsely claimed durable.
- Targeted runtime/domain/protocol run: 1300 passed, one stale revision failure
  corrected by schema regeneration. Final all-package typecheck/build pass.
  Native Electron E2E on rebuilt protocol: 7 passed. Earlier native sample was
  invalidated by concurrent revision regeneration, not counted as runtime PASS.
- Packaged smoke found the removed mariozechner clipboard dependency path.
  Pi 0.86.1 now ships the platform helper under pi-tui/native; verified the new
  binary in the package and updated the fail-closed asset check for both supported
  platform paths. Windows execution remains unverified.
- One full coverage invocation overlapped the final catalog-count test edit and
  failed with mixed old module/new test inputs. The corrected targeted test passes;
  final coverage is being rerun against frozen source. Do not combine that earlier
  failed invocation into a full PASS. Final packaging/smoke and performance pending.

- Final rebuilt macOS arm64 package smoke PASS (SDK 0.86.1): packaged-direct Host
  startup, offline synthetic turn, warm/cold Session restoration, image assets,
  Extension shutdown, runtime UI, encrypted memory settings and private activation.
  Artifact hashes are in `after-sdk-identity.json`; no paid model was invoked.
  This supersedes the earlier desktop-only smoke limitation for the final artifact,
  without claiming the old shutdown timeout's root cause has been proven.

- Final frozen-source coverage PASS: 870 files / 5687 tests, 9 files / 24 tests
  environment-skipped. Statements 84.06%, branches 78.47%, functions 87.30%,
  lines 87.69%. Final targeted packaging/projection regressions 20/20 PASS.
  Supplemental lint excluding protected design-preview passes; full source gate
  still stops only on that pre-existing WIP. Dead-code, structure, production
  transport and Extension Adapter checks pass. Production audit remains nine high
  and two moderate advisories in the unchanged dependency chain.
- Final SDK Node performance suites (ten samples) pass: Session open, projection,
  bounded JSONL tail, and catalog. Renderer and packaged Electron sampling remain
  in progress. Previous desktop-only comparison is historical, not final SDK evidence.

## Final local delivery (2026-09-21)

All four dependency batches are implemented, including Pi SDK 0.86.1. Final
frozen-source unit/integration coverage, typechecks, build, seven native E2E cases,
macOS arm64 packaged smoke and the targeted SDK persistence/setting regressions
pass. Five performance suites pass; Electron retains the three existing failed
budgets, with no new failure. Final warm-launch p50 770.018 ms, p95 1254.189 ms;
input-to-paint p95 8.7 ms. No broad speedup claim.

Evidence: `artifacts/performance/dependency-upgrade-2026-09-20/comparison-final.md`
and `after-sdk-identity.json`. Previous desktop-only reports remain historical.

Aggregate acceptance is still blocked by protected design-preview lint/architecture,
previously reproduced stale Renderer E2E assertions, existing dependency audit
advisories and the three performance budgets. Normal preview was not relaunched;
no commit/push, Windows, paid-model, installer distribution or release claims.
Existing WIP is intact: all 28 original contents match when excluding this task's
additive PRODUCT policy paragraph. No user credentials or histories were changed.


## Authorized cleanup (2026-09-21)

- Fixed the independent design-preview Vite root without Node imports, included
  its nested TS/TSX files in its project, and removed one unused icon import.
  No design content, layout or token was changed. Preview typecheck/build and
  real Chrome DOM/image loading pass; browser67 managed tab finalized (one closed,
  zero remaining, no errors). This was functional verification, not visual review.
- Updated stale Renderer contracts to the current New Money account authority:
  explicit startup identity reads are excluded from scenario mutation assertions;
  account labels, signed-out controls, and memory draft/account handoff are covered.
  Dirty-draft navigation, saved payload/revision and archive feedback remain tested.
- Pinned the officeparser transitive xmldom 0.9 branch to 0.9.12, the upstream
  security patch. Production audit: zero advisories of all severities. Frozen
  install and real Office attachment parsing regression (4 tests) pass.
- Complete source gate PASS: 870 files / 5687 tests passed; 9 files / 24 tests
  skipped; all coverage thresholds pass. Complete production Renderer E2E PASS:
  234 passed / 1 skipped. The targeted predecessor run passed all 32 cases.
- Evidence prefix: `artifacts/performance/dependency-upgrade-2026-09-20/cleanup-`.
  Standard macOS unsigned preview completed successfully. Earlier aggregate blockers
  above are historical; the three measured performance budget failures remain
  open for a separately scoped optimization task. No performance budgets changed.

- Standard `preview:mac:unsigned` PASS: full build, unsigned DMG/ZIP, packaged
  smoke, native archive verification, candidate identity and repository app launch.
  Host initialization 909 ms; controlled active-prompt shutdown 77 ms. Normal
  native window observed at `app://pi67/index.html`; existing Workspace/catalog
  shell loads. No real model call or full user-session compatibility claim.
- Candidate identity: `artifacts/release/macos-preview-candidate-identity.json`,
  SDK 0.86.1, app version 0.1.0-alpha.41, `source.clean=false`; local dirty preview
  only, not a committed/exact-SHA distribution. No archives removed by retention.
  Latest app.asar SHA-256:
  `2b67c322b5d3cc891ab69d23c28f9129d55eca04ea9d3b3d874d9bdc0acb670a`.
- Original 28-file WIP hash check: only the previously documented additive PRODUCT
  policy and three explicitly authorized design-preview files differ. Other
  original WIP is unchanged. No commit, push, upload or release performed.

## Local commit boundary extension

The user's continuation after the explicit scoped-commit recommendation extends
the original local-only delivery boundary to one scoped local commit. Push,
remote CI, upload, release and paid Provider calls remain unauthorized. Stage
only the upgrade, compatibility, accepted startup changes, corresponding tests
and authority clauses. Preserve design-preview, design-reference/governance WIP
and the pre-existing attachment test change. The latest local functional
follow-up passed 7 native and 26 Renderer checks; performance and Windows/real
Provider limitations remain open. Validation was performed in the dirty local
checkout, not an isolated exact-commit candidate.
