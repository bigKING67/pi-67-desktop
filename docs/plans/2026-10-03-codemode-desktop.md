# Desktop native Codemode integration

Status: active (post-push Windows acknowledgement and Renderer recovery remediation)
Owner: Codex
Started: 2026-10-03
Last updated: 2026-10-03

## Goal and authorization

The user accepted the recommendation to close the three observed Codemode gaps
and complete local implementation, source validation and macOS packaged preview.
Use Pi's public Codemode factory and execution pipeline as the only authority.
After local acceptance, the user explicitly authorized a scoped local commit of
this implementation, tests, patch and documentation, then push of the two completed
commits and exact-SHA Windows candidate CI. Source `4694974e` is now on remote main.
The user subsequently accepted remediation of the observed Windows first-Prompt
acknowledgement timeout and Renderer reading-anchor failures. This follow-up owns
local fixes, diagnostic evidence, regressions and applicable packaged validation.
The user then authorized the reviewed 16-file scoped commit, push to main and
ordinary CI plus exact-SHA Windows candidate validation. Distribution remains a
separate delivery step.
The user subsequently authorized isolated synthetic live-model acceptance using
`deepseek/deepseek-flash`, then continued to the packaged acceptance gap. Each
follow-up live run was capped at two requests, 1,024 output tokens per request,
with immediate stop on failure and redacted receipts only.

## Delivery boundary and non-goals

- Implement exact root admission, host-controlled output persistence and bounded
  parent/child live and restored projections with existing tool-card UI.
- Keep `models: false`, direct native tools available and Pi JSONL authoritative.
- No automatic model routing, Pi Durable service, user profile mutation, upload
  or publication. Scoped push and remote CI follow the authorization above. Paid
  requests are limited to the separately authorized synthetic acceptance above.
- Windows source compatibility is required; real Windows/package acceptance is
  unverified locally and must not be inferred from macOS or source tests.

## Post-push remediation

- Entry: clean canonical `main`, `4694974e0f26d021d8aa49a879434ebd302580b4`,
  local/remote 0/0. Preserve the original CI artifacts under
  `artifacts/validation/codemode-ci-37123331634/`.
- Windows candidate `37123585574/1`: provenance, build, packaged smoke and UI
  passed; full installer certification failed at clean-profile first Prompt.
  Baseline install, alpha.42-to-alpha.43 upgrade, post-upgrade launch and profile
  bootstrap passed. Runtime initialization completed; the exact ACK stall boundary
  is not yet known. No testable candidate was produced or distributed.
- Ordinary CI `37123331634`: both native lanes and source quality passed.
  Renderer attempt 1 timed out awaiting the changed-files card; the failure
  screenshot then showed it. Attempt 2 passed that test but restored row 63
  instead of row 65 after Settings. Neither attempt passed the complete gate.
- Root owns implementation/integration. `reading_anchor_diagnosis` is a bounded
  read-only analysis of the transcript failure; it does not mutate shared files.
- Acceptance: reproduce the failing invariant, fix its owning boundary, retain
  durable-before-ACK semantics and exact Session authority, and preserve the
  current timeout/installer/lifecycle gates. Diagnostics may contain only bounded
  stages, outcomes and timing, never prompts, credentials, paths or raw payloads.
- [x] Locate first-Prompt ACK boundary; add focused regression and fix or explicitly
  distinguish instrumentation from a verified Windows repair.
- [x] Repair semantic reading-anchor recovery with deterministic layout regression.
- [x] Run targeted and aggregate source gates, affected Renderer E2E and macOS
  packaged preview; keep Windows exact-SHA certification pending until actually run.
- ACK evidence is instrumentation, not a Windows repair: opt-in test capture follows
  request receipt, dispatch, runtime, receipt reconcile/write and response delivery.
  No payload, identity, path or raw error is captured; limits are 64 attempts and
  16 records per attempt. Main projects fixed fields; installer failure retains a
  64-record tail in a separate bounded report. The 5-second admission deadline and
  durable-before-ACK ordering are unchanged. A `response-posted` record proves the
  Host send returned, not that Renderer received it.
- Renderer root cause: remount initial positioning used estimated 120px row heights,
  leaving row 63 first-visible instead of saved row 65. Protect the saved anchor
  through measurement and explicitly align it. Both scroll directions cancel a
  queued restoration; editable targets and modified keys retain normal behavior.
- Independent bounded review (`ack_anchor_review`): accepted and fixed downward-key
  cancellation; dismissed the empty-row recovery candidate after confirming the
  existing authority/recovery mount gate. A possible Virtuoso-internal resize retry
  after user input remains source-level risk, not a reproduced browser failure;
  avoid an unproven private-API cancellation or premature DOM-alignment replacement.
- First aggregate pass: 929 test files passed / 9 skipped, 6,095 tests passed /
  24 skipped, branch coverage 78.63%. Full Renderer: 287 passed / 1 skipped,
  two workers and zero retries. Reading-position round trip also passed ten
  consecutive Chromium runs. Final keyboard regression is included in the follow-up
  gate recorded below.
- Final keyboard regression: seven scroll keys cancel the queued frame. Final
  source gate: 929 files / 6,102 tests passed, 9 files / 24 tests skipped, branch
  coverage 78.67%. Ten affected Renderer projection/navigation cases passed; no
  timeout, assertion or retry allowance was relaxed.
- Real Chrome (`browser67`, synthetic bridge / built renderer): 72 rows, saved
  message 65 -> restored message 65, 900px away from bottom; return-to-latest
  distance 0. Receipt: `artifacts/validation/ack-anchor-20261003/browser/receipt.json`.
  One managed tab was closed and verified, none left unkept; owned fixture server
  stopped. This is browser evidence, not Electron or provider evidence.
- macOS arm64 `preview:mac:unsigned` passed packaging, packaged smoke and launch
  (PID 22104). This includes native MCP discovery and one AUTO synthetic echo,
  warm/cold restore and bounded active-Prompt shutdown (610.4ms). No paid provider
  request was used. `app.asar`: 194,925,527 bytes,
  SHA-256 `eda03665bd06fc5a883426a40d112a5942a7e6ab224bbf249060bb62485444ad`.
  Identity records baseline `4694974e` with `clean:false`; do not promote this to
  an exact-SHA candidate claim. Full receipt:
  `artifacts/validation/ack-anchor-20261003/receipt.json`.
- Local follow-up implementation/validation is complete. The user authorized the
  reviewed 16-file scoped commit, push and Windows exact-SHA CI on 2026-10-03.
  Windows ACK cause and repair remain unverified until the new run supplies
  evidence. Distribution is outside this authorization.
- Rollback: restore only this follow-up's scoped diff; retain pre-existing failure
  receipts and current preview. Do not alter user profiles, dependency versions,
  timeouts, installer certification requirements or release state.

## Entry evidence and ownership

- Canonical main at `883078207105a9ba1c10efff0b2317a4211e44c3`, upstream 0/0.
- Five existing dirty prototype/support/plan files belong to this task chain.
- Prototype: 16 cases; final aggregate 925 files / 6062 passed, 24 skipped.
- Root owns safety, registration, integration, UI and authority changes.
- `codemode_output_control` owns the existing locked SDK patch, lockfile,
  compatibility note and isolated patch tests. It preserves the native MCP patch.
- `codemode_projection_map` owns bounded live/durable child projection and paging.
- `codemode_final_review` independently reviewed the completed behavior read-only;
  no P1/P2 finding; final structure-only extraction also reviewed for parity.

## Decisions and acceptance

- Exact Desktop-owned sandbox identity may run only in a trusted Workspace.
  Every nested call still crosses unchanged leaf safety/approval; PLAN admits
  the sandbox but rejects non-read-only leaf actions. Recursive Codemode is denied.
- Host fixes `mode: on`, `models: false`, `saveOutput: false`; no new tool loop,
  client, prompt composer, provider switching or global setting is introduced.
- Saved Pi nested tool results supply restored child identity/result/parenthood.
  Receipts supplement timing/status only; missing results remain unreconciled.
- Preserve bounded IPC/renderer data, independent child failure/cancellation and
  an explicit incomplete marker when child limits apply. No raw input/result payload copies
  into a second persistent store.

## Checkpoints

- [x] Minimal SDK output-control patch and default/disabled persistence tests.
- [x] Exact root registration/admission, forged/duplicate/schema/PLAN/YOLO tests.
- [x] Live and Pi-owned restored children, abort and missing-result tests.
- [x] Existing UI presents hierarchy and unsuccessful child outcomes truthfully.
- [x] Product/protocol/design contracts and targeted/full source gates.
- [x] macOS preview package/smoke and applicable rendered behavior evidence.

## Validation and rollback

Start with affected tests/typechecks, then the aggregate source gate and macOS
preview. Apply design-craft L1-F, existing PRODUCT/DESIGN/DESIGN.dark authority;
retain current primitives/tokens and tool-card grammar. Rendering and packaged
evidence are separate from synthetic real-SDK tests.

Rollback removes this scoped integration diff and restores the prior patch/lock
pair together. The native MCP migration remains intact; prior prototype evidence
is retained in its completed plan. No user data migration or independent Session store requires reversal. Packaging
retention and preview lifecycle follow the release operation contract.

## Evidence and remaining risks

- Real Pi SDK targeted integration: 6 files, 51 tests passed, including root/leaf
  authorization, abort, timeout, store, raw-output policy and actual JSONL reopen.
- Projection and cross-page recovery after structure-only extraction: 5 files,
  49 tests passed. Original message parts retain their projection budget.
- Renderer bootstrap + new Codemode browser scenarios: 4 passed. Initial bootstrap
  failed because generated protocol revision had stale dist output; rebuilding the
  protocol package resolved it without changing assertions or timeouts.
- Full source gate first caught missing fixture execution typing (fixed), then file
  size limits in normalizer implementation/tests. No threshold was weakened.
- Rendered visual evidence: `artifacts/visual-review/codemode/visual-review.md`,
  light/dark and narrow screenshots, plus browser67 real-browser failure-filter
  screenshot. Dedicated owned tab finalized (closed=1, verified=1, remaining=0).
- Full source run after extraction: 927 files / 6088 tests passed; one legacy
  integration assertion still required Codemode unregistered. Updated it to the
  accepted enabled behavior, preserving disabled MCP assertions and strengthening
  initial/reload active-tool assertions; its 4 tests pass. Final `check:source`
  passes: 928 test files, 6089 tests passed, 9 files / 24 tests skipped; coverage
  statements 84.16%, branches 78.62%, functions 86.97%, lines 87.76%.
- `preview:mac:unsigned` passed: rebuild, native MCP AUTO echo and owned-process
  cleanup, Main/Agent Host IPC, app:// renderer, warm/cold session recovery,
  packaged shutdown, DMG verification and ZIP verification. New preview opened.
- Local app: `artifacts/release/mac-arm64/New Money.app`, version alpha.43,
  Pi SDK 1.0.0; app.asar 194921141 bytes, SHA-256
  `deee5e898a16de7332384bc5835009de52f26c163e5f97730e537857a16d66f0`.
  Identity and smoke receipt under `artifacts/release/` declare source clean=false;
  this is a local dirty preview, not a committed distribution candidate.
- Computer Use could inventory the running app but could not capture its normal
  profile window (`cgWindowNotFound`). Renderer/process presence and packaged
  automated smoke are verified; normal-profile native visual observation is not.
- Separate package-owned Codemode probe PASS, bound to the same app.asar SHA-256:
  real packaged Agent Host ran the native QuickJS/worker script and nested read,
  returned the fixture marker, persisted complete native `nestedCalls` in JSONL,
  retained parent identity and successful child status in live and cold UI.
  Receipt: `artifacts/visual-review/codemode/packaged-3b6a292a-b810-4aa4-8533-de2d83fabd2a/receipt.json`.
  Live/cold screenshots reviewed. Owned app exit and isolated profile cleanup PASS.
- First package probe's live execution passed but cold helper timed out: it omitted
  the existing `打开对话` recovery action. Corrected the ignored probe to follow
  exact restore/open actions, without creating a fallback session; rerun passed.
  Initial failure receipt retained under `packaged-d3fd72e1-6085-468d-acf9-6b3f9e3659f4`.
- The local commit includes source, tests, patch and documentation only. The
  previously tested dirty preview retains its original artifact identity;
  committing source does not retroactively certify an exact-SHA candidate.
  No push, upload or publication is authorized by this local closeout.
- Source SDK live-model acceptance PASS at
  `7926a5ddab2de1d9fcf31b98a5a6f66acd194fd8`: DeepSeek generated its own script for
  the explicitly requested Codemode task, completed two synthetic file reads and
  one native MCP echo, then returned all expected markers. Two HTTP 200 requests,
  384 output tokens total, all ten acceptance checks and owned cleanup passed.
  Receipt: `artifacts/validation/codemode-live-20261003/receipt-v2.json`.
- The first live attempt failed before any nested call. Its receipt is retained
  as `receipt.json` in the same directory; insufficient error metadata prevents
  a conclusive root cause. The probe's PLAN setup separately reproduced a native
  MCP rejection. Corrected the probe to AUTO with only synthetic read/echo tools,
  preserved the native SDK stream wrapper, and added redacted diagnostics and
  six passing offline checks for decoding, error classes, privacy and budget.
  These are probe changes; no product runtime change was required for the pass.
- Packaged macOS live-model acceptance PASS on the same alpha.43 app.asar above:
  isolated Electron UI submission, actual Agent Host / native Pi provider,
  model-generated Codemode, two file reads, native MCP echo, three completed child
  cards, complete native JSONL nested calls and cold UI recovery. Two HTTP 200
  requests produced 338 output tokens; cold recovery made no extra requests.
  Receipt and reviewed live/cold screenshots:
  `artifacts/validation/codemode-live-20261003/packaged-live-f772544c-ba18-408a-b4d0-b9fe6b1f5ff4/`.
  Owned application and native MCP descendants stopped, temporary profile and its
  credential copy removed, original user preview PID 78378 remained running.
- Packaged preflight initially failed before model execution. The probe now obtains
  the native Provider from the session's public `modelRegistry.getProvider` seam,
  with budget enforcement around its original stream. Offline UI/JSONL/cold
  recovery then passed before the live run. Initial preflight receipts remain
  under `packaged-offline-cea7d89f-ed9d-46c4-8a88-0b50914ff68d` and
  `packaged-offline-a4ba6a4f-4c99-42f6-83b0-4c59d2516aa1`; passing preflight is
  `packaged-offline-d8d9ec73-aec2-457e-98cc-d478dc3f465e`, all in that validation directory.
- These passes verify one explicit synthetic task with a real model through both
  source SDK and packaged macOS. They do not prove autonomous tool choice, broad
  model reliability, or normal-profile real-provider behavior. The tested package
  retains its original dirty-build identity. Windows remains unverified. Pi Durable
  and automatic model routing are not implemented or enabled.
