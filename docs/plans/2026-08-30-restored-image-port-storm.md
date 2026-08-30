# Restored Image Port Storm Recovery

Status: implementation complete; Windows x64 acceptance pending
Owner: Codex
Started: 2026-08-30
Last updated: 2026-08-30

## Goal

Stop a restored conversation containing a projected image from closing the
Electron Agent Host MessagePort, prevent any future sequence of short-lived
successful handshakes from becoming an unbounded whole-window recovery loop,
and preserve enough bounded diagnostics to prove convergence.

## Non-goals

- Do not change Pi Session JSONL authority, Provider/model routing, or the image
  input contract.
- Do not include prompts, image bytes, Session bodies, paths, or raw payloads in
  diagnostics.
- Do not publish an R2 update, change an update manifest, delete retained R2
  objects, promote, tag, or create a GitHub Release.
- Do not claim Windows x64 acceptance from source tests or macOS evidence.

## Acceptance criteria

- An `asset.read` response sent from the utility-process `MessagePortMain` uses
  Electron-supported structured cloning and never places an `ArrayBuffer` in the
  `MessagePortMain.postMessage` transfer list.
- Restoring a Session with a projected image can read every bounded image chunk
  without retiring the Agent Host connection.
- Automatic same-document Port replacement is bounded across consecutive
  short-lived successful connections; once the bound is reached, the Renderer
  remains on one truthful failure surface instead of flashing indefinitely.
- Targeted tests reproduce both the unsupported asset transfer contract and the
  successful-handshake/repeated-teardown storm that escaped Alpha.38.
- Support diagnostics expose only bounded counts for the new circuit breaker.

## Delivery boundary

- Local implementation: authorized
- Scoped local commit together with the causal-diagnostics work: authorized
- Push: authorized after final source gates and the capability freshness blocker pass
- Candidate build/upload: authorized for the exact-SHA Windows x64 Candidate and
  the three-file internal Feishu candidate mirror
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | The Windows x64 Alpha.38 report stayed on Agent Host epoch 1 with zero Host restarts, but recorded 192 Port handoffs, 192 successful future-generation waits, and 191 `port-closed` teardowns in about 146.6 seconds | R2 support report `PI67-ED5F32C10DBC`, SHA-256 `feafa5cfbfc4ba7614f28adec36cadf105f9c51178db548a4fd2c783a448c55a` | 2026-08-30 |
| OBSERVED | The incident starts only after the operator clicks Restore Task for the affected conversation; a cold launch without restoring it remains stable | operator reproduction | 2026-08-30 |
| OBSERVED | The restored Runtime is `deepseek/deepseek-v4-flash-vision-exp`, initialized exactly once, remains live, and has no active or poisoned operation when diagnostics are collected | R2 support report `PI67-ED5F32C10DBC` | 2026-08-30 |
| OBSERVED | Visible projected images call `asset.read`; the Alpha.38 baseline sent the result `ArrayBuffer` as a transfer-list entry and retired the whole connection if `postMessage` threw | `apps/renderer/src/conversation/conversation-asset-controller.ts`, pre-fix `apps/agent-host/src/connection-context.ts` | 2026-08-30 |
| OBSERVED | Electron 43 documents `MessagePortMain.postMessage` transfer entries as `MessagePortMain[]`, not `ArrayBuffer[]` | Electron `MessagePortMain` API | 2026-08-30 |
| OBSERVED | Installed Electron 43.2.0 types independently bind `MessagePortMain.postMessage(message, transfer?)` to `MessagePortMain[]` | `node_modules/electron/electron.d.ts` | 2026-08-30 |
| OBSERVED | The root checkout was clean at `69ba796` and matched `origin/main` before edits | live Git | 2026-08-30 |
| OBSERVED | Candidate freshness initially failed because AI Berkshire advanced by one commit to `fd83d063`, adding `era-alpha`; the exact Pi-67 generator requires a minor Pack bump for a Skill-set addition | remote source audit and fixed-source generator | 2026-08-30 |
| OBSERVED | Windows exact-source run `33287582263` accepted the Prompt and exposed Stop before its slower attachment/preflight path had appended the projected user image; the smoke stopped immediately and then timed out waiting for the image | GitHub Actions failure log and screenshot artifact | 2026-08-30 |

## Affected boundaries

- Modules/processes: Agent Host response transport; Renderer connection recovery;
  Protocol diagnostics; packaged Electron smoke coverage.
- Protocol or persisted state: support-diagnostics counters only; no Pi command,
  event, Session JSONL, or persisted Workbench change.
- Platform/artifact: the observed failure is Windows x64 packaged Alpha.38; the
  utility-process MessagePort contract is cross-platform.
- Security/privacy: structured-cloned image chunks remain bounded to 1 MiB and
  stay on the existing private MessagePort; diagnostics contain counts only.
- Existing WIP: none observed before edits.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Clone asset chunks in the MessagePort message instead of transferring the `ArrayBuffer` | Electron's utility/main-side Port does not admit `ArrayBuffer` transfer entries; the existing 1 MiB chunk and 64 MiB lazy cache bound the copy cost | A supported, tested zero-copy primitive becomes available for utility-process-to-Renderer Ports |
| Make the Agent Host response-side Port contract incapable of accepting arbitrary transferables | A compile-time boundary prevents the exact unsupported call from returning | A future Host response legitimately transfers a supported `MessagePortMain` and receives its own explicit API |
| Add a cross-flight replacement circuit breaker, not a longer UI debounce | Alpha.38 already bounded retries inside one flight; the escape was a sequence of short-lived handshakes that each reset the flight | Recovery ownership gains an equivalent formally bounded state machine |
| Keep the failure truthful after the breaker opens | A stable error is safer and diagnosable; automatic infinite retries are destructive even if each handshake briefly succeeds | Product introduces an explicit user-controlled retry action with equivalent bounds |
| Carry one AbortSignal from Host acceptance through attachment preparation and Pi preflight, and wait for execution acknowledgement before publishing cancellation | `operation.started` precedes asynchronous image/auth/Extension preflight; aborting an idle Pi Session previously returned before the accepted execution was actually stopped | Pi exposes a native accepted-operation cancellation contract with equivalent acknowledgement semantics |
| Require the packaged image to enter the live Pi Session before stopping the controlled Provider | Restore coverage needs a durable Session fixture; immediately stopping at `operation.started` measured an unrelated preflight race and could leave no image to restore | The smoke uses a separately materialized exact image Session fixture |

## Checkpoints

- [x] 1. Add failing transport and recovery-storm regressions.
- [x] 2. Replace unsupported Host asset transfer with bounded structured clone.
- [x] 3. Add and diagnose the cross-flight automatic-replacement bound.
- [x] 4. Pass targeted tests, affected typechecks, aggregate source gate, and
  macOS unsigned packaged image-restore smoke where available.
- [x] 5. Record Windows x64 candidate/manual acceptance as not completed unless a
  separately authorized exact candidate is built and tested.
- [x] 6. Audit and lock AI Berkshire `fd83d063` as Pack `1.1.0`, including the
  new `era-alpha` suite member and generated immutable hashes.
- [x] 7. Repair cancel-before-Pi-preflight, require execution settlement, add
  regressions, and make the packaged image fixture durable before Stop.
- [ ] 8. Push the final clean Alpha.39 source, build and verify an exact-SHA
  Windows x64 Candidate, then mirror the Windows EXE and macOS DMG/ZIP internally.
- [ ] 9. Obtain real Windows Restore Task evidence and a v6 diagnostics receipt.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | affected package typechecks and `corepack pnpm run check` | strict types and all aggregate gates | PASS: repaired Alpha.39 gate passed 618 files; 3,218 passed; 3 skipped; type/lint/architecture/structure/transport/workflow/coverage gates passed |
| Capability provenance | remote lock verification, fixed-source preparation, freshness, adapter provenance, focused tests | all tracked sources current; Pack `1.1.0`; 22 members including `era-alpha` | PASS: remote lock (5 commits), preparation (4 packages), freshness, adapter provenance, 8 files / 60 focused tests, Renderer E2E 8/8, and final aggregate gate |
| Tests | focused Agent Host asset and Renderer recovery tests | old transfer call fails; repeated short-lived success stops at bound | PASS: red baseline failed 4 expected tests; green run passed 6 files / 46 tests; stable five-second reset also covered |
| Renderer E2E | `PI67_E2E_RENDERER_PORT=45174 ... renderer-assets.spec.ts` | chunked Blob image reads and replacement cleanup | PASS: 3/3 including bootstrap |
| Runtime/host | packaged Electron restore of a Session with a projected image | image chunk arrives and Port stays stable | PASS on macOS arm64: 39,057-byte PNG loaded after submission, warm Restore Task, and cold Restore Task; each remained visible through a 750 ms ready-state stability window |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | rebuilt Alpha.39 app packages, smokes, launches, and uses new assets | PASS: packaged image restore smoke; opened app artifact SHA-256 `65b456718c3223f9c67aa0dbbb8b992b304d88c866c2d99ee7406a0114833903` |
| Target OS/manual | exact Windows x64 candidate, Restore Task on affected image Session | no flashing; one stable Port; image loads | NOT COMPLETED |

## Rollback

Revert only this plan's scoped transport, recovery, diagnostics, tests, and smoke
changes. There is no migration or persisted-state change. Rolling back restores
the prior transferable call and unbounded cross-flight recovery behavior.

## Risks and unknowns

- The current Alpha.38 report records the Renderer-visible `port-closed` reason,
  not the Agent Host's internal `response-post-failed` exception class. The
  unsupported transfer is bound by the exact Restore Task/image path and Electron
  API contract; the regression must exercise that boundary directly.
- Structured clone copies at most 1 MiB per chunk. Large visible images may use
  more CPU than a zero-copy transfer, so the existing lazy loading, cache, chunk,
  and total-byte bounds must remain intact.
- macOS packaged evidence cannot prove the Windows scheduling behavior that
  produced the operator incident.

## Progress log

- 2026-08-30: Bound Alpha.38 report `PI67-ED5F32C10DBC` to a single live Host and
  an unbounded sequence of short-lived Renderer Ports.
- 2026-08-30: Operator isolated the trigger to Restore Task; source tracing bound
  it to projected image loading and an unsupported `ArrayBuffer` transfer through
  `MessagePortMain`.
- 2026-08-30: Added four red regressions for the unsupported transfer and escaped
  cross-flight recovery loop, then made all focused tests green.
- 2026-08-30: Removed Host response transfer lists, narrowed the Host response Port
  type to one-argument `postMessage`, and added a four-short-connection circuit
  breaker with bounded diagnostics and a five-second stability reset.
- 2026-08-30: Extended the real packaged Electron smoke to submit an image and
  verify it after both warm and cold Restore Task; the macOS arm64 run passed.
- 2026-08-30: One intermediate packaged smoke assertion required the exact status
  text `Pi SDK 已就绪` after a cancelled operation and failed despite a ready Runtime;
  it was corrected to the authoritative `data-runtime-phase="ready"` contract and
  the same smoke then passed.
- 2026-08-30: Upgraded the complete workspace to Alpha.39 and repeated the final
  affected tests, aggregate source gate, unsigned macOS packaging, warm/cold
  projected-image Restore Task smoke, and repository app launch successfully.
- 2026-08-30: Candidate freshness found one new AI Berkshire upstream commit.
  Audited the six-file change, accepted `era-alpha` as a bounded investment
  research Skill, generated Pack `1.1.0` from exact sources, and passed the
  capability lock, preparation, freshness, adapter, focused, and Renderer E2E
  gates before the final aggregate gate.
- 2026-08-30: The first aggregate run had one unrelated Host crash-recovery
  wait-window miss while the other 616 files passed. The exact test then passed
  alone in 327 ms, and the unchanged full aggregate gate passed 617/617 files,
  3,212 tests, with 3 skipped.
- 2026-08-30: The first exact-SHA macOS candidate packaging reached packaged
  smoke and failed because its assertion still hard-coded the prior 21-member
  AI Berkshire count. Cancelled the superseded Windows run `33287416833` and
  changed the smoke to derive a validated member count from the immutable Pack
  lock, preventing the same drift on later Pack additions.
- 2026-08-30: Windows exact-source run `33287582263` exposed a second boundary:
  Stop became available at Host `operation.started` while Pi was still preparing
  the image Prompt, so an idle-session abort could return before the accepted
  execution later entered Pi. Added an accepted-operation AbortSignal, repeated
  abort at Pi preflight when needed, and withheld the cancelled terminal event
  until the execution acknowledged cancellation.
- 2026-08-30: Strengthened packaged restore setup to prove the projected image is
  live before Stop, added bounded failure screenshot/DOM/process evidence, and
  passed 6 focused files / 35 tests plus the full 618-file / 3,218-test gate.

## Closeout

- Base source SHA: `69ba79667d8c030be1c76af09ebe75c9d66cbe1b`;
  the scoped Alpha.39 commit is recorded by Git after this plan snapshot
- Changed files: scoped transport/recovery paths are committed together with the
  diagnostic evidence required to explain future failures
- Validation completed: focused tests; affected typechecks; Renderer asset E2E;
  aggregate `check`; macOS arm64 unsigned build, packaged image Restore Task smoke,
  and launch
- Validation not completed: Windows x64 candidate/manual acceptance
- Remaining risks: target Windows x64 timing and the operator's exact private
  Session require a new exact candidate and manual receipt; source/macOS evidence
  must not be promoted into that claim
- Push/candidate state: authorized but not yet performed at this plan snapshot;
  R2 publication, Tag, GitHub Release, and promotion remain unauthorized
