# Startup resource and memory optimization

Status: partial — Inspector split reverted and restored preview passes; current ten-sample initialization assets and Welcome working set fail their budgets
Owner: Codex
Started: 2026-09-21

## Goal and acceptance

Reduce the measured Welcome assets (0.753 MiB), initialization assets (0.500 MiB)
and Welcome working set p95 (356.563 MiB) against unchanged 0.60/0.40/350 budgets.
Same-host ten-sample packaged Electron comparison; preserve validation, first-use
feedback, keyboard interaction, Session authority and lazy code highlighting.

## Delivery boundary and WIP

Local implementation, tests, packaging/smoke and normal macOS preview. No commit,
push, paid model calls, upload or release. Existing upgrade and design WIP remains
intact. HEAD 5b0bfac4853168560e7c049368a8f6e1c74393d5, dirty.
No new dependencies, native rewrite, schema/protocol semantic changes or budgets.

## Evidence and decisions

Previous packaged report: artifacts/performance/dependency-upgrade-2026-09-20/after-sdk-electron.json.
Bundle module profile: artifacts/performance/renderer-module-profile.json.
Protocol monolithic output keeps unused schema initialization in the Welcome
import graph. Trial preserve-module output with an explicit side-effect-free
package contract; protocol source initializes constants/schemas without global
registrations. The renderer still validates all actual protocol messages.
Trial a lazy NewSessionIntentSurface, rendered only for a new intent.

## Checkpoints

- [x] Read current resource graph and prior measurements.
- [x] Validate smaller Welcome bundle and lifecycle regressions.
- [x] Same-host ten-sample packaged measurements (PARTIAL budgets).
- [x] Relevant gates and final macOS preview (follow-up below; intermittent failure history retained).

## Rollback and risks

Revert only this task's package metadata/loading changes if measurements or
behavior regress; preserve existing dirty upgrades. Splitting can move bytes
rather than remove them, so compare stage totals and first-use latency.
Windows and real Provider performance remain unverified.

## 2026-09-21 measured checkpoint

Protocol output preserves module boundaries with sideEffects=false. Lightweight
message IDs and protocol context types/constants now live outside schema modules.
The actual AgentPortClient loads only on an admitted handoff; pending Port
ownership closes superseded/disposed ports and reports load failures. Four new
regressions cover invalid handoff, delayed readiness, replacement, disposal and
failed-load retry. Public protocol schemas/revision semantics remain unchanged.

NewSessionIntentBoundary defers the intent surface until the selected provisional
draft is no longer in a Session transition. New production-browser regression
checks no initial request, then explicit New loads the form and editable Composer.
DESIGN.md records the central loading state; existing navigation is preserved.

Final ten-sample packaged p95: Welcome assets 0.596 MiB (budget 0.60), Welcome
working set 347.328 MiB (350), initialization assets 0.486 MiB (0.40, FAIL).
Previous values: 0.753 / 356.563 / 0.500. Connection separately loads 0.135 MiB;
this is deferred work rather than eliminated code. The reporter now exposes it.
No budget was changed. Evidence: artifacts/performance/startup-comparison.md,
startup-electron-final.json, startup-source-identity.json.

Standard preview built the app/DMG/ZIP but failed the composite synthetic memory
settings scenario, so normal preview and candidate identity generation did not
run. Isolated memory settings passed. Composite repeated failure: save-button
click times out; an earlier finally-close timeout masked the primary error. Test
cleanup now preserves the primary error and aggregates a simultaneous close error.
The earlier dependency-upgrade report recorded this composite/isolated difference
as well. Root cause is not proven. Re-reading the completed redacted probe log
confirmed `encrypt:start` and `encrypt:end`: the observed encryption call returned.
The earlier claim that no usable stage observation existed was incorrect. Next
trace persistence, IPC completion and renderer/click response after encryption;
do not infer a blocked encryption call from SecurityAgent presence alone.
SecurityAgent was running; Computer Use explicitly
refused access to this safety-sensitive application. No security setting was
changed, no dialog accepted, no credential revealed. Stop repeating the composite
path until a new hypothesis or operator-visible evidence can resolve it.

Remaining: initialization asset budget requires further reduction; composite
native memory-save blocker needs separate root-cause evidence. Windows, paid
Provider calls, physical IME and release remain unverified. No commit/push/upload.
Final validation completed: `check:source` exited 0, with 871 test files and
5,692 tests passing (9 files / 24 tests skipped). Production Renderer E2E passed
235 tests (1 skipped); native Electron E2E passed all 7 tests. `git diff --check`
passed. Logs: `artifacts/performance/startup-final-check-source.log`,
`startup-final-renderer-e2e.log`, and `startup-native-e2e.log`. These passing
checks do not override the remaining asset-budget failure or packaged-preview
blocker above.

## Memory-save follow-up

An isolated diagnostic wrapper traced only fixed encryption/filesystem stage
markers, with no arguments, credential values or returned bodies. The first
wrapper failed to initialize because Electron evaluate has no dynamic-import
callback; switching the diagnostic to `process.getBuiltinModule` corrected the
probe, without changing product code. The complete composite smoke then passed.
Observed encryption returned; subsequent directory creation, write, file sync,
rename and directory sync completed in about 32 ms by parent receipt timestamps.
This is one diagnostic observation, not a latency budget or root-cause proof.

The uninstrumented `preview:mac:unsigned` then exited 0: encrypted save, key
conceal/reveal, cold readback, private activation and complete packaged smoke
passed; archive verification and candidate identity generation completed, and
the latest repository app opened. Source remains dirty at the HEAD above. ASAR
SHA-256: `3d9314450baa7b9b6be38e93b8c32dcda62a6a4871b99c3bd3e546813c98a081`.
Evidence: `artifacts/performance/memory-save-followup.json`,
`memory-save-stage-trace-2.log`, `memory-save-standard-preview.log`, and
`artifacts/release/macos-preview-candidate-identity.json`.

No product-code fix for the intermittent timeout is claimed. No system security
dialog was operated, permission changed, timeout increased or assertion skipped.
The current preview gate is clear; prior failures remain unresolved history.
Next implementation target remains initialization assets (0.486 MiB vs 0.40).

## Rejected Inspector loading experiment

Current build profiling identified a statically imported ContextPane, including
Files/Tabs dependencies, even when responsive layout keeps the Inspector closed.
The trial ContextPaneBoundary owned the stable aside and loaded content only when visible.
Loading and module failures stayed inside that track; the shared lazy boundary added
an inline panel kind without changing workspace or overlay behavior. Existing
React Aria tabs and selection primitives were unchanged. No dependency was added.

Do not confuse this with a guaranteed wide-screen budget win: the default visible
Inspector must still load normally. The `animation` chunk is primarily React Aria
press/focus/overlay-positioning code, not optional decorative animation. Measure
final packaged bytes before making a budget claim.

Validation checkpoint: initial loading/keyboard/failure regression passed 4 tests;
Renderer full suite passed 237 with 1 skipped; native Electron passed 7; the first
new preview passed. A follow-up confined the error state to the Inspector aside
and added delayed-module feedback coverage; final targeted validation and preview
must use that final source. Initial full Renderer bootstrap collided with a
concurrent package build (missing domain dist); this was corrected by running
after build completion. Initial source check passed 5,691 tests but one unmodified
Host crash-recovery test missed its operation.lost wait; isolated rerun passed.
The complete source gate is being rerun without competing builds/test suites.
Keep those failures as evidence; do not label them product root causes or erase
them through an unreported retry.

Final source rerun passed 871 files / 5,692 tests (9 files / 24 tests skipped).
Final boundary/Inspector E2E passed 20 tests, including delayed module feedback.
The standard preview passed and opened its new artifact. However, ten packaged
samples rejected the optimization: initialization assets rose from 0.486 to
0.491 MiB against the unchanged 0.40 budget. The visible default Inspector still
had to load, while the extra boundary/chunk added cost. Welcome assets stayed
0.596 MiB; this run's Welcome working set p95 was 355.594 MiB (>350) and command
palette first-open p95 424.6 ms (>400). Those latter differences do not establish
causation; preserve the failures and compare the restored baseline.

The complete Inspector UI experiment and its specific tests/design prose were
reverted, preserving the preceding upgrade/loading work. The only retained code
change from this continuation strengthens the measurement boundary: a visible
Inspector must expose its Files tab before initialization ends; a closed one is
not awaited. Three regression tests cover waiting, closed panels, and explicit
failure rather than an understated successful sample; together with resource
attribution regressions, 7 tests pass. Measurement lint and structure pass.
Evidence: `artifacts/performance/inspector-electron-final.json`,
`inspector-final-boundaries.log`, `inspector-check-source-final.log`,
`inspector-measurement-tests.log`. The restored app is being rebuilt through the
standard preview, then will receive a same-host stability comparison.

Restored baseline validation completed: standard preview exited 0, encrypted
memory settings/cold readback and full packaged smoke passed, archives/identity
were verified and the repository app opened. ASAR SHA-256 is identical to the
pre-experiment artifact (`3d9314450baa7b9b6be38e93b8c32dcda62a6a4871b99c3bd3e546813c98a081`).
Ten restored samples: Welcome assets 0.596 MiB PASS; initialization assets
0.486 MiB FAIL; Welcome working set p95 355.813 MiB FAIL; command-palette first
open p95 329.8 ms PASS. Owned-memory p95 is 136.253 MiB versus earlier 136.081,
so the working-set difference alone does not prove a new application leak.
No budget was raised. The resource target remains unmet; this rejected trial
must not be described as a shipped performance improvement. Detailed comparison
and retained-file hashes: `artifacts/performance/inspector-experiment-comparison.md`
and `inspector-continuation-receipt.json`. No further product code change was
made after the rollback build; final retained tooling checks pass.

## Welcome memory attribution checkpoint

Compared the two existing ten-launch packaged batches without rerunning builds or
changing product code. Main RSS p95 is 210.734 -> 218.844 MiB; renderer RSS p95
is 136.938 -> 137.016 MiB. Only restored launches 1 and 3 exceed the total
350 MiB budget. Main effective footprint p95 is 91.533 -> 91.408 MiB. The RSS
tail is localized to Main, but its native category and cause remain UNVERIFIED.
Independent percentile changes are not additive. With ten observations the
existing nearest-rank p95 is the maximum; retain the failed gate.

Verified serialized component sums and percentile calculations for both reports.
RSS is sampled before footprint, and these use different accounting; their
difference must not be presented as shared memory. Fresh-launch samples also
cannot establish a sustained-session leak. Welcome sampling precedes the
Inspector readiness guard. No further React split is justified by these data.
Evidence: `artifacts/performance/welcome-memory-attribution.md`, including input
SHA-256 hashes and all ten restored samples. Next diagnostic: Main native memory
categories on owned clean-profile launches, separately from acceptance sampling.
Initialization assets remain 0.486 MiB against 0.40; that work is still open.

## Main native-memory diagnostic checkpoint

Ten owned clean-profile launches on the unchanged ASAR completed. Main RSS
208.563–211.828 MiB did not reproduce the earlier ~219 MiB state. Effective
footprint was 89.080–92.189 MiB; post-probe JS heap used 15.112–15.185 MiB.
footprint category evidence is retained, but vmmap warned that Electron's
PartitionAlloc malloc zone could not be examined. Do not claim complete native
allocator attribution, a fixed leak, or a newly passed acceptance gate. All ten
owned Main PIDs exited and temporary profiles were removed. No product change.
Evidence: `artifacts/performance/main-native-memory/analysis.md` and receipt.
Stop speculative memory edits; prioritize the reproducible initialization asset
excess using the current dependency graph, preserving the existing RSS failure.

## Current initialization dependency attribution

Regenerated a write:false Vite module profile and checked final emitted JS
SHA-256 against current dist; all 33 measured initialization resource sizes
match. The stage totals 510,102 bytes, requiring at least 90,672 bytes reduction
to reach 0.40 MiB. Dialog/animation/use-copy-feedback chunks contain shared
React Aria menu, focus, positioning and selection machinery; their names do not
identify removable modal/animation/clipboard-only costs. Current callers use
these behaviors. No speculative dependency removal or budget change adopted.
Evidence: `artifacts/performance/current-initialization-attribution.md`. A narrow
possible follow-up is the shared Composer's active/intent control imports, but
its savings and interaction behavior remain unverified; do not claim the target
is achievable from that split. Product source and packaged artifact unchanged.

## Rejected Composer intent-controls split

A write:false Vite transform tested React.lazy for ComposerIntentRuntimeControls
without editing product source. Final emitted initialization JS fell from
451,975 to 446,720 bytes (-5,255), while first intent-control use added 6,196
bytes; combined and all-JS output increased 941 bytes. Welcome JS was unchanged.
Baseline closure exactly matched all 30 measured initialization JS resources;
baseline emitted hashes matched unchanged dist. Reject this small deferral and
extra loading/error lifecycle rather than ship an unverified gain. No runtime
claim, product change, rebuild, or new acceptance PASS. Evidence:
`artifacts/performance/composer-split-comparison.md` and JSON receipt.
The bounded Composer hypothesis is closed; initialization and RSS budgets remain
PARTIAL. Do not repeat Inspector or Composer splitting without new evidence.

## Local functional acceptance closeout

Restored-source native Electron E2E passed 7/7 (53.5s); production Renderer
Chromium targeted tests passed 26/26 (36.5s), serially, no retries. Session
identity/restart, controlled shutdown, model keyboard selection, IME, draft and
attachment preservation, projected streaming and operation/Host recovery are
covered. Current ASAR hash still matches the restored packaged smoke, allowing
reuse of its cold restore, 500-line code, bounded JSONL projection and recovery
evidence. No new product change or paid Provider call. Detailed scope, exclusions
and change disposition: `artifacts/performance/upgrade-local-acceptance.md`.
Local functional follow-up is complete; initialization/RSS performance failures,
real Provider and Windows certification remain explicitly open.

## Local commit boundary extension

The user's continuation after the explicit scoped-commit recommendation extends
the original local-only delivery boundary to one scoped local commit. Push,
remote CI, upload, release and paid Provider calls remain unauthorized. Stage
only the upgrade, compatibility, accepted startup changes, corresponding tests
and authority clauses. Preserve design-preview, design-reference/governance WIP
and the pre-existing attachment test change. The latest local functional
follow-up passed 7 native and 26 Renderer checks; performance and Windows/real
Provider limitations remain open. Validation was performed in the dirty local
checkout, not an isolated exact-commit candidate.
