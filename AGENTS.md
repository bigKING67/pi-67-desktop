# Pi-67 Desktop Repository Instructions

## Product boundary

- This repository builds the Windows x64 native GUI for upstream Pi and pi-67.
- The real installed `pi --mode rpc` process is the only agent runtime.
- Do not embed, vendor, or silently fall back to a second Pi SDK/runtime.
- The Pi JSONL session is the conversation source of truth. SQLite stores only
  disposable indexes and projections.
- Peak Code is a pinned product/interaction reference, not a merge upstream.

## Platform and UI

- Target Windows 10 22H2 and Windows 11 x64.
- Use C# 14, .NET 10 LTS, WinUI 3, and Windows App SDK.
- Do not add Electron, React, WebView2, Monaco, xterm, or a cross-platform UI
  framework.
- C# owns the first release. Rust is allowed only after the measured adoption
  gate in `docs/adr/0006-rust-adoption-gate.md` passes.
- `PRODUCT.md` owns product intent. `DESIGN.md` owns visual and interaction
  authority. Update them in the same change when behavior or tokens evolve.

## Architecture

- `Domain` is dependency-free business policy.
- `Application` owns use cases and ports and references only `Domain`.
- `PiRpc` implements the Pi RPC port and references `Application`.
- `Infrastructure.Windows` implements Windows, storage, bootstrap, and update
  ports.
- `Presentation` owns view models and does not reference infrastructure.
- `App` is the WinUI composition root and contains no business logic.
- Keep async work cancellable. Do not block the UI thread on process, disk,
  network, SQLite, or JSON parsing.
- Do not create generic `utils`, `helpers`, `common`, `misc`, `temp`, `new`, or
  `final` directories.

## Security and privacy

- Never log or persist API keys, OAuth tokens, cookies, credential payloads,
  prompts, source bodies, or raw tool payloads by default.
- Renderer-style trust boundaries do not apply: there is no embedded web
  renderer or local listening server. Still keep credential DTOs redacted at
  the application/presentation boundary.
- Project trust controls Pi project resources; it is not a sandbox or tool
  approval.
- The Desktop safety extension applies only to Desktop-launched RPC sessions.
- Destructive or external actions require an explicit one-shot approval.

## Quality and release

- Centralize package versions and restore in locked mode.
- Treat warnings as errors and keep architecture tests green.
- Add targeted unit/integration coverage for every protocol or policy change.
- Windows UI claims require real Windows runtime evidence. Static XAML or a
  browser mock is not native proof.
- Never commit build output, installer output, logs, databases, screenshots, or
  traces.
- `commit` does not mean `push`; publishing, signing, GitHub releases, and other
  external actions require explicit current authorization.
