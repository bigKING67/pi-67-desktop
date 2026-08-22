# Agent Host Frontend Layer (Inactive)

`apps/agent-host` has no frontend layer. It runs in an Electron utility process
and must not own React UI or renderer state.

Use [`../backend/index.md`](../backend/index.md) and `AGENTS.md`. The generated
leaf files in this directory are inactive scaffolding and are not project
authority.

## Pre-Development Checklist

- Route Agent Host work to the backend map; do not add React/rendering concerns.

## Quality Check

- Confirm no UI, browser DOM, or renderer-state dependency entered Agent Host.
