# Execution Plans

Use an execution plan only for L2 work that spans modules, sessions, migrations,
recovery, or candidate/release checkpoints. Routine L0 and L1 work should stay in
the current CLI context and Git diff.

Create an active plan under `docs/plans/YYYY-MM-DD-<short-name>.md` by copying the
template below. Keep it current while work is active. On completion, retain it
only when its decisions or evidence remain useful; otherwise remove it before the
final scoped commit.

An execution plan coordinates work. It does not override `PRODUCT.md`,
`DESIGN.md`, `DESIGN.dark.md`, architecture contracts, Pi JSONL session truth,
Git history, or release provenance.

## Plan contract

- State the goal, non-goals, acceptance criteria, and explicit delivery boundary.
- Record observed evidence separately from assumptions and proposals.
- Keep checkpoints independently verifiable and update their status in place.
- Bind validation to commands, artifacts, platforms, and exact source SHA where
  applicable.
- Record rollback before high-risk implementation starts.
- Preserve dirty worktree boundaries and identify files owned by unrelated WIP.
- Do not mark a checkpoint complete from a pending job, source-only inspection,
  mock, hosted substitute, or stale artifact.
- Stop and revise the plan when the earliest uncertain assumption fails.

## Template

```markdown
# <Plan title>

Status: proposed | active | blocked | completed
Owner: <name or role>
Started: YYYY-MM-DD
Last updated: YYYY-MM-DD

## Goal

## Non-goals

## Acceptance criteria

## Delivery boundary

- Local implementation:
- Commit:
- Push:
- Candidate build/upload:
- Tag/release/promotion:

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED |  |  |  |

## Affected boundaries

- Modules/processes:
- Protocol or persisted state:
- Platform/artifact:
- Security/privacy:
- Existing WIP:

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
|  |  |  |

## Checkpoints

- [ ] 1. <Narrow outcome and evidence required>
- [ ] 2. <Narrow outcome and evidence required>

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source |  |  | pending |
| Tests |  |  | pending |
| Runtime/host |  |  | pending |
| Packaged artifact |  |  | pending |
| Target OS/manual |  |  | pending |

## Rollback

## Risks and unknowns

## Progress log

- YYYY-MM-DD: <checkpoint, evidence, and next step>

## Closeout

- Final source SHA:
- Changed files:
- Validation completed:
- Validation not completed:
- Remaining risks:
- Commit/push/release state:
```

## Lightweight coordination boundary

Pi-67 uses repository documents and live Git state for development coordination:

- L0/L1 stays direct. L2 uses one ordinary Markdown execution plan under
  `docs/plans/`; no persistent task runtime or per-prompt workflow injection is
  required.
- The current CLI or its native sub-agents implement by default. Independent
  review is risk-based or explicitly requested, not an automatic phase.
- Cross-CLI handoff is sequential and bounded. Record only the goal, current
  Git/dirty scope, decisions, validation, risks, and next action in the active
  plan or an explicitly requested handoff.
- The receiving CLI re-checks the canonical checkout, branch, HEAD, dirty paths,
  relevant files, and live runtime before editing. Handoff text never overrides
  newer Git or runtime evidence.
- Plans, handoffs, reviewer reports, and AI memories are supplemental. They do
  not become a second product, runtime, Session, Git, or release source of truth.
- A repository-wide workflow scaffold may be reconsidered only after repeated,
  measured cross-CLI context loss makes the lightweight flow insufficient and
  the user explicitly approves the added maintenance surface.
