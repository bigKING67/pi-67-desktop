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

`π` is the user-visible graphical surface for Pi/pi-67. `Pi-67 Desktop` remains
the technical release, package, application ID, protocol, and artifact identity.
The product is not a second agent,
a provider marketplace, an RPC wrapper, or a full IDE. It favors truthful
state, fast interaction, safe recovery, and Pi compatibility over feature
count.

## Primary jobs

1. Register one or more workspaces and switch conversations from one grouped
   navigation rail. A running task binds exactly one workspace, one managed Pi
   JSONL session, and one live Pi Runtime, and continues in the background when
   another conversation is selected.
2. Manage Pi Providers, models, default selections, and credentials from
   Settings. Credentials persist to Pi `auth.json` by default; an explicit
   runtime-only key remains available for temporary use.
3. Follow streaming reasoning, tools, intermediate results, file changes, and
   follow-up work without losing the current task. One turn owns one execution
   process: visible reasoning stays readable in sequence, each Tool Call and its
   Tool Result form one inspectable step, and the final answer remains outside the
   process as the primary result. The process stays expanded while work is active,
   collapses only after successful completion has a visible final answer, and
   remains fully inspectable on demand. Failure, cancellation, loss, or a missing
   final answer keeps the process expanded for diagnosis.
4. Use skills, prompts, extension commands, session tree, rollback, and compact
   from a coherent graphical interface.
5. Diagnose shell, configuration, extension, update, and runtime failures
   without exposing credentials or private content.
6. Move sequentially between Desktop and Pi TUI using the same Pi JSONL session.
7. Open the singleton Settings surface for account, application, global, or
   current-workspace Pi configuration without losing drafts or background work.
8. Install and operate Pi Extensions, Skills, Prompts, Rules, and supported
   integrations without requiring a system Node, npm, Git, pnpm, or Pi CLI.

## Success criteria

- Both supported platforms can install, launch, and complete an offline SDK
  contract smoke from signed packages.
- Existing users reuse `~/.pi/agent` without credential or session migration.
- Windows x64 and macOS arm64 packages include pinned private Node, npm, and Git
  toolchains. Package operations fail closed when the bundled toolchain is
  missing or invalid and never fall back to unverified system executables.
- Package downloads support public npm/Git mirrors with explicit official-source
  fallback. A mirror changes transport only; npm integrity, a pinned Git commit,
  deterministic content hashes, and application update signatures remain the
  trust authority.
- Pi-67 Core, browser67, design-craft, and the commerce-growth-os Skill suite ship
  as pinned first-party capability snapshots. Desktop materializes verified
  copies under the Pi agent directory, preserves existing Package object filters,
  namespaces managed Rules, and never overwrites an existing global `AGENTS.md`.
- Settings manages rules and context as Markdown files in two availability scopes.
  Each scope uses a counted secondary category selector and renders only the selected
  category as a flat Catalog. `全局可用` separates user-owned global context,
  Desktop-managed rules, and global system-prompt inputs; `项目专属` separates
  Workspace context, inherited context, and project system-prompt inputs. User-owned
  global or project rules are the default category in their scope. Every file opens
  into a source/preview detail. Desktop-managed files and files inherited from outside the Workspace are
  read-only; regular files in the controlled global root or a trusted Workspace are
  editable. Creation is limited to the canonical `AGENTS.md`, `SYSTEM.md`, and
  `APPEND_SYSTEM.md` locations. Existing `CLAUDE.md` variants remain editable where
  controlled, but Desktop does not create them and exposes no arbitrary path,
  rename, or delete operation. Saves compare an opaque content revision, write
  atomically, and reload every initialized Pi Task affected by the global or project
  scope. A reload failure rolls the file back and reloads the restored baseline;
  an external revision conflict preserves the unsaved draft instead of overwriting
  it. Markdown bodies and drafts remain renderer-memory-only and never enter Session
  projection, Workbench persistence, notifications, diagnostics, or default logs.
- Global Skills with an explicit owning updater and verified suite manifest may be
  checked and updated once per Skill Pack. Lark delegates the version check and
  update to the installed `lark-cli`. A complete official Skill set already at the
  latest reported Skill version remains updateable when only the CLI version is
  behind; incomplete or otherwise unverified Skill drift blocks overwrite. Pi
  resources reload only after the updater verifies convergence. One update pins the
  same user-managed CLI executable for its pre-check, mutation, and post-check;
  Desktop's private packaged toolchain is never an installation target. Settings
  reports the current CLI, official Skills, and latest stable version separately.
  AI Berkshire uses the Pi-67 Skill Pack registry instead: Desktop resolves one
  exact Pi-67 `main` commit, validates the bounded registry/lock and every declared
  Skill hash, installs only those Skills as a separate Pi Package Overlay, activates
  it atomically, and rolls back if any Workspace resource reload fails. The immutable
  bundled baseline remains available through `恢复内置版本`. A legacy
  `bundled-release-only` record with no installable upstream may prove only that an
  older non-installable registry version exists; it can never stage an Overlay.
  After an explicit check, Settings shows the effective version, the compatible or
  historical registry version, and a distinct current/update/non-installable/error
  result; the `全局可用` scope label never substitutes for update-check evidence.
  Loose global Skills remain user-maintained, project Skills remain project-owned,
  and Package Skills update with their Package. Bundled Skills always retain an
  immutable Desktop baseline; a suite may additionally use a verified managed
  overlay between Desktop releases only when its updater, compatibility contract,
  content hashes, atomic activation, and rollback path are explicit.
  Settings presents these as two availability scopes rather than mixing scope and
  provenance: `全局可用` groups Desktop-bundled, updater-managed, and user-local
  Skills, while `项目专属` contains only the current project's own Skills. Every
  bundled suite remains available to all projects even when its release and update
  lifecycle differs from a user-installed global Skill.
- Bundled Skill suite versions come from the content owner rather than the Package
  that happens to carry them. AI Berkshire reads its version plus source commit
  provenance from the Pi-67 Skill Pack registry/lock and records
  `https://github.com/xbtlin/ai-berkshire` as its upstream. Desktop pins the exact
  upstream commit plus the expected Pack version, manifest hash, and bundle hash;
  its build uses the adapter from the locked Pi-67 Core source and fails closed if
  regenerating the Pack does not reproduce those values. This lets a Desktop release
  refresh the bundled AI Berkshire baseline without relabeling Pi-67 Core or waiting
  for a new Core release. Commerce and browser67 use their locked capability versions.
  Multi-source design suites have no invented aggregate version, and Lark's bundled
  copy remains explicitly unversioned until its build provenance supplies a
  verifiable suite version.
- Bundled browser67 source and Skills do not imply live browser readiness. Settings
  distinguishes bundled source, dependency preparation, deterministic Doctor,
  and real managed-browser readiness instead of collapsing them into one state.
- One Electron window can register multiple workspaces. The navigation rail is
  the only Workspace and conversation switcher: each Workspace is a collapsible
  group containing active work, drafts, and Catalog-backed recent sessions.
- Session history has no user-visible open-tab limit. Catalog pages, search, and
  list virtualization keep large histories bounded, while Pi JSONL remains the
  source of truth. Each group initially shows six ordinary recent sessions and
  offers an explicit load-more action.
- A conversation row uses the latest accepted or currently loaded user message
  as its primary in-memory preview when available, with the stable Pi Session
  name retained as secondary context. Prompt-derived previews are never copied
  into the Session Catalog or persisted Workbench state.
- The application admits at most eight top-level Session tasks in accepted,
  running, approval-wait, or Extension-input-wait states. Subagents launched
  inside a Task do not consume additional top-level admission slots. The Renderer
  explains the limit early, but the Pi runtime service owns the atomic admission
  decision.
- Each live task owns an independent Pi Runtime and projection. Selecting another
  conversation, collapsing a Workspace, or opening Settings does not stop
  background work. One canonical Pi JSONL session path has at most one live
  writer across the application.
- There is no tab-close or local archive metaphor. A running or waiting row
  exposes a deliberate stop action; ordinary history remains discoverable from
  the rebuildable Session Catalog and no UI action deletes Pi JSONL in v1.
- A workspace added through the native directory picker is trusted for project
  resource loading. That trust never replaces one-shot approval for destructive,
  system, workspace-external, or external side-effect Tool actions. Verified
  read-only `web_search` and HTTP(S) `fetch_content` calls from the explicitly
  enabled `pi-web-access` Package are the narrow exception: they run without a
  per-call dialog, while malformed inputs, local-file fetches, unknown aliases,
  and same-name Tools from any other source remain fail-closed.
- Restored Workspace registrations are checked against their persisted filesystem
  identity before project resources load. A missing or replaced directory stays
  inactive until the user explicitly repairs it through the native directory
  picker; repairing it is a fresh trust gesture.
- Settings opens or focuses one application-level selected surface. Global and project
  scope are explicit only where meaningful, and changing the current workspace
  retargets project scope instead of creating another Settings instance.
- The conversation workbench is the only three-region application surface.
  Settings and other application-level surfaces replace the Workspace rail with
  their own bounded navigation, use a two-column shell on wide windows, and
  provide an explicit `返回工作台` action that restores the prior conversation or
  Workspace without stopping background tasks.
- The footer shows a signed-out account entry and a help menu. Account opens the
  Settings account section; local Pi, Workspace, and Session use does not require
  login. Enterprise and team capabilities remain unavailable until a real
  account service is integrated.
- The user-visible application name and icon are `π` with the locked black-square
  and white-mark assets. `com.pi67.desktop`, the `pi67` URL scheme, package names,
  GitHub repository, executable names, and `Pi-67-Desktop-*` release artifacts
  remain stable technical identities.
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
- Welcome does not start the internal Agent Host utility process or load the Pi
  SDK until a Workspace or Pi-runtime diagnostic action needs it.
- Credential, prompt, source, and raw tool content never enters telemetry or
  default diagnostic logs.
- Provider status snapshots expose only non-secret metadata such as configured
  state, credential source, and model count. A complete credential may cross to
  the renderer only in the result of an explicit one-shot reveal request for a
  literal API key stored in Pi `auth.json`; it never enters snapshots, events,
  projections, telemetry, diagnostics, logs, or persisted Desktop state.
- Pi configuration files are the only source of truth: Desktop reads and writes
  `~/.pi/agent/models.json`, `auth.json`, and `settings.json`, plus trusted
  `<workspace>/.pi/settings.json`. It never creates a Desktop-owned Provider or
  model configuration copy.
- Desktop watches those Pi files and publishes revisioned snapshots. A clean
  view adopts external TUI, script, or manual edits automatically; an unsaved
  draft remains intact and must explicitly adopt the newer revision before it
  can overwrite anything.
- An idle Task applies a valid model-catalog change immediately. A running Task
  marks the reload pending and applies it after the current Operation settles.
  Removing the selected model clears the selection and blocks the next Prompt
  until the user chooses an available model.
- Common Provider and model fields use bounded forms. Advanced JSON cannot carry
  `apiKey` or header values; credential and header mutations are write-only.
  Stored API keys remain absent from snapshots, events, projections, logs, and
  diagnostics, with only the bounded one-shot reveal response exempted.
- Release performance meets `docs/testing/performance.md`.
- Prompt drafts and attachments are cleared only after the Agent Host accepts
  the operation for the same Host epoch, Session ID, and Session generation that
  submitted it. Transport failure, Host replacement, or a concurrent Session
  switch preserves the draft and rotates the retry submission identity.
- The Composer exposes one `+` attachment action and one in-editor `/` catalog.
  The catalog presents Pi-resolved Extension commands, Prompt Templates, and
  Skills such as `/plan` and `/skill:design-craft`; selection inserts the command
  into the draft and never bypasses normal send, queue, or IME behavior.
- A draft supports at most 20 local attachments, 100 MiB per file, and 250 MiB
  total. Pathless clipboard files have a stricter 16 MiB boundary. Main stages
  regular files into a private disposable root and sends only opaque references
  through Preload and Protocol; the Agent Host claims and revalidates the files
  before it accepts the operation. Images use Pi native image content, while
  ordinary files are inspected through the hidden bounded `read_attachment`
  Tool. Renderer projections contain names, types, sizes, and opaque identities,
  never filesystem paths, source bodies, or raw attachment bytes.
- Attachment extraction is offline and bounded. Text, Office/PDF, archives,
  audio/video metadata, binary strings/bytes, and image OCR run in cancellable
  worker threads with a two-worker ceiling, single-OCR concurrency, queue and
  timeout limits, archive traversal/ratio/entry/expanded-size checks, and 32 KiB
  Tool results. Failure stays observable and never falls back to a network OCR
  service.
- The collapsed Composer model control shows only the readable model name. Its
  open list keeps Provider ownership and the complete `provider/model-id`
  visible for disambiguation without consuming permanent Composer width.
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
- Electron Main may persist a bounded, schema-validated Workbench V2 layout with
  Workspace identity and ordering, expanded Workspace IDs, the selected
  conversation or Settings surface, Settings scope, at most eight runtime recovery
  identities, and clean-exit state. Ordinary idle Session rows are rebuilt from
  Catalog instead of being persisted as open UI objects. Draft text, attachments,
  transcript, runtime detail, private fallback titles, and credential material
  never enter that layout.
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
- Extension Package completion names the affected Package and, when available,
  its previous and installed versions. Resource reload events and routine
  informational Extension messages remain in Notification history rather than
  stacking duplicate floating toasts around the one final update result.
- Skill update checks are user-initiated, bounded, and use only the owning updater's
  version and official-Skill synchronization contract. Desktop does not infer an
  upstream from a directory name, pull arbitrary Skill repositories, or run an
  updater for loose or project-owned Skills. An upstream repository alone does not
  enable runtime updates. AI Berkshire is the first Pi-67 registry-managed Overlay:
  it accepts only a compatible version bound to an exact Pi-67 commit and verified
  hashed bundle, never downgrades the effective version, and rolls back atomically.
  Commerce remains Desktop-release managed until it receives the same explicit
  runtime channel contract.
  Build-time AI Berkshire refreshes are a separate immutable release input: they pin
  one upstream commit and reproduce the locked Pi-67 Pack hashes without following a
  branch during runtime.
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
