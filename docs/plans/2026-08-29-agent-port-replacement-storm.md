# Agent Port Replacement Storm Recovery

Status: completed
Owner: Codex
Started: 2026-08-29
Last updated: 2026-08-29

## Goal

Stop a same-Host MessagePort replacement from feeding its own old-Port teardown
back into another replacement request, keep the active conversation visually stable
during that recovery, and preserve bounded transport evidence in support diagnostics.

## Non-goals

- Do not change Provider/model routing or the Pi image-input contract.
- Do not add another runtime, protocol, loop, or Session authority.
- Do not claim Windows packaged acceptance from macOS or source tests.
- Do not publish, upload, promote, tag, release, or push this change.

## Acceptance criteria

- One requested same-document Port replacement remains one replacement flight even
  when the old Port closes before the replacement handshake completes.
- A later replacement handoff can satisfy that flight; a bounded timeout may start
  another attempt, but an old-generation teardown cannot do so immediately.
- Connection diagnostics report bounded generation, teardown, and replacement-wait
  evidence without prompts, payloads, paths, or credentials.
- Repeated teardowns belonging to the current recovery incident create one warning
  notification; a completed recovery or a genuinely new incident may notify again.
- Targeted tests reproduce the Windows-observed Host-first ordering and prove the
  reconnect request count stays bounded.

## Delivery boundary

- Local implementation: authorized
- Commit: authorized on 2026-08-29 for this scoped local change set
- Push: not authorized
- Candidate build/upload: not authorized
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Packaged Windows x64 Alpha.37 remained on `hostEpoch=1`, `restartCount=0`, and recorded 48 Port handoffs in about 78.1 seconds | `/Users/gaoqian/Downloads/pi67-diagnostics-2026-08-29.json`, SHA-256 `b8f147c8ec8abe7542057192f9b042852a35d4630bf75db8e2bc45f4c7e104e3` | 2026-08-29 |
| OBSERVED | Current recovery chooses `replaceCurrent` from permanent `hasReceivedPort`, and its post-request wait rejects on the old Port teardown | `apps/renderer/src/connection/{connection-recovery,AgentConnectionController}.ts` | 2026-08-29 |
| OBSERVED | Main transfers the new Port to Agent Host before Renderer; Agent Host retires its current connection as soon as the candidate arrives | `apps/desktop/src/agent-host-supervisor.ts`, `apps/agent-host/src/host-server.ts` | 2026-08-29 |
| OBSERVED | Screenshot shows full conversation recovery state and three identical connection-closed Toasts; the surface visibly jumps instead of remaining a single stable recovery incident | user-supplied Windows screenshot | 2026-08-29 |
| OBSERVED | Root checkout was clean before changes and at `d4d76981833d292c70e1ddca9e6e09d304e0b667`, ahead of `origin/main` by two commits | live Git | 2026-08-29 |

## Affected boundaries

- Modules/processes: Renderer connection controller and recovery coordinator;
  Protocol diagnostics contract; Renderer recovery notification ownership; product
  and design behavior contracts.
- Protocol or persisted state: support-diagnostics schema only; no Pi command/event,
  Session JSONL, or persisted-state change.
- Platform/artifact: source behavior is cross-platform; the observed incident and
  final acceptance target are Windows x64. macOS arm64 packaged preview is a separate
  local smoke boundary.
- Security/privacy: diagnostics remain counts, timestamps, reason codes, and bounded
  redacted messages; no prompt, attachment, source, path, or raw payload.
- Existing WIP: none observed before edits.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Fence a replacement wait by Renderer connection generation | It directly preserves one request/one future handoff despite the old generation closing, without changing Pi or Session authority | A real failing test shows the handoff can complete without advancing the controller generation |
| Keep ordinary `waitForConnection` semantics and add a future-generation wait | Existing retry callers rely on current teardown rejection; narrowing the new behavior avoids changing unrelated request replay | All callers are migrated to an explicit common state-machine contract |
| Dedupe at recovery-incident ownership rather than by a longer global time window | One incident should notify once even if it lasts over five seconds, while a later independent incident must remain visible | Recovery ownership cannot reliably identify incident boundaries |
| Extend the existing Renderer diagnostics receipt | It is already exported with support diagnostics and has the correct privacy boundary | A lower-level Host lifecycle receipt becomes available and provides stronger exact causality |

## Checkpoints

- [x] 1. Document the same-Host replacement and stable-notification contracts.
- [x] 2. Implement generation-fenced replacement waiting and bounded diagnostics.
- [x] 3. Add recovery-incident notification ownership and reset it on convergence.
- [x] 4. Add regression coverage for old-Port close before replacement handshake.
- [x] 5. Pass targeted tests, affected typechecks, aggregate source gate, and macOS
  unsigned packaged preview; record Windows acceptance as pending.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | protocol revision, full typecheck, lint, architecture, dead-code, references, structure, production transport, and workflow checks | strict types, no lint warnings, zero dependency cycles, governed file limits, and production transport contract | PASS |
| Tests | targeted Vitest plus `vitest run --coverage --maxWorkers=4` | exact ordering regression and complete repository suite | PASS: 609 files; 3,183 passed; 3 skipped; Statements 82.12%, Branches 76.19%, Functions 85.88%, Lines 86.06% |
| Runtime/host | standard `corepack pnpm run check` and low-worker equivalent | cross-module source gate passes | PARTIAL for the exact command: after the related mock was corrected, all pre-coverage stages and 608/609 test files passed; the sole failure was an unrelated release fixture exceeding its 5-second timeout. That fixture and a separately observed Provider startup-budget fixture each passed alone, and the full low-worker suite passed |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | new repository artifact packaged, smoked, and launched on macOS arm64 | PASS: `app.asar` 197,318,018 bytes, SHA-256 `0abbad46d11616ed4b54d3818258842641d1fe9af7bdbd17decd20c63791a9c3`, PID 11607 |
| Target OS/manual | Windows x64 packaged reproduction with image input | no repeated screen replacement/Toast stack and bounded handoff count | NOT COMPLETED; requires a later Windows candidate/manual test |

## Rollback

Revert only this plan's scoped files. The implementation adds no migration or
persisted state; reverting the generation wait, diagnostic fields, incident ledger,
tests, and contract text restores the prior behavior.

## Risks and unknowns

- The diagnostic export cannot reconstruct the exact first Host-side retire reason
  from Alpha.37, so the fix is bound to the directly observed replacement loop and
  its current source ordering.
- A failed candidate handoff still needs bounded retry after timeout; tests must
  distinguish that legitimate retry from immediate teardown feedback.
- macOS packaged smoke cannot establish Windows scheduling behavior.

## Progress log

- 2026-08-29: Diagnosed a same-Host replacement storm, captured the source and
  screenshot baseline, and selected a Renderer generation fence plus incident-scoped
  feedback as the smallest complete repair.
- 2026-08-29: Implemented future-generation waiting, exact Port teardown receipts,
  recovery-incident notification ownership, bounded diagnostics, and focused module
  splits that keep all governed files under 460 lines.
- 2026-08-29: Final static gates passed. The complete low-worker coverage suite passed
  609/609 files. Final macOS arm64 packaged smoke passed and launched the exact rebuilt
  preview; Windows x64 packaged acceptance remains intentionally unclaimed.

## Closeout

- Source boundary: this plan and implementation are committed atomically from base `d4d76981833d292c70e1ddca9e6e09d304e0b667`; the resulting immutable SHA is reported from Git after commit
- Changed files: 24 scoped working-tree paths across product/design contracts, Renderer recovery, Protocol Port lifecycle/diagnostics, tests, and this plan
- Validation completed: final static gates; exact race and notification regressions; full low-worker coverage; final macOS arm64 package, smoke, artifact hash, and process launch
- Validation not completed: Windows x64 packaged reproduction with `deepseek/deepseek-v4-flash-vision-exp` and image input; final visual review of the Windows recovery state
- Remaining risks: Windows scheduling behavior is covered by deterministic MessageChannel ordering tests but still needs target-OS confirmation; the standard high-worker aggregate command remains susceptible to unrelated five-second fixture timeouts on this machine
- Commit/push/release state: one scoped local commit is authorized; push, candidate upload, tag, release, and promotion remain unauthorized
