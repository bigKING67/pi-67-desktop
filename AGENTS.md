# Pi-67 Desktop Repository Instructions

## Product boundary

- This repository builds the Pi-first Electron desktop client for Windows x64
  and macOS Apple Silicon.
- `@earendil-works/pi-coding-agent` is the only agent runtime. Do not add a Pi
  RPC adapter, system `pi` fallback, or non-Pi provider adapters.
- Pi JSONL sessions remain the conversation source of truth. Any application
  index is disposable and rebuildable.
- `pi-gui` and `t3code` are the only comprehensive implementation references.
  Either may inform product, interaction, UI, design, architecture, Harness,
  runtime lifecycle, recovery, tests, and engineering quality. Neither is a
  merge upstream or overrides Pi-67 product and security contracts.

## Harness contract

- Treat Pi as the only harness and agentic-loop authority. Use supported Pi SDK,
  ResourceLoader, Extension, Tool, and Provider seams; do not introduce a second
  prompt composer, agent loop, Tool orchestrator, model router, or Session truth.
- Keep Desktop-added system context bounded, purpose-specific, reviewable, and
  injected through supported Pi seams. Preserve Pi resource precedence and
  user-owned `SYSTEM.md`, `APPEND_SYSTEM.md`, `AGENTS.md`, Skills, and Prompts.
- The model chooses when and how to request an available Tool. Desktop owns exact
  Tool identity/schema exposure, authorization, execution lifecycle,
  cancellation/recovery, and truthful Tool Result projection. Safety modes and
  Plan constraints restrict availability or execution; they do not create a
  second workflow planner.
- Keep the selected model, Provider, and protocol explicit and stable for a Turn.
  Do not silently switch or retry through another model, Provider, protocol,
  Extension, MCP service, search path, or runtime unless a narrower product
  contract explicitly requires and exposes that behavior.

## Platform and runtime

- Release only Windows x64 NSIS and macOS arm64 DMG/ZIP artifacts.
- Production renderer assets load through `app://pi67`; do not add an internal
  HTTP server, localhost listener, or business WebSocket.
- Development may use Vite on `127.0.0.1` for assets and HMR only.
- Pi runs inside the Electron Agent Host utility process. The renderer must not
  import Electron, Node, the Pi SDK, or filesystem APIs.
- Keep `contextIsolation`, renderer sandboxing, strict CSP, and the narrow
  preload bridge enabled.

## Architecture

- `packages/domain` owns dependency-free policy and state machines.
- `packages/protocol` owns validated cross-process commands and events.
- `packages/extension-compat` owns declarative Extension Adapter manifests,
  SemVer/provenance validation, and the immutable registry. It must not load or
  execute Extension code, import the Pi SDK, or render UI.
- `packages/pi-runtime` owns the `AgentRuntime` port, `PiSdkRuntime`, and the
  extension UI bridge.
- `apps/agent-host` owns the utility-process command router and recovery state.
- `apps/desktop` owns Electron Main, Preload, Repository/Worktree/Git policy,
  durable Desktop state, windows, updates, dialogs, and process lifecycle.
- `apps/renderer` owns React product UI and design-system implementation.
- `eng/` owns development, quality, packaging, performance, capability
  preparation, and release tooling. Generated evidence remains ignored output.
- Do not create generic `utils`, `helpers`, `common`, `misc`, `temp`, `new`, or
  `final` directories. Shared code needs two real callers.

## Repository and worktree hygiene

- This section governs developer/agent Git worktrees used to isolate changes to
  this repository. It does not constrain or authorize Pi-67's user-facing
  app-owned Repository/Worktree environments or their test fixtures; those
  follow `docs/architecture/worktree-product-model.md`.
- `/Users/gaoqian/Documents/sixseven/codeproject/pi-67-desktop` is the canonical
  local development checkout. Continue routine work directly in this root
  checkout; do not create another clone, repository, copied project directory,
  or sibling worktree merely to obtain a clean baseline or run work in parallel.
- A temporary `git worktree` is an exception, not a default workflow. Use one
  only when a prescribed exact-SHA candidate/recovery flow requires isolation,
  or when verified conflicting WIP makes the root checkout unsafe to modify,
  and only with explicit current user authorization and a bounded cleanup plan.
- Keep at most one active temporary task worktree. Create it with Git worktree
  commands rather than a raw directory copy, never treat it as a second
  repository or permanent backup, and keep the canonical root checkout as the
  intended final workspace.
- When the isolated task ends, preserve, integrate, or discard older WIP only as
  authorized; then remove the registered worktree with `git worktree remove`,
  clean up its temporary branch after reachability verification, and confirm
  that only the canonical root checkout remains.

## Execution plans and lightweight development workflow

- L0 and L1 work stays in the current CLI context and Git diff. Do not create a
  persistent task runtime, task pointer, journal, or generated workflow artifact
  for routine work.
- L2 work uses one execution plan under `docs/plans/` following `PLANS.md`. Keep
  the plan focused on durable decisions, checkpoints, evidence, rollback, and
  the explicit delivery boundary; do not copy raw conversation history into it.
- Implementation is native-first: the current CLI or its native sub-agents own
  implementation. Use an independent reviewer only when risk or the user asks
  for one, and never let a reviewer edit concurrently with the main session.
- Switching Codex, Claude Code, Pi, or Grok is sequential. Before handoff,
  record a bounded checkpoint in the active execution plan or an explicitly
  requested handoff: goal, Git/dirty scope, decisions, validation, risks, and
  next action. The receiving CLI must re-check live Git and runtime state.
- Git, current files, tests, packaged artifacts, and target-platform evidence
  remain authoritative. Plans, handoffs, AI memories, and reviewer reports are
  supplemental and never become product runtime, Session, release, or Git truth.
- Do not install or regenerate a repository-wide workflow scaffold merely to
  coordinate one developer or an occasional cross-CLI review. Reintroducing one
  requires a demonstrated recurring handoff problem and explicit user approval.

## Security and privacy

- Never log or persist API keys, OAuth tokens, cookies, credential payloads,
  prompts, source bodies, or raw tool payloads by default.
- Project trust controls project resources. It is distinct from one-shot tool
  approval.
- New trusted Workspaces default to `balanced`: bounded Workspace reads/writes,
  current-Session loaded-resource reads, verified read-only web Tools, and
  conservatively classified local checks may run without a duplicate dialog. An
  enabled Package or MCP capability whose installed content is admitted and whose
  effective Tool identity resolves uniquely is also an AUTO authorization grant,
  including its destructive, system, external-path, upload, authentication,
  publish, dependency, or remote side effects. ASK remains one-shot; PLAN remains
  read-only. Unknown, unconfigured, duplicate, malformed, drifted, or ambiguous
  capabilities fail closed instead of inheriting that grant.
- Extensions cannot inject HTML, JavaScript, or React components into the
  renderer. TUI-only custom UI must fail explicitly instead of hanging.
- Destructive, external, system, or workspace-external actions outside an exact
  installed-capability AUTO grant require an explicit one-shot approval. Loaded
  resources alone never create that grant: the only Workspace-external read
  exception is the canonical file or Skill directory already loaded by that exact
  Session's Pi `ResourceLoader`; it never grants write or arbitrary home-directory
  access.

## Candidate distribution

- `docs/release/internal-candidate-distribution.md` is the canonical daily
  development flow: source-only Git boundary, exact-SHA Windows/macOS builds,
  packaged smoke, three versioned product files in Feishu, and target-OS manual
  testing. Stop there by default; do not create a Tag, GitHub Release, or
  promotion without separate current authorization.
- Windows Actions artifacts are temporary build transport, not the product
  download channel. Distribute the Windows x64 NSIS EXE and macOS arm64 DMG/ZIP
  through the configured internal Feishu Drive folder. Do not use Taildrop.
- Upload only the three current, versioned product files. Do not use ambiguous
  `latest` names. Re-list the Feishu folder after upload and verify the expected
  names and sizes before asking for manual-test confirmation.
- Feishu is an internal distribution mirror, not the artifact identity
  authority. Bind every test result to the source SHA, workflow run/attempt when
  applicable, candidate identity, size, and SHA-256 recorded by the build.
- Keep the Feishu folder URL/token and all Feishu credentials or login state
  outside the repository. Resolve the destination from operator configuration,
  such as `PI67_FEISHU_CANDIDATE_FOLDER_TOKEN`.
- Uploads, remote candidate deletion, promotion, and publishing each require
  explicit current authorization. Distinct file tokens may upload in parallel;
  never write one file token concurrently. Do not remove the previous candidate
  until the replacement set is uploaded and verified, and cleanup is authorized.
- An explicitly authorized unsigned in-app R2 update follows
  `docs/release/internal-r2-update-distribution.md`. Feishu candidate success
  does not authorize R2 artifact or manifest publication, retention deletion,
  cache purge, withdrawal, promotion, Tag, or GitHub Release.

## Validation routing

- Start with affected-package typecheck/tests and the exact boundary gate.
- `corepack pnpm run check` is the aggregate source-quality gate for cross-module,
  high-risk, candidate/release, or unclear-impact changes; it is not packaged or
  target-OS evidence.
- Extension Adapter manifest, registry, or provenance changes additionally
  require `corepack pnpm run verify:extension-adapters`.

## Design and quality

- `PRODUCT.md` owns product intent. `DESIGN.md` and `DESIGN.dark.md` own visual
  and interaction authority. Update them with behavior or token changes.
- Use TypeScript 7 strict mode, exact dependency versions, and the frozen pnpm
  lockfile.
- Keep streaming batched, transcripts virtualized, and async work cancellable.
- Add targeted tests for protocol, policy, Pi SDK, recovery, and visible UI
  changes. Do not infer runtime quality from source alone.
- Build grouped choices with React Aria `ListBoxSection` and `Header`, not
  disabled heading options. Derive grouping from authoritative identity,
  preserve source order and stable option identity, and test section semantics,
  keyboard traversal, recovery selection, and exactly-once dispatch.
- Renderer-owned Pi Desktop Slash actions must call the existing feature
  Controllers. Do not send `/new`, `/model`, `/compact`, `/resume`, `/tree`,
  `/reload`, `/settings`, `/plan`, or `/default` through `command.invoke` or as
  model Prompts.
- Plan and Search are first-party Pi SDK capabilities. Desktop Tasks must not load
  `@narumitw/pi-plan-mode`, `pi-web-access`, or `pi-smart-fetch`; preserve existing
  user settings until an explicit uninstall. Renderer Plan implementation requests
  contain only `planId + submissionId`, never Plan Markdown.
- `Groland` is one built-in mixed-protocol Provider with one credential. Keep
  authoritative model membership and protocol mapping in `packages/domain`:
  Claude-family members use Anthropic Messages and GPT-family members use OpenAI
  Responses. All Groland members support text, image, and reasoning. Native-search
  UI is a declaration, not live verification, and a sent native request must never
  silently fall back.
- Windows claims require real Windows evidence; macOS claims require real
  Apple Silicon evidence. Browser previews do not prove packaged Electron
  behavior.
- On macOS Apple Silicon, after a completed user-visible change set passes its
  relevant gates, run `corepack pnpm run preview:mac:unsigned` by default unless
  the user asks not to relaunch. This must quit the old preview, package, smoke,
  and open the repository artifact; `open` alone is not proof that new renderer
  assets were loaded.
- Never commit build output, installers, logs, databases, screenshots, traces,
  sessions, or credentials.
- `commit` does not mean `push`; publishing, signing, GitHub releases, and
  external actions require explicit current authorization.
