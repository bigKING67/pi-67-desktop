# Submodule checkout admission

Status: active
Owner: Codex
Started: 2026-09-07

## Goal and acceptance

Prevent inherited checkout hooks and child-only conditional filters from executing during
Desktop submodule initialization. Both local-only and network-explicit modes must use the
same checkout admission. Preserve local-only no-network policy, explicit recursive network
mode, exact gitlink commits, ordinary incomplete handling, cancellation and cleanup fences.

## Evidence and proposed mechanism

Baseline 70eda10. Actual local creation executed inherited post-checkout and child-only
includeIf custom smudge; original results embedded in `/tmp/pi67-git-process-review/submodule-execution-review.json`.
The old hook-result path was reused by the fixed probe; use the original embedded result
and log for baseline evidence, not the overwritten raw hook-result file.
Public Git submodule update does not expose a documented preparation-only option.
The initial no-checkout proposal was rejected by the probe below. Investigate bare
preparation and child-context inspection before attachment and exact checkout.
Disable hooks on all child Git commands.

## Boundaries

Use existing bounded private Git runner and transports. Do not create a second Git runtime,
edit user global/system configuration, invoke network in development probes, or weaken
filter checks. New child Git metadata may be created as part of authorized submodule init.
Unknown/ambiguous filesystem ownership must fail closed. Test linked and ordinary roots,
retries, cancellation, inherited hooks and conditional filters. No Windows runtime claim
from macOS tests. Preserve unrelated renderer/settings/release WIP.

## Validation and delivery

Targeted real-Git regressions, affected-package checks, independent review, aggregate source
gate. Local implementation only; scoped commit, push and distribution are separate.

## Rollback

Revert only task source changes. Keep user repositories and prepared module metadata intact;
never bulk-delete modules to roll back code. Reverting to the prior checkout path restores
known execution gaps, so do not resume automatic initialization on unreviewed configuration.

## Checkpoint: hook admission

The shared submodule-update command now disables hooks with command-scoped
`core.hooksPath=/dev/null` for both modes. Real local Git regressions cover creation
and explicit reinitialization using cached objects; 15 targeted tests passed.
Independent read-only review found no new issue in this bounded change.
Aggregate source checks passed through static gates; the first coverage run had
one existing startup-reconcile test time out at 15 seconds (3511 passed, 5 skipped).
That file plus the new regression passed 10/10 on focused rerun; unchanged full
coverage rerun passed 3512 tests, 5 skipped, including coverage thresholds. No test
timeouts or assertions were weakened. Logs: `/tmp/pi67-submodule-hook-check.log`,
`/tmp/pi67-submodule-hook-recheck.log`, `/tmp/pi67-submodule-hook-coverage-recheck.log`.
This does not establish Windows, recursive nested-module, network transport or packaged evidence.

## Rejected preparation approach and next action

Public Git 2.50.1 probes demonstrated that clone --no-checkout can report a complete
submodule when HEAD already matches the gitlink despite missing working files.
Ordinary update --checkout then skips materialization. Do not use that sequence as
an admission or completion proof.

Bare clone into the resolved per-worktree module Git directory keeps the target
uninitialized until attachment. Public init --separate-git-dir can attach it, but
materialization then needs an explicit checkout even if HEAD matches. Never apply
force checkout indiscriminately to existing user worktrees. Before implementing,
settle prepared-metadata ownership, detached-HEAD conditional configuration,
existing/deinitialized repositories, bounded recursive traversal and retry state.
The child-only conditional-filter finding remains OPEN; hook suppression alone
is not filter admission. Next implementation must preserve this distinction and
add a regression for false-complete preparation as well as the original filter PoC.
