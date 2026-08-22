# Design: Trellis Configuration Hardening

## Scope And Authority

This change affects only developer coordination infrastructure. Live Git,
Task artifacts, `.trellis/workflow.md`, and executable scripts remain the
authority layers described by `AGENTS.md` and `PLANS.md`. It does not add a
product runtime, a second Pi loop, or another session source of truth.

## 1. Workflow-State Reference Model

Create `.trellis/spec/guides/workflow-state-contract.md` as a map, not a second
copy of workflow prose. It will document:

- `task.py create/start/finish/archive` and active-task pointer writers;
- task statuses and injected pseudo-statuses;
- platform parser locations and fallback behavior;
- routing metadata schema and start gate;
- lifecycle hooks and Relay side effects;
- regression invariants and their owning tests/gates.

`.trellis/workflow.md` continues to own `[workflow-state:*]` block contents.
The new contract links to those blocks and live code. This preserves one text
source of truth while making previously promised implementation details real.

Only declarative current-project references are required to exist. Clearly
illustrative code-fence examples remain examples and are not fed into the path
integrity gate.

## 2. Routing Metadata Boundary

Add a narrowly named module:

```text
.trellis/scripts/common/task_routing.py
```

It owns immutable allowed-value sets and validation functions. Production
callers:

1. `cmd_create` validates any recognized routing key present in `--meta` but
   permits missing keys during planning.
2. `cmd_set_meta` validates a recognized routing key before writing it while
   preserving arbitrary unrelated metadata.
3. `cmd_start` requires the complete valid routing schema before active-pointer
   or status mutation.

The start gate rejects malformed tasks rather than silently mutating them to a
different route. This is the strongest fail-closed behavior: the Task remains
`planning`, no hook runs, and no Worker can be dispatched. The error explains
how to restore Native defaults. Explicit Channel implementation authorization
remains a human/main-session decision because a Task string cannot prove the
user's current intent.

## 3. Reproducible Trellis Toolchain

Pin `@mindfoldhq/trellis` exactly in root `devDependencies`. This makes the CLI
available through pnpm's `node_modules/.bin` in every workflow that already
runs `pnpm install --frozen-lockfile`, avoids repeated `pnpm dlx` downloads,
and locks transitive dependencies. It stays development-only and is not
imported by product code.

`check:trellis` becomes the aggregate Trellis gate:

```text
static/path/version checks
  -> live local CLI capability check
  -> unittest discovery for .trellis/tests/test_*.py
```

The Relay test harness prepends the repository-local `.bin` directory to the
subprocess PATH and fails visibly when no CLI is available. This supports both
direct Python invocation and pnpm/CI execution without relying on a global
installation.

The existing CI change classifier remains unchanged: Trellis-only edits still
run quality only. Adding the exact dev dependency changes the package manifest
and lockfile once, but no permanent native-packaging rule is added.

## 4. Test Strategy

### Routing metadata

- allowed partial metadata during planning;
- invalid recognized create/set-meta values rejected;
- custom keys preserved;
- start rejects missing/invalid schemas before pointer/status/hook mutation;
- valid L1/L2 schemas transition normally;
- no-session-identity degraded start still works for valid schemas.

### Relay and observability

- existing 10 Relay tests in normal environment;
- inherited project-bucket pollution suite;
- close-with-no-matching-channel returns accurate metadata-missing wording;
- no skipped tests when the CLI prerequisite is absent.

### Static integration

- pinned package version equals `.trellis/.version` and live CLI version;
- authoritative paths exist;
- `.agents`/`.claude`/`.grok` lifecycle reference copies match;
- local Claude full-danger file remains ignored and untracked.

## 5. Compatibility And Rollback

- Existing archived tasks are not migrated and do not need to pass the new
  start gate because they are never started.
- Planning tasks missing metadata will receive a visible error and can be
  repaired with four `task.py set-meta` commands.
- Current valid tasks retain the same routing values and behavior.
- Rollback is file-scoped: revert the routing module/callers/tests, package and
  lockfile pin, gate changes, reference docs, and Relay wording together. Do
  not leave the spec claim or tests ahead of implementation.

## 6. Explicit Non-Goals

- No automatic choice of Channel Provider.
- No concurrent multi-main orchestration.
- No Marketplace workflow selection.
- No product dependency on Trellis.
- No commit or external action without a later explicit authorization.
