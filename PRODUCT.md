# Product Context

## Register

Developer product and local-first Windows desktop application.

## Platform

Windows 10 22H2 and Windows 11, x64 only.

## Users

- Primary: beginner and intermediate Pi users who should not need a terminal to
  install, configure, or use Pi safely.
- Secondary: experienced Pi/pi-67 users who need their existing configuration,
  sessions, extensions, Skills, Prompts, MCP servers, and TUI workflows to
  remain interoperable.

## Purpose

Install, configure, and use the real upstream Pi runtime through a calm native
Windows workspace while preserving Pi's session and configuration contracts.

## Positioning

Pi-67 Desktop is the native graphical surface for Pi/pi-67. It is not a second
agent implementation, an Electron wrapper, a provider marketplace, or a full
IDE. It favors truthful state, safe recovery, native behavior, and low
operational overhead over feature count.

## Primary jobs

1. Prepare a Windows machine for Pi without manually assembling Git, Node, Pi,
   and pi-67 from a terminal.
2. Open a workspace, understand project trust, start or resume a Pi session,
   and complete a real task.
3. Review tool activity and file changes before sensitive actions occur.
4. Diagnose runtime, configuration, extension, and update problems without
   exposing credentials.
5. Move sequentially between GUI and TUI without losing or translating the Pi
   session.

## Success criteria

- A clean supported Windows x64 machine can reach the first offline RPC smoke
  through guided, individually confirmed steps.
- An existing pi-67 user can reuse `~/.pi/agent` without credential or session
  migration.
- A TUI-created session can be resumed in Desktop and later resumed in TUI.
- Current pi-67 profile capabilities are either verified or explicitly marked
  supported, degraded, blocked, or untested.
- No credential, prompt, source body, or raw tool payload is sent as telemetry.
- The release meets the performance budgets in `docs/testing/performance.md`.

## Accessibility

- Core flows support keyboard-only operation and Windows UI Automation.
- Narrator-accessible names, roles, state, and focus return are release gates.
- High Contrast, 125% through 200% text/DPI, and Reduced Motion are supported.
- Status is never encoded by color alone.
- Chinese is the default language; English has behavioral parity.

## Privacy

- Local-first; no analytics or PostHog in the first release.
- GitHub update checks disclose their network purpose and send no workspace,
  provider, model, session, or credential data.
- Diagnostic export is local, bounded, and redacted by default.

## Non-goals for v0.1

- Embedded code editor or terminal emulator.
- Non-Pi agent providers.
- Concurrent GUI and TUI writers for one session.
- Universal rendering for arbitrary TUI-only `ctx.ui.custom()` components.
- Windows ARM64/x86, macOS, Linux, or a cross-platform abstraction layer.
