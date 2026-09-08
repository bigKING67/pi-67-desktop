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

TypeScript、浏览器预览、真实 Electron、真实平台和安装包证据必须分别报告，不能互相替代。

## Git 与发布

只暂存任务相关文件。`commit` 不等于 `push`；push、签名、notarization、GitHub
Release 和发布更新元数据都需要当前明确授权。不要 amend、force push、改写历史或
回滚无关 WIP。
