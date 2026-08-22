# Protocol Development Map

## Responsibility

`packages/protocol` owns validated cross-process commands, events, revisions,
and serializable contracts shared by Renderer, Desktop, Agent Host, and runtime
adapters.

## Authority to load

1. `AGENTS.md` for process and security boundaries.
2. `packages/protocol/package.json`, its revision gate, and public exports.
3. The nearest implementation and colocated `*.test.ts` files.

## Pre-Development Checklist

- Validate at every untrusted process/serialization boundary and return explicit
  protocol errors.
- Keep payloads serializable, revisioned when required, and independent of
  Electron, React, filesystem, and Pi SDK implementation objects.
- Update producers, consumers, validators, revisions, and targeted tests as one
  cross-layer change.
- Do not transmit raw prompts, source bodies, credentials, or unrestricted tool
  payloads through diagnostics or convenience fields.

## Quality Check

- Re-run protocol revision, validator, producer, and consumer tests for every
  changed contract.
- Confirm invalid serialized input fails explicitly at the process boundary.
- Verify payloads remain serializable and implementation-neutral.

The generated leaf files in this directory are inactive scaffolding unless a
later task replaces one with verified Protocol-specific guidance.
