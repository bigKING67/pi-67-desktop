---
version: 2
name: Pi-67 Desktop Dark Calibration
status: active
platform: electron-web
theme: dark
color:
  canvas: "#111412"
  surface: "#181c19"
  surface-muted: "#202521"
  surface-raised: "#252b26"
  text-primary: "#f0f3ef"
  text-secondary: "#a9b1aa"
  border: "#343b35"
  accent: "#7bc5ad"
  focus: "#83b9f3"
  info: "#84b8f4"
  warning: "#e2ad69"
  danger: "#ef9189"
  success: "#7bc99c"
  diff-added: "#1d3a2b"
  diff-removed: "#482725"
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
- Disabled controls use explicit tokens rather than blanket opacity.
- Focus, semantic state, diff foregrounds, and code syntax colors must be
  checked in the rendered dark theme.
- Avoid pure black, pure white, neon outlines, glowing cards, and transparent
  layers over busy transcript content.
