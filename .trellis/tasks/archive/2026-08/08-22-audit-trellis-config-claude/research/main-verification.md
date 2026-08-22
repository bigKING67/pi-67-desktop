# Main Verification Of Claude Audit

## Audit Evidence

- Target: committed `main` HEAD `42e15c29b8d6b47102f64b8e745eb3c8b215dcde`.
- Channel: `check-audit-trellis-config-claude-r1`.
- Claude final report: raw Channel message sequence `83`; terminal `done`
  event sequence `84`.
- The resumed report-only turn recorded USD 0.741865. The interrupted initial
  turn emitted no cost field, so the full paid cost is not observable from the
  Channel events and must not be inferred from that lower bound.
- After explicit termination, `trellis channel list --all` reported no live
  worker and the two observed Supervisor PIDs no longer existed.
- `.claude/settings.local.json` SHA-256 remained
  `6d083d404f610b5023d801d4453152ae22988dac32453dedf0a6a5a54556c052`.
- Tracked repository files remained unchanged; only this untracked audit Task
  directory was created by the main session.

## Finding Disposition

### Confirmed: P2 stale committed references

The worker spawn warning exposed a real repository defect, not only a bad
audit manifest. The following committed references point to files that do not
exist in this repository:

- `.trellis/workflow.md:758` references
  `.trellis/spec/cli/backend/workflow-state-contract.md`.
- `.trellis/workflow.md:759` references
  `.trellis/scripts/inject-workflow-state.py`, while the live parsers are under
  platform hook directories such as `.claude/hooks/` and `.codex/hooks/`.
- `.trellis/workflow.md:134` names `test/regression.test.ts`, which does not
  exist here.
- `.agents/`, `.claude/`, and `.grok/` copies of
  `trellis-meta/references/customize-local/change-task-lifecycle.md:76` repeat
  the nonexistent workflow-state contract path.
- `.trellis/scripts/task.py:424` and `.trellis/scripts/add_session.py:219`
  contain project-inapplicable `.trellis/spec/cli/backend/...` examples.

The audit task's initial `check.jsonl` copied the dead workflow-state path and
was corrected before dispatch activation. The spawn warning is reproducible
evidence that the committed documentation can misroute a real context load.

### Confirmed but narrowed: P2 metadata enforcement gap

`.trellis/spec/guides/trellis-development-workflow.md:19` states that missing
or invalid routing metadata fails closed to Native execution with visible
degraded review. The injected workflow does instruct the main agent to read
`task.json.meta`, so valid tasks are procedurally routed as designed. However,
`task.py create --meta` and `task.py set-meta` accept arbitrary strings, and
`task.py start` has no schema gate for the four routing keys. Therefore the
machine-enforced fail-closed claim is stronger than the implementation.

This does not break the current valid task path, but malformed metadata can
enter `in_progress` without a deterministic visible degradation. The minimal
remediation is schema validation before `task.py start`, or weaker spec text
that honestly labels the behavior as an agent convention.

### Confirmed: P3 Relay tests are not executed by the repository gate

`package.json` runs `check:trellis` as a static Node check. The Node check reads
`.trellis/tests/test_trellis_relay.py` and searches for expected test names but
does not execute the Python suite. No package script or CI step runs it.

### Confirmed: P3 future silent-skip risk

`.trellis/tests/test_trellis_relay.py:28-29` skips each test when `trellis` is
absent. If the suite is added to CI without first asserting the CLI exists, CI
could report a successful but fully skipped run.

### Confirmed suggestions

- `eng/quality/check-trellis-integration.mjs` is primarily a static substring
  drift gate. It is useful but does not validate referenced path existence or
  routing semantics.
- `.trellis/scripts/trellis_relay.py:573` describes a healthy-but-missing Relay
  channel as unavailable; line 506 already has the more accurate wording.

## Findings Not Accepted As Blockers

- The lack of a second programmatic router is intentional. Trellis coordinates
  developer agents and must not become a product runtime or a second Pi agent
  loop.
- Full-danger Claude Bash is an explicit operator policy and worked without an
  approval block; it is not a defect.
- Not selecting the Marketplace `channel-driven-subagent-dispatch` template is
  intentional and preserves native-first implementation.
- Pi/Grok not being Channel Spawn Providers is consistent with the sequential
  interactive takeover design.

## Reproduced Checks

- `python3 .trellis/tests/test_trellis_relay.py -q`: 10/10 passed.
- Same command with `TRELLIS_CHANNEL_PROJECT=parent-worker-bucket`: 10/10 passed.
- `corepack pnpm run check:trellis`: passed.
- `git diff --check`: passed.
- `trellis channel list --all`: no live worker after termination.

## Residual Coverage

- No four-main-CLI interactive handoff smoke was performed.
- No Windows hook behavior was verified on this Apple Silicon host.
- The generated per-package guideline bodies were sampled rather than reviewed
  line by line.

## Overall Judgment

The customized Trellis architecture is usable and aligned with the user's
sequential cross-CLI goal. There are no verified P0/P1 blockers. The next
remediation should fix the stale reference family, add metadata validation or
correct the spec claim, and wire the Relay suite into the quality gate with an
explicit Trellis CLI prerequisite.
