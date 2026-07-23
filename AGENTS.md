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
- Extensions cannot inject HTML, JavaScript, or React components into the
  renderer. TUI-only custom UI must fail explicitly instead of hanging.
- Destructive, external, system, or workspace-external actions require an
  explicit one-shot approval.

## Design and quality

- `PRODUCT.md` owns product intent. `DESIGN.md` and `DESIGN.dark.md` own visual
  and interaction authority. Update them with behavior or token changes.
- Use TypeScript 7 strict mode, exact dependency versions, and the frozen pnpm
  lockfile.
- Keep streaming batched, transcripts virtualized, and async work cancellable.
- Add targeted tests for protocol, policy, Pi SDK, recovery, and visible UI
  changes. Do not infer runtime quality from source alone.
- Windows claims require real Windows evidence; macOS claims require real
  Apple Silicon evidence. Browser previews do not prove packaged Electron
  behavior.
- Never commit build output, installers, logs, databases, screenshots, traces,
  sessions, or credentials.
- `commit` does not mean `push`; publishing, signing, GitHub releases, and
  external actions require explicit current authorization.
