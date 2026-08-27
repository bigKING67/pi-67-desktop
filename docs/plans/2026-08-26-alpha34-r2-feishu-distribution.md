# Alpha.34 R2 and Feishu distribution

Status: blocked
Owner: Codex CLI
Started: 2026-08-26
Last updated: 2026-08-27

## Goal

Publish the exact Alpha.34 Candidate to the internal unsigned R2 update channel,
verify the public manifest and immutable artifacts, and then distribute the same
three versioned product files through the configured Feishu Drive folder.

## Non-goals

- Do not rebuild or alter the accepted Alpha.34 Windows Candidate bytes.
- Do not create a Git tag, GitHub Release, signed build, notarized build, or
  stable-channel promotion.
- Do not delete Alpha.33 from R2, delete earlier Feishu files, purge caches, or
  claim target-OS update success without real target-OS evidence.
- Do not store R2 or Feishu credentials, tokens, or login state in the
  repository or release receipts.

## Acceptance criteria

- The R2 bundle is bound to source SHA
  `f50a44429ddaefe5ef28a8edeff3a8b255e71853`, Windows Candidate workflow
  `32971119431`, its original build attempt, its successful certification
  attempt, and the exact operator-confirmed Windows test receipt.
- R2 first contains all three immutable Alpha.34 artifacts; public HTTP size,
  Range, and SHA-256 verification passes before the manifest changes.
- The public no-store manifest then names Alpha.34 and exactly matches the
  verified artifact names, byte counts, and SHA-256 values.
- The same three versioned Alpha.34 product files are uploaded to the configured
  Feishu folder and re-listed with their expected names and sizes.
- Any target-OS upgrade not exercised during this work remains explicitly
  unverified; no older remote artifact is removed.

## Delivery boundary

- Local implementation: a bounded release-tooling correction is allowed only
  if needed to preserve separate build-attempt and certification-attempt
  provenance for the already-built Candidate.
- Commit: scoped plan/tooling/test/documentation commits are allowed.
- Push: allowed because R2 publication requires release-tooling
  `HEAD == origin/main`.
- Candidate build/upload: reuse the exact Alpha.34 Windows Candidate; build the
  matching macOS arm64 DMG/ZIP locally; publish to R2, then upload the same three
  versioned product files to Feishu.
- Tag/release/promotion: R2 manifest switch is authorized for Alpha.34 only;
  Git tag, GitHub Release, signing, notarization, stable promotion, remote
  deletion, and cache purge are excluded.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `main == origin/main == 2846f1a5addc42fd41c4cb334dab34c7802c7ec5`; the worktree was clean before this plan. | live Git | 2026-08-26 |
| OBSERVED | Candidate source `f50a44429ddaefe5ef28a8edeff3a8b255e71853` differs from current `HEAD` only in the completed Candidate plan; application, package, and release-tooling paths are unchanged. | live Git path diff | 2026-08-26 |
| OBSERVED | Candidate `32971119431/2` passed its final hosted lifecycle; its identity remains correctly bound to original build attempt `1`. | Candidate identity, workflow, and completed Alpha.34 plan | 2026-08-26 |
| OBSERVED | The exact Windows installer is 273,793,797 bytes with SHA-256 `ff155c7a1bc22bee17a2f196eda949283eeb8a8ab42425d240f55e3886ffc2ff`. | local Candidate readback | 2026-08-26 |
| OBSERVED | The public R2 manifest still advertises Alpha.33 with `Cache-Control: no-store`. | public update origin | 2026-08-26 |
| OBSERVED | Repository-external R2 operator credentials are configured; the configured Feishu folder currently contains the three Alpha.31 product files. | operator configuration presence check and Feishu listing | 2026-08-26 |
| OBSERVED | No Alpha.34 macOS DMG/ZIP exists locally yet, and no Alpha.34 operator manual-test receipt has been recorded. | local release output | 2026-08-26 |

## Affected boundaries

- Modules/processes: release provenance, unsigned-preview bundling, R2 publish,
  Feishu Drive upload.
- Protocol or persisted state: public mutable R2 manifest and remote Drive file
  inventory; no application protocol or Session state change.
- Platform/artifact: Windows x64 NSIS EXE and macOS arm64 DMG/ZIP.
- Security/privacy: repository-external credentials only; committed artifacts
  remain credential-free.
- Existing WIP: none at plan start.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Preserve the Candidate identity's build attempt separately from the successful workflow certification attempt. | GitHub reran only the failed certification job; rewriting the build identity to attempt 2 would falsely claim the application artifact was rebuilt. | A live workflow/artifact record proves that the Candidate bytes were rebuilt in attempt 2. |
| Keep the operator manual-test gate fail closed. | Hosted Windows lifecycle evidence does not replace the user's exact real-Windows acceptance. | The operator explicitly confirms the exact Candidate and the recorder validates its provenance and bytes. |
| Publish the R2 manifest only after public readback of all three artifacts. | Clients must never receive metadata that points at missing or corrupt objects. | None. |
| Retain older R2 and Feishu files during this authorization. | Remote deletion and R2 cache purge require separate current authorization and target-OS upgrade acceptance. | The user separately authorizes bounded cleanup after both target upgrades pass. |

## Checkpoints

- [ ] 1. Make any required release-only provenance correction, pass focused and
  repository gates, commit it, and push with exact branch parity.
- [ ] 2. Build and smoke the Alpha.34 macOS arm64 DMG/ZIP while preserving exact
  Windows Candidate bytes.
- [ ] 3. Record the operator-confirmed Windows test receipt, prepare and verify
  the unsigned-preview/R2 bundles, and inspect the read-only live R2 plan.
- [ ] 4. Publish Alpha.34 artifacts then manifest to R2 and verify public HTTP
  bytes, Range behavior, manifest no-store behavior, and release receipt.
- [ ] 5. Upload the exact three Alpha.34 product files to Feishu, re-list them,
  and verify expected names and sizes without deleting older files.
- [ ] 6. Record target-OS update evidence and remaining cleanup boundary.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | focused release tests, typecheck, lint, `git diff --check` | separate and validated build/certification provenance; no unrelated change | passed locally |
| Tests | unsigned-preview/R2 release contract tests | no weakened artifact/manual-test/publication gate | 18 files, 80 tests passed |
| Runtime/host | `preview:mac:unsigned` | rebuilt repository artifact, packaged smoke, launched Alpha.34 preview | pending |
| Packaged artifact | local size/SHA-256, bundle verification, R2 public readback | exact three product files and public manifest | pending |
| Target OS/manual | operator-confirmed Windows Candidate test; later R2 in-app update checks | exact identity-bound pass per target | Windows confirmation pending; R2 update tests pending |
| Distribution | Feishu upload followed by Drive listing | expected Alpha.34 names and sizes | pending |

## Rollback

- Before the manifest switch, an upload failure leaves Alpha.33 advertised; do
  not remove newly uploaded immutable objects without separate authorization.
- If public artifact verification fails, stop before uploading the manifest.
- If the manifest switch succeeds but the release must be withdrawn, first
  replace/remove the manifest under a new explicit authorization; remote object
  deletion and cache purge remain separate operations.
- If Feishu upload fails, preserve successfully uploaded versioned files and
  retry only missing files after re-listing; never overwrite mismatched bytes.

## Risks and unknowns

- The Candidate workflow's final success is attempt 2 while the immutable build
  identity is attempt 1; existing receipt tooling currently assumes one attempt
  number for both boundaries.
- Exact real-Windows operator acceptance for Alpha.34 is not yet recorded in the
  current evidence. The R2 bundle and publication must stop rather than invent
  that receipt if confirmation is unavailable.
- A macOS repository preview is packaged Apple Silicon evidence, but it is not
  an installed-app R2 replacement test.
- R2 publication does not prove download throughput across every network.

## Progress log

- 2026-08-26: User authorized Alpha.34 R2 update-channel publication followed
  by Feishu Candidate distribution. Live state confirms a clean branch, exact
  Windows Candidate bytes, configured external R2 credentials, an authenticated
  Feishu operator, and the missing macOS/manual-test inputs. Cleanup, Tag,
  GitHub Release, signing, and promotion remain excluded.
- 2026-08-26: Release receipt provenance now preserves the Candidate's original
  build attempt and separately records the same-or-later successful workflow
  certification attempt. Earlier certification metadata fails closed. All 18
  release test files (80 tests), typecheck, type-aware lint, dead-code analysis,
  and `git diff --check` passed.
- 2026-08-27: Alpha.34 publication is blocked and superseded by the Alpha.35
  flow because application bytes changed in `acf6007`. Its Candidate identity
  and manual acceptance cannot be reused for the new source.

## Closeout

- Final source SHA: pending
- Changed files: pending
- Validation completed: pending
- Validation not completed: pending
- Remaining risks: pending
- Commit/push/release state: pending
