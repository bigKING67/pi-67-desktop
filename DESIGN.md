---
version: 5
name: π Desktop Design Authority
status: active
platform: electron-web
theme: system-light-dark
color:
  canvas: "#f5f6f4"
  surface: "#ffffff"
  surface-muted: "#eef0ed"
  surface-raised: "#ffffff"
  surface-hover: "#e8ebe7"
  surface-active: "#e0e9e4"
  text-primary: "#171a18"
  text-secondary: "#626862"
  text-tertiary: "#858c86"
  border: "#d9ddd8"
  border-strong: "#c8cec8"
  accent: "#2f6757"
  accent-strong: "#215244"
  accent-soft: "#dcebe5"
  focus: "#2c70c9"
  info: "#2d67aa"
  warning: "#9a5b16"
  danger: "#a43b35"
  text-on-danger: "#ffffff"
  success: "#287248"
  diff-added: "#e0f1e7"
  diff-removed: "#f8e4e2"
  code-diff-added-text: "#9be9a8"
  code-diff-removed-text: "#ffb3ad"
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
  pill: 999
motion:
  fast: 120
  standard: 180
  deliberate: 240
---

# π Desktop Design Authority

## Design read

Reading this as: a desktop Pi coding workspace for beginner and experienced Pi
users, with a calm, exact, compact, operational character, optimized for
completing a real session without learning terminal UI conventions first.

## Visual direction

- Use fixed-commit `pi-gui` and `t3code` reviews as the only comprehensive
  implementation references. Either may inform product, interaction, UI,
  visual design, architecture, Harness, runtime lifecycle, recovery, and
  quality; `pi-gui` is the current primary baseline but not an exclusive
  authority, and `t3code` is not Harness-only. Neither source contributes
  branding, exact pixels, assets, automatic roadmap expansion, or synchronized
  components.
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
  the navigation rail pairs the mark with the compact `Pi-67` wordmark, while
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
+----------------------------------------------------------------------------+
| navigation | current Workspace / conversation | status | notices | Inspector |
+----------------------+--------------------------------------+----------------+
| Workspace groups     | Conversation or Settings workbench   | Inspector      |
| active / recent      | Transcript / tools / Composer        | Files          |
| account          [?] | or scoped configuration              | Changes/Messages/Context |
+----------------------+--------------------------------------+----------------+
```

- The navigation rail is the single persistent product-brand location inside
  the conversation workbench. Its brand lockup is one non-wrapping row containing
  the locked π mark and `Pi-67`; `会话工作台` remains assistive context rather than
  a visible subtitle. The TitleBar is current-context UI, not a second
  brand lockup: while navigation is visible it shows the selected conversation
  title, or the Workspace name when no conversation is selected; while navigation
  is hidden it shows `Workspace / conversation` so location remains recoverable.
  Catalog-only stopped conversations use their Catalog title before they are
  opened. The π mark appears in the TitleBar only when no Workspace context exists.
- Settings uses the plain TitleBar context `设置`. Compact widths may omit the
  Workspace prefix, but preserve the current surface title until the existing
  narrow-window action layout requires hiding the whole context lockup.

Application-level surfaces use a separate wide-window shell:

```text
+----------------------------------------------------------------------------+
| π / Settings                                  | notices | application actions |
+----------------------+-----------------------------------------------------+
| Back + categories    | Settings / update / help content                    |
+----------------------+-----------------------------------------------------+
```

- The navigation rail is the only Workspace and conversation switcher. Each
  Workspace is a collapsible group containing active tasks, waiting tasks,
  provisional drafts, and Catalog-backed recent Sessions.
- The Title Bar contains navigation, the current Workspace/conversation title,
  status, notifications, command actions, and the Inspector toggle. It contains
  no horizontal task strip. The Inspector toggle is the final application action
  before the Windows caption safe area and the rightmost app action on macOS.
- When a Workspace is selected, the title identity area includes one compact,
  keyboard-focusable Repository status control. It distinguishes checking,
  primary Worktree, linked Worktree, non-Git, stale, private-Git-unavailable,
  missing, and failed states with icon plus text rather than color alone. Clicking
  it performs only a read-only refresh. Below 760px the text becomes visually
  hidden while the accessible label retains the complete state. This inspection
  control exposes no create, remove, branch, Diff, or force action.
- A provisional conversation places one `运行环境` fieldset between its intent
  explanation and Composer. It is a native radio selection family with two
  equal-width options: `当前工作区` and `隔离 Worktree`. Local is the default.
  Worktree is enabled only from a fresh ready Repository observation and states
  explicitly that creation starts on the first send; changing the selection
  itself never implies or triggers Git work.
- Each environment option uses one 18px semantic icon, a title, a short outcome
  description, and a trailing Check for the selected state. Selection is not
  communicated by hue alone. The family owns idle, hover, focus-visible,
  selected, disabled, checking, stale/error, and creation-locked states. A
  retryable observation failure exposes one quiet `重新检查` action; creation-
  locked state keeps the chosen radio stable instead of offering a misleading
  switch. Below 1040px the two options become one column without changing their
  reading or keyboard order.
- Environment intent is part of provisional draft recovery. A non-empty draft
  selected for Worktree restores that selection after restart; switching back
  to Local checkpoints the removal of Worktree intent immediately. Environment
  intent never appears on an already materialized Pi Session.
- Clicking a conversation selects both that conversation and its Workspace.
  Switching conversations, collapsing a Workspace, or opening Settings never
  stops or reorders background tasks.
- Navigation and Inspector share `clamp(248px, 18vw, 288px)` on the wide
  three-region layout. Neither side column gains width at the other's expense;
  long names truncate inside the shared measure.
- The Inspector tab strip uses four equal-width compact actions: `文件`, `修改`,
  `消息`, and `上下文`. Changes owns one bounded record list plus one independently
  scrolling Patch detail; it does not widen the Inspector or introduce a fourth
  permanent application region.
- Transcript owns remaining width and never drops below 520px on a wide layout.
- Transcript, execution process, Composer, queue, and Composer-anchored overlays
  share one conversation measure: 860px with both side columns present, 1040px
  when either side column stops consuming layout width, and at most 1120px when
  neither side column consumes layout width. The workbench expands visibly when
  a side column closes without turning ordinary prose into full-window lines.
- Below 1040px, context defaults closed and becomes an overlay drawer with a
  dismissible scrim, so trust, transcript, and composer actions are never
  covered before the user explicitly opens context.
- Below 760px, navigation becomes a drawer; transcript remains primary.
- At narrow widths, grouped navigation becomes a drawer instead of creating a
  second horizontal navigation axis. Title and status truncate without moving
  application actions into the draggable native caption area.
- The packaged window minimum is 680px so the navigation drawer range remains
  reachable after native window frames are applied.
- The conversation workbench is the only three-region surface. Settings and
  future application-level surfaces hide the Workspace rail and Task Inspector,
  occupy the full area below the Title Bar, and use their own two-column
  navigation/content shell. `返回工作台` restores the surface that opened Settings
  when it still exists, otherwise the current Workspace fallback. Background
  Tasks continue without being reordered or stopped.
- The Settings navigation column is a compact directory, not a second brand or
  marketing surface. It begins with `返回工作台` and a functional settings search,
  followed by single-line categories grouped as `个人`, `应用`, `Pi`, and `支持`.
  The Title Bar and About page own the visible product lockup; Settings
  does not repeat the logo, product name, page title, or explanatory hero copy in
  its navigation column.
- Settings selection uses a neutral luminance change with text and icon contrast.
  Product accent colors remain reserved for primary actions, focus, and semantic
  status such as Pi Runtime readiness rather than ordinary category selection.
- Windows keeps native caption buttons through `titleBarOverlay`.
- macOS keeps traffic lights through `hiddenInset`.
- Resizable split handles, multiple editor panes/windows, media preview, and a
  mutation-capable Git client remain future capabilities. The Changes Inspector
  explicitly separates the Pi Session Tool projection (`会话修改`) from Electron
  Main's bounded read-only Git observation (`工作区变更`). Files is the narrow
  Workspace navigator; editable text opens in the central workbench rather than
  replacing the file tree or pretending to offer stage/discard/commit actions.

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
- Body text is 14-15px with a 1.5-1.6 line height. Standard metadata is
  12-13px; space-constrained navigation and Inspector metadata never drops
  below 10px, and their primary labels remain at least 12px.
- Use tabular figures for tokens, context, time, and cost.

## Semantic tokens

CSS consumes only semantic roles:

```text
canvas surface surfaceMuted surfaceRaised surfaceHover surfaceActive
textPrimary textSecondary textTertiary textOnDanger
border borderStrong accent accentStrong accentSoft focus
info warning danger success diffAdded diffRemoved codeDiffAddedText codeDiffRemovedText
codeSurface codeBorder codeText codeMuted overlayBackdrop
shadowFloating shadowFocus shadowComposer shadowHero
```

Spacing uses the 4px scale through named CSS tokens:

```text
--space-1: 4px   --space-2: 8px   --space-3: 12px
--space-4: 16px  --space-5: 24px  --space-6: 32px
```

Components use these names rather than undeclared positional values. A missing
token must fail review because it can invalidate an entire CSS shorthand.

Radius roles are semantic rather than positional: controls use
`--radius-control`, panels and cards use `--radius-panel`, dialogs and popovers
use `--radius-overlay`, pills and badges use `--radius-pill`, and true circles
use `50%`.

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
- User messages use a compact, content-width bubble aligned to the right edge of
  the shared adaptive conversation measure. Short messages never expand to the
  maximum width; long prompts, code, and attachments remain bounded. The visible author
  header is omitted because position and surface already communicate ownership,
  while the message article retains an explicit accessible user label. Pi and
  Tool output remain left-aligned, wide editorial content with visible authors.
- Every settled User or Pi message exposes one low-emphasis action footer without
  widening the adaptive conversation measure or creating document-level
  horizontal scroll.
  Pi answers place `复制回答` and `在新任务中继续` before the timestamp; User
  messages place the timestamp before `复制消息` and `编辑消息`. Action
  targets remain at least 28px, are keyboard-focusable, have named tooltips, and
  stay discoverable without depending exclusively on hover. Tooltips prefer the
  space below their action and use overlay collision handling; they never cover
  the message content merely to stay attached to the footer.
- Message timestamps are stable source timestamps and always render the complete
  local `YYYY-MM-DD HH:mm` value. Full seconds and the local UTC offset belong in
  the native time tooltip; relative labels such as `刚刚` never replace the date
  in the Transcript. Missing source time is identified as unknown rather than
  synthesized from React mount time.
- `复制回答` includes only final text parts: it excludes thinking, images, and raw
  Tool payloads. Copy success is announced inline; Clipboard failure remains
  observable through the message action state and notification history. Tool
  details keep their own bounded copy contract.
- A non-empty visible Thinking part renders as reasoning text inside the turn's
  execution process rather than as a second nested disclosure. Provider-only
  signatures, encrypted reasoning, and whitespace-only placeholders never create
  an empty process step.
- An Assistant turn that settles with an empty content array is not rendered as
  unsupported content. It remains a visible model-response failure with a retry,
  model-switch, and Provider-configuration recovery path; aborted empty turns keep
  their distinct stopped state.
- Consecutive reasoning Assistant parts, progress narration, Tool Calls, and Tool
  Results form one execution disclosure in the Transcript. A process with Tools
  summarizes as `执行过程 · N 次工具调用 · duration`; a process without Tools falls
  back to `执行过程 · N 个步骤 · duration`, and a failed Tool count is appended when
  present. Within it, reasoning uses the low-emphasis `分析` label, narration uses
  the parallel `进度` label, and each Tool Call is paired with its correlated Tool
  Result as one compact logical step; the call and result are never rendered as
  duplicate peer cards. An unmatched legacy Tool Result remains one explicitly inspectable
  compatibility step. This includes visible reasoning carried beside final text in
  one Assistant record: the reasoning belongs to the process while the text remains
  the final answer. The current process is expanded while work is running and
  collapses automatically only after the Operation completes with a visible final
  answer. Failure, cancellation, loss, and completion without a final answer remain
  expanded for diagnosis. Expanding a settled group restores every reasoning part,
  bounded Tool step, and bounded Tool Result in source order; collapse never removes
  process data. The final Assistant answer remains an ordinary editorial Markdown
  message outside that process surface. Pi JSONL remains the conversation source of
  truth; this hierarchy is a disposable Renderer projection.
- A recognized Tool row leads with a human semantic action and one bounded target
  summary. Its exact Tool identifier, response identity, and bounded redacted
  argument projection belong inside the expanded detail rather than competing on
  the default row. Dedicated presenters derive summaries from allowlisted fields;
  structured arguments from an unknown Tool collapse to `已提交参数` instead of raw
  JSON, while the unknown Tool name remains visible as its only reliable identity.
  Tool titles use 12px, semantic summaries 11px, and process metadata no smaller
  than 10px. Desktop widths keep one truncated row; narrow widths use one deliberate
  second metadata row rather than arbitrary wrapping or document overflow.
- An AUTO-admitted Tool row may append one non-interactive, low-emphasis reason:
  `AUTO · 已配置来源`, `AUTO · 只读`, `AUTO · 工作区命令`, or
  `AUTO · Workspace 内写入`. The reason
  is a fixed enum projected by Host/Runtime authority, stays on the same unwrapped
  header line without becoming a badge, and remains visible when a completed
  process is reopened. It never competes with the Tool name, compact summary, or
  terminal status, and Renderer does not derive it from Tool names or arguments.
- A raw Tool Result uses an inset log surface rather than Assistant prose: the Tool
  identity and terminal state remain visible, text uses a whitespace-preserving
  monospace viewport with independent horizontal and vertical overflow, long output
  stays height-bounded until `展开全部`, and result copy is independent from
  `复制回答`. Tool output is never parsed as trusted HTML.
- `编辑消息` is an in-place interaction owned by the historical User card.
  Activating it focuses a bounded textarea in that card and sends no Host command;
  cancel has no side effect and restores focus to the same action. `发送修改` first
  derives an append-only-safe Pi Session immediately before the source entry, waits
  for authoritative `session.bootstrap`, and submits the edited Prompt directly.
  The current Workbench Task identity stays stable, the bottom Composer is neither
  focused nor prefilled, and the product UI does not expose branch terminology.
  If Session preparation succeeds but Prompt acceptance fails, the same inline
  editor remains recoverable for retry or cancellation back to the source Session.
  Existing Composer text or attachments block edit rather than being overwritten.
  Image-bearing historical prompts remain copyable but explicitly unavailable for
  lossy edit until attachment replay has an authoritative contract.
- `在新任务中继续` immediately creates and selects a distinct provisional
  Workbench Task, then copies the source Pi Session context through the selected
  Assistant entry into that target Task. The source Task, source Session, and their
  writer authority remain unchanged. The target bootstrap is accepted only under
  the new Task authority; failure removes the provisional target, reactivates the
  source, and never replaces source history. New and source Tasks can continue
  independently after the copy commits.
- Per-message model identifiers are not persistent visual chrome. The Pi/Tool
  author and semantic states such as `已停止` or an error remain visible. Pending
  User bubbles may expose copy and source time but not historical edit; live
  Assistant output and ordinary Tool/System rows expose no settled-message footer.
- A new-turn Prompt appears as an in-memory pending user bubble as soon as the
  Agent Host acknowledges it. The empty state disappears before the first Pi
  token. The current Turn's inline execution timeline follows that bubble in the
  Virtuoso footer and precedes live Assistant output. It accumulates only real
  Host-authored activity transitions, shows at most the latest four steps inline,
  and keeps earlier steps behind one disclosure; it never replaces the submitted
  message or occupies a separate Workspace-level row. Pi JSONL remains
  authoritative: the matching Operation's
  user-entry projection replaces the pending bubble without flicker or duplicate
  content. Failed uncommitted Prompts remain visible with an explicit error, and
  pending state never crosses Host, Session, generation, or projection authority.
- Draft attachment Blob URLs transfer to the pending bubble on acknowledgement.
  They are revoked only after authoritative reconciliation, failure disposal, or
  authority replacement; the renderer never copies their binary payload merely
  to keep the acknowledgement state visible.
- Long transcript code uses a bounded 520px viewport, worker-based highlighting, internally
  virtualized lines, and a full-content copy action. Long lines preserve their
  source layout and remain horizontally navigable without a persistent scrollbar;
  an actually overflowing viewport becomes keyboard-focusable, exposes a visible
  focus ring, and supports keyboard scrolling. Copy reports `复制`, `已复制`, or
  `复制失败` through the same bounded feedback contract used by message and Tool
  copy actions. Code never widens the Transcript or application document. Tool summaries and
  recorded Edit Patch facts remain bounded; complete Tool Output and an unbounded
  whole-repository Diff require future explicit data and expansion contracts.
- Editorial Markdown uses visible heading, paragraph, nested-list, quote,
  separator, and GFM task-list hierarchy. GFM tables retain semantic table
  structure, a quiet header surface, cell spacing and row boundaries; a wide
  table scrolls only inside its keyboard-focusable table viewport and never
  widens the Transcript or application document. Streaming and settled text use
  the same semantic structure so completion does not replace the document layout.
- Formulae accept `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`, plus fenced
  `math` blocks. Recognized formulae lazy-load KaTeX and its CSS rather than
  increasing the ordinary prose path. KaTeX emits HTML plus MathML with
  `trust=false`, bounded expansion and size; raw HTML remains disabled. An
  incomplete streaming delimiter stays readable as source text until complete,
  a parse failure remains visible, and a wide display formula scrolls only inside
  its keyboard-focusable formula viewport.
- A validated Workspace-relative Markdown link resolves through the current
  Workspace Host boundary and opens the ordinary central file tab. Absolute,
  traversal, malformed, active-scheme, and unsupported links remain inert.
  Source fragments are preserved for future line navigation but do not invent a
  line jump in this release.
- Markdown never executes raw HTML or directly mounts Markdown image sources.
  HTTP(S), data, Workspace-relative, and unsupported images render one inert,
  labeled placeholder; an HTTP(S) placeholder may explicitly open the source URL
  through the existing external-link boundary.
- Session images never render a cross-process data URL. A generation-bound asset
  reference loads only while its virtualized message is mounted, shows explicit
  loading/unavailable/retry states, and renders from a lazy Blob URL. Host
  replacement revokes cached URLs so an old connection cannot remain visually
  authoritative.
- A stopped, aborted, or crashed turn never appears completed.
- A Session compatibility banner appears above known transcript content only for
  `partial` or `future-format`. It names supported and observed format versions plus
  bounded unknown/unrenderable counts without transporting raw unknown entries.
  Known messages remain readable. `重新同步` requests an authority-bound projection
  resync; `查看诊断` opens Doctor. Compatible Sessions render no banner, and theme,
  resync, or dismissal cannot invent support for unknown content. The banner is
  informational; existing Session identity, branch, external-change, Task-generation,
  and Host-epoch guards continue to own mutation safety.
- Tool presentation is registry-driven. Bash, read/search, edit/write, and
  unknown tools render bounded, copyable summaries; the UI states explicitly
  when cwd, duration, output, Diff, or file preview is absent from the projection.
- Verified declarative Extension Adapter metadata takes precedence over tool-name
  heuristics and may choose only `generic`, `command`, `read`, `change`, or
  `delegated` presentation grammar. `delegated` is reserved for a package/version/
  source/runtime-surface verified Adapter and uses the same bounded running,
  completed, and failed states as other Tool rows. It is not a child-agent roster:
  no child identity, model, token/cost, tree, parallel count, or result is inferred.
  It never loads Extension HTML, JavaScript, CSS, React components, or renderer
  modules. Historical tools without a current-generation `toolCallId` binding and
  generic same-name Tools remain on the built-in or generic presenter.

### Inspector

- The primary order is `文件 / 修改 / 消息 / 上下文`; Files is the default. The Files
  root preserves expansion, search, selection, and scroll state while the
  Inspector stays mounted. Directories load in pages of at most 200 entries.
  Tabs, search text, file names, message summaries, tree labels, and resource
  names use at least 12px type; constrained ordinals, paths, counts, timestamps,
  and other compact metadata use at least 10px. File-tree rows remain at least
  32px high.
  Search accepts at most 256 characters, returns at most 200 matches, visits at
  most 50,000 nodes, always skips `.git`, and skips dependency, generated, and
  cache directories from both the tree and search unless `显示依赖/生成目录` is
  enabled. Search results render
  file name as primary text and relative directory/path as secondary metadata;
  toggling that option refreshes the tree and reruns the current query without
  losing expansion, selection, or scroll; stale responses cannot replace the
  latest result. A failed child directory exposes an inline `重试` without forcing
  a whole-tree reset.
- `Cmd/Ctrl+Alt+F` and the Command Palette open one neutral, focus-trapped Workspace
  file-body search dialog. It owns query, case sensitivity, optional generated/
  dependency inclusion, loading, empty, error, incomplete, and opening states. It
  never resembles or controls Provider Web Search. Agent Host bounds each search to
  256 query characters, 200 matches, 2,000 files, 1 MiB per file, 64 MiB total,
  4,096 characters per line, 320-character snippets, and three seconds; `.git` and
  symlinks are always excluded. Each row shows relative path, original-text line/
  UTF-16 column, and a bounded snippet. Selection opens the central file tab only
  after exact opaque-reference/revision revalidation and positions the editor at
  that line; dirty or stale bytes fail closed. `添加到上下文` reuses the existing
  opaque Workspace file reference instead of copying a source body into Workbench.
- Directory rows expand or collapse. Clicking an ordinary file opens or focuses
  its central Pi-67 file tab; source never gets squeezed into the Inspector.
  The row menu presents `在 Pi-67 中打开`, system-default open, relative-path
  copy, absolute-path copy, Finder/Explorer reveal, rename, and confirmed trash
  in that order, and the native right-click menu keeps the same management actions.
  Successful path copy owns visible feedback. The toolbar combines file/folder
  creation under one compact, flat plus-and-chevron action with an accessible label
  and tooltip, without redundant visible `新建` text, persistent outline, or pill;
  refresh stays separate but uses the same icon-action visual language. Toolbar
  targets are at least 28px on a side and expose tooltip, focus-visible, disabled,
  and loading states. Neither the filter/action row nor its action group receives
  a bordered, filled, rounded, or pill-shaped enclosing surface; only the individual
  icon actions may show transient hover, pressed, or focus feedback.
- File navigation uses `tree`, `treeitem`, and `group` semantics with level and
  expansion state. The entire row remains the primary 32px click target; the
  secondary menu target does not overlap it. Keyboard users can focus rows,
  expand/collapse directories, move between parent and first-child rows, open files,
  and reach every row action without a pointer. Type and expansion state remain
  available to assistive technology. Message list items retain a nested native
  button rather than replacing button semantics with `listitem`.
- Create-file, create-directory, rename, and draft-save-as share a padded,
  responsive dialog shell with a visible destination summary, name label,
  example placeholder, supporting text, inline error, and stable footer. The
  create-file variant adds a file-format selector: `自动识别`, Markdown,
  TypeScript, JavaScript, JSON, YAML, and plain text. It displays the detected
  format and extension, while the filename extension remains the only editor
  language authority. Rename initially selects the basename while preserving a
  file extension. Validation is immediate but non-destructive; Host failure
  remains inline, preserves focus and input, and never collapses into Toast-only
  feedback. Enter submits a valid form except during IME composition.
- File references are Host-epoch opaque IDs scoped to one registered Workspace.
  Every list, search, resolve, open, save, create, rename, reveal, system-open,
  copy, and trash boundary rechecks persisted Workspace identity, trust, `lstat`,
  canonical containment, `.git` exclusion, and the allowed entry kind. Symlinks,
  sockets, devices, FIFOs, traversal, and platform-reserved names fail closed.
- `在 Pi-67 中打开` deduplicates by Workspace and relative path. The central tab
  row begins with fixed `对话`, followed by file tabs. Selecting Workspace or
  Conversation returns to `对话` without removing file tabs; a Settings round
  trip preserves the active tab. A file surface replaces Transcript and Composer
  in the DOM only while active, without changing the background Pi Task Runtime.
- The editor accepts strict UTF-8 regular files up to 2 MiB and provides line
  numbers, syntax highlighting, search, undo/redo, and `Cmd/Ctrl+S`. Binary,
  invalid UTF-8, oversized, symlink, missing, and special files own explicit
  unavailable states. Clean inactive tabs release source text and reopen it on
  demand rather than retaining every file body indefinitely.
- Save carries the opened opaque revision and cannot overwrite an external
  change. A dirty conflict exposes `放弃草稿并重新读取` and `将草稿另存为`;
  every reload that would replace a dirty draft requires a confirmation and a
  failed read leaves the draft intact. Closing a dirty tab offers save, discard,
  and cancel. Clean tabs and dirty drafts restore per
  Workspace. Draft text is encrypted with Electron `safeStorage`; unavailable
  encryption means no plaintext draft persistence and a guarded exit. Limits are
  32 tabs per Workspace, 128 per app, and 20 MiB of dirty drafts.
- No file body enters Workbench state, Pi JSONL, notifications, diagnostics,
  logs, or telemetry. The first release has no split pane, new editor window,
  system file association, media preview, or unbounded whole-repository Diff.
- Active-branch `edit` and `write` facts enrich their matching transcript Tool
  card through `toolCallId` and populate the Inspector `修改` view from the same
  authority-safe projection. The list is newest-first, reports retained files and
  total records, and selects the newest retained record when an older selection
  leaves the bounded window.
- `edit` detail uses the calibrated dark code surface in both themes, distinguishes
  Patch metadata/additions/deletions/context without hue alone, and caps rendered
  output at 600 rows while preserving Host truncation disclosure. `write` detail
  explicitly states that no before-version exists, so no historical Diff is
  invented.
- Changes owns loading, empty, stale, error, ready, and truncated states. Refresh
  retains the previous projection until an authority-matching replacement commits;
  a current failure remains visible beside cached content. Live Changes upsert by
  `toolCallId`; Session bootstrap, Host generation change, delayed responses, and
  projection resync cannot mix records from different Session generations.
- Changes groups settled records by their originating Turn as `第 N 轮`; records
  that do not yet belong to a settled Turn remain under the truthful `当前操作`
  label. A row is `已查看` only after its exact authority-safe fingerprint has been
  selected. A changed path, status, Patch, metrics, or revision for the same
  `toolCallId` restores `未查看` without switching the user's current detail.
- `工作区变更` uses the same compact list/Patch grammar but a separate state and
  authority label. Main resolves cwd from the selected registered Workspace,
  executes packaged private Git under bounded time/output budgets, and returns
  revision-scoped opaque `changeId` values. Renderer never supplies a path or cwd;
  Patch requests contain only `workspaceId + revision + changeId`, and Main
  revalidates Workspace identity plus the status fingerprint before and after the
  read. Loading, empty, unsupported-repository, stale, error, and truncated states
  remain distinct. No row exposes stage, discard, commit, push, or PR actions.
- A complete, line-mappable Session or staged/unstaged Git Patch adds a review layer
  without turning Changes into a mutation-capable Git client. `Viewed` is bound to
  the exact content fingerprint; `Reviewed` requires an explicit user action;
  `Pending` is represented by one or more line comments in the encrypted Task draft;
  `Stale` appears when revision/fingerprint authority changes. Reviewable rows show
  old/new line numbers and a visible selected state with keyboard focus. Truncated,
  Renderer-omitted, binary, metadata-only, or otherwise non-mappable Diff remains
  readable but disables exact comments and Reviewed confirmation with explicit copy.
- A line comment binds section (`session`, `staged`, or `unstaged`), old/new side,
  line range, exact Diff fingerprint, opaque file reference, and file revision. The
  Composer shows pending comments as removable context chips; stale chips use warning
  semantics and block submission until removed or rebound. Patch text is never stored
  in the draft or appended wholesale to the Prompt. `prompt.submit` remains the only
  Agent side effect. Accepted exact submission snapshots clear only their captured
  comment IDs; rejected/terminal failures preserve them, and newer in-flight comments
  survive an older acceptance.
- Messages shows only user-authored messages on the current active branch. The
  index is paged at 100 by default and 200 maximum, previews are capped at 120
  grapheme-scale characters, and image/attachment counts contain metadata only.
  Clicking a loaded message scrolls and focuses its virtualized Transcript row;
  clicking an unloaded message installs one bounded historical window, disables
  edit/continue actions, highlights the target with Reduced Motion support, and
  offers `回到最新消息`. Sending a new turn exits historical mode.
- `Cmd/Ctrl+F` searches visible user/Assistant text in the current Pi JSONL branch;
  `Cmd/Ctrl+Shift+F` performs a bounded, explicit cross-conversation body search in
  the current Workspace and opens the exact Session/message. Both are local
  navigation features. `@file` is a Workspace file-reference action. None of these
  controls Provider Web Search, which remains a model-decided Pi/Provider capability
  with no user-facing enable/disable switch or persisted preference. The UI shows
  Web Search only when a request actually runs, including its sources and citations.
- Session tree projections are flat and renderer recursion is forbidden. They
  are no longer an Inspector tab: `/tree` and the command palette open the
  dedicated `会话分支与回退` dialog, where common technical node types are shown as
  user-facing events before a rollback is selected.
- At most 512 nodes and 128 KiB of tree JSON cross the process boundary; the
  active node remains prioritized and truncation is visible.
- Tree rows are virtualized. The Context tab contains usage, Extension status,
  and Resources without forcing conversation history to be reprojected.
- The product still does not offer a whole-repository unbounded Diff, staging,
  discard, commit, push, or PR workflow; only the current bounded per-change Patch
  authorities participate in review.

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

### Workspaces, conversations, account, and Settings

- A Workspace is a project/configuration/Session Catalog container. A live Task
  is bound to one Workspace, one Pi JSONL Session, and one independent Pi Runtime.
  A Conversation is the navigation identity for either that live Task, an idle
  Catalog Session, or a provisional draft.
- Each Workspace disclosure initially shows active/waiting/draft rows first and
  the six most recent ordinary Sessions after them. `展开显示` loads additional
  bounded Catalog pages; there is no user-visible open-conversation limit.
- Current-Workspace emphasis belongs only to its quiet header tint. The complete
  Workspace group and conversation list remain on the navigation surface, while
  the current conversation row carries the primary selected state.
- Selecting a conversation automatically expands its Workspace and keeps the row
  visible. A collapsed Workspace with background work shows running and waiting
  counts on its group header without relying on color alone.
- A selected idle, stopped, or lost conversation never inherits a stale live
  projection merely because its Session ID still matches. Until Pi reacquires
  runtime authority, the center surface shows an explicit `打开会话` or `恢复任务`
  action and does not mount the Transcript, Composer, or Inspector projection.
- Opening a Workspace with no known formal conversation keeps the center in one bounded
  loading/recovery state while the first Catalog page is decided. Existing rows open before
  any new Task is created; a verified empty Catalog creates exactly one first Session.
  `正在建立 Session 目录…` may retry at one and three seconds, but a five-second opening
  budget ends without a provisional row and leaves the Workspace selected with an explicit
  retryable notice. The UI never converts "not indexed yet" into "no conversations".
- If recovery confirms that the current Host has no Runtime for a persisted Task,
  Desktop retains the Pi JSONL Session identity but rotates the stale Task
  authority before initialization; an obsolete Task ID is never replayed into a
  new Host instance.
- If the failed preflight resync has intentionally closed the event stream,
  successful Session initialization is followed by an authoritative projection
  resync before the live surface mounts. The initialization acknowledgement alone
  never substitutes for the Session snapshot.
- At most eight top-level Session Tasks (`MAX_RUNNING_TASKS = 8`) may be accepted, running, waiting for
  safety approval, or waiting for blocking Extension input. Subagents launched
  inside one Task do not consume additional top-level slots. Reaching the limit
  explains which state is preserved and that an existing Task must settle or stop
  before another send.
- A row menu uses the same compact raised-Popover language as Workspace menus and
  owns `置顶对话` / `取消置顶`, `重命名对话`, conditional `恢复自动标题`, and
  `归档对话`. `停止任务` is separated as a danger action and appears only for an
  accepted, running, approval-wait, or Extension-input-wait Task. Idle and
  terminal conversations never expose a non-functional stop action.
- Conversation titles have one semantic authority across cold Catalog rows and
  loaded Tasks: explicit Pi `session_info.name`, then the latest topical User
  message on the current Pi branch, then `未命名对话`. Routine follow-ups and bare
  navigation commands do not displace the previous topic. The title stays on one
  line in navigation and truncates rather than wrapping the row. Automatic titles
  are derived locally without a model and remain query-time/memory-only; the
  explicit rename and empty-name restore operations alone append Pi
  `session_info` entries.
- Archive is reversible organization rather than deletion. Active,
  initializing, provisional, and draft conversations expose a disabled archive
  action with the Controller retaining the same fail-closed check. Successful
  archive removes any pin, disposes an idle loaded Runtime first, returns a
  selected row to the Workspace surface, and presents a bounded Undo Toast.
  `已归档对话` is a focus-trapped, dismissable dialog with debounced server search,
  bounded pagination, loading/error/empty states, full local archive date and
  time, relative last-modified metadata, `恢复`, and `恢复并打开`. Restore actions
  disable while pending so duplicate mutations cannot be issued. No current UI
  permanently deletes Pi JSONL.
- Settings opens as one singleton application-level selected surface and does
  not count toward Task limits. It replaces the Workspace rail and Inspector
  with its own category/content columns; opening it again focuses the same
  surface. `返回工作台` restores the originating conversation or Workspace when
  it is still available, with the current Workspace fallback after restart or
  removal.
- Settings search indexes category labels, visible concepts, and common Pi or
  localized terms. Search results remain real navigation targets; selecting a
  result opens the owning category, `Cmd/Ctrl+F` focuses search while Settings is
  mounted, Escape clears a non-empty query, and an empty result state offers an
  explicit reset. A decorative or non-functional search field is not allowed.
- Category rows are single-line and keep detailed explanations in the owning
  Settings document. The document begins with one category title and one bounded
  summary; global-only sections do not repeat a redundant `全局设置` label, while
  project-aware sections retain the explicit scope switch in the same header row.
- Settings owns `账户`, `外观`, `模型`, `扩展`, `技能`,
  `提示词模板`, `工作规则`, `浏览器集成`, `运行服务`, `用量分析`,
  `下载源与网络`, `更新与诊断`, and `关于`. The directory groups them as
  `应用`, `Pi`, `连接与集成`, and `系统与支持`. Account, Appearance, Model
  Services, managed Rules, Browser Integration, Runtime, Usage, Download
  Sources/Network, Updates, and About are global-only and do not show a meaningless
  page-level scope control. Only the Extension workspace and Prompt Templates use
  the generic global/current-project switch; Skills and Rules own their explicit
  availability tabs instead.
- Every Settings category uses one centered `min(1120px, 100%)` document flow and
  the content region is its only vertical scroll owner. Page title, summary,
  scope, section headings, and content share the same cross-category alignment;
  lightweight pages create compactness through row density instead of recentering
  a narrower document. The document keeps `32px` top,
  `clamp(24px, 3vw, 32px)` inline, and `48px` bottom padding; narrow windows retain
  full-width content without document-level horizontal overflow.
- Settings uses three intentional content grammars. **Grouped Settings** places
  related `64px` minimum rows inside one `12px` rounded surface with only row
  dividers; a row is never an independent card. **Catalog** places tabs, search,
  filters, and `72px` minimum rows directly on the document canvas without one
  giant outline or floating cards. **Editor / Notice** lets a textarea, long
  editor, or semantic notice be the surface and forbids another ordinary card
  around it. Section headings remain outside all three surfaces.
- Provider, model, and Package catalogs always use explicit drill-down rather
  than automatic master-detail expansion: `Provider 目录 -> Provider 编辑 ->
  模型目录 -> 模型详情` and `Package Catalog -> Package 详情`. No viewport or
  container width makes those surfaces side by side. Labeled return actions
  restore query, filter, selected item, draft state, and catalog scroll position.
  This prevents Settings from becoming a third or fourth application column on
  either common or ultra-wide windows.
- Pi resources follow the final ResourceLoader classification rather than the
  Package name or filesystem heuristics. The single `扩展` workspace owns three
  explicit views: `扩展包`, `内置扩展`, and `本地扩展`. `本地扩展` consumes only
  top-level Extension resources from global or project extension directories and
  explicit `settings.json` paths; Package-attributed Extensions never repeat there.
  `技能` owns two availability views: `全局可用` and `项目专属`. `全局可用`
  groups Desktop-owned `内置技能套件`, standalone updater-owned `受管技能套件`,
  and exact-scope `本地全局技能` on one page; source and update ownership remain
  visible within those sections instead of competing with availability as peer tabs.
  When a managed Pack shares a `suiteId` with an immutable bundled suite, Renderer
  merges its current/latest version, effective source, update, and restore state into
  that single suite row and detail instead of rendering a second Pack identity. The project
  view consumes only top-level Skills owned by the current project. Package-
  attributed Skills never repeat in either view. Verified updater-owned members
  may be summarized once at Pack level, while all remaining user-scope Skills stay
  in `本地全局技能`. `提示词模板` lists Prompt Templates invoked manually through
  `/名称`; they do not become persistent Session rules.
  `工作规则` owns concise `全局` / `项目` tabs instead of the generic Settings
  scope control. The global scope shows `全局工作规则` directly. The project scope
  shows `项目工作规则` followed by `继承的工作规则`. A default-collapsed `高级`
  disclosure contains `Pi-67 内置规则` and `系统提示词覆盖` globally, and only
  project system-prompt overrides in project scope. Pi-67 built-in Markdown remains
  visible per file but read-only. Controlled user-global files and regular files in
  a trusted Workspace are editable; Workspace-external inherited files are read-only.
  Missing canonical `AGENTS.md`, `SYSTEM.md`, and `APPEND_SYSTEM.md` entries appear as
  explicit creation candidates, while arbitrary names, paths, rename, and delete are
  absent. Counts and configured labels include only `presence = present`; an absent
  system-prompt pair reads `未配置`, and an overridden file reads
  `已配置 · 当前未生效`. Existing `CLAUDE.md` variants may be edited but never gain a create action.
  Selecting a row opens one full-width drill-down with a labeled return action,
  path/source/scope/load state, bounded UTF-8 byte count, and `源码` / `预览` modes.
  Read-only source uses the same editor geometry without mutation controls. Preview
  never executes raw HTML or loads remote Markdown images; blocked images render an
  inert labeled placeholder. Editor and preview own bounded scrolling and never add
  document-level horizontal overflow, including the 520x400 compact surface.
  Editable files expose cancel and `保存并重新加载`, plus `Cmd/Ctrl+S`. Switching file,
  scope, Settings category, or returning to the Workbench while dirty opens exactly
  one discard guard. Saving is disabled during reload, on oversized UTF-8 content,
  or after an external revision conflict. A conflict keeps the draft visible and
  requires an explicit latest-file reload; a successful save updates the revision,
  catalog, and Pi reload status without placing Markdown content in notifications,
  Session projection, or persisted Workbench state. Returning to a catalog restores
  its prior scroll position.
- Provider, Download Sources/Network, and Rules/Context register at most one
  active Settings draft with the shell. Category changes, applicable page-scope
  changes, and `返回工作台` open one discard dialog while dirty. `继续编辑` is the
  default focus; the destructive choice discards the current in-memory draft before
  completing the original navigation. A successful save may complete a pending
  navigation without a second prompt.
- Product navigation calls the transient execution environment `运行服务`, not
  the literal translation `运行时`. Persistent Pi JSONL Sessions remain in the
  Workspace navigation unless a real, independently actionable Session-settings
  surface is introduced; Settings does not combine Runtime and Session merely
  because their implementation lifecycles are related.
- The `扩展` workspace's `扩展包` view owns third-party Package installation,
  update, and uninstall exactly once. A
  multi-resource Package appears as one lifecycle row and identifies every
  Extension, Skill, Prompt Template, or Theme it contributes. Per-resource
  enable/disable changes only that Package filter; it never flattens object
  filters or removes sibling resource filters. Update and uninstall remain
  explicitly Package-wide operations. Third-party Package Extensions remain in
  their Package detail and never duplicate into `内置扩展` or `本地扩展`.
  Third-party Package Skills likewise remain in Package detail and never duplicate
  into `全局可用` or `项目专属`.
- `内置扩展` lists user-visible Extension entries shipped by Pi-67 Desktop.
  The catalog exposes individual bounded identities rather than presenting an
  entire first-party capability Package as one Extension. These entries report
  installed readiness and application-owned versioning; they update with the
  application and cannot be independently installed or uninstalled. Hidden
  policy and safety Extensions remain internal system components.
- `全局可用` begins with a bounded set of user-facing `内置技能套件`, then opens one
  selected suite in an independent drill-down detail with search and a labeled
  return action. Suite rows own the repeated count, readiness, and content-owned
  baseline version; they never use the carrying capability Package version as a
  substitute. The detail begins with `内置基线`, `更新方式`, and verified upstream
  provenance before listing members. Individual detail rows retain the real Skill identity,
  bounded purpose, owning capability Package, and version without repeating a
  misleading loaded state. A Pi-67 Skill Pack version resolves from its registry
  and lock. AI Berkshire is regenerated at build time from a separately pinned
  upstream commit using the adapter from the locked Pi-67 Core source; the expected
  Pack version, source-manifest hash, and bundle hash must all match before its Skills
  may overlay the immutable Core baseline. A single capability suite resolves from the locked capability Package,
  a multi-source aggregation says `N 个内置来源`, and an unversioned upstream says
  `未独立版本化` rather than inventing SemVer. Suite membership is an explicit build-time manifest
  validated against every first-party Skill in the Desktop capability catalog;
  Renderer prefix matching, Package-name guessing, and `extensions` or `skills`
  directory heuristics are forbidden. `本地全局技能` remains an exact user-scope
  top-level projection: verified updater-owned members are excluded after being
  summarized once at Pack level, while loose Skills remain individually user-owned.
  `项目专属` remains a project-owned exact-scope list and is unavailable until the current Workspace is
  available and trusted. Project and loose Skills never gain an update action from
  a folder name, README URL, or guessed repository. The UI does not guess same-name
  precedence: current task resolution remains Pi ResourceLoader authority.
- Managed global Skill Packs use `套件 -> 套件详情 -> 单个技能`; a Pack with a
  bundled baseline stays in the single `内置技能套件` identity, while only standalone
  Packs appear in `受管技能套件`. The page owns one explicit `检查技能更新` action
  and never checks the network merely because
  Settings opened. Each Pack row identifies owner, installed/latest version, member
  count, local synchronization state, and a separately focusable `更新` action only
  when the owning updater verifies an automatic update. Row detail and update are
  sibling controls inside one shared hover surface. The update action opens a
  one-shot Pack-wide confirmation naming source, current and target versions,
  affected Skills, and local state; it never mutates silently. A detected local
  modification or unverifiable updater disables automatic overwrite and remains
  visibly actionable as a recovery state. Before a check, an updater-owned suite says
  `尚未检查`; after a successful check it says `已是最新` or `可更新`. A newer legacy
  registry record that is not independently installable says `暂无可安装更新`, while an
  older record is labeled `Registry 记录版本` rather than `最新兼容版本`. Lark official Skills update through the
  installed Lark CLI as one Pack. When all official Skills already match the latest
  reported Skill version, a lagging CLI version is an update state rather than local
  drift; unproven drift remains `技能不同步` and blocks overwrite. Lark detail labels
  `当前 CLI`, `官方 Skills`, and `最新稳定版本` separately and attributes member rows
  to `Lark CLI 官方 Skills`, never to the capability Package carrying the immutable
  baseline. A mutation pins one external CLI installation across check/update/check;
  failure rechecks that same source or invalidates the stale success state. Extension Package
  Skills remain in Package detail,
  bundled Skill suites retain an immutable Desktop baseline, and Desktop never
  performs a live `git pull` of an arbitrary Skill repository. AI Berkshire records
  `https://github.com/xbtlin/ai-berkshire` plus its locked source commit. Its independent
  update state is `available`: the confirmation installs only registry-declared Skills
  as a separate Pi Package Overlay, exposes bundled/effective/latest versions, reloads
  every Workspace, rolls back activation on reload failure, and offers a confirmed
  `恢复内置版本` action. A legacy `bundled-release-only` registry entry without an
  installable upstream may report an older non-installable version as current history,
  but cannot enable staging or relax independent-update provenance. browser67
  updates only as a complete capability Package; aggregated design tools update by
  their individual sources.
- Pi Packages use two local views: `已安装` and `发现扩展包`. Tabs,
  page-level actions, search, and filters sit directly on the document canvas.
  `已安装` lists configured third-party sources and moves Package metadata and
  destructive operations into the selected drill-down detail rather than
  repeating action clusters on every row. The selected detail leads with a
  bounded plain-text purpose based on the installed local package identity and
  manifest. The Chinese locale uses reviewed identity-keyed copy for known Pi
  packages, preserves package-authored Chinese descriptions, and uses an explicit
  Chinese fallback for unknown non-Chinese metadata instead of exposing raw
  English or machine-translating untrusted text. It lists only declared resource
  types and never fetches or renders remote README/HTML. The installed catalog row
  keeps its primary trigger for Package detail, while an independently focusable
  `更新` action appears only when that Package has a verified available update.
  The shared row container owns hover and selected surfaces across both controls,
  while focus remains visible on the exact detail or update trigger. The action
  uses pointer, hover, pressed, focus-visible, and disabled states and opens the
  same one-shot Package-wide confirmation instead of updating silently.
  Package rows separate content admission from resource filters. Their six visible
  states are `已启用`, `部分启用`, `已停用`, `未安装`, `待确认`, and
  `内容已变更，待重新确认`. `unverified` content uses `待确认`; `drifted` content
  uses the changed state. Neither is counted as enabled, and per-resource toggles
  remain unavailable until the current bytes are admitted. Package detail offers
  `确认当前内容` or `重新确认当前内容`; this records the observed bytes without
  downloading or reinstalling. It names the trust state, bounded integrity reason,
  and last observation time without displaying install paths, directory identities,
  receipt digests, or raw receipt content.
  A successful mutation with an `active` or `removed` receipt produces one Package-specific floating result containing
  the display name, available version transition, scope, and completed resource
  reload. An `ambiguous` receipt instead shows one warning that the operation was not
  replayed and the Package remains pending confirmation; it never shows an install/update success
  toast. Routine `resource.changed` and informational Extension notifications stay
  in Notification history without creating additional floating toasts; warning and
  error Extension notifications remain immediately visible.
  Destructive removal stays in an independent danger section below ordinary
  enable/update actions.
  `发现扩展包` is flat Catalog content, not a card inside a shared frame. Local
  Extension, global/project Skill, Prompt Template, and Context views consume the
  current Session resource projection and never repeat Package update or uninstall
  controls.
- Installing a Pi Package starts from one page-level action and opens a focused
  confirmation dialog that identifies npm, Git, or local-directory sources, the
  target scope, and the fact that a Package may load executable Extension code.
  Recommended Packages prefill the same dialog and never bypass the one-shot
  installation confirmation. Loaded-resource evidence remains separate because
  installed configuration and the current Session projection are different states.
  `pi-observational-memory@3.0.3` is the only `prompt-once` recommendation. A fresh
  Agent profile gets one non-dismissible choice between explicit global installation
  and `暂不安装`; the decision is persisted by Agent Host, existing profiles are
  suppressed, a failed installation exposes explicit retry, and no download starts
  before confirmation. All other recommended Packages remain `user-initiated`.
- Package network mutations remain one logical Settings action while an isolated
  Agent Host worker owns the subprocess. A Host shutdown or worker-tree cleanup
  failure produces one explicit failed result and never a success toast; the UI does
  not infer completion from a closed dialog or a Settings reload. Worker stdout,
  stderr, inherited credentials, and raw IPC payloads never become notification or
  diagnostic content.
- Package trust copy uses evidence-specific labels: `已核对 Pi-67 已知内容基线`,
  `当前内容已由用户确认`, or `Desktop 安装记录已核对`, never `已签名` or
  `安全扩展`. The current observation excludes `.git` and `node_modules`; it proves
  bounded drift detection only. Package Worker is not an Extension runtime sandbox,
  and Settings must not imply that third-party module import, hooks, Tools, UI, or MCP
  subprocesses execute outside the Agent Host.
- The Download Sources/Network section uses compact forms and status rows rather
  than a card marketplace. It shows the private Node/npm/Git versions, source mode,
  ordered mirror and official candidates, not-checked/reachable/unreachable state,
  latency, resolved Git revision when available, and explicit save/probe errors.
  Save is enabled only for a valid dirty draft. Probe validates and checks that
  draft without saving or clearing dirty state, labels results based on unsaved
  settings, and marks them stale after any subsequent edit. `恢复默认` remains
  reachable but opens a cancel-first confirmation before it overwrites persistence.
- Desktop has no first-party `MCP 服务` Settings category. User-owned Pi MCP servers
  remain Runtime resources and follow the normal capability/safety projection, but
  Desktop does not offer a generic endpoint or credential editor. The retired Team
  MCP/Tavily Bridge surface, token reveal/save/clear flow, packaged resource, and Host
  environment injection must not reappear under another category.
- Startup retirement cleanup recognizes only the former Desktop-owned
  `tavily-bridge` URL/auth/token-env identity. It atomically removes that one entry
  under exact-revision authority while preserving same-name customized entries,
  unrelated servers, settings, and unknown fields. A revision conflict fences Agent
  Host startup instead of loading an ambiguous retired route. The orphan userData
  token cleanup never follows symlinks; failure is reported only as a bounded class
  and does not block Main because no token is injected.
- `用量分析` uses a grouped summary, restrained daily bars, and one responsive
  Provider/model table for `7 天`, `30 天`, or `90 天`. It rebuilds from the selected
  Workspace's Pi JSONL through `workspace.usage.report`; switching window, Workspace,
  or Host epoch invalidates the prior request. Metrics distinguish Pi-recorded token,
  input/output, cache read/write, and `Pi 记录成本（非账单）`. UTC date and coverage
  are explicit. Incomplete coverage owns a warning with discovered/scanned/skipped
  counts; empty, loading, disconnected, no-Workspace, and error states remain distinct.
  The view does not invent reasoning/subagent token attribution, billing truth, public
  pricing estimates, or an incremental cache that the Host has not implemented.
- Browser integrations do not equate copied source with readiness. The browser67
  section reports separate rows for bundled source, runtime dependencies, browser
  extension files, and the managed connection. Its three-step dialog prepares the
  unpacked extension after one-shot confirmation, offers only fixed Chrome/Edge
  extension-management destinations plus reveal/copy actions for the revalidated
  directory, and explains the browser-owned Developer mode / `Load unpacked` step.
  Starting or reusing the local Hub requires a second one-shot confirmation.
- `已安装并连接` is a live state, not an optimistic completion label. It appears
  only when the current Desktop process observes a WS or Link Doctor route with
  `ok=true`, `detail=extension_identity_ok`, and `identity_match=true`. Missing
  connection keeps prepared files in `待浏览器加载`; a live identity mismatch becomes
  `需要重新加载`; malformed files or operations fail visibly. A persisted connected
  result is demoted until this process rechecks it. The dialog scrolls vertically
  inside the viewport at high zoom and never creates document-level horizontal overflow.
- Settings and Inspector are structurally mutually exclusive: mounting Settings
  removes the Workspace Inspector surface and its focus targets from the DOM.
  Returning to a Workspace restores its file navigation and Workspace-scoped
  file tabs; Task-bound Messages, Context, and Tool change facts accept only
  current Task authority.
- At high zoom or an equivalently narrow effective viewport, Settings moves its
  category navigation from a fixed left column to one grouped Popover trigger above
  the content. The trigger names the current group and category; the Popover repeats
  all visible search results under `应用`, `Pi`, `连接与集成`, and `系统与支持`, is at
  most `320px` wide and bounded by the viewport height. The scope switch and current
  section remain at the top of the same document, while the content owns vertical
  scrolling without introducing document-level or two-dimensional overflow.
- Native directory selection is an explicit trust gesture for that Workspace's
  project resources. The UI does not ask for duplicate Workspace trust after a
  successful picker result, and it never describes that trust as approval for a
  dangerous Tool action.
- Workspace order supports direct drag-and-drop while retaining labeled move-up
  and move-down controls as the keyboard-accessible equivalent. Reordering never
  changes conversation recency or the selected Workspace.
- Main verifies restored filesystem identity before the Renderer can reopen a
  Workspace. Missing, unavailable, or identity-changed directories get a visible
  recovery surface; identity change clears project trust until the user confirms
  a directory again through the native picker.
- Workspace removal uses an application dialog rather than a native confirm. It
  states that only the workbench registration is removed and that the directory,
  Pi Sessions, and project files are not deleted. Open or live Tasks must be
  stopped first so removal cannot orphan a Runtime or discard a draft implicitly.
- The footer places the signed-out account entry on the left and a `?` menu on
  the right. Account opens Settings/Account. The `?` menu contains Settings,
  Check for Updates, and Help; refresh and Session import belong to the owning
  Workspace overflow menu. When the packaged Main process discovers a newer
  complete release, the `?` control gains one non-numeric accent dot and the menu
  action becomes `发现新版本 <version>` with a compact `新版本` badge. Clicking it
  opens the shared update status; it never starts a download or installation.
- Account v1 is truthfully `signed-out`: local Pi, Workspaces, and Sessions remain
  available, while enterprise/team features are described as not yet connected.
- `Cmd/Ctrl+N` creates a conversation in the current Workspace; `Cmd/Ctrl+T` is a
  temporary alpha compatibility alias. `Cmd/Ctrl+W` retains the native window
  close behavior. `Cmd/Ctrl+,`, `Cmd/Ctrl+B`, and `Cmd/Ctrl+Shift+B` open
  Settings, toggle navigation, and toggle Inspector respectively.

### Provider and model configuration

- `模型` is the Settings entry for Pi's native Provider and model
  configuration, not a parallel Desktop registry. Its file-status region names
  `~/.pi/agent/models.json`, `auth.json`, `settings.json`, and the trusted
  Workspace `.pi/settings.json` as the current source of truth.
- Built-in Pi Providers and models remain visible for credential and default
  selection but are read-only. Creating or editing a custom Provider writes only
  its `models.json` entry; Desktop never copies built-in definitions into that
  file merely to display them.
- An unconfigured built-in Provider opens on a dedicated `连接` section. It shows
  the effective Endpoint and API protocol from the Pi model catalog as compact
  read-only facts and makes `配置 API Key` the primary action. It never renders
  the custom Provider form as a page of disabled Base URL, protocol, Header, or
  advanced-JSON controls. Those editable controls appear only for a custom
  Provider; proxy or compatibility endpoints use a distinct custom definition.
- `Groland` appears as one built-in Provider and owns one credential interaction,
  not separate Claude/GPT services. Its five Claude rows show
  `anthropic-messages`; its two GPT rows show `openai-responses`; all seven show
  image input and reasoning. Authentication stays protocol-native in Agent Host:
  Claude uses `x-api-key`, GPT uses Bearer. The UI never asks the user to duplicate
  the same credential or exposes it while explaining the mixed protocol.
- Removing a custom Provider opens a cancel-first confirmation that names the
  `models.json` definition, states that any dirty Provider draft will be discarded,
  and explicitly preserves `auth.json`. Removing a persistent credential is a
  separate cancel-first confirmation scoped only to the selected Provider's
  `auth.json` entry; neither confirmation reveals a secret.
- Provider identity, name, Base URL, API protocol, model identity, input types,
  reasoning, context window, and token limit use labeled bounded controls.
  Advanced JSON owns uncommon non-secret fields and rejects `apiKey`, `headers`,
  malformed JSON, and duplicate model IDs with a specific recovery message.
- Header names may be shown, but existing values are never read back. Adding,
  replacing, or removing a Header is an explicit write-only mutation; after a
  save the value field clears and only the safe name remains visible.
- `保存到 Pi` is the primary credential action and persists to `auth.json`.
  `仅本次使用` is secondary and clearly states that the value disappears with
  the runtime. If a persistent credential exists while a runtime override is
  active, the UI names both facts rather than implying the stored value is active.
- The focused built-in DeepSeek connection states that `deepseek-v4-flash`
  reuses the same credential for official Responses `/responses` Web Search.
  Streaming `response.web_search_call.in_progress`, `.searching`, and
  `.completed` events update the in-place Tool state without introducing a
  search switch or implying support for `deepseek-v4-pro`.
- `配置 API Key` / `更新 API Key` opened from a Provider editor preserves that exact Provider as the
  credential-dialog selection, even when the active Session uses another model.
  This targeted entry opens a focused `配置 <Provider> API Key` dialog without a
  second Provider picker; generic Composer and Command Palette entries retain the
  searchable multi-Provider catalog.
  Generic credential entry points may prefer the active model Provider and then
  fall back to the first available Provider.
- The API-key input is masked by default and provides an accessible eye control
  to reveal or hide only the value currently entered by the user. It never
  refills from storage. The separate current-authentication row may provide a
  second eye control for an explicitly requested one-shot reveal of a literal
  API key stored in `auth.json`. OAuth entries, environment references, and
  command-backed credentials are not expanded or executed for reveal. The
  transient value clears when the Provider changes, the dialog closes, the user
  hides it, or 15 seconds elapse, and it never enters snapshots, events, logs,
  diagnostics, or persisted Renderer state.
- Global default writes `~/.pi/agent/settings.json`; project default writes the
  trusted Workspace `.pi/settings.json`. Provider and model must be selected as
  one pair, while `未设置` removes that scope's pair.
- A clean view adopts a newer watched revision automatically. A dirty view keeps
  all local fields, shows a conflict alert, disables stale overwrite through the
  expected revision, and offers `放弃草稿并采用最新配置` as an explicit recovery.
- File validation errors keep the last-known-good projection visible, identify
  the affected Pi file, and block mutations until the file is repaired and
  reloaded; a successful reload does not invent or expose secret values.
- Catalog reload applies immediately to an idle Task and is visibly pending for
  a running Task until its current Operation settles. If the selected model was
  removed, the model control becomes unselected and the Composer explains that a
  new model is required before another Prompt can be sent.
- The Provider Catalog owns three task views with visible counts: `已配置` shows
  every Provider with effective authentication, `可配置` shows unconfigured Pi
  built-ins, and `自定义` shows definitions owned by `models.json`. These are
  task views rather than mutually exclusive storage folders, so a configured
  custom Provider intentionally appears in both `已配置` and `自定义`. Search is
  retained while switching views and matches both display name and Provider ID.
  `重新加载` remains global while `新建模型服务` belongs to the custom view.
  Selecting a row replaces the Catalog with the Provider editor at every width.
  Inside the editor, `基本配置`, `模型`, `默认模型`, and `文件与诊断` are
  Provider-setting sections rather than Task tabs. They prevent frequent
  controls, advanced compatibility fields, and diagnostics from being presented
  as equally weighted cards.
- Provider sync status, Provider Catalog, section tabs, and editor do not share
  a bounded outer frame. `返回模型服务列表` restores the Catalog's search,
  selection, and scroll position without discarding the Provider draft.
- A Provider model Catalog uses readable rows and renders only one model detail
  editor at a time. Search matches display name and Model ID; the initial bounded
  filters are `全部`, image input, reasoning, native search, and custom overrides.
  Each row exposes protocol, image/text, reasoning, and search routing as restrained
  metadata rather than a badge pile. `原生搜索 · 已声明` means the built-in
  model/protocol route is known; it never claims a live request succeeded. Groland
  custom or protocol-mismatched model IDs remain `原生搜索 · 不可用`, and only
  `deepseek-v4-flash` is declared native-search capable for Pi's official DeepSeek
  Provider. Filtering or switching models preserves the Provider draft. Adding a
  model clears filters, selects the new row, and focuses Model ID; removing the
  active model selects a neighboring row. Header mutations and advanced JSON
  remain collapsed until requested or an error requires attention.
- Model Catalog and model detail are mutually exclusive at every editor width.
  `返回模型列表` restores search, filters, selected item, and scroll position while
  the Provider draft stays live. Large Provider and model catalogs remain in the
  one-axis Settings document and never create two-dimensional scrolling.
- Global and project default-model controls are searchable comboboxes rather
  than native selects. They match Provider name/ID and model name/ID, expose a
  bounded result window, support keyboard selection, and preserve an explicit
  `未设置` action. File synchronization is a compact validity summary during
  normal operation and expands paths or diagnostics on demand; invalid files or
  diagnostics open that region automatically.
- The defaults, sync status, conflict state, and credential dialog retain labeled
  actions, visible focus, keyboard order, and one-axis scrolling at the 680px
  packaged-window minimum and at 200% zoom.

### Runtime controls

- The primary model selector lists configured models only. It may retain the
  current model if authentication changes so the selected value never disappears.
- Provider setup belongs to the `Provider 与凭据` dialog rather than the model
  selector. An empty configured-model set names that next action explicitly.
- The thinking control localizes its product label but preserves Pi's canonical
  lowercase Runtime values, such as `思考：off`, `思考：high`, and `思考：max`.
  Its bounded React Aria picker exposes only levels supported by the authoritative
  current model and explains that model-specific scope without translating or
  inventing Runtime semantics.
- Model selection is an explicit Renderer-owned mutation state rather than an
  optimistic projection write. While one target is pending, the selector keeps
  that target visible, disables duplicate selection, and exposes `正在切换到…`
  through visible and live-region feedback. A matching authoritative event or
  acknowledgement confirms it with a short-lived success state; a stale narrow response performs one scoped
  projection resync before failing visibly. Session replacement discards the old
  mutation, and selecting the already-authoritative model never calls Pi again.
- The collapsed model trigger shows only the readable model name and truncates
  it on one line. Provider and the complete `provider/model-id` appear only in
  the open list, where they disambiguate equal labels without widening the
  resting Composer.
- Model and thinking controls share one compact trigger, focus, selection, and
  raised-Popover language. Their Popovers open toward the conversation, retain
  viewport collision handling, and bound long model catalogs to roughly five or
  six visible rows with internal scrolling rather than covering most of the Turn.
- A model change returns controls and its model catalog as one authoritative
  mutation result. The Renderer updates the selected model, clamped thinking
  value, and available thinking levels together; both controls remain disabled
  while that model mutation is pending.
- Inline Turn activity is a bounded execution timeline rather than one generic
  spinner. It names import and compaction, displays the bounded real Tool name,
  maps verified Tool presentation kinds to reading, search, edit, command,
  managed-task, subtask, image, Extension, or generic work, and retains completed
  transitions while the current Operation remains selected. A deterministic Desktop
  compatibility alias names both the requested alias and its verified native Pi target.
  It belongs to the Transcript reading
  track in the order `user -> activity -> live Assistant`; the conversation shell
  has no independent Operation status row. `停止` belongs to the Composer's
  rightmost main-action position and is visible only when the accepted Operation
  declares a real Host-owned abort path; Session import stays visibly running
  until it completes or fails.
- Turn activity is Host-owned and evidence-based: Pi `thinking_*` renders as
  `正在分析问题`, `text_*` as `正在组织回复`, Tool execution uses its verified
  name, presentation kind, and terminal success/failure event, and compaction renders
  as `正在压缩上下文`. A failed Tool step never becomes a green completed step merely
  because Pi proceeds to another activity. A Host-authored
  clear transition becomes `正在继续处理` rather than inventing a more specific
  phase. Provider wait,
  retry, and other unproven phases retain the generic running label rather than
  being mislabeled as thinking. Approval and blocking Extension input temporarily
  overlay that base activity, then restore it when the Host resolves or cancels
  the request.
- The live timeline keeps at most 64 transient steps and never persists Prompt,
  command text, raw Tool input/output, credentials, or source bodies. Running and
  interrupted timelines are expanded by default so the current state and recent
  steps stay visible; the user may still collapse them. As Pi JSONL messages arrive,
  their persisted reasoning and Tool identities replace matching transient Host
  steps without duplication. Completion with a visible final answer automatically
  collapses to the Tool-count-first execution summary above, and reopening restores
  the recorded steps. Completion without a final answer, failure, cancellation, loss, quiet,
  stalled, and recovery remain expanded, visually distinct, and actionable. A projection resync
  may restart the disposable timeline from the one current Host activity; it never
  fabricates missing earlier steps or competes with Pi JSONL as conversation truth.
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
  or lost Operation back into accepted/running. Failed, cancelled, lost, and recovery
  states remain inline and observable. Successful completion yields to the Assistant
  transcript and terminal notification rather than leaving a permanent completion
  bar, and settled work never restores a stop action.
- Product-facing status names the affected Task or `Pi 运行服务`; ordinary UI
  does not expose the internal utility-process term `Agent Host`.

### Notifications

- Toasts provide transient feedback without becoming the primary task surface. At most
  four are visible; info and success dismiss after six seconds, warning after ten, and
  error remains until dismissed. Timers pause while the document is hidden or the Toast
  has pointer/keyboard interaction.
- Toast copy is never itself a dismiss target. Every Toast has a separate labeled close
  button, and only that button accepts pointer input so transient feedback cannot block
  Workbench controls behind it. Keyboard focus and pointer interaction on the close button
  still pause the timer. Error uses `alert`, while info, success, and warning use `status`.
  Reduced Motion removes entrance travel.
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

- The Composer region owns the visual boundary below the Transcript. It reserves
  `32px` above the editor shell on ordinary desktop windows and may compact to
  `24px` when viewport height is at most `760px`; the last virtualized message
  never receives an ad hoc bottom margin to create this separation. The inset
  remains present for settled history, pending Prompts, Turn activity, and live
  Assistant output so the next input reads as a stable action zone rather than
  another message card.
- Main action is `发送`/`Send` or `停止`/`Stop`, never a generic submit label.
- During a cancellable Turn, `停止` is the rightmost primary action. A non-empty
  steer or follow-up draft keeps a quieter adjacent `发送` action; with no draft,
  only `停止` remains. Stop availability never depends on draft validity.
- Enter sends and Shift+Enter inserts a new line. IME composition confirmation,
  including Chromium `isComposing` and legacy `keyCode 229`, never submits the
  draft; the user sends only with a later non-composition Enter.
- While streaming, users choose steer or follow-up queue behavior explicitly.
- The leftmost Composer utility action is a plain `+` with an accessible
  `添加附件` name. It opens the native file picker and is the only toolbar entry
  for file attachment; it is not styled or labeled as a gallery action.
- Immediately after `+`, the Composer shows one compact `ASK` / `AUTO` / `YOLO`
  Tool-mode control for the selected Task Runtime. Its menu opens upward, keeps
  all three options and their short consequences visible, uses neutral styling
  for `ASK`, restrained accent for `AUTO`, and semantic warning styling rather
  than destructive red for `YOLO`. It remains usable during a running Operation
  so the user can correct later Tool decisions without stopping the Turn.
- `ASK` and `AUTO` switch directly after an authoritative Host acknowledgement;
  the resting control never changes optimistically. Selecting `YOLO` replaces
  the same menu content with a second confirmation naming workspace-external,
  deletion, system, and network scope. An untrusted Workspace disables that
  option with `仅可信工作区可开启` instead of waiting for a Host error.
- Tool mode belongs to the exact live Task Runtime. Switching conversations
  displays that Task's independent value; session transition or missing Session
  authority disables the control. Workbench persistence and recovered Task
  placeholders always omit the value and return to `AUTO` under the current
  Desktop default.
- Immediately after Tool mode, one compact `执行 / 计划` segmented control owns
  interaction intent. A provisional conversation reads and writes its checkpointed
  draft value; a materialized Session renders only the Host-authoritative Pi JSONL
  value. Switching mode is never optimistic: pending acknowledgement, Session
  transition, or an active Operation disables both options, and rejection leaves
  the prior value visible with an observable notification.
- Plan Mode keeps the normal transcript and Composer but permits only read-only
  inspection, first-party web Tools, `plan_ask`, and `plan_complete`. Its safety
  gate precedes YOLO and one-shot approval, so a forbidden write is blocked as
  `PLAN_MODE_READ_ONLY` rather than presented as approvable. The control's plan
  state uses a restrained accent border/fill and remains distinguishable by icon,
  label, and pressed state in both themes.
- `plan_complete` appends one complete Plan proposal card to the Timeline. The
  Timeline card owns expanded/collapsed state, bounded Markdown scrolling, copy
  feedback, historical status, and focus rings; it never owns an execution action.
  It remains in the Timeline after execution with the authoritative `implemented`
  state, and historical Plan cards may be read, expanded, and copied but never run
  again.
- While the current proposal is active, one compact `ActivePlanActionBar` appears
  above the Composer with `继续完善`, `复制`, and `开始执行`. Continuing refinement
  only prefills the Composer. Starting execution sends `planId + submissionId`,
  never Markdown; Agent Host resolves the active Plan from the same Pi JSONL,
  records the decision, switches that Session to execute, and emits the real Prompt
  Operation. Busy/disabled state, focus rings, and inline implementation failure
  belong to the action bar. The authoritative execute event removes only this action
  bar, not the Timeline Plan.
- At narrow widths the Timeline card retains its bounded body and the independent
  action bar keeps every action reachable while the Composer toolbar may wrap to two
  rows without changing keyboard order or overlapping the editor. Reduced Motion
  removes the disclosure rotation transition.
- Prompt Stash is a Task-scoped Composer Popover for exact text and images, with at
  most 20 items, 256 KiB of text per item, 2 MiB of total stashed text, 32 MiB of
  images per item, 128 MiB per Task, and 512 MiB globally. Image-only items are
  allowed; non-image attachments and drafts containing `@file` references are not.
  The row shows bounded preview, image count, aggregate size, and time, never image
  bytes or a filesystem path. Main encrypts staged image payloads with `safeStorage`
  and verifies ownership, length, canonical base64, and SHA-256 before restore.
  The Composer is cleared only after image storage plus the stash addition and
  resulting empty draft have each received a durable acknowledgement; any failure
  rolls back to a non-lossy state. Restore is allowed only into an empty Composer,
  creates new staging identities, removes the item through the acknowledged flow,
  closes the Popover, and returns focus to the Composer.
- Context pressure is a compact status beside the Composer: below 75% is neutral,
  75% is `上下文偏高`, and 92% is `上下文接近上限`. Manual compression calls the
  native `session.compact` controller; automatic and manual compaction have distinct
  progress copy, and automatic compaction never exposes a duplicate manual button.
  Reduced Motion disables the progress rotation without hiding the state.
- Typing `/` as the draft's first token opens a bounded, keyboard-operated
  catalog above the Composer. It always groups `Pi 内置`, `扩展命令`, `提示词`,
  and `技能` in that order. Runtime loading, failure, or disconnection is a quiet
  status below available Desktop actions rather than a replacement for the list.
  `/new`, `/model`, `/name`, `/compact`, `/resume`, `/tree`, `/reload`, `/settings`,
  `/plan`, and `/default` are Renderer-owned actions using the same feature
  Controllers as the rest of Desktop; they never become `command.invoke` calls or
  model Prompts. `/plan` selects Plan Mode and `/default` restores execute mode.
  Pi-resolved Extension commands, Prompt Templates, and Skills such as
  `/skill:<name>` retain distinct source labels and their normal Runtime or Prompt
  path. Arrow keys move the active row without mutating the textarea. Click
  and Tab insert. Enter executes an exact command, but completes a partial token;
  Escape dismisses, and IME confirmation never selects, executes, or sends.
  `/name 新标题` uses the same rename Controller as the row menu; bare `/name`
  opens the same rename dialog and therefore exposes `恢复自动标题` when the current
  name is explicit.
  Unsupported known Pi TUI builtins produce an inline compatibility error and
  never reach the model; unreserved unknown Slash text remains a normal Prompt.
  A successful Desktop action clears only its command text from the originating
  Task draft and preserves attachments. A blocked or failed action preserves both.
- Attachments are named, previewed, and removable before sending. The same
  validation and staging lifecycle owns file-picker, clipboard paste, and
  drag/drop input; duplicate file projections are rejected instead of mounting
  repeated previews. Images own short-lived Object URLs for preview. Ordinary
  files render the same bounded metadata card without retaining a Renderer `File`
  or mounting an image placeholder.
- Draft text and attachments clear only after the Host returns an accepted
  Operation whose Host epoch, Session ID, and Session generation still match the
  authority captured at send time. Transport failure retains the original draft,
  image Object URLs, opaque attachment references, and stable submission ID for
  an idempotent retry;
  Host or Session authority changes retain the draft but rotate that ID before
  the next attempt.
- Non-empty Composer text and `streamBehavior` persist by exact ConversationKey after a
  500 ms debounce and restore without overwriting a newer live-window edit. Electron Main
  encrypts the bounded state as one `safeStorage` payload with atomic primary/backup files.
  Secure-storage unavailability keeps the draft in memory and writes no plaintext. Attachment
  bytes, preview URLs, and opaque staging handles remain process-lifetime state and therefore
  do not reappear after restart; attachment-only state is never presented as a durable draft.
- One draft accepts at most 20 attachments, 100 MiB per file, and 250 MiB total;
  a pathless clipboard fallback is capped at 16 MiB, while supported Pi-native
  PNG/JPEG/GIF/WebP images have a separate 32 MiB aggregate boundary. Rejections
  remain visible beside the Composer instead of being truncated silently. Main
  binds the selected size/mtime and physical identity to a non-following file
  handle, streams that same handle into a private `0700` staging root, verifies it
  again after copying, hashes the bytes, records a bounded manifest, rejects links
  and changed files, and exposes only opaque IDs
  plus name/type/size/kind metadata to Renderer and Protocol. The Agent Host
  copies from revalidated non-following handles into a temporary claim, atomically
  publishes the complete set, and removes draft copies only after that commit.
  Renderer validates the complete draft from Main's authoritative staged kinds,
  while Host repeats the image aggregate gate before returning Operation acceptance.
  Claim failure creates no accepted Operation and leaves the original draft retryable.
- Images enter Pi as native `ImageContent`. Ordinary files are announced by one
  hidden `pi67.desktop-attachments.v1` custom message and remain inspectable only
  through the Desktop-owned hidden `read_attachment` Tool. That Tool is
  authorization-exempt only when Pi attributes the exact inline source and the
  input contract is valid; a third-party same-name Tool or malformed input follows
  normal safety policy. The Transcript drops the hidden control message, merges
  bounded metadata into the immediately following User turn, and never projects
  paths, source bodies, raw bytes, or control content. Historical messages with
  attachments keep copy but disable lossy in-place editing.
- Attachment parsing runs outside the Runtime event loop in at most two worker
  threads, with one OCR task at a time, a 16-task admission boundary, 60-second
  ordinary and 120-second OCR deadlines, cancellation, and worker replacement on
  error or exit. Text/Office/PDF/archive/media/binary operations are bounded;
  verified payload bytes are transferred rather than reopened by filesystem path;
  archive entry count (for both list and read), expanded bytes, compression ratio,
  path depth/name length, and traversal are
  validated across the complete archive, Tool output stops at 32 KiB with explicit
  truncation state, and OCR uses packaged Chinese and
  English data without network fallback.
- Claimed attachments remain Task-owned rather than acknowledgement-owned so the
  same live Task can use `read_attachment` in later turns. A replacement Host
  recovers only the requested set from the same hashed Task directory through a
  bounded scan and full manifest/item/hash revalidation. New claims use the same
  128-set admission ceiling, while replay remains idempotent. Explicit Task disposal
  deletes that Task's claimed directory only after Runtime disposal succeeds and
  retries a failed attachment cleanup; Host replacement preserves it, while
  normal application shutdown stops the Host before Main deletes the run root.
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
- The Agent Host owns one Session Catalog owner and SQLite connection for all
  Workspace bindings that share the Main-owned storage identity. Workspace and
  Task services dispose only their bindings; competing SQLite owners must never
  treat another Workspace in the same Host as an external writer.
- Catalog rows expose an opaque physical JSONL identity to Renderer projections.
  The identity is the entity join key; `path` remains the displayed/open locator
  and the existing binary pagination tie-breaker, not proof of entity equality.
- Formal Workbench conversations, row selection, Command Palette Session actions,
  provisional merge, recovery persistence, and Catalog joins compare the opaque identity.
  A changed alias updates the locator without replacing the Task or draft. Workbench v4
  drops legacy path-only formal recovery instead of inventing a physical identity, while
  preserving creation-authorized provisional recovery.
- `sdk-fallback` during ordinary rebuilding does not by itself produce a fallback
  warning. The warning is reserved for the typed `fallback` state; the Renderer
  retains its typed degraded reason for bounded user copy without exposing internal
  reason codes.
- Pagination cursors are bound to the Catalog revision plus source, workspace,
  scope, normalized search, and sort contract. Query changes, revision changes,
  or Host epoch replacement clear old pages; stale results cannot append across
  result sets.
- A New Session action opens one selected provisional Composer intent without contacting Pi.
  The surface states that Pi JSONL is created only when the first message is sent. Double-clicking
  New while the current intent is empty reuses that intent; an intent with text remains distinct.
  First submit gives the same Task one stable `creationId`, materializes it through exactly one
  `session.create`, waits for exact active Session authority, and only then submits the Prompt.
  Creation failure preserves the intent draft; Prompt failure after materialization preserves the
  formal Session and cannot cause a second create. An unknown create outcome stops the indefinite loading state and
  shows `重新检查` plus `放弃此占位`; Desktop does not silently resubmit the create,
  and the provisional identity remains in persisted Workbench state across restart.
  Recheck asks `session.creation.resolve` for the exact Pi JSONL carrying the stable
  `creationId` marker and matching header/path/physical identity. That exact identity materializes the
  provisional row as a stopped, resumable Session immediately and shows its existing
  title while Catalog metadata is indexing in the background. Missing, ambiguous, or
  unavailable exact evidence remains visibly unconfirmed; Catalog fallback, rebuilding,
  or incompleteness does not reverse materialization or block a known Session from
  opening. Desktop never selects a latest empty Session or uses Catalog deltas, message
  count, timestamps, or a bounded creation window as identity evidence.
- Before invoking Pi, the Host-side runtime persists the stable `creationId` as
  `reserved`, performs a bounded exact-marker scan, and advances to `materializing`
  only after a proven missing result. Exact marker plus physical JSONL identity advances
  the private journal to `materialized`; a constructed authoritative bootstrap advances
  it to `published`. Restarting from `materializing` without exact evidence becomes an
  `ambiguous` recovery state and never invokes `newSession()` again. A unique exact
  marker can rebuild a missing journal. The journal contains no conversation, source,
  Tool, attachment, or credential content. Protocol v4 does not yet send a Renderer
  acknowledgement back to this journal.
- Writer ownership is a two-layer fence: an in-Host registry protects Task transitions,
  and a private storage-root lock protects overlapping Agent Host processes. Lock files
  are keyed by SHA-256 of the physical or pending identity; their bounded owner metadata
  uses hashed Task/Session identity and never exposes a path or user content. A missing
  JSONL initially holds its physical-parent + exact-leaf key. Commit acquires the final
  physical JSONL key while that provisional key is still held, then releases the old
  Session only after the Runtime switch succeeds. Replacement cancel preserves the old
  lease. Heartbeat compromise requests Host replacement; UI does not offer manual retry
  or lease stealing from the Workbench.
- If an exact recovered identity already has a Workbench Task, the provisional row
  merges into that owner. A sole provisional draft and its attachments move without
  release; two different non-empty drafts remain visible and produce a conflict notice.
  Equal Session IDs on different physical JSONL identities remain separate rows. Equal
  paths carrying different physical identities or Session IDs remain unconfirmed and fail closed.
- `放弃此占位` removes only the empty in-memory Renderer provisional and returns to
  the Workspace surface. It never opens, moves, rewrites, or deletes Pi JSONL. A
  draft or attachment disables the destructive interpretation and keeps the
  placeholder with an explanatory warning.
- Sessions without an explicit Pi `session_info.name` receive a query-time title
  from the latest topical User message on the current Pi branch. The Host reads
  the JSONL tail backwards in bounded chunks, follows the leaf's `id -> parentId`
  chain, limits title length, and parses at most the already requested page with
  four concurrent readers. File identity, inode, nanosecond mtime, and size bind
  a bounded LRU cache. No model call, cold Runtime, SQLite title, Workbench title,
  log, telemetry, or full-history scan is permitted; no valid title falls back to
  `未命名对话`.
- Active Catalog pages sort live/waiting/draft work first in the Renderer, then
  pinned conversations by most recent pin, then ordinary modified time. Archived
  pages sort by archive time and use a cursor bound to view and sort contract.
  Pin/archive state comes from the private hash-and-timestamp organization store,
  not Pi JSONL. Archive removes a pin, and restore returns the row unpinned.
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
- Projection reads for workspace changes, the Session Catalog, conversation,
  and Session Tree wait behind an admitted transition. Incremental events may
  arrive before the transition acknowledgement, so those reads consume the
  resulting state instead of surfacing an expected `BUSY` failure.

### Command Palette

- The search field remains the sole keyboard focus owner and exposes the bounded
  result list through the combobox `aria-activedescendant` pattern. Arrow keys
  change the active option without preventing the user from continuing to type.
- IME candidate confirmation follows the same `isComposing` and legacy
  `keyCode 229` boundary as Composer and never executes the active result.
- Session, Extension, Pi Desktop, compaction, and resource actions reflect the Agent Host
  scheduler before execution. A running Operation, Session transition, missing
  Session authority, or disconnected Host produces an explicit disabled reason
  instead of closing the Palette and relying on a later `BUSY` error.
- Session Catalog search is query- and Host-epoch-owned. Loading may show a
  bounded local match from the recent page; failure remains visible and is never
  presented as an authoritative empty Session result.
- Extension command identities are bounded and unique before they become action
  IDs. Search projects at most 60 result options, reports real match truncation,
  and keeps recent actions only in process memory.
- The Command Palette and Composer consume the same Pi Desktop action registry.
  Runtime commands with a Pi builtin name are excluded so a Package cannot shadow
  the native action. `/model` returns to the Workbench and opens the real model
  popover; `/resume` opens navigation and focuses Session Catalog search.

### Extension UI and approval

- Dialogs identify the extension or tool only when the runtime supplies an
  authoritative identity. Pi SDK `0.83.0` does not identify the caller for
  shared `ctx.ui` primitives, so those dialogs use the truthful generic label
  `Pi extension` instead of guessing a package.
- Safety Approval is a dedicated dialog and protocol, not an Extension `confirm`.
  It names the exact Tool and verified source, command/path, cwd, risk category,
  one-Tool-Call scope, reason, and denial behavior without rendering the target
  as Markdown or HTML. Approval is shown only for a valid call whose classified
  side effect requires a decision. Unregistered, ambiguous, reserved-identity
  mismatch, malformed MCP routing, and other calls that authorization cannot
  repair are blocked with inline correction instead of opening a dialog.
- Pi-67 registers `web_search`, `source_check`, HTTP(S) `fetch_content`, and
  bounded `get_search_content` directly as first-party Pi SDK `customTools` with
  the `Pi-67 原生搜索` identity. In a trusted Workspace their read-only web intent
  runs without a duplicate approval dialog, while exact Tool identity and query,
  URL, claim, or result reference remain visible in the execution process.
  `WebSearch`, `WebFetch`, and lowercase `web_fetch` remain deterministic Desktop
  aliases. Malformed input, local-file fetches, reserved-identity mismatch, and
  same-name third-party Tools stay fail-closed; network writes, uploads, command
  execution, and external side effects retain one-shot approval.
- One `web_search` call owns strict native routing. Protocol-matching built-in
  Groland Claude/GPT and Pi official Anthropic/OpenAI models use their declared
  Anthropic Web Search or Responses `web_search` request; Pi official DeepSeek is
  declared native only for `deepseek-v4-flash`. A missing native route or credential
  fails before sending a search request. HTTP/auth/quota/rate-limit/server errors,
  malformed or oversized JSON, and empty results fail visibly. Pi-67 never switches
  Provider, invokes a search Extension, or silently resends the same query.
- `fetch_content` accepts only credential-free HTTP(S), resolves DNS before every
  redirect, rejects local/private/link-local/reserved IPv4 and IPv6 destinations,
  caps redirects at three, and cancels streamed bodies above 2 MiB. This is a
  hostname/DNS validation boundary, not a claim of transport-level IP pinning
  against every DNS-rebinding TOCTOU.
- Every successful search or fetch stores at most one bounded in-memory result and
  returns its `responseId` in structured Tool details. `get_search_content` reads
  only that current bounded cache entry and performs no network request. Failed
  results, malformed or expired IDs, duplicate Tool names, and same-name legacy
  Package Tools never gain first-party identity or authorization.
- New trusted Workspaces default to `AUTO` (`balanced`). Exact Workspace
  read/write Tools, exact current-Session loaded resource reads, first-party
  read-only web Tools, ordinary effective configured Package/MCP operations,
  non-destructive persistent writes, and conservatively classified local
  inspection/test/build Shell commands proceed without repetitive approval. A
  bounded `&&` chain or read-only pipeline is admitted only when every segment is
  independently safe; Workspace-local `cd` and the small CI environment allowlist
  never widen a following segment's authority. Redirection, substitution, unknown
  interpreters, unsafe environment changes, or one unsafe segment keep the complete
  command in the one-shot flow.
  The effective capability catalog is rebuilt from Task-local Package settings
  and bounded `mcp.json`/`mcp-cache.json` metadata at resource load/reload; Tool
  Calls perform in-memory identity lookups and never expose command, env, URL,
  credential, args, results, or source paths. Skill directories authorize only canonical
  `read`/`grep`/`find`/`ls` targets within that directory; loaded Prompt, context,
  and visible Extension resources authorize only canonical exact-file reads.
  Reload atomically replaces those grants. Symlink escape, arbitrary home files,
  persistent deletion, upload or external submit, credentials/authentication,
  dependencies, destructive or ambiguous Shell, publish, remote Git, system
  changes, and external writes retain the dedicated one-shot flow.
- Retired `@ff-labs/pi-fff` is neither bundled nor recommended. If a user
  explicitly installs and admits legacy `@ff-labs/pi-fff@0.10.1`, its `grep`/`find` and fallback
  `ffgrep`/`fffind` names share one source-and-contract profile. Workspace-local
  paths and globs follow normal read policy; `~`, absolute, `../`, and symlink
  escapes display the canonical external path before one-shot approval. An
  opaque pagination cursor is not approvable in `ASK` or `AUTO` because Desktop
  cannot prove the original root; the model is instructed to restart without
  the cursor. When pi-fff registers the override names, Desktop's per-turn Tool
  guidance explicitly states that live `find` and `grep` are FFF-backed, so the
  answer must not call them native fallbacks or report pi-fff missing. In named
  mode the same guidance points to live `fffind` and `ffgrep`. Duplicate sources
  and unsupported versions stay unverified.
- The Desktop-only Pi settings projection gives verified managed `pi67-core`
  runtime precedence over its legacy auto-discovered copies. It adds exact
  force-exclusions for `pi-rules-loader`, `pi-vision-bridge`, and
  `xtalpi-pi-tools` only while the managed Package path is active. No file
  or persisted setting is mutated, unrelated Extensions are untouched, and
  removing managed `pi67-core` restores normal legacy discovery. The visible
  result is one Tool source, one rule activation notification, and no conflict
  diagnostic for the same first-party extension.
- Verified `pi-mcp-adapter@2.10.0` and `2.11.0` `mcp` proxy calls distinguish
  local capability discovery from execution. Empty status, cached server lists,
  bounded search/describe, and current-Session UI-message reads use the
  read-only capability category in `ASK` and `AUTO`. AUTO connects an already
  configured server and runs a cached nested Tool according to its classified
  side effect; ASK requests one-shot approval for connect and configured
  operations. New server setup, OAuth/authentication, credentials, and permission
  expansion remain confirmation boundaries. Missing or ambiguous servers/Tools,
  malformed args, duplicate sources, and unsupported versions are corrective
  errors rather than approvable actions. When a proxy call instead targets the currently verified
  direct `pi-fff` capability, Desktop treats it as a routing error rather than a
  user authorization decision: it opens no dialog, names the active direct Tool,
  and lets the model retry through the ordinary Workspace path classifier.
- Configured Memory read/list/recall calls run as reads; add/remember/learn/
  propose/flush run as non-destructive persistent writes in AUTO; delete/forget/
  purge require one-shot approval. Configured browser passive scan, wait,
  extraction, screenshot, and download run in AUTO subject to path containment;
  execute-JS, native input, clipboard mutation, upload, and authentication remain
  higher-risk. JS-Reverse task instrumentation and hook cleanup remain ordinary
  configured operations rather than filename-based delete guesses.
- Approval makes bidi, zero-width, control, and non-standard line-separator
  characters explicit in a non-mutating safe display. At constrained height,
  details scroll independently while all three decision actions remain visible.
- Approval actions are ordered `拒绝`, `仅允许本次`, `本任务开启 YOLO`, with
  default focus on `拒绝`. The YOLO action atomically permits the current and all
  other pending Safety Approval requests owned by the same Task Runtime and
  changes its mode; ordinary Extension `ctx.ui` requests remain pending. A stale
  Host, Session generation, Operation, request, or Tool call cannot enable the
  mode. The mode never changes OS permission, Electron sandbox/preload,
  credential, update/signing, or Workspace trust boundaries.
- Blocking Approval and Extension input add a visually separated danger action only
  when exact modal authority maps to one Task in `waiting-approval` or
  `waiting-extension-input`. `拒绝` or `取消当前输入` resolves only the current
  interaction. `停止整个任务` sends `task.close { mode: "stop" }`; it is not an
  `operation.abort` alias and removes the Renderer Task only after Runtime stop
  succeeds. Host epoch, Session ID/generation, Operation ID, lifecycle, loading,
  disabled, failure, and focus states remain explicit. Missing, stale, or ambiguous
  authority hides the task-level action and leaves the current request fail-closed.
- Approval is displayed and answered only while Host epoch, session generation,
  Operation, request, and Pi `toolCallId` remain authoritative. Terminal
  resolved/cancelled events may clear the exact stored request after the
  Operation settles, but only when their Host, Session, generation, Operation,
  request, and Tool Call identities still match. The Host preserves the opening
  Operation identity on late terminal events. As a final lifecycle invariant, an
  accepted Operation terminal also removes every still-rendered Approval or
  Extension request with the same Host, Session generation, and Operation; this
  only dismisses stale UI and never allows or retries the Tool. Stale, aborted,
  disconnected, undisplayable, or oversized requests fail closed.
- A completed Operation with a visible final answer collapses its process even
  when an intermediate Tool step failed and the model recovered. Its summary
  still reports the failed step and reopening preserves the full failure detail.
  Failed, cancelled, lost, or no-final-answer Operations remain expanded.
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
  Registered Tool names remain visible as bounded code labels so a discovered
  Package cannot be mistaken for a differently named model Tool call. Partial
  presentation coverage says `执行可用 · 展示受限`; a Tool surface without a
  dedicated Adapter says `可执行`, not that Tool execution itself is partial.
- Package settings mark `@narumitw/pi-plan-mode`, `pi-web-access`, and
  `pi-smart-fetch` as `原生能力替代`. Existing user configuration remains visible
  and unchanged, but Desktop Tasks exclude those sources before Pi resource load.
  The row offers the ordinary explicit uninstall path without claiming that
  retirement removed unrelated third-party Packages.
- Before every Agent turn, Desktop reinforces the bounded exact active Tool-name
  contract and advertises only verified deterministic compatibility aliases.
  `Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`, `WebSearch`, and `WebFetch`
  translate through explicit schemas and then execute the verified native Pi Tool;
  they never bypass Safety or trust a same-name third-party Tool. Unsupported
  semantic aliases such as `Agent` remain fail-safe and receive one precise native
  Tool/schema recovery hint instead of an invented default subagent.
- A verified Adapter row shows package, installed version, and matched command/tool
  counts. `adapter` is shown only when every discovered executable surface is
  covered and no known TUI custom surface remains; partial coverage stays `partial`.
- A verified `delegated` Tool row may visually distinguish delegated running,
  completed, and failed work, but its detail explicitly states the evidence limit.
  It never synthesizes child names, models, token/cost, hierarchy, parallelism, or
  child output from a package label or Tool summary.
- TUI-only custom components show an actionable compatibility message.
- The Provider dialog lists configured state, non-secret credential source, and
  model count. A configured credential remains hidden by default. Only an
  explicit current-authentication eye action can request a literal stored API
  key, and that one-shot value is bounded, transient, and excluded from all
  normal Provider projections and persistence.
- Provider configuration reads never wait indefinitely for an open Task to
  hot-reload its model runtime. Fast reloads remain `applied`; a slow or failed
  reload becomes `pending` after a bounded Agent Host wait and is retried by the
  Task runtime without blocking the Settings snapshot.
- The first Provider configuration read is also bounded before any Task exists.
  Agent Host limits individual configuration file access to 1.5 seconds, offline
  Pi Provider validation to 4 seconds, and Settings reload to 2 seconds; Renderer
  allows a 12-second acknowledgement window. Manual get/reload refreshes only the
  requested Workspace, so unrelated registered Workspaces cannot accumulate
  Settings reload latency. Validation timeout produces an `invalid` snapshot with
  a fixed diagnostic; file-access timeout produces a structured recoverable error
  without exposing the affected absolute path.
- A real Task does not reuse the diagnostic projection's partial state. Its own
  offline `ModelRuntime.create()` is bounded to 4 seconds inside Agent Host and
  fails with recoverable stage `session-model-runtime` before Workspace/Session
  acknowledgement expires. Retry starts a new Pi runtime creation attempt; the
  late result of the timed-out attempt is never installed as Task authority.
- Credential inputs never refill. Persistent storage in Pi `auth.json` is the
  primary path; an explicitly runtime-only key states that it is cleared when the
  Agent Host exits or restarts and remains available only across Desktop-created
  session transitions within that Agent Host lifetime.
- `恢复与诊断` is a compact advanced-user control plane, not a dashboard or
  onboarding surface. It retains environment and recovery rows and adds one equally
  dense `运行健康` group. Health combines Main-owned Agent Host lifecycle/restart/
  port-handoff facts, Repository scheduler/private-Git/working-tree services,
  Prompt Stash storage state, Host scheduler/Operation/heartbeat aggregates,
  Renderer acknowledgement latency, and the existing Operation Freshness projection.
  Every row uses an icon, text status, and bounded detail; color is never the only cue.
- Runtime Doctor, Host diagnostics, and Desktop recovery are independent
  projections. Loading or failure in one region cannot erase a completed result
  from another region, and a late `doctor.completed` event cannot clear the
  recovery snapshot. Recheck and diagnostic export remain available without
  changing the active Pi Session.
- Health observations are local, on-demand, bounded counts/timestamps only. They do
  not contain Task/Operation IDs, Prompt or Tool payloads, paths, credentials, or
  stdout/stderr, and they do not create OTLP, Grafana, remote telemetry, or a
  continuously updating dashboard. Diagnostic export uses
  `pi67-support-diagnostics.v3` for the same redacted projection.
- The Host authority row renders previous-run exit as one of first launch,
  clean, unclean, or unknown. First launch is neutral; unclean and unknown are
  warnings. The persisted `cleanExit=false` launch marker remains unchanged so a
  crash after initialization is still recovered as unclean on the next run.
- Before the first check, the dialog presents an explicit invitation and never
  renders an inferred all-passed state. While collecting, its dimensions remain
  stable and the dialog cannot be dismissed into an ambiguous partial request.
  The scroll region is bounded on desktop and mobile; footer actions wrap without
  overlapping status content.
- The export action uses an icon-plus-command label and sends only a typed
  Runtime-available or Runtime-unavailable request to Main. Collection uses a
  three-second acknowledgement budget. Main always composes the fixed support
  schema from its own recovery snapshot, Agent Host Supervisor lifecycle, and
  fixed-file Pi configuration readability metadata; successful Host diagnostics
  are an optional appendix rather than an export prerequisite. A fallback export
  confirms that Runtime state was unavailable without exposing the raw transport
  error. No destructive repair, force unlock, replay, or clear-all action appears
  in this surface.
- Settings and the update dialog disclose that automatic checks request only
  public GitHub Release metadata and send no Workspace, Session, model-service,
  or credential data. Packaged builds check 10 seconds after startup and at most
  once per 24 hours while running; development builds stay offline. Current and
  automatic-error results do not interrupt work. Unsigned Preview checks and
  opening the canonical GitHub Release page remain separate actions. Unsigned
  builds expose no in-app download, background download, or quit-to-install path.

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
- A transient Session Tree `BUSY` response keeps its invalidation pending and
  receives one bounded retry without a warning. A repeated response stays
  recoverable, uses product language rather than Host internals, and retries on
  the next authoritative tree change.
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
- `notifications/native-notification-controller.ts` admits only completed, failed, or
  attention events for a background Session or a hidden/unfocused application. It sends
  opaque Workspace/physical Session identity rather than user content. Electron Main's
  `native-notification-manager.ts` owns fixed privacy-safe copy, bounded dedupe, platform
  support checks, dismissal, window focus/recreation, and click activation back to the exact
  Session identity. Windows notification claims still require installed NSIS/AUMID evidence.
- Foundation and shell styles live under `styles/`; feature-specific layout and
  states use colocated CSS Modules. Deleted features remove their CSS rather
  than leaving a compatibility stylesheet.
- `command-palette/` separates async Session/Extension resources, scheduler-aware
  action registration, pure search projection, selection, recency, and result
  rendering. Palette-specific layout has one CSS Module authority rather than a
  parallel global compatibility rule set.
- `pi-actions/` owns the shared static Desktop action registry, availability
  requirements, and existing Controller dispatch. `composer/` owns Slash parsing,
  grouping, exact-Enter routing, and Runtime catalog merge; Host Protocol
  `SlashCommandSource` remains limited to Extension, Prompt, and Skill sources.
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
- Streaming assistant text uses one stable polite live region outside the
  virtualized transcript. It announces only new visible text, at most once per
  second in bounded sentence-aware chunks; thinking, Tool payloads, and settled
  history are never replayed. Session or Operation authority changes clear any
  pending announcement.
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
