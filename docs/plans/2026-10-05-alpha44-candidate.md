# Alpha.44 internal candidate preparation

Status: active
Owner: Codex
Started: 2026-10-05
Last updated: 2026-10-05

## Goal and acceptance

Prepare New Money 0.1.0-alpha.44 Windows x64 EXE and macOS arm64 DMG/ZIP
from one clean, pushed source SHA, with candidate source gates, Windows full
installer lifecycle, macOS packaged smoke, and verified byte identities.

## Delivery boundary

The user authorized the version update, scoped commits/push, Windows candidate
workflow dispatch, local macOS packaging, and local candidate verification.
No Feishu upload, R2 change, Tag, GitHub Release, signing, notarization, remote
cleanup, user-profile migration or paid inference is included. Manual testing
on clean and existing-Pi Windows desktops remains a later acceptance step.

## Current evidence

- Clean canonical main and origin/main at `030e73f111dce9b8106ab63d597552ea5190fa92`.
- Its full CI `37279476520` passed; Windows installer mode was quick.
- Alpha.43 already has an earlier candidate at source `05529cd3`; use a new
  version to avoid assigning one filename to different candidate bytes.
- Retained verified upgrade baseline: Alpha.42, source
  `a7e0822de99ec1f0bd9323afdd246ee7bcc34a10`, Windows run `36733158152`,
  build/artifact attempt 1. Read-only preflight passed for the current source;
  repeat it for the frozen Alpha.44 source before dispatch.
- Capability source reachability/freshness passed immediately before this task.
  Candidate gates will validate them again for the actual source.

## Decisions and affected boundaries

- Bump the root and nine application/domain package manifests together; preserve
  first-party capability versions and all dependency pins. No runtime/UI change.
- Use the canonical checkout. No temporary worktree and no unrelated WIP.
- Existing Windows candidate workflow must pass provenance, packaged smoke,
  task recovery, synthetic UI checks and full dual-profile NSIS lifecycle.
- Use the retained verified Alpha.42 as the distinct-version upgrade baseline.
- Keep the three product files separate from identities, logs and test evidence.
  A later documentation-only closeout does not change their frozen source SHA.

## Checkpoints

- [x] Version consistency and candidate source gates pass.
- [ ] Scoped version commit pushed; exact source and dispatch inputs recorded.
- [ ] macOS clean-source preview, smoke and DMG/ZIP container/identity checks pass.
- [ ] Windows full candidate certification passes; downloaded bytes verified.
- [ ] Three product files share version/source/runtime; final local receipt ready.

## Validation and evidence

- `corepack pnpm run check:candidate` is required before candidate delivery.
- Local candidate gate passed on the version-only change: 955 test files and
  6,378 tests passed; 9 files / 24 tests skipped by their existing environment
  gates. Dependency, capability freshness, adapter, type and source checks passed.
  Log: `artifacts/validation/alpha44-candidate/check-candidate.log`.
- `release:windows:preflight` checks the frozen pushed SHA and exact baseline.
- `preview:mac:unsigned` rebuilds, smokes and opens the local application.
- Retain Windows workflow run/attempt, candidate identity, full lifecycle and
  macOS candidate/smoke identities under ignored artifacts.
- Final product names: `New-Money-0.1.0-alpha.44-win-x64.exe`,
  `New-Money-0.1.0-alpha.44-mac-arm64.dmg`,
  `New-Money-0.1.0-alpha.44-mac-arm64.zip`.

## Rollback and limits

Keep the verified Alpha.42 inputs, previous artifacts and failure receipts under
the existing retention policy. A failed build is not eligible for distribution.
Source correction uses a new scoped commit; no history rewrite. Do not replace
the verified distribution pool or mutate user profiles. Hosted full lifecycle
does not certify real user desktops, real IME, SmartScreen or enterprise storage.

## Closeout

Pending exact-source candidate results. Machine-readable receipts will remain
ignored; update this plan with the frozen source and verified final outcome.
