---
version: 1
name: Pi-67 Desktop Native Design Authority
status: active
platform: windows-x64
theme: system
color:
  canvas: SystemControlBackgroundBaseLowBrush
  surface: SystemControlBackgroundChromeMediumLowBrush
  surface-raised: CardBackgroundFillColorDefaultBrush
  text-primary: TextFillColorPrimaryBrush
  text-secondary: TextFillColorSecondaryBrush
  border: CardStrokeColorDefaultBrush
  accent: SystemAccentColor
  success: SystemFillColorSuccessBrush
  warning: SystemFillColorCautionBrush
  danger: SystemFillColorCriticalBrush
  info: SystemFillColorAttentionBrush
spacing:
  unit: 4
  compact: 8
  control: 12
  section: 24
  region: 32
radius:
  control: 4
  panel: 8
  overlay: 12
motion:
  fast: 120
  standard: 180
  deliberate: 240
---

# Native Design Authority

## Design read

Reading this as: a native Windows coding workspace for beginner and experienced
Pi users, with a calm, exact, operational developer-tool character, optimized
for completing real Pi tasks without first learning terminal workflows.

## Visual direction

- Preserve Peak Code's useful three-region information architecture, not its
  Electron implementation or exact pixels.
- The transcript/composer is the dominant work plane. Navigation is quieter;
  tool and diff context appears only when it explains the active task.
- Prefer flat native composition, restrained separators, and system materials.
  Avoid equal-card dashboards, decorative gradients, excessive glass, large
  radii, and generic AI visual motifs.
- Use Windows 11 Mica where supported. Use opaque semantic surfaces on Windows
  10 and in High Contrast.

## Window structure

### Wide window

```text
+----------------+--------------------------------+----------------------+
| Projects       | Transcript                     | Context              |
| Sessions       | Reasoning / tools              | Tool / diff / health |
| Runtime status | Composer                       |                      |
+----------------+--------------------------------+----------------------+
```

- Project/session rail: 248 logical pixels by default, resizable from 208 to
  360.
- Context pane: 360 logical pixels by default, collapsible, resizable from 300
  to 560.
- Transcript owns remaining width and never shrinks below 520 logical pixels.

### Compact window

- Below 1040 logical pixels, the context pane becomes an on-demand drawer.
- Below 760 logical pixels, project/session navigation becomes a navigation
  pane; transcript and composer remain primary.
- The application does not target phone layouts.

## Typography

- UI: Segoe UI Variable with Windows system fallback.
- Code: Cascadia Mono, then Consolas.
- Use native type ramp and system text scaling. Do not hard-code physical pixel
  sizes around accessibility settings.
- Transcript body prioritizes reading comfort; runtime metadata uses a compact
  label role and tabular figures where appropriate.

## Color and semantic tokens

- Consume WinUI theme resources rather than duplicating literal light/dark
  palettes.
- Accent marks the current destination, primary action, focus, and selected
  session only.
- Success, warning, danger, and info always include text or an icon plus an
  accessible name.
- Diff added/removed backgrounds use semantic brushes with readable foreground
  in light, dark, and High Contrast themes.

## Component behavior

Every interactive component defines:

```text
default
pointer-over
pressed
focused
selected/current where applicable
disabled
loading where asynchronous
error where failure is possible
```

### Transcript

- Virtualized message groups preserve author, timing, model, and tool context.
- The UI keeps a rolling projection of the latest 1,000 messages and states
  when older history is omitted; the Pi JSONL session remains complete.
- Streaming text updates are coalesced; the UI does not re-layout per token.
- Long code and tool output show a bounded preview with explicit expansion.
- Markdown is parsed to an internal AST and rendered with native elements;
  arbitrary HTML is never executed.

### Composer

- The main action is `Send` or `Stop`, never a generic `Submit`.
- `Enter` sends and `Shift+Enter` inserts a line break; the setting is
  discoverable and configurable.
- Attached images are named and removable before sending.

### Approval and trust

- Approval dialogs name the exact command or path, affected scope, reason for
  confirmation, and the result of denying it.
- Use `Allow once` and `Deny`; do not offer a global permanent bypass in v0.1.
- External HTTP/HTTPS links show the exact target and require `Allow once`
  before launching the system browser.
- Project trust language explicitly says it controls Pi project resources and
  is separate from tool approval.

### Empty, loading, and error states

- Empty states point to the first useful action.
- Loading text names the active operation, such as `Checking Pi runtime`.
- Errors state what failed, what state was preserved, and the next safe action.
- A stopped or crashed Pi process never renders as a completed turn.

## Motion

- Use system transitions for navigation and overlays.
- Use 120-180ms opacity/translation feedback for local state changes.
- No decorative idle animation or typing simulation.
- Reduced Motion replaces travel with a short fade or immediate state change.

## Accessibility

- Follow logical visual order in tab traversal.
- Return focus to the invoking control after dialogs and drawers close.
- Important streaming/status changes use appropriately throttled live regions;
  token-level announcements are forbidden.
- Controls meet native target sizes and remain operable at 200% scaling.

## Voice

- Use short, factual Chinese by default and exact English parity.
- Prefer `重试 Pi RPC` over `重试`, `允许本次命令` over `确定`, and
  `未保存 API key` over `出错了`.
- Never claim installation, update, session recovery, or tool execution
  succeeded until the decisive runtime check passes.

## Avoid

- Generic AI card grids and oversized empty surfaces.
- Web conventions that conflict with Windows navigation or focus behavior.
- Hidden critical actions that appear only on hover.
- Color-only state, low-contrast metadata, blanket animations, or unbounded
  transcript rendering.
- UI controls that edit Pi credential/session formats directly.
