---
version: 2
name: Pi-67 Desktop Design Authority
status: active
platform: electron-web
theme: system-light-dark
color:
  canvas: "#f5f6f4"
  surface: "#ffffff"
  surface-muted: "#eef0ed"
  surface-raised: "#ffffff"
  text-primary: "#171a18"
  text-secondary: "#626862"
  border: "#d9ddd8"
  accent: "#2f6757"
  focus: "#2c70c9"
  info: "#2d67aa"
  warning: "#9a5b16"
  danger: "#a43b35"
  success: "#287248"
  diff-added: "#e0f1e7"
  diff-removed: "#f8e4e2"
  code-surface: "#0d1117"
  code-border: "#30363d"
  code-text: "#e6edf3"
  code-muted: "#8b949e"
spacing:
  unit: 4
  compact: 8
  control: 12
  section: 24
  region: 32
radius:
  control: 8
  panel: 12
  overlay: 14
motion:
  fast: 120
  standard: 180
  deliberate: 240
---

# Pi-67 Desktop Design Authority

## Design read

Reading this as: a desktop Pi coding workspace for beginner and experienced Pi
users, with a calm, exact, compact, operational character, optimized for
completing a real session without learning terminal UI conventions first.

## Visual direction

- Preserve Peak Code's useful three-region information architecture, not its
  provider marketplace, exact pixels, assets, or giant component structure.
- Transcript and composer form the dominant work plane. Navigation is quieter;
  files, tools, diffs, and resources appear only when they explain active work.
- Use editorial utility composition, restrained surfaces, precise alignment,
  and a small number of real panels.
- Avoid equal card grids, decorative gradients, broad glass effects, oversized
  empty states, low-contrast metadata, and generic AI visual motifs.
- Light and dark modes share information architecture, spacing, type roles,
  component behavior, and motion.
- The application mark uses the locked production asset: a pure white rotationally
  symmetric `π` glyph on a pure black rounded square. Do not redraw, recolor,
  decorate, or bake the display name into the icon. Product-facing text uses `π`;
  technical release identifiers may retain `Pi-67 Desktop` where required.
- The vector master, Windows icon, and in-product icons retain the full brand
  canvas. The macOS ICNS is a platform-calibrated derivative: the unchanged mark
  and black tile occupy `824px` inside a transparent `1024px` canvas, centered
  with a `100px` safe area on every side. This prevents the Dock, Finder, and
  Launchpad from rendering π roughly 24 percent larger than contemporary macOS
  application icons; the safe area must not be applied back to Windows or
  Renderer assets.
- Appearance defaults to the operating system. A compact TitleBar menu lets
  users choose System, Light, or Dark without turning theme into primary UI.

## Window structure

```text
+----------------------+--------------------------------------+----------------------+
| Workspace / Sessions | Transcript                           | Inspector            |
| Search / running     | Reasoning / bounded tool cards       | Recorded changes     |
| recent sessions      | Composer / message queue             | Session / context    |
+----------------------+--------------------------------------+----------------------+
```

- Navigation rail: 248px on the current wide layout.
- Context pane: 360px on the current wide layout and collapsible.
- Transcript owns remaining width and never drops below 520px on a wide layout.
- Below 1040px, context defaults closed and becomes an overlay drawer with a
  dismissible scrim, so trust, transcript, and composer actions are never
  covered before the user explicitly opens context.
- Below 760px, navigation becomes a drawer; transcript remains primary.
- The packaged window minimum is 680px so the navigation drawer range remains
  reachable after native window frames are applied.
- Windows keeps native caption buttons through `titleBarOverlay`.
- macOS keeps traffic lights through `hiddenInset`.
- Resizable split handles, a complete Git/workspace Diff, and Files browsing are
  future Inspector capabilities. The current Changes tab is a bounded Pi Session
  Recorded Changes projection, not a synthetic replacement for those features.

## Typography

```css
--font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
  "PingFang SC", "Microsoft YaHei", sans-serif;
--font-code: "Maple Mono", "SFMono-Regular", Consolas, monospace;
```

- Use the UI stack for navigation, transcript prose, dialogs, forms, and help.
- Use Maple Mono for code, tools, diffs, paths, commands, and compact runtime
  metadata.
- Code blocks may use ligatures. Commands, paths, diffs, and exact output do not.
- Body text is 14-15px with a 1.5-1.6 line height. Metadata is 12-13px.
- Use tabular figures for tokens, context, time, and cost.

## Semantic tokens

CSS consumes only semantic roles:

```text
canvas surface surfaceMuted surfaceRaised
textPrimary textSecondary border accent focus
info warning danger success diffAdded diffRemoved
codeSurface codeBorder codeText codeMuted overlayBackdrop
shadowFloating shadowFocus shadowComposer shadowHero
```

- Accent marks selection, the primary action, and current navigation only.
- Status always includes text or an accessible icon, never color alone.
- Focus-visible must remain stronger than hover on every surface.

## Color

- Use the semantic roles declared above rather than raw palette values in
  components. Light and dark themes may change values, but not role meaning.
- Canvas and surface colors establish depth quietly; borders separate regions
  without turning every group into a card.
- Accent is reserved for the current selection and primary action. Info,
  warning, danger, success, and diff colors communicate only their named state.
- Text and interactive-state contrast must remain usable at 200% zoom and in
  both themes. Never rely on hue alone to communicate status or selection.
- Code roles stay dark in both themes so syntax highlighting has one calibrated
  contrast surface and uses one dark Shiki theme without re-tokenizing when the
  surrounding UI theme changes. Overlay and shadow roles adapt by theme and communicate
  depth without becoming component-local color values.

## Component contract

Every interactive component defines:

```text
default hover pressed focus-visible selected/current disabled
loading error where the operation can produce those states
```

### Transcript

- Variable-height virtualization is mandatory.
- Settled messages and the live turn are separate render paths; the live turn
  occupies the Virtuoso footer and joins history only after it settles.
- Streaming text is coalesced; token-level React commits are forbidden.
- Long code uses a bounded 520px viewport, worker-based highlighting, internally
  virtualized lines, and a full-content copy action. Tool summaries and recorded
  Edit Patch previews remain bounded; complete Tool Output and workspace Diff
  require future explicit data and expansion contracts.
- Markdown never executes raw HTML.
- Session images never render a cross-process data URL. A generation-bound asset
  reference loads only while its virtualized message is mounted, shows explicit
  loading/unavailable/retry states, and renders from a lazy Blob URL. Host
  replacement revokes cached URLs so an old connection cannot remain visually
  authoritative.
- A stopped, aborted, or crashed turn never appears completed.
- Tool presentation is registry-driven. Bash, read/search, edit/write, and
  unknown tools render bounded, copyable summaries; the UI states explicitly
  when cwd, duration, output, Diff, or file preview is absent from the projection.
- Verified declarative Extension Adapter metadata takes precedence over tool-name
  heuristics and may choose only the existing `generic`, `command`, `read`, or
  `change` presentation grammar. It never loads Extension HTML, JavaScript, CSS,
  React components, or renderer modules. Historical tools without a current
  generation `toolCallId` binding remain on the built-in or generic presenter.

### Inspector

- Changes is the default tab. It displays only `edit` and `write` facts recorded
  on the current Pi Session active branch and repeats that authority boundary in
  the UI; it never claims to represent all uncommitted Git/workspace changes.
- Completed `edit` records may show the bounded unified Patch, first changed line,
  and additions/deletions recovered from the Pi Tool Result. `write` records show
  bounded byte/line metrics and explicitly state that no before-version exists,
  so no historical Diff is invented.
- Live Changes upsert by `toolCallId`; session bootstrap, Host generation change,
  and projection resync cannot mix records from different session generations.
- Session tree projections are flat and renderer recursion is forbidden.
- At most 512 nodes and 128 KiB of tree JSON cross the process boundary; the
  active node remains prioritized and truncation is visible.
- Tree rows are virtualized. Session and Context are independent tabs; Context
  contains usage, Extension status, and Resources without forcing conversation
  history to be reprojected.
- A complete Git/workspace Diff and Files browser are reserved for future data
  contracts and are not represented by synthetic client-side data.

### Appearance

- One TitleBar `更多` menu exposes System, Light, and Dark in Welcome and inside
  a workspace; navigation does not duplicate the appearance control.
- System is the default and reacts to operating-system theme changes while the
  application is running. Explicit Light or Dark overrides the system.
- Only the non-sensitive preference is persisted in renderer-local storage.
  Storage failure keeps the runtime choice and explains that it is temporary.
- The effective theme is applied before React mounts. Components consume the
  same semantic tokens and never branch on theme-specific literal colors.
- The trigger shows the effective theme, the menu marks the stored preference,
  Escape restores focus, and Reduced Motion removes menu travel.

### Runtime controls

- The primary model selector lists configured models only. It may retain the
  current model if authentication changes so the selected value never disappears.
- Provider setup belongs to the `Provider 与凭据` dialog rather than the model
  selector. An empty configured-model set names that next action explicitly.
- Thinking levels use readable product labels such as `思考：关闭` and
  `思考：高`; raw SDK enum values are not the primary user-facing copy.
- Operation status names import and compaction instead of collapsing every long
  task into a generic running label. `停止` is visible only when the accepted
  Operation declares a real Host-owned abort path; Session import stays visibly
  running until it completes or fails.
- Turn activity is Host-owned and evidence-based: Pi `thinking_*` renders as
  `Pi 正在分析`, `text_*` as `Pi 正在回复`, Tool execution as
  `Pi 正在使用工具`, and compaction as `正在压缩上下文`. Provider wait,
  retry, and other unproven phases retain the generic running label rather than
  being mislabeled as thinking. Approval and blocking Extension input temporarily
  overlay that base activity, then restore it when the Host resolves or cancels
  the request.
- If Pi cannot acknowledge `停止` within the Host watchdog, the Turn becomes lost
  and the runtime remains visibly recovering until a replacement Host restores an
  authoritative projection. The UI never returns to ready or enables a new Turn
  merely because the local abort button timed out.
- Synchronous runtime, workspace, Session, model, thinking, and resource mutations
  keep their loading state through a 60-second acknowledgement window. A transport
  interruption performs at most one same-key retry, so a recovered response cannot
  create a duplicate Session or stack the same resource reload.
- Session import, compaction, and Extension command invocation reuse one caller-stable
  submission ID for at most one same-Host acknowledgement retry. A new Host epoch fails
  closed instead of silently repeating work. Prompt attachments stay in the Composer
  and require an explicit retry because transferred image buffers cannot be replayed.
- A delayed or replayed acknowledgement cannot turn a completed, failed, cancelled,
  or lost Operation back into accepted/running. The Operation status bar renders the
  typed terminal receipt directly and never restores a stop action for settled work.

### Notifications

- Toasts provide transient feedback without becoming the primary task surface. At most
  four are visible; info and success dismiss after six seconds, warning after ten, and
  error remains until dismissed. Timers pause while the document is hidden or the Toast
  has pointer/keyboard interaction.
- Toast copy is never itself a dismiss target. Every Toast has a separate labeled close
  button; error uses `alert`, while info, success, and warning use `status`. Reduced Motion
  removes entrance travel.
- The Title Bar Bell opens a React Aria Popover/Dialog, exposes a `9+` bounded unread
  badge, marks history read when opened, and restores focus to the Bell when closed.
  History is newest-first, capped at 50 entries, and can be cleared explicitly.
- Realtime terminal events, settled acknowledgement replay, and projection resync all
  project through the same `hostEpoch + operationId` dedupe key. Completed, failed,
  cancelled, and lost have distinct icon, text, and semantic color; hue is never the
  only distinction. A bounded 512-key in-memory terminal ledger prevents a receipt
  from reappearing after its older 50-row history entry has been evicted.
- Notification state is memory-only. Operation rows may show kind, lifecycle, timing,
  Host epoch, and structured error code, but never Prompt, command text, import path,
  compaction instructions, source, credential values, raw Protocol details, or Tool
  payloads. Generic text is bounded and redacted before entering history.

### Composer

- Main action is `发送`/`Send` or `停止`/`Stop`, never a generic submit label.
- Enter sends and Shift+Enter inserts a new line. IME composition confirmation,
  including Chromium `isComposing` and legacy `keyCode 229`, never submits the
  draft; the user sends only with a later non-composition Enter.
- While streaming, users choose steer or follow-up queue behavior explicitly.
- Attachments are named, previewed, and removable before sending. The same
  validation and Object URL lifecycle owns file-picker, clipboard paste, and
  drag/drop input; duplicate file projections are rejected instead of mounting
  repeated previews.
- Draft text and attachments clear only after the Host returns an accepted
  Operation whose Host epoch, Session ID, and Session generation still match the
  authority captured at send time. Transport failure retains the original draft,
  attachment Object URLs, and stable submission ID for an idempotent retry;
  Host or Session authority changes retain the draft but rotate that ID before
  the next attempt.
- Image attachments accept PNG, JPEG, WebP, and GIF only, with an eight-image,
  10 MiB per-image, and 30 MiB per-message boundary. Rejections remain visible
  beside the composer instead of being truncated silently.
- Queue content is currently inspectable with bounded previews and can be
  cleared atomically after confirmation. Agent Host delivery is strict FIFO and
  bounded to 32 admitted commands by default; capacity exhaustion is an explicit
  recoverable error. Clear finishes the delivery already entering Pi, cancels
  later Host-pending deliveries, clears Pi's accepted steer/follow-up messages,
  then allows newly submitted work to continue after the barrier. Per-item edit,
  delete, reorder, and restore are not exposed until Pi provides an authoritative
  mutation contract.

### Session navigation

- Listed sessions are already managed and open in place with the current
  workspace as their effective cwd.
- The rail loads bounded, server-sorted Session Catalog pages and performs search
  in the Agent Host rather than filtering an eagerly transferred full array.
  Cold rebuild shows `正在建立 Session 目录…`; fallback or incomplete discovery is
  visible and must not be presented as an authoritative empty result.
- Pagination cursors are bound to the Catalog revision plus source, workspace,
  scope, normalized search, and sort contract. Query changes, revision changes,
  or Host epoch replacement clear old pages; stale results cannot append across
  result sets.
- Sessions without an explicit Pi `session_info.name` display the fixed
  `Untitled session` label; the first Prompt is never used as Catalog UI metadata.
- The low-frequency `更多会话操作` menu contains `导入 Pi Session`; it copies a
  valid external JSONL session into the managed session directory before
  opening it and never implies that Desktop will keep writing to the selected
  source file.
- Cancelling the picker preserves the active session without a notice. Import
  failure names the failed operation and preserves both the source file and any
  previously completed managed import.
- Filename collisions create an explicit `-imported-N` copy rather than
  replacing an existing managed session.
- New, resume, import, fork, and reload transitions are mutually exclusive.
  Desktop uses Pi's `AgentSessionRuntime` lifecycle so extensions receive
  `session_shutdown` before their context becomes stale and `session_start`
  after the replacement session has been rebound.

### Command Palette

- The search field remains the sole keyboard focus owner and exposes the bounded
  result list through the combobox `aria-activedescendant` pattern. Arrow keys
  change the active option without preventing the user from continuing to type.
- IME candidate confirmation follows the same `isComposing` and legacy
  `keyCode 229` boundary as Composer and never executes the active result.
- Session, Extension, compaction, and resource actions reflect the Agent Host
  scheduler before execution. A running Operation, Session transition, missing
  Session authority, or disconnected Host produces an explicit disabled reason
  instead of closing the Palette and relying on a later `BUSY` error.
- Session Catalog search is query- and Host-epoch-owned. Loading may show a
  bounded local match from the recent page; failure remains visible and is never
  presented as an authoritative empty Session result.
- Extension command identities are bounded and unique before they become action
  IDs. Search projects at most 60 result options, reports real match truncation,
  and keeps recent actions only in process memory.

### Extension UI and approval

- Dialogs identify the extension or tool only when the runtime supplies an
  authoritative identity. Pi SDK `0.81.1` does not identify the caller for
  shared `ctx.ui` primitives, so those dialogs use the truthful generic label
  `Pi extension` instead of guessing a package.
- Safety Approval is a dedicated dialog and protocol, not an Extension `confirm`.
  It names the exact command/path, cwd, risk category, one-Tool-Call scope, reason,
  and denial behavior without rendering the target as Markdown or HTML.
- Approval makes bidi, zero-width, control, and non-standard line-separator
  characters explicit in a non-mutating safe display. At constrained height,
  details scroll independently while both decision actions remain visible.
- Approval is displayed and answered only while Host epoch, session generation,
  Operation, request, and Pi `toolCallId` remain authoritative. Stale, aborted,
  disconnected, undisplayable, or oversized requests fail closed.
- Common extension select/confirm/input/editor requests use accessible dialogs.
- Status, text widget, title, and compatibility updates obey the same Host,
  Session generation, and Operation authority as blocking requests. Undefined
  status/widget values remove the prior item, widget placement is preserved,
  and Host or Session replacement restores the default application title.
- Context shows a bounded Extension Catalog derived from Pi's loaded Extension
  result. It filters hidden Desktop-internal extensions, separates commands,
  tools, shared UI primitives, and TUI-only custom surfaces, and uses `unknown`
  whenever the SDK does not provide enough evidence. Command or Tool support
  never implies that a shared `ctx.ui` call has authoritative package attribution.
- A verified Adapter row shows package, installed version, and matched command/tool
  counts. `adapter` is shown only when every discovered executable surface is
  covered and no known TUI custom surface remains; partial coverage stays `partial`.
- TUI-only custom components show an actionable compatibility message.
- The Provider dialog lists configured state, non-secret credential source, and
  model count. A configured credential is represented as hidden rather than read
  back; complete keys never enter renderer state.
- Runtime credential inputs never refill and state that the value is cleared
  when the Agent Host exits or restarts. A runtime key remains available across
  Desktop-created session transitions within that Agent Host lifetime.
- Doctor reports use text and icons for pass, warning, and failure and keep
  retry available without changing the active Pi session.
- Before Doctor has run, it presents an explicit invitation to run checks and
  never renders an inferred all-passed state.
- Update checks disclose their GitHub Release network purpose before the first
  request. Unsigned Preview checks and opening the canonical GitHub Release page
  remain separate explicit actions. Unsigned builds expose no in-app download,
  background download, or quit-to-install path.

### Empty, loading, and error states

- Empty states point to the first useful action.
- Welcome is a task entry: it keeps workspace selection available before the
  on-demand Agent Host exists and does not expose SDK/process marketing copy as
  the primary user message.
- Loading copy names the operation, such as `正在加载 Pi 资源`.
- The first on-demand Agent Host connection has one initialization owner. The
  trust action stays disabled until a session snapshot exists, remains disabled
  while resources reload, and never stacks duplicate trust commands.
- Session creation failures replace the loading animation with the failed
  operation and preserved error detail instead of leaving an indefinite spinner.
- Session-transition actions disable together while Pi replaces its runtime;
  repeated system or Extension notices with the same normalized level and text occupy
  one history entry within a five-second dedupe window.
- A retried control mutation remains one logical user action. The UI does not emit a
  second loading row or success notice while the Host replays the original result.
- Errors name what failed, what state was preserved, and the next safe action.
- An external Pi Session change produces one warning for the current Session
  generation. Append/truncate/replace states instruct the user to reopen the Session;
  unavailable files instruct restoration before reopen; malformed JSONL instructs
  repair or re-import. The notification never displays or retains the Session path.
- A recoverable Port interruption automatically renews the connection. Same-Host
  recovery restores the active Operation through projection resync. If the task
  settles while events are unavailable, recovery may restore the latest typed terminal
  receipt only when its Operation ID matches the task that was active before the gap;
  unrelated historical terminals are ignored. Host replacement remains visibly
  recovering until runtime initialization completes and never reuses the prior Host's
  in-memory receipt ledger.
- An active Operation receives typed Host heartbeats independently from Pi business
  activity. A quiet task remains cancellable and shows that the Host is still
  responsive; overdue heartbeats first show a warning, then trigger one authoritative
  projection resync. Freshness never converts a long-running task into a fabricated
  failed terminal state, and approval or Extension input waits pause the watchdog.
  The freshness controller loads only after a Workspace exists and is disposed when
  the Workspace leaves. If that module cannot load, the Workspace stays usable and a
  fixed warning explains that automatic heartbeat recovery is unavailable.
- Unavailable Session images explain that the format or size was not projected;
  transport failures keep the message in place and expose a focused retry action.
- Partial resource failure remains visible rather than silently disappearing.

## Frontend ownership and styles

- `connection/AgentConnectionController.ts` is the only owner of the raw Port
  client, handshake generation, pending teardown, and event-sequence recovery.
- `conversation/conversation-asset-controller.ts` owns transferred Session image
  chunks, bounded Blob URL caching, reference counts, and revoke lifecycle;
  neither React nor Zustand stores image bytes or Blob URLs.
- Store modules receive typed domain events; React components never own a Port
  or import Electron, Node, the Pi SDK, or filesystem APIs.
- User actions call feature controllers for Workspace, Session, Composer,
  Operation, and diagnostics flows; the broad App Store does not proxy
  MessagePort requests back to components.
- `notifications/notification-store.ts` owns the bounded memory-only history, Toast
  admission, read state, redaction, and Operation terminal dedupe. App lifecycle state
  does not retain a parallel notice array or raw `AgentPortClient` reference.
- Foundation and shell styles live under `styles/`; feature-specific layout and
  states use colocated CSS Modules. Deleted features remove their CSS rather
  than leaving a compatibility stylesheet.
- `command-palette/` separates async Session/Extension resources, scheduler-aware
  action registration, pure search projection, selection, recency, and result
  rendering. Palette-specific layout has one CSS Module authority rather than a
  parallel global compatibility rule set.
- Connection, session, conversation, composer, extension, notification, and
  layout stores may be separated further when their mutation ownership is
  fully independent. The current modularized app store is not described as a
  completed multi-store migration.

## Motion

- Use 120-180ms transform/opacity feedback for local interactions.
- Use 180-240ms for drawers, menus, and route-local transitions.
- Motion starts from the invoking element and remains interruptible.
- Never use `transition: all` or decorative idle animation.
- Reduced Motion replaces travel with a short fade or immediate state change.

## Accessibility

- Keyboard order follows visible task order.
- Dialogs trap focus and return it to the invoker.
- Streaming live regions are throttled; token-level announcements are forbidden.
- Icon-only controls have accessible names and visible tooltips.
- 200% zoom and long Chinese/English strings do not hide primary actions.

## Voice

- Default Chinese and matching English are short, specific, and factual.
- Renderer UI copy is owned by the typed locale catalog. Components consume
  catalog messages and shared date/time formatters instead of embedding a second
  locale path or constructing locale-sensitive text ad hoc.
- Prefer `重新加载 Pi 资源` over `重试` and `允许本次命令` over `确定`.
- Never claim installation, recovery, update, or execution succeeded before the
  decisive runtime check passes.

## Avoid

- Provider marketplace navigation or non-Pi branding.
- Hidden critical actions that exist only on hover.
- Unbounded transcript rendering or synchronous Markdown work in hot paths.
- UI that directly edits Pi credential or session file formats.
- Runtime, smoothness, or accessibility claims without observed evidence.
