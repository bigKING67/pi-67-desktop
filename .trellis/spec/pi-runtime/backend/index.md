# Pi Runtime Development Map

## Responsibility

`packages/pi-runtime` owns the `AgentRuntime` port, `PiSdkRuntime`, supported Pi
resource loading, Provider seams, and the extension UI bridge.

## Authority to load

1. `AGENTS.md` for the Pi-only Harness and per-Turn Provider/model contracts.
2. `packages/pi-runtime/package.json` and `packages/pi-runtime/tsconfig.json`.
3. The nearest implementation and colocated `*.test.ts` files.

## Pre-Development Checklist

- `@earendil-works/pi-coding-agent` is the only agent runtime; do not add an RPC
  adapter, system `pi` fallback, or a second agent loop/model router.
- Preserve Pi resource precedence and user-owned system/agent resources.
- Keep the selected model, Provider, and protocol stable and explicit for a
  Turn; never silently fall back.
- Keep streaming, cancellation, recovery, and Tool Result projection truthful.
- Add targeted SDK/runtime tests for resource, Provider, Tool, and recovery
  behavior.

## Quality Check

- Confirm there is no second agent loop, model router, Session truth, or system
  `pi` fallback.
- Re-run the closest SDK/resource/Provider/Tool/recovery tests.
- Verify per-Turn Provider/model/protocol identity and no-fallback errors remain
  explicit.

The generated leaf files in this directory are inactive scaffolding unless a
later task replaces one with verified Pi Runtime-specific guidance.
