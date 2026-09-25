# AUTO risk judgment and uninterrupted YOLO

Status: complete
Owner: Codex
Started: 2026-09-25
Last updated: 2026-09-25

## Goal

Expose only AUTO and YOLO as user-selectable Tool modes. AUTO classifies the
actual target and side effect, runs routine work without asking, and interrupts
only for high-risk, sensitive external effects, or effects it cannot classify
reliably. YOLO uses one explicit mode-entry confirmation and then executes every
valid Tool Call without per-call approval. Built-in `write` and `edit` are
routine file operations unless their canonical target is security-sensitive.

## Non-goals

- Do not persist path grants to Workbench state, Pi JSONL, project settings, or disk.
- Do not make system/credential paths, external submission, authentication,
  publishing, remote writes, or unclassifiable effects automatic in AUTO.
- Do not weaken PLAN read-only enforcement, Tool identity/schema/route/target
  validation, Workspace trust, operating-system permissions, or Electron boundaries.
- Do not infer safety from the Tool name alone; canonical target and classified
  side effect remain authoritative.
- Do not push, package for distribution, upload, release, or deploy.

## Acceptance criteria

- The Composer offers AUTO and YOLO only; legacy `guided`/`ask` inputs cannot
  make ASK a normal selectable product mode.
- Trusted AUTO runs Workspace-local writes and ordinary canonical built-in
  `write`/`edit` calls outside the Workspace without an approval dialog.
- AUTO still requests a one-shot decision for system configuration, credential
  paths, destructive operations, remote or externally visible side effects,
  and other reliably classified high-risk effects.
- Existing bounded task-path trust remains available only for genuine boundary
  path reads or Shell work; routine `write`/`edit` does not depend on it.
- Runtime projection identifies routine built-in writes as `AUTO · 常规文件写入`.
- After a trusted user confirms entry into YOLO, every valid registered Tool
  runs without per-call approval, including recognized destructive operations.
  PLAN, invalid identity/schema/route/target, and untrusted Workspace failures
  still fail closed instead of becoming approvable.
- Product, design, process/protocol authority and targeted tests change together.

## Delivery boundary

- Local implementation: authorized.
- Commit: one scoped local AUTO/YOLO commit authorized.
- Push: not authorized.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Composer currently renders `ask`, `auto`, and `yolo` from one static mode list. | `apps/renderer/src/composer/ToolModeSelector.tsx` | 2026-09-25 |
| OBSERVED | AUTO already admits Workspace-local writes, bounded commands, local dependency changes, non-destructive local Git, and uniquely resolved installed capabilities. | `PRODUCT.md`, `packages/domain/src/safety-policy.ts`, `packages/pi-runtime/src/safety-extension.ts` | 2026-09-25 |
| OBSERVED | Canonical paths outside the selected Workspace become `external-path` and require one-shot approval unless an installed-capability grant applies. | `packages/pi-runtime/src/builtin-shell-safety.ts`, `packages/pi-runtime/src/safety-extension.ts` | 2026-09-25 |
| OBSERVED | The supplied screenshot shows a `pi-67-desktop` Workspace while Tool rows target `/Users/gaoqian/Documents/sixseven/workman/groland/...`. | user-supplied screenshot | 2026-09-25 |

## Affected boundaries

- Modules/processes: domain, protocol, Pi Runtime, Agent Host, Renderer.
- Protocol or persisted state: protocol schema/revision changes; no persisted state.
- Platform/artifact: shared Renderer and Agent Host behavior on macOS/Windows.
- Security/privacy: exact canonical path grants only; no raw payload logging.
- Existing WIP: preserve the current Settings V2, account/memory, packaging,
  reference-guide, `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, and `DESIGN.dark.md`
  edits. Authority edits in this task must be narrow additions to the current files.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Keep `ask` as an internal compatibility type but remove it from the normal selector and normalize legacy controller initialization/set requests to AUTO. | Avoids a broad wire break while making the product truthfully two-mode. | A future versioned protocol migration removes all legacy clients and fixtures. |
| Treat AUTO as risk judgment, not cached ASK. | Ordinary exact built-in writes are deterministic and should not interrupt normal work merely because the path is outside the selected Workspace. | Runtime evidence shows a routine-write class causes unacceptable data loss. |
| Classify sensitive canonical write targets before any Workspace or task-root grant. | System and credential paths remain a meaningful AUTO boundary without making all file writes privileged. | A stronger OS-owned capability boundary replaces path classification. |
| Store remaining boundary-path grants only in `RuntimeToolSafetyController`. | Task lifetime and trust revocation already terminate or reset this owner. | Product later requires explicit durable Workspace membership. |
| Carry grant candidates on the Host-authored approval request, never on the Renderer response. | The Renderer must not invent or widen a path grant. | A separately validated opaque grant identifier replaces projected paths. |
| Offer task trust only for bounded canonical read/Shell requests classified as `external-path`; routine write/edit never asks for it. | Keeps a useful boundary escape hatch without turning AUTO into ASK plus an authorization cache. | Explicit user-intent binding makes the grant redundant. |
| Put trusted YOLO after validity and PLAN checks but before AUTO risk gates. | YOLO means uninterrupted execution; invalid calls must still fail instead of becoming valid through consent. | Product reintroduces a separately named destructive-confirmation mode. |

## Checkpoints

- [x] 1. Update AUTO routine-write and sensitive-target classification.
- [x] 2. Move trusted YOLO ahead of every per-call risk approval and settle pending Safety Approvals.
- [x] 3. Update Composer/Approval copy and authorization projection.
- [x] 4. Update PRODUCT/DESIGN/process authority and protocol revision.
- [x] 5. Pass targeted Domain/Protocol/Runtime/Host/Renderer tests and aggregate checks.
- [x] 6. Package and inspect the rendered modes and YOLO confirmation on macOS.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | affected package typechecks, aggregate `corepack pnpm run check`, and `git diff --check` | no type/schema/lint/architecture/structure/diff errors | PASS; aggregate coverage 84.04% statements, 78.49% branches, 87.25% functions, 87.67% lines |
| Tests | targeted Vitest for safety, approval, protocol, Host and Renderer controllers | 108 tests passed across 12 files | PASS |
| Renderer | targeted Playwright Composer/Approval scenarios | 18 tests passed serially; AUTO/YOLO-only menu, copy, YOLO confirmation, and hard-stop YOLO action observed | PASS |
| Runtime/host | routine external write/edit, sensitive paths, pending approvals, destructive YOLO, task grants and lifecycle tests | pass | PASS |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | arm64 package and packaged smoke passed; repository preview opened; final `app.asar` SHA-256 `cb0415dffa5abd073ea0aa4f9a4b08885f33bea3b82d143b1d9def24106e6eae` | PASS |
| Native visual | Computer Use on repository preview | dark Composer exposes AUTO/YOLO only; exact AUTO/YOLO consequence copy and YOLO second-confirmation copy observed; inspection cancelled and retained AUTO | PASS |
| Native authorization behavior | live Pi prompts causing actual external write/delete | AUTO built-in `write` to an ordinary `/tmp` target completed without approval and projected `AUTO · 常规文件写入`; AUTO interrupted attempts against a `~/.ssh` target and both were rejected; after explicit YOLO entry, built-in `write` followed by exact destructive `rm --` completed without per-call approval; terminal readback confirmed the ordinary write and final target absence | PASS |
| Target OS/manual | Windows x64 | real Windows behavior | UNVERIFIED |

## Rollback

Revert the routine-write classification, uninterrupted-YOLO ordering, two-item
selector, approval actions, projection reasons, authority text and tests as one
scoped change. No persisted migration is needed.

## Risks and unknowns

- AUTO intentionally permits ordinary canonical built-in file writes outside the
  Workspace. The sensitive-root classifier reduces accidental credential/system
  changes but cannot substitute for operating-system permissions or destructive
  operation classification.
- Existing or missing path segments remain canonicalized through the nearest real
  ancestor so symlink escapes do not inherit textual trust.
- Windows packaged presentation/runtime parity remains unverified.

## Progress log

- 2026-09-25: Live source, authority and dirty-worktree scope inspected; plan activated.
- 2026-09-25: Domain/Protocol/Runtime/Host/Renderer implementation and authority updates completed.
- 2026-09-25: Targeted Pi Runtime and Renderer typechecks passed. Focused Runtime,
  Domain, Protocol, Host and Renderer Vitest coverage passed 108/108 tests.
- 2026-09-25: The first Renderer E2E attempt overlapped a Protocol dist rebuild and
  was an invalid sample. The serial rerun on port 5274 passed 18/18 tests.
- 2026-09-25: Final `corepack pnpm run check` completed with exit code 0 and coverage
  of 84.04% statements, 78.49% branches, 87.25% functions, and 87.67% lines.
- 2026-09-25: Unsigned macOS arm64 packaging and packaged smoke passed. Computer Use
  observed the AUTO/YOLO-only menu and exact YOLO confirmation in the packaged app,
  then cancelled without changing mode or sending a Prompt.
- 2026-09-25: Packaged native authorization acceptance passed. In AUTO, built-in
  `write` created `/tmp/pi67-auto-yolo-acceptance.v0VmLk/auto.txt` without a dialog
  and the activity row projected `AUTO · 常规文件写入`; terminal readback found 21
  bytes with SHA-256 `8986e6700b5d3eb00078ddd06f8cdae3d619d9e839fe79b99742372662b28415`.
  Attempts against `/Users/gaoqian/.ssh/pi67-auto-yolo-acceptance-v0VmLk.txt`
  triggered one-shot authorization and were rejected; terminal verification found
  the sensitive target absent. After explicit YOLO confirmation, built-in `write`
  and exact `rm -- /tmp/pi67-auto-yolo-acceptance.v0VmLk/yolo.txt` both completed
  without per-call approval, and terminal verification found the deleted target
  absent. The packaged task was returned to AUTO afterward. The exact temporary
  acceptance directory was then removed, and the sensitive `~/.ssh` target was
  rechecked as absent.

## Closeout

- Commit base: `8195cface97824a7d95062f5d8846cd254d5e66e`; this plan is included in the authorized scoped local commit.
- Changed files: Domain/Protocol approval and projection contracts; Runtime path/Shell
  safety and controller lifecycle; Renderer selector, approval, localization and
  activity projection; targeted Host/Renderer/Runtime/Protocol tests; PRODUCT,
  DESIGN and process authority.
- Validation completed: affected and aggregate source gates, 108 targeted Vitest
  tests, 18 targeted Renderer Playwright tests, macOS arm64 unsigned package/smoke,
  packaged native UI/copy inspection, and live packaged Pi turns covering ordinary
  AUTO write, sensitive-target interruption, and uninterrupted YOLO write/delete.
- Validation not completed: real Windows x64 packaged/manual acceptance.
- Remaining risks: Windows presentation/runtime parity is unverified; the sensitive
  root set is deliberately conservative and does not claim to enumerate every
  application-specific secret file outside registered capability contracts.
- Commit/push/release state: one scoped local AUTO/YOLO commit is authorized;
  push, upload, release, and deploy remain unauthorized.
