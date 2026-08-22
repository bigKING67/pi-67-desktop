# Extension Compatibility Frontend Layer (Inactive)

`packages/extension-compat` does not own renderer UI. Extensions cannot inject
HTML, JavaScript, or React components into the renderer.

Use [`../backend/index.md`](../backend/index.md) and `AGENTS.md`. The generated
leaf files in this directory are inactive scaffolding and are not project
authority.

## Pre-Development Checklist

- Route compatibility work to the backend map; do not add injected renderer UI.

## Quality Check

- Confirm extensions cannot inject HTML, JavaScript, or React components.
