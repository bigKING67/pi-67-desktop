# Extension Compatibility Development Map

## Responsibility

`packages/extension-compat` contains the bounded compatibility seams required
to admit supported Pi extensions without creating a second runtime or allowing
renderer code injection.

## Authority to load

1. `AGENTS.md` for Harness and extension security contracts.
2. `packages/extension-compat/package.json` and its public exports.
3. The nearest implementation and colocated `*.test.ts` files.

## Pre-Development Checklist

- Adapt only supported Pi SDK/Extension seams; do not add a parallel tool or UI
  orchestrator.
- Fail explicitly for unsupported TUI-only or renderer-injection behavior.
- Keep compatibility conversions typed, bounded, and covered by provenance or
  regression tests.
- Never broaden capability authorization while translating extension metadata.

## Quality Check

- Re-run compatibility/provenance tests for every changed adapter seam.
- Confirm unsupported UI/runtime behavior fails explicitly.
- Verify capability identity and authorization were not broadened by conversion.

The generated leaf files in this directory are inactive scaffolding unless a
later task replaces one with verified package-specific guidance.
