# Submodule checkout admission

Status: complete (source remediation; target-platform validation not claimed)
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
At the hook-only checkpoint the child-only conditional-filter finding remained
OPEN. The implementation below addresses it separately and includes regression
coverage for false-complete preparation and the original filter PoC.

## Implementation checkpoint: child filter admission

The public-Git probe found a smaller safe preparation sequence: clone --bare into
Git's resolved per-worktree module directory; inspect that actual child configuration;
set core.bare=false only after admission; then let submodule update attach and
checkout. Unlike manual init --separate-git-dir, this preserves Git's just-cloned
state and materializes equal-HEAD content without --force. Rejected filters leave
an uninitialized target and reusable bare metadata. No target .git file is created
by Desktop preparation.

The runner now uses this path for fresh modules and checks existing modules in
their actual context. Explicit recursion visits each child through admission rather
than delegating unchecked recursive checkout. It validates unique module names and
paths, exact stage-0 gitlinks, directory containment, non-symlink paths and existing
Git directory/worktree identity. Existing old-form modules stay in place; an
independent reviewer reproduced a needless-clone regression in the first draft,
and it was corrected before delivery. Git commands share the remaining deadline;
filesystem calls are not claimed to have hard real-time interruption.

Real Git regressions cover child-only gitdir/onbranch includes, local and explicit
retries, missing payload before admission, equal-HEAD payload materialization,
nested child rejection/retry, inherited hooks, and old-form parents with cached
uninitialized nested children. These use local objects and isolated fixture config;
network transport, Windows and packaged runtime are still unverified.

The second independent review reproduced implicit nested checkout with inherited
submodule.recurse=true. Command-scoped submodule.recurse=false now prevents this;
a real Git regression changes an outer gitlink while its nested worktree remains
initialized, checks that the blocked nested filter never runs and the old payload
survives, then verifies the authorized retry materializes the new payload.
Explicit traversal also preserves active boolean/pathspec precedence, with Git
itself evaluating pathspecs. Six real-Git admission regressions passed in
`/tmp/pi67-submodule-recursion-regression.log`.

The initial aggregate run had real-Git fixture timeouts under unrestricted test
parallelism, including an existing startup recovery test. A new test's late cleanup
then affected the next fixture. The new multi-step fixtures use a 60-second test
budget; production budgets and safety assertions are unchanged. Final aggregate
validation uses `corepack pnpm run check --maxWorkers=4` to bound test concurrency.

The next independent review identified a scale regression in the first active
pathspec implementation: ls-files could enumerate more than 1 MiB of ordinary
tracked paths. Active selection now queries only submodule cached status and
compares Git-generated labels, rejects ambiguous labels, and returns immediately
for a leaf without submodules. The old-form regression also includes 2200 unrelated
tracked paths and a broad active pathspec. Newline-bearing paths under an
active pathspec fail closed because the status projection is line-based.

The first large-path fixture exceeded macOS PATH_MAX before reaching admission.
It was corrected to shorter paths and more files while retaining over 1 MiB of
tracked path names; no production path limit or assertion was relaxed.

## Delivery validation

Final source static gates passed in the aggregate flow. After fixing the fixture,
`corepack pnpm run test:coverage --maxWorkers=4` passed 3518 tests with 5 skipped,
including all coverage thresholds. Final test TypeScript and targeted type-aware
lint passed. Logs: `/tmp/pi67-submodule-admission-delivery-check.log` (static gates
and the superseded fixture failure), `/tmp/pi67-submodule-admission-final-coverage.log`
(final complete test gate). The independently reproduced implicit recursion case
also passed with filterRan=false and the old nested payload intact.

Both original checkout-hook and child-only conditional-filter findings are resolved
at source/local-Git level. Windows, real network clone and packaged runtime remain
unverified; this does not complete the broader repository review. Prepared metadata
is retained for safe retries, and ambiguous activity status fails closed as documented.
