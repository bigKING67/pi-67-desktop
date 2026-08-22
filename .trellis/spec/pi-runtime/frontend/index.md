# Pi Runtime Frontend Layer (Inactive)

`packages/pi-runtime` is a runtime/adapter package and does not own React UI.
Renderer-facing data must cross the validated protocol and narrow Desktop
bridge.

Use [`../backend/index.md`](../backend/index.md) and `AGENTS.md`. The generated
leaf files in this directory are inactive scaffolding and are not project
authority.

## Pre-Development Checklist

- Route runtime work to the backend map and UI work to Renderer.

## Quality Check

- Confirm React/DOM concerns remain outside Pi Runtime and cross via protocol.
