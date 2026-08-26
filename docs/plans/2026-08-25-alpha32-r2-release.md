# Alpha.32 R2 release

Status: active
Owner: root agent
Started: 2026-08-25
Last updated: 2026-08-25

## Goal

Publish the recent `main` changes as `0.1.0-alpha.32` through the internal unsigned R2 update
channel, using exact Windows x64 and macOS arm64 artifacts bound to one remotely reachable source
SHA.

## Non-goals

- Do not create a Git tag, GitHub Release, signed release, or public promotion.
- Do not sign or notarize the artifacts.
- Do not delete Alpha.31 artifacts or purge their cache without separate authorization after both
  target-platform upgrades pass.
- Do not persist R2 credentials in the repository or release artifacts.

## Acceptance criteria

- The release source is a clean `main` commit equal to `origin/main`, with every workspace package
  version set to `0.1.0-alpha.32`.
- The full repository check passes for the exact release source.
- A successful Windows candidate run builds the exact release SHA and passes its hosted gates.
- The user accepts that exact installer on a real Windows x64 machine before an operator receipt is
  created.
- Matching macOS arm64 DMG/ZIP artifacts pass packaged smoke and bundle verification.
- The credentialed R2 plan passes before any write; publication uploads and publicly verifies the
  immutable artifacts before replacing `unsigned-preview-manifest.json` last.
- Installed Windows x64 and macOS arm64 copies complete in-app upgrades and report Alpha.32 before
  any Alpha.31 cleanup is considered.

## Delivery boundary

- Local implementation: authorized by the 2026-08-25 release request.
- Commit: authorized by the user on 2026-08-26 for the scoped Alpha.32 candidate.
- Push: authorized by the user on 2026-08-26 for `origin/main`.
- Candidate build: authorized in principle, but blocked until the exact source is on `origin/main`.
- R2 upload: requested in principle; exact Alpha.32 confirmation is required before the write.
- Tag/release/promotion: explicitly excluded.
- Old-version deletion/cache purge: explicitly excluded.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | The public R2 manifest is healthy and advertises `0.1.0-alpha.31`. | bounded public manifest fetch | 2026-08-25 |
| OBSERVED | Local `main` started clean at `1c8395f5669499db6d999c60594cad38578b8715`, eight commits ahead of `origin/main` and zero behind after fetch; the current Alpha.32 release candidate remains an uncommitted working tree. | live Git | 2026-08-25 |
| OBSERVED | The latest successful Windows candidate is Alpha.31 run `32468019358/1`; no Alpha.32 candidate exists. | GitHub Actions metadata | 2026-08-25 |
| OBSERVED | The current process has no `PI67_R2_*` credential variables. | presence-only environment check | 2026-08-25 |
| OBSERVED | The versioned Alpha.32 working tree passes the complete repository check: 589 test files, 3,044 passing tests, 3 skipped, and all static/architecture/structure gates green. | `corepack pnpm run check` exit 0 | 2026-08-25 |

## Affected boundaries

- Modules/processes: package version metadata, release plan, candidate workflow, R2 release tooling.
- Protocol or persisted state: no protocol or user-state migration is expected.
- Platform/artifact: Windows x64 NSIS EXE; macOS arm64 DMG and ZIP.
- Security/privacy: repository-external least-privilege R2 credentials; credential-free receipts.
- Existing WIP: none at release inspection start.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Use `0.1.0-alpha.32`. | Alpha.31 is the current public R2 manifest version and immutable artifact names cannot be reused. | A higher version is published before this candidate is committed. |
| Keep R2 latest-only cleanup outside this authorization. | Old artifacts are the rollback baseline until both exact installed upgrades pass. | The user separately authorizes cleanup after both upgrades are accepted. |
| Remove redundant exports instead of weakening Knip. | The gate exposed accidental API surface from recent work; no external caller requires it. | A verified cross-package caller requires the export. |

## Checkpoints

- [x] 1. Verify live Git, current public manifest, candidate history, and release contract.
- [x] 2. Restore a clean full repository check and prepare Alpha.32 version metadata.
- [ ] 3. Commit and push the exact release source after explicit authorization.
- [ ] 4. Build and verify the exact-SHA Windows candidate; obtain real Windows x64 acceptance.
- [ ] 5. Build/verify macOS arm64 artifacts and prepare the R2 allowlist bundle.
- [ ] 6. Run the credentialed read-only plan, publish immutable artifacts, and switch manifest last.
- [ ] 7. Verify installed Windows/macOS upgrades; retain Alpha.31 until separately authorized cleanup.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `corepack pnpm run check` | complete gate on the versioned release working tree; rerun on the eventual exact SHA | passed on Alpha.32 working tree; exact-SHA rerun pending |
| Tests | release/candidate test suites inside full check and hosted workflow | all required suites pass | local full suite passed; hosted candidate pending |
| Runtime/host | packaged smoke on both candidate platforms | exact artifact startup and runtime receipt | pending |
| Packaged artifact | preview verification and R2 bundle preparation | size/SHA-256/source/candidate binding | pending |
| Target OS/manual | Windows candidate test; installed Windows/macOS upgrades | exact version and artifact identity | pending |

## Rollback

Before manifest publication, leave Alpha.31 and its public manifest untouched. If Alpha.32 is
published and fails before target upgrade acceptance, withdraw or restore the manifest first so no
new client selects Alpha.32; preserve all immutable artifacts for investigation. Delete or purge
objects only with separate authorization, and never reuse a withdrawn version filename.

## Risks and unknowns

- The source must still be committed, pushed, and revalidated at its resulting exact SHA before it
  can enter the Windows candidate workflow or satisfy the R2 publication source gate.
- Real Windows x64 candidate acceptance must come from the user after the exact run completes.
- R2 credentials must be supplied through repository-external operator configuration.
- Installed Alpha.31-to-Alpha.32 upgrades remain unverified on both target operating systems.

## Progress log

- 2026-08-25: Confirmed public Alpha.31, selected Alpha.32 as the next immutable version, refreshed
  `origin/main`, and found local `main` ahead by eight commits.
- 2026-08-25: The first full check stopped at Knip on accidental exports introduced by recent model
  grouping and indexed-search work; started a minimal API-surface repair.
- 2026-08-25: Restored API-surface and file-structure gates without weakening policy. Split the
  Session Catalog, SQLite content index/schema/mutations, Pi conversation actions, event bus, and
  oversized test responsibilities into focused modules. The complete repository check then passed
  with 589 test files, 3,044 passing tests, and 3 skipped.
- 2026-08-25: Prepared all eight workspace manifests for `0.1.0-alpha.32`; commit and push remain
  intentionally pending current authorization.
- 2026-08-25: Re-ran the complete repository check after the Alpha.32 version bump; it exited 0
  with 589 test files, 3,044 passing tests, 3 skipped, 82.24% statement coverage, and all static,
  architecture, structure, transport, and workflow gates green.
- 2026-08-26: Received explicit authorization for a scoped Alpha.32 commit and push to
  `origin/main`; live fetch confirmed zero remote-only commits before staging.

## Closeout

- Final source SHA: pending
- Changed files: Alpha.32 manifests, release plan, recent-change gate repairs and structural splits
- Validation completed: complete local repository check on the versioned Alpha.32 working tree
- Validation not completed: exact Windows candidate/manual test, R2 publication, target upgrades
- Remaining risks: credentials and target-platform acceptance
- Commit/push/release state: no commit, push, candidate dispatch, R2 write, cleanup, Tag, or Release
