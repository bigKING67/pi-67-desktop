# Alpha.40 unsigned R2 release

Status: completed
Owner: Codex
Started: 2026-08-30
Last updated: 2026-08-31

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
- [x] The release source is a clean, remotely reachable `origin/main` SHA that includes
  browser67 v0.8.0 and pi67-core `e7ec566...`.
- [x] Windows candidate identity, successful workflow receipt, operator acceptance,
  installer bytes, version, runtime, and source SHA agree. The user's current Windows
  acceptance is carried forward without another confirmation prompt, but not reused
  across different bytes.
- [x] macOS DMG/ZIP identity, packaged smoke, version, runtime, source SHA, byte count,
  SHA-256, `hdiutil verify`, and `unzip -tq` agree with Windows provenance.
- [x] The verified unsigned-preview and R2 bundles contain the exact allowlist and put
  `unsigned-preview-manifest.json` last.
- [x] R2 artifacts pass public HTTP 200, full byte/hash, Range 206, Content-Range, and
  immutable-cache verification before the no-store manifest is published and re-read.
- [x] Post-publication inventory and credential-free receipt prove the final channel state.

## Delivery boundary

- Local implementation: Alpha.40 versioning, validation, packaging, and ignored release evidence authorized.
- Commit: scoped Alpha.40 source commit authorized as required by exact-SHA release.
- Push: `main` push authorized as required by exact-SHA Windows/R2 release.
- Candidate build/upload: Windows workflow, artifact download, macOS package, and R2 artifact/manifest upload authorized.
- Tag/release/promotion: GitHub Tag/Release and signed promotion are not authorized.
- Deletion: the exact three Alpha.37 objects reported by the read-only plan were authorized
  on 2026-08-31 and deleted only after the Alpha.40 manifest was published and verified.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| VERIFIED | Alpha.40 source `8c0c56038c92e156ee617f7791a269cb3024b14a` was clean, equaled `origin/main` at candidate freeze/publication, and remains reachable from `main`. | live Git status and remote ref | 2026-08-31 |
| VERIFIED | Windows candidate run `33320336253/1`, candidate identity, operator receipt, EXE, and packaged executable agree with the Alpha.40 source and runtime. | GitHub Actions and ignored release evidence | 2026-08-31 |
| VERIFIED | macOS DMG/ZIP identity, packaged smoke, container checks, bytes, and hashes agree with the same Alpha.40 source and runtime. | local package and ignored release evidence | 2026-08-31 |
| VERIFIED | The public no-store manifest is byte-identical to the Alpha.40 bundle; all three product URLs passed full SHA-256 readback, HTTP 200, Range 206, exact Content-Range, and immutable-cache checks. | R2 publisher plus independent public checks | 2026-08-31 |
| VERIFIED | Post-publication plan reports Alpha.40 current, no upload/conflict/future/delete work, and retention limited to Alpha.40/39/38. | read-only R2 plan and credential-free receipt | 2026-08-31 |
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

- [x] 1. Bump and validate Alpha.40 source; scoped commit and push exact `main` SHA.
- [x] 2. Run/download the Windows candidate and bind the accepted receipt to exact bytes.
- [x] 3. Build and verify macOS artifacts from the same SHA.
- [x] 4. Prepare and verify the unsigned-preview and R2 bundles.
- [x] 5. Run read-only R2 plan and resolve any exact mutation conflict.
- [x] 6. Publish artifact bytes, then manifest, then verify public state and receipt.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | version scan, `git diff --check`, focused/full gates | Alpha.40 and capability identities agree | PASS: 10 manifests; version availability; five current capability sources; 6 focused files / 48 tests; aggregate 622 files / 3,236 passed / 3 skipped |
| Git | staged diff audit, commit, push, remote readback | clean exact source SHA on `origin/main` | PASS: `8c0c56038c92e156ee617f7791a269cb3024b14a` |
| Windows | `Windows candidate`, identity/readback, operator receipt | success and exact source/version/bytes | PASS: run `33320336253/1`; EXE SHA-256 `4b6c7561...` |
| macOS | `preview:mac:unsigned`, identity and container checks | same source/version/runtime and valid DMG/ZIP | PASS: DMG `41d8e9f2...`; ZIP `a06ae690...` |
| R2 preflight | bundle preparation and `release:r2:plan` | no conflict/future object; exact planned mutations | PASS: exact Alpha.37 three-object delete set authorized |
| R2 publish | `release:r2:publish` plus independent public checks | artifacts first, manifest last, hashes/Range/cache pass | PASS: public Alpha.40; post-plan has no pending mutation |

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
- 2026-08-31: Published three immutable Alpha.40 artifacts, verified their full
  public bytes and Range responses, then published and re-read the no-store manifest.
- 2026-08-31: Deleted only the authorized Alpha.37 EXE/DMG/ZIP after cutover.
  The post-publication plan retains Alpha.40/39/38 and reports no pending mutation.

## Closeout

- Final source SHA: `8c0c56038c92e156ee617f7791a269cb3024b14a`.
- Changed files: 18 tracked release-source and plan paths in the Alpha.40 source
  commit; generated installers, bundles, screenshots, and receipts remain ignored.
- Validation completed: source gates; exact remote SHA; Windows candidate and NSIS
  lifecycle; macOS package/container/smoke; bundle validation; R2 direct/public full
  byte verification; manifest equality; HTTP 200/206, Content-Range, and cache headers;
  post-publication inventory and retention verification.
- Validation not completed: signing, notarization, GitHub Tag/Release, and an
  independently observed update cycle on a private end-user Windows/macOS device.
- Remaining risks: artifacts are intentionally unsigned; OS reputation prompts and
  private-device updater behavior remain outside this release's verified evidence.
- Commit/push/release state: Alpha.40 source is pushed; R2 channel is public on
  Alpha.40; the plan closeout is a separate scoped commit; no Tag or GitHub Release.
