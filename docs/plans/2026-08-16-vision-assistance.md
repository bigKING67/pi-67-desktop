# Visual Assistance and Global Model Settings

Status: complete (local implementation and pre-commit validation)
Owner: Codex
Started: 2026-08-16
Last updated: 2026-08-17

## Goal

Make global Pi Provider, credential, default-model, and visual-assistance settings available without a registered Workspace, and add a first-party visual-assistance path for text-only chat models.

## Non-goals

- Do not add a second Provider registry, Session truth, local HTTP service, or business WebSocket.
- Do not fork or bundle Qwen-MM-Plugins.
- Do not silently switch the selected chat model or silently retry a native image failure through another Provider.
- Do not push, publish, sign, upload, tag, or release.

## Acceptance criteria

- Global model settings load while every persisted Workspace needs identity reconfirmation.
- Project overrides remain unavailable until the Workspace is available and trusted.
- Text-only models can use one configured image-capable Pi model to describe all static images in a turn before the main prompt runs.
- Native image-capable models keep direct image delivery.
- Visual-assistance failure does not invoke the main model and leaves the draft recoverable.
- Pi JSONL persists replayable visual evidence without sending image bytes to the text-only main model.
- The managed capability bundle no longer includes pi-vision-bridge or xtalpi-pi-tools.
- A user-managed `tmwd_browser` or `js-reverse` MCP remains active without falsely degrading Agent Host startup.
- Global and project Provider snapshots cannot overwrite each other when requests finish out of order.
- The release candidate version uniquely identifies the new product bytes.

## Delivery boundary

- Local implementation: authorized
- Commit: the original implementation was committed as `a7c9147`; the current release-review remediation was explicitly authorized for one scoped local commit on 2026-08-17
- Push: not authorized
- Candidate build/upload: not authorized
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `main` was clean at implementation start and five commits ahead of `origin/main`. | `git status --short --branch` | 2026-08-16 |
| OBSERVED | Provider configuration commands require Workspace authority and the Renderer ignores a failed Workspace registration before requesting the configuration. | protocol/controller source | 2026-08-16 |
| OBSERVED | Persisted Workspaces are identity-changed, matching the visible reconfirmation banner and Host error. | bounded workbench state inspection | 2026-08-16 |
| OBSERVED | Pi exposes image capability in model metadata and supports provider-authenticated `completeSimple` calls. | installed Pi SDK types/runtime source | 2026-08-16 |
| OBSERVED | The helper is a first-party mechanism reimplementation informed by Qwen-MM-Plugins commit `06fd61333e226613bb9725ed148156275910aeed`; no upstream source is forked or bundled. | source and capability lock | 2026-08-16 |
| OBSERVED | The final `a7c9147` clean-HEAD check failed because `ProviderEditorSectionRequest` was exported without an external caller. | `corepack pnpm run check` | 2026-08-16 |
| OBSERVED | The active shared Pi Profile already owns `tmwd_browser` and `js-reverse`; startup preserved them but incorrectly converted that normal state into a degraded warning. | bounded active-profile metadata plus startup source | 2026-08-16 |
| OBSERVED | Global and project configuration loads write to one visible store and previously lacked a current-scope fence. | controller/store timing trace | 2026-08-16 |
| OBSERVED | Reusing an in-flight configuration load previously did not restore its requested scope, and global default/vision mutations did not independently reject a current project snapshot. | controller/store timing trace and regression tests | 2026-08-17 |
| OBSERVED | The remote source already has an alpha.23 Windows candidate, so new bytes require a distinct prerelease identity. | package metadata and remote candidate receipt | 2026-08-16 |

## Affected boundaries

- Modules/processes: protocol, domain, Pi runtime, Agent Host startup, Renderer, capability packaging
- Protocol or persisted state: command authority, Pi settings.json, Pi JSONL custom entries
- Platform/artifact: Electron Renderer and macOS arm64 unsigned preview
- Security/privacy: credentials remain masked; images/prompts are not diagnostics
- Existing WIP: none at start

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Global configuration uses App authority and the canonical Agent Host `agentDir`. | Global files exist independently of Workspace identity and trust. | Pi gains multiple concurrently active agent directories. |
| Qwen3.7 Flash is the first setup preset and Doubao Seed 2.0 Mini is second. | Current cost/latency goal and user choice. | Provider availability or current official model support changes. |
| The helper is first-party Pi runtime code. | Preserves the single Provider and Session truth. | Pi SDK removes provider-neutral image completion support. |
| Native image delivery stays primary. | Avoids an unnecessary second call and preserves Provider-native capability. | User explicitly adopts an always-helper product contract. |
| Visual evidence is a non-context custom entry plus a text-only hidden context message. | Keeps JSONL replay while preventing images from reaching a text-only Provider. | Pi adds a native out-of-context attachment evidence entry. |
| A user-managed same-name Browser67 MCP is a ready state, not a degraded state. | The preserved server remains Pi's active configuration; only invalid JSON, revision conflicts, access failures, or integrity failures mean an enhancement did not load safely. | Desktop gains a verified compatibility contract that proves the user server is unusable. |
| The visible Provider store accepts snapshots only for its current scope key. | Prevents late global/project responses and late mutations from replacing the current settings surface. | The store becomes an explicitly keyed multi-snapshot cache. |
| New candidate bytes use `0.1.0-alpha.24`. | Avoids binding two source SHAs and byte sets to the same prerelease file identity. | The previous alpha.23 receipt is explicitly invalidated before any distribution and all replacement identities are recorded. |

## Checkpoints

- [x] 1. Global configuration authority and settings error are corrected.
- [x] 2. Global/project visual settings and Provider presets are implemented.
- [x] 3. Runtime image routing, failure recovery, evidence projection, and explicit retry are implemented.
- [x] 4. Managed legacy vision extensions and documentation are updated.
- [x] 5. Review findings and false degraded-startup handling are implemented with targeted regressions.
- [x] 6. Final scoped-source full gate, production E2E, and exact macOS artifact validation are complete.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | targeted startup/runtime/renderer/packaging tests | scope fencing, correct recovery path, user-MCP preservation, alpha.24 identity | passed; original remediation set passed 5 files and 33 tests; final Provider controller/store rerun passed 2 files and 17 tests |
| Tests | `corepack pnpm run check`; `corepack pnpm run test:e2e` | final exit code and decisive failures | passed after the final scope fix; 558 test files, 2,879 tests passed and 2 skipped in the full gate; production E2E passed 194/194 |
| Runtime/host | production-build Renderer plus Agent Host fixture/smoke | shared Profile with user-managed Browser67 MCP reports ready | passed; exact Host regression reports ready, and packaged smoke completed a real Agent Host roundtrip |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | current scoped source plus packaged smoke and opened repository artifact | passed after the final scope fix for current uncommitted source; `0.1.0-alpha.24` opened at `artifacts/release/mac-arm64/Pi-67 Desktop.app`; `app.asar` SHA-256 `bd9474c44335e8b29f021de87c90a312e827847a05f00bb7a6ed3392eb01d97a` |
| Target OS/manual | macOS Apple Silicon inspection | no false degraded warning and settings/visual-assistance states | source regression and exact packaged runtime passed; direct notification-center inspection remains unverified because the read-only Accessibility request timed out; live billable Provider and Windows x64 validation remain separate |

## Rollback

Revert only the scoped implementation paths. Existing Pi files require no destructive migration: absence of `pi67Desktop.visionAssistant` means disabled, and existing Provider/default-model fields remain valid.

## Risks and unknowns

- Provider aliases and dated model IDs can change; presets must remain editable and runtime capability checks remain authoritative.
- Live Qwen/Doubao verification needs user-owned credentials and explicit approval for billable calls.
- Windows packaged behavior cannot be claimed from the local macOS environment.

## Progress log

- 2026-08-16: Plan activated after clean-worktree and root-cause verification.
- 2026-08-16: App-scope global configuration, trusted project overrides, visual presets, native/helper routing, JSONL evidence, and explicit claimed-attachment retry implemented.
- 2026-08-16: Managed capability catalog reduced to `pi-rules-loader`; legacy visual Tool entries removed without deleting user files.
- 2026-08-16: Full repository check passed with protocol, type, lint, architecture, structure, transport, test, and coverage gates; production-build settings E2E passed 8/8.
- 2026-08-16: Unsigned macOS arm64 preview packaged, passed exact-artifact smoke, and opened from the repository artifact path.
- 2026-08-16: Visual-helper selection was aligned with the Host contract: only configured image-capable models are selectable, and stale unavailable selections remain explicit.
- 2026-08-16: User authorized one scoped local commit; push, tag, release, and upload remain unauthorized.
- 2026-08-16: Release review reopened this plan after finding a dead-code gate failure, a global/project load race, a stale recovery path, alpha.23 identity reuse, and stale validation evidence.
- 2026-08-16: User-managed Browser67 MCP preservation was confirmed as the source of the false degraded-startup warning; normal preservation now remains ready while genuine configuration failures still degrade.
- 2026-08-16: Targeted remediation tests, typecheck, lint, and dead-code checks pass.
- 2026-08-17: Final diff review also fenced reused in-flight loads and all global default/vision writes against the current Provider scope; the final controller/store regressions passed 17/17.
- 2026-08-17: The final full gate passed with 558 test files, 2,879 passing tests, 2 skipped tests, and 82.12% statements, 76.12% branches, 85.96% functions, and 86.08% lines; production E2E passed 194/194.
- 2026-08-17: The current uncommitted alpha.24 macOS arm64 source was repackaged after the final fix, passed exact-artifact smoke including a real Agent Host roundtrip, and opened from the repository artifact path as process 96557.
- 2026-08-16: Read-only desktop inspection was attempted but the macOS Accessibility AppleEvent timed out; no manual UI claim is inferred from the source or smoke evidence.

## Closeout

- Current remediation base: `a7c9147d33261236f1a3078df51dda1249816143`; the containing scoped commit becomes the exact final source identity for the subsequent clean-commit rebuild and candidate receipts.
- Validation completed: targeted startup, Provider scope, visual-assistance recovery, and package-identity tests; full repository gate; full production E2E; exact alpha.24 macOS arm64 packaging, smoke, Agent Host roundtrip, and open.
- Validation still outside this local closeout: direct notification-center inspection, live Qwen or Doubao billable calls, and Windows x64 build/runtime/manual evidence.
- Commit/push/release state: one scoped local remediation commit is authorized; push, tag, release, upload, signing, and promotion remain unauthorized.
