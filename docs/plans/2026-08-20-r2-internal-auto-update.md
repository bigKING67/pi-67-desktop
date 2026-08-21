# R2 internal unsigned auto-update

Status: complete locally; unpublished
Owner: Codex
Started: 2026-08-20
Last updated: 2026-08-21

## Goal

Replace the GitHub-page-only update check with an internal unsigned update flow backed by
`https://updates.52671314.xyz`: packaged Windows x64 and macOS arm64 clients check a bounded
manifest, download only their exact artifact after an explicit click, verify byte count and
SHA-256, and start the platform update handoff.

## Non-goals

- Code signing, Apple notarization, Developer ID, Authenticode, or commercial distribution.
- Publishing a real update, creating Cloudflare credentials, or uploading product artifacts.
- Commit, push, Tag, GitHub Release, or promotion.
- Claiming Windows or macOS target-machine success from source tests or a macOS preview.

## Acceptance criteria

- Update checks use only the fixed R2 origin and a bounded schema; remote URLs, names, sizes,
  hashes, versions, and platform targets fail closed.
- Automatic checks never download or install. One explicit user action downloads, verifies,
  and initiates installation; progress and bounded failures remain observable.
- Windows uses the existing per-user NSIS update path. macOS uses an explicitly internal,
  unsigned bundle-replacement helper with exact bundle/version validation and rollback.
- Release preparation generates the metadata from exact locally verified artifacts and requires
  artifacts to be uploaded before mutable metadata.
- Targeted unit/type/lint/build gates pass. Packaged evidence is reported separately by platform.

## Delivery boundary

- Local implementation: authorized.
- Commit: not authorized.
- Push: not authorized.
- Candidate build/upload: not authorized in this turn.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | R2 bucket `pi67-desktop-updates` and custom domain `updates.52671314.xyz` are active. | Live Cloudflare dashboard and exact-URL HTTP probe | 2026-08-20 |
| OBSERVED | Versioned binaries are cached for one year; JSON/YML/SIG metadata bypasses cache. | Live Cloudflare Cache Rules | 2026-08-20 |
| OBSERVED | Before this implementation, Desktop only checked GitHub prerelease metadata and opened a release page; it never downloaded or installed. | Baseline `apps/desktop/src/manual-update*`, Renderer update files | 2026-08-20 |
| OBSERVED | The product already builds unsigned Windows NSIS and macOS DMG/ZIP artifacts. | `electron-builder.yml`, unsigned packaging scripts | 2026-08-20 |
| OBSERVED | Official electron-updater documentation requires signing for macOS auto-update. | electron-builder auto-update documentation | 2026-08-20 |

## Affected boundaries

- Modules/processes: Electron Main, narrow Preload bridge, Renderer update projection/dialog,
  release metadata preparation.
- Protocol or persisted state: additive update IPC actions; no Pi JSONL or Workspace mutation.
- Platform/artifact: Windows x64 NSIS; macOS arm64 ZIP/DMG, with ZIP as the replacement payload.
- Security/privacy: fixed HTTPS origin, bounded manifest/download, SHA-256, no credentials or user
  content in update requests. Unsigned delivery intentionally has no independent publisher trust.
- Existing WIP: capability/Skill Pack changes and their PRODUCT/DESIGN updates are unrelated and
  must not be staged, reverted, or overwritten.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Keep the channel explicitly named `unsigned-preview`. | The user rejected certificate work and this is an internal small-team channel. | The user later authorizes a signed channel. |
| Keep automatic work check-only; download/install requires an explicit click. | Avoid surprise bandwidth and destructive replacement. | The user explicitly requests unattended rollout. |
| Use a fixed JSON manifest plus exact SHA-256/size verification. | Works for R2 and both current artifact types without a publishing service. | A signed manifest or updater framework replaces this trust model. |
| Treat macOS as a custom internal updater, not electron-updater. | Official electron-updater rejects unsigned macOS updates. | Developer ID signing becomes available. |
| Upload immutable artifacts before mutable metadata. | Prevents clients from caching a metadata reference to a missing artifact. | Never; this is the publication invariant. |

## Checkpoints

- [x] 1. Manifest and state contracts reject untrusted input and select one exact platform artifact.
- [x] 2. Download pipeline is bounded, cancellable, atomic, and checksum verified.
- [x] 3. Windows/macOS platform handoffs are guarded and testable without mutating the developer app.
- [x] 4. Main/Preload/Renderer expose check, download, cancel, and install states/actions.
- [x] 5. Release preparation emits reproducible R2 metadata from verified exact artifacts.
- [x] 6. Targeted gates and available packaged smoke complete without publishing.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | typecheck, lint, build, architecture, transport, dependency, dead-code, protocol, and structure checks | affected contracts and production boundaries green | passed; structure policy covers 1,772 governed files and architecture covers 796 modules with zero cycles |
| Tests | targeted Vitest plus full Vitest and full Chromium E2E | release tooling and updater regressions pass; full Vitest coverage 581 files/2,998 passed + 3 skipped; final Chromium E2E rerun passes 198/198 | passed for current source gates |
| Runtime/host | packaged update state probe against absent metadata | bounded observable result, no install | observed HTTP 404 in fixed-origin update dialog; no download/install action occurred |
| Packaged artifact | `preview:mac:unsigned` after gates and exact-artifact smoke retry | exact rebuilt artifact and smoke | passed after one transient launch timeout and a same-artifact retry; app.asar size 183,437,896, SHA-256 `e6f748fc4e466fde09db1c594232fed334d614f475acfbee7d3e5ded22efdcfd`; DMG size 359,485,504, SHA-256 `d1dd50636f1bfe9aed21513427b7288803b90c2e99d0ad9c56b91edd8c533c11`; ZIP size 368,763,450, SHA-256 `983a724b7b445e80d8cf3c88810c791bca6942dfa7c99730ffd57df2bb93761b` |
| Target OS/manual | Windows x64 and installed macOS upgrade | exact before/after versions and artifact hashes | not authorized/not completed |

## Rollback

- Source rollback is the scoped update diff only; unrelated WIP remains untouched.
- Windows leaves installation replacement to the existing NSIS installer.
- macOS stages before quit, renames the current bundle to a same-volume backup, restores that
  backup if activation fails, and removes it only after the replacement is in place.
- R2 publication rollback, when separately authorized, deletes mutable metadata first, then
  artifacts, and purges exact cached artifact URLs.

## Risks and unknowns

- Unsigned artifacts have no OS publisher identity; HTTPS plus same-origin SHA-256 protects
  transfer integrity but not a compromised Cloudflare account.
- Windows lifecycle needs a real Windows x64 upgrade test.
- macOS replacement depends on write permission for the installed bundle parent and needs a real
  installed-app upgrade test; source/unit tests and repository preview are insufficient.
- A successful macOS `open` request does not prove that the replacement stays healthy; the adjacent
  backup is removed after the request is accepted, so a later startup crash requires manual DMG recovery.
- Current R2 placement is WNAM and China-carrier throughput remains unverified.
- The repository structure gate now passes after the capability and Skill Pack refactors; no
  update-owned or managed-capability file exceeds its governed structure contract.

## Progress log

- 2026-08-20: Cloudflare infrastructure and exact-URL cache behavior verified; implementation
  started with no signing and no publication authorization.
- 2026-08-20: Replaced the GitHub-page-only flow with fixed R2 manifest validation, bounded atomic
  download, explicit progress/cancel UI, Windows NSIS handoff, and the guarded macOS replacement helper.
- 2026-08-20: Found and fixed a long-lived IPC pending-state bug that disabled cancellation during a
  real download; the Playwright fixture now holds the start request open until cancellation.
- 2026-08-20: The first packaged smoke caught a stale About-page update label. After syncing the
  smoke contract, a clean `preview:mac:unsigned` rerun passed and opened the rebuilt preview.
- 2026-08-21: Bound local bundle generation to the verified candidate directory and limited remote
  publication to the three product artifacts plus manifest. Publish now requires an exact clean
  source SHA reachable from `origin/main`, matching candidate provenance, and strict rejection of
  unknown or duplicate flags.
- 2026-08-21: Full Vitest coverage and Chromium E2E completed. A later exact macOS package rebuild
  had one transient smoke launch timeout after debugger connection; the same artifact passed on
  retry and was then opened and observed live. No target-machine upgrade or R2 write was inferred.
- 2026-08-21: Hardened concurrent update checks, rejected unsafe update directories and local
  symlink artifacts, and made Cloudflare publication fail closed on unsuccessful JSON envelopes,
  manifest redirects, or public URL drift. The complete source gate now passes without exceptions.

## Closeout

- Base source SHA: `96d2078c4bc5ab6a7301f6733db43375e4afe061`; implementation remains uncommitted in a dirty tree
- Changed files: Desktop update controller/validator/downloader/installers, narrow IPC/Preload bridge,
  Renderer projection/dialog/settings, release preparation, candidate/smoke contracts, tests, and docs
- Validation completed: targeted and full tests, typecheck, lint, build, Chromium update interaction,
  architecture, transport, dependency, dead-code, protocol revision, and macOS packaged smoke
- Validation not completed: Windows/macOS target-machine upgrade, formal publication
- Remaining risks: unsigned publisher trust, Cloudflare/build-authority compromise, target-OS lifecycle,
  later macOS startup failure after `open`, and unmeasured mainland carrier throughput
- Commit/push/release state: none authorized
