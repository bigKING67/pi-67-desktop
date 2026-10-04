# Recover interrupted tasks on native Pi

Status: active; Windows recovery-click race correction and exact-SHA CI acceptance pending
Owner: Codex
Started: 2026-10-04

## Goal and scope

The user selected recovery of the current task after application/Agent crashes.
Keep coding-agent as the only runtime and Pi JSONL as conversation truth. After
reopening the same Session, offer an explicit continuation for an unfinished
recorded turn. Reuse existing results and the previous Auto physical selection.
No automatic background inference, Pi Durable dependency, Session migration,
second loop or hosted worker. The user subsequently authorized scoped commits,
push to main and Windows/macOS CI acceptance; distribution and release remain outside scope.

## Current evidence

- Existing Host replay protection restores unconfirmed operations as lost and
  prevents duplicate invocation. Four targeted files / 16 tests passed today.
- Existing `恢复任务` reacquires the Session; it does not resume its inference.
- Pi 1.0 exposes supported `AgentSession.sendCustomMessage({ ... },
  { triggerTurn: true })`; prove native continuation and Auto restoration before
  wiring a product command. Do not call private SDK methods or agent internals.
- Auto implementation is existing dirty WIP at base 05529cd3. Preserve it and its
  frozen live receipts. Auto's user-assisted packaged settings readback passed.

## Acceptance and safety boundaries

- Reopen uses the existing exact physical Session identity and writer lease.
- Derive unfinished work from the current Pi branch; no second recovery journal
  or raw prompt copy. A completed answer does not offer continuation.
- Missing Tool Results are unknown outcomes. Show a bounded review-required
  state and deny one-click continuation; never invent results or replay tools.
- Explicit continuation uses a fresh durable operation submission identity and
  an exact current branch anchor. Duplicate/stale actions cannot dispatch again.
- Existing trust, current team authorization, PLAN, Tool approval and cancellation
  continue to apply. Continuation grants no new capability.
- Native Auto continuation uses persisted selection without reclassification or
  model fallback. Missing/drifted state fails before provider dispatch.
- Verify cold reopen, interrupted model output, completed tools, unresolved tools,
  completed turns, branch changes, duplicates, authorization and cancellation.
- Source/mock, real native SDK, packaged crash and Windows are separate evidence.
  No new live-model budget is authorized. Do not operate on user sessions in tests.

## Checkpoints

- [x] Inspect existing recovery contract and identify missing continuation.
- [x] Prove bounded native continuation with synthetic models and JSONL reopen.
- [x] Implement branch assessment, exact-anchor command and bounded UI states.
- [x] Complete relevant protocol/runtime/Host/renderer regression checks.
- [x] Complete local preview/packaged evidence and report remaining platform gaps.

## Rollback and delivery

Only new scoped source behavior is reversible. No existing session file or
default model is rewritten. Any explicit recovery request will be native Pi
custom context in that same Session, not a claimed historical Tool Result.
Retain prior source WIP and evidence; never use broad reset. Local implementation
and normal validation are authorized. Paid inference and external distribution
are outside this scope. A destructive packaged crash probe must have a bounded
isolated target and lifecycle/cleanup contract before it is run.

## UI authority

Frontend route L1-F, main serial, design-craft. PRODUCT/DESIGN and the existing
conversation failure patterns are authoritative. Preserve the current theme
tokens and component library. Native desktop readback uses Computer Use;
browser runtime acceptance uses browser67 when needed.

## Implementation and evidence

- CI `37188370268` attempt 1 at clean `bb92992` passed source (942 files / 6210 tests),
  renderer (294 passed / 1 skipped), macOS native/recovery and Windows general
  packaged smoke. The prior missing Windows quit observation did not recur; its
  isolated cause remains unproven. Windows `agent-before-response` passed. Windows
  `app-after-tool` persisted the Tool Result, then the runner failed waiting for
  the old Agent Host to exit after killing the driver PID. Later diagnostics below
  invalidate the assumption that this PID was Main on Windows. Cleanup and
  canonical-session preservation passed. The unknown-Tool case was not reached.
- Bound the existing Main/Host lifecycle with a
  dedicated owner MessagePort. Install its listener before async startup; reuse
  bounded shutdown after disconnect. Keep crash-runner assertions unchanged.
  Rollback is scoped removal of this lifetime contract and its protocol revision;
  it changes no Session/config format. Required evidence: lifecycle unit regressions,
  aggregate source gate, new local macOS preview/three crash cases, then clean-SHA
  Windows/macOS CI. The prior ASAR cannot certify changed production lifecycle code.
- The user clarified the experimental Pi Durable concern. Live dependency/source
  inspection confirms no `@earendil-works/pi-durable` dependency or runtime import.
  Keep the product name “interrupted-task recovery”; retained `pi-durable-compat`
  evidence paths are historical investigation labels, not package adoption.
  The official 2026-10-01 announcement describes Pi Durable as a separate experimental
  harness with an evolving API. This change continues native coding-agent Sessions
  and explicit continuation only, with no checkpoint engine or unattended resume.
- Lifetime fix local acceptance passed: `check:source` (944 files / 6219 tests;
  9 files / 24 optional tests skipped), unchanged coverage floors, packaged smoke
  and all three isolated macOS crash scenarios. Current ASAR is 195103058 bytes,
  SHA-256 `2df76594a004a60a01b37c2545f05c20e5f9a161d4344aee90f1ea1707948cfe`.
  Every crash receipt confirms original Session, one judge call, canonical profile
  unchanged, cleanup passed and zero real model requests. These local receipts bind
  dirty `bb92992` plus this scoped diff; clean-SHA Windows/macOS CI is still pending.
  Evidence: `owner-lifetime-source-gate.log`, `owner-lifetime-macos-preview.log`,
  and the three `owner-lifetime-macos-<scenario>.log` receipt pointers under the
  existing ignored validation directory. Preview reopened the repository app.
- Clean `ca55e1f4`, CI `37190452668`: attempt 1 passed macOS recovery and renderer,
  but Windows ordinary shutdown missed the quit hook (all processes exited within
  2569.3ms) and one configuration access exceeded the unchanged 4000ms budget.
  Same-SHA bounded failed-job rerun, attempt 2, passed quality and Windows ordinary
  smoke; neither transient failure has an independently established root cause.
  Windows `agent-before-response` passed, while `app-after-tool` still timed out
  waiting for the Host PID to disappear. The owner MessagePort alone has not
  certified the Windows scenario. Preserve assertions and add diagnostic-only
  actual-Main/parent PID checks, synthetic Host exit events and Windows native
  `HasExited`/exit-code observations before cleanup to distinguish execution state
  from a still-enumerable WMI object. Do not add a heartbeat or another runtime on
  the basis of PID visibility alone. Current Windows acceptance remains partial.

- Clean `636d80f4`, CI `37192444423` attempt 1 passed source, renderer, macOS
  native/three recovery cases and Windows ordinary smoke. Its new launch assertion
  failed before the synthetic task: Electron reported Main PID 8884, while the
  driver returned PID 3680. Installed Playwright 1.61.1 launches Electron with
  `shell: true` on Windows. Prior Windows Main-death samples killed the shell and
  are invalid evidence of a product orphan defect. The runner now reads Main PID
  inside Electron, verifies it belongs to the launched driver and the isolated
  profile, tracks both identities, and verifies the Host's parent is this Main
  before injecting the crash. Exit budgets/assertions stay unchanged. Unit cases
  cover direct launch, wrapped launch, missing Main and foreign ownership.
- Independently, a real child-process regression proved the orphan exit deadline
  must stay referenced: with `unref()` the otherwise idle Node loop exited code 0
  without running the force-exit callback; retaining the timer produced code 70
  and the expected callback marker. This proves timer scheduling, not the earlier
  Windows orphan hypothesis. Full local source gate passed 944 files / 6224 tests
  with 9 files / 24 optional tests skipped. The subsequent runner-only PID change
  passed 35 focused tests, lint and structure checks; clean-SHA CI remains required.
  New macOS preview passed packaged smoke and reopened the repository artifact:
  ASAR 195103050 bytes, SHA-256
  `20c2406623648baff63448cf1eae41268937e3ac5b19ab52ae970d1ef8be2f69`.
  All three isolated macOS recovery scenarios passed on these bytes with the
  corrected runner: original Session preserved, one classifier call, exact Tool
  effect counts, zero real model requests, canonical profile unchanged and cleanup
  passed. Receipts are linked from `owner-deadline-<scenario>.log` in the existing
  evidence directory. The full source gate precedes only runner/test/plan edits.
- Clean `611294f9`, CI `37193363633` attempt 1 passed source (944 files / 6227
  tests), renderer, macOS native/three recovery cases and Windows ordinary smoke.
  Windows `agent-before-response` passed. `app-after-tool` now killed actual Main
  9192, observed both Main and Host 1180 exit, and reopened the original Session
  under Main 5016. It failed on a test click: automatic bootstrap removed the
  `恢复任务` button while Playwright waited for actionability. Protocol evidence
  records successful `runtime.ready`/inspection, and the captured UI text displays
  the expected continuation notice. This is a runner race, not failed Host exit.
  Bound the optional recovery click to 2 seconds and accept a timeout only when
  the actual Session-ready state is observed; preserve other errors and all final
  continuation/identity/effect assertions. Three new regressions cover already
  ready, ready-during-click and genuine driver/non-ready failures. The 38 focused
  tests, lint and structure checks passed. Product source and ASAR are unchanged.
  All three local macOS crash cases passed once with the corrected runner on ASAR
  `20c24066...`, preserving canonical isolation and cleanup. Evidence:
  `recovery-ready-race-<scenario>.log`. Complete the next clean-SHA Windows run;
  the previous run did not reach unknown-Tool, scale/IME or installer lifecycle.

- Next bounded acceptance uses `eng/packaging/verify-packaged-task-recovery.mjs`:
  separate temporary profile per scenario, in-process synthetic provider, Auto
  judge/candidates, outbound fetch denied, no real model budget. Run once per
  scenario: Agent self-exit before response, exact test Main SIGKILL after a native
  Tool Result, and Agent self-exit after a Tool effect before its Result persists.
  The normal preview and canonical Pi sessions are protected from fault injection. Only
  fixture-owned PIDs with matching identities may be terminated. Close/verify
  all owned processes before deleting the disposable profile; retain scoped
  receipt and synthetic failure evidence. Failure stops that scenario, with no
  automatic retry. Bind results to the current ASAR hash recorded below.

- Native recovery assesses at most the latest 4,096 branch entries. Explicit
  continuation uses a native hidden custom message, exact leaf anchor, durable
  operation deduplication, global run admission and existing writable/config checks.
- Five native SDK cases cover errored output, cutoff before output, completed Tool
  Results, unresolved calls and missing current-task Auto state. A resumed Auto
  task keeps its selection; the next new task classifies normally. Three admission
  cases reject authorization/configuration/pre-dispatch cancellation.
- A separate synthetic Node process exited with code 86 before its first assistant
  entry. A new process reopened the same JSONL and continued on the saved complex
  model with zero classifier calls. This is actual process-exit evidence, not
  packaged Electron crash evidence. Only disposable fixture directories were used
  and removed. Receipt: artifacts/validation/pi-durable-compat/native-crash-receipt.json.
- Host/protocol/renderer tests verify bounded schemas, duplicate submissions,
  changed anchors, stale Session responses and operation installation. Playwright
  built-renderer regression passed 10/10, including Auto and prior operation recovery.
  Light/dark and unresolved-tool screenshots were inspected; the UI uses existing
  neutral notice tokens and primary/secondary buttons. No live user browser was used.
- Initial browser bootstrap failed during protocol handshake before the new tests;
  synchronized build and built-renderer rerun passed. Initial aggregate gates
  exposed file-size limits, addressed by existing responsibility-based modules.
  A later full run had 6,177 passing tests and one unrelated artifact-retirement
  test failure: equal timestamps made its assumed victim nondeterministic. The
  test now targets the actual sorted victim and retains its symlink rejection
  assertion; all eight artifact lifecycle cases pass. Production cleanup is unchanged.
- Evidence root: artifacts/validation/pi-durable-compat/. No new paid inference,
  source commit, remote push or distribution. Packaged crash and Windows acceptance
  remain separate from the source and Node process evidence.
- Final aggregate `check:source` passed: 939 files / 6,178 tests, with 9 files /
  24 tests skipped. Coverage and all source boundary gates passed. The macOS
  unsigned preview rebuilt, passed packaged smoke and reopened PID 93354.
  app.asar: 195098664 bytes, SHA-256
  f86a6e42ac3de3fc2ff70ce27190c3ec969357771c937821de8d4c656f0cc30e.
  Computer Use readback confirmed New Money at `app://pi67/index.html`, with
  `会话待打开`; no user conversation was opened or continued for acceptance.
  General packaged warm/cold restore passed, but the new continuation after a
  forced packaged crash and Windows remain unverified.

## Packaged crash acceptance follow-up

- The first isolated run stopped before any synthetic task because macOS reports
  the canonical `/private/var` temporary path; canonicalizing the fixture paths
  fixed this harness preflight. It is an invalid sample, not product acceptance.
- The next `agent-before-response` run on ASAR `f86a6e42...` exposed
  `STALE_SESSION_GENERATION` when recovering the crashed Agent. Evidence:
  `artifacts/validation/pi-durable-compat/packaged/agent-before-response-9b06c033-c19a-4cd2-bb5e-e3d5262d1f73/receipt.json`.
  Both runs confirmed canonical Sessions unchanged and fixture processes cleaned.
- Replacement-Host initialization was carrying the previous Host's Session
  authority. The new path carries only Task identity and installs the Session
  authority from the replacement's `runtime.ready`. Same-Host stale checks remain.
  Regression first failed on the old context, then passed with old generation 3
  and new generation 1 through the renderer event controller. Six targeted files /
  39 cases and Renderer typecheck passed; aggregate source checks and a newly
  built ASAR remain required before claiming the packaged defect is fixed.

- Rebuilt ASAR `195a9338...` still failed in explicit `恢复任务` with stale
  authority. Preserve that failure separately:
  `packaged/agent-before-response-d6b9bd71-f3f1-4393-9f59-2f3d2a87b03d/receipt.json`.
  The automatic initialize correction alone was insufficient. A live Task without
  recovery metadata was treated as current-Host-owned solely because it retained
  a Session generation. Connection teardown/replacement now retains the previous
  Host ownership; explicit recovery and background activation reopen with fresh
  Task identity when ownership differs. A successful bootstrap clears the old
  marker. Added failing-then-passing crash and background-activation regressions.
  The isolated runner now retains bounded protocol identity/error metadata and
  synthetic call counts, never payload/result bodies, for subsequent failures.

- ASAR `be627704...` removed the stale-generation symptom, but bounded protocol
  evidence showed Host 2 actually emitted `runtime.ready` and acknowledged
  initialization while the UI claimed ready was missing. Evidence:
  `packaged/agent-before-response-e169daf0-41c3-467b-a4a7-98c6dd08966d/observations.json`.
  Manual recovery awaited reconnection, then rotated the same Task already owned
  by automatic bootstrap. The late ready targeted the removed Task. Manual
  activation/recovery now checks transition ownership and projection identity
  after awaits; it yields to automatic bootstrap without changing that Task.
  A known foreign-Host background Task clears only its own transition before
  reopening. Both new cases failed before this correction and passed afterward.
  Rebuild and rerun the isolated case first, then run the final full source gate
  after packaged scenarios converge, avoiding repeated full checks during diagnosis.

- Final ASAR `ea822e67...` passed all three packaged scenarios, each once after
  its relevant correction. See the consolidated ignored report
  `artifacts/validation/pi-durable-compat/PACKAGED-TASK-RECOVERY-RESULTS.md`.
  All three receipts preserve one Session/user message, one classifier call, the
  complex candidate and exact effect counts. Unknown outcomes block continuation.
  Canonical Session isolation and fixture-process cleanup passed in all cases.
  Normal preview PID 83188 remains open; Computer Use readback is `会话待打开`.
  Final full source gate is running on the same production source.

- Final aggregate `check:source` passed: 939 files / 6,181 tests; 9 files /
  24 tests skipped. All static gates and coverage passed, with no production
  source change after the successful packaged crash scenarios. `git diff --check`
  passed. Evidence: `recovery-final-source-gate.log`; source manifest:
  `recovery-final-source-identity.json`. Windows, paid Provider recovery and
  distribution remain outside this completed local phase. No commit/push/release.

## Windows acceptance continuation

The user asked to continue after macOS acceptance. Extend the existing bounded
synthetic crash runner to Windows x64 and register all three scenarios in existing
native CI and Windows candidate jobs. Use exact owned PIDs with fresh creation
identity checks, retain failed evidence, and preserve canonical Sessions. No
production behavior or model configuration change is intended. Local test code,
workflow changes and non-paid validation are within scope. Commit/push, remote
workflow dispatch and new paid inference still need explicit authorization.

Acceptance: process identity/PID reuse/lookup failure tests, workflow scenario and
receipt retention checks, one bounded macOS execution per scenario after runner
changes, and applicable source gates. Do not mark Windows passed without a real
Windows receipt. Preserve previous ASAR and paid Auto receipts; do not rebuild
unchanged production just to validate a test harness.

### Windows preparation result

- Local Windows process-query/PID ownership implementation and CI wiring are
  complete. Each native CI job and Windows candidate runs the three bounded
  scenarios separately and always retains isolated receipts. No remote run yet.
- Process ownership and workflow/argument tests pass (27 cases). The full source
  gate passed 941 files / 6,208 tests, with 9 files / 24 tests skipped; all static
  gates and coverage passed. Its first run caught an incorrect `corepack pnpm`
  prefix in the ordinary CI jobs; use their already-pinned native `pnpm` command.
- Portable macOS probes passed all three scenarios on unchanged ASAR
  `ea822e67fad6570c3b4d39adad17e430b8ebcd713a1ee00ae715aeaaac30762b`.
  Additional cold-reopen checks exposed a runner assumption: a fast synthetic
  task can persist JSONL/tool results before the 120 ms navigation checkpoint.
  The app then correctly restores the workspace home and lists the original
  Session, while the runner waited only for a selected-conversation action.
  Failure `app-after-tool-a92339a5-73b7-4d1d-b052-7d79177da56f` records this
  exact state. The runner now captures the new page and matches the complete
  original sidebar identity without CSS interpolation of its NUL separators.
- The final cold-reopen regression deliberately traverses the workspace home,
  opens that exact Session, and passed with one original user message, one Auto
  classification and one tool effect. Receipt:
  `packaged/app-after-tool-4eed086a-f50c-41c3-b33e-b0274714fb47/receipt.json`.
  The final runner-only correction passed scoped lint and the structure gate
  after the aggregate source run; no production source changed during this phase.
- All scenario receipts confirm canonical Sessions unchanged and owned process
  cleanup. Real model requests: zero. Summary and scoped source manifest:
  `artifacts/validation/pi-durable-compat/WINDOWS-RECOVERY-READINESS.md` and
  `artifacts/validation/pi-durable-compat/auto-recovery-delivery-scope.json`.
  Windows execution, paid-provider recovery and distribution remain unverified.
  Commit/push still await explicit authorization; no remote write was performed.

### Authorized CI follow-up

- The user explicitly authorized the reviewed 106-file scoped commit, push to
  main and CI acceptance. Commit `abc165859c591dc6908829ece6d35285d905a1de`
  matches every approved file hash; CI run `37186301728`, attempt 1 completed.
- Source quality and macOS native jobs passed. All three downloaded macOS
  recovery receipts bind that clean SHA and the unchanged `ea822e67...` ASAR.
- Renderer E2E had 11 failures / 283 passes / 1 skip. Every failure counted the
  new read-only `session.recovery.inspect` as a scenario action. Add it to the
  existing setup/read query filter; retain `session.recovery.continue` and all
  turn-producing commands, verified by a dedicated regression. The affected
  18 browser cases pass locally after this fixture-only correction.
- Windows general packaged smoke passed, but recovery stopped during launch:
  the first CIM identity query failed, then an occupied DIPS file caused cleanup
  to throw before receipt output. No synthetic task had started. Failure text
  and observations remain in `ci-37186301728/Windows/`; the missing receipt is
  a harness defect, not a passed scenario. The exact initial query cause was not
  preserved; timeout is a hypothesis, not a confirmed diagnosis.
- Correct the harness to retain the owned application immediately, track unknown
  identities as unknown, preserve original failure and cleanup error in receipts,
  and preflight process lookup before launching. Align the bounded Windows query
  timeout with the existing 15-second installer probes and retain timeout/code/
  signal diagnostics. Local process tests, lint, structure and the macOS Agent
  crash regression pass; actual Windows proof still requires the follow-up CI.
- Final local Renderer suite passed 294 cases / 1 existing skip, with 2 workers
  and zero retries. Test TypeScript checking passed. The follow-up modifies only
  test fixtures, owned-process acceptance code and these evidence contracts;
  production behavior and the already-tested packaged ASAR remain unchanged.
- Follow-up commit `39d1f279d5a3de1ac5186ab17a4fe2896bcaafe5`, CI
  `37187427966` attempt 1: macOS native and all recovery cases passed again.
  The original 11 Renderer failures are resolved; a different search case read
  `workspace-test` before registration changed it to `workspace-pi-demo` (trace
  confirms both). Await ready before binding that fixture; all 7 search tests
  pass. A 200 ms response-delay experiment alone did not reproduce the race.
- The real-filesystem previous-Host receipt test exceeded Vitest's default
  one-second `waitFor` while settling the old Host. Its ledger lock retry budget
  alone can exceed one second; use a bounded five-second semantic wait and keep
  the no-replay/no-completion assertions. The unchanged case passes locally.
- Windows stopped earlier in general packaged shutdown: all measured processes
  exited within the existing gate, but no `session_shutdown(quit)` entry was
  observed. This is unresolved, and the revised recovery probe was not reached.
  Retain the failed run and add bounded shutdown measurements to that existing
  error; do not change the product budget, expected lifecycle count or retry
  policy. The next CI run must establish Windows evidence before claiming pass.
