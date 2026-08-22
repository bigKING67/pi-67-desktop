# Agent Host Development Map

## Responsibility

`apps/agent-host` owns the Electron utility-process command router, Pi runtime
lifecycle, operation/recovery state, managed capabilities, and truthful result
projection back to Desktop. It is not a second agent loop or Session store.

## Authority to load

1. `AGENTS.md` for product, Harness, security, and architecture contracts.
2. `apps/agent-host/package.json` and `apps/agent-host/tsconfig.json` for the
   current build and type boundary.
3. The nearest implementation and colocated `*.test.ts` files for live patterns.
4. `.trellis/spec/guides/trellis-development-workflow.md` only for development
   coordination or cross-CLI handoff work.

## Pre-Development Checklist

- Keep Pi execution behind `@pi67/pi-runtime`; do not compose prompts or route
  models independently in this package.
- Validate `@pi67/protocol` input before crossing the process boundary.
- Keep cancellation, recovery, authorization, and terminal-result handling
  explicit and observable.
- Never expose raw prompts, source bodies, credentials, or tool payloads through
  logs or diagnostics.
- Add or update colocated regression tests for router, policy, recovery, and
  lifecycle behavior.

## Quality Check

- Confirm the Pi runtime remains the only agent-loop authority.
- Re-run the closest router/policy/recovery tests and verify cancellation and
  terminal errors are not reported as success.
- Check that process-boundary payloads are validated and diagnostics remain
  redacted.

The generated leaf files in this directory are inactive scaffolding. Do not load
or treat them as authority unless a later task replaces a leaf with verified,
package-specific guidance.
