# CI validation routing

The ordinary `CI` workflow classifies the exact Git diff before selecting validation jobs.
Unknown, shared, dependency, or workflow changes fail closed to the full validation set.

## Windows installer verifier-only changes

Changes limited to the Windows installer verifier allowlist may reuse an installer candidate
from the exact base commit instead of rebuilding Electron and NSIS. Documentation may accompany
the verifier change without disabling reuse.

Reuse is selected only when all of the following are true:

1. the base SHA has a completed failed `CI` run;
2. the source is the first immutable run attempt, avoiding ambiguous same-run artifacts;
3. the Windows native job failed at `Verify Windows NSIS installer lifecycle`;
4. every Windows native step before the lifecycle step succeeded;
5. exactly one `windows-installer-debug-candidate-<run-id>` artifact exists, is non-empty, and is not expired;
6. the verifier ref descends from the source SHA;
7. every source change is in the verifier allowlist or documentation.

If discovery cannot prove these conditions, CI runs the normal Quality and Windows native jobs.
If reuse starts and the verifier or lifecycle fails, CI fails; it does not rebuild a new candidate
to hide the failed evidence.

The reusable lane still installs frozen dependencies, builds the minimum protocol workspace,
runs installer helper tests, downloads the exact source artifact, and executes the full silent
install, launch, reinstall, restore, shutdown, uninstall, and user-data preservation lifecycle.

GitHub's `Re-run failed jobs` always uses the original commit and workflow. Use it for an external
or transient failure. A verifier code fix requires a new commit; automatic artifact reuse applies
that new verifier to the old immutable candidate while binding both SHAs and the source run.
