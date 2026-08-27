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
| OBSERVED | Alpha.34 standard Candidate artifact was uploaded by certification attempt 2, while its immutable build identity records attempt 1; the prior workflow exposed only one attempt input for both boundaries. | live artifact inventory and identity JSON | 2026-08-27 |
| OBSERVED | The public R2 manifest still advertises Alpha.33; no Alpha.35 artifacts or manual-test receipt exist yet. | prior publication checkpoint and local artifact scan | 2026-08-27 |
| OBSERVED | Windows run `33036847162/1` stopped before packaging because the branch-tracked AI Berkshire Pack lock was stale: locked `2760dc48`, live `main` `fad8a0fa`. | GitHub Actions provenance gate and local freshness audit | 2026-08-27 |
| OBSERVED | The exact upstream range changes no `codex-skills/`, `tools/`, or `LICENSE` input; the locked Pi-67 adapter retained 21 members and generated Pack `1.0.2` with new immutable manifest and bundle hashes. | exact Git diff and isolated adapter output | 2026-08-27 |
| OBSERVED | The first post-lock `prepare:capabilities` failed because the Desktop lock lacked member hashes and therefore could not seed its own `1.0.1` Pack baseline on a clean machine. | local clean regeneration attempt and overlay implementation trace | 2026-08-27 |
| OBSERVED | Windows run `33037846524/1` built and smoke-tested Alpha.35, then certification stopped before installation because `verify-windows-installer-lifecycle.mjs` referenced an unimported `writeFile`. | failed Windows step log and lifecycle diagnostic artifact | 2026-08-27 |

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
| Pass the baseline Artifact attempt and build-identity attempt separately. | A rerun can certify unchanged build bytes in a later workflow attempt. | GitHub changes rerun artifact provenance so both attempts are guaranteed identical. |
| Advance the branch-tracked AI Berkshire Pack lock before rebuilding. | Candidate freshness is fail-closed; a floating branch is never consumed implicitly by ordinary builds. | The tracked source policy changes or the reviewed ref returns to the prior commit. |
| Make the Desktop Skill Pack lock self-contained at member level. | A Candidate must regenerate the same Pack version and bytes without relying on a prior local artifact cache or a stale Pi-67 Core baseline. | Pi-67 exposes an equivalent immutable Pack artifact contract that Desktop can verify directly. |

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
| Tests | full coverage suite plus release-contract tests | no weakened persistence, recovery, packaging, or publication gate | passed: final one-worker run 599 files, 3,122 passed, 3 skipped; targeted capability tests 25 passed; Renderer resource E2E 8 passed on isolated port |
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
- 2026-08-27: Pre-dispatch provenance inspection found that Alpha.34's standard
  Candidate artifact belongs to certification attempt 2 while its immutable
  build identity belongs to attempt 1. The Candidate and lifecycle-debug
  workflows now carry those attempts separately, with contract tests, instead
  of forcing one false value to serve both download and byte identity.
- 2026-08-27: Windows Candidate run `33036847162/1` failed before packaging at
  the first-party freshness gate because AI Berkshire `main` advanced from the
  locked `2760dc48` to `fad8a0fa`. Exact diff review found no Pack input changes;
  the locked Pi-67 adapter preserved all 21 members and generated Pack `1.0.2`
  with manifest `7c757d9e...` and bundle `c26e3600...`. The earlier macOS
  Alpha.35 artifacts at source `92bdb11` are superseded and will not be
  distributed; both platforms must rebuild from the post-lock final SHA.
- 2026-08-27: The first clean Pack regeneration then exposed that the Desktop
  lock stored only aggregate hashes, so it could not reconstruct the prior
  `1.0.1` member baseline and incorrectly restarted from Pi-67 Core `1.0.0`.
  The lock now records all 21 ordered member hashes and seeds the adapter input
  before every build, removing dependence on local generated-cache history.
- 2026-08-27: Self-contained `prepare:capabilities`, remote source-lock
  verification, live freshness, build, type/lint/architecture/reference/
  structure/workflow gates, and the final one-worker coverage run passed. The
  default concurrent coverage run had one five-second Git-fixture timeout; its
  four tests passed in isolation. Renderer resource E2E initially reused an
  unrelated service already on port 5173, then passed all eight tests against
  the production Renderer on isolated port 5174 after the expected baseline
  string was advanced to `1.0.2`.
- 2026-08-27: Windows run `33037846524/1` passed provenance, packaging,
  packaged Electron smoke, UI, and Candidate identity, but did not exercise an
  install: the lifecycle verifier failed while creating its temporary Git
  workspace because `writeFile` was not imported after the Alpha.35 module
  extraction. The verifier now owns a directly tested workspace-fixture writer;
  this source change invalidates the first Windows build and final-SHA macOS
  artifacts, so both platforms must rebuild again.
- 2026-08-27: The workspace-fixture regression test, typecheck, lint, structure,
  and `git diff --check` passed. A fresh default coverage run passed 598 of 599
  files before two known five-second Git-fixture timeouts; those four tests
  passed in isolation. A one-worker coverage run passed the target verifier and
  598 other files before an unrelated temporary-directory cleanup race in the
  unsigned-preview symlink test; all three tests in that file passed immediately
  in isolation. No timeout, assertion, or product contract was weakened.

## Closeout

- Final source SHA: pending
- Changed files: pending
- Validation completed: pending
- Validation not completed: pending
- Remaining risks: pending
- Commit/push/release state: pending
