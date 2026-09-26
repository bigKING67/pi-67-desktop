# YOLO deletion hard confirmation

Status: completed
Owner: Codex
Started: 2026-09-26
Last updated: 2026-09-26

## Goal

Keep AUTO interruption low for routine `write` and `edit`, while requiring an
exact one-shot confirmation for recognized deletion in both AUTO and YOLO.

## Non-goals

- Do not reintroduce ASK as a visible mode.
- Do not add per-call approval for non-deletion YOLO operations.
- Do not change Tool identity, PLAN, Workspace trust, OS permission, or persistence contracts.
- Do not distribute a candidate, release, or deploy.

## Acceptance criteria

- Trusted AUTO continues to execute ordinary canonical built-in `write` and `edit`
  without an approval dialog; system and credential targets retain their boundary.
- Trusted YOLO executes every valid non-deletion Tool without per-call approval.
- `bulk-delete`, `destructive-shell`, `persistent-state-delete`, and
  `external-delete` request an exact one-shot decision in both AUTO and YOLO.
- Enabling YOLO never resolves a pending hard-stop approval, and a hard-stop dialog
  cannot enable YOLO or create a path grant.
- Product, interaction, process, implementation, and targeted tests agree.

## Delivery boundary

- Local implementation: authorized by the continuing AUTO/YOLO fix.
- Scoped commit: authorized on 2026-09-26.
- Push to `origin/main`: authorized on 2026-09-26.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | AUTO routine external `write`/`edit` bypasses approval while sensitive targets do not. | `packages/pi-runtime/src/safety-extension-auto-mode.test.ts` | 2026-09-26 |
| OBSERVED | Before this change, trusted YOLO returned before hard-stop classification and bypassed `rm -rf`. | baseline `packages/pi-runtime/src/safety-extension.ts` and its test | 2026-09-26 |
| OBSERVED | Before this change, YOLO resolution settled every pending Safety Approval, including deletion. | baseline `packages/pi-runtime/src/extension-ui-bridge.ts` | 2026-09-26 |

## Affected boundaries

- Modules/processes: Pi Runtime safety/approval bridge, Renderer approval and Composer copy.
- Protocol or persisted state: no schema or persisted-state change.
- Platform/artifact: shared macOS/Windows source; packaged verification on macOS only.
- Security/privacy: deletion remains a per-call hard stop; no payload logging.
- Existing WIP: preserve Settings V2, account/memory, packaging, design-reference,
  and all unrelated dirty files; authority edits are narrow hunks only.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Apply the existing hard-stop category set before the YOLO bypass. | Reuses the authoritative deletion classifier instead of adding Tool-name checks. | The domain introduces a more precise irreversible-action type. |
| Reject `enable-task-yolo-and-allow` for a hard-stop request. | A deletion confirmation must not double as a durable bypass. | Product explicitly adopts a separately confirmed destructive mode. |
| When ordinary approval enables YOLO, resolve only other non-hard-stop approvals. | Pending deletion still needs its own exact target decision. | Pending approvals gain independent immutable grants. |
| Keep the hard-stop dialog to deny or allow once. | Avoids a misleading YOLO action while YOLO may already be active. | The request projects an authoritative current mode and a distinct safe action. |

## Checkpoints

- [x] 1. Reconcile current authority, implementation, tests, and prior behavior.
- [x] 2. Implement the Runtime/Renderer/contract change without touching unrelated WIP.
- [x] 3. Pass targeted typecheck, unit, and Renderer E2E validation.
- [x] 4. Pass aggregate source gate and fresh macOS packaged preview/inspection.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | affected package typechecks, lint/diff checks and aggregate `corepack pnpm run check` | no introduced errors | PASS; aggregate coverage 84.02% statements, 78.49% branches, 87.26% functions, 87.66% lines |
| Tests | targeted Domain/Runtime/Renderer unit and E2E tests | AUTO write unchanged; YOLO deletion prompts; pending hard stops retained | PASS; 41 unit and 18 Renderer E2E tests |
| Runtime/host | controlled Safety Extension/bridge contracts | exact one-shot hard-stop behavior | PASS |
| Packaged artifact | fresh `preview:mac:unsigned` and native inspection | new copy and hard-stop actions visible in repository artifact | PARTIAL; package/smoke passed and native AUTO/YOLO plus confirmation copy was observed; a live hard-stop dialog was not triggered |
| Target OS/manual | Windows x64 | real Windows evidence | UNVERIFIED |

## Rollback

Revert the bounded Runtime ordering, pending-approval filtering, hard-stop dialog,
copy, authority, and tests together. No persisted migration or cleanup is required.

## Risks and unknowns

- Hard-stop classification is conservative and may include commands whose exact
  effect is broader than deletion; that is the existing domain contract.
- A real destructive packaged acceptance is intentionally not run against user data.
- Windows packaged/manual parity remains unverified.

## Progress log

- 2026-09-26: Live authority and implementation comparison found YOLO bypassing
  recognized deletion; scoped implementation started.
- 2026-09-26: Runtime/Renderer implementation and contracts updated; affected
  typechecks, lint, reference/structure gates, 41 unit tests, and 18 Renderer E2E
  tests passed.
- 2026-09-26: Aggregate source gate passed. Fresh unsigned macOS arm64 package and
  packaged smoke passed; repository preview opened with `app.asar` SHA-256
  `0d23d71337e0809252c3ae10043b5e86694ed3846415c55375ce6f595584b904`.
  Native accessibility inspection observed the new menu and YOLO confirmation
  copy, then cancelled and retained AUTO. No live destructive call was issued.

## Closeout

- Final source identity: this plan is committed with the scoped change; its containing
  Git commit is authoritative. The implementation was based on
  `1bc3c082e12123b2e712ccf3881028ed3ca3bffb`.
- Changed files: bounded Runtime safety/approval bridge and tests; Renderer
  approval/Composer copy and E2E; `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, process
  contract; this execution plan.
- Validation completed: 41 targeted unit tests, 18 Renderer E2E tests, affected
  typechecks, lint/reference/structure checks, aggregate source gate, fresh macOS
  arm64 package/smoke, and native menu/confirmation inspection.
- Validation not completed: live packaged destructive-dialog trigger and real
  Windows x64 packaged/manual acceptance.
- Remaining risks: destructive classification remains conservative; Windows
  parity is unverified.
- Delivery boundary: scoped commit and push only; no candidate distribution or release.
