# Installed capabilities and pane-aligned title bar

Status: complete
Owner: Codex
Started: 2026-08-18
Last updated: 2026-08-18

## Goal

- Make AUTO treat an installed, admitted, uniquely resolved Package or MCP capability as persistently authorized, including authentication, JavaScript, native input, clipboard, external submission, and external file side effects.
- Replace the undifferentiated full-width title identity with one Electron title-bar shell whose visual zones align with the active left navigation, central workbench, and right Inspector panes.

## Non-goals

- Do not weaken PLAN read-only behavior, admit unknown or duplicate Tool identities, or authorize an unconfigured MCP server merely because `pi-mcp-adapter` is installed.
- Do not add another runtime, HTTP server, WebSocket, window, resizable pane system, or Inspector information architecture.
- Do not create a commit, push, candidate, upload, tag, release, or promotion in this task.

## Acceptance criteria

- AUTO executes every operation from an installed/admitted capability without a one-shot approval and records a distinct installed-capability authorization reason.
- ASK keeps its one-shot approval behavior; PLAN remains read-only; malformed, unknown, duplicate, or drifted identities remain blocked.
- A verified `pi-mcp-adapter` proxy call is auto-authorized only after its concrete MCP server/Tool resolves from the effective configured catalog.
- Wide workbench title-bar zones align with the navigation, conversation, and Inspector tracks. The conversation title is centered in the central workbench track.
- At 1320px and below the Inspector zone follows the existing drawer contract; below 760px navigation follows the existing drawer contract. Settings uses a two-zone title-bar topology.
- Relevant unit/E2E tests, full repository gates, and an exact macOS arm64 unsigned packaged preview complete. Windows installed behavior remains a separate target-OS gate.

## Delivery boundary

- Local implementation: authorized
- Commit: not authorized
- Push: not authorized
- Candidate build/upload: not authorized
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `main...origin/main` has prior browser67 migration WIP in Agent Host, packaging smoke, and one pi-mcp-adapter safety test. | `git status --short --branch` | 2026-08-18 |
| OBSERVED | AUTO currently allows configured operations but sends `external-submit`, `credential-or-auth`, and external paths to one-shot approval. | `safety-extension.ts`, `configured-tool-safety.ts`, current tests | 2026-08-18 |
| OBSERVED | TitleBar is a separate application row with two internal tracks, while WorkspaceShell below owns the three-pane grid. | `App.tsx`, `TitleBar.module.css`, `workspace-shell.css` | 2026-08-18 |
| OBSERVED | Existing design already makes Inspector a drawer at 1320px and navigation a drawer at 760px. | `DESIGN.md`, `responsive.css` | 2026-08-18 |

## Affected boundaries

- Modules/processes: Domain operation projection, Protocol schema/revision, Pi Runtime safety extension, Renderer Shell, E2E tests.
- Protocol or persisted state: one additive Tool auto-authorization reason; no persisted user state migration.
- Platform/artifact: Renderer on Windows x64 and macOS arm64; local packaged verification is macOS arm64 only.
- Security/privacy: persistent grant is bound to installed/admitted and uniquely resolved capability identity; invalid identities fail closed.
- Existing WIP: preserve all current browser67 migration files; deliberately replace only the conflicting sensitive-AUTO assertions in the already-modified safety test.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Installation/admission is the AUTO authorization event. | Removes duplicate approvals while retaining source identity and configuration checks. | User restores per-call approval for installed capabilities. |
| Keep risk classification even when AUTO bypasses one-shot approval. | ASK, PLAN, audit, diagnostics, and UI disclosure still need truthful effect categories. | A stronger capability manifest replaces effect classification end-to-end. |
| Use one native draggable title-bar shell with pane-aligned zones. | Preserves Electron caption behavior while making title ownership match layout. | Electron adopts a platform-native pane title API. |
| Center the title in the main pane, not the viewport. | Opening or closing side panes must not detach the title from the conversation plane. | Product removes the pane model. |

## Checkpoints

- [x] 1. Installed/admitted AUTO authorization is implemented and regression-tested.
- [x] 2. Pane-aligned title-bar topology and responsive behavior are implemented and regression-tested.
- [x] 3. Product/design contracts and protocol revision are synchronized.
- [x] 4. Full source gates and exact macOS packaged preview pass.
- [x] 5. Browser67 live identity mismatch explains and preserves the old-source replacement path through file preparation; targeted/full gates and exact macOS preview are rerun.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `corepack pnpm run typecheck`, `corepack pnpm run build`, `corepack pnpm run check`, `git diff --check` | final exit 0 | passed after the repair-flow follow-up; architecture reported 785 modules / 3000 imports / 0 cycles and structure governed 1738 files |
| Tests | targeted Vitest and Renderer Playwright, then full coverage gate | final exit 0 and expected geometry/repair assertions | passed; browser67 targeted unit tests 17/17, Settings resource E2E 8/8, final managed-source repair regression 2/2, managed-source repair visual inspected, and full gate 568 files / 2936 passed / 3 skipped |
| Runtime/host | packaged browser67 setup/install Doctor/live Doctor plus `corepack pnpm run package:smoke:browser67-live` | configured MCP migration and live identity evidence | partially observed; managed files pass install Doctor, Hub and extension transport are reachable, and targeted Chrome preferences proved the active unpacked extension still points to the repo-local browser67 directory. Exact live identity correctly remains closed until the user replaces that browser-owned source. |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | exact repository `.app`, packaged smoke, opened preview | passed after the final service-state follow-up; `artifacts/release/mac-arm64/Pi-67 Desktop.app`, `app.asar` SHA-256 `efd470cce72f065e0b8fdf1941b599a4b0589848bc859a046d3e346d4962ce48`, preview process PID 34925 opened from the repository artifact |
| Target OS/manual | fresh Windows x64 installed candidate | pane geometry, caption controls, installed capability behavior | not authorized / pending |

## Rollback

- Revert only the files introduced by this plan.
- Restore the previous generic approval path and two-track TitleBar without touching prior browser67 migration WIP.
- Regenerate the Protocol revision after any rollback that changes the authorization projection schema.

## Risks and unknowns

- `pi-mcp-adapter` is a gateway; authorization must remain bound to the resolved configured target rather than the adapter name alone.
- CSS title alignment must share the same side-pane variables and breakpoint topology; duplicated constants would drift.
- Windows caption geometry requires real Windows installed evidence after a candidate is separately authorized.

## Progress log

- 2026-08-18: Plan activated after user confirmed both directions. Source and current dirty scope inspected; no external delivery authorized.
- 2026-08-18: Installed/admitted capability authorization was bound to exact configured identity and recorded as `installed-capability`; ASK and PLAN contracts were preserved.
- 2026-08-18: TitleBar was split into navigation, central workbench, and Inspector zones. The conversation identity is centered within the central pane, and existing drawer breakpoints control zone collapse.
- 2026-08-18: Light/dark and 1320px drawer / 1328px docked screenshots were inspected. The title plane remains distinct from the transcript without introducing a terminal-style second shell.
- 2026-08-18: Full repository gates and the exact macOS arm64 unsigned packaged preview passed. The separate browser67 live smoke stopped on a stale active extension build revision rather than accepting identity drift.
- 2026-08-18: Live inspection proved Chrome still loaded a repo-local unpacked browser67 path while Pi-67's managed directory was current. Product recovery copy now distinguishes reloading the same source from replacing an old loaded source; validation is in progress.
- 2026-08-18: The repair dialog retained mismatch context across automatic file preparation, visual inspection passed, full repository gates passed, and exact macOS packaging/smoke/open passed. Browser-owned source replacement remains a manual Chrome step rather than an unsafe profile mutation.
- 2026-08-18: The Desktop service now preserves `reload-required` through managed-file preparation until live Doctor proves identity convergence. Targeted tests, the full 568-file gate, and the exact macOS packaged preview were rerun after this service-state fix.

## Closeout

- Final source SHA: `ec8195f1dcc7e00ddf431335f96b87d5fe2041cb` plus the uncommitted task diff recorded by `git status --short`
- Changed files: Domain/Protocol/Pi Runtime authorization, Renderer TitleBar and responsive shell, Settings disclosure, unit/E2E tests, product/design contracts, plus the preserved browser67 MCP migration WIP already present at task start
- Validation completed: targeted unit/E2E including managed-source recovery, full source and coverage gates, visual screenshot review, exact macOS arm64 unsigned packaging/smoke/open
- Validation not completed: fresh Windows x64 installed candidate/manual acceptance; browser67 real Tool call against the active local extension until Chrome replaces its repo-local unpacked source with the Pi-67 managed directory
- Remaining risks: Windows caption-control geometry still requires Windows evidence; current local browser67 extension source remains stale and intentionally fails the exact identity gate until the manual browser-owned replacement
- Commit/push/release state: no commit, push, candidate, upload, tag, release, or promotion authorized
