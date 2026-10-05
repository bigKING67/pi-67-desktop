# Alpha.45 internal candidate preparation

Status: active
Owner: Codex
Started: 2026-10-05
Last updated: 2026-10-05

## Goal and acceptance

Prepare New Money 0.1.0-alpha.45 Windows x64 EXE and macOS arm64 DMG/ZIP
from one clean, pushed source SHA after the accepted CI remediation. Require
candidate source gates, full Windows candidate certification with a distinct-version
baseline, macOS packaged smoke and matching source/version/runtime byte identities.

## Delivery boundary

The user authorized both CI root-cause fixes and preparation of a new candidate
after full CI passes. Continue scoped version commit/push, candidate workflow and
local macOS preview/verification. No upload, Feishu/R2 change, Tag, GitHub Release,
signing, notarization, user-profile migration, paid inference or manual cleanup.
Use the canonical checkout. Manual target-user Windows/macOS acceptance remains
separate and cannot inherit Alpha.44 receipts.

## Starting evidence and decisions

- Canonical source `d7e26042a4717c176b278aabc163919a5b74a05a` and origin/main
  were clean and equal. Full CI `37321775755` attempt 1 passed all selected gates.
- Its complete elapsed time was 13m31 versus the passing 19m21 baseline, with
  essentially unchanged Windows runner seconds. Single-sample and host-variance
  limits are recorded in the completed Windows CI plan.
- Chat uses explicit latest-message end alignment and fractional row measurement.
  Windows verifiers observe real Electron Main PIDs and recognize the precisely
  admitted recovered-empty Workspace path. Alpha.44 files cannot certify this input.
- Bump only the root and nine application/domain package versions. Dependency pins,
  capability versions and pnpm lockfile remain unchanged.
- Upgrade baseline: retained Alpha.44 candidate source
  `4f04a830b3ac847b505582adcada53ee564719e2`, Windows run `37283874495`,
  identity build attempt 2 / successful artifact attempt 2. Recheck metadata preflight for
  the new frozen SHA, then use its complete workflow inputs.
- Existing automatic archive retention remains part of the packaging contract;
  no separate cleanup or replacement of the verified distribution pool.

## Checkpoints

- [ ] Version consistency and candidate source gates pass.
- [ ] Scoped source commit pushed; frozen SHA and preflight inputs recorded.
- [ ] macOS clean-source preview, smoke and DMG/ZIP container/identity checks pass.
- [ ] Windows full candidate certification passes; downloaded bytes verified.
- [ ] Three product files share version/source/runtime and local readiness receipt.

## First frozen source and remaining shutdown failure

- Frozen source `98e9d441c943b810cdac3ee4a5a83ea6e7b25912` was pushed clean.
  The actual retained baseline identity records attempt **2**; the preflight and
  dispatch correctly used build/artifact attempt 2, correcting the initial plan's
  assumption. Inputs are retained in `windows-dispatch-inputs.json`.
- Local `check:candidate` passed: 6,413 tests / 24 skips and all required gates.
  Full source CI `37324145559` attempt 1 also passed every selected lane.
- macOS preview, full smoke, container verification and independent hashes passed;
  the repository preview opened. Identity, smoke, byte-verification receipt and log
  are retained under `artifacts/validation/alpha45-candidate/`. These bind source
  `98e9d441`, not subsequent verifier or product changes.
- Windows candidate `37324283727` attempt 1 **failed** at its 125% UI shutdown;
  installer certification did not run. The observed real Main exit was 6,826 ms,
  driver 6,825.6 ms, versus the unchanged 5,000 ms budget. Application cleanup was
  142.9 ms, Renderer checkpoint succeeded, Host graceful=true/forced=false, child
  exit 50 ms and final utility exit 4,267.2 ms. No tracked process remained alive.
  Source CI success does not make this candidate ready or prove shutdown stability.
- Existing evidence cannot distinguish post-controller Electron lifecycle delay
  from late verifier-loop sampling. Add passive, bounded Main event timings and
  PID sampling-gap metadata to the UI verifier; preserve every deadline, assertion,
  event behavior and product input. This is diagnosis, not a claimed root-cause fix.
  No blind identical-source retry or distribution. Read the next Windows evidence
  before deciding on a product or harness correction.
- The next instrumented Windows candidate experiment explicitly selects three
  UI rounds (nine maximum scale scenarios), stopping at the first failure. This
  bounded diagnostic choice is not an automatic retry; ordinary CI and default
  candidates retain one round. It uses only isolated synthetic profiles and zero
  real model requests. Preserve the failed original candidate and compare Main
  events against polling gaps before interpreting the result.

## Instrumented CI and process-query output correction

- Instrumented source `19dd431f225e05424b94143b43e0eef40ac09f5e`, CI
  `37326893335` attempt 1 failed before the first Windows recovery launch.
  All three UI scales passed (450.8 / 357.1 / 313.6 ms product exit); Main
  lifecycle events completed in 304.3 / 190.4 / 202.5 ms and maximum sampling
  gaps were 53.1 / 54.2 / 59.1 ms. These successful samples do not explain or
  supersede the original candidate's 6,826 ms failure.
- The failed 15-second process-query preflight entered PowerShell at 12,231 ms,
  imported modules by 13,266 ms and completed CIM at 13,610 ms; output completion
  was never observed. No Electron process was launched. Other recovery cases,
  full Windows installer, source/Renderer/macOS gates passed. Receipts are retained
  in `artifacts/validation/alpha45-candidate/ci-19dd-*`.
- Remove the query's unnecessary JSON serializer initialization: emit four
  exact fields through Console, with the only arbitrary string encoded as UTF-8
  base64, then strictly parse back into the unchanged in-memory identity. Preserve
  the CIM query, ownership checks, 15-second total deadline, fail-closed cleanup
  and no-retry policy. This removes observed post-query cold work; it does not
  claim to fix the earlier 12-second engine startup or all host variability.
- Validate encoding rejection and real Windows owned-child lifecycle before
  interpreting the next candidate's three-round shutdown evidence. No product
  source, dependency or process-termination policy changes.
- The first correction `944c5dff`, CI `37329540507`, failed its early real Windows
  owned-child test: CimCmdlets' manifest requires Utility's `Set-Alias` while
  autoload is disabled. Restore that explicit prerequisite import and remove only
  `ConvertTo-Json` execution. The premature diagnostic candidate `37329639681`
  was cancelled before accepting any artifacts; it cannot certify this source.
  Preserve the failure and validate the corrected dependency order on Windows.

## Validation and rollback

Run `corepack pnpm run check:candidate`, frozen-source Windows preflight and the
existing Windows candidate workflow. On macOS run `preview:mac:unsigned`, which
quits only the repository preview, rebuilds, smokes, validates containers, writes
identity and opens the new repository application. Retain exact logs and receipts
under ignored `artifacts/validation/alpha45-candidate/` and candidate artifacts.

A failed platform is not ready for distribution. Correct source in a new scoped
commit and rebuild affected candidate evidence; never rewrite history or call old
bytes verified by a new test. Preserve previous candidate evidence and rollback
artifacts according to the existing retention contract. Hosted synthetic profile
tests do not prove real credentials, IME, SmartScreen or enterprise storage.
