# CI reliability and measured performance

Status: active
Owner: Codex
Started: 2026-10-04
Last updated: 2026-10-05

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
- [x] Commit/push scoped changes; verify exact-SHA CI and compare timings.

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


## Fourth exact-SHA CI and installer verifier race

- `b35de8088dbd46188b3102701cac344865886269`, run `37209280529` attempt 1:
  source passed 946 files / 6,265 tests, including all 19 native MCP regressions.
  Renderer, macOS native and every Windows prerequisite passed. All six recovery
  receipts report clean exact source, cleanup/isolation success and zero real model requests.
- Windows full NSIS passed initial install, first launch, reinstall and three clean-Profile
  launches, then failed Provider configuration on clean-Profile launch 3. Runtime was ready
  with no Provider error notification; the old generic lifecycle error did not preserve the
  failing assertion. This is not proof that the selected-tab race was the sole cause.
- The verifier clicked the configured tab and immediately read aria-selected, before React
  necessarily committed the state. It now clicks once and waits for selected=true using the
  same shared 10-second budget. Seeded Provider, credential target/persistence and return to
  workbench checks remain. Add fixed substep/allowlisted failure codes, with no raw errors.
- Regressions cover delayed state, stuck state and time already consumed before selection.
  Extend the exact verifier-only allowlist by these two extracted files and run their tests
  in the reuse workflow. All immutable-attempt, exact artifact/source and successful Windows
  prerequisite requirements remain. Exact-diff classification found that editing the reusable
  workflow itself selects full CI, although explicit debug dispatch could reuse the source
  artifact. Preserve that conservative policy and run one full CI for this combined change;
  do not claim automatic reuse or run a second redundant installer workflow.
- Local validation: 6 files / 81 tests passed; after simplifying the new diagnostic callback,
  the affected 2 files / 28 tests passed again. Type-aware lint, structure, workflow Action
  pins, PowerShell discovery and diff whitespace checks passed. Independent readonly review
  found no blocker and independently confirmed the full-CI routing requirement.


## Completed acceptance and timing limits

- Code/verifier commit `1018f9d3dd1b7f0c2e4db45474ad0b9c0df44412`,
  [CI run 37211024413](https://github.com/bigKING67/pi-67-desktop/actions/runs/37211024413),
  attempt 1: aggregate CI Gate **PASS**, source **PASS** (946 files / 6,268 tests,
  24 optional tests skipped), Renderer **PASS** (294 passed / 1 skipped), macOS
  native **PASS** (284 s), Windows native **PASS** (942 s). No rerun of this SHA.
- All six packaged recovery receipts bind to the clean source above, with process
  cleanup and canonical isolation passed and zero real model requests. The installer
  report is `full`, status `passed`, last stage `uninstall:completed`; both synthetic
  Profile lanes completed four launches, Provider checks and shutdowns. User data
  was preserved after uninstall. All eight Provider checks completed in 1.33–1.59 s.
- Windows installer identity: `New-Money-0.1.0-alpha.43-win-x64.exe`,
  883,771,805 bytes, SHA-256
  `90bcdd4d35e63c8b7d03020141f40885dc5627439576e109f753345b5b7832b9`.
  Windows ASAR SHA-256
  `d7bae6a06fab2faaf09c342b597e42191282b6c1851034ca7b0292597dfe0f79`.
- Timings: Windows packaging 60 s versus baseline 141 s; macOS packaging
  48 s versus baseline 132 s. Provider configuration regression 5.58 s versus
  the previous failed 81.39 s sample. Full NSIS 288 s versus baseline 244 s;
  complete Windows job 942 s versus baseline 870 s. **Packaging/test overhead
  improved; total Windows duration is not proven improved.** Install/reinstall
  took 86.3/81.7 s, with hosted runner variability and actual installer I/O retained.
- Evidence directory: `artifacts/validation/pi-durable-compat/ci-37211024413/`;
  sibling job logs and `ci-37211024413-jobs.json` retain source, native, timing and
  gate evidence. These are ignored validation artifacts, not distributed releases.
- The prior blank DOMContentLoaded failure and historical Main Host Operation
  shutdown stall did not recur here; their root causes remain unproven. One green
  run is not a zero-flakiness guarantee. Windows evidence is hosted Windows Server
  2025 x64 with isolated synthetic profiles, not manual target-user acceptance,
  SmartScreen, a distinct-version upgrade or uncontrolled real profiles.
- Scope closed with independent reviews and no open blocking finding. Preserve
  concurrent native-image WIP; no publish, release, paid model calls, global
  configuration changes or local preview replacement were performed in this task.


## Followup: Windows total duration

- User continued the CI performance task after full acceptance. Live main/origin are
  `defaf367`; the same unrelated native-image WIP remains protected. Existing delivery
  authorization and rollback limits remain.
- Latest Windows critical path: 179 s ordinary smoke, 133 s three recoveries, 288 s
  NSIS; packaging 60 s. The native-MCP-to-workbench segment is 106.97 s on Windows
  versus 7.42 s on macOS. Existing logs do not separate its settings/update/journey steps.
- A readonly explorer independently confirmed that timing gap, no proven single slow
  operation, and a Windows-only hidden-window/actionability hypothesis. Existing
  `setBackgroundThrottling(false)` prevents simply assuming ordinary background timers.
  Historical Electron issues are supporting context, not proof against this version.
- First measure fixed stage timings and one Windows hidden/visible/hidden full-smoke
  experiment against the same package, with isolated profiles and all assertions retained.
  The visible path already exists for screenshot evidence; it ignores mouse input,
  skips the taskbar and blurs. Explicit fixture-only opt-in leaves local defaults intact.
- Do not parallelize NSIS with another Electron app on the same Windows desktop;
  installer process/lifecycle effects require isolation. Splitting runners also incurs
  transfer/setup costs for large packages, so defer until the simple hypothesis is tested.
- [x] Verify measurement regressions and independently review the experiment.
- [x] Collect exact-SHA controlled Windows evidence; accept or reject the hypothesis.
- [ ] Keep only an evidence-backed improvement, remove paired CI overhead, validate
  the final exact-SHA full CI and report total as well as individual step times.

- Focused validation: 3 files / 28 tests, type-aware lint, structure, Action pins and
  PowerShell discovery passed. Independent review identified shared failure paths;
  the visible run now has its own directory and the reviewer confirmed closure.
  Keep a final hidden confirmation with a third independent evidence directory,
  so warm filesystem caches cannot alone explain a visible-mode improvement.
  This is a bounded three-run mechanism experiment, not automatic retries.

- Experiment `0083cb2c`, run `37213032680` / attempt 1: hidden 182 s failed,
  visible 33 s passed, warmed hidden 180 s failed. Provider interaction was
  20.001 / 1.294 / 20.002 s; workbench journey 15.990 / 1.223 / 15.985 s.
  Window isolation mode has a reproducible effect; filesystem warmup alone cannot
  explain it. The exact Chromium/Windows scheduling mechanism remains unproven.
- Both hidden runs lacked the required Pi `session_shutdown(reason=quit)` record.
  Main reported forced Host termination; the last Host boundary was terminal
  receipt persistence. This is a real graceful-shutdown failure, not merely a
  driver timeout. Other Windows recovery, UI and full NSIS gates passed; full CI
  correctly failed. Source gate: 946 files / 6,269 tests passed, 24 optional skips.
- Independent review accepted visible UI testing but flagged deletion of the known
  hidden shutdown failure as a P1 coverage loss. Keep the failure and original
  budgets gated while adding bounded, opt-in receipt filesystem phase diagnostics.
  No retry, weaker lifecycle assertion or durability relaxation is permitted.
- Receipt tracing `f522f595`, run `37215010644` / attempt 1: both hidden runs and
  the visible run passed, as did source (946 files / 6,280 tests, 24 optional skips),
  Renderer and macOS native checks. This change only adds observations; the earlier
  intermittent hidden shutdown failure remains OPEN/PARTIAL, not repaired by a
  passing sample. Final Windows lifecycle completion and timings still need readback.
- Converge conservatively: remove the two temporary repeated full-smoke steps but
  retain the original full hidden smoke as a required gate. Limit visible-isolated
  windows to the three Windows task-recovery steps, retaining each exact crash,
  Session, replay and cleanup assertion. Recovery receipts record the window mode.
  This can reduce independent UI overhead without replacing the hidden failure path.
- Strengthen the existing smoke shutdown gate to require Main's explicit successful
  Renderer checkpoint and graceful/non-forced Host result, in addition to the Pi
  callback and product PID budget. A callback followed by failed cleanup cannot pass.
- Local convergence validation: 3 files / 33 tests, type-aware lint, structure,
  Action pins and PowerShell discovery passed. Independent review found no blocker
  and confirmed retention of the known hidden failure path. Full Windows
  receipt/timing validation remains pending.

## Followup: forced shutdown must preserve recovery

- While checking the observed forced-exit path, found a deterministic correctness
  defect: Main treated any resolved Host stop as clean and called `finishWorkbenchRun`,
  which clears `runtimeRecovery`. This proves recovery metadata loss is possible;
  it does not prove loss of Pi JSONL or Tool results in the earlier CI samples.
- Regression first failed for forced, non-graceful/non-forced and missing outcomes
  against the real Workbench state store (`forced-shutdown-recovery-before.log`).
  Independent review confirmed the production call chain and minimal fix scope.
- Require explicit graceful/non-forced completion before marking clean, preserving
  transient cleanup and all shutdown budgets. Test real persisted state/reload for
  successful, forced, unconfirmed, inconsistent and missing outcomes, plus a late
  successful result after the watchdog. Keep the intermittent receipt stall separately open.
- This source fix requires another exact-SHA full gate after the in-flight performance
  convergence run; do not cancel that run or call the forced-exit fix platform-verified yet.
- Local validation: 3 files / 32 tests passed after the demonstrated failures, plus
  Desktop typecheck, type-aware lint, structure and whitespace checks. Independent
  review found no blocker and confirmed unchanged deadlines/cleanup ordering.
- Exact-SHA `555c953d7641eaee513a26c0d23d80130af7e85d`, run `37217255461` /
  attempt 1 passed all gates: source 947 files / 6,288 tests (24 optional skips),
  Renderer, macOS native 281 s and Windows native 898 s. All six recovery receipts
  passed with clean source, unchanged canonical Profile, cleanup and zero real model
  requests. Windows hidden smoke took 183 s; the full dual-Profile NSIS lifecycle
  passed in 249 s. This validates the recovery metadata fix, not the intermittent stall.

## Followup: hidden widget painting order

- Convergence `717f8c7a`, run `37216175815` / attempt 1 passed all gates. Windows
  recovery total changed from 91 s in the latest hidden sample to 86 s, but total
  Windows duration was 970 s versus the earlier ordinary 942 s. This is not proof
  of a substantial or persistent performance improvement. Hidden UI stages still
  showed the same 2-second-per-action pattern.
- Exact Electron 43.7.3 source `WebContents::SetBackgroundThrottling` restores
  `kHiddenButPainting` through the view when the widget is already hidden. The
  fixture previously disabled throttling before native hide, skipping that branch
  for a visible widget. Hypothesis: let hide mark the widget hidden, then disable
  throttling. Repeat on future show events; retain native hiding and input isolation.
- This changes only the test fixture, with one original full hidden smoke still
  gated. No visible-window substitution, assertions, timeouts or product scheduling
  changes. Require real Windows timings before calling the hypothesis successful;
  it is not a fix claim for the intermittent Host receipt stall.
- Local validation: 3 files / 33 tests, type-aware lint, structure and whitespace
  checks passed. Independent review found no blocking issue, no native Show call
  or recursive show path in the pinned Electron implementation. Native timing and
  complete platform validation remain pending for this fixture change.
- Experiment `053b0b774645321aa3f207d8e39c9b4be6aec672`, run `37218617596` /
  attempt 1 did not support the performance hypothesis: Windows hidden smoke still
  took 182 s and failed. Revert the fixture, its experimental assertions and CI
  contract text to their previously validated `555c953d` contents. Preserve this
  negative result; await the failure trace before attributing the runtime failure.
  Source (947 files / 6,288 tests, 24 optional skips), Renderer and macOS native
  passed, as did all six recovery receipts with source identity, Profile isolation,
  cleanup and zero real model requests. Full dual-Profile Windows installer lifecycle
  also passed. The overall run correctly failed its strict graceful-shutdown gate.

## Followup: quiesce disposable prompt refreshes before shutdown

- The new trace narrows the failure: `operation-prompt-catalog` completed in 933 ms;
  the receipt completed in 953 ms (lock acquisition 758 ms, file sync 186 ms).
  `host-operations` completed at 1,893 ms, then `runtime-session` started but did
  not finish before forced Host termination (Main 2,501 ms; Host 2,331 ms).
  This sample does not show a stuck receipt or establish the cause of lock delay.
- The prompt finally path unconditionally started disposable Session Catalog and
  configuration refreshes during quit, before necessary Session disposal. Add an
  explicit synchronous Runtime `beginShutdown()` hook before Host operation abort;
  direct disposal sets the same state. Suppress new post-prompt catalog/config/title
  work only in this state, including interrupted-task continuation and commands.
  Recheck after each await; never detach already-started work. Ordinary user abort
  keeps its refreshes. The optional port hook preserves the old full cleanup path
  for lightweight runtime test doubles; the production Pi SDK Runtime implements it.
- Preserve the order of Operation cancellation, terminal receipt durability, Pi
  Session disposal and writer-lease release, with unchanged Main/product budgets.
  Do not change receipt locks, retry policy or fsync based on the 758 ms observation.
- Independent direction review supports removing observed discretionary work but
  requires race regressions and a new real Windows graceful result. It does not
  establish that every possible Session shutdown stall is fixed.
- Local validation: 7 focused files / 24 tests passed, including active Pi command
  child cleanup and valid JSONL recovery. Pi Runtime/Host typechecks and structure
  passed; complete `check:source` passed (950 files / 6,314 tests, 24 optional skips,
  branches 78.78%). Local counts include the protected native-image WIP; exact-SHA
  CI remains the authority for the scoped commit. Independent final diff review
  found no blocker and verified the failed fixture experiment was fully reverted.
