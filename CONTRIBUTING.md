# Contributing

## Authority

开始修改前先阅读 `AGENTS.md`，再按其 `Reading and authority` 路由读取本次涉及的
产品、设计、进程协议或架构决策章节。不要求每次修改全文读取全部权威文档；范围或
引用合同不清楚时，先扩展阅读再修改。

行为、视觉 token 或交互改变时，必须在同一改动中更新对应 authority 文档。

## 工程规则

- 使用精确依赖版本；Pi 三个核心包保持同一版本，并由 `pnpm-workspace.yaml`
  overrides 固定传递依赖。
- renderer 不得导入 Electron、Node、Pi SDK 或文件系统 API。
- 不增加 Pi RPC Adapter、业务 WebSocket 或第二个 Pi runtime。生产环境不增加 localhost
  Server；开发时 Vite 仅用于 `127.0.0.1` 上的资源和 HMR。
- 内置和自定义 Provider 通过 Pi 支持的机制接入，以 Pi 配置为真源；不增加非 Pi Provider
  adapter、独立 Provider 配置真源或第二套模型路由。
- 跨进程消息先在 `packages/protocol` 定义并验证，再实现调用方。
- protocol、策略、恢复和 extension UI 变化必须增加 targeted tests。
- 不创建 `utils`、`helpers`、`common`、`misc`、`legacy` 等兜底目录。
- 不提交 build/installer 输出、日志、数据库、截图、trace、用户 session 或凭据。

## 工程入口与职责

| 需要回答的问题 | 维护位置 |
| --- | --- |
| 产品、架构、授权和平台边界 | `AGENTS.md` 路由到产品、设计、协议与 ADR |
| 如何开发、选检查和交付 | 本文；专项细节链接到对应合同 |
| 哪种改动运行哪些验证 | `docs/testing/ci.md` 与 `eng/ci/` 分类器/聚合门禁 |
| 覆盖率的范围、排除理由、阈值 | `docs/testing/coverage.md` 与 `vitest.config.ts` |
| 产品性能预算和测量方法 | `docs/testing/performance.md` 与 `eng/performance/` |
| 候选、内部更新与正式发布 | `docs/release/` 各自操作合同 |
| 复杂变更计划与长期决策 | `PLANS.md`、`docs/plans/`、适用 ADR |

规则、配置和执行证据各有职责。规则规定合同，配置实现合同，运行结果证明具体版本是否通过。
计划、旧报告和一次成功不替代当前 Git、产物身份或目标平台证据。

## 日常命令选择

以下命令在仓库根目录运行；不是每次任务都必须执行完整列表。

| 场景 | 入口 | 证据边界 |
| --- | --- | --- |
| 开发应用 | `corepack pnpm run dev` | 开发环境，不能代替打包验收 |
| 局部 TS/逻辑改动 | 受影响包 `typecheck` + `pnpm exec vitest run <test-path>` | 定向验证，默认无覆盖率 |
| 复现完整源码 CI | `corepack pnpm run check:source` | 固定 worker 的完整源码门禁 |
| 仅覆盖率检查 | `corepack pnpm run test:coverage` | V8 覆盖率；并发说明见 CI 合同 |
| 构建源码 | `corepack pnpm run build` | 生成 packages/apps 的 dist，不含安装认证 |
| Renderer/组合 E2E | `corepack pnpm run test:e2e` | 先构建，再执行默认 Playwright 项目 |
| 仅原生 Electron E2E | 使用 CI 合同中的专用配置命令，先 `build` | 本机 Electron；不等于安装器验证 |
| 候选源码前置检查 | `corepack pnpm run check:candidate` | 含联网 freshness/审计，不构建或分发 |
| 本机 macOS 候选 | `corepack pnpm run preview:mac:unsigned` | 按候选合同打包、smoke 和打开预览 |
| Windows 调度参数预检 | `release:windows:preflight`，参数见候选合同 | 只读 metadata，不调度 workflow |

## 配置和测试的维护约定

新增 script、配置或 workflow 须说明真实调用方、职责、输入/输出、前置条件和验证方式。
先检查现有入口；重复实现可以合并，前置条件、外部副作用或证据等级不同的命令不能仅因名称相近合并。
共享代码至少有两个真实调用方；框架要求的配置继续放在约定位置，不作无收益目录迁移。

测试靠近所属模块；共享夹具明确资源所有权、等待期限和清理路径。优先事件/状态同步，
用于验证迟到事件或 debounce 的固定观察窗口须保留其行为目的。真实 Git、SQLite、进程等
重测试采用有依据的局部预算；禁止统一加大超时、用重试隐藏失败或降低覆盖率换取通过。
聚焦测试只用于本地诊断，CI 必须拒绝 `.only`。

分别测量产品性能、测试耗时和 CI 最长路径；记录源码、环境、样本和失败/重试。
并发、缓存或夹具优化应有前后对比；单次测量只证明该次结果，不声明长期 p95。
新增预算应先取得代表性基线，不能凭经验把目标写成已达成。

源码目录不接收生成声明、JS、日志或缓存；构建输出进入包的 `dist/`，测试和发布证据进入
已有 ignored 输出目录。发现泄漏先定位生成命令，保留证据，再修发射路径；不得用新增 ignore
规则掩盖源码污染。提交仅包含任务源码，生成文件和无关 WIP 保留在提交范围外。

## 本地门禁

以下为依赖安装及可用检查命令清单，并非每次任务都必须顺序执行。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test
corepack pnpm run check:architecture
corepack pnpm run check:dead-code
corepack pnpm run check:structure
corepack pnpm run check:production-transport
corepack pnpm run build
corepack pnpm run test:e2e
```

按 `AGENTS.md` 的 Validation routing 选择验证范围。先执行受影响包的检查和对应边界门禁；
跨模块、高风险、候选发布或影响不明时执行聚合 `corepack pnpm run check`。
输入未变且相关检查已通过时，仅因新失败、未解决疑点或明确门禁要求扩大或重复验证。

本地与 CI 的统一源码验证入口为 `corepack pnpm run check:source`：调用原有完整 `check`，
固定使用 2 个 Vitest worker，不改变断言、超时、覆盖率或测试范围。需要候选源码前置检查时，
运行 `corepack pnpm run check:candidate`；它依次检查生产依赖审计、能力来源可达性、freshness、
Extension Adapter provenance 和完整源码门禁，任一步失败立即停止。这两个入口都不打包、
调度 workflow、上传或发布；候选仍需 clean exact-SHA 源码及平台打包/人工验收证据。

验证分流、测试并发、重试、报告和原生入口见 [CI 验证合同](docs/testing/ci.md)。
覆盖率范围与阈值见 [覆盖率合同](docs/testing/coverage.md)，产品性能预算见
[性能合同](docs/testing/performance.md)。文档与配置发生漂移时应修复两者的不一致，
不得以当前实现覆盖约定，也不得仅修改文档把未验证行为写成已通过。

TypeScript、浏览器预览、真实 Electron、真实平台和安装包证据必须分别报告，不能互相替代。

## Git 与发布

只暂存任务相关文件。`commit` 不等于 `push`；push、签名、notarization、GitHub
Release 和发布更新元数据都需要当前明确授权。不要 amend、force push、改写历史或
回滚无关 WIP。
