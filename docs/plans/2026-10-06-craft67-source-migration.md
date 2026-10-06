# craft67 capability source migration

Status: completed
Owner: Codex
Started: 2026-10-06

## Goal and acceptance
Resolve browser67, design-craft and commerce-growth-os from pinned craft67 commits and contained package directories. Reject invalid or symlinked directory escapes, preserve exact-SHA/clean-checkout checks and bind prepared provenance to the source directory. Test with actual local Git fixtures; source-only tests do not claim packaged or Windows acceptance.

## Delivery boundary
Local implementation, tests, scoped commit and push authorized; no install, preview or release. Existing renderer/provider changes and lockfile WIP are outside scope.

## Decisions
Use optional sourceDirectory for remote sources; localSibling identifies the Git root. Existing root-layout sources remain compatible. Lock the three migrated sources to the already-pushed craft67 commit 502266ef08cde5972efd2948055882cd9e03c1c4, not uncommitted files. All three track main for freshness.

## Checkpoints
- [x] Resolver and provenance validation support a contained sourceDirectory.
- [x] Three first-party source locks use craft67.
- [x] Targeted source, preparation and freshness tests pass.
- [x] Required broader source gates and evidence limitations recorded.

## Rollback
Revert only this task's source/resolver/test/plan changes. No generated or installed runtime is modified. Retain existing user WIP.

## Risks
Old installed clients still require an explicit upgrade; local lock refers to the previously published snapshot, including the committed browser67 updater adaptation in craft67. Remote retirement remains blocked on releases, open PRs and migration of historical assets.

## Validation progress

- Targeted resolver/freshness/reachability/preparation: 31 tests covered; stale catalog/commit fixtures updated, final preparation 15/15 and resolver 6/6 pass. Real local Git resolution of all three pinned packages passes with version checks and dirty-worktree isolation.
- Extension adapter verification passed. Aggregate static checks (protocol, typecheck, lint, architecture, dead code, references, structure, transport and workflow checks) passed.
- Initial aggregate coverage was invalidated by Vitest's shared coverage temporary directory being removed. Re-run uses `/tmp/pi67-craft67-coverage-20261006` and 2 workers with unchanged coverage thresholds. Completed successfully: 963 test files passed, 9 skipped; 6,456 tests passed, 24 skipped. Coverage statements 84.35%, branches 78.92%, functions 86.98%, lines 87.96%.
- Existing renderer/settings work continued during validation; no renderer or global lockfile edits made by this task. No packaged/Windows/production acceptance is claimed.

## Closeout

Local implementation and required source verification completed on the current dirty checkout. Commit/push authorized in follow-up; no release. Other user renderer/provider WIP remains. Actual locked source resolution passed; new published updater and installed/packaged host upgrades remain outside this local delivery.
