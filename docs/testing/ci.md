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
| Documentation only (excluding developer-governance paths, gate-consumed Markdown, and Markdown under `apps/` or `packages/`) | Skipped | Skipped | Skipped |
| Reviewed quality-only paths, including Markdown the source gate parses or requires | Required | Skipped | Skipped |
| Windows-only paths | Required | Required | Skipped |
| macOS-only paths | Required | Skipped | Required |
| Installer verifier allowlist | Reuse lane; if unavailable, quality + Renderer and Windows fallback | Certified base artifact reuse or normal Windows lane | Skipped |
| Shared, dependency, workflow, unknown or unavailable diff | Required | Required | Required |

Path allowlists live in the classifier and its dedicated scope modules, not a duplicate glob list
in this document. New entries need caller/boundary evidence and mixed/unknown-path regressions.
Quality-only still executes the complete source gate; it is not partial unit-test coverage.
The quality lane also runs `pnpm run test:python-workers`: the stdlib-only authorization tests
(account and asset filtering) for the bundled Python team workers. Tests that need the packaged
`openviking`/`httpx` runtime run only with the native capability probes.

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
直接 `pnpm test`、`test:coverage` 或 `check` 未设置 worker 数时使用 Vitest 默认并发；
复现完整源码 CI 时使用固定 2 workers 的 `check:source`。该入口调用原有 `check`，
不减少测试、改变超时/覆盖率阈值或增加重试。真实 Git/文件系统用例在默认并发下
超时、定向运行通过时，保留首次失败证据，再使用 `check:source` 核对完整门禁；
不能仅凭定向通过宣称全量通过，也不能仅凭固定并发通过认定产品性能问题已修复。

打包 smoke 输出固定阶段名、结果和耗时，不记录操作结果或错误正文。
`PI67_PACKAGED_SMOKE_VISIBLE_WINDOW=1` 只作用于普通 smoke 和任务恢复夹具，复用已有
可见但不接收鼠标、跳过任务栏并失焦的隔离窗口分支；默认及本机行为仍隐藏窗口。
Windows CI 仅在三项任务恢复步骤显式启用该模式，回执记录 `windowMode`；原始完整
packaged smoke 保持隐藏窗口，继续覆盖已观测到的隐藏状态关闭失败。两轮同包
隐藏→可见→隐藏对照已结束，重复步骤移除。切换恢复夹具不删除断言、提高超时或
增加重试；该步骤的实际节时仍以目标 Windows 的新回执和计时为准。
普通 packaged smoke 还必须从 Main 的完整报告确认 Renderer checkpoint 和 Host graceful
shutdown：强制终止、超期、缺失报告或缺失 graceful/forced 字段均失败，不能仅凭 PID
退出和 Pi callback 记录报告关闭成功。既有 3 秒 Main、5 秒产品退出预算不变。

Host 配置集成夹具按消息到达等待关联响应，先匹配 request ID 再校验完整协议，
避免反复解析历史大模型目录阻塞文件 I/O。产品的配置文件访问预算仍为 4 秒。
Codemode 的原生超时包含 Worker/WASM 启动：真实时钟用例验证启动/死循环退出和后续
脚本可用；部分输出用例先以合成 MCP 子调用确认输出已越过 Worker 通道，再推进受控
时钟触发同一个原生 deadline，检查部分输出、子调用取消和输出不落盘。

中断任务的 macOS arm64 / Windows x64 打包验收使用
`corepack pnpm run package:smoke:task-recovery -- <scenario>`，每次只接受一个场景：
`agent-before-response`、`app-after-tool` 或 `agent-unconfirmed-tool`。
它只使用独占临时 Profile、进程内模拟模型及禁止联网的 Provider；检查同一 JSONL、
一次 Auto 判断、已记录工具不重复执行，以及未记录工具结果阻止一键续接。
场景会让测试 Agent 自行退出，或终止已核对身份的测试 Main；不得指向用户 Profile。
每次保留绑定 ASAR SHA-256 的结果/失败回执，确认自有进程退出后才清理夹具，并检查
用户标准 Session 目录没有变化。无自动重试；失败需定位后单独重跑。该入口不包含
真实 Provider 或外部副作用的 exactly-once 认证。Windows 进程身份使用精确 PID 的
CIM 创建时间与可执行文件路径；查询失败、身份变化或无法确认退出时保留夹具并失败，
不按应用名结束进程。回执包含平台、架构、源码 HEAD/dirty 状态与 CI run/attempt。
Windows 查询先在启动 Electron 前预检，使用与现有安装器探针一致的 15 秒有界
PowerShell 时限；查询超时不能解释为进程已退出。启动后即保留自有应用句柄，
身份查询失败仍尝试正常关闭；清理异常必须保留原始失败和最终回执。
普通 CI 的两平台 native job 和 Windows candidate 的 build job 在常规 packaged smoke
后各执行三个独立步骤，并始终上传隔离验收证据。新增入口和本机通过不代表 Windows
已通过，必须读取该平台精确构建的实际回执。
普通 CI 打包成功后，后续相互隔离的 smoke、恢复、Windows UI 与安装器检查即使前一项
失败也继续执行；打包失败或任务取消则不启动。任一步失败仍使 native job 和最终门禁
失败，不采用 `continue-on-error`，后续证据不把失败构建变成候选资格。
Windows smoke 失败证据在 smoke 返回后立即上传，Windows UI 报告在 UI 步骤返回后上传，
均不再等待后续 NSIS 检查；原有产物名称、路径、条件和保留期不变。恢复和安装器继续
各自保留证据，提前上传不改变最终门禁或失败候选的资格。
Windows synthetic-scale/IME 夹具在首条 Prompt 前等待可见的 Runtime ready、明确 failed 或
New Session Intent surface，仍使用 60 秒上限；单独 stopped、starting 或空白不能放行，failed
优先报错。合法 Intent 按产品合同等待首条消息才启动 Pi；夹具随后必须通过受控模型、
运行中的 Operation、真实子进程以及原有缩放/输入法/5 秒退出断言，不能用 Intent 代替
Runtime 成功。回执记录 `initialSessionSurface`，失败诊断记录 `newSessionIntentVisible`。
受控 Prompt 失败也保留初始化/界面阶段；Provider 与子进程可选记录最多 64 条固定字段
生命周期观察，不记录模型输入。Windows UI 失败时在关闭应用前保存观察快照、子进程
存活状态与截图；关闭导致的 abort/exit 不能反推为失败原因。
冷启动用崩溃前的精确侧栏 Session identity 打开原对话；不假定导航选中状态已在
强制退出前落盘。该场景明确经过工作区首页，验证从侧栏续接；身份含分隔字符，
必须按属性值完整比较，不能拼入 CSS selector。失败取证使用本次启动的新窗口。
恢复按钮可能在自动 bootstrap 过程中被替换；2 秒点击超时后仅当 Runtime 已就绪，或
明确处于 starting/recovering 时继续观察，不重复点击。后者仍须在原有 45 秒上限内达到
ready 并通过原 Session/工具结果验收；按钮超时且没有打开中的状态、驱动错误和持续不就绪
均失败，不能把 bootstrap 进行中当作恢复成功。
页面 DOM 加载仍限 30 秒。恢复夹具在窗口隔离前监听 Main 的加载/渲染退出事件；失败时
保留最多 32 条事件及丢弃计数、相对时间、窗口/PID、加载状态和 app/blank/other 分类，
不记录原始 URL、错误正文或路径。Main 诊断与 Renderer 协议读取各限 2 秒，失败截图和正文读取各限 5 秒；
这些是失败取证预算，不放宽启动验收。仅补诊断不能宣称已修复空白窗口超时。

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

The explicit test capture mode (`NODE_ENV=test`, `PI67_TEST_CAPTURE_AGENT_INIT=1`) also captures
bounded `prompt.submit` acknowledgement stages from validated Host receipt through runtime admission,
accepted-ledger reconciliation/write and response posting. At most 64 requests and 16 fixed stage records
per request are emitted, with launch-local sequence and elapsed milliseconds only. Main projects an
allowlist; it does not forward payloads, paths, errors or credentials. The installer failure report retains
the latest 64 records with a dropped count in `real-user-launch-failure.json`, separate from the truncated
summary error. No stage changes the existing 5-second Prompt ACK deadline or durable-before-ACK contract.
`response-posted` proves the Host port write returned; it does not prove Renderer receipt. Instrumentation
alone is not evidence that a Windows timeout is repaired.

The isolated shutdown capture additionally splits terminal receipt persistence into fixed
directory, lock, read, temporary-file open/write/sync/close, replace, directory-sync and unlock
phases. Only settlement uses these observations, so normal acceptance/read transactions do not
consume the bounded shutdown record budget. It preserves locking, fsync, atomic replacement and
the original error; records contain no paths, receipt identities or contents. A started phase
without completion narrows the pending boundary but does not identify the underlying OS cause.

Keep source checks, browser E2E, native Electron, packaged smoke, installer certification and manual acceptance
as separate evidence. Report missing evidence explicitly. Report settings, cache keys, concurrency and thresholds
must be changed with their consumers and boundary tests; preserve unknown-input fallback and release authorization.

## Windows installer verifier-only changes

Changes limited to the Windows installer verifier allowlist may reuse an installer candidate
from the exact base commit instead of rebuilding Electron and NSIS. Documentation may accompany
the verifier change without disabling reuse.

The allowlist includes the real-user Provider configuration verifier, failure diagnostics,
lifecycle report modules and their tests. Changes to packaged application code still disable
this reuse path. Provider configuration clicks the configured tab once, then waits for its
selected state within the existing shared 10-second budget before checking the seeded Provider
and persisted credential. Failures retain a fixed substep name and allowlisted assertion code,
never raw driver error bodies; a generic historical failure cannot prove which assertion failed.
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

Ordinary native CI passes `--ci-fast` to the unsigned packager. On Windows this
uses stored NSIS payloads and disables differential packaging: electron-builder
otherwise overrides `compression=store` with normal compression and creates an
unused blockmap. The real NSIS install/uninstall and selected quick/full lifecycle
checks remain required. On macOS it builds the unpacked `.app` with `--dir`, which
is the artifact consumed by native smoke and all three recovery scenarios.
Neither fast artifact certifies distribution containers or differential updates.
Candidate, preview and release flows retain DMG/ZIP and normal NSIS/update output;
they must not opt into ordinary CI's fast packaging.

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

`Windows candidate` prefers the exact retained Actions artifact for its previous-version upgrade baseline.
When that one artifact is missing or expired, preflight may select `immutable-update` only for an exact
reviewed record in `eng/release/windows-candidate-baselines.json`. The workflow then downloads the pinned
versioned installer from the fixed update origin with redirects disabled and verifies exact length and
SHA-256 before setting the same lifecycle input. Duplicate or non-expired empty Actions artifacts and any
catalog, identity, receipt, manifest, origin, size, or hash drift fail closed. The alternate transport changes
only baseline acquisition; it does not skip or shorten the full installer lifecycle and is not target-Windows
manual acceptance.

The packaged Runtime asset assertion uses the contract of the version currently installed, including the
versioned native clipboard module and capability layout paths. Cross-version certification checks the legacy
clipboard package plus the legacy `pi67-core` and observational-memory capability paths for Alpha.40; Alpha.41
and later use the Pi TUI native module and unified `pi-workspace-resources` capability path. It must not apply
the current candidate's dependency layout to the previous-version baseline or skip either asset check.

The installed Settings assertion also uses the contract of the version currently installed. The retained
Alpha.40 artifact exposes the exact accessible name `π 设置`; Alpha.41 and later expose `New Money 设置`.
Cross-version certification must select that exact name by installed version, retain the complete Settings
layout and navigation assertions, and fail closed instead of accepting an arbitrary Settings surface.

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
