# CLAUDE.md

Pi-67 Desktop —— 面向 Windows x64 与 macOS Apple Silicon 的 Pi-first Electron 桌面客户端。

本文件是 Claude Code 的入口速查。**权威规则以下列文档为准，本文件不复制其内容，只做导航与高频命令**。

## 权威文档（改动前必读）

| 文档 | 负责范围 |
|------|---------|
| `AGENTS.md` | 产品与架构硬边界、安全隐私红线（**最高优先级**） |
| `PRODUCT.md` | 产品意图与非目标 |
| `DESIGN.md` / `DESIGN.dark.md` | 视觉、交互与 token 真源 |
| `CONTRIBUTING.md` | 工程规则与本地门禁清单 |
| `docs/architecture/processes-and-protocol.md` | 进程与协议责任划分 |
| `docs/adr/` | 关键架构决策记录 |

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

- `@earendil-works/pi-coding-agent` 是唯一 agent runtime；**不加** Pi RPC adapter、系统 `pi` 回退或其他 provider。
- renderer **不得**导入 Electron、Node、Pi SDK 或文件系统 API；保持 `contextIsolation`、sandbox、严格 CSP 与窄 preload 桥。
- 生产渲染资源经 `app://pi67` 加载；**不加** localhost server、业务 WebSocket、RPC adapter。
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
corepack pnpm run test:e2e                 # Playwright（先 build）
```

## 环境与验证

- Node `24.18.0`、pnpm `11.16.0`、TypeScript 7 strict、精确依赖版本 + 冻结 lockfile。
- protocol、策略、恢复、Pi SDK 与可见 UI 变化必须补 targeted tests；**不能从源码推断运行态质量**。
- Windows 结论需真实 Windows 证据，macOS 结论需真实 Apple Silicon 证据；浏览器预览不能证明打包后的 Electron 行为。
