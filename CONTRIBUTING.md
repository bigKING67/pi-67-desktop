# Contributing

## Authority

开始修改前先阅读：

1. `AGENTS.md`：产品和架构硬边界；
2. `PRODUCT.md`：产品意图和非目标；
3. `DESIGN.md` / `DESIGN.dark.md`：视觉、交互和 token 真源；
4. `docs/architecture/processes-and-protocol.md`：进程与协议责任。

行为、视觉 token 或交互改变时，必须在同一改动中更新对应 authority 文档。

## 工程规则

- 使用精确依赖版本；Pi 三个核心包保持同一版本，并由 `pnpm-workspace.yaml`
  overrides 固定传递依赖。
- renderer 不得导入 Electron、Node、Pi SDK 或文件系统 API。
- 不增加 localhost Server、业务 WebSocket、RPC Adapter、多 Provider 或第二个 Pi runtime。
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
