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
- `packages/pi-runtime` owns the `AgentRuntime` port, `PiSdkRuntime`, and the
  extension UI bridge.
- `apps/agent-host` owns the utility-process command router and recovery state.
- `apps/desktop` owns Electron Main, Preload, windows, updates, dialogs, and
  process lifecycle.
- `apps/renderer` owns React product UI and design-system implementation.
- Do not create generic `utils`, `helpers`, `common`, `misc`, `temp`, `new`, or
  `final` directories. Shared code needs two real callers.

## Repository and worktree hygiene

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

## Execution plans

- Use `PLANS.md` for L2 work that spans modules, sessions, migrations, recovery,
  or candidate/release checkpoints. Do not create a plan artifact for routine L0
  or L1 work.
- Execution plans are temporary coordination and evidence artifacts, not a second
  product, architecture, runtime, session, or release source of truth.
- Trellis is not part of the current solo-developer workflow. Reconsider it only
  when sustained multi-owner work requires dependency, ownership, and priority
  state that Git, `PLANS.md`, and handoffs cannot represent reliably.

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

## Design and quality

- `PRODUCT.md` owns product intent. `DESIGN.md` and `DESIGN.dark.md` own visual
  and interaction authority. Update them with behavior or token changes.
- Use TypeScript 7 strict mode, exact dependency versions, and the frozen pnpm
  lockfile.
- Keep streaming batched, transcripts virtualized, and async work cancellable.
- Add targeted tests for protocol, policy, Pi SDK, recovery, and visible UI
  changes. Do not infer runtime quality from source alone.
- Renderer-owned Pi Desktop Slash actions must call the existing feature
  Controllers. Do not send `/new`, `/model`, `/compact`, `/resume`, `/tree`,
  `/reload`, `/settings`, `/plan`, or `/default` through `command.invoke` or as
  model Prompts.
- Plan and Search are first-party Pi SDK capabilities. Desktop Tasks must not load
  `@narumitw/pi-plan-mode`, `pi-web-access`, or `pi-smart-fetch`; preserve existing
  user settings until an explicit uninstall. Renderer Plan implementation requests
  contain only `planId + submissionId`, never Plan Markdown.
- `Groland` is one built-in mixed-protocol Provider with one credential. Keep its
  five Claude models on Anthropic Messages and two GPT models on OpenAI Responses;
  all seven support text, image, and reasoning. Native-search UI is a declaration,
  not live verification, and a sent native request must never silently fall back.
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
