# CI reliability and measured performance

Status: active
Owner: Codex
Started: 2026-10-04
Last updated: 2026-10-04

## Goal and acceptance

Fix the two observed source-test failures and reduce measured CI overhead without
weakening product deadlines, coverage, native recovery or installer lifecycle checks.
Acceptance requires mechanism regressions, the complete source gate, independent
diff review, and exact-SHA Windows/macOS CI results for workflow changes. Report
runner variance and residual product failures separately from test-harness fixes.

## Delivery boundary and non-goals

Local fixes, scoped commit/push to main and GitHub CI are within the existing
authorization. No release, distribution, paid model requests, user Profile changes,
new worktree, dependency upgrade or official experimental Pi Durable integration.
Do not increase retries or product timeout budgets to obtain a passing result.

## Current evidence

- Clean baseline: `d1953b90133dc8e228e04beb74782534e0a6873c`.
- Implementation `11619f5267e7e6909f4c78aa3a785249d06c4e07` passed run
  `37198926766`; run `37199938580` failed two source tests while both native lanes
  and full Windows installer certification passed. Documentation-only CI does not
  repair those failures.
- Native Windows is the critical path: 965 s / 870 s. Source: 445 s / 520 s;
  renderer: 491 s / 521 s; native macOS: 322 s / 382 s. Frozen installs: 18–27 s.
  Raw job/test evidence is ignored under `artifacts/validation/pi-durable-compat/`.
- Provider Host routing test took 81.39 s and hit configuration-file-access 4 s.
  Its 20 ms polling repeatedly schema-parsed historical full model catalogs.
  Replacing polling with message arrival and request-ID-first validation reduced
  the same local coverage test from 20.27 s to 2.52 s (ordinary run 0.736 s).
  Product file-access deadlines are unchanged; target-runner confirmation pending.
- Codemode 150 ms timeout starts before Worker/WASM initialization in the installed
  Pi Codemode 1.0.0 host. A first output is not guaranteed before that deadline.
- macOS CI builds DMG/ZIP (120–132 s) despite consuming the unpacked app. Windows
  packaging, smoke, recovery and installer certification all run sequentially.
- Installed electron-builder 26.15.3's `configureDifferentialAwareArchiveOptions`
  forces normal compression even when the unsigned smoke command selects store.
  Fast Windows packaging now disables differential packaging; fast macOS uses
  `--dir`. Defaults for preview/candidate remain unchanged. CI timing pending.

## Boundaries and decisions

CI/test/packaging tooling plus the directly evidenced native MCP shutdown fix below.
No protocol or persistent-state migration planned. Preserve frozen dependencies,
fixed source worker bounds, all source coverage and final fail-closed CI gate.
The pnpm store remains uncached: installation is not the measured bottleneck and
the current contract records slower cache restore/save.

## Checkpoints

- [x] Measure same-SHA job/step timing and read failed source reports.
- [x] Reproduce failure mechanisms and implement targeted regression fixes.
- [x] Implement evidence-backed CI overhead reduction and update CI contracts.
- [x] Pass focused gates and complete source check; independent diff review.
- [ ] Commit/push scoped changes; verify exact-SHA CI and compare timings.

## Rollback and risks

Revert only this task's scoped commit if validation reveals regression; preserve
all prior recovery diagnostics and user work. No history rewrite or artifact
promotion. A single green run cannot establish zero flakiness. The earlier Windows
Host Operation shutdown stall remains unresolved until directly reproduced; do
not conflate its absence with a fix. Keep first-failure evidence and no blind reruns.

## Validation checkpoint

- Focused regressions: 5 files / 24 tests passed; log
  `artifacts/validation/pi-durable-compat/ci-reliability-focused-v3.log`.
- Full `check:source` passed with the existing two-worker limit, including all
  coverage floors (global branches 78.74%). A new helper's
  inferred declaration return type was made explicit after the build surfaced a
  non-portable type diagnostic; the affected runtime build then passed cleanly.
- Independent readonly review found no blocking issue. Its followup confirmed
  the final helper sends an unawaited synthetic child call then spins, covering
  running-Worker termination as well as output retention. Final two integration
  files / 12 tests passed after that strengthening.
- Coverage probes intentionally ran only the routing file, so their repository
  coverage-floor failures are expected diagnostic output, not source-gate passes.

## First exact-SHA CI and followup

- `a087cb582e097c433d6123cb3f802c7eea8daa0b`, run `37204444462` attempt 1:
  source 945 files / 6,250 tests passed; Renderer and macOS native passed.
  Host configuration test 4.94 s (previous failed run 81.39 s). macOS packaging
  53 s (previous 132 s); Windows packaging 62 s (previous 141 s).
- Windows ordinary packaged smoke and agent-before-response passed. App-after-tool
  failed during cold reopen: the recovery button detached during its 2 s click
  budget while the screenshot still showed `starting`. The later finally-captured
  protocol includes native `runtime.ready`, initialization ACK and recovery inspect.
  Both process cleanup and canonical Session isolation passed. Installer and later
  scenarios were skipped; the failed run is not overall acceptance or total-time proof.
- The action helper previously tolerated a click timeout only after complete
  readiness. The followup also defers an explicitly observed starting/recovering
  state to the caller's unchanged 45 s readiness gate, without another click.
  Missing/stuck readiness and other driver failures still fail. A comparison against
  the committed helper reproduces the premature rejection; 15 focused tests pass.
- Followup independent review found no blocking issue. No product behavior,
  timeout budget, retry count or release packaging defaults changed.

## Second exact-SHA CI and bootstrap evidence gap

- `0d512f84afb92fec500b785e542ce1312d44d0e7`, run `37205539394` attempt 1:
  source, Renderer and macOS native passed. Windows ordinary smoke, agent-before-response
  and the previously failing app-after-tool all passed.
- Windows agent-unconfirmed-tool failed before any model/Agent operation, at the
  unchanged 30 s DOMContentLoaded deadline. Main and driver were alive; no body,
  screenshot or protocol was available. Same ASAR SHA-256 as the prior run;
  cleanup and canonical isolation passed. This does not yet distinguish actual
  native loading failure from driver attachment. Installer was skipped again.
- Followup adds bounded Main bootstrap evidence before window isolation, without
  changing acceptance deadlines, plus shorter failure-only screenshot/body reads.
  This is diagnostic instrumentation, not a claimed fix for the blank window.
- Ordinary CI now continues independent isolated packaged checks after earlier
  failures when packaging succeeded and the run was not cancelled. Every failure
  still fails the job and aggregate gate; no retry or candidate qualification is added.
- Independent review identified an existing unbounded Renderer protocol read in
  failure cleanup. It now has a 2 s diagnostic-only deadline and a hung-renderer
  regression preserving the original error and subsequent cleanup.
- Focused validation and exact-SHA full Windows lifecycle evidence are required
  before closeout; no acceptance claim for the blank-window root cause.
- Followup local validation: 4 files / 35 tests, type-aware lint, structure,
  workflow Action pins and PowerShell discovery passed. Independent review
  confirmed the diagnostic-blocking finding is closed, with no new finding.

## Third exact-SHA CI and native MCP correction

- `bd7d6ae01c175d54b79de08173399a5195cd5543`, full dispatch `37207160931`
  attempt 1: Renderer (505 s), macOS native (288 s) and Windows native (957 s)
  passed, including all six recovery receipts and full NSIS lifecycle. Source
  failed one assertion: an initializing MCP server's descendant PID remained
  alive immediately after public session shutdown; its parent was already gone.
- The installed Pi MCP transport waits for direct child close, sends group TERM,
  cancels the later KILL timer and immediately resolves. A bounded standalone
  synthetic probe with an IPC-ready delayed TERM handler reproduced real execution
  after return: parent gone at 502 ms, descendant alive for a further 101 ms.
  This violates the existing Product process-tree contract; do not weaken the test.
- Add an exact-version native `pi-mcp@1.0.0` pnpm patch for POSIX group completion,
  preserving 500 ms stdin grace and 2,000 ms TERM-to-KILL timing, then at most
  500 ms to observe OS reaping. Keep owned-group tracking after direct exit,
  complete concurrent close callers together, and clean descendants on unsolicited
  server exit. Windows taskkill behavior remains unchanged; no Desktop transport.
- Real SDK regressions retain immediate parent/descendant checks and add IPC-ready
  delayed/ignored TERM descendants. Initial 17 tests passed; final source/independent
  review and exact-SHA native evidence remain required after the completed patch.
- Packaging alone is faster, but total Windows time is not yet improved: this run
  built in 83 s and full NSIS took 317 s, versus 141 s / 244 s in the baseline.
  Report the tradeoff and runner variance, not a total-time improvement claim.
- Concurrent native-image WIP is present in the canonical checkout. Preserve it;
  stage only this task's paths and exact MCP documentation hunks. Remote CI must
  verify the scoped committed source, not infer its identity from a mixed local check.
- Independent review found natural-exit cleanup could be detached by early close
  notification, and connection-close errors were swallowed. Both are corrected:
  start cleanup at direct `exit` even with inherited stdio, notify closure only
  after group completion, and await all close attempts before publishing an
  aggregate error through the public Extension error channel. Final review found
  no new blocker and independently confirmed error propagation.
- Final focused MCP integration: 19 tests passed. Added real SDK inherited-stdio
  and injected owned-group EPERM cases, retaining immediate exit assertions;
  negative-case forced cleanup occurs only after observing the public failure.
  Type-aware lint passed. Full local coverage: 948 files / 6,280 tests passed,
  branches 78.78%, including concurrent native-image WIP. Local aggregate source
  check stopped on that WIP's 463-line runtime binding file (460 limit), not on
  the MCP change; it is not an aggregate source PASS for this scoped commit.
