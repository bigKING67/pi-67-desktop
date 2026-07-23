# Product Context

## Register

Developer product and local-first cross-platform desktop application.

## Platforms

- Windows 10 22H2 and Windows 11, x64 only.
- macOS 12 or newer, Apple Silicon arm64 only.

## Users

- Primary: beginner and intermediate Pi users who want a clear graphical path
  from workspace selection to a completed coding task.
- Secondary: experienced Pi and pi-67 users who expect their existing
  `~/.pi/agent` configuration, sessions, models, skills, prompts, extensions,
  and TUI workflows to remain interoperable.

## Purpose

Use the real Pi SDK through a calm desktop workspace while preserving Pi's
session, configuration, resource, model, and extension contracts.

## Positioning

Pi-67 Desktop is the graphical surface for Pi/pi-67. It is not a second agent,
a provider marketplace, an RPC wrapper, or a full IDE. It favors truthful
state, fast interaction, safe recovery, and Pi compatibility over feature
count.

## Primary jobs

1. Open a workspace, understand trust, start or resume a managed Pi session,
   and import an external Pi JSONL session without turning its source file into
   Desktop's active writer.
2. Understand Provider authentication status, add a runtime-only API key when
   needed, and select a configured Pi model and readable thinking level without
   editing JSON.
3. Follow streaming reasoning, tools, file changes, and follow-up work without
   losing the current task.
4. Use skills, prompts, extension commands, session tree, rollback, and compact
   from a coherent graphical interface.
5. Diagnose shell, configuration, extension, update, and runtime failures
   without exposing credentials or private content.
6. Move sequentially between Desktop and Pi TUI using the same Pi JSONL session.

## Success criteria

- Both supported platforms can install, launch, and complete an offline SDK
  contract smoke from signed packages.
- Existing users reuse `~/.pi/agent` without credential or session migration.
- Desktop-created and TUI-created sessions can be resumed sequentially in the
  other interface.
- Importing external JSONL keeps the selected source unchanged, creates a
  collision-safe managed copy in the current workspace session directory, and
  resumes that copy with the current workspace as its effective cwd.
- Common Pi extension UI primitives work; TUI-only UI is identified explicitly.
- Production starts no local HTTP server and listens on no application TCP port.
- Welcome does not start the Agent Host or load the Pi SDK until a workspace or
  Agent Host-backed diagnostic action needs it.
- Credential, prompt, source, and raw tool content never enters telemetry or
  default diagnostic logs.
- Provider status may expose only non-secret metadata such as configured state,
  credential source, and model count; complete credential values never cross
  into the renderer.
- Release performance meets `docs/testing/performance.md`.

## Accessibility and localization

- Chinese is the default language; English has behavioral parity.
- Core flows support keyboard-only operation, Narrator, and VoiceOver.
- Focus is restored after dialogs and drawers close.
- Appearance defaults to the operating system and offers explicit System,
  Light, and Dark choices without involving the Agent Host.
- 200% zoom, Reduced Motion, light mode, and dark mode retain all primary actions.
- Status is never encoded by color alone.

## Privacy

- Local-first and no analytics or PostHog in v1.
- The renderer may persist only the non-sensitive appearance preference; it
  does not persist credentials, prompts, source, tool payloads, or session data.
- Update checks disclose their network purpose and send no workspace, provider,
  model, session, or credential data.
- Unsigned Preview checks accept only complete prerelease artifact sets and open
  a canonical GitHub Release page; they never download or install in-app.
- Diagnostic export is local, bounded, and redacted by default.

## Non-goals for v1

- Pi RPC or system-Pi runtime mode.
- Non-Pi agents or providers.
- Concurrent writers for one session.
- Arbitrary rendering of TUI `ctx.ui.custom()` components.
- Embedded code editor, general terminal, or browser panel.
- Windows ARM64/x86, macOS Intel/Universal, or Linux artifacts.
