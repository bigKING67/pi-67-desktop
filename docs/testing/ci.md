# CI validation routing

The ordinary `CI` workflow classifies the exact Git diff before selecting validation jobs.
Unknown, shared, dependency, or workflow changes fail closed to the full validation set.

## Validation matrix and authority

The classifier `eng/ci/classify-change-scope.mjs` selects scope; `.github/workflows/ci.yml`
executes it and `eng/ci/verify-ci-gate.mjs` requires every selected lane to succeed. A skipped
job is valid only when the selected scope permits it. Manual dispatch and unavailable/empty
base diffs retain conservative behavior; exact installer mode selection follows the sections below.

| Classified change | Source quality + Renderer E2E | Windows native | macOS native |
| --- | --- | --- | --- |
| Documentation only (excluding developer-governance paths) | Skipped | Skipped | Skipped |
| Reviewed quality-only paths | Required | Skipped | Skipped |
| Windows-only paths | Required | Required | Skipped |
| macOS-only paths | Required | Skipped | Required |
| Installer verifier allowlist | Reuse lane; if unavailable, quality + Renderer and Windows fallback | Certified base artifact reuse or normal Windows lane | Skipped |
| Shared, dependency, workflow, unknown or unavailable diff | Required | Required | Required |

Path allowlists live in the classifier and its dedicated scope modules, not a duplicate glob list
in this document. New entries need caller/boundary evidence and mixed/unknown-path regressions.
Quality-only still executes the complete source gate; it is not partial unit-test coverage.

## Test execution and reports

CI 的轻量单元测试分类使用 `eng/ci/classify-change-scope.mjs` 中的明确路径清单，
只纳入已核对的独立单元测试。`quality-only` 仍运行完整源码质量检查和 Renderer E2E，
省去两平台原生打包；未知测试、原生测试夹具、生产实现或混合改动保留原有验证范围。
新增清单成员前须核对调用关系，并保留未知路径及混合改动不能误入轻量分类的回归。

CI 显式禁止 Vitest/Playwright 的 `.only` 聚焦测试。Vitest 在 CI 同时输出终端、JSON 和
JUnit 结果；源码质量 job 无论成功失败都会尝试保留结果及覆盖率摘要。静态门禁先失败时
测试报告可能不存在，不能将缺失报告解释为测试通过。

仅运行原生 Electron 时使用以下命令；该配置复用原有断言、重试及证据设置，
移除 Vite webServer 和 HTTP baseURL：

```bash
pnpm exec playwright test --config=playwright.electron.config.ts --project=electron --workers=1
```

默认 `playwright.config.ts` 仍支持 Renderer 与完整组合测试。
Renderer CI 使用预构建资源、2 workers、0 retries；Electron CI 使用 1 worker、1 retry。
直接 `pnpm test` 使用 Vitest 默认并发，复现完整源码 CI 时使用固定 2 workers 的 `check:source`。

## Configuration and command ownership

| Configuration | Responsibility / consumers |
| --- | --- |
| `package.json` scripts | Stable command entrypoints; called by developers, workflows and other scripts |
| `pnpm-workspace.yaml`, lockfile, package manifests | Workspace membership, exact dependency constraints and frozen resolution |
| `tsconfig.base.json`, package/test tsconfigs | Shared TS checking contract and scoped inputs/output boundaries |
| `tsconfig.pi-runtime-build.json` | Repository-root declaration boundary for runtime builds; inherits runtime TS settings |
| `vitest.config.ts` | Unit/integration discovery, aliases, coverage and CI reports; no Electron claims |
| `playwright.config.ts` | Renderer bootstrap + browser projects and combined suite |
| `playwright.electron.config.ts` | Native-only entry inheriting shared checks, with no Vite server |
| `electron-builder.yml`, package build scripts | Product packaging and source build; native evidence remains separate |
| `eng/ci/` | Diff routing, reuse admission and final CI gate |
| `.github/workflows/` | Trigger, runner, permissions, concurrency, execution and artifact retention |

Script families were inspected against root/package manifests and workflow callers. Keep these roles distinct:

- `dev`, `build`, `build:packages`, `build:apps`: developer entry and build phases; filtered phases also serve CI.
- `typecheck`, `lint`, `test`, `test:coverage`, `test:e2e`: direct diagnostics with different execution scopes.
- `check:*`, `check`, `check:source`, `check:candidate`: individual checks, aggregate, fixed-worker wrapper,
  and network-aware candidate prerequisites. `check` remains compatible; it is not a redundant alias to remove.
- `prepare:*`, `verify:*`: preparation and validation used by packaging or CI; preparation does not certify output.
- `package:*`, `preview:*`, `certify:*`: packaging, smoke and target-platform certification; a smoke result does not authorize distribution.
- `performance:*`: product measurements and preparation; budgets belong to the performance contract.
- `eval:*`: offline evaluations or explicitly scoped live pilots; live commands may invoke external Providers and require their authorization.
- `release:*`, `support:*`: operator commands governed by the dedicated distribution/support contracts; prefixes do not imply read-only behavior.
- `audit:references`: upstream drift inspection; it does not update dependencies or prove compatibility.

Workflow responsibilities remain separate: ordinary `CI`; scheduled `Capability freshness`; external-reference
inspection; Extension Adapter provenance; performance certification; real Provider certification; reusable/manual
Windows installer debug; Windows candidate; unsigned preview promotion; signed release. They differ in inputs,
trust, cost or publication authority and should not be merged merely to reduce file count.

Current consolidation decisions: retain direct and aggregate checks; share native configuration by inheritance;
keep Renderer and Electron runner settings explicit; retain role-specific workflows. Existing runner setup is
repeated across platform jobs but checks platform-specific runtime identity; extracting it is a future measured
maintenance change, not a prerequisite for this documentation consolidation. No script was proven obsolete by
this inventory, and absence of an internal caller alone cannot prove an operator entry is unused.

## Failure triage and maintenance

Bind a failure to source SHA, workflow run/attempt, selected lane and failing step. Inspect the earliest failure
and its retained report before rerunning. Keep first-failure and retry evidence distinct. A source fix requires a
new SHA; a passed local test or a retry does not prove the original cause is resolved on the target runner.

Keep source checks, browser E2E, native Electron, packaged smoke, installer certification and manual acceptance
as separate evidence. Report missing evidence explicitly. Report settings, cache keys, concurrency and thresholds
must be changed with their consumers and boundary tests; preserve unknown-input fallback and release authorization.

## Windows installer verifier-only changes

Changes limited to the Windows installer verifier allowlist may reuse an installer candidate
from the exact base commit instead of rebuilding Electron and NSIS. Documentation may accompany
the verifier change without disabling reuse.

The allowlist includes the real-user failure diagnostics and lifecycle report modules and
their tests. Changes to packaged application code still disable this reuse path.
Lifecycle execution prints bounded stage names for installation, reinstall, launch, shutdown,
and uninstall. `summary.json` is replaced after each completed phase and each real-user launch
checkpoint; `progress` identifies the latest checkpoint, and `completedLaunches` preserves
finished launch evidence even if a later launch fails. These checkpoints do not set a passing
status: only completion of all required checks does. Report replacement is atomic within its
directory; abrupt runner loss may leave the latest checkpoint rather than a final result.

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

Both ordinary CI and the reusable installer lane use `pnpm/setup` pinned to a full commit SHA
with a `# v1` major-version annotation, plus explicit `pnpm 11.16.0` and `Node.js 24.18.0`
versions. This is the pnpm 11 native setup path; workflow
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

## Declaration emission boundary

With the pinned TS 7 / tsdown / rolldown-plugin-dts toolchain, the declaration generator uses
the directory containing its selected tsconfig as the emit root. Runtime resolves other workspace
packages through their source-type exports. A package-local emit root therefore excludes those
source dependencies; a runtime build reproduced stray declarations in `packages/protocol/src`.

`packages/pi-runtime` uses root `tsconfig.pi-runtime-build.json` for `build:runtime`. It inherits
its existing package settings and includes the same runtime sources, while putting cross-workspace
sources within the generator root. Intermediate declarations stay in the generator's temporary
directory and final JS/types stay in runtime `dist/`. Package typecheck, source exports and the
separate performance bundle keep their previous contracts. Do not move this build config into the
runtime package without revalidating the declaration boundary.

After compiler/bundler changes, run the real package and application builds and inspect the source
tree, not only the reported dist output. `check:structure` rejects a `.d.ts` next to its same-named
source `.ts` in apps/packages src. Handwritten ambient declarations without a corresponding `.ts`
remain allowed. The gate detects pollution; it does not delete files or hide them with ignore rules.
