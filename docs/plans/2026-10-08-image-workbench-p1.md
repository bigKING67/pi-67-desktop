# Image workbench P1: engine, tools and protocol

Status: active
Owner: Claude
Started: 2026-10-08
Last updated: 2026-10-08

## Goal

Bring the image engine into New Money and make it reachable by both the Agent and
the renderer: port the creative-craft image executor as `packages/image-engine`,
register it as Pi tools through `packages/image-pi-extension`, define the
`image.*` protocol, host it in Agent Host with a worker pool and queue, and prove
native modules and the font load from packaged trees on macOS arm64 and Windows
x64. No visible UI ships in P1 beyond what tests need; P2 adds the workbench.

Product model: `docs/architecture/image-workbench-product-model.md`; decisions:
`docs/adr/0010-image-workbench.md`.

## Non-goals

- Rail entry, creative library, canvas, Inspector tabs (P2/P3).
- New object types, masks, groups, blend modes (P4). Batch/templates (P5).
- Any AI-content labeling. Any change inside craft67.
- Release, candidate upload, push without separate authorization.

## Acceptance criteria

| Criterion | Target |
| --- | --- |
| Ported engine tests | all 99 original tests pass in this repository, plus shared fixtures for the Node Provider adapter |
| Agent path | a real Pi session in Desktop completes "swap background (3 candidates) → add title → undo" through `image_*` tools; tool calls and wall clock recorded; target ≤ 8 calls for the edit/undo part |
| Protected pixels | 0 bytes changed in protected regions across the session's exports |
| Direct path | `image.project.edit` from a renderer test harness round-trips a title change with a refreshed preview in < 1 s |
| Conflict | a stale `baseRevision` is rejected with a typed reason and never silently rebased |
| Packaged trees | Sharp, resvg-js and the bundled font load and render one fixture on macOS arm64 and Windows x64 packaged previews |
| Credentials | the adapter reads Provider base URL and key only from Pi Provider configuration; no `~/.codex` reads remain |

## Delivery boundary

- Local implementation: pi-67-desktop only.
- Commit: scoped, after gates; separate authorization.
- Push / candidate / release: not in this plan.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Executor: ~1.8k lines ESM source, 90 `node:test` cases (25 Provider), deps satori 0.35.0 / resvg-js 2.6.2 / sharp 0.35.5, bundled Noto Sans CJK SC; MIT | craft67 `integrations/image-production` at `8e2a37f8` | 2026-10-08 |
| OBSERVED | Ported engine: typecheck, oxlint, architecture (0 cycles), structure, knip and dependency audit pass; 63/63 vitest tests pass on macOS arm64 Node 24 in 18 s | `corepack pnpm exec vitest run packages/image-engine` | 2026-10-08 |
| OBSERVED | Adapter currently reads `~/.codex/config.toml` and `auth.json`; Provider contract validation and prompt compilation live in the Python Skill scripts | executor README | 2026-10-08 |
| OBSERVED | Agent via Bash CLI: 213–285 s, 17–25 tool calls for title edit + reflow + undo | executor `ACCEPTANCE.md` | 2026-10-04 |
| OBSERVED | First-party Pi extension precedent with `pi.registerTool` | `packages/openviking-pi-extension/tools.ts` | 2026-10-08 |
| OBSERVED | Desktop ships private Node; craft67 Skills ship as pinned snapshots; Desktop-owned extension build boundary exists | `PRODUCT.md`, `docs/architecture/processes-and-protocol.md` | 2026-10-08 |
| ASSUMED | Sharp/resvg prebuilt binaries load from the packaged tree on Windows x64 | none yet | — |
| ASSUMED | Agent Host responsiveness holds with 2 render workers | none yet | — |

## Affected boundaries

- Modules/processes: new `packages/image-engine`, `packages/image-pi-extension`;
  `packages/protocol` (`image.*`), `packages/domain` (candidate state machine,
  conflict/budget policy); `apps/agent-host` (engine host, queue, worker pool,
  task events); `apps/desktop` (library index skeleton, `app://` preview route);
  `apps/renderer` (protocol client only).
- Protocol or persisted state: additive commands/events; `userData/image-library/`
  index and thumbs (discardable).
- Platform/artifact: new native dependencies in both packaged trees; font and
  license files added to the structure governance.
- Security/privacy: new privileged routes (`app://` image reads, engine commands)
  accept only indexed project IDs, revision numbers, validated batches and
  allowlisted asset sources; no prompts/images in logs or diagnostics.
- Existing WIP: none known in these paths; re-check `git status --short` before
  editing.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Engine in Agent Host with worker threads | one writer, in-process tools, no second process until profiled | Host responsiveness/memory budget breached |
| Port, not pin | product-driven format evolution; user decision | — |
| Adapter credentials from Pi Provider config | Pi config is the truth source; no second store | Pi seam unavailable → feature stays disabled, not bypassed |
| `base_revision` is the only serialization | engine already enforces it | conflicts prove unrecoverable |
| Format `newmoney.image-project.v1` with read-only import of `local-image.v1` | clean ownership without rewriting user directories | — |

## Checkpoints

- [x] 1. `packages/image-engine`: port sources and tests; structure/dead-code/
      license governance pass; fonts fetched and hashed in build. Done 2026-10-08:
      63 vitest tests (the executor's 65 non-Provider `node:test` cases minus 3
      CLI-argument tests plus a legacy-schema test); Provider execution and its 25
      tests move to checkpoint 2. Baseline and file map: `docs/provenance/image-engine-port.md`.
- [ ] 2. Node Provider adapter: Pi Provider configuration seam; shared fixtures
      for Image Job v2 / Execution Receipt parity; mock Provider in tests.
- [ ] 3. `packages/protocol`: `image.*` commands/events with schemas and revision
      bump; `packages/domain`: candidate state machine and conflict policy with
      tests.
- [ ] 4. `packages/image-pi-extension`: `image_*` tools, compact results with
      preview paths; build under the Desktop-owned extension boundary; tests.
- [ ] 5. `apps/agent-host`: engine host, per-project queue, worker pool, cancel,
      restart marks running → failed, task events; tests.
- [ ] 6. `apps/desktop`: library index skeleton and `app://pi67/image/...`
      read-only route scoped to indexed projects; tests.
- [ ] 7. Packaged previews on macOS arm64 and Windows x64 load native modules and
      the font, render a fixture; evidence directory with receipts.
- [ ] 8. Real Pi session through Desktop meets the Agent-path criteria; tool-call
      count and wall clock recorded.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `corepack pnpm run check` | pass | pending |
| Tests | engine, protocol, domain, extension, host targeted tests | pass + coverage thresholds unchanged | pending |
| Runtime/host | real Pi session in dev Desktop | tool calls, wall clock, protected-pixel report | pending |
| Packaged artifact | `preview:mac:unsigned`; Windows candidate preview | native module and font load, fixture render | pending |
| Target OS/manual | Windows x64 machine run | screenshots/receipts | pending |

## Rollback

Each checkpoint is additive and revertible on its own. The Pi extension is
registered only when the engine host starts successfully; a failed start leaves
Pi without `image_*` tools and the rest of Desktop unchanged. Protocol additions
are additive. No user directories are rewritten (import is read-only).

## Risks and unknowns

- Native module loading from packaged trees on Windows.
- Memory of decoded 8192 px canvases in workers (≈268 MB RGBA each); concurrency
  capped at 2.
- The Pi seam for reading Provider base URL/credentials for a non-text Provider
  must be a supported mechanism; if none exists, image generation stays disabled
  until one is added through Pi configuration, never through a parallel store.
- Tool-call count may still exceed 8 for creative steps; structured context
  arrives in P2.

## Progress log

- 2026-10-08: plan created after the user confirmed the port-into-New-Money
  direction, Agent Host hosting and the image workbench layout; no code yet.
- 2026-10-08: checkpoint 1 complete. `packages/image-engine` (TypeScript strict,
  worker_threads renderer, `newmoney.image-project.v1` with read-only legacy
  import) registered in `build:packages`, `prepare:image-engine` (font fetch +
  worker build before vitest), knip and the vitest alias; font binary ignored in
  Git; THIRD_PARTY_NOTICES and provenance recorded. Next: checkpoint 2 (Node
  Provider adapter reading Pi Provider configuration).

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:
