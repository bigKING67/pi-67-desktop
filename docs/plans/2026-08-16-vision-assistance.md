# Visual Assistance and Global Model Settings

Status: complete
Owner: Codex
Started: 2026-08-16
Last updated: 2026-08-16

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

## Delivery boundary

- Local implementation: authorized
- Commit: authorized on 2026-08-16; this plan is included in the scoped local commit
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

## Affected boundaries

- Modules/processes: protocol, domain, Pi runtime, Agent Host, Renderer, capability packaging
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

## Checkpoints

- [x] 1. Global configuration authority and settings error are corrected.
- [x] 2. Global/project visual settings and Provider presets are implemented.
- [x] 3. Runtime image routing, failure recovery, evidence projection, and explicit retry are implemented.
- [x] 4. Managed legacy vision extensions and documentation are updated.
- [x] 5. Source, tests, runtime, and packaged artifact validation are complete.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | targeted protocol/runtime/renderer tests | authority, persistence, routing, projection, error ownership | passed; targeted suites and the full repository gate are green |
| Tests | `corepack pnpm run check`; production-build Renderer E2E | final exit code and decisive failures | passed; 558 test files, 2,868 tests passed and 2 skipped; 8/8 relevant E2E cases passed |
| Runtime/host | production-build Renderer plus Agent Host fixture/smoke | global settings with identity-changed Workspace | passed; App configuration loaded without `workspace.register`, and packaged Agent Host roundtrip passed |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | packaged smoke plus opened repository artifact | passed; repository app opened from `artifacts/release/mac-arm64/Pi-67 Desktop.app` |
| Target OS/manual | macOS Apple Silicon inspection | settings and visual-assistance states | partial; unsigned macOS arm64 package smoke/open passed and fresh light/dark Renderer screenshots passed visual review; no billable Provider call or packaged settings walkthrough was performed |

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

## Closeout

- Base source SHA: `364bc595458c75af74be6e2bedb19ca4cbbf29dc`; the resulting commit identity is recorded by Git because this plan is part of that commit
- Changed files: 83 modified tracked paths plus 13 new plan/runtime/Host/Renderer/E2E paths; 96 working-tree paths in total
- Validation completed: full `check`, final build, 8/8 production-build Renderer E2E, fresh light/dark visual review, unsigned macOS arm64 packaging, packaged Electron smoke, and artifact open
- Validation not completed: live Qwen or Doubao billable API calls, Windows x64 packaging/runtime, and a manual walkthrough of the packaged settings screen
- Remaining risks: Provider aliases/model IDs may drift; actual latency, cost, and response quality remain credential- and Provider-dependent
- Commit/push/release state: one scoped local commit authorized; push, tag, release, and upload remain unauthorized
