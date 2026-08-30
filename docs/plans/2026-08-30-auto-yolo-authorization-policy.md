# AUTO and YOLO authorization policy

Status: complete
Owner: Codex
Started: 2026-08-30
Last updated: 2026-08-30

## Goal

Reduce routine AUTO approval interruptions while preserving a clear distinction
between AUTO and YOLO. YOLO remains the highest Task Tool mode and automatically
executes every valid ordinary Tool Call in a trusted Workspace. Explicitly
recognized irreversible or difficult-to-recover destructive operations remain
behind an exact one-shot confirmation in AUTO and YOLO.

## Non-goals

- Do not add a second agent loop, prompt composer, Tool orchestrator, or model
  router.
- Do not weaken PLAN read-only enforcement, Workspace trust, Tool identity,
  schema, path canonicalization, or malformed-routing checks.
- Do not claim that opaque interpreter code or undeclared third-party Tool
  internals can be proven non-destructive.
- Do not change operating-system permissions, Electron sandboxing, signing,
  update, release, or publication policy.
- Do not push, build a candidate, upload, tag, release, or promote. One scoped
  local commit is authorized after the completed validation is refreshed on the
  live pre-commit HEAD.

## Acceptance criteria

- Trusted AUTO executes ordinary Workspace reads/writes, bounded inspection,
  test/build commands, and explicitly admitted non-destructive local dependency
  and local Git operations without a modal.
- AUTO does not open a modal for a Shell command it cannot safely classify; it
  blocks with a bounded corrective Tool Result so Pi can split or restate the
  call.
- Trusted YOLO executes every valid non-hard-stop Tool Call without Safety
  Approval, including operations outside the normal AUTO policy.
- Recognized destructive Shell, file deletion, persistent-state deletion, and
  destructive Git operations request exact one-shot confirmation before both
  YOLO and installed-capability grants.
- Invalid, malformed, duplicate, drifted, or otherwise non-approvable calls are
  rejected before YOLO and never produce a meaningless approval dialog.
- The destructive confirmation reuses the established Dialog/Button system,
  exposes only deny and exact one-shot execution as Tool-decision actions, and
  does not offer to enable YOLO. The separately authorized Task-stop lifecycle
  action remains available when the request has exact Task authority.
- Targeted Domain, Pi Runtime, Agent Host/Protocol, Renderer, and authorization
  E2E tests pass. macOS unsigned preview packages, smokes, opens, and the changed
  dialog is inspected when a safe fixture can present it.

## Delivery boundary

- Local implementation: authorized
- Commit: authorized on 2026-08-30 for this scoped change set
- Push: not authorized
- Candidate build/upload: not authorized
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `main` HEAD is `0178a574aab44c76762a78d4bb25dc490fa56fb4`; 13 existing dirty paths belong to the preceding AUTO prompt-reduction work | live Git | 2026-08-30 |
| BASELINE | Trusted YOLO returned before ordinary approval policy and before `nonApprovableReason` | original `packages/pi-runtime/src/safety-extension.ts` | 2026-08-30 |
| BASELINE | AUTO asked for every built-in Bash category other than `workspace-command` | original `packages/domain/src/safety-policy.ts` | 2026-08-30 |
| BASELINE | Installed-capability AUTO grant bypassed deletion and other classified effects | original runtime tests and `PRODUCT.md` | 2026-08-30 |
| OBSERVED | Existing WIP admits bounded `;`, `&&`, read-only pipelines, safe stderr redirection, and canonical Workspace absolute paths | live diff | 2026-08-30 |
| VERIFIED | Invalid/non-approvable calls now fail before YOLO; recognized hard stops run before YOLO and installed-capability grants | targeted tests plus full `check` | 2026-08-30 |
| VERIFIED | AUTO now admits bounded project scripts, Workspace-local dependency changes, and non-destructive local Git; ambiguous Shell corrects without a modal | Domain and Pi Runtime tests | 2026-08-30 |

## Affected boundaries

- Modules/processes: `packages/domain`, `packages/pi-runtime`, `packages/protocol`
  only if the existing request shape is insufficient, `apps/agent-host`, and
  `apps/renderer` approval presentation.
- Protocol or persisted state: one `external-delete` risk literal and the generated
  protocol revision are updated; no persisted-state shape changes.
- Platform/artifact: shared TypeScript behavior for Windows x64 and macOS arm64;
  local packaged evidence is macOS arm64 only.
- Security/privacy: no raw Tool input, command, path, credential, or result may be
  added to telemetry or persistent state.
- Existing WIP: preserve and integrate all 13 current task-owned dirty paths;
  do not reset or discard them.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Keep PLAN ahead of all execution grants | Plan is a read-only interaction mode, not a weaker approval preference | Product contract changes explicitly |
| Validate non-approvable calls before YOLO | Permission cannot make an invalid identity, schema, route, or target valid | Runtime evidence proves a required valid YOLO call is misclassified |
| Apply a small hard-stop predicate before YOLO and installed-capability AUTO | Preserves highest routine autonomy while protecting recognized irreversible effects | User explicitly chooses unrestricted destructive YOLO |
| Keep AUTO effect-aware and YOLO authority-based | Preserves a meaningful mode distinction | Product changes to one unified mode |
| Convert AUTO ambiguous Shell from modal to corrective block | Removes meaningless interruption without pretending opaque code is safe | Real-task evidence shows the correction loop cannot recover |
| Reuse existing Dialog and Button primitives | No visual-system or dependency change is needed | Existing primitives cannot express exact destructive confirmation accessibly |

## Checkpoints

- [x] 1. Lock the policy matrix and hard-stop categories in product/design/domain contracts.
- [x] 2. Implement centralized decision ordering and AUTO Shell/Git/dependency behavior with regression tests.
- [x] 3. Implement destructive confirmation presentation and authoritative response behavior with renderer/host tests.
- [x] 4. Run targeted and aggregate source gates, then inspect packaged macOS behavior.
- [x] 5. Reconcile the live diff, update evidence, and close the plan without commit/push/release.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Domain | affected Vitest files for safety policy and Shell parser | policy matrix and adversarial coverage pass | PASS; included in 25-file/143-test targeted run and full gate |
| Pi Runtime | safety extension, configured capability, Tool mode, path, and routing tests | YOLO/hard-stop/AUTO precedence pass | PASS; included in 25-file/143-test targeted run and full gate |
| Renderer/Host | approval component/controller tests and authorization E2E | destructive two-action flow and ordinary three-action flow pass | PASS; Renderer E2E 7/7 on isolated port 5273 |
| Source | affected package typechecks, lint as applicable, `corepack pnpm run check` | no source-quality regression | PASS; 622 files, 3235 passed, 3 skipped; Domain branch coverage 91.66% |
| Runtime/host | browser validation where fixture supports it | changed Dialog behavior observed | PASS; browser fixture verified title, focus, actions, and exact response |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | package, smoke, and repository artifact launch pass | PASS; darwin/arm64 packaged smoke and launch, app.asar SHA-256 `b0a61d0ca3b75ff71f4f1cd32b48d0557a1d4e6dd069127d13ab519d60ebce89` |
| Target OS/manual | real Windows x64 and macOS manual destructive-operation checks | operator-bound receipts | NOT COMPLETED; not authorized |

## Rollback

Revert only the task-owned authorization-policy diff by scoped patches. Preserve
all pre-existing and user-owned work. If the new hard-stop ordering blocks a
known valid ordinary operation, restore the previous decision ordering for that
operation while retaining the existing bounded Shell and path-canonicalization
improvements.

## Risks and unknowns

- Opaque interpreters and arbitrary third-party Tools can hide destructive
  behavior. Source classification can guarantee confirmation only for recognized
  commands and effect-declared/curated capabilities.
- Dependency and Git operations combine scope and effects; an AUTO grant must
  never hide an external path, global install, destructive Git flag, or remote
  write.
- Renderer browser fixtures may not expose a real Host-generated destructive
  approval. If so, use source/E2E evidence and report rendered interaction as
  incomplete rather than synthesizing a pass.
- Windows behavior remains unverified without a real Windows x64 run.

## Progress log

- 2026-08-30: User accepted the policy direction. Re-checked live Git and source,
  selected bounded `review-craft` plus `design-craft`, and activated this plan.
- 2026-08-30: Added one hard-stop predicate across Domain, Runtime, Host response,
  and Renderer presentation. Split Shell risk and approval localization by
  responsibility to satisfy the existing structure gate without raising limits.
- 2026-08-30: Generated protocol revision
  `e500ea976224bf8c4b507ee4321c3345b996932ed550635593df8d72782b56fc`,
  passed targeted tests, full source/coverage gate, Renderer E2E, and macOS
  unsigned package/smoke/open. No commit or external delivery was performed.
- 2026-08-30: User authorized one scoped local commit. Live HEAD had independently
  advanced to `4a171b142a5e8c928a78ae202365b1a6cc08554d`; preserve that commit,
  refresh validation on top of it, and append this authorization change without
  amend, push, or release.

## Closeout

- Pre-commit base SHA: `4a171b142a5e8c928a78ae202365b1a6cc08554d`;
  the scoped delivery commit is reported from live Git after creation
- Changed files: 33 task-owned paths; 25 modified and 8 untracked
- Validation completed: targeted 25-file/143-test authorization suite; affected
  package typechecks; Renderer E2E 7/7; full `check` 622 files/3235 passed/3
  skipped; macOS arm64 unsigned package, packaged smoke, and repository artifact launch
- Validation not completed: real Windows x64 execution; operator-performed macOS
  destructive Tool confirmation; push, candidate upload, tag, release, or promotion
- Remaining risks: opaque interpreter or undeclared third-party Tool internals
  cannot be proven non-destructive; only recognized destructive effects receive
  the hard stop. Windows behavior remains unverified until a real x64 run.
- Commit/push/release state: one scoped local commit authorized; push, candidate,
  tag, release, and promotion remain unauthorized
