# Alpha.37 Release Readiness Remediation

Status: active — source freeze and exact-SHA candidate delivery authorized
Owner: Codex primary session
Started: 2026-08-28
Last updated: 2026-08-28

## Goal

Close the validated pre-package blockers for the next Pi-67 Desktop prerelease: assign a new immutable version identity, restore first-party capability freshness, and bind both macOS arm64 product files and packaged-smoke evidence to the same exact source SHA used by the Windows candidate and R2 publication gate.

## Non-goals

- Do not upload to Feishu or R2, delete remote artifacts, create a Tag or GitHub Release, sign, notarize, promote, or publish before the exact Windows candidate has a real Windows acceptance result bound to its bytes and source SHA.
- Do not treat a local macOS arm64 package as Windows x64 or cross-platform acceptance.
- Do not change the supported platform matrix, Pi runtime authority, update origin, unsigned-channel trust model, or three-product-file distribution contract.
- Do not absorb unrelated changes or generated artifacts into Git.

## Acceptance criteria

- All eight workspace manifests use one prerelease version strictly greater than the already-public `0.1.0-alpha.36`, with a coherent frozen lockfile.
- The AI Berkshire Skill Pack lock is advanced to the reviewed remote commit, its exact Skill/manifest/bundle hashes are regenerated, and both reachability and freshness gates pass.
- A bounded macOS candidate identity binds repository, full source SHA, version, runtime, darwin/arm64 host, packaged app identity, DMG identity, ZIP identity, and packaged-smoke receipt identity.
- R2 preparation and loading require that macOS identity, validate its exact bytes and source SHA, and reject arbitrary, drifted, cross-source, or missing macOS artifacts/receipts.
- Targeted regressions, full `check`, dependency audit, build, and exact local macOS arm64 unsigned preview pass.
- Final reporting preserves Windows, remote CI, upload, and publication as separate unverified or unauthorized layers.

## Delivery boundary

- Local implementation: authorized and completed in the canonical checkout.
- Commit: the user explicitly authorized one scoped commit containing only the Alpha.37 remediation paths.
- Push: the user explicitly authorized pushing the current `main`, including its two audited pre-existing local commits, after live remote ref reconciliation.
- Candidate build: the user explicitly authorized a clean exact-SHA macOS arm64 rebuild and Windows candidate workflow dispatch from the resulting pushed commit.
- Target-OS acceptance: a real Windows tester must bind the result to the exact workflow run/attempt, source SHA, candidate identity, file size, and SHA-256. The agent must not infer or simulate this result.
- Upload/release/promotion: remain gated behind that Windows acceptance result. The prior dirty-source macOS package is never eligible for R2 or internal distribution. Any later external action must preserve the exact channel and artifact boundaries rather than treating commit, push, upload, Tag, Release, and R2 promotion as interchangeable.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Remediation started from clean HEAD `5a36a13a2bbd7a48a067634a2328a56b338a0441`, two commits ahead of `origin/main`; the current dirty scope is the 29 task-owned Alpha.37 paths listed by live Git. | live Git | 2026-08-28 |
| VERIFIED | Public update manifest already identifies `0.1.0-alpha.36` with Pi runtime `0.84.2`; current source still names Alpha.36 but uses runtime `0.84.3`. | public manifest and manifests | 2026-08-28 |
| VERIFIED | AI Berkshire advanced from `e83c254...` to `76aa42f...`; the exact compare changes only three report Markdown files. The adapter-derived Skill Pack is now `1.0.7`, and capability preparation, reachability, and freshness all pass. | exact source compare, generated lock, live gates | 2026-08-28 |
| VERIFIED | R2 local provenance contains only Windows identity/manual-test files; macOS DMG/ZIP receive regular-file, size, and SHA-256 checks but no source/package identity. | release source and targeted test replay | 2026-08-28 |
| VERIFIED | Public-version preflight confirms local Alpha.37 is strictly newer than the public Alpha.36 manifest and rejects equal, lower, malformed, stable, or redirected inputs. | fixed-origin live read and targeted tests | 2026-08-28 |
| VERIFIED | The pre-remediation full `check`, dependency audit, build, session-open benchmark, and isolated production Renderer catalog E2E pass. | current checkout commands | 2026-08-28 |

## Affected boundaries

- Modules/processes: release artifact contracts, packaging evidence, capability preparation, workspace manifests.
- Protocol or persisted state: no runtime protocol or user-persisted state change; new ignored release evidence schema only.
- Platform/artifact: macOS arm64 app/DMG/ZIP provenance and R2 bundle; Windows candidate consumes the shared source/version contract but remains externally unbuilt.
- Security/privacy: evidence contains only bounded build identity and hashes; no credentials, prompts, sessions, paths outside the repository, or raw tool payloads.
- Existing WIP: none at start; preserve the two existing local commits and all ignored historical artifacts.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Use `0.1.0-alpha.37` as the next local prerelease identity. | Alpha.36 is already public and immutable; Alpha.37 is the smallest strictly greater prerelease. | A higher already-published version is observed before the version edit. |
| Add a separate macOS candidate identity instead of putting source SHA into the public update manifest. | Provenance is an operator-side release gate; updater clients need version/target/bytes/hash and should not gain a second trust model. | Product requirements explicitly require public source provenance in the client manifest. |
| Bind packaged-smoke evidence by bounded file identity rather than embedding smoke logs. | The release gate needs immutable proof identity without persisting raw logs or environment data. | The smoke producer exposes a canonical credential-free receipt schema suitable for direct inclusion. |
| Regenerate the AI Berkshire lock through the existing adapter and exact source checkout. | Skill and bundle hashes must be derived, not hand-authored. | The adapter cannot reproduce the current lock contract from the reviewed source. |
| Gate promotion against the fixed R2 public manifest as well as GitHub Tag/Release state. | A version can already be public through R2 even when no GitHub Tag or Release exists. | The unsigned update channel or version authority changes explicitly. |

## Checkpoints

- [x] 1. Implement and test bounded macOS candidate identity creation/validation.
- [x] 2. Require and cross-check macOS identity in unsigned-preview and R2 bundle flows.
- [x] 3. Refresh AI Berkshire source and derived hashes; pass source reachability and freshness.
- [x] 4. Bump all manifests to Alpha.37 and update the frozen lockfile.
- [x] 5. Pass targeted release/capability/version regressions and the complete repository gates.
- [x] 6. Rebuild, smoke, identity-bind, and open a local macOS arm64 unsigned preview; retain its truthful dirty-source status only as implementation evidence.
- [ ] 7. Stage only the 29 task-owned paths, inspect the staged diff, commit, and verify a clean source freeze.
- [ ] 8. Reconcile the live remote ref, push current `main`, and prove remote/local exact-SHA parity.
- [ ] 9. Rebuild macOS arm64 from that clean exact SHA and verify app/DMG/ZIP/smoke identity and hashes.
- [ ] 10. Dispatch and complete the Windows exact-SHA candidate from the same commit; download and verify its identity and hashes.
- [ ] 11. Obtain a real Windows acceptance result bound to the exact candidate bytes.
- [ ] 12. Only after checkpoint 11, perform separately bounded Feishu/R2/Release actions under the user's exact current channel authorization.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `git diff --check`; scoped diff audit | only planned source/docs/tests, clean whitespace | passed; 29 task-owned paths, ignored build output excluded |
| Tests | targeted Vitest for macOS identity, R2, capability, version; `corepack pnpm run check` | all selected contracts and full suite pass | passed: 52 focused; 609 files, 3178 passed, 3 skipped |
| Dependencies | `corepack pnpm run check:dependencies` | production dependency audit gate passes | passed: 0 high, 0 critical |
| Capability | source-lock verification, freshness, capability preparation/validation | exact reviewed commit and regenerated hashes, all current | passed: 5 commits reachable; all current; 21 focused tests |
| Runtime/host | `corepack pnpm run build`; isolated production Renderer catalog E2E if affected | build and existing provider catalog contract remain green | passed; build and 10/10 production Renderer E2E |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned`; create/verify macOS identity | rebuilt darwin/arm64 app, DMG, ZIP and smoke receipt bound to local source | passed locally; package/smoke/container checks/open/identity readback, source correctly marked dirty |
| Target OS/manual | Windows exact-SHA candidate and Windows/macOS manual upgrade | external follow-on evidence | Windows build authorized; real Windows acceptance remains UNVERIFIED |

## Rollback

- Before commit, revert only the task-owned paths with an explicit patch; preserve the two pre-existing local commits and ignored artifacts.
- If the capability source cannot be reproduced exactly, restore the prior lock entry and leave freshness as a visible blocker rather than weakening the gate.
- If macOS identity cannot be generated from the packaging workflow without raw logs or unstable paths, keep R2 publication fail-closed and report the unresolved design boundary.
- Do not overwrite or delete the public Alpha.36 artifacts or manifest.

## Risks and unknowns

- The packaged-smoke command currently emits console evidence; a new bounded receipt may be required without changing smoke behavior.
- R2 preparation may run after artifact renaming, so identity validation must define whether it binds canonical pre-rename or published names and enforce exact-byte equality across that transition.
- Windows cannot build the final SHA until the authorized scoped commit and push make it reachable from `origin/main`; workflow dispatch must verify that remote equality first.
- Upstream capability refs may advance again during implementation; freshness must be rechecked at closeout.

## Progress log

- 2026-08-28: User authorized implementation of all local review recommendations. Rechecked clean tracked state, current HEAD, public version collision, stale capability source, and macOS R2 provenance gap. No commit, push, upload, or publication authority inferred.
- 2026-08-28: Added bounded macOS app/DMG/ZIP/smoke identity and required it in promotion/R2 preparation. Twenty-three focused release tests pass, including byte drift, receipt tamper, dirty source, symlink, and cross-source rejection.
- 2026-08-28: Regenerated AI Berkshire Skill Pack `1.0.7` from exact commit `76aa42f...`; source diff is three report files, exact source reachability and freshness pass, and 21 capability tests pass.
- 2026-08-28: Advanced all eight workspace manifests to Alpha.37 and added a fixed-origin public-manifest preflight. The live check sees public Alpha.36 and accepts Alpha.37; 12 focused version/workflow tests pass.
- 2026-08-28: Final repository `check` passed on the final source: 609 test files, 3178 passed and 3 skipped, with 0 architecture cycles. Production dependency audit, build, and 10/10 production Renderer E2E passed. One unrelated crash-recovery timing assertion failed once under an intermediate full run, then passed five isolated repeats and the final full run without any runtime/test change.
- 2026-08-28: Rebuilt and opened the local Alpha.37 Apple Silicon preview. Packaged smoke, native DMG/ZIP container verification, and identity readback passed. DMG is 363108950 bytes (`55266078...0a8da`); ZIP is 372426144 bytes (`cc43b34f...ec3e8`). The evidence truthfully records source `5a36a13...` as dirty because this remediation is not committed.

## Pre-delivery checkpoint

- Source freeze: pending the scoped commit that contains this plan and the 28 other task-owned paths; its resulting SHA, not the pre-remediation HEAD, becomes the only candidate identity.
- Changed files: 29 task-owned workflow, release/capability/packaging, manifest, test, documentation, and plan paths; ignored build outputs remain outside Git.
- Validation completed before freeze: focused regressions, capability preparation/reachability/freshness, public-version preflight, final full `check`, dependency audit, build, production Renderer E2E, and one Apple Silicon dirty-source package/smoke/container/identity/open rehearsal.
- Validation pending after freeze: clean exact-SHA macOS rebuild, Windows exact-SHA candidate, target-machine manual testing, Feishu/R2 publication.
- Remaining risks: the rehearsed macOS evidence is intentionally not release-eligible because the source was dirty. One existing Agent Host timing test produced one non-reproducible full-suite failure before passing five isolated repeats and the final full suite.
- Commit/push state: explicitly authorized for this scope. Upload, Tag, Release, R2 promotion, and publication remain gated behind the exact Windows manual result.
