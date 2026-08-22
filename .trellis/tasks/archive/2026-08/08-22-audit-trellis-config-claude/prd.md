# Audit current Trellis configuration with Claude

## Goal

Obtain an independent, read-only Claude assessment of whether the current
Pi-67 Trellis integration has correctness, maintainability, security,
cross-CLI handoff, or workflow-governance defects.

## Background

- The repository currently uses a customized native-first Trellis workflow.
- Normal implementation stays in the active CLI or its native sub-agents.
- L2 review defaults to exactly one cross-provider Channel worker.
- Cross-CLI continuation is sequential through Task artifacts, bounded
  `handoff.md`, Relay metadata, and live Git state.
- Claude project-local execution is intentionally configured for unrestricted
  Bash access; this is an expected policy, not itself a defect.
- `channel-driven-subagent-dispatch` is intentionally not selected because
  Channel implementation must remain explicit-only.

## Requirements

- Dispatch exactly one Claude Channel worker for an independent audit.
- Keep the Claude audit read-only: it may inspect files and run non-destructive
  checks, but it must not edit files, install dependencies, commit, push,
  publish, deploy, or change local trust/permission settings.
- Audit the committed Trellis integration at the current `main` HEAD, while
  treating any task-only planning artifacts created for this audit as
  coordination files rather than implementation under review.
- Cover at least:
  - native-first, Channel-review, and explicit-only Channel-implementation routing;
  - Task lifecycle, planning gates, archive behavior, and workflow-state injection;
  - Relay candidate resolution, takeover/checkpoint/release/close behavior, and fail-closed boundaries;
  - Codex, Claude, Pi, and Grok continuation/review entrypoints and context preservation;
  - Channel worker limits, provider restrictions, permission behavior, and orphan cleanup;
  - integration tests, repository quality gates, generated-file drift, ignored local settings, and CI scope classification;
  - unnecessary complexity, contradictions, stale documentation, unsafe defaults, or missing recovery coverage.
- Require findings to include severity, concrete evidence, affected files and
  line numbers, reproduction or verification steps, impact, and a recommended
  disposition.
- Distinguish verified defects from risks, suggestions, and unverified concerns.
- After Claude reports, the Codex main session must independently validate each
  material finding against live files, Git state, and relevant checks.

## Acceptance Criteria

- [x] One Claude Channel worker completes the read-only audit and exits.
- [x] The Channel event log preserves the worker's final result and reports no live worker afterward.
- [x] Claude's report covers every required review area or explicitly explains any skipped area.
- [x] Every claimed defect has actionable evidence; unsupported observations are labeled unverified.
- [x] Codex independently confirms, narrows, or rejects every material finding.
- [x] The final user report separates blockers, non-blocking improvements, false positives, verified checks, and residual risks.
- [x] No product or Trellis configuration file is modified by the review worker.
- [x] No commit, push, release, deployment, dependency installation, trust change, or permission-policy change occurs during this audit.

## Out of Scope

- Fixing findings. Any remediation requires a separate decision after the audit.
- Product runtime, UI, packaged Electron, Windows, or macOS validation except where a Trellis change directly affects repository quality routing.
- Replacing the customized workflow with a Marketplace template.
- Running Pi or Grok as simultaneous workers.

## Planning Decision

This is a lightweight, review-only L1 task. `prd.md` is sufficient; no
`design.md` or `implement.md` is required. The execution route is one
read-only Claude Channel worker followed by main-session verification.
