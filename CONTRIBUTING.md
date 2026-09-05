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

先跑与修改最相关的测试，再扩大到完整门禁。TypeScript、浏览器预览、真实 Electron、
真实平台和安装包证据必须分别报告，不能互相替代。

## Git 与发布

只暂存任务相关文件。`commit` 不等于 `push`；push、签名、notarization、GitHub
Release 和发布更新元数据都需要当前明确授权。不要 amend、force push、改写历史或
回滚无关 WIP。
