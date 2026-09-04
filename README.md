<p align="center">
  <img src="./docs/assets/67-logo.webp" width="112" alt="67 Logo">
</p>

<h1 align="center">π · Pi-67 Desktop</h1>

<p align="center">
  <strong>让 Pi 成为可看、可控、可恢复的桌面工作台。</strong>
</p>

<p align="center">
  基于真实 Pi SDK 的本地优先桌面客户端<br>
  Alpha · Windows x64 · macOS Apple Silicon
</p>

<p align="center">
  <a href="https://github.com/bigKING67/pi-67-desktop/releases"><strong>下载 Alpha Preview</strong></a>
  ·
  <a href="./PRODUCT.md">产品说明</a>
  ·
  <a href="./CONTRIBUTING.md">参与开发</a>
</p>

---

`π` 是 Pi / pi-67 的图形化桌面客户端。它复用用户已有的 Pi 配置、Provider、
模型、Skills、Prompts、Extensions 和 JSONL Sessions，在一个安静、清晰的工作台中
完成对话、编码、Tool 调用、任务切换与故障恢复。

应用显示名称使用 `π`；`Pi-67 Desktop` 继续作为仓库、包、可执行文件、URL scheme
和安装产物的技术身份。

> [!WARNING]
> 项目仍处于 Alpha 阶段。公开 Preview 未经过 Windows Authenticode、macOS
> Developer ID 签名或 Apple notarization。请只从本仓库的 Releases 下载，并按对应
> Release 提供的 manifest 或 `SHA256SUMS.txt` 核对文件身份。

## 核心能力

- **原生 Pi 体验**：直接使用 `@earendil-works/pi-coding-agent`，不依赖系统安装的
  `pi`，也不建立第二套 Agent Runtime。
- **统一工作台**：按 Workspace 管理对话、草稿与运行中的任务；切换会话时，已启动的
  Pi Runtime 可以继续在后台工作，最多允许 8 个任务处于运行或等待交互状态
  （`MAX_RUNNING_TASKS = 8`）。
- **过程可检查**：集中呈现流式响应、Tool Call、Queue、Session Tree、资源状态和
  Recorded Changes，不把中间状态藏进黑盒。
- **资源可复用**：继续使用同一个 Pi Agent Profile，以及其中的 Provider、模型、
  Skills、Prompts、Extensions 和 MCP 能力。
- **授权有边界**：Workspace trust、Tool approval、AUTO、YOLO 与 PLAN 各自保持明确
  语义；未知、漂移或无法唯一识别的能力会失败关闭。
- **恢复不猜测**：Pi JSONL 始终是会话真源；Desktop 索引可以重建，进程重启不会静默
  重放未经确认的 Prompt 或副作用。

## 支持平台

| 平台 | 系统 | 安装产物 |
| --- | --- | --- |
| Windows x64 | Windows 10 22H2 / Windows 11 | NSIS `.exe` |
| macOS arm64 | macOS 12+ · Apple Silicon | `.dmg` / `.zip` |

暂不构建 Windows x86/ARM64、macOS Intel/Universal 或 Linux 版本。公开 Preview 与
内部日常候选是两条独立分发链路；内部候选可能比 GitHub Releases 更新。

- [查看公开 Alpha Preview](https://github.com/bigKING67/pi-67-desktop/releases)
- [内部候选分发说明](./docs/release/internal-candidate-distribution.md)
- [签名与平台验证边界](./docs/release/signing.md)

## 架构原则

Pi 是唯一 Agent Runtime 和 agentic-loop 权威，Pi JSONL 是唯一会话真源。Desktop
负责图形界面、精确 Tool 暴露、授权、执行生命周期、原生平台能力、安全与恢复。

```text
Sandboxed React Renderer
          │ typed protocol
          ▼
     Electron Main ───── native windows / dialogs / storage
          │ MessagePort
          ▼
Agent Host utility process
          │
          ▼
       Pi SDK ─────────── Pi JSONL Sessions
```

生产 Renderer 通过 `app://pi67` 加载，并保持 `contextIsolation`、sandbox 和严格 CSP；
项目不运行本地 HTTP Server、业务 WebSocket、Pi RPC Adapter 或另一套模型路由器。

完整设计见[进程与协议架构](./docs/architecture/processes-and-protocol.md)和
[Pi SDK 兼容合同](./docs/compatibility/pi-sdk.md)。

## 本地开发

前置条件：Node.js `24.18.0` 与 Corepack。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run check
corepack pnpm run build
corepack pnpm run dev
```

`dev` 会构建 packages、Electron Main、Preload 和 Agent Host，再启动 Vite 与真实
Electron。单独预览 Renderer 不能证明 utility process、`app://pi67`、原生对话框或
进程清理正确。

跨模块、高风险和候选交付以 `corepack pnpm run check` 作为聚合源码门禁；安装包、
目标操作系统和人工交互仍需要各自独立验证。

## 文档

| 主题 | 文档 |
| --- | --- |
| 产品定位与非目标 | [`PRODUCT.md`](./PRODUCT.md) |
| 视觉与交互 | [`DESIGN.md`](./DESIGN.md) · [`DESIGN.dark.md`](./DESIGN.dark.md) |
| 工程与安全合同 | [`AGENTS.md`](./AGENTS.md) |
| 进程与协议 | [`docs/architecture/processes-and-protocol.md`](./docs/architecture/processes-and-protocol.md) |
| 测试、覆盖率与性能 | [`docs/testing/`](./docs/testing/) |
| 开发与贡献 | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |
| 安全报告 | [`SECURITY.md`](./SECURITY.md) |

## 致谢

`π` 建立在开源社区长期积累的工作之上。特别感谢以下项目及其作者：

- [**Pi**](https://github.com/earendil-works/pi)（earendil-works）— 提供本项目使用的
  Agent Runtime、SDK、Session、Extension、Model、Provider 与 Tool 语义。
- [**pi-gui**](https://github.com/minghinmatthewlam/pi-gui)（Matthew Lam）— 为桌面产品、
  交互、UI、Runtime 生命周期、恢复与工程质量提供了重要的综合参考。
- [**t3code**](https://github.com/pingdotgg/t3code)（T3 Tools Inc.）— 为产品交互、
  Harness、任务编排、生命周期、恢复与工程实践提供了重要的综合参考。

Pi-67 Desktop 会固定具体 commit 进行研究，并依照自己的 Product、Protocol、安全与
平台合同重新实现选定机制；这些项目不是本仓库的 merge upstream、Submodule 或自动
源码同步源。完整审阅记录、许可证与来源说明见
[External Reference Governance](./docs/provenance/external-references.md)和
[Third-Party Notices](./THIRD_PARTY_NOTICES.md)。

<p align="center">
  <sub>Built by <a href="https://github.com/bigKING67">67</a>.</sub>
</p>
