# Desktop Process Development Map

## Responsibility

`apps/desktop` owns Electron Main and Preload, windows, updates, native dialogs,
the Agent Host supervisor, and application/process lifecycle. The Trellis layer
name is retained for generator compatibility; this package is not a React
frontend.

## Authority to load

1. `AGENTS.md` for process, security, packaging, and platform contracts.
2. `apps/desktop/package.json`, `apps/desktop/src/main.ts`, and
   `apps/desktop/src/preload.ts` for current entrypoints.
3. The nearest implementation and colocated `*.test.ts` files.

## Pre-Development Checklist

- Preserve `contextIsolation`, renderer sandboxing, strict CSP, and the narrow
  validated preload bridge.
- Production assets use `app://pi67`; do not add a business HTTP/WebSocket
  server.
- Keep platform claims bound to exact native artifacts and target-OS evidence.
- Keep process shutdown, restart, update, and recovery paths bounded and
  cancellable.
- Add targeted tests for Main/Preload security and lifecycle changes.

## Quality Check

- Re-run the closest Main/Preload lifecycle and security tests.
- Confirm the preload bridge stayed narrow, validated, and sandbox-compatible.
- Bind native behavior claims to the exact packaged artifact and target OS.

The generated leaf files in this directory are inactive scaffolding unless a
later task replaces one with verified Desktop-specific guidance.
