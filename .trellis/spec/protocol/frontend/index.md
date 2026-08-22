# Protocol Frontend Layer (Inactive)

`packages/protocol` defines transport-neutral contracts, not UI. Renderer
components consume validated protocol types without adding presentation rules to
this package.

Use [`../backend/index.md`](../backend/index.md) and `AGENTS.md`. The generated
leaf files in this directory are inactive scaffolding and are not project
authority.

## Pre-Development Checklist

- Route transport contracts to the backend map and presentation to Renderer.

## Quality Check

- Confirm no React/Electron presentation behavior entered protocol contracts.
