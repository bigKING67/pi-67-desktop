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

- [ ] The existing GitHub Actions artifact path remains the preferred baseline path.
- [ ] Recovery is admitted only when the exact Actions artifact is unavailable and a
  repository-pinned historical candidate identity, manual-test receipt, publication
  manifest, and immutable public installer all agree.
- [ ] The recovery download is restricted to the fixed update origin, rejects redirects,
  enforces a bounded exact byte count, verifies SHA-256, and publishes the local file atomically.
- [ ] The recovered installer still feeds the existing full install, upgrade, restart,
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

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Feature commit `0c7010cfe4e98ff972961e3e5778ddd0905dfe75` equals `origin/main`; unrelated WIP remains dirty. | live Git | 2026-09-26 |
| OBSERVED | Exact-SHA CI run `36217801214/2` passed; Windows native smoke passed while the reused-candidate lifecycle job was skipped. | GitHub Actions | 2026-09-26 |
| OBSERVED | Windows candidate preflight rejected baseline run `33320336253/1` because its exact Actions artifact is absent; recent successful candidate artifacts are also absent. | live preflight and Actions API | 2026-09-26 |
| VERIFIED | Alpha.40 identity/manual receipt bind source `8c0c560...`, run `33320336253/1`, installer size `275361161`, and SHA-256 `4b6c7561...`. | retained ignored evidence | 2026-09-26 |
| OBSERVED | The fixed public update origin serves the Alpha.40 Windows installer with HTTP 200, exact content length, immutable cache policy, and no redirect. | public fixed origin HEAD | 2026-09-26 |

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

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | focused Vitest release/workflow tests | transport selection, catalog rejection, redirect/size/hash/atomic failure cases | PASS: 29/29 |
| Source | `corepack pnpm run check` | aggregate source-quality gate | PASS: 883 files / 5761 tests; 9 files / 24 tests skipped by existing platform contracts |
| Git | staged diff and exact SHA/remote readback | only task files committed and pushed | pending |
| Runtime/host | live fixed-origin preflight | exact immutable baseline admitted only after Actions absence | PASS for `0c7010c...`: selected `immutable-update`, alpha.40, 275361161 bytes, exact identity SHA-256 |
| Packaged artifact | `Windows candidate` workflow | full workflow and installer lifecycle success | pending |
| Target OS/manual | separate Windows x64 installation test | exact downloaded candidate identity | UNVERIFIED; outside this implementation |

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

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:
