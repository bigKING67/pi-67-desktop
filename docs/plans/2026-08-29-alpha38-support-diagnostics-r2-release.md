# Alpha.38 support diagnostics R2 release

Status: active
Owner: Codex with operator confirmation
Started: 2026-08-29
Last updated: 2026-08-29

## Goal

Publish the latest Pi-67 Desktop product source containing user-initiated redacted support diagnostics upload as `0.1.0-alpha.38` on the internal unsigned-preview R2 update channel, with exact-source and exact-byte provenance.

## Non-goals

- Do not overwrite immutable Alpha.37 R2 objects.
- Do not create a Git tag, GitHub Release, signed release, notarization, or stable promotion.
- Do not purge caches, withdraw a release, or delete unrecognized R2 objects.
- Do not fabricate target-platform acceptance from hosted CI or macOS evidence.
- Do not change the Support ingest Worker or diagnostics-retention budget.

## Acceptance criteria

- All package identities are exactly `0.1.0-alpha.38` and source validation passes.
- The exact committed and pushed source passes required quality and candidate gates.
- Windows x64 Candidate and macOS arm64 package evidence bind to the same source SHA and runtime.
- A real Windows x64 operator acceptance is recorded against the exact candidate bytes before R2 publication.
- R2 uploads the three immutable Alpha.38 artifacts, verifies full public bytes and Range responses, and switches the mutable manifest last.
- The public manifest and a post-publication read-only plan both report Alpha.38 without conflicts or pending uploads.
- Git remains clean and `HEAD`, upstream, and `origin/main` remain identical.

## Delivery boundary

- Local implementation: version identity and this release plan only.
- Commit: authorized as a required release step; scoped paths only.
- Push: authorized as a required exact-SHA Candidate step.
- Candidate build/upload: authorized for Alpha.38 exact-SHA artifacts.
- R2 publication: authorized for Alpha.38 only, using normal bounded retention after manifest cutover.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Git clean; `HEAD`, upstream, and `origin/main` all `76ade399ae11a4a9e9d47ce8a7f3a5dc1f0eecbf`. | live Git | 2026-08-29 |
| OBSERVED | Public R2 manifest already points to Alpha.37 bytes from source `08811c53457d1da27079450ceced0dd42539714e`. | public manifest and local provenance | 2026-08-29 |
| OBSERVED | The support-diagnostics Candidate at source `973a0fe05bb2c27441986a3167844590bf25757a` has different Alpha.37 bytes. | Candidate run `33248131097` and local hashes | 2026-08-29 |
| OBSERVED | Versioned R2 artifact names are immutable; new bytes cannot overwrite Alpha.37. | release contract | 2026-08-29 |

## Affected boundaries

- Modules/processes: package identity, CI, Windows Candidate, macOS packaging, R2 publication tooling.
- Protocol or persisted state: no protocol or persisted-state change.
- Platform/artifact: Windows x64 NSIS; macOS arm64 DMG/ZIP; unsigned-preview manifest.
- Security/privacy: no credentials in the repository; operator environment remains external.
- Existing WIP: none observed before edits.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Publish as Alpha.38. | Alpha.37 is already public with different immutable bytes. | A higher live canonical SemVer appears before Candidate construction. |
| Keep Support ingest and its budget unchanged. | The requested release consumes the update bucket; it does not require a Worker redeploy. | A source or live-contract defect is observed. |
| Require real Windows acceptance before manifest cutover. | Hosted CI and macOS smoke are not target-device acceptance. | None; this is a release contract. |
| Use manifest-last publication and normal three-version retention. | Prevents clients from observing missing artifacts and bounds storage. | A live inventory conflict or future version blocks publication. |

## Checkpoints

- [x] 1. Audit Git, public manifest, Alpha.37 provenance, and immutable-name conflict.
- [ ] 2. Commit and push the scoped Alpha.38 version identity and plan.
- [ ] 3. Complete exact-SHA quality, Windows Candidate, and macOS package/smoke evidence.
- [ ] 4. Record exact Windows x64 operator acceptance.
- [ ] 5. Prepare and verify the unsigned-preview and R2 bundles.
- [ ] 6. Run read-only R2 plan and verify no conflict or future version.
- [ ] 7. Publish Alpha.38 artifacts, verify public bytes, and switch manifest last.
- [ ] 8. Re-run the read-only plan, public HTTP checks, Git parity, and dirty audit.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | affected typecheck/tests plus aggregate check | exact committed SHA passes | pending |
| Candidate | Windows Candidate workflow | successful run/attempt, identity, installer hashes | pending |
| macOS package | unsigned preview packaging and packaged smoke | exact source identity and smoke receipt | pending |
| Target OS/manual | operator confirms exact Windows Candidate | manual-test receipt bound to candidate bytes | pending |
| R2 plan | `release:r2:plan` | Alpha.38 target, no conflict/future version | pending |
| R2 publication | `release:r2:publish --confirm-version 0.1.0-alpha.38` | receipt, public full-byte/Range checks, manifest last | pending |

## Rollback

Before manifest cutover, stop and leave Alpha.37 public. After manifest cutover, do not improvise deletion or cache purge; use the separately authorized withdrawal procedure if Alpha.38 is defective. Immutable Alpha.38 artifacts are never overwritten.

## Risks and unknowns

- Real Windows x64 manual acceptance is not yet evidenced for Alpha.38.
- Account-wide R2 usage is separate from this release's bounded three-version retention.
- A live version or object conflict discovered by the read-only plan blocks publication.

## Progress log

- 2026-08-29: Live audit found clean Git and an already-public, byte-distinct Alpha.37. Selected Alpha.38 to preserve immutable R2 identity.

## Closeout

- Final source SHA: pending
- Changed files: pending
- Validation completed: pending
- Validation not completed: pending
- Remaining risks: pending
- Commit/push/release state: pending
