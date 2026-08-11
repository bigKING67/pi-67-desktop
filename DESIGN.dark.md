---
version: 4
name: π Desktop Dark Calibration
status: active
platform: electron-web
theme: dark
color:
  canvas: "#111412"
  surface: "#181c19"
  surface-muted: "#202521"
  surface-raised: "#252b26"
  surface-hover: "#2a302b"
  surface-active: "#30433a"
  surface-disabled: "#202521"
  text-primary: "#f0f3ef"
  text-secondary: "#a9b1aa"
  text-tertiary: "#7f8981"
  text-disabled: "#7f8981"
  border: "#343b35"
  border-strong: "#465047"
  accent: "#7bc5ad"
  accent-strong: "#a1dbc8"
  accent-soft: "#203b32"
  focus: "#83b9f3"
  info: "#84b8f4"
  warning: "#e2ad69"
  danger: "#ef9189"
  text-on-danger: "#171a18"
  success: "#7bc99c"
  diff-added: "#1d3a2b"
  diff-removed: "#482725"
  code-diff-added-text: "#9be9a8"
  code-diff-removed-text: "#ffb3ad"
  code-surface: "#0d1117"
  code-border: "#30363d"
  code-text: "#e6edf3"
  code-muted: "#8b949e"
---

# Dark theme calibration

Dark mode uses the same product purpose, information architecture, typography,
spacing, component states, and motion as `DESIGN.md`.

- Dark may come from the operating system or an explicit persisted selection;
  both paths resolve to the same semantic tokens and component states.
- Large backgrounds remain neutral and low glare.
- Raised surfaces are slightly lighter than the canvas.
- Borders separate only where spacing or luminance is insufficient.
- Accent is reserved for current state and primary actions.
- Workspace disclosures, the active conversation, background-running badges,
  the signed-out account entry, and the singleton Settings surface remain
  distinguishable without glowing outlines or relying on accent hue alone.
- Recent user-message previews use the same primary/secondary text hierarchy as
  light mode and remain one-line, bounded, and memory-only.
- Settings replaces both the Workspace rail and Task Inspector with its own
  two-column application shell in dark mode exactly as it does in light mode;
  dark calibration never changes return behavior, information architecture, or
  focus order.
- The compact Settings directory keeps its search field, group labels, and
  single-line category rows neutral in dark mode. Category selection uses a
  low-contrast luminance fill rather than the green runtime accent, and the
  removed Settings brand/description hero must not reappear as dark-theme-only
  chrome. At narrow widths the grouped Popover uses the same raised neutral surface,
  retains all five group labels, and remains bounded inside the viewport.
- The right column uses the same centered `840px` compact and `1120px` standard
  measures as light mode with a single vertical scroll owner. Grouped Settings use
  one quiet surface and row dividers;
  Catalogs have no enclosing frame; Editors and semantic Notices are their own
  surfaces. Dark mode must not reintroduce glowing cards, green selected Catalog
  rows, or repeated borders merely to manufacture depth.
- Provider, model, and Extension navigation remains drill-down at every width.
  Ultra-wide dark windows do not automatically expose a second catalog or detail
  column, and returning restores the same search, filter, selection, scroll, and
  unsaved draft state as light mode.
- Provider task-view tabs use neutral selected surfaces and explicit counts;
  configured state may use the semantic success role, but custom source and model
  counts remain secondary text rather than additional glowing badges.
- Groland's mixed-protocol model rows use the same restrained metadata grammar as
  every other Provider. Protocol, image/reasoning, and `原生搜索 · 已声明` or
  `原生搜索 · 不可用` remain legible secondary text; they never become a glowing capability
  badge pile, and `已声明` never changes color to imply live verification.
- Provider file status, revision conflict, invalid-file, pending reload, and
  model-reselection states use the same semantic success, warning, and danger
  roles as light mode. The API-key eye control may reveal only the current user
  input; persisted credentials and Header values never gain a theme-specific
  value preview, and focus rings remain visible on every raised surface.
- Lark uses the same two page-level Tabs in both themes: `用户授权` is first and
  selected by default, while `应用配置` is second. The selected, hover, and
  focus-visible states reuse the neutral Settings Tab family without glow or a green
  identity treatment. Each panel keeps its own neutral Grouped Settings section.
  Connected, needs-refresh, authorizing, missing-CLI, unconfigured-App, editing,
  saving, and error states use semantic text and notices rather than glowing identity
  cards. The application editor uses the normal Settings field and focus tokens; App
  ID remains readable, while App Secret reveal exists only for the current draft and
  never for the saved credential. The user login remains a distinct OAuth action
  rather than a second App-login button.
- Disabled controls use explicit tokens rather than blanket opacity.
- Readable Settings metadata at 10-12px uses the secondary text role in both themes;
  the tertiary role remains limited to decorative status dots and nonessential marks.
- Focus, semantic state, diff foregrounds, and code syntax colors must be
  checked in the rendered dark theme.
- The Title Bar Repository status uses the same neutral, success, warning, danger,
  focus, and hover roles as light mode. Primary/linked identity never relies on a
  glowing badge, and stale or unavailable state remains legible by icon and text.
- The provisional `运行环境` radio family keeps the same topology, copy, focus
  order, and one-column breakpoint as light mode. Selected state uses
  `accent-soft` plus border, Check, icon, and text contrast; disabled, checking,
  stale/error, and creation-locked states use semantic text and explicit copy,
  never opacity alone or a green glow.
- The Changes Inspector keeps both `会话修改` and `工作区变更` lists on neutral dark surfaces and their bounded
  Patch on `codeSurface`; selected rows, metadata, additions, deletions, focus,
  stale/error notices, and truncation disclosure remain distinct without glow or
  theme-specific information architecture. `第 N 轮`/`当前操作` grouping and
  `未查看`/`已查看` state remain readable by text and luminance rather than hue; a
  revision returning to unread never becomes a glowing attention badge.
- The Agents Inspector uses the same neutral list/card hierarchy and semantic state
  roles as light mode. Running, completed, failed, interrupted, and stopped children
  remain distinguishable by text as well as the small state mark; nested lineage,
  model/usage metadata, result, error, and steer controls never become glowing badges
  or a second Transcript surface.
- A reviewable Diff line uses one quiet selected-row luminance plus the existing
  focus ring; added/removed foreground contrast remains readable underneath it.
  `Reviewed`, pending comments, stale comment chips, disabled non-mappable review,
  destructive removal, loading, and error states use text/icon/border semantics in
  both themes rather than success/warning hue alone.
- The Timeline Plan proposal card uses a neutral raised surface with a restrained
  accent border, not a luminous green panel. Markdown owns a bounded scroll region;
  disclosure, copy, focus, and historical status remain visible, but execution
  controls never move into the card. The independent compact action bar above the
  Composer always shows `复制` plus one contextual primary action: `继续完善` when
  the Composer has user context, otherwise `开始执行`. `继续完善` stays neutral,
  while `开始执行` uses `accent` with `canvas` text for the same primary-action
  contrast as light mode. Accepted-but-not-started implementation uses the same
  geometry with disabled `正在启动计划 / 正在启动`; a matching pre-start failure
  restores the primary action and renders the bounded inline error without relying
  on hue alone. At 720x480 the Composer may wrap to two rows, but both Timeline card
  and action bar remain reachable without overlap.
- Prompt Stash uses one raised neutral Popover above the Composer. Exact text preview,
  image count/size, disabled restore, persistence failure, focus return, and 20-item limit stay
  legible without a green success surface. Current/Workspace conversation search uses
  the same neutral overlay grammar; match selection, incomplete results, and focused
  navigation never resemble a Web Search on/off state.
- Session compatibility and Usage incomplete-coverage warnings use the same quiet
  warning surface, visible focus, and bounded actions as light mode. Usage bars keep
  sufficient contrast without neon accent, tables remain horizontally contained at
  narrow widths, and loading/empty/disconnected/error states preserve the same layout.
- Verified `delegated` Tool rows retain ordinary Tool-card geometry. Running,
  completed, and failed states remain distinguishable by icon, copy, and contrast;
  dark styling never implies a child-agent roster or extra model/token evidence.
- Transcript Process disclosures and Tool rows preserve the light-theme outcome
  matrix without glow. A recovered final answer with unsuccessful Tool steps uses
  the quiet warning role and folds by default; only an authoritative Operation
  failure uses danger and stays open. Cancelled remains neutral, while lost,
  incomplete, interrupted, and unreconciled states remain legible through icon,
  label, luminance, and semantic border rather than hue alone. Open/closed,
  hover, focus-visible, running, completed, warning, and danger states keep the
  same geometry and reading order in both themes.
- Blocking Approval and Extension dialogs keep current-interaction actions separate
  from `停止整个任务`; danger, pending, disabled, focus, and failure remain legible
  at constrained height. The retired Team MCP/Tavily Settings surface has no
  dark-theme-only replacement.
- Doctor's `运行健康` group uses the same neutral compact rows as environment and
  recovery. Queue/latency/heartbeat counts remain secondary text; warning and fail
  states use semantic icon, border, and text without animated gauges or glow.
- Warning and critical context pressure use semantic text, icon, and border roles in
  addition to color. Automatic/manual compression copy remains visible, and Reduced
  Motion removes rotation rather than suppressing the progress state.
- Transcript action tooltips use the same raised neutral surface below message
  actions as light mode and never create an opaque patch over the answer text.
- Avoid pure black, pure white, neon outlines, glowing cards, and transparent
  layers over busy transcript content.
