# Local packaged Pi acceptance

Status: completed for local automated acceptance; native observation unverified
Owner: Codex
Started: 2026-10-05

## Goal and delivery boundary

User selected packaged-client acceptance after CI passed. Rebuild the current local
macOS arm64 preview, bind artifact bytes to the observed worktree snapshot, and
verify Pi startup/native MCP, Codemode, Auto and interrupted-task recovery using
isolated synthetic fixtures. No paid model, canonical Profile mutation, commit,
push, upload, release or new worktree is included in this step.

### Authorized source delivery followup

On 2026-10-05 the user explicitly authorized scoped commits for the reviewed
native-image changes and this acceptance/Knip correction, pushing them with the
existing `dc22b92e` runtime-retirement commit to `main`, following the new SHA's
Windows/macOS CI, and rebuilding/verifying its local macOS package. This extends
the original local-only boundary for source delivery; it does not authorize
artifact publication, paid Provider calls or destructive real-Profile acceptance.
Use the same isolated launch boundary for the new local package.

The independent delivery review found no blocker in native-image permissions,
SDK integration or the runtime-retirement lifecycle. Fresh source/ASAR parity
confirmed no production change since local acceptance. Reuse that source evidence;
new CI and clean-package receipts must bind the committed SHA and new bytes.
Record this followup in ignored `artifacts/validation/pi-source-delivery-20261005/`.

### Windows cleanup followup

Source delivery `ce6c365dd856492cf653ae9b1c3a5e0a0297f694` reached CI run
`37230911558`, attempt 1. Source (6,343 passing tests), Renderer and macOS passed.
Windows `app-after-tool` completed all recovery assertions but failed final cleanup;
the other two recovery scenarios and synthetic scale checks passed. The receipt
reported only `Owned test processes remain`, after every individual exit wait had
already succeeded. The first failed receipt is retained; there was no blind rerun.

Independent review confirmed the verifier re-queried all old bare PIDs after
observing their exit. A reused PID or failed final CIM query could invalidate that
observation and erase the actual query error. The retained evidence does not
distinguish those triggers or prove a product process leak. Keep confirmed exits
terminal, reject identity drift/query failure before exit, continue cleanup after
an individual failure, and retain bounded per-process results. Product runtime,
timeouts and acceptance assertions stay unchanged. The focused process/workflow
regressions pass (52 tests), including the independently reviewed deadline-before-
query boundary; new-SHA target-platform validation is still required.

## Observed starting state

- HEAD/origin main: `0340c55157d5a35b206e418184f7bc08510abab5`; code CI at
  `10d15177` and documentation CI passed.
- Existing native-image and local-memory-retirement WIP is preserved and included
  only as part of this local worktree preview, never an immutable distribution candidate.
- Old preview identity/smoke records describe `b35de808` with dirty source. The actual
  ASAR size/hash no longer matches them. Actual old package source is unverified;
  do not infer it from the stale receipt or rewrite provenance without rebuilding.

## Acceptance and execution

- Freeze HEAD, dirty path/content digest and source diff digest before validation;
  compare again after build/testing. A source change invalidates source binding.
- Run the relevant source gate, rebuild unsigned app/DMG/ZIP, run packaged smoke,
  then verify containers and regenerate app/archive identity and smoke receipts.
- Run the existing offline packaged Codemode execution/cold-restore fixture and
  the three bounded synthetic Auto/recovery scenarios. No blind retries.
- Check synthetic normal and delayed first-Prompt activation on the actual packaged app.
- Observe an isolated real native window if Computer Use supports it; distinguish
  automated runtime evidence from native visual observation.
- Record bytes, source dirty state, tests, cleanup and remaining limits. Keep exact-SHA
  Windows CI evidence separate from the new local dirty macOS build.

## Rollback and protection

No production-source edits are planned. Existing tracked/untracked work is protected.
Only rebuildable ignored local archives and owned temporary fixtures may be replaced
or cleaned by their existing lifecycle helpers. Do not open the canonical Profile,
copy credentials or retire installed user runtimes. On failure retain its first
receipt; do not represent stale receipts as evidence for new bytes.

## Source transition during preflight

A concurrent task committed runtime retirement as `dc22b92e` and temporarily stashed,
then restored the native-image WIP. No stash operation or commit was performed by
this acceptance task. Freeze the current state again before retrying validation.
The first source check failed at dead-code detection: the newly committed manual
`probe-packaged-runtime-retirement.mjs` lacked a Knip entry. Add its exact path to
the existing manual probe entry list; do not suppress other files or weaken checks.
The prior attempted snapshot and failure log are retained. No packaging ran after
that failed prerequisite. This one-line tooling correction is local, uncommitted.

## Acceptance results

- Frozen snapshot: HEAD `dc22b92eb60415cfe37324aef80a06c5b4c1adf8`, 15 dirty
  source/document paths, recorded before validation and unchanged through all tests.
  Final edits to this plan are closeout documentation only, after that comparison.
- Complete source gate passed: 952 files / 6,343 tests, 9 files / 24 tests skipped;
  branch coverage 78.81%. The exact manual probe Knip entry fixed the initial gate
  failure without ignoring other files. No production implementation was edited.
- Rebuilt macOS arm64 `0.1.0-alpha.43`, Pi coding-agent `1.0.0`. Packaged smoke
  passed, including native MCP synthetic AUTO echo, exact Session creation, cold
  restoration, sandbox checks and graceful active-prompt shutdown (619.4 ms).
- DMG/ZIP container checks and executable/ASAR/DMG/ZIP/smoke-receipt hashes passed.
  New identity/smoke records replace the stale local metadata. ASAR: 195,179,733
  bytes, SHA-256 `8626a0c354419f6a5a2b60d754fbb2ec71fd14ceb55afe3ab27086a5099357e7`.
- Codemode executed its real native worker with a nested read; live parent/child
  identity, JSONL result and cold-restored nested tool card passed. No full output
  path was persisted. Its isolated application and Profile were cleaned.
- Delaying synthetic initialization by 2 s passed first-Prompt activation at
  1.25/1.5/2 scale on the actual packaged app.
- All three Auto/recovery scenarios passed against the identical ASAR: one judge
  decision, stable selected model, same Session, safe explicit continuation, and
  blocked continuation for an unconfirmed tool outcome. Real model requests = 0;
  canonical Session metadata stayed unchanged and owned fixtures/processes cleaned.
- An isolated native Electron window reached ready with `Auto · 自动选择`; its
  renderer screenshot was inspected. Computer Use failed native pipe startup twice,
  including one session reset. Native accessibility/desktop observation is UNVERIFIED,
  not a product runtime failure. The owned window exited and its fixture was removed.
- This is local worktree evidence with source clean=false, not a distributable clean
  candidate or fresh Windows certification. No paid Provider, canonical Profile
  launch, install into Applications, commit/push, publication or official Pi Durable
  harness integration occurred. Task recovery remains the existing Desktop mechanism.
- Primary receipt: `artifacts/validation/packaged-pi-20261005/receipt.json`.
  Source snapshots, gate/build/smoke logs, feature receipt index, copied identities
  and the isolated renderer screenshot are retained in the same ignored directory.
