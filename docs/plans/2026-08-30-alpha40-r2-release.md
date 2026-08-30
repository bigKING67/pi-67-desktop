# Alpha.40 unsigned R2 release

Status: active
Owner: Codex
Started: 2026-08-30
Last updated: 2026-08-30

## Goal

Freeze the current Pi-67 Desktop source as `0.1.0-alpha.40`, build and verify
Windows x64 and macOS arm64 unsigned update artifacts from one exact source SHA,
and publish the three immutable artifacts plus the mutable manifest to the
internal Cloudflare R2 update channel using manifest-last ordering.

## Non-goals

- Do not create a Git tag, GitHub Release, signed build, notarization, or stable promotion.
- Do not reuse Alpha.39 artifact bytes or receipts for Alpha.40.
- Do not expose R2 credentials or commit generated artifacts and receipts.
- Do not perform latest-only cleanup, withdrawal, cache purge, or unknown-object deletion.

## Acceptance criteria

- [x] All workspace package manifests identify `0.1.0-alpha.40` and relevant tests pass.
- [ ] The release source is a clean, remotely reachable `origin/main` SHA that includes
  browser67 v0.8.0 and pi67-core `e7ec566...`.
- [ ] Windows candidate identity, successful workflow receipt, operator acceptance,
  installer bytes, version, runtime, and source SHA agree. The user's current Windows
  acceptance is carried forward without another confirmation prompt, but not reused
  across different bytes.
- [ ] macOS DMG/ZIP identity, packaged smoke, version, runtime, source SHA, byte count,
  SHA-256, `hdiutil verify`, and `unzip -tq` agree with Windows provenance.
- [ ] The verified unsigned-preview and R2 bundles contain the exact allowlist and put
  `unsigned-preview-manifest.json` last.
- [ ] R2 artifacts pass public HTTP 200, full byte/hash, Range 206, Content-Range, and
  immutable-cache verification before the no-store manifest is published and re-read.
- [ ] Post-publication inventory and credential-free receipt prove the final channel state.

## Delivery boundary

- Local implementation: Alpha.40 versioning, validation, packaging, and ignored release evidence authorized.
- Commit: scoped Alpha.40 source commit authorized as required by exact-SHA release.
- Push: `main` push authorized as required by exact-SHA Windows/R2 release.
- Candidate build/upload: Windows workflow, artifact download, macOS package, and R2 artifact/manifest upload authorized.
- Tag/release/promotion: GitHub Tag/Release and signed promotion are not authorized.
- Deletion: automatic or explicit old-version deletion is not assumed; inspect the exact R2 plan first.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Public unsigned manifest is `0.1.0-alpha.39`. | `https://updates.52671314.xyz/unsigned-preview-manifest.json` | 2026-08-30 |
| OBSERVED | Alpha.39 Windows candidate run `33289266938/1` passed at source `0178a574...`; it is only the upgrade baseline for Alpha.40. | GitHub Actions and local candidate identity | 2026-08-30 |
| OBSERVED | Local `main` is five commits ahead of `origin/main`; browser capability update paths were uncommitted before Alpha.40 freeze. | live Git status | 2026-08-30 |
| VERIFIED | R2 operator env exists outside the repository with mode `0600`; values were not read or printed. | filesystem metadata | 2026-08-30 |

## Affected boundaries

- Modules/processes: workspace package manifests, capability locks/fixtures, Windows candidate workflow, macOS packaging, release bundle and R2 publisher.
- Protocol or persisted state: no database or Pi JSONL migration; updater advances only to a higher canonical SemVer.
- Platform/artifact: Windows x64 NSIS EXE and macOS arm64 DMG/ZIP, all unsigned.
- Security/privacy: repo-external least-privilege R2 credentials; no secret output or committed artifact.
- Existing WIP: all current Desktop task changes belong to the release; ignored prior artifacts remain non-authoritative until exact identity verification.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Release `0.1.0-alpha.40`. | Alpha.39 is already public; immutable filenames forbid replacing it with different bytes. | A newer live version appears before mutation. |
| Build both platforms from the new remote source SHA. | Alpha.39 receipts cannot prove Alpha.40 source or bytes. | None; this is a release invariant. |
| Publish artifacts before manifest. | Prevents clients from seeing references to missing artifacts. | None; this is the channel contract. |
| Do not infer old-version deletion authorization. | R2 upload is authorized, but deletion changes separate immutable objects. | User authorizes the exact plan delete set. |

## Checkpoints

- [ ] 1. Bump and validate Alpha.40 source; scoped commit and push exact `main` SHA.
- [ ] 2. Run/download the Windows candidate and bind the accepted receipt to exact bytes.
- [ ] 3. Build and verify macOS artifacts from the same SHA.
- [ ] 4. Prepare and verify the unsigned-preview and R2 bundles.
- [ ] 5. Run read-only R2 plan and resolve any exact mutation conflict.
- [ ] 6. Publish artifact bytes, then manifest, then verify public state and receipt.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | version scan, `git diff --check`, focused/full gates | Alpha.40 and capability identities agree | PASS: 10 manifests; version availability; five current capability sources; 6 focused files / 48 tests; aggregate 622 files / 3,236 passed / 3 skipped |
| Git | staged diff audit, commit, push, remote readback | clean exact source SHA on `origin/main` | pending |
| Windows | `Windows candidate`, identity/readback, operator receipt | success and exact source/version/bytes | pending |
| macOS | `preview:mac:unsigned`, identity and container checks | same source/version/runtime and valid DMG/ZIP | pending |
| R2 preflight | bundle preparation and `release:r2:plan` | no conflict/future object; exact planned mutations | pending |
| R2 publish | `release:r2:publish` plus independent public checks | artifacts first, manifest last, hashes/Range/cache pass | pending |

## Rollback

Before manifest cutover, stop without changing the public version. After manifest cutover,
withdrawal requires separate authorization: remove or replace the manifest first, verify it,
then delete/purge exact version URLs if authorized. Never reuse Alpha.40 filenames.

## Risks and unknowns

- The user's Windows acceptance must be bound to the new candidate identity; hosted success alone
  remains distinct from a target-device upgrade receipt.
- Normal R2 publication may plan automatic three-version retention deletion. If any delete is
  required, publishing pauses at the read-only plan until that exact set is authorized.

## Progress log

- 2026-08-30: Audited live Git, public Alpha.39 manifest, latest Windows candidate,
  Alpha.40 Tag/Release availability, and external R2 credential-file permissions.
- 2026-08-30: Bumped all workspace manifests to Alpha.40. Version availability,
  exact capability reachability/freshness, 48 focused tests, and the complete
  622-file source gate passed before staging.

## Closeout

- Final source SHA: pending
- Changed files: pending
- Validation completed: pending
- Validation not completed: pending
- Remaining risks: pending
- Commit/push/release state: active; no R2 mutation yet
