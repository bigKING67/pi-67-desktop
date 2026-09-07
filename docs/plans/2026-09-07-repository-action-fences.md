# Repository action recovery protection

Status: completed
Owner: Codex
Started: 2026-09-07
Last updated: 2026-09-07

## Goal and acceptance

- Missing Worktree recovery rechecks current filter commands before any removal or checkout.
- Explicit submodule initialization with unconfirmed cleanup rejects and fences its Repository,
  including after application restart. Ordinary confirmed failure remains incomplete.
- A crash during explicit initialization leaves a conservative persisted marker.
- Unreadable marker inventory disables mutation admission; it cannot silently clear protection.

## Scope and delivery

Desktop action service, a private Repository marker store, startup reconciliation, regression tests,
and the Worktree architecture contract. No protocol/UI changes, network calls, publishing, or
user configuration writes. Commit is separate. Preserve unrelated renderer/settings/release WIP.

## Evidence

Baseline: 4bb169a. Prior isolated real Git recovery executed a late custom smudge; explicit action
fault injection returned incomplete without fencing. Receipts are under
`/tmp/pi67-git-process-review/{recovery-filter,explicit-submodule}-result.json`.
Targeted and aggregate results are recorded at completion; no Windows runtime claim.

## Persistence and rollback

`<userData>/repository-action-fences/<RepositoryGroupId>` is a private presence marker, containing
no user paths or Git output. Write before Git; remove only after confirmed completion. Startup
restores fences before existing creation reconciliation. No automatic reconciliation/unfence is
introduced. Filesystem power-loss durability beyond the host filesystem is not certified.

Rollback source changes only through a scoped revert. Preserve unresolved marker files; reverting
to a version that ignores them is unsafe until exact Repository cleanup is independently confirmed.
Do not delete markers as task cleanup.

## Checkpoints

- [x] Real/default-path recovery reproduction and explicit-action error propagation reproduction.
- [x] Targeted creation/recovery and restarted scheduler regressions.
- [x] Independent review and aggregate source gate.

## Validation outcome

Targeted action/startup: 18 passed; store: 2 passed. Final `corepack pnpm run check`
completed with exit 0; receipt `/tmp/pi67-action-fence-check-final.log`. Independent
readonly review reported no findings. No Windows packaged or real mid-Git process crash
acceptance; power-loss durability is unverified. Local implementation complete; scoped local commit authorized. No push.

Additional I/O validation: 22 action/store/startup tests passed; Desktop typecheck and lint
passed. Begin failure uses a real invalid directory; complete failure injects EACCES at the
store method boundary. Independent incremental review found no issues. Production bytes
match the prior full gate. Receipt: `/tmp/pi67-action-fence-io-tests.log`.
