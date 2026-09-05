# CLAUDE.md

Pi-67 Desktop —— 面向 Windows x64 与 macOS Apple Silicon 的 Pi-first Electron 桌面客户端。

本文件是 Claude Code 的入口速查。权威规则以 `AGENTS.md` 及其指定文档为准；下列架构和红线仅作速查，不另立规则。

## 权威文档与按需读取

修改前先读 `AGENTS.md`，再按其 `Reading and authority` 路由读取本次涉及的权威章节；工程命令和贡献规则见 `CONTRIBUTING.md`。不要求每次修改全文读取所有产品、设计和架构文档；范围或引用合同不清楚时，先扩展阅读再修改。

> 行为、视觉 token 或交互变化时，必须在**同一改动**中更新对应 authority 文档。

## 架构速览

- **`packages/domain`** — 无依赖的策略与状态机
- **`packages/protocol`** — 校验过的跨进程命令与事件（跨进程消息先在此定义并验证，再实现调用方）
- **`packages/pi-runtime`** — `AgentRuntime` port、`PiSdkRuntime`、扩展 UI 桥
- **`packages/extension-compat`** — 扩展兼容适配
- **`apps/agent-host`** — utility-process 命令路由与恢复状态
- **`apps/desktop`** — Electron Main / Preload / 窗口 / 更新 / 生命周期
- **`apps/renderer`** — React 产品 UI 与设计系统实现

## 硬红线（详见 AGENTS.md）

- `@earendil-works/pi-coding-agent` 是唯一 agent runtime；**不加** Pi RPC adapter、系统 `pi` 回退或非 Pi Provider adapter。内置和自定义 Provider 通过 Pi 支持的机制接入，以 Pi 配置为真源，不另建 Runtime 或模型路由。
- renderer **不得**导入 Electron、Node、Pi SDK 或文件系统 API；保持 `contextIsolation`、sandbox、严格 CSP 与窄 preload 桥。
- 生产渲染资源经 `app://pi67` 加载；**不加**生产 localhost server、业务 WebSocket、Pi RPC adapter。开发时 Vite 仅用于 `127.0.0.1` 上的资源和 HMR。
- 不创建 `utils`/`helpers`/`common`/`misc`/`legacy` 等兜底目录（共享代码需两个真实调用方）。
- 不记录/持久化 API key、token、cookie、凭据、prompt、源码正文或原始 tool payload。
- 不提交 build/installer 输出、日志、数据库、截图、trace、用户 session 或凭据。
- `commit` ≠ `push`；push、签名、notarization、GitHub Release 均需当前明确授权。

## 常用命令

```bash
corepack pnpm install --frozen-lockfile   # 安装（冻结 lockfile）
corepack pnpm run dev                      # 开发（Vite HMR，仅资源用途）
corepack pnpm run build                    # 构建 packages + apps

# 门禁（先跑最相关的，再扩大）
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test                     # vitest；test:coverage 带覆盖率
corepack pnpm run check                    # 聚合门禁：typecheck+lint+架构/死代码/结构/传输检查+覆盖率
corepack pnpm run test:e2e                 # 脚本自动 build 后运行 Playwright
```

## 环境与验证

- Node `24.18.0`、pnpm `11.16.0`、TypeScript 7 strict、精确依赖版本 + 冻结 lockfile。
- protocol、策略、恢复、Pi SDK 与可见 UI 变化必须补 targeted tests；**不能从源码推断运行态质量**。
- Windows 结论需真实 Windows 证据，macOS 结论需真实 Apple Silicon 证据；浏览器预览不能证明打包后的 Electron 行为。
