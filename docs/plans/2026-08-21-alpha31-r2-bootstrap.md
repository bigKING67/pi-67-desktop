# Alpha.31 R2 bootstrap publication

Status: active
Owner: root agent
Started: 2026-08-21
Last updated: 2026-08-21

## Goal

Publish the exact, manually accepted Alpha.31 Windows candidate and matching macOS artifacts to the
internal R2 update channel without creating a Git tag or GitHub Release.

## Non-goals

- Do not create a Git tag, GitHub Release, signed release, or promotion.
- Do not delete Alpha.30 from Feishu or R2 before Windows and macOS in-app upgrades pass.
- Do not persist R2 credentials in the repository or release artifacts.

## Acceptance criteria

- A local manual-test receipt binds the operator confirmation to the exact successful Windows
  candidate run, candidate identity, installer bytes, packaged executable bytes, repository, and
  source commit without inventing a promotion run.
- The verified R2 bundle contains the exact three platform artifacts, manifest, candidate identity,
  and manual-test receipt.
- The read-only R2 plan succeeds before any upload.
- Publication uploads immutable artifacts first, verifies their public bytes, and publishes the
  manifest last.
- Alpha.30 to Alpha.31 in-app upgrades pass on real Windows x64 and installed macOS arm64 before
  old objects are deleted.

## Delivery boundary

- Local implementation: authorized by the current continuation request.
- Commit/push: authorized by the 2026-08-21 continuation request; limited to the release-only files
  recorded by this plan.
- Candidate build/upload: exact Alpha.31 candidates already exist; R2 upload remains blocked on
  repository-external credentials and a clean committed source state.
- Tag/release/promotion: explicitly excluded.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `main` equals `origin/main` and the worktree was clean before this plan. | `git status --short --branch` | 2026-08-21 |
| OBSERVED | Windows candidate run `32468019358`, attempt `1`, is the exact Alpha.31 candidate source `3770b96b606905a6364aea54466cf0c290b3031e`. | downloaded candidate identity and prior workflow receipt | 2026-08-21 |
| OBSERVED | The user confirmed the Feishu Alpha.31 Windows x64 candidate passed real-machine acceptance. | current conversation | 2026-08-21 |
| OBSERVED | The public update manifest returns HTTP 404. | `curl https://updates.52671314.xyz/unsigned-preview-manifest.json` | 2026-08-21 |
| OBSERVED | R2 account/access/secret environment variables are unset in the current process. | presence-only environment check | 2026-08-21 |
| OBSERVED | The existing manual-test receipt generator requires a promotion run even though R2 publication excludes Tag/Release promotion. | `eng/release/windows-preview-promotion.mjs` | 2026-08-21 |

## Affected boundaries

- Modules/processes: release receipt verification, verified preview bundle, R2 release tooling.
- Protocol or persisted state: ignored release evidence only; no product/session state.
- Platform/artifact: exact Windows x64 candidate and macOS arm64 DMG/ZIP.
- Security/privacy: no credential values, prompts, source contents, or user data in receipts.
- Existing WIP: none observed before plan creation.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Add a local operator-attestation receipt schema while retaining promotion receipt compatibility. | R2 must record real Windows evidence without fabricating a promotion run or creating a Tag/Release. | If R2 publication is later made exclusively promotion-driven. |
| Verify live candidate run metadata and exact artifact bytes before writing the receipt. | A conversational confirmation alone must not float across candidate identities. | Never; this is the provenance contract. |
| Record artifact source and release-tooling commits separately. | Release-only tooling fixes must not force same-version application rebuilds, while publishing must still run from clean current `origin/main`. | If candidate generation and R2 publication are moved into one immutable workflow run. |
| Keep manifest publication last and Alpha.30 until both target-OS upgrades pass. | Prevent clients selecting missing artifacts and preserve the bootstrap/rollback baseline. | Only after exact upgrade acceptance. |

## Checkpoints

- [x] 1. Add and test a non-promotion Windows manual-test receipt path.
- [x] 2. Generate and verify the exact local Alpha.31 preview and R2 bundles.
- [ ] 3. Run the credentialed read-only R2 plan.
- [ ] 4. Publish immutable artifacts, verify public bytes, then publish the manifest.
- [ ] 5. Complete Windows/macOS Alpha.30 to Alpha.31 upgrades and bounded cleanup.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | targeted Vitest release tests | receipt compatibility and fail-closed provenance | 4 files, 20 tests passed |
| Tests | `corepack pnpm run check` | no regression | 581 files passed; 3004 passed, 3 skipped |
| Runtime/host | not applicable to receipt implementation | N/A | pending |
| Packaged artifact | preview/R2 bundle verification | exact size/hash/candidate binding | passed for 3 Alpha.31 artifacts and operator receipt |
| Target OS/manual | user Windows receipt; later Windows/macOS in-app upgrade | exact candidate/version | Windows candidate accepted; upgrades pending |

## Rollback

Before manifest publication, delete no current object and leave the public manifest absent. After
manifest publication, withdraw the manifest first if the version is bad; preserve Alpha.30 until
both target-OS upgrades pass. Revert local source changes with a normal follow-up commit only if
authorized; do not rewrite Git history.

## Risks and unknowns

- R2 credentials are not available in the current process.
- The macOS in-app upgrade has not yet been accepted from an installed Alpha.30 copy.
- Source changes required to close the receipt gap must be committed before the release tool can
  publish from a clean exact HEAD.

## Progress log

- 2026-08-21: Recorded Windows Alpha.31 real-machine acceptance and found the promotion-only receipt
  mismatch during R2 preflight.
- 2026-08-21: Added a local operator-confirmed receipt path that still verifies the exact candidate
  identity, successful workflow metadata, source commit, installer, and packaged executable.
- 2026-08-21: Generated and verified the Alpha.31 preview and R2 bundles. The receipt binds candidate
  run `32468019358/1`, identity SHA-256 `c1525123df5fb4583a620ce7956feb4eba4012cbfd6ea46fd38f7745fbd6580b`,
  and installer SHA-256 `33299e2205f874287ccf94ee86ab0b0519e44c4c39211444bac5d9e275d78e6b`.
- 2026-08-21: Separated the immutable artifact source SHA from the clean, current `origin/main`
  release-tooling SHA so release-only fixes do not create same-version application bytes.
- 2026-08-21: Received scoped commit and push authorization for the release-only implementation.

## Closeout

- Final source SHA: pending
- Changed files: pending
- Validation completed: pending
- Validation not completed: R2 live publication and target-OS in-app upgrades
- Remaining risks: credentials and macOS installed upgrade evidence
- Commit/push/release state: no new commit, push, upload, manifest write, or remote delete
