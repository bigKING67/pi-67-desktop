## Context

The client must serve beginner users without reducing compatibility for current
pi-67 users. It must remain native Windows, local-first, high-performance, and
maintainable. The local development host is macOS and cannot provide final
WinUI runtime evidence.

## Goals / Non-Goals

### Goals

- One truthful execution path through real Pi RPC.
- Native Windows UI and accessibility.
- Recoverable installation and session lifecycle.
- Explicit trust, approval, compatibility, and error states.
- Layered, testable, performance-budgeted source.

### Non-Goals

- Full native IDE or terminal emulator in v0.1.
- Cross-platform UI.
- Embedded Pi SDK/runtime.
- Universal TUI custom component rendering.
- Rust before a measured hotspot exists.

## Decisions

- C#/.NET 10/WinUI 3 balances Windows integration, performance, tooling, and
  long-term maintenance better than raw C++ or Rust UI.
- Pi RPC stdout is parsed as byte-oriented LF JSONL with bounded channels.
- Pi sessions remain canonical; SQLite is disposable projection state.
- A Node helper imports the same installed Pi package for auth/model/trust APIs.
- The Desktop safety extension uses official Pi hooks and applies only to
  Desktop-started sessions.
- WiX Burn installs framework dependencies; the app then guides Git/Node/Pi/
  pi-67 steps separately.
- Desktop source and binaries ship from `bigKING67/pi-67-desktop`; the pi-67
  repository links to verified releases.

## Risks / Trade-offs

- WinUI cannot be built or observed on the current macOS host. Mitigation:
  cross-platform core tests, Windows CI, then controlled Windows VM evidence.
- Pi control exports can drift. Mitigation: compatibility manifest, dynamic
  bridge capability detection, and no old-SDK fallback.
- Arbitrary TUI custom UI is not representable through current RPC. Mitigation:
  standard RPC fallback for known core extensions and explicit compatibility
  status for the rest.
- Framework-dependent deployment adds prerequisites. Mitigation: WiX Burn
  inventory, official redistributables, hashes, and replayable install tests.

## Migration Plan

There is no Desktop predecessor. Existing Pi configuration and sessions remain
in place. Uninstalling Desktop leaves all Pi and workspace data untouched.

## Open Questions

None blocking initial implementation. Signing identity and real Windows pilot
machines are release-time external dependencies.
