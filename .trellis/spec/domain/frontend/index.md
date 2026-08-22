# Domain Frontend Layer (Inactive)

`packages/domain` contains dependency-free policy and state machines, not UI.
Renderer code consumes Domain APIs without moving React/Electron concerns into
this package.

Use [`../backend/index.md`](../backend/index.md) and `AGENTS.md`. The generated
leaf files in this directory are inactive scaffolding and are not project
authority.

## Pre-Development Checklist

- Route policy/state-machine work to the backend map and UI work to Renderer.

## Quality Check

- Confirm React, Electron, transport, and runtime dependencies remain absent.
