# Workflow-State Contract

`.trellis/workflow.md` owns the `[workflow-state:STATUS]` breadcrumb text.
This guide maps the executable lifecycle around those blocks; do not duplicate
their prose here.

## State Writers And Statuses

| Concern | Authoritative writer or reader |
| --- | --- |
| Task creation and `planning` status | `.trellis/scripts/common/task_store.py:cmd_create` |
| Explicit start and `in_progress` status | `.trellis/scripts/task.py:cmd_start` |
| Session-scoped active pointer | `.trellis/scripts/common/active_task.py` |
| Pointer clearing | `.trellis/scripts/task.py:cmd_finish` |
| Completion and archive move | `.trellis/scripts/common/task_store.py:cmd_archive` |
| Per-turn breadcrumb bodies | `.trellis/workflow.md` `[workflow-state:*]` blocks |
| Installed per-turn parsers | `.claude/hooks/inject-workflow-state.py`, `.codex/hooks/inject-workflow-state.py` |

Stored task statuses are `planning`, `in_progress`, and `completed`. The hook
may emit derived pseudo-statuses such as `no_task` or `stale_<source_type>`;
they are display routes, not persisted task state.

## Routing Metadata Boundary

`.trellis/scripts/common/task_routing.py` owns the recognized routing schema:

| Key | Allowed values |
| --- | --- |
| `risk_level` | `L1`, `L2`, `high` |
| `execution_mode` | `inline`, `native`, `channel` |
| `review_mode` | `native`, `channel` |
| `handoff_mode` | `none`, `relay` |

`task.py create --meta` and `task.py set-meta` reject invalid values for these
keys while preserving unrelated custom metadata. Planning may omit the four
keys. `task.py start` validates all four before a pointer write, status change,
or lifecycle hook; a failure returns nonzero and leaves the Task in `planning`.
Metadata does not authorize Channel execution: the main session still needs an
explicit current user decision.

## Hook Reachability And Relay

`task.py create`, `start`, `finish`, and `archive` invoke their corresponding
configured lifecycle hook only after their own successful state transition.
`.trellis/scripts/trellis_relay.py` records bounded Relay metadata only; task
artifacts and Git remain authoritative. A `close` with no matching Relay
metadata reports that absence distinctly from an unavailable Relay runtime.

## Regression Invariants

- `.trellis/tests/test_task_routing.py` covers routing validation and verifies
  a rejected start has no pointer, status, or hook mutation.
- `.trellis/tests/test_trellis_relay.py` covers Relay resolution, inherited
  project isolation, unavailable runtime fallback, and close-without-metadata.
- `eng/quality/check-trellis-integration.mjs` verifies authoritative paths,
  local dependency/version parity, synchronized lifecycle references, and live
  CLI capability. `corepack pnpm run check:trellis` runs that check plus all
  Trellis Python tests.
