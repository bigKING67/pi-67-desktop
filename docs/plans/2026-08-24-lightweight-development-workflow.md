# Lightweight development workflow

Status: completed
Owner: Codex
Started: 2026-08-24
Last updated: 2026-08-24

## Goal

Remove the repository-wide Trellis scaffold and return Pi-67 Desktop to a
lightweight workflow based on project instructions, ordinary L2 execution
plans, live Git evidence, native implementation, and on-demand handoff/review.

## Non-goals

- Do not modify, discard, stage, commit, or push unrelated Session Catalog or
  Renderer shell-polish WIP.
- Do not remove useful project instructions, platform-local safety defaults, or
  durable product/architecture decisions merely because they were referenced by
  Trellis.
- Do not package, publish, upload, deploy, release, or alter user-global AI CLI
  configuration.

## Acceptance criteria

- [x] No repository hook injects Trellis state at session start, per prompt, or
  sub-agent start.
- [x] No Trellis task runtime, Relay/Channel adapter, generated Trellis skill,
  platform agent/prompt, dependency, test, or quality gate remains tracked.
- [x] L0/L1 direct work, L2 execution plans, sequential handoff, native agents,
  and risk-based review have one concise authority in `AGENTS.md`/`PLANS.md`.
- [x] Current Session Catalog L2 decisions survive in an ordinary execution
  plan, and the verified grouped-listbox accessibility rule survives in project
  instructions.
- [x] No redundant Codex project runtime layer remains; Claude and Pi retain
  only useful project-local settings unrelated to the removed scaffold.
- [x] Scaffold-specific stale-reference, configuration parse, dependency/lock, CI
  classifier, type, lint, build, architecture, transport, reference, and workflow
  checks pass.
- [ ] The complete repository gate is green. Preserved product WIP still has
  three source-size findings, one pre-existing unused export, and one Session
  Catalog behavior-test mismatch; none originates in the scaffold removal.

## Delivery boundary

- Local implementation: authorized
- Commit: authorized for this scoped local migration delivery
- Push: not authorized
- Candidate build/upload: not authorized
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | `.trellis` contains 163 tracked files; shared Trellis skills contain 46 tracked files; four platform directories contain 117 tracked files. | live Git inventory | 2026-08-24 |
| OBSERVED | Trellis/shared skills contain about 23,119 lines and are coupled to the root quality gate. | live file and `package.json` inventory | 2026-08-24 |
| OBSERVED | The Codex `UserPromptSubmit` hook runs the workflow-state resolver on every prompt and defaults dispatch to Trellis sub-agents. | current project hook/config | 2026-08-24 |
| OBSERVED | The user explicitly chose the lightweight recommendation after reviewing the maintenance and prompt-routing cost. | current user authorization | 2026-08-24 |

## Affected boundaries

- Modules/processes: developer workflow only; no product runtime module.
- Protocol or persisted state: none.
- Platform/artifact: project-local Codex, Claude, Pi, and Grok integration files;
  no user-global configuration.
- Security/privacy: remove prompt/task persistence surfaces; retain no raw
  conversation or credential data.
- Existing WIP: two active product scopes remain uncommitted and must be
  preserved without staging.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Remove the complete scaffold rather than merely disabling one hook. | Disabled generated files, dependency, tests, and CI would retain most maintenance cost. | A near-term required handoff depends on a scaffold-only artifact that cannot be migrated. |
| Remove `.codex` after its Trellis hooks and agents are gone; keep minimal `.claude` and `.pi` settings. | Codex discovers `AGENTS.md` without a project config, while the remaining fallback/depth settings are redundant or absent from the current public config reference. Claude cwd behavior and Pi Skill commands remain independently useful. | A fresh Codex runtime proves a necessary project override is missing. |
| Migrate only verified, project-specific knowledge. | Template guidance and historical journals add noise; active product contracts must survive. | A removed file is proven to contain a unique current product contract. |
| Keep independent review on demand. | One developer and sequential CLI use do not justify an always-on worker runtime. | Repeated measured context loss or review coordination failures recur. |

## Checkpoints

- [x] 1. Inventory integration surface and identify durable content to preserve.
- [x] 2. Migrate lightweight workflow, active L2 plan, and verified component rule.
- [x] 3. Remove generated runtime, platform adapters, dependency, and gates.
- [x] 4. Pass stale-reference and relevant repository validation; attribute the
  remaining full-gate failures to preserved product WIP.
- [x] 5. Review final dirty scope and document remaining unrelated WIP.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | stale-reference scan, JSON parse, path-absence checks, `git diff --check` | no live Trellis path or broken config | passed |
| Tests | CI classifier plus full coverage attempt | developer-workflow classifier 19/19 passed; coverage finished with 582 files/3,021 tests passed, one preserved Session Catalog WIP test failed | partial; unrelated WIP failure |
| Quality | frozen install, dependency/lock refresh, dependency audit, typecheck, lint, build, architecture, structure, dead-code | dependency/binary absent; install, audit, typecheck, lint, build, architecture, protocol, reference, transport, and workflow gates passed; structure reported three Session Catalog WIP size findings and dead-code reported one Composer WIP export | partial; unrelated WIP findings |
| Runtime/host | fresh Codex App Server probe | no repository Codex config or Trellis hook layer remains | passed; probe `ok`, 16 user-level trusted hooks, no repository hook files |
| Packaged artifact | not required | developer-only workflow change | not applicable |
| Target OS/manual | not required | no product/platform runtime claim | not applicable |

## Rollback

Restore the removed tracked paths and pre-migration configuration from Git, then
delete the two new ordinary plans only if their content has been preserved
elsewhere. Do not touch unrelated product WIP during rollback.

## Risks and unknowns

- A running CLI session can retain already-injected context until restarted even
  after repository hooks are removed.
- The current root lockfile must be refreshed without changing unrelated exact
  dependency versions.
- Historical commits retain deleted Task/journal content; deletion from the
  working tree is not a history rewrite.

## Preserved parallel WIP checkpoint

The independent L1 Renderer shell-polish work remains in `DESIGN.md`, Composer
CSS, navigation CSS, Inspector CSS, packaged smoke coverage, and
`tests/e2e/renderer-shell-border-polish.spec.ts`.

- Intended behavior: keep TitleBar/pane boundaries, remove redundant local
  header underlines, use quiet filled search fields with one outer focus owner,
  and promote the Composer shell only while its textarea owns focus.
- The removed task artifact marked its visual, targeted E2E, type-check, lint,
  build, and unsigned macOS preview acceptance items complete. This migration
  does not revalidate those claims; the next product closeout must inspect the
  live diff and rerun the relevant gates before commit.
- The Session Catalog defect discovered during that visual review is preserved
  separately in `2026-08-24-session-catalog-automatic-title-search.md` and must
  not be concealed inside the Renderer-only scope.

## Progress log

- 2026-08-24: User approved replacing the full scaffold with the lightweight
  workflow after a live repository inventory.
- 2026-08-24: Identified the active Session Catalog plan and grouped-listbox
  accessibility contract as the only current project-specific content requiring
  migration before deletion.
- 2026-08-24: Removed the runtime, generated skills/agents/hooks/prompts, Relay,
  Tasks/journals/spec templates, dependency, and dedicated quality gate. The
  tracked migration removes about 41,874 lines before counting the two new plans.
- 2026-08-24: Passed frozen install, config parse, stale-reference, classifier,
  typecheck, lint, build, architecture, protocol, reference, transport, workflow,
  and fresh Codex App Server checks. Recorded but did not modify unrelated
  product-WIP failures from structure, dead-code, and one coverage test.
- 2026-08-24: A new Codex session took over the uncommitted migration for an
  independent local revalidation. It removed the now-redundant `.codex` project
  config and restored `.agents`/`.grok` as non-product paths in the structure
  checker before rerunning gates.
- 2026-08-24: Takeover validation confirmed 325 scoped deletions, two ordinary
  plans, no live Trellis references outside the historical migration plans, no
  Trellis package/binary/lock entries, classifier 19/19, and a clean fresh Codex
  App Server probe. The complete gate remains blocked only by preserved product
  WIP findings listed in the validation matrix.

## Closeout

- Base source SHA: `bc4e9b3`; this plan is included in the scoped local migration commit
- Changed files: workflow authority/configuration, dependency/lockfile, CI
  classification/structure rules, two ordinary plans, and 325 scoped deletions;
  the takeover did not edit product source WIP
- Validation completed: frozen install, JSON parse, path/stale-reference scan,
  diff check, classifier 19/19, dependency audit, typecheck, lint, build,
  architecture, protocol, reference, transport, workflow, and fresh Codex App
  Server probe
- Validation not completed: a green complete repository gate; exact failures are
  the preserved Session Catalog source-size/test mismatch and Composer unused
  export WIP
- Remaining risks: the current conversation retains older injected context in
  its history; future sessions must load the new `AGENTS.md`, and the independent
  product WIP still requires its own closeout
- Commit/push/release state: scoped local migration commit authorized; push and release not authorized
