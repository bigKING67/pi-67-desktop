# Domain Development Map

## Responsibility

`packages/domain` owns dependency-free policy, value objects, and state
machines shared by processes and UI.

## Authority to load

1. `AGENTS.md` for architecture and security contracts.
2. `packages/domain/package.json` and `packages/domain/tsconfig.json`.
3. The nearest implementation and colocated `*.test.ts` files.

## Pre-Development Checklist

- Keep the package independent of Electron, React, Node APIs, filesystem I/O,
  the Pi SDK, and transport concerns.
- Model policy and state transitions with explicit types and deterministic
  functions.
- Validate unmodeled external input at the owning trust boundary, not repeatedly
  inside already-typed domain flows.
- Preserve error states rather than returning false success.
- Add focused tests for state transitions, invariants, and edge cases.

## Quality Check

- Confirm imports remain dependency-free and deterministic.
- Re-run the closest invariant/state-machine tests, including invalid
  transitions and boundary values.
- Verify transport, filesystem, UI, and runtime concerns did not move here.

The generated leaf files in this directory are inactive scaffolding unless a
later task replaces one with verified Domain-specific guidance.
