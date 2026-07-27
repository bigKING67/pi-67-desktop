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
- The Extension Catalog hides Desktop-internal policy extensions and reports
  command, tool, shared UI, and TUI-only surfaces. Package-attributed Adapter
  compatibility requires Pi-resolved package manifest evidence, canonical installed
  SemVer, Registry version matching, and final runtime surface ownership; it never
  implies shared `ctx.ui` caller attribution.
- Production starts no local HTTP server and listens on no application TCP port.
- Welcome does not start the Agent Host or load the Pi SDK until a workspace or
  Agent Host-backed diagnostic action needs it.
- Credential, prompt, source, and raw tool content never enters telemetry or
  default diagnostic logs.
- Provider status may expose only non-secret metadata such as configured state,
  credential source, and model count; complete credential values never cross
  into the renderer.
- Release performance meets `docs/testing/performance.md`.
- Prompt drafts and attachments are cleared only after the Agent Host accepts
  the operation for the same Host epoch, Session ID, and Session generation that
  submitted it. Transport failure, Host replacement, or a concurrent Session
  switch preserves the draft and rotates the retry submission identity.
- Long-running work has an explicit accepted/running/waiting/terminal lifecycle,
  and Host replacement cannot make a stale response or extension request current.
- Visible Turn activity is derived from real Pi SDK events and owned by the Agent
  Host. The renderer does not infer thinking, Tool use, or interactive-wait state
  from local UI actions, and unknown Provider phases remain generic running state.
- Steer and follow-up delivery is strictly FIFO and bounded in the Agent Host.
  The Host admits at most 32 queued delivery commands by default and fails closed
  with `RESOURCE_LIMIT_EXCEEDED` instead of growing an unbounded Promise chain.
  Clearing the queue cancels Host-admitted work that has not reached Pi, waits for
  the current delivery to finish, clears Pi's accepted queue, and orders later
  delivery behind that barrier without returning Prompt content.
- A hung Pi abort cannot leave Desktop permanently busy or release a second Turn
  into the same Runtime. A bounded watchdog marks the Operation lost and replaces
  the poisoned Agent Host through the supervised restart policy.
- A same-Host MessagePort interruption renews the Port and resynchronizes the
  active projection without reinitializing Pi; only a new Host epoch restores
  the runtime from workspace and Session authority.
- Application quit is fenced by Main: the Agent Host stops accepting commands,
  invalidates queued work, cancels interactive requests, attempts to abort the
  active Operation, disposes the Pi Runtime, and exits before Electron continues
  quitting. A bounded deadline force-kills an unresponsive Host rather than
  leaving an Agent or Tool process behind indefinitely.
- Synchronous runtime, workspace, Session, model, thinking, and resource mutations
  use stable idempotency keys and a bounded same-key transport retry. Lost responses
  cannot duplicate Session creation or replay a control mutation into a newer Session
  generation.
- Session import, compaction, and Extension command invocation use caller-stable
  submission IDs and content fingerprints. They may retry one accepted acknowledgement
  only while the same Host epoch remains authoritative; a replacement Host never
  receives an automatic replay. Prompt image submissions remain user-retry-only because
  their transferred buffers are consumed by the first transport attempt.
  Once an Operation settles, same-Host replay returns its typed completed, failed,
  cancelled, or lost receipt instead of downgrading the UI to accepted or busy.
  Same-Host projection recovery may restore that receipt only when its Operation ID
  matches the task interrupted by the connection gap; unrelated history and receipts
  from a replacement Host never become current.
  Renderer notifications project those terminal receipts into one memory-only history
  entry keyed by `hostEpoch + operationId`, so realtime events, ACK replay, and resync
  cannot produce duplicate task outcomes. The history is capped at 50 entries, the
  recent terminal dedupe ledger at 512 keys, visible Toasts at four, and closing a
  Toast never deletes its history entry.
  Cancellation is advertised only when the Host owns a real abort path; an
  uninterruptible Session import never reports a false stopped state.
- Active Operations publish bounded typed heartbeats separately from business
  activity. Business inactivity may produce a non-terminal quiet warning while a
  responsive Host continues running; overdue control-plane heartbeats progress from
  warning to one same-Host projection resync and never manufacture a failed result.
  Approval and Extension input waits remain user-owned and do not trip the watchdog.
- Conversation and session-tree projections remain bounded and rebuildable;
  opening a long JSONL session does not require mounting or transferring its
  complete history.
- Session image data does not travel in Snapshot or Message Page JSON. Visible
  images load through bounded generation-bound transferable asset chunks, while
  unsupported, stale, or unavailable images fail explicitly without exposing
  old Host state.
- Session navigation uses a disposable, rebuildable metadata-only Catalog with
  bounded keyset pages. Pi JSONL remains authoritative; the Catalog never stores
  Prompt, Assistant, Thinking, Tool, source, Patch, image, or transcript content.
- The active managed Session uses file and parent-directory watchers only as dirty
  signals. An authoritative bounded JSONL tail verifies file identity, byte offsets,
  strict UTF-8, physical-line limits, and complete JSON records. Appends already
  present in the current Pi `SessionManager` are accepted as Desktop writes; an
  external append, truncate, replace, deletion, indirection, or malformed line
  latches the Session read-only, interrupts an active turn, and requires reopen or
  repair before another mutation. The renderer receives only a typed reason and
  recoverability flag, never the Session path.
- The Inspector exposes bounded Pi Session Recorded Changes from the active
  branch. It never presents those edit/write records as a complete Git or
  workspace diff, and it never invents a historical diff for write results.
- Safety approval is a dedicated, fail-closed single-Tool-Call flow bound to
  Host epoch, session generation, operation, request, and Pi `toolCallId`;
  ordinary Extension confirmation cannot impersonate it.

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
- Operation terminal receipts are bounded, memory-only recovery metadata. They
  contain lifecycle, timing, Host/Session authority, and redacted structured error
  state only; Prompt text, import paths, commands, compaction instructions, source,
  and raw tool payloads are never stored in the receipt ledger.
- Renderer notification history is also memory-only and is cleared on application exit.
  It stores only bounded presentation text and terminal identity/timing metadata; it
  does not persist Prompt, source, command text, paths, credential values, Protocol
  error details, or raw payload objects in localStorage, SQLite, JSONL, or diagnostics.
- Electron Main owns the disposable Session Catalog location. Its SQLite rows
  contain only bounded Session identity/path/cwd/explicit-name/count/time/parent
  metadata; unnamed Sessions never derive a stored name from the first Prompt.
  POSIX catalog storage must remain current-user-owned with directory `0700` and
  database `0600` permissions or fail closed to the disposable SDK projection.
- Catalog search may normalize user text, but filesystem source/workspace identity
  never uses Unicode compatibility normalization. Link-based storage indirection
  outside Electron `userData` fails closed instead of following the target.
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
