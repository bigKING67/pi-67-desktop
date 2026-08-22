# Harden Trellis configuration after Claude audit

## Goal

Make the project-local Trellis workflow deterministic, self-validating, and
CI-reproducible by remediating the verified Claude audit findings without
changing Pi-67 product runtime behavior. Finish with targeted tests, the full
repository quality gate, and one independent read-only Claude Channel review.

## Background

- The completed audit is archived at
  `.trellis/tasks/archive/2026-08/08-22-audit-trellis-config-claude/`.
- No P0/P1 defect was found. The confirmed P2 findings are stale live
  references and an overclaimed routing-metadata fail-closed contract.
- The Relay suite passes 10/10 normally and 10/10 with inherited Channel bucket
  pollution, but the repository gate does not execute it.
- Native-first implementation, one L2 cross-provider review worker, sequential
  Relay takeover, Claude full-danger Bash, and not selecting the Marketplace
  dispatch template remain accepted project decisions.

## Requirements

### R1. Remove stale live references without rewriting valid examples

- Replace every current-project operational reference to a nonexistent
  `.trellis/spec/cli/...`, `test/regression.test.ts`, or
  `.trellis/scripts/inject-workflow-state.py` path.
- Add `.trellis/spec/guides/workflow-state-contract.md` as the project-wide
  runtime map for state writers, pseudo-statuses, hook reachability, routing
  metadata validation, and regression invariants. It must point back to
  `.trellis/workflow.md` as the breadcrumb text source of truth rather than
  duplicating its blocks.
- Update `.trellis/spec/guides/index.md`, `.trellis/workflow.md`, the operational
  `task.py`/`add_session.py` help text, and the synchronized `.agents`,
  `.claude`, and `.grok` task-lifecycle reference copies.
- Generic Trellis documentation examples may use hypothetical package names
  only when their surrounding text clearly presents them as examples. Do not
  mechanically rewrite every illustrative `cli` snippet.

### R2. Enforce routing metadata at the task lifecycle boundary

- Centralize the four routing fields and allowed values:
  - `risk_level`: `L1 | L2 | high`
  - `execution_mode`: `inline | native | channel`
  - `review_mode`: `native | channel`
  - `handoff_mode`: `none | relay`
- `task.py create --meta` and `task.py set-meta` must reject invalid values for
  those recognized routing keys while preserving unrelated custom metadata.
- Planning may begin with missing routing keys, but `task.py start` must require
  all four keys and validate them before changing the active pointer, status,
  or lifecycle hooks.
- Invalid or missing routing metadata must return nonzero, leave the Task in
  `planning`, spawn no Worker, and print a visible fail-closed remediation
  message. It must never silently select Channel execution.
- Update the project spec wording to match this exact machine-enforced behavior.
  Do not invent a fake authorization token for Channel implementation; explicit
  user authorization remains a main-session workflow decision.

### R3. Make Trellis verification reproducible in local and CI gates

- Add exact dev dependency `@mindfoldhq/trellis@0.6.15` and update the frozen
  pnpm lockfile. Trellis remains a development-only dependency and must not
  enter product runtime or packaged artifacts.
- Remove the obsolete Knip global-binary ignore once the local binary is owned
  by the package manifest.
- Make `check:trellis` run static checks, live CLI version/capability checks,
  and all `.trellis/tests/test_*.py` tests.
- Direct Relay tests must fail, not silently skip, when neither the local nor a
  PATH Trellis CLI exists.
- Extend the static gate to verify authoritative referenced paths exist, the
  exact local dependency/version matches `.trellis/.version`, and synchronized
  lifecycle-reference copies remain identical.
- Keep pure Trellis developer changes on the existing quality-only CI route;
  do not add native packaging solely for this remediation.

### R4. Close the Relay observability gap

- Distinguish a healthy Relay runtime with no matching metadata from an
  unavailable Relay runtime in the `close` fallback message.
- Add regression coverage for that behavior.

### R5. Preserve product and operator boundaries

- Do not change Electron, Pi runtime, Renderer, Provider, release, packaging,
  or product-session behavior.
- Do not track `.claude/settings.local.json`; preserve its full-danger local
  policy and verify its hash/ignored state after the work.
- Do not select `channel-driven-subagent-dispatch`.
- Do not commit, push, tag, release, deploy, or publish under this approval.

### R6. Final independent review

- After targeted and full gates pass, spawn exactly one Claude Channel worker
  for a read-only full-scope review of the final diff.
- Claude must inspect requirements, design, implementation plan, tests, live
  CLI behavior, dependency boundary, and final Git state; it must not edit,
  commit, push, install, or change permissions.
- The Codex main session must independently validate every material Claude
  finding, terminate the Supervisor, and confirm no live worker remains.

## Acceptance Criteria

- [x] AC1. No authoritative current-project reference resolves to a missing
  workflow-state contract, parser, regression test, or package spec path.
- [x] AC2. The new workflow-state contract and guide index accurately map live
  writers/parsers without duplicating breadcrumb text.
- [x] AC3. Invalid recognized routing metadata is rejected on create/set-meta;
  missing or invalid routing metadata cannot transition a Task out of planning.
- [x] AC4. Valid L1 and L2 routing metadata still starts normally, including
  degraded no-session-identity mode, without changing existing task semantics.
- [x] AC5. Custom unrelated Task metadata remains supported.
- [x] AC6. `@mindfoldhq/trellis` is pinned to `0.6.15` as a dev dependency,
  lockfile parity holds, and Knip no longer requires a global-binary exception.
- [x] AC7. `corepack pnpm run check:trellis` performs live CLI validation and
  executes all Trellis Python tests with zero skips.
- [x] AC8. Relay normal and inherited-bucket suites pass, routing metadata tests
  cover success/failure/no-mutation behavior, and the close fallback regression
  passes.
- [x] AC9. One final Claude Channel review finishes with no unresolved P0/P1/P2
  finding, and Codex independently confirms the result.
- [x] AC10. The final full `corepack pnpm run check` passes. No unsigned preview
  is run because no user-visible product behavior changes.
- [x] AC11. `.claude/settings.local.json` remains ignored, untracked, and
  byte-identical; no live Channel Worker remains.
- [x] AC12. No push, tag, release, deploy, publish, or product artifact is
  produced. Local scoped commit/archive work starts only after separate current
  authorization.

## Out of Scope

- Product feature work or Pi agent-loop changes.
- A second session/Relay truth source or a generic workflow engine.
- Four-main-CLI paid interactive smoke or Windows-native validation.
- Upgrading Trellis beyond `0.6.15`.
- Replacing all generic examples in bundled Trellis documentation merely
  because their hypothetical package does not exist in this repository.

## Open Questions

None. The user approved remediation, accepted the final verified result, and
separately authorized local scoped commit/archive closeout. Push, tag, release,
deploy, and publish remain unauthorized.
