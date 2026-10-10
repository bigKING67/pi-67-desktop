# ADR 0010: Image workbench

Status: proposed (direction confirmed by the user on 2026-10-08; no implementation yet)
Date: 2026-10-08

Product model, flows, layout, data model and phases: `docs/architecture/image-workbench-product-model.md`.

## Context

Work mode offers conversations only. The user wants New Money to become an
Agent-driven image workbench — production, editing, processing and optimization —
usable by people who delegate through conversation and by professional designers
who edit directly, with the image task owning its own workbench layout and an
image-specific Inspector.

The starting point is the creative-craft image executor in craft67
(`packages/creative-craft/integrations/image-production`, MIT, ~2.5k lines of
ESM, 99 tests): an editable layered project (image/text/rect objects), immutable
revisions with `base_revision` conflict detection, a candidate staging area with
immutable accept/discard decisions, masked compositing with byte-checked
protected regions, a worker-based renderer (Satori, resvg-js, Sharp, bundled CJK
font) and a GPT Image adapter. The user asked not to evolve this in craft67 but to
bring it into New Money as a product.

Evidence that shaped the decisions:

- creative-craft `ACCEPTANCE.md` (2026-10-04/05): a Pi session editing a title,
  reflowing to 4:5 and undoing took 213–285 s and 17–25 tool calls through Bash,
  with 0 changed protected pixels. A live masked edit changed the product's
  proportions and duplicated a part; the candidate gate caught it. The gateway
  returned 1254 px for a 1280 px request.
- OpenAI documents the edit mask as "entirely prompt-based" and lists text
  placement/clarity and brand-element consistency as limitations.
- Photoroom reports logo/label-text distortion as the most common product-photo
  failure (20.1%).
- Gemini and ChatGPT give images their own entry while every image links back to
  its turn; Midjourney files new images into the open folder; Lovart and Manus put
  conversation and canvas on one screen; Recraft shows the selected object's
  generation receipt; Krea asks for approval only before expensive steps.
- Open-source canvases (ComfyUI, InvokeAI, Krita AI) rely on local HTTP/WS
  servers and GPL code; Compositor is Swift/AppKit for macOS 26+. None can be
  embedded here.
- The repository already owns a first-party Pi extension that registers native
  tools (`packages/openviking-pi-extension`), and ships craft67 Skills as pinned
  capability snapshots.

## Decision

1. **Port the engine; pin the method.** The image executor is ported into this
   repository as `packages/image-engine` (with its tests and shared fixtures) and
   evolves here. The creative-craft Skill (brief, routes, direction, evaluation)
   stays a pinned craft67 capability snapshot like design-craft. The port
   baseline commit is recorded under `docs/provenance`.
2. **One engine in Agent Host.** The engine runs inside the Agent Host utility
   process with rendering and compositing in a `worker_threads` pool (60 s
   timeout, AbortSignal, per-project serial queue, ≤2 projects in parallel).
   `packages/pi-runtime` defines the `image_*` tools so the Agent calls the
   engine directly instead of through Bash (delivery: decision 13). The
   renderer reaches the same engine through `image.*` protocol commands on the
   Agent port. There is one writer process; `base_revision` remains the
   conflict rule between a person's and the Agent's batches.
3. **Artifact truth.** The project directory (`newmoney.image-project.v1`:
   revisions, assets, fonts, masks, candidates, jobs, exports) is the artifact
   source of truth, as Pi JSONL is the conversation truth. The disk is the
   project index (decision 10); project content never enters
   Workbench persistence, logs, diagnostics, telemetry or private memory.
4. **Two channels, one project.** Deterministic edits (text, price, move,
   scale, reorder, aspect reflow, lock, undo, candidate accept/discard) are
   protocol batches applied in milliseconds without a model. Generative and
   judgment work goes to the Agent in a Pi Session with structured context
   (project ID, revision, selected objects, marks, reference slots).
5. **Entry and ownership.** In Work mode the rail shows `图像` between the mode
   switch and `搜索对话`; Chat mode hides it; no placeholder entries. A project
   started from `图像` lives in the app-owned creative library, a profile-owned
   directory registered as an ordinary trusted Workspace that is not Git, never
   enters the Worktree model and is not listed in the folder tree. A project
   started from a Workspace `+` or from a conversation attachment lives in that
   Workspace. Every project and candidate links back to its turn. Exports
   elsewhere are explicit.
6. **Image workbench layout.** An open project keeps the three-region shell:
   canvas with a bottom dock (candidate strip + conversation) in the center, and
   an image Inspector with five equal-width primary tabs `图层 / 属性 / 候选 /
   历史 / 导出` replacing the conversation Inspector tabs. Collapsed, it is a
   delegation surface; expanded, an editor. Visuals follow `DESIGN.md` tokens;
   nothing here pre-authorizes new tokens or copy.
7. **Quality gates are engine code.** Protected-pixel byte checks on candidate
   acceptance; copy/price/logo rendered by the layout layer with OCR checks on
   keyed text at export; size/spec checks; alpha structure checks; VLM output is
   an observation marked `UNVERIFIED`; drift restarts from the base revision.
8. **Budget instead of per-step approval.** Project-level default budget
   (draft candidates at low quality, one final at high, bounded rounds); the
   Agent runs unattended within it and asks once when exceeding it. Accepting or
   discarding candidates, touching locked objects or protected regions, deleting
   or exporting outside the project always need the user.
9. **Model choice is the user's; Pi is the only model route.** (Revised
   2026-10-09.) Image models are Pi `type: "image"` models declared in the
   user's Pi configuration (`models.json`), and every generation goes through
   Pi's `modelRegistry.generateImages()`, so Pi resolves credentials (keys,
   environment, OAuth) and the engine never calls a model API itself.
   `packages/pi-runtime` registers an `openai-images` image API
   implementation through Pi's supported `ProviderConfigInput.images` seam;
   mask, size, quality and background travel in `ImagesOptions.metadata`.
   The engine receives an injected generator and keeps job claims, partial
   receipts, offline recovery and protected-pixel composition. The task
   composer lists the Pi image models the user configured; Desktop recommends
   none and keeps no second credential store. Other image APIs (for example
   Seedream) are added as further Pi image API implementations, not engine
   changes. The first draft let the engine call the Images API directly with
   Pi-sourced credentials; that was a non-Pi Provider adapter and is rejected.
10. **Preview transport.** (Revised 2026-10-09.) Agent Host renders previews
    into a content-addressed cache inside the Workspace; Main serves them through
    the read-only `app://pi67/image/<workspaceId>/<projectId>/<sha256>.png`
    route for persisted, available, trusted Workspaces only, rejecting symlinks,
    escapes and any file whose bytes do not hash to its name. The renderer
    re-reads on `image.project.changed` / `image.candidate.changed`. Agent Host,
    not Main, watches project folders, because the Agent's changes happen in
    the Host process where the event channel lives; the disk is the project
    index, so neither process keeps a second one. No image bytes cross the
    Agent port; no localhost server or local WebSocket.
11. **No labeling.** No visible or metadata AI-content marks. Receipts and
    embedded parameters serve reproducibility and undo only.
12. **Capability scope.** Both audiences share one engine: L1 objects and
    revisions first, then handles/snapping/inline text/multi-select/fonts, then
    groups, per-layer masks, blend modes, non-destructive rotation and basic
    adjustments. Pixel brushes, vector pens, RAW, video, cloud sync and plugin
    SDKs are out of scope for v1.

13. **Delivery: first-party Desktop tools.** (Added 2026-10-09.) Desktop's
    first-party tools (`web_search`, `fetch_content`, `image_models`,
    `generate_image`) are Pi SDK `customTools`, and its first-party Provider
    (Groland) is registered with `ModelRuntime.registerProvider`. The image
    workbench follows the same pattern: `pi-runtime` defines the `image_*` tools,
    injects them into initial, switched and native child sessions, and registers
    the `newmoney-images` Provider beside Groland when the user's `models.json`
    configures it. The Desktop safety policy verifies the exact SDK tool
    identity. The engine, its native modules (Sharp, resvg) and the bundled font
    ship once inside the app and load lazily on first image call. The capability
    snapshot pipeline is not used: it bundles owned extensions into Node-builtin-
    only entries, which cannot carry native image modules without a second
    per-platform copy. A separate extension package is not kept either: it would
    need Pi SDK types from `pi-runtime` while `pi-runtime` imports its tools, a
    workspace cycle. Known limitation: Pi TUI does not get these tools yet; a
    later TUI delivery packages the same definitions as an extension.
    The SDK-native `generate_image` (free-form chat images, not saved) and
    `image_generate` (a staged, protected-pixel candidate for a project) both
    remain, with descriptions that say which to use.

14. **Image generation sources in the Models settings.** (Added 2026-10-09,
    user-approved; supersedes the hand-written `models.json` entry of decision
    9.) Users manage image generation in Settings, never in JSON. Global
    `settings.json` `pi67Desktop.imageGeneration.sources[]` lists sources; each
    has an image API (`openai-images` or `ark-images`), the chosen model ids,
    and either a configured Pi Provider to reuse (address and key follow that
    Provider) or its own HTTPS/loopback address with a key in Pi `auth.json`.
    Every source becomes one Pi image Provider `newmoney-images-<source>`;
    a reused Provider's key is resolved by Pi when the runtime is built and is
    held only in that runtime's memory. The `ark-images` API speaks Volcengine
    Ark Seedream and always sends `watermark: false` (decision 5). The engine
    adds capability profiles for `gpt-image-2.5` and the Seedream 5.0 models,
    plus one generic profile per image API (`model: "*"`, conservative sizes)
    so any model the user picks can run; known models keep their exact
    profile. Gateways may answer with an image URL, which is downloaded under
    the same endpoint policy without the key; a refused parameter is reported
    by name only.

15. **`image_generate` takes an intent; the tool owns the Image Job.** (Added
    2026-10-10, user-approved after the first real Agent run.) A real model could
    not author a valid creative-craft Image Job v2 (about twenty required fields)
    from a schema-less `job` parameter: three attempts failed validation and each
    spent an approval. The tool now takes `project_id`, `target_id`, `model` and an
    `instruction`, with optional `mode` (`edit` default, `generate`), `preserve`,
    `exclude`, `exact_text`, `quality`, `base_revision` and `candidate_id`. It
    reads the project, refuses a stale revision, a non-image or locked target and
    an unavailable model with repair instructions before writing or sending
    anything, builds the job (ids, profile and surface from the model, rights
    `UNVERIFIED` because the tool cannot vouch for them), and attaches the
    target's original file as an edit's first reference. Id fields carry the
    engine's id pattern so a malformed id fails schema validation before the
    approval prompt. The complete-job path stays as an advanced option, with
    `job_id` defaulting to the candidate id.
    Real photos rarely sit on a model's 16px grid, and the engine required the
    request to equal the target raster, so almost no photo could be edited. With
    `output_policy: resize_to_target` the engine now accepts a request of exactly
    the target's aspect ratio; `requestSizeFor` picks the exact-ratio size on the
    profile's grid closest to the target (inside its pixel range, below its
    experimental boundary when possible), and the output is resampled full-frame
    back to the target with the normalization in the receipt. A ratio with no
    exact size on the grid is refused, never cropped or stretched. The first real
    run returned 1122×1402 for a 1088×1360 request (0.04% off the ratio), so
    `resize_to_target` resamples a returned image within 0.5% of the target
    ratio; the receipt keeps both sizes and anything further is still refused.
    A failed run now names the receipt's error codes instead of pointing the
    Agent at a receipt it cannot read. `image_project_edit` gets the same treatment:
    its operations carry a schema mirroring the engine's exact field checks (the
    run guessed six unlock shapes), so a malformed batch is refused before
    approval with the first mismatching field named; `add_asset` sources are
    classified by path like photos and resolve against the Workspace.

## Consequences

- Satori, resvg-js, Sharp and the CJK font become Desktop dependencies; native
  binaries for Windows x64 and macOS arm64 are locked and verified in packaging.
  Windows claims need Windows evidence.
- The port diverges from craft67; later upstream improvements are absorbed by
  hand with provenance, not synchronized.
- `image.*` commands and events extend the protocol revision; the Pi extension
  is built under the Desktop-owned extension build boundary.
- Agent Host carries CPU-heavy work in workers; if profiling shows it breaks the
  Host's responsiveness or memory budget, the engine moves to its own utility
  process with policy and queue staying in Host (same rule as packaged Git).
- The creative library is a real Workspace with trust, catalog and recovery
  semantics; Workspace-only controls must hide or re-label on library projects.
- Every behavior here updates `PRODUCT.md`/`DESIGN.md` in the change that
  implements it.

## Rejected alternatives

- Evolving the executor inside craft67 and consuming it as a CLI snapshot: keeps
  Bash round-trips, blocks product-driven format evolution, and was declined by
  the user.
- Running the engine as a Main subprocess with the Agent calling a CLI (the
  first draft of this ADR): two writers on one directory and model-free edits
  still crossing process boundaries twice.
- Embedding Compositor or any GPL canvas; tldraw (license key) and LobeHub
  (commercial addendum). Patterns borrowed, no module reused.
- A local HTTP/WS server between renderer and engine: violates the transport
  rule.
- Asking which repository every image task belongs to: the library default and
  the `+`-in-Workspace rule remove the question.
- Letting the Agent perform every edit: measured minutes per trivial change.
- Confirming every expensive step: a task budget asks once.
- Flattening layers or stacking edits on model output: layered project plus
  base-revision restart.
- Treating a VLM "pass" as approval: documented judge bias on artifacts, text,
  layout and position.
- Any AI labeling by default or as metadata: declined by the user.
- Node graphs or preset walls as the entry: more to manage, not less.
