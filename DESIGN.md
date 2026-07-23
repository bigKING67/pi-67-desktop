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
- Appearance defaults to the operating system. A compact TitleBar menu lets
  users choose System, Light, or Dark without turning theme into primary UI.

## Window structure

```text
+----------------------+--------------------------------------+----------------------+
| Workspaces           | Transcript                           | Context              |
| Sessions             | Reasoning / tools                    | Files / diff         |
| Session tree         | Composer / follow-up queue           | Resources / health   |
+----------------------+--------------------------------------+----------------------+
```

- Navigation rail: 248px default, resizable from 208px to 360px.
- Context pane: 360px default, resizable from 300px to 560px and collapsible.
- Transcript owns remaining width and never drops below 520px on a wide layout.
- Below 1040px, context becomes a drawer.
- Below 760px, navigation becomes a drawer; transcript remains primary.
- Windows keeps native caption buttons through `titleBarOverlay`.
- macOS keeps traffic lights through `hiddenInset`.

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
- Session tree projections are flattened without recursive rendering and keep a
  bounded virtual DOM even when the underlying Pi branch contains thousands of entries.
- Streaming text is coalesced; token-level React commits are forbidden.
- Long code uses a bounded 520px viewport, worker-based highlighting, internally
  virtualized lines, and a full-content copy action; tool output and diff remain
  bounded and require an explicit expansion path when those views are added.
- Markdown never executes raw HTML.
- A stopped, aborted, or crashed turn never appears completed.

### Appearance

- Inside a workspace, the navigation footer exposes an accessible three-option
  menu: System, Light, and Dark. Welcome keeps the same control in the TitleBar
  because the navigation rail does not exist before workspace selection.
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

### Composer

- Main action is `发送`/`Send` or `停止`/`Stop`, never a generic submit label.
- Enter sends and Shift+Enter inserts a new line.
- While streaming, users choose steer or follow-up queue behavior explicitly.
- Attachments are named, previewed, and removable before sending.
- Image attachments accept PNG, JPEG, WebP, and GIF only, with an eight-image,
  10 MiB per-image, and 30 MiB per-message boundary. Rejections remain visible
  beside the composer instead of being truncated silently.

### Session navigation

- Listed sessions are already managed and open in place with the current
  workspace as their effective cwd.
- The file-picker action is named `导入 Pi session 到当前工作区`; it copies a
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

### Extension UI and approval

- Dialogs identify the extension or tool that requested them.
- Approval names exact command/path, cwd, scope, reason, and denial behavior.
- Common extension select/confirm/input/editor requests use accessible dialogs.
- TUI-only custom components show an actionable compatibility message.
- The Provider dialog lists configured state, non-secret credential source, and
  model count. A configured credential is represented as hidden rather than read
  back; complete keys never enter renderer state.
- Runtime credential inputs never refill and state that the value is cleared
  when the Agent Host exits or restarts. A runtime key remains available across
  Desktop-created session transitions within that Agent Host lifetime.
- Doctor reports use text and icons for pass, warning, and failure and keep
  retry available without changing the active Pi session.
- Update checks disclose their GitHub Release network purpose before the first
  request. Unsigned Preview checks and opening the canonical GitHub Release page
  remain separate explicit actions. Unsigned builds expose no in-app download,
  background download, or quit-to-install path.

### Empty, loading, and error states

- Empty states point to the first useful action.
- Welcome keeps workspace selection available before the Agent Host exists and
  labels the host as on-demand until the MessagePort connection is observed.
- Loading copy names the operation, such as `正在加载 Pi 资源`.
- The first on-demand Agent Host connection has one initialization owner. The
  trust action stays disabled until a session snapshot exists, remains disabled
  while resources reload, and never stacks duplicate trust commands.
- Session creation failures replace the loading animation with the failed
  operation and preserved error detail instead of leaving an indefinite spinner.
- Session-transition actions disable together while Pi replaces its runtime;
  repeated extension notices with the same level and message occupy one notice.
- Errors name what failed, what state was preserved, and the next safe action.
- Partial resource failure remains visible rather than silently disappearing.

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
- Prefer `重新加载 Pi 资源` over `重试` and `允许本次命令` over `确定`.
- Never claim installation, recovery, update, or execution succeeded before the
  decisive runtime check passes.

## Avoid

- Provider marketplace navigation or non-Pi branding.
- Hidden critical actions that exist only on hover.
- Unbounded transcript rendering or synchronous Markdown work in hot paths.
- UI that directly edits Pi credential or session file formats.
- Runtime, smoothness, or accessibility claims without observed evidence.
