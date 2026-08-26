# Alpha.32 R2 release

Status: completed
Owner: root agent
Started: 2026-08-25
Last updated: 2026-08-26

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
- R2 upload: explicitly confirmed and completed on 2026-08-26 for exact Alpha.32 artifacts.
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
| OBSERVED | Clean `main` and `origin/main` resolve to source `776615c2a26eefa3a721554218b5009e6845ab60`; Windows candidate `32914311716/1` completed successfully and the user accepted its exact installer. | live Git, GitHub Actions metadata, candidate identity, user confirmation | 2026-08-26 |
| OBSERVED | Alpha.32 Windows EXE and macOS DMG/ZIP passed preview verification and R2 bundle preparation; the public manifest and all three public artifact byte counts/hashes match the verified bundle. | release verifiers, publication receipt, public HTTP readback | 2026-08-26 |
| OBSERVED | A fresh-cache macOS Alpha.31 copy discovered, downloaded, verified, replaced, and restarted as Alpha.32; the upgraded executable matches the packaged Alpha.32 executable. | live packaged upgrade, bundle metadata, executable SHA-256 | 2026-08-26 |
| OBSERVED | An existing Electron profile reused a pre-publication Alpha.31 manifest while a fresh profile immediately discovered Alpha.32. The R2 manifest object lacked cache metadata; it now serves `Cache-Control: no-store` with unchanged bytes. | live A/B update checks, R2 object metadata, public response headers | 2026-08-26 |
| OBSERVED | A real Windows Alpha.31 copy downloaded and installed Alpha.32, and Alpha.32 launched successfully from `%LOCALAPPDATA%\\Programs\\Pi-67 Desktop`; the update did not relaunch automatically and the existing Desktop shortcut retained a missing target. | user target-machine execution and screenshots | 2026-08-26 |
| OBSERVED | The Windows handoff used `--updated /S`, waited only for NSIS process spawn, did not pin `/D=` to the running installation, and electron-builder's keep-shortcuts path does not rewrite a same-name shortcut during an update. | current updater and electron-builder 26.15.3 NSIS source | 2026-08-26 |

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
- [x] 3. Commit and push the exact release source after explicit authorization.
- [x] 4. Build and verify the exact-SHA Windows candidate; obtain real Windows x64 acceptance.
- [x] 5. Build/verify macOS arm64 artifacts and prepare the R2 allowlist bundle.
- [x] 6. Run the credentialed read-only plan, publish immutable artifacts, and switch manifest last.
- [x] 7. Verify Alpha.32 application replacement on installed Windows/macOS copies.
- [x] 8. Record the Windows post-install failure and hand its remediation to the Alpha.33 release plan; retain Alpha.31 until then.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `corepack pnpm run check` | complete gate on the versioned release source | passed before exact source commit; hosted exact-SHA candidate gates passed |
| Tests | release/candidate test suites inside full check and hosted workflow | all required suites pass | passed; manifest cache-metadata regression tests 13/13 passed |
| Runtime/host | packaged smoke on both candidate platforms | exact artifact startup and runtime receipt | passed for hosted Windows candidate and local macOS package |
| Packaged artifact | preview verification and R2 bundle preparation | size/SHA-256/source/candidate binding | passed for exact Alpha.32 three-file bundle |
| Target OS/manual | Windows candidate test; installed Windows/macOS upgrades | exact version and artifact identity | Windows and macOS application replacement reached Alpha.32; Windows post-install relaunch and existing Desktop-shortcut continuity failed |

## Rollback

Before manifest publication, leave Alpha.31 and its public manifest untouched. If Alpha.32 is
published and fails before target upgrade acceptance, withdraw or restore the manifest first so no
new client selects Alpha.32; preserve all immutable artifacts for investigation. Delete or purge
objects only with separate authorization, and never reuse a withdrawn version filename.

## Risks and unknowns

- Windows Alpha.31-to-Alpha.32 application replacement succeeded, but the post-install relaunch and
  existing Desktop-shortcut lifecycle failed. Alpha.31 artifacts stay as the rollback baseline and
  cleanup remains unauthorized until a new immutable version passes the complete flow.
- Alpha.31 profiles that cached the mutable manifest before publication may continue to see that
  response until their existing local HTTP cache entry expires or is cleared. The public manifest
  now carries `Cache-Control: no-store`, but a remote response header cannot evict bytes already in
  a client cache.
- The repository-external Cloudflare purge variables are not usable, so the attempted exact URL
  purge returned HTTP 404. The manifest is served dynamically and its corrected R2 metadata is
  already visible publicly; do not claim the purge succeeded.

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
- 2026-08-26: Published exact source `776615c2...` as Alpha.32 through R2 after Windows candidate
  `32914311716/1` acceptance. The three immutable artifacts were publicly read back and verified
  before `unsigned-preview-manifest.json` switched last.
- 2026-08-26: Completed a real macOS Alpha.31-to-Alpha.32 application update with a fresh temporary
  cache. An existing profile exposed mutable-manifest HTTP cache reuse, so the R2 manifest metadata
  was corrected to `Cache-Control: no-store` without changing its bytes and release tooling gained
  a regression test. Windows in-app upgrade evidence and any Alpha.31 cleanup were still pending.
- 2026-08-26: Real Windows evidence confirmed Alpha.32 installed and ran from the default per-user
  directory, but NSIS did not relaunch it and the existing Desktop shortcut retained a missing
  target. The remediation pins `/D=` to the running install directory, passes `--force-run`, and
  rewrites only a Desktop shortcut that existed before update; source tests pass, while a new
  Windows candidate and cross-version target-machine upgrade remain required.

## Closeout

- Final source SHA: `776615c2a26eefa3a721554218b5009e6845ab60`
- Changed files: release tooling cache metadata, tests, release documentation, and this plan remain
  uncommitted after the published application source.
- Validation completed: complete source gate, exact Windows candidate/manual acceptance, exact
  three-file R2 publication, public readback, and fresh-cache macOS in-app upgrade.
- Validation not completed: repaired Windows NSIS handoff/shortcut behavior in an exact packaged
  candidate, and existing-cache macOS immediate discovery.
- Remaining risks: pre-existing local manifest cache entries and pending Windows packaged
  cross-version verification of the remediation.
- Commit/push/release state: application source committed/pushed; Alpha.32 R2 published; no Tag,
  GitHub Release, old-version cleanup, or cache purge completed.
