# Pi-67 Desktop Repository Instructions

## Product boundary

- This repository builds the Pi-first Electron desktop client for Windows x64
  and macOS Apple Silicon.
- `@earendil-works/pi-coding-agent` is the only agent runtime. Do not add a Pi
  RPC adapter, system `pi` fallback, or non-Pi provider adapters.
- Pi JSONL sessions remain the conversation source of truth. Any application
  index is disposable and rebuildable.
- Peak Code is a pinned product and interaction reference, not a merge upstream.

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

## Security and privacy

- Never log or persist API keys, OAuth tokens, cookies, credential payloads,
  prompts, source bodies, or raw tool payloads by default.
- Project trust controls project resources. It is distinct from one-shot tool
  approval.
- New trusted Workspaces default to `balanced`: bounded Workspace reads/writes,
  current-Session loaded-resource reads, verified read-only web Tools, and
  conservatively classified local checks may run without a duplicate dialog.
  Unknown Shell/third-party Tools and destructive, system, external-path, upload,
  publish, dependency, or remote side effects remain one-shot approvals.
- Extensions cannot inject HTML, JavaScript, or React components into the
  renderer. TUI-only custom UI must fail explicitly instead of hanging.
- Destructive, external, system, or workspace-external actions require an
  explicit one-shot approval. The only Workspace-external read exception is the
  canonical file or Skill directory already loaded by that exact Session's Pi
  `ResourceLoader`; it never grants write or arbitrary home-directory access.

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
  `/reload`, or `/settings` through `command.invoke` or as model Prompts.
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
