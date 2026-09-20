# Private archive feedback and recall latency

Status: active
Owner: Codex
Started: 2026-09-19
Last updated: 2026-09-20

## Goal

Make manual archive feedback distinguish acceptance, retention/no eligible
messages, confirmed extraction, and unconfirmed/failed extraction. Locate the
recall latency boundary without changing providers or retrieval policy.

## Non-goals and delivery boundary

Local implementation, tests and unsigned macOS preview only. No commit, push,
deployment, signing, database changes, deletion or automatic Commit retries.
Preserve all existing WIP and private data. Do not edit the installed signed
OpenViking runtime or generated upstream recall implementation.
Later explicit authorizations are recorded in dated checkpoints below; the
2026-09-20 exceptions permit signing one local runtime candidate and importing it
into an isolated test Profile, followed by a separately authorized daily private
runtime switch and idle restart with the previous runtime retained for rollback.
Neither exception authorizes publishing or paid model requests.

## Initial evidence (before implementation)

- The preceding synthetic private-memory acceptance succeeded, including a fresh
  Session recall. Its single prompt-ready sample took 4281 ms, not a p95 pass.
- The renderer ignores Commit terminal events and always announces acceptance.
- The owner drops skip reasons; the Host emits the same completion event for
  accepted and skipped results. Acceptance alone is not extraction evidence.

## Decisions and affected boundaries

- Observe only the exact task returned by the current admitted owner. Bounded
  observation uses that owner's connection and lineage; no legacy gateway poll.
- Preserve the recent-turn retention policy. No forced archive or implicit retry.
- Cross-process results contain fixed states only, never credentials, bodies,
  internal URIs or raw server errors. Missing terminal evidence stays unconfirmed.
- Affected: admitted extension, Pi bridge, Host event, renderer archive feedback.
  Existing DESIGN.md/DESIGN.dark.md remain authority (L1-F, Design Craft,
  main-serial); no layout/token redesign.

## Acceptance and checkpoints

- [x] Skip reasons and bounded task outcomes survive the owner/Host boundary.
- [x] UI correlates the exact operation, handles early events and stale Sessions,
  and never labels an accepted or unknown task completed.
- [x] Targeted regressions, protocol revision, aggregate source gates pass.
- [x] Unsigned macOS preview and rendered state checks are recorded separately.
- [x] Recall evidence identifies measured boundaries or explicitly retains the
  missing stage attribution; no speculative performance claim.
- [x] Fresh native archive feedback and recall request-timing sample, supplied by
  the user's manual test and verified against exact Session metadata.
- [x] Inspector refresh after turn/archive/reconnection, stale-generation guards
  and correct message-count wording; no polling/model requests.
- [x] Refresh change packaged and smoke-tested in a new unsigned preview; real
  turn-driven native refresh still needs observation because UI control is blocked.
  Server-internal latency attribution remains a separate pending measurement.

## Validation and rollback

Use affected Vitest suites, typecheck, protocol generation and `pnpm run check`;
then `pnpm run preview:mac:unsigned`. Rendered light/dark feedback coverage is
separate from source proof. Windows remains unverified. Roll back only these
task hunks; do not reset overlapping WIP or touch the private memory tree.

## Validation evidence

- Targeted source tests: 76 passed. Full `pnpm run check`: 5602 passed,
  23 skipped; exit 0 (`/tmp/newmoney-archive-check2.log`). A subsequent notice
  style change passed renderer typecheck and repository lint.
- Packaging closure regression: 14 passed. The new owner helper is included in
  the allowlisted prepared runtime; lock tree `200f2c85...1fb7f6c8` matches source.
- Protocol revision: `685d5ff153ee2d793447efd96031014e6266eb61d4820eec36f9246008c47430`.
- Renderer production-build E2E: bootstrap and archive feedback route passed,
  covering pending/retained/empty/completed/failed/unconfirmed and keyboard focus.
  An initial fixture sent a workspace-only event as task-scoped; the protocol
  rejected it. Corrected the fixture scope, without weakening validation.
- Design Craft lightweight consistency: PASS for changed inline notice, compared
  with the existing Experience notice family. Both theme captures reviewed:
  `artifacts/visual-review/memory-archive-feedback-{dark,light}.png`, 333x852.
  The status now uses the shared notice treatment rather than metric footnote text.
- Recall numeric request timings added without generated-core changes, provider
  changes, payload logging or retrieval-policy changes. Historical 4281 ms has no
  stage breakdown; a fresh measured sample is required for attribution.
- Unsigned macOS preview: exit 0, packaged Electron smoke passed; artifact opened
  as PID 69741. `app.asar`: 200642162 bytes,
  SHA-256 `b8c4653304b5bafee2c51b142aa8e835e81f28bb2b81761697d55f2e58caa633`.
  Dirty source checkout at HEAD `0b2f295`; this is not an exact-commit release.
- Native screenshot showed the existing synthetic conversation's closed-session
  landing state. AX exposed only window containers and coordinate click failed
  `noWindowsAvailable`; runtime reset and exact app-ID resolution did not recover
  controls. Do not infer a product rendering failure from this automation gap.
  No new Commit or model request was submitted, no duplicate action attempted.
- Fresh user native evidence: short-session archive displayed the retained-message
  outcome. A new private Session answered the known synthetic weekly-report
  structure; its JSONL contains one user/assistant pair, no parent and no tools.
  Exact owner metadata has 2 captured messages and 74 pending tokens; the UI's
  zero counters were stale, not missing capture. Recall ledger matches both
  synthetic memories. One new prompt-ready observation: 6967 ms total, 6965 ms
  context HTTP request, one request. No body/credential retained in this plan.
- Installed 0.4.16 source inspection: context assembly supports optional telemetry
  summaries, but the current client does not request/preserve them. The assembly
  pipeline has query expansion, candidate gathering, content prefetch and optional
  rewriting; historical timings cannot be retroactively split across those stages.
  No installed signed-runtime edits or provider/retrieval-policy changes. Internal
  stage attribution and p95 target remain UNVERIFIED.

## Inspector refresh follow-up (2026-09-19)

- Added current Workspace/Session/generation event filtering, serialized/coalesced
  reads and stale-result rejection after teardown, replacement or a newer boundary.
  Settled/compacted/rolled-back conversations and matching Commit/recall outcomes
  refresh diagnostics. Reconnection resumes reads; no polling, model invocation,
  private content search or automatic Commit. Archive feedback survives refresh.
- Renamed `Captured Turns` to `已捕获消息数`, preserving the existing protocol field.
  Updated PRODUCT/DESIGN together. Design Craft L1-F/main-serial; existing design
  authority and components retained, no new visual tokens or redesign.
- Targeted refresh + archive tests: 10 passed; workspace typecheck, lint, build and
  diff whitespace checks passed. Renderer bootstrap/settings/inspector E2E: 4
  passed, then expanded inspector/metrics and bootstrap: 2 passed. Both themes
  visually reviewed at `artifacts/visual-review/memory-inspector-refresh-{dark,light}.png`.
- First full default-concurrency check: 5606 passed, 23 skipped, one failure in
  unchanged `host-server-session-catalog.test.ts` waiting for a response. Preserved
  `/tmp/newmoney-memory-refresh-check.log`; exact suite rerun: 2 passed. Full
  fixed-two-worker `check:source`: exit 0, 5607 passed / 23 skipped, coverage gates
  passed (`/tmp/newmoney-memory-refresh-check-source.log`). The first failure
  remains recorded; no unrelated test or production implementation was weakened.
- New unsigned preview: packaged smoke and cold-process memory settings passed;
  app reopened PID 19776. `app.asar`: 200643364 bytes, SHA-256
  `4f9f3ef099874368e736c5f0e56a0cf78f42c9543735ce139a5448dead53ac6e`.
  Normal-profile native screenshot confirms the synthetic recall conversation is
  restored. CUA shows only window AX containers; clicking Context still fails
  `noWindowsAvailable`. No additional prompt/Commit sent. Turn-driven native
  refresh, Windows and internal-stage latency remain unverified.

## Server summary timing follow-up (2026-09-19)

- Installed runtime source confirms `run_with_telemetry` already collects a
  summary independent of response selection. Requesting `summary: true` changes
  the response projection, not tracing configuration or model/retrieval policy.
- The managed canonical context request now asks for that summary. Client projects
  only successful `search.context` timing: total, target abstract, intent analysis,
  query embedding and vector retrieval when reported. Finite numeric durations
  are bounded to 600000 ms; missing/invalid stages stay absent. No raw telemetry,
  ID, token details, errors, paths or content enters the new diagnostic fields.
- Current uncancelled recall owns the timing. New prompt, Session replacement and
  cancellation invalidate the sample. No extra request or fallback added. Stage
  durations may overlap/aggregate parallel work and must not be summed as phases.
- New helper is in the prepared capability allowlist; internal source tree lock
  updated to `02bae8f9...18eeec67`. Signed native runtime remains untouched.
- Targeted parser/client/recall tests: 14 passed; extension typecheck passed.
  Prepared capability/source-lock suites: 16 passed. Initial full gate caught a
  test-only broad BodyInit string conversion; corrected with explicit narrowing,
  retaining lint strictness. Full `check:source` then passed: 5612 passed, 23
  skipped, coverage gates passed (`/tmp/newmoney-server-timing-check-source2.log`).
- Unsigned macOS preview packaged/smoked/opened successfully, PID 6011
  (`/tmp/newmoney-server-timing-preview.log`). No application-asar source changed;
  its hash remains `4f9f3ef0...dead53ac6e`. The changed capability is an external
  packaged resource: `recall-timing.ts` source/prepared/app copies all have SHA-256
  `974525636e74626b8e8948b374d341a0628e64cfc683f3c311e48f50eadb6e09`;
  packaged `recall.ts` also exactly matches source. Do not use unchanged asar alone
  as proof of unchanged capability behavior.
- Read-only metadata check after packaging: latest normal-profile recall is still
  2026-09-19T14:01:10.574Z, before this build; no server timing exists in that old
  sample. A fresh live server-summary sample, real stage attribution and Windows
  remain UNVERIFIED. No model request or repeated Commit was sent this turn.

## Request-scoped embedding experiment (2026-09-19)

User accepted isolated comparison, not signing/replacement or production activation.
Keep the prototype and probe outside native preparation and packaged capabilities.
Use the installed interpreter/library read-only with bytecode writes disabled,
fresh temporary home/cwd, no inherited provider configuration, outbound network
restricted to one synthetic loopback HTTP service, and runtime-tree parity checks.
Actual OpenViking candidate gathering and embedding HTTP client are exercised;
vector-store candidates are synthetic fixtures. This is not full database/ranking
or end-to-end recall-quality proof. No real model or user data is used.

Acceptance: count baseline vs coalesced HTTP requests; preserve candidate order,
scope, score and content under deterministic vectors; keep identity/model/input
and request lifetimes separate; handle failures, cancelled consumers, closing and
capacity without silent retry or result aliasing. Compare unconstrained and
concurrency-limited simulated service latency, never claim these timings as real
provider improvement. Rollback is deletion of these new test-only files; installed
runtime, data and production preparation remain untouched.

### Experiment evidence

- PASS on macOS arm64 with the installed 0.4.16 interpreter/library. Reproduce:
  `node eng/capabilities/probe-query-embedding-coalescing.mjs /absolute/installation`.
  The installation is an explicit input; this command does not discover user
  model configuration, load credentials, sign, install or modify its source.
- The fixture exercises actual `gather_candidates` and `OpenAIDenseEmbedder` HTTP
  calls for four memory categories and two actor-scoped target directories. It
  supplies deterministic vector-store hits, not a live database. Each baseline
  made 8 HTTP requests; each coalesced request made 1, preserving all 8 candidates'
  content, identity, order and scores. Ten paired comparisons passed after one
  client warmup, with alternating before/after order and a non-restrictive HTTP
  accept backlog. Each synthetic provider request sleeps 50 ms deliberately.
- Five pairs with 32 simulated provider slots: median 66 -> 58 ms. Five pairs
  with 2 slots: median 231 -> 60 ms. These are controlled fixture timings, not
  real-provider latency or p95 certification. Reduction in redundant calls is
  proven for this fan-out; actual quality/cost/performance gains remain unverified.
- Safety checks passed: exact identity/model/input separation, fresh-request
  separation including concurrent scopes, independent result copies, bounded
  capacity, shared failure without retry, one-consumer cancellation, and scope
  shutdown cancelling pending work. Prototype is not wired into production.
- Network allowed only the one loopback fixture; zero attempted off-fixture
  connections observed. Installed runtime tree before/after is identical:
  `a984af4abf5e5185b000b25437cd708b7a73081a12363f1dc76d64df9d6d4f58`.
  Test-only files are absent from explicit native/capability preparation inputs.
- Repository lint, structure gate and `git diff --check` passed. No application
  changes, preview relaunch, signing, replacement, commit or push this step.
- Initial fixture failures were corrected without relaxing checks: canonicalized
  macOS temporary-directory paths; aligned synthetic input validation with the
  actual client's single-string request body. An initial un-warmed result was
  superseded by the controlled paired run above, not used as a speedup claim.
- Report: `/tmp/newmoney-embedding-coalescing-probe-final.log`, SHA-256
  `c6d1ae68ff4f93110cb4a7857c109159c5c1241fa68ae24cfa3a878f5ebb76e6`.
  Source identities: batch `f1ede548...7724512c`, probe `3db77457...b052ddd`,
  runner `7eaab848...c38bf0c9`; dirty checkout HEAD remains `0b2f295`.
- Next boundary: a pinned, independently validated build-time integration and full
  database/context-assembly regression before any separately authorized signing
  or replacement. The actual 3.312-second sample has not been rerun with this
  optimization, and the normal installation remains unchanged.

## Pinned build integration and native context regression

User accepted the next bounded step: maintainable build-time integration plus real
local database/context assembly validation. No production signing, replacement,
paid-model request, user/private data access, deployment, commit or push. All
runtime patching is confined to a fresh temporary copy or explicit preparation
staging. Existing dirty work and the installed runtime remain untouched.

Implementation: new opt-in `private-query-coalescing-v1` purpose preserves old
defaults. Pinned gather/retriever edits use a separate ContextVar-scoped helper;
only concrete OpenAI-compatible text embeddings are eligible. Keys include
account/user/actor/role/OAuth state, embedder object, effective request/transport
configuration and exact query. No cross-operation state, retrieval shortcuts,
provider fallback or extra retry. Capacity/unsupported inputs preserve upstream
behavior. Scope cleanup and independent results are regression-tested.

Validation: real HTTP context assembly against synthetic content in
native AGFS/vector storage, baseline then patched cold restart; exact assembled
content comparison, model request counts, fresh/concurrent scopes and account/auth
boundaries. The isolated test receipt must identify both trees and original-tree
parity. These probes do not establish semantic accuracy or packaged activation.

Rollback: leave the option unused; old build purpose and installed runtime are
unchanged. Failed/successful temporary copies are not installable signed artifacts.

### Native context evidence

- PASS: source/dependency/RECORD drift, duplicate RECORD entry, linked source and
  repeated application are rejected; ordinary invalid input/receipt unit tests
  and unchanged preparation defaults pass (13 Vitest tests). Six isolated Python
  tests cover exact identity/model/input separation, fresh and concurrent scopes,
  independent result copies, unsupported-input and capacity bypass, shared failure
  without extra retry, waiter cancellation and scope cleanup.
- PASS: actual local OpenViking HTTP context assembly + AGFS/vector index, seeded
  through `content/write` with synthetic content and deterministic vectors.
  The same context request uses 10 embedding HTTP calls before, 1 after. Two
  returned entries, complete rendered content, URIs, order and scores match;
  repeated requests each make a fresh single call, concurrent requests make two,
  another account sees no entries, invalid credentials return 401, and indexed
  content survives the patch/cold restart. This does not exercise real-model
  semantic ranking or prove learning/extraction quality.
- Runtime tree unchanged at the user installation: `a984af4a...6d4f58`.
  Patched isolated tree `081a2ab21ddb5f1ed4dcb32ddd1bc0748cad3aac044427921f385e5e612ef933`.
  Report `/tmp/newmoney-query-native-probe2.log`; fixture receipt:
  `/private/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/newmoney-query-native-kChPvb/receipt.json`.
  Raw 49 ms baseline / 312 ms patched measurements are NOT comparable: baseline
  follows index warmup, patched is the first cold-start request. They are not a
  speedup or regression claim; this acceptance establishes call reduction and
  result preservation only. The runner now explicitly labels this limitation.
- First fixture run stopped at a test bug: it changed the embedder's internal
  `_dimension`, not the actual output `dimension` field. Corrected the fixture
  to mutate the actual configuration; retained the exact call-count assertion.
- No UI/app build or relaunch: this is an opt-in build recipe, not installed
  product behavior. Signing, full prepared-runtime/packaged acceptance, real-model
  latency and Windows remain separate, unverified steps.

### Final checkpoint

- Final helper additionally keys input-token truncation and retry/concurrency/
  backend configuration; eight Python tests now include nested scopes and bounded
  failure when a provider does not cooperate with cancellation. Native comparison
  rerun with this exact helper PASS: still 10 -> 1 HTTP calls, identical two-entry
  assembly hash `cd0d21f4...5ac074b`, fresh/concurrent scope and auth checks unchanged.
  Final helper SHA-256 `c4710e096b0021bd3a9fc02e1361d6f899c5a20a5c9caa76384c245a0a99cb22`;
  final isolated runtime tree `c7e01954847a28d06e54b20675d6edca40e00458312d653ec698817ad82fc5a7`.
  This supersedes the previous isolated tree for further acceptance.
- Final report `/tmp/newmoney-query-native-probe3.log`; canonical receipt
  `/private/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/newmoney-query-native-RSdImh/receipt.json`.
  Final raw timings 37 / 334 ms remain explicitly non-comparable warm/cold
  observations, not a performance result. Original installed tree unchanged.
  Independent readback verified exact hashes/lengths and single RECORD entries
  for both changed upstream files and the new helper.
- `corepack pnpm run check:source` PASS: 864 test files, 5,614 tests passed;
  9 files / 23 tests conditionally skipped. Log
  `/tmp/newmoney-query-patch-check-source2.log`. Initial dead-code gate failure
  resolved by registering the two real opt-in probe commands in package scripts,
  not by excluding the new files from analysis. Changed runner also passes final
  targeted type-aware lint; `git diff --check` PASS.
- HEAD remains `0b2f295`, main ahead 3, pre-existing dirty changes preserved.
  No commit/push/signing/install/relaunch or VPS operations. Next bounded step:
  build a new prepared runtime and run isolated packaged admission/recall before
  any separately authorized change to the daily installation. Current test copy
  is unsigned and must not be offered as a consumer-installable runtime.

## Prepared runtime and packaged acceptance (2026-09-20)

User explicitly authorized the existing local signing key for this private-memory
candidate and an independent test Profile. No app-store/OS certificate work,
publication, upload, daily installation replacement, paid model or VPS operation.
The test may clean up its own successful disposable Profile; failed evidence is
retained. No automatic repeat of a failed packaged acceptance run.

- PASS: offline preparation from the existing standalone CPython 3.12.10 arm64
  using `--private-query-coalescing-v1 --offline`. Relocation/import, relative
  launchers, synthetic Ark SDK protocol and both native storage/isolation/restart/
  revocation probes passed. Eight helper lifecycle tests also passed against the
  newly prepared interpreter. Successful disposable preparation test runtime was
  removed by the existing retention contract; no previous artifact was retired.
- Prepared tree: `12d8c3c1044f9e6643759dae155c6be1362e660e7bf831a68b7b9230a5c821e6`,
  28,600 files / 444,303,068 bytes. Receipt:
  `artifacts/openviking-native/preparation-ReIglw/receipt.json`.
  This is a fresh locked-wheel preparation, including existing SDK pruning, not
  the earlier copy of the installed runtime. Do not transfer whole-tree claims
  from the earlier `c7e01954...` fixture; the query helper hash is unchanged.
- PASS: signed candidate tree equals the prepared tree; actual pinned trust
  anchor verification passed. Candidate:
  `artifacts/openviking-native/signed-local-installation-i5JCRX`.
  Manifest SHA-256 `4a905e1e8e077f1955e51a3fe7f0808d3c0e87b3283924874f1176fddb49cef7`.
  Signing log `/tmp/newmoney-query-signing.log`; no key bytes logged or copied.
- Packaged test PASS: exact existing repository app, asar
  `4f9f3ef099874368e736c5f0e56a0cf78f42c9543735ce139a5448dead53ac6e`;
  packaged `recall.ts`, `client.ts`, `recall-timing.ts` match current source.
  `PI67_PRIVATE_SESSION_TEST_INSTALLATION=<signed-local-installation-i5JCRX>
  corepack pnpm run verify:memory-session:packaged`.
  Log `/tmp/newmoney-query-packaged.log`. The app is not rebuilt this checkpoint:
  only the separately installed native runtime changed. Final claims must bind
  to this app plus the new exact runtime tree, not just Git HEAD.
- `PACKAGED_PRIVATE_SESSION_PASS` on macOS 27.0 / arm64. Verified actual Main /
  Agent Host / Pi execution, pinned-signature UI import, encrypted model settings,
  explicit activation and cold startup; capture persisted exactly once across a
  cold restart. Explicit UI archive produced a completed native archive with four
  memory steps, one preference extraction and one summary. Another cold startup
  and fresh Session sent the saved preference to the synthetic model without
  copying the old transcript. Deactivation stopped the local service, all test
  application instances closed, and the successful disposable Profile was cleaned.
- Synthetic model totals: agent 5, embedding 45, extraction 2, rejected 0. These
  totals span indexing, extraction, recovery and multiple Sessions; they are not
  the earlier single-query 10 -> 1 comparison. Three sends took 19,562 / 855 /
  9,421 ms, each below the existing 30-second acceptance deadline. These include
  startup and agent processing, not isolated recall p95 or real-model speed proof.
- Packaged log SHA-256
  `82993adc04ade9672c1bfc34d2de9dd1db81bf7db8de2c12cb99a0d2a67382f4`.
  Daily runtime post-test tree remains `a984af4a...6d4f58`, 54,346 files /
  641,302,721 bytes; private memory and model configuration were not accessed.
  Candidate post-test tree remains exactly `12d8c3c1...c821e6` (28,600 files /
  444,303,068 bytes), matching the prepared and signed identities.
- No application source changes this step; prior source gates remain applicable.
  Only this plan receives new evidence. Daily installation, minimum macOS 14,
  Windows and actual provider latency are still unverified/unmodified. Replacing
  the daily runtime and restarting the user's app requires separate authorization.

### Daily installation authorization checkpoint

- User explicitly authorized switching the daily private runtime and restarting
  after confirming no active task, preserving the previous runtime and private
  memory/model configuration. This does not authorize paid model requests.
- Preflight revalidates the exact signed candidate `signed-local-installation-i5JCRX`
  against the source-pinned trust anchor and tree `12d8c3c1...c821e6`.
- BLOCKED before mutation: Computer Use finds New Money running, but the native
  accessibility surface exposes only empty window containers, not task state.
  Do not infer idleness, inject a hidden debugger or force-quit. User asked to
  normally quit the app and report completion; then recheck app/sidecar processes.
- Installer correctly refuses an existing same-version destination. Once stopped,
  preserve the exact old private installation as a rollback copy outside the active
  installation path, then use the existing verified installer. On failure restore
  that old path before any relaunch. Team runtimes, data and configuration are not
  installation targets. No runtime was moved or installed at this checkpoint.

### Daily installation and restart completed (2026-09-20)

- User confirmed normal exit. Read-only process preflight found no New Money
  application or installed OpenViking executable process before mutation.
- PASS: verified the candidate and old installation against the pinned trust key
  and their full runtime trees, preserved the exact old installation by rename,
  then used the existing verified installer. Installed tree is
  `12d8c3c1044f9e6643759dae155c6be1362e660e7bf831a68b7b9230a5c821e6`;
  post-install verification of both new installation and old backup passed.
- Rollback installation retained at
  `/Users/gaoqian/Library/Application Support/New Money/openviking/runtime-backups/private-20260920-GrqNdQ/openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64`.
  Its tree remains `a984af4abf5e5185b000b25437cd708b7a73081a12363f1dc76d64df9d6d4f58`.
  Do not restore while the application or its memory service is running.
- Exact pre/post file fingerprints confirm unchanged profile identity, activation,
  encrypted model settings and Pi OpenViking configuration. The operator did not
  access memory contents, modify data or team runtimes, or invoke models.
  Installation receipt `/tmp/newmoney-query-daily-install-receipt.json` reports
  `INSTALLED_NOT_LAUNCHED` because it deliberately precedes the separate restart.
- PASS: opened the existing repository `artifacts/release/mac-arm64/New Money.app`;
  process PID 57901 and the native accessibility surface confirm the application
  is open at `app://pi67/index.html`. App asar remains the exact packaged-tested
  `4f9f3ef099874368e736c5f0e56a0cf78f42c9543735ce139a5448dead53ac6e`.
- Daily UI currently reports the conversation is not running and offers to open
  it; no installed memory process was observed. Source confirms memory starts on
  a broker connection, not merely on window creation. Do not label daily memory
  health or actual-provider recall latency PASS from this restart. No conversation
  was opened or message sent by this operation; paid-provider validation remains
  a user-triggered next step. Earlier isolated packaged acceptance stays separate.
- No application source change, commit, push, upload, VPS operation or old-runtime
  deletion. Existing dirty WIP remains untouched; this checkpoint is documentation.

## Cold-start latency follow-up (2026-09-20)

User approved the diagnostic and background-preparation recommendation. Local
implementation, tests and unsigned preview only; no paid model calls, signing,
runtime replacement, commit, upload or VPS changes. Preserve existing dirty WIP.

- Observed daily sample: owner initialization to healthy 16,892 ms; prompt recall
  1,909 ms, one selected memory; capture delivered two messages. UI task duration
  4.3 s does not include the earlier entire initialization interval. Current warm
  filesystem full-tree measurement was 1,869 ms, 28,600 files / 444,303,068 bytes;
  not an original cold-start phase measurement. Do not attribute all delay to hash.
- Implement fixed numeric launch-stage diagnostics and one consent-fenced warmup
  after exact Host readiness. Preserve full-tree validation, first-prompt memory
  waiting, service single-flight, disable/shutdown cleanup and failure visibility.
- No new UI or cross-process protocol; settings lifecycle remains authoritative.
  Last diagnostic is owner-only, bounded by fixed stages and overwritten atomically,
  outside memory data. Nested native stages overlap their parent, not additive.
- Acceptance: targeted consent/readiness/coalescing/failure/diagnostic tests,
  desktop typecheck, full source gate, rebuilt preview plus real startup receipt.
  Real provider speed and per-Session resource timing remain separate observations.
- Rollback: revert only these follow-up hunks and rebuild the app; remove neither
  memory data nor the old runtime backup. No durable preference migration.
- Initial targeted run: 63 passed, one expected contract update required because a
  missing-runtime attempt now retains a sanitized failure diagnostic. Keep the
  assertion that model resolution did not occur; add the exact diagnostic filename.
- Targeted rerun PASS: 64 tests / six files; desktop typecheck PASS. Added one
  further regression proving a diagnostic write error does not mask admission
  failure or expose raw errors. Full `check:source` PASS: 865 files / 5,622 tests,
  9 files / 23 tests skipped; coverage gates passed. Log:
  `/tmp/newmoney-cold-start-source2.log`. Initial aggregate attempt stopped at the
  existing supervisor file-length limit (one added line); removed one blank line,
  without changing the limit, structure or test contract. Later indentation-only
  cleanup is separately linted; no production behavior changed during that cleanup.
- Native UI readback before preview: task completed; settings save/revert disabled,
  with no unsaved model/configuration edits. Standard unsigned preview started;
  no forced termination or new model request issued by the operator.
- Preview PASS on macOS 27.0 arm64: rebuilt app, packaged smoke, memory settings,
  activation cold-process checks and archive-container verification; opened PID
  4095. Asar SHA-256 `f98627ca5b33ad8090e04104508197d2bd42316e4878cf266f981e420297cd7f`,
  200,646,045 bytes. Log `/tmp/newmoney-cold-start-preview.log`. No archive retired.
- Daily warmup PASS: new fixed receipt (0600), completed in 7,658 ms: configuration
  26 ms, runtime admission 4,750 ms, storage binding 1 ms, native start 2,881 ms
  (process ready 2,850 ms; scope provisioning 28 ms). Normal-profile native child
  PID 4115 is owned by app PID 4095. Receipt modified 2026-09-19T16:59:51.200Z.
  Native accessibility concurrently confirms `app://pi67/index.html`, conversation
  not running and `Open conversation` action: preparation no longer requires opening
  that Session. This is a background-ready observation, not a measured new-dialogue
  latency, controlled comparison with the earlier 16.9 s, or a p95 certification.
- Full admission remains intact; no Python runtime reinstall/signature change,
  provider/configuration change, private data cleanup or automatic prompt. Main
  preparation now runs earlier and uses resources while enabled even without an
  open conversation. Immediate sends can still await its remaining startup time.
  Next user action: open/create a private dialogue to assess perceived readiness;
  actual provider/recall speed remains separately measured by existing diagnostics.
