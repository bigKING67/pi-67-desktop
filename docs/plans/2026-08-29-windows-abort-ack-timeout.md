# Windows Abort Acknowledgement Timeout

Status: active
Owner: Codex primary session
Started: 2026-08-29
Last updated: 2026-08-29

## Goal

Remove the raw `Agent request acknowledgement timed out` failure from the exact
Windows cross-version candidate lifecycle by aligning the Renderer
`operation.abort` acknowledgement budget with the Agent Host's bounded abort
watchdog and terminal-persistence path, while retaining privacy-safe failure
evidence if the target-OS gate fails again.

## Non-goals

- Do not retry unknown mutations, change Pi's agent loop, hide a failed abort, or
  raise the default acknowledgement timeout for unrelated commands.
- Do not change Cloudflare Workers, Durable Objects, R2 data, configuration, or
  account usage.
- Do not publish an R2 update, Tag, GitHub Release, or formal promotion.
- Do not weaken the Windows lifecycle gate or treat macOS/source evidence as a
  Windows pass.

## Acceptance criteria

- `operation.abort` has an explicit bounded acknowledgement budget greater than
  the Host's 10-second abort watchdog and terminal-finalization path.
- Protocol and Renderer regressions prove the command-specific timeout without
  changing unrelated request deadlines or replay semantics.
- A Windows lifecycle failure records the lane, launch index, allowlisted timed
  out command type, runtime surface, and bounded initialization observations
  without prompts, source bodies, credentials, private paths, or raw payloads.
- Targeted tests, affected-package typechecks, aggregate source gates, and the
  exact Windows cross-version candidate gate pass before any Feishu upload.
- Feishu receives only the exact versioned Windows EXE, macOS DMG, and macOS ZIP
  after the formal Candidate succeeds and destination authority is available.

## Delivery boundary

- Local implementation: authorized.
- Commit: authorized for the scoped fix after validation.
- Push: authorized only as required for the exact Windows Candidate.
- Candidate build/upload: at most one further formal Windows Candidate is
  authorized after source validation; the exact three-file Feishu upload is
  authorized only after it passes.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Corrected Candidate run `33244403866` passed baseline alpha.36 install/launch, alpha.37 upgrade, and post-upgrade launch, then failed at `verifyInstalledRealUserLifecycle` line 318 with a raw acknowledgement timeout. | GitHub Actions log and lifecycle artifact | 2026-08-29 |
| OBSERVED | Line 318 starts the independent `clean-profile` lifecycle; the failure stack reaches `runRealUserLaunch` line 252 after Session materialization and before shutdown. | live source at `37348628` | 2026-08-29 |
| OBSERVED | The controlled first launch starts and then stops a Prompt before Provider/settings verification; `abortActiveOperation()` starts `operation.abort` asynchronously and publishes the raw protocol error on rejection. | live Renderer and packaging source | 2026-08-29 |
| OBSERVED | Agent Host permits `operation.abort` to spend up to 10 seconds in its watchdog, then finalizes durable terminal state before replying; the Port currently gives the command only the generic 15-second timeout. | Host operation registry and protocol timeout source | 2026-08-29 |
| INFERENCE | A late `operation.abort` rejection can appear after the visible task has stopped and the lifecycle has continued, matching the observed final health-check failure. The failed artifact does not preserve the command suffix, so target-OS confirmation remains required. | correlated source and Candidate timing | 2026-08-29 |

## Affected boundaries

- Modules/processes: protocol timeout policy, Renderer Agent connection,
  Windows installed real-user lifecycle evidence, and the Git-backed Candidate
  source integration-test wall-time bound.
- Protocol or persisted state: timeout policy only; no envelope, schema, Pi
  JSONL, receipt, or persisted product-state format change.
- Platform/artifact: source/macOS checks locally; exact Windows x64 Candidate is
  the final platform gate.
- Security/privacy: diagnostic additions are limited to command identity,
  lifecycle phase, counts, timings, and already-sanitized runtime observations.
- Existing WIP: checkout was clean at `37348628`; preserve unrelated changes if
  any appear.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Give only `operation.abort` a 30-second ACK budget. | It preserves a bounded deadline with explicit room beyond the 10-second Host watchdog and terminal persistence, without weakening unrelated command budgets. | Unit or target-OS evidence identifies a different timed-out command or shows abort never received a response within the new bound. |
| Do not replay `operation.abort` on an open Port timeout. | The current operation identity makes repeat abort safe in many cases, but timeout replay is unnecessary for this fix and would broaden mutation semantics. | A separate idempotency design proves a retry contract is required. |
| Include only an allowlisted command suffix in Windows failure evidence. | Command identity is enough to route the failure and contains no payload or user content. | Security review shows the command name itself is sensitive or insufficient. |
| Give the Git-backed Candidate source fixture a 15-second integration-test timeout. | The full coverage run executes hundreds of suites concurrently; the fixture's isolated init and commits repeatedly took about 5.5 seconds while passing alone, so Vitest's generic 5-second unit default was not the product contract. Assertions and production source verification remain unchanged. | The fixture exceeds 15 seconds or profiling finds avoidable Git work. |

## Checkpoints

- [x] 1. Add the narrow timeout contract and deterministic protocol/Renderer tests.
- [x] 2. Add privacy-safe Windows failure context and harness regressions.
- [x] 3. Pass targeted and aggregate source validation on the exact scoped diff.
- [ ] 4. Commit/push the source fix and run the one authorized formal Windows Candidate.
- [ ] 5. If Candidate passes, bind exact three-platform artifacts and complete the authorized Feishu upload; otherwise stop with the new evidence.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | scoped diff, `git diff --check`, affected typechecks, `corepack pnpm run check` | only intended protocol/harness/test/plan files; all aggregate source gates pass | PASS |
| Tests | focused timeout/lifecycle/source suites plus aggregate coverage | 5 focused files and 36 tests pass; aggregate 614 files and 3199 tests pass with 3 skips | PASS |
| Runtime/host | `corepack pnpm run preview:mac:unsigned` | packaged smoke passes with real Agent Host roundtrip and bounded active-prompt shutdown; repository artifact opened | PASS |
| Packaged artifact | formal Windows cross-version Candidate | alpha.36 to exact alpha.37 lifecycle passes without raw timeout | pending |
| Target OS/manual | Windows Candidate artifact plus later operator testing | Candidate evidence first; manual laptop behavior remains separate | pending |

## Rollback

Revert only the scoped command timeout, tests, Windows failure-evidence changes,
and this plan. No persisted-state or remote data migration is required. If the
Windows Candidate identifies another command, retain only independently useful
diagnostic coverage and revise the hypothesis before further product changes.

## Risks and unknowns

- The failed artifact did not retain the timed-out command suffix, so
  `operation.abort` remains a source-backed inference until Windows confirms it.
- A blocked Host event loop could outlive any Renderer deadline; the bounded
  timeout must not be treated as a substitute for Host/runtime responsiveness.
- GitHub-hosted Windows does not prove Defender/EDR, OneDrive, redirected
  profiles, or the user's target laptop.
- Feishu folder authority is not currently available through
  `PI67_FEISHU_CANDIDATE_FOLDER_TOKEN`; an exact known file-token overwrite may
  be possible, but folder-level three-file verification must fail closed.

## Progress log

- 2026-08-29: Rechecked clean Git and exact upstream parity at `37348628`.
  Corrected the failure boundary from the upgrade profile to the subsequent
  clean-profile lifecycle and inspected the formal Candidate artifact/log.
- 2026-08-29: Correlated the controlled Prompt stop path with the Host abort
  watchdog, durable terminal finalization, Renderer async error publication,
  and generic Port deadline. Began the narrow timeout and diagnostic fix.
- 2026-08-29: The first aggregate coverage run exposed one direct static-source
  ordering regression, which was corrected and passed its focused test. Two
  unrelated timeout samples passed alone. The unchanged full rerun then repeated
  the Git Candidate fixture at about 5.6 seconds, so its four Git integration
  cases now share an explicit 15-second test-only bound without changing any
  assertion or production deadline.
- 2026-08-29: Removed notification titles, notification bodies, and raw exception
  causes from the new failure artifact. Diagnostics retain only fixed booleans,
  counts, phases, allowlisted command identity, and bounded initialization data.
- 2026-08-29: Final focused validation passed 36/36 tests. One aggregate attempt
  observed an unrelated capability heartbeat fixture before its file existed;
  that test passed 4/4 alone and the unchanged aggregate rerun passed 614/614
  files with 3199 passed tests and 3 skips.
- 2026-08-29: Local macOS arm64 unsigned preview rebuilt the app, DMG, and ZIP;
  packaged smoke passed the real Agent Host roundtrip and bounded active-prompt
  shutdown before opening the repository artifact. These dirty-tree artifacts
  are local validation only and must be rebuilt after the exact source commit
  before distribution.

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:
