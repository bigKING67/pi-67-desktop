# Alpha.35 rebuild and internal publication

Status: active
Owner: Codex CLI
Started: 2026-08-27
Last updated: 2026-08-27

## Goal

Build, verify, and distribute an unsigned Alpha.35 Candidate from the exact
source that includes the prompt-stash persistence and recovery fix, then publish
that same accepted Candidate through the internal R2 update channel.

## Non-goals

- Do not create a Git tag, GitHub Release, signed build, notarized build, or
  stable-channel promotion.
- Do not reuse Alpha.34 artifact bytes, identity, or manual acceptance for
  Alpha.35.
- Do not delete older R2 or Feishu files, purge caches, or overwrite an
  immutable versioned object.
- Do not claim real Windows or macOS update success from source tests, hosted
  runners, or local packaging alone.

## Acceptance criteria

- All eight workspace manifests identify `0.1.0-alpha.35`, and source gates
  pass before the version commit is pushed.
- Windows x64 NSIS and macOS arm64 DMG/ZIP artifacts are built from the same
  exact `origin/main` SHA and pass their applicable packaged checks.
- The three versioned product files are uploaded to the configured Feishu
  folder and re-listed with exact expected names and sizes.
- A real Windows x64 operator test accepts the exact Alpha.35 Candidate before
  the R2 bundle or mutable manifest is published.
- R2 receives all three immutable Alpha.35 artifacts before the no-store
  manifest switches; public size, Range, SHA-256, and manifest verification
  pass afterward.

## Delivery boundary

- Local implementation: version and release-plan changes plus the
  behavior-equivalent module extraction required by the existing structure
  gate; the bug fix is already committed as `acf6007`.
- Commit: scoped Alpha.35 version and plan commits are authorized.
- Push: authorized as required by exact-main Candidate and R2 gates.
- Candidate build/upload: Windows GitHub Actions build, local macOS build, and
  upload of the three exact product files to Feishu are authorized.
- Tag/release/promotion: internal unsigned R2 publication is authorized only
  after the exact Alpha.35 Windows manual-test gate; Tag, GitHub Release,
  signing, notarization, stable promotion, cleanup, and cache purge are excluded.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Root checkout is the only worktree, is clean at `acf6007`, and is one commit ahead of `origin/main`. | live Git | 2026-08-27 |
| OBSERVED | `acf6007` changes application behavior and tests across Desktop, Renderer, Protocol, and product/design contracts. | exact commit diff | 2026-08-27 |
| OBSERVED | All eight manifests still identified Alpha.34 before this plan. | live version scan | 2026-08-27 |
| OBSERVED | Alpha.34 Candidate `32971119431/2` at `f50a4442` is the required previous-version Windows baseline. | live GitHub Actions and Candidate plan | 2026-08-27 |
| OBSERVED | The public R2 manifest still advertises Alpha.33; no Alpha.35 artifacts or manual-test receipt exist yet. | prior publication checkpoint and local artifact scan | 2026-08-27 |

## Affected boundaries

- Modules/processes: Desktop/Renderer prompt persistence and recovery plus
  Candidate packaging and internal distribution.
- Protocol or persisted state: encrypted Desktop draft persistence and the
  mutable internal R2 update manifest.
- Platform/artifact: Windows x64 unsigned NSIS and macOS arm64 unsigned DMG/ZIP.
- Security/privacy: repository-external operator credentials only; no secrets
  or user content enter Git or release receipts.
- Existing WIP: none; the application fix is already committed and the root
  checkout was clean at plan start.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Use Alpha.35 as a new immutable identity. | Application bytes changed after Alpha.34. | None. |
| Use the exact Alpha.34 Candidate as the Windows upgrade baseline. | The new in-app hop must exercise the currently accepted previous version. | The baseline artifact fails provenance or byte verification. |
| Stop before R2 publication until real Windows acceptance. | Hosted lifecycle evidence cannot replace the user's installed environment. | The user confirms the exact Alpha.35 Candidate and the receipt validates. |
| Upload immutable R2 objects before the manifest. | Clients must never receive metadata for missing or mismatched bytes. | None. |

## Checkpoints

- [x] 1. Pass focused bug-fix tests and repository source gates with Alpha.35.
- [ ] 2. Commit and push the exact Candidate source; prove `main == origin/main`.
- [ ] 3. Build and verify Windows x64 and macOS arm64 Candidates from that SHA.
- [ ] 4. Upload and re-list the exact three versioned Candidate files in Feishu.
- [ ] 5. Record exact Alpha.35 Windows operator acceptance.
- [ ] 6. Prepare, publish, and publicly verify the R2 artifacts and manifest.
- [ ] 7. Record remaining target-OS evidence and close out without cleanup.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | focused Vitest, `typecheck`, `lint`, repository quality gates, `git diff --check` | no source or contract failure | passed; structure-only extraction restored the 460-line gate without changing behavior |
| Tests | full coverage suite plus release-contract tests | no weakened persistence, recovery, packaging, or publication gate | passed: 599 files, 3,120 passed, 3 skipped with one worker; default/50% concurrency exposed only independently passing timing/temp-file fixtures |
| Runtime/host | Windows Candidate workflow and `preview:mac:unsigned` | exact-source packaged smoke and installer lifecycle evidence | pending |
| Packaged artifact | Candidate identity, size, SHA-256, bundle verification | exact three Alpha.35 product files | pending |
| Target OS/manual | real Windows x64 Candidate test; later in-app update checks | exact identity-bound operator result | pending |
| Distribution | Feishu re-list and public R2 readback | exact names, sizes, hashes, Range, and no-store manifest | pending |

## Rollback

- Before push, stop with local commits only if a source gate fails.
- After push, repair any failure with a new scoped commit and new Candidate SHA;
  never rewrite published history or reuse invalid artifact identity.
- Before the manifest switch, any upload failure leaves the previous version
  advertised. Preserve successfully uploaded immutable objects and retry only
  after exact remote readback.
- After a manifest switch, any withdrawal or remote cleanup requires separate
  explicit authorization.

## Risks and unknowns

- The broad persistence/recovery fix changes multiple runtime ownership paths;
  targeted tests and full repository gates must both pass.
- Windows installer and shortcut continuity still require hosted and then real
  Windows evidence.
- Local macOS packaging proves the repository artifact on Apple Silicon, not a
  production-signed installation or a Windows update.
- Manual acceptance will pause R2 publication even if both builds pass.

## Progress log

- 2026-08-27: User authorized rebuilding and internal publication after the
  application fix. Live Git found a clean canonical checkout at `acf6007`, one
  commit ahead of `origin/main`; Alpha.34 evidence is preserved only as the
  previous-version baseline.
- 2026-08-27: All eight manifests now identify Alpha.35. The 74 focused
  persistence/recovery tests passed. The first full gate exposed five files
  above the existing 460-line structural limit, so codec, fingerprint, and
  lifecycle-report logic were extracted into purpose-specific modules without
  changing contracts; 65 focused extraction tests, typecheck, lint,
  architecture, dead-code, references, structure, transport, workflow checks,
  and `git diff --check` passed.
- 2026-08-27: Default and 50% worker coverage runs exposed concurrency-sensitive
  Git/process/temp-file fixture failures; every failed file passed in isolation.
  The complete one-worker coverage run then passed all 599 files with 3,120
  tests passed and 3 platform skips. No timeout or assertion was weakened.

## Closeout

- Final source SHA: pending
- Changed files: pending
- Validation completed: pending
- Validation not completed: pending
- Remaining risks: pending
- Commit/push/release state: pending
