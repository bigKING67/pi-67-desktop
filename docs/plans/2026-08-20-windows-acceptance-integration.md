# Windows acceptance integration

Status: active
Owner: Codex root agent
Started: 2026-08-20
Last updated: 2026-08-21

## Goal

Close the Windows x64 acceptance gaps found after the Alpha.29 manual install while preserving the
Pi-first runtime, canonical shared Pi Profile, one-writer JSONL contract, and the existing managed
capability and unsigned R2 update work.

## Non-goals

- Do not delete user-owned Provider definitions or credentials during Desktop installation.
- Do not weaken the one-active-writer contract for a Pi JSONL Session.
- Do not publish, upload, delete remote objects, purge CDN cache, push, commit, tag, or promote.
- Do not claim Windows or installed-macOS success from source, unit, or repository-preview tests.

## Acceptance criteria

- Reopening a stopped or lost Task retires its previous Agent Host authority before rotating the
  Renderer Task, so the same Desktop process cannot conflict with its own Session writer lease.
- A genuinely active Task or another live Agent Host that owns the same JSONL still fails closed.
- Provider settings state explicitly that Desktop and Pi TUI share the current user's Pi Profile;
  custom rows identify `Pi models.json` as their source and remain removable by explicit user action.
- Desktop does not provision `xtalpi-pi-tools`; a user-owned legacy definition remains visible until
  explicitly removed from the shared Pi Profile.
- Agent Host keeps one revision-bound Pi model runtime warm after each Task consumes the previous
  standby, reducing sequential restore latency without sharing mutable Task runtime instances.
- Managed capability receipts remain identity-bound across Desktop upgrades, and R2 release tooling
  can plan, publish, verify, and later clean a latest-only channel without performing remote writes
  during this implementation turn.

## Delivery boundary

- Local implementation and non-destructive validation: authorized.
- Commit, push, candidate build/upload, R2 publication/deletion/cache purge: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | A Windows x64 restore produced duplicate `This Pi Session is already open in another Task or Agent Host.` errors. | User screenshot | 2026-08-20 |
| OBSERVED | The baseline Renderer rotation removed the old Task locally but did not send `task.close` before opening the same Session under a replacement Task. | Baseline `task-activation-controller.ts`, `task-runtime-reopen.ts` | 2026-08-20 |
| OBSERVED | Agent Host `task.close` disposes the Task and releases its Session writer lease. | `host-task-runtime-lifecycle.ts` | 2026-08-20 |
| OBSERVED | Desktop resolves one canonical Agent directory and Pi configuration reads its `models.json`, `auth.json`, and `settings.json`. | Desktop Agent directory and Pi configuration service | 2026-08-20 |
| OBSERVED | Desktop Provider save/remove commands atomically mutate the same current-user `models.json` read by Pi TUI; built-ins remain non-removable and credential removal stays explicit. | `pi-configuration-service.ts` and targeted service tests | 2026-08-20 |
| OBSERVED | Desktop neither provisions nor owns `xtalpi-pi-tools`; a legacy user definition remains removable through the shared Provider editor. | repository search and Provider removal flow | 2026-08-20 |
| OBSERVED | Agent Host now queues the next revision-bound model-runtime standby after consuming the current prewarm. | `pi-configuration-service.ts` and prewarm tests | 2026-08-20 |

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Close the old Task before Renderer authority rotation. | Lease ownership must move through the Host, not only the disposable Renderer index. | Protocol gains an atomic Host-side reopen command. |
| Keep real conflicts fail closed. | Two writers can corrupt Pi JSONL authority. | Pi SDK introduces a verified multi-writer Session contract. |
| Show shared-profile provenance instead of auto-deleting legacy Providers. | Pi TUI and Desktop intentionally share one user-owned source of truth. | A future managed migration has a cryptographic/Desktop ownership receipt and explicit consent. |
| Maintain a rolling one-runtime standby. | Sequential restore should not pay model registry construction repeatedly. | Measured memory or startup cost exceeds the restore-latency benefit. |
| Keep R2 latest-only cleanup separate from publish and target-OS validation. | Deleting the rollback artifact before upgrade proof is unsafe. | Never for the current unsigned-preview channel. |

## Checkpoints

- [x] 1. Retire current-Host stopped/lost Tasks before Session reopen while skipping stale previous-Host identities.
- [x] 2. Expose canonical Pi Profile provenance and prove Desktop/Pi TUI `models.json` definitions are bidirectionally removable.
- [x] 3. Add rolling revision-bound model-runtime prewarm and targeted performance regressions.
- [x] 4. Complete managed capability receipt validation and local R2 plan/publish/cleanup automation.
- [x] 5. Pass targeted tests and the complete source gate, retain exact macOS packaged smoke as
  the final local artifact checkpoint, and document the still-unverified target-OS work.

## Validation matrix

| Layer | Required evidence | Result |
| --- | --- | --- |
| Source | scoped review of Task authority, Provider provenance, runtime prewarm, managed state, R2 tool boundaries | completed; typecheck, lint, build, architecture, transport, dependency, dead-code, protocol, structure, and diff checks passed |
| Targeted tests | current-Host close, previous-Host skip, true conflict retention, bidirectional Provider removal, R2 provenance and strict flags | passed; 29 Renderer reopen tests, 21 Provider service/controller tests, 7 Provider Chromium E2E tests, and 16 R2 release tests |
| Full source gates | tests, typecheck, lint, build, architecture/protocol/dependency/structure gates | passed: Vitest coverage ran 581 files with 2,998 passed and 3 skipped; `check:structure` covered 1,772 governed files; final Chromium E2E rerun passed 198/198 |
| Packaged artifact | exact rebuilt macOS arm64 repository preview and smoke after visible changes | passed on the exact repository artifact after one transient launch timeout and a same-artifact retry; `app.asar` size 183,437,896, SHA-256 `e6f748fc4e466fde09db1c594232fed334d614f475acfbee7d3e5ded22efdcfd`; the same app was then opened and remained live |
| Windows/manual | real Windows x64 reinstall, restore, Provider, Lark, browser67, and updater acceptance | pending; external evidence required |

## Rollback

Revert only the scoped Task reopen, Provider copy, prewarm, managed-state, and release-tool changes.
No user Pi Profile migration or remote R2 mutation is performed in this turn, so rollback requires no
data rewrite or remote cleanup.

## Risks and unknowns

- A live second Agent Host must continue to block the same JSONL; the new retirement step must never
  close another Task identity.
- Rolling prewarm adds one standby ModelRuntime per Agent Host and needs bounded memory observation.
- A legacy custom Provider may still be required by a user's Pi TUI even if Pi-67 no longer uses it.
- Windows process, NSIS, browser extension, and network behavior remain target-machine evidence.
- R2 credentials and remote object inventory remain operator-owned and outside the repository.
- The earlier managed-capability structure violations are closed; target-machine Windows behavior
  remains the only platform-specific acceptance boundary in this plan.

## Related plans

- `docs/plans/2026-08-20-managed-capability-state.md`
- `docs/plans/2026-08-20-r2-internal-auto-update.md`

## Progress log

- 2026-08-20: Re-established `main`/`origin/main` parity and preserved the existing dirty WIP.
- 2026-08-20: Traced the Windows false writer conflict to Renderer-only Task rotation without Host
  retirement; confirmed Provider rows come from the shared user Pi Profile rather than a hardcoded list.
- 2026-08-20: Added Host-identity-aware reopen: a stopped/lost Task owned by the current Host is
  disposed before rotation, while a stale previous-Host identity is not sent to the new Host. New
  initialization still acquires the durable one-writer lease and therefore keeps real conflicts closed.
- 2026-08-20: Proved bidirectional Pi Profile behavior through App-scope save/remove commands and
  direct `models.json` assertions; credentials remain in `auth.json` until separately removed.
- 2026-08-20: Bound the local R2 release bundle to the exact Windows candidate identity and manual
  test receipt, and made publication require a clean, origin/main-reachable exact source SHA.
- 2026-08-21: Made rolling model-runtime disposal await an active standby load before releasing the
  configuration service; a deterministic deferred-load regression now prevents late background work
  from retaining a runtime or racing temporary Pi Profile cleanup.
- 2026-08-21: Completed the full local verification set: Vitest coverage 581 files/2,989 passed plus
  3 skipped, Chromium E2E 198/198, and all non-structure source gates. The structure result is limited
  to the four known managed-capability WIP files above.
- 2026-08-21: Re-ran the complete source gate after the managed-capability refactors and final
  hardening: 581 Vitest files/2,998 passing tests plus 3 skipped, 1,772 governed structure files,
  and 796 architecture modules with zero cycles all passed.
- 2026-08-21: Rebuilt the macOS arm64 repository preview. The first smoke launch timed out after the
  debugger connected without a specific application error; no residual smoke process remained. A
  retry against the exact same packaged artifact passed, and that artifact was opened and observed
  live. No Windows target-machine acceptance was inferred from this result.
