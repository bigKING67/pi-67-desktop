# Context/Memory Settings layout

Status: implemented; native representative visual review blocked
Owner: Codex
Started: 2026-09-07
Last updated: 2026-09-07

## Goal and acceptance

Apply the accepted critique: three neutral tabs, privacy-first grouped radios,
one page Save, concise copy, service-local Test, no doubled section spacing,
and move current-session archive to Memory Inspector. Preserve privacy, command,
and session ownership semantics. Verify keyboard/drafts, both themes, narrow
layout, sibling tab parity, and macOS packaged preview.

## Delivery boundary and non-goals

Local implementation and validation authorized. No commit, push, upload, release,
provider request, real enterprise sign-in, or memory-policy expansion.
No new dependencies, protocol, persistent state, or runtime ownership.

## Current evidence and affected boundaries

Initial Git status clean. During work, unrelated Agent Host Skill Pack/Lark changes and a separate PRODUCT paragraph/protocol document edit appeared; preserved, not owned by this task. User screenshot and source confirm card-heavy privacy
choices, 24px grid plus 40px section margin, and service-local global Save.
Renderer Settings/Memory Inspector and PRODUCT/DESIGN documents only.
Pi/Host commands unchanged. Shared tab styling has two real callers: Lark and
Context/Memory. Browser fixtures are synthetic; packaged host evidence separate.

## Decisions

Use existing React Aria Tabs/Radio primitives and Settings tokens. Shared draft
lives above panels. Use existing unsaved-settings registration. Connection test
is disabled while draft is dirty so diagnostics cannot overwrite pending edits.
Current-session archive retains the existing Controller command.

## Checkpoints

- [x] Read authority and confirm clean source baseline.
- [x] Implement and update authority.
- [x] Verify draft/keyboard/save/archive behavior and browser layout; native dark sibling comparison completed in the follow-up.
- [x] Run aggregate source gate (PARTIAL recorded), macOS package/smoke/relaunch (PASS).

## Validation

- Renderer typecheck, tests TypeScript, targeted oxlint and `git diff --check`: PASS.
- Playwright `renderer-context-memory-settings.spec.ts`: 2/2 including bootstrap; verifies keyboard radio, shared draft, navigation guard, one save, one current-session archive.
- Browser67 real Chrome with synthetic Desktop/Agent bridge: reviewed privacy in dark/light at 1440x1000, light 760x900, enterprise and advanced in light. Neutral hierarchy/spacing and no horizontal overflow observed. Evidence: `artifacts/context-memory-layout/browser-evidence.json`. Managed tab finalized, closed=1, remaining=0.
- Aggregate `corepack pnpm run check`: PARTIAL. Protocol/type/lint/architecture/dead-code/reference/structure/transport/workflow gates passed. Coverage first hit shared-output ENOENT while another coverage process was active. Isolated coverage with `--coverage.reportsDirectory=artifacts/context-memory-layout/coverage --maxWorkers=2`: 679 files/3469 tests passed, 2 files/5 tests skipped; one unrelated release-test afterEach cleanup ENOTEMPTY. That exact file passed 3/3 in isolation; aggregate remains non-green. Logs kept in `artifacts/context-memory-layout/`.
- `corepack pnpm run preview:mac:unsigned`: PASS, exit 0. Fresh package, packaged smoke, DMG/ZIP verification and relaunch completed. app.asar SHA-256 `923f5e64f90962e9d09b27b0f23ecc9ccac14122a2b02b20e6863efea2772ef0`, 198070379 bytes; base HEAD `d9922ce337853df6f37e9912ae89adb1377ee51f` plus uncommitted WIP. Log: `artifacts/context-memory-layout/preview.log`.
- Native visual review: real app://pi67 macOS arm64 Settings page inspected through Computer Use; new tabs, grouped radios, top Save and compact service group confirmed in screenshot/AX. No real privacy change or archive submitted. Subsequent sibling comparison stopped when a concurrent preview lifecycle replaced the window; no stable-process/sibling-native-comparison claim. Windows is not covered.

## Rollback and risks

Revert only this task's diff on request; no migration needed. Preserve all newly
arriving unrelated WIP. Risks: tab switching loses draft, test overwrites draft,
archive targets wrong Session, incomplete keyboard or narrow/theme behavior.

## Closeout

Local implementation complete; no commit/push/upload/release. Current source includes
unrelated parallel Agent Host work and a separate PRODUCT hunk, preserved intact.
Local preview is not an exact-SHA distribution candidate. Browser layout review
passes the inspected scope; full cross-surface visual sign-off remains incomplete
for native theme/state coverage. The initial aggregate results below were PARTIAL;
the subsequently authorized stability follow-up is recorded separately below.

## Follow-up verification (2026-09-07)

User requested continuation. HEAD and task diff rechecked, unrelated WIP preserved.
The live app.asar hash still matches the packaged evidence above. Computer Use
returned a real native Lark user-tab screenshot; its title alignment, tab height,
neutral selected state, underline and grouped rows match the prior native Memory
page. No sign-in, token refresh or privacy change was invoked. Further navigation
was stopped after the Computer Use target reported noWindowsAvailable / changed
application; this is an automation limit, not evidence of an app crash.

A bounded full coverage rerun uses a separate output directory and two workers
(`artifacts/context-memory-layout/coverage-followup.log`). Result: 679 files /
3469 tests passed; 2 files / 5 tests skipped; one failure in
`prompt-attachment-access.test.ts:353`, the 5000ms recovery-scan test timeout.
The earlier unsigned-preview cleanup test passed in this full run. Single-file
attachment diagnosis with coverage sampling passed 17/17 (tests 3.19s; total
5.01s); whole-project coverage thresholds were disabled only for that per-file
diagnostic, so it is not an aggregate quality-gate result. No test timeout,
assertion, production code or repository threshold was changed. Aggregate
remains PARTIAL; the evidence supports execution-time sensitivity, not a proven
attachment correctness defect. No repeated full-suite rerun was used to obtain
a green sample.

Native dark sibling comparison is now verified; native all-theme/interaction
matrix remains outside the evidence captured here. Source/product files are
unchanged in this continuation; only this evidence record was updated.


## Bounded stability fixes (2026-09-07)

The next user continuation authorizes resolving the two observed validation
failures. Scope adds the attachment capacity test fixture and unsigned-preview
artifact preparation helper/tests; no attachment runtime, protocol, timeout,
coverage threshold, dependency or distribution operation changes.

- Capacity setup previously called claim 128 times and scanned 8128 preceding
  manifests. Seed 127 valid private on-disk sets, then actually claim the 128th;
  retain full-bound rejection with draft preservation, replay of seeded and real
  claims, and recovery through a replacement owner.
- Preview preparation previously rejected Promise.all while sibling renames and
  hashing could still run, racing fixture cleanup. Validate all three sources
  before mutation, then process artifacts sequentially. Regression tests cover
  an invalid symlink at every position and a second-artifact rename failure.
  A later I/O failure can retain already moved artifacts; this is not a rollback
  transaction. No new success manifest is written on those failure paths.
- Targeted attachment/release/promotion/R2 bundle regressions: 4 files, 35 tests
  passed. Full unchanged check chain runs with VITEST_MAX_WORKERS=2, a supported
  local Vitest option; no other Vitest process was active at launch. Log:
  artifacts/context-memory-layout/check-stable.log.

The already verified macOS UI artifact remains the UI evidence. This follow-up
changes test fixtures and release preparation tooling only, so it does not
require rebuilding the application renderer. No commit/push/upload/release.


Final stability validation: PASS. `VITEST_MAX_WORKERS=2 corepack pnpm run check`
exited 0, including all source gates and unchanged coverage thresholds. 680 test
files / 3473 tests passed, 2 files / 5 tests skipped; duration 150.69s. Coverage:
statements 82.35%, branches 76.33%, functions 86.35%, lines 86.24%.
`git diff --check` also passes. Earlier PARTIAL runs remain diagnostic history;
this completed run resolves the aggregate gate blocker.

At final status inspection, unrelated Agent Host changes were no longer dirty
because concurrent work had advanced Git; they were not reverted or staged by
this task. The packaged UI evidence remains bound to its recorded earlier source
and app.asar, not automatically to the newly advanced HEAD.


## Settings-wide implementation (accepted 2026-09-07)

User approved the complete Settings unification plan and explicitly deferred
setting-item search. Keep the account route as 账户与数据. Four groups: 通用,
AI 配置, 连接与集成, 系统与支持. Keep all 16 category IDs and scope policies.
Preserve the 1120px outer alignment frame, with a left-aligned 880px standard
page and full-width model/resource/editor/usage pages. Shared neutral Tabs,
28px header gap, 32px section gap and 12px section inner gap. Whole-page Save
belongs in the header; provider and credential edits remain local transactions.
No new dependencies, protocol, persisted state, account integration or search
navigation. Renderer-only source changes plus authority/tests; existing Host,
release and concurrent repository-worktree WIP must remain intact.

- [x] Shared layout, categories, account copy, tabs and page actions.
- [x] Settings behavior/layout regression and source gates plus isolated full coverage.
- [x] Browser67 light/dark/wide/narrow review, all category coverage.
- [x] Fresh macOS package/smoke/relaunch.
- [ ] Native representative Settings visual review: Computer Use interaction blocked.

Rollback is scoped reversal of this extension's diff, preserving the earlier
Memory layout and unrelated WIP. No commit/push/upload/release authorized.

### Settings-wide delivery evidence

Implementation uses design-craft, L2 main-serial execution, and the explicitly
approved evolution of DESIGN.md / DESIGN.dark.md / PRODUCT.md. No sub-agent was
spawned. Shared page layout retains one left edge, 880px standard content and
1120px wide content, with wrapping header actions and neutral page Tabs. Account
copy distinguishes local storage from requests to configured services. Category
search and aliases remain; setting-item search is deferred. Provider/credential
save boundaries and Memory privacy/ownership semantics remain unchanged.

Evidence is ignored output under `artifacts/settings-unification/`:

- Renderer/test typechecks, targeted lint, navigation tests (3/3), renderer build
  and `git diff --check` passed. `check.log` passed every source gate, then hit a
  5000ms session-index test timeout during observed concurrent coverage work.
  The exact diagnostic file passed 8/8. After concurrent coverage ended, full
  isolated coverage exited 0: 681 files / 3481 tests passed, 2 files / 5 tests
  skipped; statements 82.4%, branches 76.34%, functions 86.41%, lines 86.3%.
  Thresholds/timeouts were not relaxed. This is source gates plus a separate
  complete coverage run, not a claim that the first aggregate command exited 0.
- `e2e-resources.log`: 22 passed. `e2e-final.log`: 10 passed, including six
  all-category geometry cases and three state cases. The failed Network save
  regression verifies draft retention and retry from the page header. Memory
  keyboard/draft/connection/archive flow also passed in the preceding batch.
- `browser-evidence.json` selects 96 actual browser67 captures: all 16 categories
  in light/dark at 1440/1000/720 widths. Contact sheets and representative full
  screenshots were visually reviewed. These use a synthetic bridge fixture,
  not real service verification. Invalid pre-workspace captures are excluded;
  Memory/Usage loading-only samples and one timeout were replaced by valid
  loaded captures. No alignment or horizontal overflow regression was observed.
  The one dedicated managed tab was closed and verified, with zero remaining
  task tabs/errors; the task Vite server was stopped. User tabs were preserved.
- `preview.log`: `preview:mac:unsigned` exited 0, packaged Electron smoke passed
  on darwin/arm64, and the exact repository app was reopened. app.asar is
  198068894 bytes, SHA-256
  `8c9cf9d5067b06e83a55dd4ca744cbeb313e3dd5aab37b77233ae73ac2f302dc`.
  Source is the dirty checkout over HEAD
  `5cd32af15505d77f5c0358b8e0e3757f4862741f`, not an exact-SHA release candidate.
- Computer Use confirmed the fresh native workbench window visually, but its
  AX tree exposed only window chrome. Settings keyboard actions produced no
  visible navigation and coordinate click returned `noWindowsAvailable`.
  Native representative Settings review remains UNVERIFIED. This is an
  automation limitation, not evidence of an application crash. Windows and
  real service/account operations were not tested.

No commit, push, upload or publication occurred. The packaged app is left open
for local review. The remaining native visual check is explicitly outstanding;
implementation, automated regressions and browser visual review are complete.

## New Money naming continuation

User selected New Money as the public name, expressing creation of new value
with AI, and explicitly retained the existing 67 graphical mark. Brand and mode
identity are separate: bull for Work, horse for future Chat. No mode controls,
mode assets, icon replacement or explanation of private wordplay is shipped.
The mistakenly introduced bull brand asset was removed before delivery.

This bounded L1-V design-craft/main-serial naming change updates navigation,
context-free TitleBar, document title and About copy, with PRODUCT/DESIGN
authority updated. Native package/app IDs, release names, storage paths and
other legacy operational copy remain unchanged; this is not a full rebrand.

Renderer/test typechecks, targeted lint and diff whitespace checks pass. E2E
batch: 19/20 passed; the settings keyboard-navigation timeout passed in its
isolated follow-up (bootstrap + exact test, 2/2), without timeout/assertion
relaxation. Extension Host title restoration uses New Money and passed.
The earlier account heading expectation was corrected to the already accepted
账户与数据 label. Logs are under `artifacts/new-money-brand/`.

Actual browser67 review covers the original mark plus new wordmark in dark
1440x920 and light 1000x800, and About in both themes at 1000x800. Static brand
scale, text fit, shared alignment and contrast are consistent with the existing
shell. Synthetic bridge only; no real account/service writes. The dedicated tab
was finalized: 1 closed/verified, 0 errors/remaining. Task Vite was stopped.

Fresh macOS preview is BLOCKED for this naming change: both the initial build
and one bounded retry failed in electron-builder with `Client network socket
disconnected before secure TLS connection was established`. Renderer builds
passed, but native packaging/smoke/relaunch did not complete. The preview command
quit the preceding app before packaging; no new preview is claimed open. Logs
are copied under `artifacts/new-money-brand/`. The preceding Settings package
evidence does not validate this newer naming change. No commit/push/publication.

## Display-name closeout (2026-09-08)

The user approved continuation through public-copy completion, packaging and
native validation. Preserve the existing 67 graphical mark. Renderer product
copy, accessible regions, welcome/approval/update text, file actions, native
notification bodies, About panel and platform display metadata use New Money.
Pi runtime/resource names and technical release/package/installation IDs stay
stable. Windows shortcut/uninstall display labels are changed in source only;
Windows runtime remains unverified. No Work/Chat mode implementation is added.

`check-final.log` exited 0: 704 test files / 3659 tests passed, 2 files / 5 tests
skipped. Coverage: statements 82.65%, branches 76.67%, functions 86.6%, lines
86.53%. Relevant renderer E2E: 45/45 passed. Branding/notification/preview tests:
12/12 passed. Subsequent smoke-test assertion corrections passed targeted lint
and test typecheck; they do not change the packaged application.

Network downloads succeeded in this continuation. Packaged smoke found a test
path comparison issue (`/var` versus its `/private/var` real path), fixed using
realpath comparison, and stale brand-text expectations, updated to the accepted
copy. A complete packaged smoke then passed with screenshots and relaunch.
Its New Money title, custom menu model and unchanged test profile directory
were checked; real native workbench and account-page observation confirmed
existing Workspace/Session catalogs and the new wordmark.

Native AX exposed a remaining macOS top-menu title, Pi-67 Desktop. Changing
CFBundleName alone reproducibly caused Electron startup to abort with
`Unable to find helper app`; that change was reverted. Keep CFBundleName and
Helper/executable identities stable. CFBundleDisplayName is New Money, and
About/Hide/Quit submenu labels use New Money. A complete OS bundle/Helper rename
is explicitly not claimed. The failed experiment has its own diagnostic log;
only the restored-identity package can be delivered.

Visual review used actual packaged screenshots (About, Skills, project Rules,
dark workbench) plus Computer Use on the real account page. The browser67
continuation fixture hit a replacement-runtime timeout; its capture is not
healthy-state visual acceptance. Prior healthy browser evidence and this turn's
45 E2E regressions remain separate evidence. Its one managed tab was closed and
verified, 0 errors/remaining; task Vite stopped. Coordinate-based native input
remained unreliable; no full native category/state matrix is claimed.

Final restored-identity delivery: `preview-delivery.log` exited 0 after package,
packaged smoke and relaunch on macOS arm64. The delivered `app.asar` is
199655511 bytes, SHA-256
`c516b586490331fdafb9ab62943492abe9cc9c1fc57aaa98e8151b1181fb6da5`.
Screenshots are under `artifacts/new-money-closeout/native-delivery/`.
Computer Use also directly reviewed the reopened app's Context and Memory page:
bounded content width, separate privacy/enterprise/advanced tabs, single-column
mode choices and the service section. No settings were saved or changed during
this observation. Native navigation automation remains inconsistent, so this
does not extend acceptance to every native category or state. No commit, push
or external distribution was performed.

## Native application rename (2026-09-08, implemented; Windows unverified)

User approved the complete public application/bundle/installer rename to New Money.
Keep package name pi-67-desktop, app ID com.pi67.desktop, pi67 protocol, profile
paths and Pi runtime unchanged. Electron Builder must generate the main executable
and Helpers together. Current files have unrelated dirty WIP; preserve it.
Acceptance: consistent native bundle identity; existing profile selected; Agent
Host startup and cold/warm packaged smoke; new artifact names and legacy update
input compatibility. Windows runtime remains a separate unverified boundary.
Rollback: revert only this continuation's name/compatibility hunks and rebuild;
no user data move or deletion. Delivery is local source and unsigned macOS preview,
without commit, push, upload or publication. Old clients with fixed archive names
require manual installation for this branding transition; no remote update is
published by this task.

Native rename delivery: `artifacts/new-money-native-rename/preview.log` completed
package, smoke, container verification and relaunch. The bundle is now
`artifacts/release/mac-arm64/New Money.app`; main executable and four Helpers
use the New Money family while bundle IDs remain com.pi67.desktop and its Helper
suffixes. app.asar SHA-256:
`7b3a8c6d1d968e79cb9262c8ed434e2ff089ff6b829aaf9c2dea570c454141a6`
(199656039 bytes), from HEAD 4890d3344f84bc5078e3e12b55b59b1be25387dd plus
uncommitted WIP. This is a local preview, not a clean distributable candidate.
Computer Use confirms the top native application menu is New Money and existing
Workspace/Session catalogs load in the normal user profile. No user settings or
credentials were modified for verification; real credential use was not tested.
The packaged smoke asserts the unchanged app.getName pi-67-desktop and explicit
profile directory, with real Agent Host startup and cold/warm Session recovery.
Targeted packaging/release/updater suite: 332 passed; subsequent compatibility
regressions: 21 passed, including both filename families and mixed-family rejection.
Typechecks and affected-area type-aware lint passed. Aggregate check stopped on
an existing untracked protocol declaration's empty export; structure separately
reports another pre-existing untracked declaration above its line limit. These
files were preserved. Architecture, dead code, reference governance, transport,
PowerShell discovery and Action pins pass. Windows AST and native execution
remain unverified. No commit, push, external installation or publication.

Full coverage run completed: 706 files / 3677 tests passed, 2 files / 5 tests
skipped; statements 82.65%, branches 76.67%, functions 86.6%, lines 86.53%.
Final compatibility tests cover the later engineering-only legacy-baseline
resolver edits; packaged application source was unchanged after its smoke.

## Declaration output and delivery closeout (2026-09-08)

Live HEAD is now 01c4ef7 (source-check/preflight work committed separately).
23 untracked protocol src declarations match fresh TypeScript declaration output
byte-for-byte and all have source counterparts. The historical invoking command
is unknown. Their hashes and reversible preserved copies are under ignored
`artifacts/declaration-closeout/`; no source declaration was deleted.
Protocol tsconfig now explicitly sets rootDir src and outDir dist while inherited
noEmit remains true. Normal revision build leaves src free of declarations.
Lint, architecture, dead code, references, structure, production transport,
PowerShell discovery and Action pin checks pass. Full `check:source` exited 0; Test Files  708 passed | 2 skipped (710); Tests  3696 passed | 5 skipped (3701).
The update regression now covers old-to-new bundle names, with both existing
and staged executable identities checked before the rollback helper is started.
Installer plus naming compatibility tests: 12 passed. This is a synthetic staging
test, not real Windows installation or real credential use. First manual install
steps are in the internal candidate distribution document. No app runtime/UI
implementation changed in this closeout, so the preceding packaged runtime
evidence is retained without claiming a new package/relaunch.

Proposed commit boundaries (not staged): protocol output configuration separately;
settings and New Money changes require a shared-hunk review of PRODUCT/DESIGN,
renderer localization and E2E files; existing Agent Host attachment-test changes
remain outside the rename scope. No commit/push/distribution is performed.

Final closeout evidence: `artifacts/declaration-closeout/check.log` records the
complete successful gate. Proposed commit paths are in
`artifacts/declaration-closeout/proposed-commit-scope.json`; no files are staged.
The 23 preserved declarations remain byte-identical to the inventory hashes.
Windows native/AST verification and real credential use remain unverified.

## Scoped commit delivery

User approved continuation into scoped commits. Protocol output configuration
was committed independently as 5a6da93. This settings/branding commit includes
the accepted UI, native naming, compatibility, documentation and regression
changes. The Agent Host attachment-test optimization remains uncommitted and
excluded. The prior complete check was a working-tree check, including that
excluded test optimization; it is not a clean exact-commit candidate certificate.
No push, candidate upload or publication is included in commit authorization.
