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

Both ordinary CI and the reusable installer lane use `pnpm/setup@v1` with explicit
`pnpm 11.16.0` and `Node.js 24.18.0` versions. This is the pnpm 11 native setup path; workflow
commands call its standalone `pnpm` binary directly rather than invoking Corepack or installing
pnpm and Node through separate setup actions. CI verifies both the direct Node runtime and the
runtime resolved through `pnpm exec`. The pnpm store is not cached because a frozen install is
faster than restoring and saving the current store archive on the hosted runners.

The Windows native lane instead caches Electron and electron-builder download directories. These
contain versioned Electron and NSIS tool downloads rather than repository build output; the cache
key is bound to the lockfile and `electron-builder.yml`.

## Two-tier Windows installer certification

Ordinary CI selects an explicit `windows_installer_mode` from the exact product diff:

- `quick` verifies silent install, installed `app://` launch, runtime readiness, controlled process
  shutdown, silent uninstall, and isolated user-data preservation;
- `full` additionally verifies same-version reinstall, packaged executable identity, persisted theme,
  and restored startup state after reinstall.

Shared product and CI-only changes use the quick lane. Dependency changes, `electron-builder.yml`,
non-verifier packaging changes, and release/installer-debug workflow changes fail closed to the full
lane. Empty or unavailable diffs also select full certification.

The reusable verifier lane, `Windows candidate`, and signed Release workflow always execute the full
lifecycle. Unsigned preview promotion reuses the exact manually tested Windows candidate instead of
rebuilding it. A quick CI receipt is never sufficient evidence for a public Windows download. If a quick
lifecycle fails and a follow-up verifier-only commit can reuse its candidate, the reusable lane applies
the new verifier to that immutable candidate and executes the full lifecycle.

GitHub's `Re-run failed jobs` always uses the original commit and workflow. Use it for an external
or transient failure. A verifier code fix requires a new commit; automatic artifact reuse applies
that new verifier to the old immutable candidate while binding both SHAs and the source run.

## Packaged attachment footprint

Native packages keep all attachment-processing runtime paths while excluding payloads that the
Agent Host cannot execute. Packaging retains both Tesseract Node core families across scalar, SIMD,
and relaxed-SIMD hosts because the upstream worker may select either family at runtime. It excludes
only the browser-inline WASM copies that duplicate the external `.wasm` files used by Node. The
attachment worker copies only the bilingual `4.0.0` language data, so the unused `4.0.0_best_int`
copies are excluded. OfficeParser runs through its Node ESM wrapper, so its browser bundles are also
excluded.

The packaged smoke contract verifies both sides of this boundary: every required Node fallback and
language file must exist in `app.asar`, and every excluded duplicate/browser payload must be absent.
Source OCR tests continue to initialize the real worker with the repository-packaged language data.
