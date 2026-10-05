# Alpha.44 internal candidate preparation

Status: local candidate preparation complete; ordinary CI follow-up open
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

- Starting canonical main and origin/main were clean at
  `030e73f111dce9b8106ab63d597552ea5190fa92`.
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
- [x] Scoped version commit pushed; exact source and dispatch inputs recorded.
- [x] macOS clean-source preview, smoke and DMG/ZIP container/identity checks pass.
- [x] Windows full candidate certification passes; downloaded bytes verified.
- [x] Three product files share version/source/runtime; final local receipt ready.

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

Frozen candidate source: `4f04a830b3ac847b505582adcada53ee564719e2`, pushed to
main. All ten application versions are Alpha.44; other manifest values and the
lockfile are unchanged. Frozen Windows inputs are in
`artifacts/validation/alpha44-candidate/windows-dispatch-inputs.json`.

macOS clean-source packaging, full packaged smoke, DMG/ZIP container checks and
independent byte verification passed. Pi runtime is
`@earendil-works/pi-coding-agent@1.0.0`; ASAR SHA-256 is
`64cfab1085f0cd1678b31446d32b3181f718ee054e1d0cdce560c8500927e7c0`.

Windows first attempts failed and remain retained. CI `37283805081` failed
graceful shutdown, all three CIM preflights and reinstall process inspection.
Candidate `37283874495` passed smoke and two recovery cases, then lost the Main
diagnostic execution context before the third task began. Both used identical
ASAR bytes. These observations support an environment/driver instability
hypothesis, but do not establish its precise root cause. One bounded failed-job
revalidation per workflow uses unchanged source, deadlines and assertions.
Candidate attempt 2 passed all three recovery scenarios on identical ASAR bytes,
including canonical Session isolation and owned-process cleanup. Its complete
workflow passed, including synthetic scale/IME, exact Alpha.42 baseline bytes,
cross-version upgrade, three restarts in each configuration lane, uninstall and
isolated user-data preservation. Downloaded installer and executable hashes match
candidate identity `60be078c6602ad29e4d4daf8b376130ecfd473cbf06437895efb00a85af75194`.

Ordinary CI attempt 2 remains **failed**: only `agent-before-response` failed,
at its 15-second CIM process-query preflight, before launching Electron. Ordinary
smoke, the other two recovery cases, Windows UI and full same-version installer
lifecycle passed; source, Renderer and macOS jobs retain their successful first
attempt results. No third retry was started. This is a recurring validation
reliability issue requiring a focused follow-up; do not claim all CI is green or
that the original failure has been fixed. Distribution is not recommended until
that follow-up is resolved, despite the separately verified candidate files.

The three final product files, exact local paths, byte lengths and SHA-256 values
are recorded in `artifacts/validation/alpha44-candidate/products.json` and
`SHA256SUMS`; `readiness.md` distinguishes candidate passes from the open CI issue.

Evidence and the first-attempt diagnosis remain under
`artifacts/validation/alpha44-candidate/`. No paid model requests or distribution
actions were performed. A later documentation-only closeout retains the frozen
candidate source above.
