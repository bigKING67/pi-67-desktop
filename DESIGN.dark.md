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
  text-primary: "#f0f3ef"
  text-secondary: "#a9b1aa"
  text-tertiary: "#7f8981"
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
  chrome.
- The right column remains one centered `1120px` maximum document with a single
  vertical scroll owner. Grouped Settings use one quiet surface and row dividers;
  Catalogs have no enclosing frame; Editors and semantic Notices are their own
  surfaces. Dark mode must not reintroduce glowing cards, green selected Catalog
  rows, or repeated borders merely to manufacture depth.
- Provider, model, and Extension navigation remains drill-down at every width.
  Ultra-wide dark windows do not automatically expose a second catalog or detail
  column, and returning restores the same search, filter, selection, scroll, and
  unsaved draft state as light mode.
- Provider file status, revision conflict, invalid-file, pending reload, and
  model-reselection states use the same semantic success, warning, and danger
  roles as light mode. The API-key eye control may reveal only the current user
  input; persisted credentials and Header values never gain a theme-specific
  value preview, and focus rings remain visible on every raised surface.
- Disabled controls use explicit tokens rather than blanket opacity.
- Focus, semantic state, diff foregrounds, and code syntax colors must be
  checked in the rendered dark theme.
- Avoid pure black, pure white, neon outlines, glowing cards, and transparent
  layers over busy transcript content.
