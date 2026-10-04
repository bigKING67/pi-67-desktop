# Native Auto routing and isolated Durable compatibility

Status: complete for authorized local delivery (bounded live Auto acceptance and profile setup pass; packaged live dispatch and Windows remain unverified)
Owner: Codex
Started: 2026-10-03
Last updated: 2026-10-04

## Goal

Expose an opt-in Auto model through Pi 1.0 virtual models. Users configure a
classification model and standard/complex task models in the canonical Pi
settings. One bounded classification selects a physical model for each new
task; continuations and retries keep that model. Show the decision and actual
usage truthfully. Separately probe Pi Durable with synthetic, isolated data.

## Non-goals

No second agent loop, Provider transport, model registry or Session store. No
automatic default-model replacement, silent error fallback, mid-task switching,
user-profile migration, unbounded paid evaluation, remote service or release.
Durable does not enter the production dependency graph in this change.

## Acceptance criteria

- Global Auto settings use Pi JSONC, exact revision checks, and existing reload
  semantics. Unavailable saved choices remain visible; no implicit replacement.
- Auto is an explicitly selected Pi virtual model. Classification uses only the
  user's bounded task text and the configured judge, with cancellation, timeout
  and output limits. Invalid/failed decisions fail before candidate dispatch.
- All actual models resolve from Pi, with credential/capability checks. Tool
  continuations, steering and retries within a running task retain its choice.
- Routing state and bounded decision/usage evidence live in Pi JSONL and follow
  branches. Cold restoration does not make a classification request.
- Shared/team history must not reach a classifier outside current model-policy
  authorization. First version blocks Auto for those sessions before processing.
- Settings and conversation surfaces expose configuration, decision, actual model
  and extra classification cost without raw prompts or credential logging.
- Synthetic SDK tests cover dispatch, failure, cancellation, sticky routing,
  images, replay/forks and budget enforcement. Browser/macOS packaged evidence is
  separate from Windows and from live routing-quality/cost evaluations.
- Durable report identifies pinned package, storage/replay/dedup evidence and
  migration gaps without claiming coding-agent JSONL compatibility by filename.

## Delivery boundary

- Local implementation: authorized by user's continue and classifier selection.
- Commit/push: not part of this change's authorization.
- Candidate: local macOS preview only under repository default; no upload.
- Release and user data migration: out of scope.
- 2026-10-04 follow-up: user accepted Doubao 2.1 Lite judge, DeepSeek Flash
  standard and GPT-6.1 Sol complex, and authorized continuing model setup and
  bounded synthetic live acceptance. Preserve the existing default. Initially
  cap at 12 requests / 5,632 requested output tokens; user then explicitly
  approved a cumulative 16 requests / 6,144 requested output tokens. That cap is
  now exhausted. Do not silently retry, switch models or expand this budget.
- The user subsequently approved the frozen v2 campaign, adding a maximum of
  20 requests / 6,656 requested output tokens with no retries. Its single run
  ended on the first invalid judge output after 1 request / 128 requested output
  tokens. The remaining ceiling is unused, not authorization to reset the
  campaign ledger, alter the frozen protocol or run a different experiment.
- The user then approved the concrete v3 structured-output proposal by saying
  continue: at most 20 requests / 6,656 requested output tokens, no retries,
  with the combined v2+v3 ceiling revised to 21 / 6,784. The single v3 run
  passed and consumed exactly that ceiling. No further paid calls are included.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Clean canonical checkout at 05529cd3 | Git | 2026-10-03 |
| OBSERVED | Pi 1.0 registerVirtualModel supports branch-persisted route state and physical assistant identity | Installed SDK virtual-models.md | 2026-10-03 |
| OBSERVED | User chose bounded model classification per new task | Current conversation | 2026-10-03 |
| OBSERVED | Durable is a separate experimental harness | Earendil official announcement/README | 2026-10-03 |

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Native virtual model; global judge/standard/complex references | Reuse Pi dispatch and canonical config | Native API fails acceptance |
| Classification is opt-in; one request per new task | Bound cost and preserve caches within execution | Measured evidence supports another policy |
| No automatic failure fallback | Preserve explicit model and error semantics | Separately exposed product contract |
| Team/shared Auto blocked initially | Classifier must not bypass team model authorization | Full classifier and candidate policy integration verified |
| Durable isolated synthetic probe | Session/extension/storage compatibility is unproven | Migration design and acceptance approved |

## Affected boundaries and ownership

- Main: runtime virtual model, projection, renderer, authority docs, integration.
- auto_routing_configuration: protocol/config service/Host app command and tests.
- durable_compat_probe: ignored artifacts only, isolated public-package tests.
- Existing unrelated WIP: none observed at entry. No new worktree.

## Checkpoints

- [x] 1. Native API and current authority checked; classifier approach accepted.
- [x] 2. Configuration and native dispatch implemented with synthetic regressions.
- [x] 3. Settings and decision/usage projection implemented and verified.
- [x] 4. Durable compatibility report with actual isolated evidence.
- [x] 5. Source gates, browser and macOS preview; final risk-based review.
- [x] 6. Bounded live acceptance: 12/12 fixed cases, 4/4 repeats, native Auto
  dispatch to both candidates and both JSONL reopens passed. Saved the approved
  three-model selection through the production configuration service and verified
  native readback; the existing physical default is unchanged.

## Validation matrix

| Layer | Procedure | Result |
| --- | --- | --- |
| Source | aggregate check:source; narrow follow-up typecheck/lint/tests | PASS: 934 files / 6,135 tests; 9 files / 24 tests skipped; later fork regression and draft choice follow-up pass |
| Pi SDK | isolated real SDK transports, cancellation/retry/steering, JSONL reopen/fork | PASS synthetic; native PLAN context and pre-dispatch decision notification regressions included |
| Renderer | focused E2E and browser67 light/dark inspection | PASS: 4 feature tests + bootstrap; two retained screenshots |
| macOS | preview:mac:unsigned package/smoke + native AX readback | PASS on arm64; user-assisted post-save navigation exposed all three saved Auto references and disabled Save. Live v3 dispatch used isolated native SDK sessions; packaged UI live dispatch is still unverified |
| Windows | real target acceptance | unverified locally |
| Live Auto | frozen author-created suite, repeats, two native session.prompt tasks | PASS: 12/12 fixed cases + 4/4 repeats; 18 valid judge responses, both candidate routes and JSONL reopens; 20 calls / 6,656 requested output tokens, no retries |
| User configuration | production exact-revision mutation and native offline readback | PASS: judge/standard/complex saved; default, other settings, models and auth preserved; no inference calls |
| General quality/cost | independent tasks vs fixed-model baseline | unverified; bounded authored suite cannot establish general accuracy or savings |
| Durable | pinned 1.0.1 hard-exit/resume, safe/unsafe replay and requestId dedup | PASS isolated; direct coding-agent API/storage replacement incompatible; no production dependency |

## Rollback

The default remains the user's existing physical model. Users can select it at
any time outside an active task and disable Auto settings. No existing Session
format or user profile is migrated. Before removing Auto, preserve route evidence
and prevent upstream's missing-virtual-model fallback from silently processing
an Auto session. Revert only this change's scoped source if needed; retain user
Pi data. Temporary Durable data is task-owned and separate.

## Risks and unknowns

General classifier quality and real cost savings remain unverified. The live
authored suite passed; 16 isolated classifications took 649–1,975 ms (median
846 ms). These measurements do not establish general accuracy or performance.
Pi virtual selection differs from the
physical model and every model-dependent capability must use actual dispatch.
Durable storage, approvals and extension APIs may require a migration rather
than a wrapper; its package remains experimental.

## Progress log

- 2026-10-04 scope resolved: the user chose recovery of the current task after an
  app/Agent crash. Implementation continues in
  [interrupted task recovery](./2026-10-04-interrupted-task-recovery.md), retaining
  coding-agent as the only runtime. The new recovery route changes Auto source;
  frozen v3 live receipts remain evidence for their original source snapshot.

- 2026-10-04 client readback and Durable scope follow-up: verified the same live
  preview process and user profile. Computer Use could read native AX but could
  not reliably navigate (noWindowsAvailable). The user manually opened Settings
  > Models; native AX then showed the exact saved Doubao/DeepSeek/GPT choices,
  disabled Save Auto and available Disable Auto. No settings action or prompt
  was submitted. This closes post-save packaged configuration readback only,
  not the composer selection or packaged live-dispatch acceptance.
- Re-read the official Durable announcement and the local compatibility report.
  Durable is explicitly a separate experimental harness, not a coding-agent
  replacement. Targeted current Desktop recovery tests passed: 4 files / 16
  tests covering duplicate submissions, unresolved previous-Host operations,
  corrupt receipts and native Tool Result projection. These are source-level
  synthetic tests, not a new packaged crash test. Current recovery deliberately
  marks unresolved work lost and does not re-execute it; automatic checkpoint
  continuation is a different product behavior. No Durable dependency, replay
  policy or user Session was changed. The user's desired next outcome (crash
  continuation, app-independent background work, or multi-user long tasks) is
  being clarified before proposing a production architecture change. Evidence:
  artifacts/validation/pi-durable-compat/DESKTOP-RECOVERY-ASSESSMENT.md and
  artifacts/validation/auto-routing/packaged-settings-readback.json.

- 2026-10-04 v3 live closeout: ran the approved immutable proposal once, with no
  retry. All 12 fixed cases and 4 repeats matched their declared labels; all
  18 judge responses satisfied the structured contract. Native session.prompt
  selected DeepSeek Flash for the filtering task and GPT-6.1 Sol for the recovery
  task. Both bounded answer checks and native JSONL reopens passed. Pre/post
  frozen hashes and all 20 pre-transport ledger reservations matched. Used
  6,656 requested output tokens; v2+v3 total is 21 calls / 6,784 requested output
  tokens. Reported v3 usage is 10,028 input + 685 output = 10,713 total tokens;
  output includes reported reasoning, not an additional token allowance.
  Catalog cost is not an invoice and Ark pricing metadata remains unknown.
  User configuration was byte-unchanged throughout live evaluation.
- After that acceptance, saved only pi67Desktop.autoRouting using the production
  PiConfigurationService.setGlobalAutoRouting revision/lock/atomic-write path.
  Native SettingsManager, physical model/auth availability and Desktop Auto
  catalog registration readbacks passed offline. Default remains
  deepseek/deepseek-flash; unrelated settings, models.json and auth.json are
  unchanged. A private settings backup exists outside Git. No model request was
  made while saving or reading back configuration. Post-save native UI inspection
  could not reach settings: Computer Use returned noWindowsAvailable; PID 3402
  remained alive. This is an automation observation gap, not a proven app defect.
  Evidence: artifacts/validation/auto-routing/V3-LIVE-RESULTS.md,
  live-v3-evaluation-receipt.json, live-v3-audit.json and
  auto-settings-setup-receipt.json. No source implementation changed after the
  passed v3 gates/preview. No commit, push, upload or release.

- 2026-10-04 structured decision follow-up: read the actual official Ark model
  list in browser67 and confirmed doubao-seed-2-1-lite-260915 appears under
  structured output (beta). The official schema guide supports enum, required,
  additionalProperties and strict:true. Two scoped managed tabs were closed and
  closure verified; no user tabs were operated. Sources:
  https://docs.volcengine.com/docs/ark/structured-output-beta?lang=zh and
  https://ark.volcengine.com/region:cn-beijing/docs/ark/model-list#86588b72 .
- Replaced the bare-label decision with one JSON complexity field, strictly
  parsed locally. Native Pi samplingParams requests JSON Schema on Completions,
  Responses and Azure Responses APIs; no transport/provider adapter was added.
  Other Pi APIs retain prompt-directed JSON plus local validation, without a
  server-side schema guarantee. Rejection never downgrades or retries. The
  semantic rubric and sample labels are unchanged. PRODUCT and architecture
  authority now describe this precise boundary.
- Runtime typecheck, type-aware lint and 54 tests passed. New cases cover native
  SDK wire payloads for all three APIs, schema rejection without retry, strict
  parsing and no candidate after invalid/truncated output. Ten offline v3
  harness scenarios passed with zero live calls and byte-unchanged user config.
  v3 retains the same 12 samples and 4 repeats; it adds bounded output-shape
  diagnostics and a pinned schema, without raw output retention. The previous
  v2 ledger/receipts/runner/proposal remain unchanged. v3 proposes at most 20
  attempts / 6,656 requested output tokens; together with the single failed v2
  call this needs a revised combined cap of 21 / 6,784 (an increase of 1 / 128
  over v2's original ceiling). No live v3 authorization or calls yet.
- Fresh macOS arm64 preview package/smoke/open passed for the structured-output
  change. ASAR SHA-256 90f25825209f6a9c074ebb2261f45e3bece1bc2ff18630df1843c94c967236d0,
  size 195059124, PID 3402. Default remains DeepSeek Flash; Auto is unconfigured.
  The exact next campaign is reviewable in
  `artifacts/validation/auto-routing/V3-PREPARED.md` and its frozen proposal.

- 2026-10-04 v2 live closeout: executed the explicitly approved frozen campaign
  once. The first `regression-filter` request returned HTTP 200 and stopReason
  stop, but no exact allowed decision, triggering AUTO_INVALID_DECISION. Actual
  calls: 1 Doubao judge, 0 DeepSeek tasks, 0 GPT tasks, 0 retries. Requested output
  cap consumed: 128 / 6,656; reported usage: 349 input + 3 output = 352 tokens.
  No classification accuracy score can be inferred from this format failure.
  Pre/post frozen source/bundle/script/lockfile hashes match; request guards
  verified system role, exact prompt/sample, disabled thinking, temperature 0
  and max_tokens 128. Raw output was not retained, so its wording and the cause
  of noncompliance remain unknown. Config files were byte-unchanged, default
  remains DeepSeek Flash, and Auto remains unconfigured. The create-only ledger
  and redacted receipt are retained; the campaign is not retried.
  Evidence: `artifacts/validation/auto-routing/V2-LIVE-RESULTS.md`.
- Read-only next-step investigation: installed Pi 1.0 exposes onPayload through
  its native provider-request options, while the current completions builder
  does not set response_format. Ark Chat API documents json_schema/strict as
  beta, but support for this exact judge model was not established. Structured
  output is a candidate next protocol, not an implemented or validated fix. No
  product source, user configuration or frozen evaluation input changed in the
  live execution turn; no additional paid diagnostic call was made.

- 2026-10-04 second follow-up: replaced overlapping classifier hints with ordered
  operation-based criteria. Short answers, no-tool requests and single-function
  scope do not override complex reasoning requirements. This is a candidate
  correction, not evidence that live classification quality is repaired.
  The previous evaluation changed prompts between runs and changed the complex
  task wording between classification and execution; its scores are not a
  single comparable benchmark. Retained every previous live receipt.
- Frozen the next bounded evaluation: 12 synthetic cases (3 prior regressions,
  9 fresh author-created cases), 4 repeats, then 2 identical-prompt native Auto
  tasks only if all classifications pass. This is not an independent blind
  benchmark. Proposed additional cap: 20 provider attempts / 6,656 requested
  output tokens, zero retries, 5-minute outer deadline. No live calls authorized
  or sent in this follow-up; the earlier 16 / 6,144 cap remains exhausted.
  Hashes bind source, compiled router, runner, lockfile, prompt and effective
  model metadata. A create-only live ledger reserves each request before sending
  and prevents silently restarting a crashed campaign with a reset budget.
- Runtime typecheck, 26 Auto regressions, targeted type-aware lint and 8 offline
  harness checks passed. The harness exercises success, wrong classifications,
  invalid output, HTTP failure, budget denial, wire-prompt drift, bad task output
  and wrong candidate dispatch. Offline fake responses prove transport/guard
  behavior only. All report zero real model network calls and unchanged user
  configuration. Fresh macOS arm64 preview package/smoke/open passed, PID 929;
  ASAR SHA-256 e2dc527d3ae105aa91010e613190847624190655381bdde5a32060d669ceb338.
  Default remains deepseek/deepseek-flash; Auto remains unconfigured. Evidence:
  `artifacts/validation/auto-routing/V2-PREPARED.md`. No commit/push/upload/release.

- 2026-10-04 live closeout: the first revised classifier scored 6/8. Clarifying
  bounded filtering/local edits and requesting temperature 0 corrected those
  two examples, but a complex recovery-design task was then underclassified.
  Preserve the failure; the final prompt has not passed the complete corpus.
  Standard Auto → DeepSeek passed (6.057 s, native JSONL reopen). Independent
  physical GPT-6.1 Sol passed (19.698 s, JSONL reopen); this is not proof of
  complex Auto dispatch. Exactly 14 judge and 2 task requests used the approved
  16-attempt / 6,144 requested-output-token cap. No further live calls.
- Added only `codex/gpt-6.1-sol` and
  `volcengine-ark/doubao-seed-2-1-lite-260915` to user models.json with a private
  backup and native Pi readback. Settings/auth/other models remain unchanged;
  default is deepseek/deepseek-flash; Auto remains unconfigured. Ark explicitly
  uses system role, disabled thinking for judging and max_tokens. Its absent
  pricing metadata is not evidence of free service. Codex pricing is a catalog
  estimate, not a verified service invoice.
- Final narrow typecheck, 26 Auto regressions, type-aware lint and diff whitespace
  checks passed. Refreshed macOS arm64 preview/package/smoke/open passed. Current
  ASAR SHA-256: 98b2ef217a9ef9e0fc4c271121868085f2d14ffd398271f4402f5aaafba1997e.
  Source remains dirty at base 05529cd3; no commit/push/upload/release. Windows and
  full packaged live Auto dispatch remain unverified. See
  `artifacts/validation/auto-routing/LIVE-RESULTS.md` and retained run receipts.

- 2026-10-04 follow-up: actual model calls exposed Ark's need for explicit
  `supportsDeveloperRole:false`; the initial generic compatibility default sent
  `developer`, yielding invalid decisions. `system` restored exact enum output,
  but a simple summary of engineering notes was overclassified. Refined the
  classifier to judge requested operations rather than supplied subject matter.
  Retain the initial failed receipts and validate the correction; do not enable
  the user's Auto selection merely on HTTP 200. No user Profile writes yet.

- 2026-10-03: Started authorized implementation and independent isolated Durable
  verification. Frontend route L1-F, design-craft, existing DESIGN authority.

- 2026-10-04: Completed scoped Auto implementation and local acceptance. Independent
  review identified two P2 integration defects; fixed and reverified. The browser
  task was finalized and test server stopped. Mac preview includes native MCP
  packaged smoke and read-only Auto settings presence; actual profile stays
  unconfigured. No live billing, commit, push, upload or release.
- Evidence: `artifacts/validation/auto-routing/REPORT.md` and
  `artifacts/validation/pi-durable-compat/REPORT.md`. Mac identity records
  `source.clean=false`; it is a local dirty-source preview, not a distributable
  exact-commit candidate. App ASAR SHA-256:
  `0bc982ccb80ebbaf229a765cfa979764c84434d40ac32232d6f5344faefc996c`.
- Remaining separate acceptance: chosen real models and a bounded live quality,
  cost and cancellation evaluation; new-change Windows evidence. Pi Durable
  production adoption needs its own approved architecture migration.
