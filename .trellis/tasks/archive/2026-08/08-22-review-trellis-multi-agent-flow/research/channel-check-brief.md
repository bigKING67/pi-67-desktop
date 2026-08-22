# Cross-Provider Check Brief

Active task: `.trellis/tasks/08-22-review-trellis-multi-agent-flow`

You are the sole Claude Channel check Worker for a Codex-main L2 task. Perform
an independent, evidence-first review. Do not spawn another agent.

## Review scope

- Repository authority: `AGENTS.md`, `PLANS.md`, `.gitattributes`.
- Trellis configuration, workflow, scripts, tests, specs, agents, skills, task
  artifacts, and archived bootstrap task under `.trellis/`.
- Platform integrations under `.agents/`, `.claude/`, `.codex/`, `.grok/`,
  and `.pi/`.
- Engineering integration: `eng/quality/check-trellis-integration.mjs`,
  `eng/ci/classify-change-scope.mjs`, its test, and `package.json`.
- Untracked files are part of the review. Inspect `git status --short` and open
  the relevant new files explicitly; `git diff` alone is incomplete.

## Required checks

1. Verify PRD AC1-AC9 and the design contracts against actual files.
2. Trace Relay Ensure/Resume/Checkpoint/Release/Close, including missing
   Channel, status-neutral attach, explicit takeover, and post-archive close.
3. Confirm lifecycle hooks cannot commit and correctly consume
   `TASK_JSON_PATH`.
4. Confirm four platform Continue entrypoints share one contract and Claude
   project-local permission state is ignored/untracked.
5. Compare every Channel command/flag to Trellis 0.6.15 help, especially
   terminal event kinds, one-worker guard, Claude bypass, and Codex full-access.
6. Review the developer-workflow CI classification for fail-safe product
   packaging boundaries.
7. Run the Relay unit suite, static/live integration gate, and the targeted CI
   classifier test. Run broader checks only if needed to prove a finding.

## Edit boundary

- You may self-fix small mechanical issues only inside the review scope above.
- Report design/authority/security changes for Codex main to decide; do not
  silently change them.
- Do not edit `apps/`, `packages/`, `tests/`, release/packaging logic, lockfiles,
  credentials, global CLI configuration, or `.claude/settings.local.json`.
- Do not commit, push, tag, publish, deploy, install/update tools, archive the
  active task, create a release, or switch Provider/model.

## Output

Return concrete findings with severity and `file:line`, list any mechanical
fixes, commands actually run, remaining host-runtime gaps, and a clear pass or
fail recommendation. Do not claim that static configuration proves interactive
Claude/Pi/Grok host behavior.
