# Image workbench P1: engine, tools and protocol

Status: active
Owner: Claude
Started: 2026-10-08
Last updated: 2026-10-08

## Goal

Bring the image engine into New Money and make it reachable by both the Agent and
the renderer: port the creative-craft image executor as `packages/image-engine`,
register it as first-party Pi tools in `packages/pi-runtime`, define the
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
| OBSERVED | Pi 1.0 `models.json` loads `type: "image"` entries as chat models; an extension layer with `models` replaces the Provider's list; a dedicated Provider with extension `baseUrl` receives the key from `models.json` or `auth.json`; without credentials `generateImages` returns "Provider is not configured" without calling the implementation | temporary real-SDK probe, no network | 2026-10-09 |

## Affected boundaries

- Modules/processes: new `packages/image-engine`; `packages/pi-runtime` (image tools, safety, Provider);
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
- [x] 2. Node Provider adapter: Pi Provider configuration seam; shared fixtures
      for Image Job v2 / Execution Receipt parity; mock Provider in tests. Done
      2026-10-09: `contracts.ts` passes 38 Python-generated golden cases; adapter
      takes an injected `ProviderCredentials` resolver (the Pi seam itself is
      wired in checkpoint 4 via `ctx.modelRegistry.getApiKeyAndHeaders`); 35
      loopback-HTTP Provider tests; engine total 139 tests.
- [x] 3. `packages/protocol`: `image.*` commands/events with schemas and revision
      bump; `packages/domain`: candidate state machine and conflict policy with
      tests. Done 2026-10-09: seven Workspace-scoped `image.*` commands and three
      events; domain image-workbench policy (candidate actions, failure
      classification, edit submission, project location, task budget, prompt
      context block); compile-time protocol↔domain type parity and an engine test
      that every published revision passes `ImageDocumentSchema`; Host routes
      image commands to a fail-closed `UNSUPPORTED` router until checkpoint 5.
- [x] 4. Image Pi tools (first written as `packages/image-pi-extension`, folded into `packages/pi-runtime` at checkpoint 7): `image_*` tools, compact results with
      preview paths; tests. Done 2026-10-09: seven tools (create from photo, read,
      edit, render with inline preview image, candidates, decide, generate); the
      `openai-images` Pi image API on a dedicated `newmoney-images` Provider; the
      engine takes an injected generator routed through Pi `generateImages`. The
      capability build/packaging of this extension moves to checkpoint 7: owned
      extensions are bundled to Node-builtin-only entries, but this one needs the
      engine's native modules (Sharp, resvg) in its tree.
- [x] 5. `apps/agent-host`: engine host, per-project queue, worker pool, cancel,
      task events; tests. Done 2026-10-09: `ImageEngineHost` runs the seven
      commands (trust-gated, renderer changes recorded as `human`), per-project
      serial queue with bounds, two host-wide render slots, request cancellation,
      content-addressed preview cache, change/candidate/job events, typed error
      mapping. The engine loads lazily on the first image command so a missing
      native image runtime cannot stop the Host. "Restart marks running as
      failed" does not apply: Host renders keep no durable state, and Agent
      Provider jobs already report an interrupted `started` as unproven.
- [x] 6. `apps/desktop`: `app://pi67/image/...` read-only route; tests. Done
      2026-10-09: Main serves content-addressed previews for trusted Workspaces
      with digest re-verification; Agent Host watches project folders so Agent
      and Pi TUI changes reach the renderer as events. Changed from the plan
      with reasons in ADR 0010 decision 10: no separate library index (the
      disk is the index) and the watcher lives in Agent Host, not Main.
- [ ] 7. Packaged previews on macOS arm64 and Windows x64 load native modules and
      the font, render a fixture; evidence directory with receipts. macOS arm64 done
      2026-10-09 (`18f9d63f`); Windows x64 pending real-machine or CI evidence.
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

Each checkpoint is additive and revertible on its own. The `image_*` tools are
always registered but load the engine only on their first call, so a missing
native image runtime fails that call and leaves the rest of Desktop unchanged. Protocol additions
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
  Git; THIRD_PARTY_NOTICES and provenance recorded. Committed as `2ee8326c`
  after the full suite (6580 passed, 24 skipped).
- 2026-10-09: checkpoint 2 complete after the handoff below. The first fixture
  set (21 cases) missed size, prompt, reference and rights rules; expanding it
  to 38 Python-generated cases exposed the gap, which the Node port now covers.
  Next: checkpoint 3 (protocol `image.*` and domain policy).
- 2026-10-09: checkpoint 3 complete; protocol revision regenerated.
  The type parity check caught a candidate-status union built with `.map()`
  that had widened to `string`. Structured message context is a deterministic
  text block (`formatImagePromptContext`), not a `prompt.submit` wire change.
  The library index stays a Main concern (checkpoint 6). Next: checkpoint 4
  (`packages/image-pi-extension`).
- 2026-10-09: checkpoint 4 complete after an architecture correction the user
  approved: Pi 1.0 has first-class image models and `generateImages`, so the
  engine's direct Images API call was a non-Pi Provider adapter. ADR 0010
  decision 9 revised; the engine now takes an injected generator. A real-SDK
  probe (temporary directory, no network) showed `models.json` cannot declare
  image models and an extension `models` layer replaces a Provider's model
  list, so image models live on a dedicated `newmoney-images` Provider whose
  base URL and key come from the user's `models.json` entry (or `auth.json`);
  without credentials Pi refuses before calling the implementation. Not yet
  verified: a real image request through Pi (checkpoint 8). Next: checkpoint 5
  (Agent Host engine host replacing the `UNSUPPORTED` router).
- 2026-10-09: checkpoint 5 complete. Found while wiring: a static engine import
  in `host-server.ts` would load Sharp at Host startup, so a packaging or
  native-module failure would have broken conversations too; the engine is now
  a dynamic import and Agent Host's build keeps `@pi67/image-engine` external.
  The image Pi extension still imports the engine statically; checkpoint 7
  must confirm Pi isolates an extension load failure or make it lazy too. Agent
  changes made through Pi tools emit no `image.*` events yet (checkpoint 6
  watcher). Next: checkpoint 6 (Main library index and `app://` preview route).
- 2026-10-09: checkpoint 6 complete. Main may not depend on `@pi67/domain`
  (architecture rule), so protocol re-exports the preview naming helpers.
  Not covered: a first project created by the Agent in a Workspace whose image
  folder did not exist yet is not watched until the next image command
  restarts the watcher; the renderer's own refresh covers it. Runtime check
  still pending: the protocol handler and the lazily loaded engine have not run
  inside Electron yet (checkpoint 7 packaged preview). Next: checkpoint 7.
- 2026-10-09 handoff checkpoint (model switch, same session): checkpoint 2 in
  progress, uncommitted and not yet typechecked. Dirty scope, all inside
  `packages/image-engine`: new `src/provider-profiles.ts` (profiles + surfaces
  loader), new `src/contracts.ts` (Node port of Image Job v2 / Execution Receipt
  validation with Python-identical messages, and `compileImageJob`), edited
  `src/provider-store.ts` (re-exports from provider-profiles), new `schemas/`
  (4 canonical schemas), new `providers/surfaces/openai-image-api.json`, new
  `src/test-support/contract-fixtures.json` (21 golden cases generated by the
  canonical Python validator/compiler on 2026-10-09; the parity test is not
  written yet). Decisions taken: credentials are injected into the engine as a
  resolver (`() => Promise<{ baseUrl, apiKey, headers? }>`), never read from
  files; the Pi seam for the extension is `ctx.modelRegistry.getApiKeyAndHeaders`
  (precedent `packages/pi-runtime/src/first-party-web-tools.ts`); the adapter
  keeps `output_policy`, job claims, partial receipts and offline recovery as in
  the source. Next: port `provider.mjs` → `src/provider.ts` (inject credentials
  and contracts, HTTPS-or-loopback URL policy), `provider-acceptance.mjs` →
  `src/provider-acceptance.ts` (runAcceptance only, no CLI), write
  `contracts.test.ts` (fixture parity) and `provider*.test.ts` (loopback HTTP
  server, 25 source cases minus the two Python-shim cases), export from
  `src/index.ts`, then typecheck/lint/architecture/knip/vitest and commit.
- 2026-10-09: checkpoint 7, macOS arm64 half complete (`18f9d63f`). The user
  approved first-party Desktop customTools over a capability snapshot (ADR 0010
  decision 13). The extension package was folded into `packages/pi-runtime`
  (`image-workbench-*`), because keeping it made pnpm report a workspace cycle
  (its SDK types come from pi-runtime, which now imports its tools). Two
  findings fixed: tool paths had resolved against the Agent Host process
  directory instead of the Workspace, and the path policy only hard-stops
  credential paths for writes, so image tools refuse them explicitly (a photo,
  reference or mask is uploaded or copied). `check` passed (6734 passed, 24
  skipped). `preview:mac:unsigned` packaged smoke passed; it now asserts the
  engine dist, worker, font and unpacked Sharp/libvips/resvg, and renders a CJK
  text project with the packaged executable (`{"status":"rendered"}`). app.asar
  grew from 199.6 MB to 224.0 MB (font 16 MB) plus 21 MB unpacked native modules.
  Not yet verified: Windows x64 packaged load; the engine running inside the
  packaged Agent Host utility process during a real session (checkpoint 8).

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:
