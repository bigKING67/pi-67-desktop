# Desktop native Codemode integration

Status: completed (local implementation and macOS acceptance; no distribution)
Owner: Codex
Started: 2026-10-03
Last updated: 2026-10-03

## Goal and authorization

The user accepted the recommendation to close the three observed Codemode gaps
and complete local implementation, source validation and macOS packaged preview.
Use Pi's public Codemode factory and execution pipeline as the only authority.
After local acceptance, the user explicitly authorized a scoped local commit of
this implementation, tests, patch and documentation. Push remains outside scope.

## Delivery boundary and non-goals

- Implement exact root admission, host-controlled output persistence and bounded
  parent/child live and restored projections with existing tool-card UI.
- Keep `models: false`, direct native tools available and Pi JSONL authoritative.
- No automatic model routing, Pi Durable service, paid model calls, user profile
  mutation, push, upload, remote CI dispatch or publication.
- Windows source compatibility is required; real Windows/package acceptance is
  unverified locally and must not be inferred from macOS or source tests.

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
- Model-choice behavior, paid Providers and Windows remain unverified. Pi Durable
  and automatic model routing are not implemented or enabled in this change.
