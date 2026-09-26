# Windows candidate baseline recovery

Status: active
Owner: Codex
Started: 2026-09-26
Last updated: 2026-09-26

## Goal

Restore the fail-closed Windows candidate chain when the previous successful
GitHub Actions artifact has expired, without weakening the exact previous-version
installer or full NSIS upgrade lifecycle requirements.

## Non-goals

- Do not skip, shorten, or relabel the full Windows installer lifecycle.
- Do not accept arbitrary download URLs, redirects, versions, hashes, or operator-supplied bytes.
- Do not upload to Feishu or R2, mutate the public update channel, create a Tag or
  GitHub Release, sign artifacts, or delete local/remote files.
- Do not include the existing Settings/design/provenance WIP in this change.

## Acceptance criteria

- [x] The existing GitHub Actions artifact path remains the preferred baseline path.
- [x] Recovery is admitted only when the exact Actions artifact is unavailable and a
  repository-pinned historical candidate identity, manual-test receipt, publication
  manifest, and immutable public installer all agree.
- [x] The recovery download is restricted to the fixed update origin, rejects redirects,
  enforces a bounded exact byte count, verifies SHA-256, and publishes the local file atomically.
- [x] The recovered installer still feeds the existing full install, upgrade, restart,
  restore, shutdown, uninstall, and data-preservation lifecycle.
- [ ] Focused release/workflow tests, aggregate source gates, exact staged-diff review,
  scoped commit, and push pass before candidate dispatch.
- [ ] A new Windows candidate is dispatched from the final pushed source SHA; build/run
  evidence remains separate from target-Windows manual acceptance.

## Delivery boundary

- Local implementation: authorized.
- Commit: scoped commit authorized.
- Push: authorized.
- Candidate build/upload: one exact-SHA `Windows candidate` workflow dispatch authorized;
  GitHub Actions artifact output only.
- Tag/release/promotion: not authorized.
- Feishu/R2 mutation or cleanup: not authorized.
- Freshness follow-up: after run `36228639998` failed before Windows build,
  the user authorized reviewing and advancing `design-craft` to the exact current
  stable release, regenerating capabilities, validating/package-smoking, scoped
  commit/push, and one replacement exact-SHA Windows candidate dispatch.
- Shutdown follow-up: after replacement run `36229880389` failed the first
  synthetic-scale shutdown sample, the user authorized the bounded shutdown-budget
  correction, validation, scoped commit/push, and one further exact-SHA candidate dispatch.
- Asset-contract follow-up: after run `36231515012` passed Windows packaging,
  packaged smoke, and synthetic-scale shutdown but failed before upgrade because
  the verifier applied the Alpha.41 Pi TUI native path to the installed Alpha.40
  baseline, the user authorized the versioned verifier correction, validation,
  scoped commit/push, and one further exact-SHA candidate dispatch.
- Capability-layout follow-up: run `36233437302` proved the native-path correction
  but then exposed the same historical-version defect for the capability layout.
  The user authorized the versioned capability correction, validation, scoped
  commit/push, and one further exact-SHA candidate dispatch without automatic retry.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Feature commit `0c7010cfe4e98ff972961e3e5778ddd0905dfe75` equals `origin/main`; unrelated WIP remains dirty. | live Git | 2026-09-26 |
| OBSERVED | Exact-SHA CI run `36217801214/2` passed; Windows native smoke passed while the reused-candidate lifecycle job was skipped. | GitHub Actions | 2026-09-26 |
| OBSERVED | Windows candidate preflight rejected baseline run `33320336253/1` because its exact Actions artifact is absent; recent successful candidate artifacts are also absent. | live preflight and Actions API | 2026-09-26 |
| VERIFIED | Alpha.40 identity/manual receipt bind source `8c0c560...`, run `33320336253/1`, installer size `275361161`, and SHA-256 `4b6c7561...`. | retained ignored evidence | 2026-09-26 |
| OBSERVED | The fixed public update origin serves the Alpha.40 Windows installer with HTTP 200, exact content length, immutable cache policy, and no redirect. | public fixed origin HEAD | 2026-09-26 |
| OBSERVED | Candidate run `36228639998` stopped in provenance before Windows build because `design-craft` freshness advanced from locked `0.6.1`/`b168872...` to stable `0.7.0`/`f52ac60...`. | GitHub Actions failed-step log and exact tag resolution | 2026-09-26 |
| VERIFIED | Stable tag `v0.7.0` peels to `f52ac60...`; the Desktop-bundled product boundary contains 95 regular files and no symlink or submodule entries. | canonical remote tag and local exact clean source | 2026-09-26 |
| VERIFIED | Prepared and packaged capability catalogs identify `design-craft` `0.7.0` at exact commit `f52ac60...`, tree SHA-256 `4cfd9278...`; the packaged Skill directory is byte-for-byte identical to the exact source boundary. | generated catalogs and packaged application filesystem comparison | 2026-09-26 |
| OBSERVED | Replacement run `36229880389` passed provenance, Windows packaging and packaged Electron smoke, then failed the first 1.25-scale synthetic UI shutdown sample: child exited in 414.1 ms, both Utility processes by 4534.8 ms, and Main by 6272.3 ms. No candidate identity, installer artifact, certification, or baseline lifecycle followed. | exact Actions failed-step log and uploaded bounded UI receipt | 2026-09-26 |
| VERIFIED | Follow-up run `36231515012` passed provenance, Windows packaging, packaged smoke, and all three synthetic-scale shutdown samples; the slowest complete product exit was 1553.6 ms under the unchanged 5000 ms gate. | exact Actions jobs and uploaded UI receipt | 2026-09-26 |
| VERIFIED | Certification then failed immediately after installing Alpha.40 because the current verifier required the Alpha.41 Pi TUI native clipboard path. Alpha.40 source required the legacy `@mariozechner` path; commit `9c2d162...` changed that path only after the Alpha.40 source. Upgrade, restart, and uninstall phases did not begin. | lifecycle diagnostic artifact and exact Git history | 2026-09-26 |
| VERIFIED | Run `36233437302` passed provenance, Windows packaging, packaged smoke and all synthetic-scale checks. Alpha.40 baseline installation completed in 99.36 seconds, then certification failed because the verifier required the later unified `pi-workspace-resources` layout. Commit `d6175e1` introduced that verifier assumption after baseline source `8c0c560...` while the source version still read Alpha.40; the first distributed version with the unified layout is Alpha.41. | exact Actions log, diagnostic artifact and Git ancestry | 2026-09-26 |

## Affected boundaries

- Modules/processes: Windows candidate preflight, release baseline restore/verification,
  Windows candidate workflow, workflow-security tests, release documentation.
- Protocol or persisted state: no product protocol, database, Session, Profile, or updater-state change.
- Platform/artifact: hosted Windows x64 unsigned NSIS candidate and historical upgrade baseline.
- Security/privacy: fixed public origin only; no credentials, arbitrary URLs, or user payloads.
- Existing WIP: preserve current changes under root authority/design docs, Renderer Settings,
  workbench, packaging probes, E2E, design-preview, and unrelated plans/provenance files.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Prefer the retained Actions artifact; use recovery only after exact artifact absence is proven. | Preserves the normal candidate path and limits fallback scope. | Actions gains durable artifact retention that makes recovery unnecessary. |
| Pin the historical identity, manual receipt, and unsigned manifest in a reviewed release catalog. | Workflow inputs and mutable remote metadata are not sufficient trust anchors. | A stronger immutable provenance service replaces the catalog. |
| Download only from the fixed update origin and verify exact bytes before lifecycle use. | Reuses the already-published immutable product bytes without introducing credentials or arbitrary transport. | The fixed origin no longer retains immutable versioned objects. |
| Keep full lifecycle unchanged. | Recovery must restore evidence availability, not weaken acceptance. | None. |
| Keep the five-second product gate and shorten Main's internal shutdown watchdog from 4.25 to 3 seconds. | The failed sample needed about 2.02 seconds from the old watchdog boundary to observed Main exit, proving the old 0.75-second teardown reserve was insufficient; forcing the recursive Electron quit earlier preserves the external acceptance contract. | Repeated staged evidence proves a different product deadline or a narrower lifecycle defect. |
| Project only the typed Main shutdown stage report into Windows failure evidence. | A process-only receipt cannot distinguish checkpoint/Host cleanup from Electron teardown, while raw process output may contain unrelated data. | The harness gains an equivalent typed lifecycle event. |
| Version the native clipboard asset path with the installed package contract. | The full lifecycle installs the previous version first; checking that installation against the candidate's later dependency layout creates a false failure while weakening the check would lose native asset coverage. | A future package format provides a self-describing, authenticated runtime asset manifest. |
| Treat Alpha.41 as the first distributed unified-capability layout. | The retained Alpha.40 artifact predates the unification even though later source commits retained the Alpha.40 version string; the exact distributed artifact, not an intermediate source version, owns the lifecycle contract. | A signed per-artifact runtime asset manifest replaces version thresholds. |

## Checkpoints

- [x] 1. Add and validate the bounded historical baseline catalog and atomic fixed-origin restore command.
- [x] 2. Extend preflight to select Actions or immutable-update transport fail-closed.
- [x] 3. Route the Windows workflow through conditional exact baseline acquisition while retaining full lifecycle.
- [x] 4. Update authority docs and focused workflow/release tests.
- [ ] 5. Run aggregate gates, review/stage only task files, commit, push, and verify remote CI.
- [x] 6. Run the new preflight, dispatch one exact-SHA Windows candidate, and record its state.
- [x] 7. Advance the exact reviewed `design-craft` source lock, regenerate and verify
  prepared capabilities, complete packaged smoke, then commit/push and dispatch the
  separately authorized replacement candidate.
- [x] 8. Preserve the five-second Windows gate, reserve two seconds for Electron
  teardown, add typed stage evidence, validate/package-smoke, and dispatch the one
  separately authorized follow-up candidate from the final pushed SHA.
- [x] 9. Version the native clipboard asset contract for Alpha.40 and Alpha.41,
  validate the verifier-only correction, commit/push only its scoped files, and
  dispatch the separately authorized exact-SHA candidate once.
- [ ] 10. Version the capability layout contract for the retained Alpha.40 artifact,
  validate and commit/push the scoped correction, then dispatch the separately
  authorized exact-SHA candidate once without automatic retry.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | focused Vitest release/workflow tests | transport selection, catalog rejection, redirect/size/hash/atomic failure cases | PASS: 29/29 |
| Source | `corepack pnpm run check` | aggregate source-quality gate | PASS: 883 files / 5761 tests; 9 files / 24 tests skipped by existing platform contracts |
| Git | staged diff and exact SHA/remote readback | only task files committed and pushed | pending |
| Runtime/host | live fixed-origin preflight | exact immutable baseline admitted only after Actions absence | PASS for `0c7010c...`: selected `immutable-update`, alpha.40, 275361161 bytes, exact identity SHA-256 |
| Packaged artifact | `Windows candidate` workflow | full workflow and installer lifecycle success | pending |
| Target OS/manual | separate Windows x64 installation test | exact downloaded candidate identity | UNVERIFIED; outside this implementation |
| Capability source | exact `design-craft` stable tag/product-boundary review, prepare/freshness/source-lock gates | self-contained reviewed v0.7.0 package | PASS: stable tag peels to `f52ac60...`; source lock/freshness passed; 95-file package prepared with tree SHA-256 `4cfd9278...`; focused capability tests 27/27 |
| Local package | required capability gates and `preview:mac:unsigned` | prepared exact package and packaged Electron smoke | PASS: aggregate `check` 883 files / 5761 tests; Extension Adapter provenance passed; packaged Electron smoke passed; `app.asar` SHA-256 `0d23d713...`; packaged catalog and exact Skill directory verified |
| Shutdown correction | focused controller/measurement tests, affected typecheck/lint, architecture/structure, aggregate source gate | 5-second product gate unchanged; 3-second inner watchdog and typed evidence pass | PASS: focused 17/17; Desktop typecheck, scoped lint, architecture and structure passed. The first ordinary aggregate run passed all static gates but had one unrelated parallel Host crash-recovery timing failure; its isolated rerun passed 1/1. The complete bounded-concurrency rerun passed 883 files / 5763 tests with 9 files / 24 tests skipped and coverage 84.02/78.48/87.26/87.66. |
| Local shutdown package | `corepack pnpm run preview:mac:unsigned` | rebuilt macOS arm64 package, smoke, relaunch | PASS on the preserved dirty worktree: packaged smoke and active-prompt shutdown passed at 83.7 ms; `app.asar` SHA-256 `657fb525...`; the repository preview was relaunched. This is not clean exact-SHA Windows evidence. |
| Installed-version asset contract | focused packaged fixture and lifecycle tests, source gate, candidate gate, macOS packaged smoke | PASS: Alpha.40 selects legacy clipboard native modules plus the legacy `pi67-core`/observational-memory package paths, while Alpha.41 selects Pi TUI native modules plus the unified `pi-workspace-resources` path; focused 33/33, `check:source` and `check:candidate` each passed 883 files / 5763 tests with production dependency, capability-source/freshness, Extension Adapter, aggregate source and coverage gates; rebuilt packaged smoke passed with 105.3 ms active-prompt shutdown and `app.asar` SHA-256 `657fb525...` | PASS |

## Rollback

Before push, remove only this task's staged changes. After push but before candidate
dispatch, revert the scoped commit with a new commit if validation proves the fallback
unsafe. A failed candidate remains failed evidence; do not rerun around a deterministic
failure or delete prior artifacts. No public update state is changed by this plan.

## Risks and unknowns

- GitHub workflow input expressions and Windows path handling must remain injection-safe.
- The public object must remain immutable and byte-identical; metadata-only HEAD evidence
  is insufficient, so the workflow must download and hash the complete installer.
- Hosted lifecycle success will not replace manual testing on target Windows machines.

## Progress log

- 2026-09-26: Confirmed the Actions-artifact retention gap, exact Alpha.40 historical
  evidence, and the still-available fixed-origin immutable installer. Selected a
  credential-free, hash-pinned recovery path that preserves full lifecycle certification.
- 2026-09-26: Implemented the bounded catalog, fixed-origin atomic restore, fail-closed
  transport selection, conditional workflow acquisition, and focused release tests.
- 2026-09-26: Focused tests passed 29/29; aggregate `check` passed 883 test files
  and 5761 tests; live GitHub/origin preflight selected the exact alpha.40
  immutable baseline for source `0c7010c...`.
- 2026-09-26: Scoped recovery commit `67fbb436...` was pushed and candidate run
  `36228639998` dispatched once. Provenance stopped before build on the independent
  stale `design-craft` lock; no Windows artifact or lifecycle evidence was produced.
- 2026-09-26: User authorized the exact stable `design-craft` refresh and one
  replacement exact-SHA candidate after full validation; no publication boundary changed.
- 2026-09-26: Advanced the capability lock/catalog fixtures to `design-craft`
  `0.7.0` at exact commit `f52ac60...`. Source-lock and freshness verification,
  capability preparation, focused tests 27/27, aggregate `check`, Extension Adapter
  provenance, macOS arm64 unsigned packaging, and packaged Electron smoke all passed.
  The packaged catalog reports `2026.09.26.1`, and its exact Skill directory matches
  the reviewed upstream product boundary.
- 2026-09-26: Replacement run `36229880389` reached the Windows packaged synthetic
  scale/IME gate but failed its first shutdown sample at 6272.3 ms. The preceding
  packaged active-prompt smoke shut down in 384.8 ms, so the evidence does not support
  widening the five-second gate. The nested 4.25-second Main watchdog left only 750 ms
  for Electron teardown; remediation reserves two seconds and records only the typed
  application shutdown stage report for future diagnosis.
- 2026-09-26: Implemented the 3-second inner watchdog and typed bounded stage parser.
  Focused tests passed 17/17; affected typecheck/lint and architecture/structure passed.
  The first full aggregate run retained one unrelated parallel crash-recovery timing
  failure; isolated reproduction passed, and the complete two-worker aggregate rerun
  passed 5763 tests plus all static/coverage gates. Rebuilt macOS packaged smoke passed
  with 83.7 ms active-prompt shutdown and relaunched the preview.
- 2026-09-26: Follow-up run `36231515012` proved the shutdown correction on hosted
  Windows at all three synthetic scale targets, with a slowest full exit of 1553.6 ms.
  Installer certification then exposed a verifier-only compatibility defect before
  upgrade: the installed Alpha.40 baseline was checked for the Alpha.41 Pi TUI native
  module instead of its legacy clipboard module. No rerun was attempted.
- 2026-09-26: Added the installed-version native clipboard contract without
  weakening asset checks. Focused fixture/lifecycle tests passed 33/33; the first
  source-gate attempt exposed and corrected this change's test-file line-budget
  overage, then the complete fixed-worker source gate passed 883 files and 5763
  tests. Rebuilt macOS packaged smoke passed with 89.1 ms active-prompt shutdown
  and relaunched the repository preview. The full candidate preflight gate then
  passed production dependency audit, capability source/freshness, Extension
  Adapter verification, aggregate source checks, tests, and coverage.
- 2026-09-26: Scoped commit `08915763...` was pushed and candidate run
  `36233437302` dispatched once. Provenance, Windows packaging, packaged smoke,
  synthetic-scale/IME checks, exact candidate bytes and immutable Alpha.40 restore
  passed. Full lifecycle installed Alpha.40, then failed before launch/upgrade on
  the later unified capability path; no testable candidate was uploaded and no
  rerun was attempted. Exact Git ancestry established Alpha.41 as the first
  distributed unified-capability contract.
- 2026-09-26: Versioned the installed capability-layout contract at Alpha.41
  without skipping any required asset. Focused fixture/lifecycle tests passed
  33/33; `check:source` and `check:candidate` each passed 883 test files and
  5763 tests with 9 files / 24 tests skipped by existing platform contracts and
  coverage 84.02/78.48/87.26/87.66. A fresh macOS arm64 package passed the full
  packaged Electron smoke with 105.3 ms active-prompt shutdown, then relaunched
  the repository preview from `app.asar` SHA-256 `657fb525...`.

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:
