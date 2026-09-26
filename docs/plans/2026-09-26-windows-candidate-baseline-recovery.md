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

## Checkpoints

- [x] 1. Add and validate the bounded historical baseline catalog and atomic fixed-origin restore command.
- [x] 2. Extend preflight to select Actions or immutable-update transport fail-closed.
- [x] 3. Route the Windows workflow through conditional exact baseline acquisition while retaining full lifecycle.
- [x] 4. Update authority docs and focused workflow/release tests.
- [ ] 5. Run aggregate gates, review/stage only task files, commit, push, and verify remote CI.
- [ ] 6. Run the new preflight, dispatch one exact-SHA Windows candidate, and record its state.
- [ ] 7. Advance the exact reviewed `design-craft` source lock, regenerate and verify
  prepared capabilities, complete packaged smoke, then commit/push and dispatch the
  separately authorized replacement candidate.

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

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:
