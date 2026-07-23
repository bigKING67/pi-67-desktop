# Pi-67 Desktop

Pi-67 Desktop 是面向 Pi / pi-67 的本地优先桌面客户端。它保留 Pi 的配置、
模型、Skills、Prompts、Extensions 和 JSONL 会话语义，用图形界面提供会话树、
流式消息、Steer、Follow-up、回滚、压缩和常见 extension 交互。

当前仓库处于 alpha 实施阶段，尚未发布签名安装包。

## 支持范围

只构建以下三种产物：

- Windows 10 22H2 / Windows 11 x64：NSIS `.exe`
- macOS 12+ Apple Silicon arm64：`.dmg` 和 `.zip`

不构建 Windows x86/ARM64、macOS Intel/Universal 或 Linux 版本。

## 运行时决策

- 唯一 Agent runtime：`@earendil-works/pi-coding-agent@0.81.1`
- 不实现 Pi RPC Adapter，也不依赖系统安装的 `pi`
- Pi SDK 运行在 Electron Agent Host utility process，不进入 renderer
- Welcome 不预启动 Agent Host；选择工作区或运行 Doctor 时按需启动，随后才动态加载 Pi SDK
- Pi JSONL 会话是真源；桌面索引只能是可丢弃投影
- Peak Code 只作固定版本的产品/交互参考，不作为 merge upstream

选择 SDK 而非 RPC 的原因是本项目本身使用 Node/TypeScript。SDK 可以直接使用
`AgentSession`、`SessionManager`、资源加载器和模型运行时，减少 JSONL RPC framing、
系统 Pi 发现、版本漂移和第二套进程恢复协议。架构决策见
`docs/adr/0001-electron-sdk-runtime.md`。

## 为什么生产环境没有本地 Server

生产 renderer 由 `app://pi67` 加载，renderer 与 Agent Host 通过 Electron
`MessagePort` 通信：

```text
Electron Main
  |- BrowserWindow -> app://pi67 -> sandboxed React renderer
  `- utilityProcess -> Pi SDK Agent Host
                         ^
                         `-- MessageChannelMain / MessagePort
```

因此生产环境不需要 localhost HTTP Server、监听端口或业务 WebSocket。这样可以：

- 删除端口分配、认证 token、CORS、CSRF 和端口冲突状态；
- 避免向同机其他进程暴露应用控制面；
- 让进程生命周期、背压和重连由 Electron 原生通道管理；
- 保持 renderer 无 Node、Electron、Pi SDK 和文件系统权限。

开发环境只允许 Vite 在 `127.0.0.1:5173` 提供静态资源和 HMR。

## 技术基线

- Electron `43.2.0`（Node `24.18.0` / Chromium `150.0.7871.129`）
- TypeScript `7.0.2`，strict + exact optional properties
- React `19.2.8` + React Compiler `1.0.0`
- Vite `8.1.5`
- pnpm `11.16.0`，精确依赖版本和冻结 lockfile
- Maple Mono `7.9` WOFF2，仅用于代码、工具、diff、路径和运行时元数据

TypeScript 7 的编译器性能是采用它的主要收益之一；它的 JavaScript compiler API
仍处于实验期，因此本仓库不依赖旧 TypeScript compiler API 的架构工具。架构边界由
`eng/quality/check-architecture.mjs` 直接检查，避免出现“0 modules 仍通过”的假绿结果。
`pnpm` 同时作为精确开发依赖存在，是因为 electron-builder 的 production module
collector 会启动裸 `pnpm list` 子进程；项目内 shim 避免本机 Corepack 未全局启用时
出现 `spawn pnpm ENOENT`。

## 开发

前置条件：与 `.node-version` 一致的 Node.js `24.18.0`，以及 Corepack。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run check
corepack pnpm run build
corepack pnpm run dev
```

`pnpm run dev` 会先构建 packages/Main/Preload/Agent Host，然后启动 Vite 与真实
Electron。仅预览 renderer 不能证明 utility process、`app://`、原生标题栏、文件
对话框或进程清理正确。

可重复性能测量会构建当前平台的 unsigned unpacked application，并把本机报告写入 ignored 的
`artifacts/performance/`：

```bash
PI67_PERF_SAMPLES=10 corepack pnpm run performance:measure
```

预算、测量定义和证据边界见 `docs/testing/performance.md`。

## 目录

```text
apps/
  agent-host/       Electron utility process 与命令路由
  desktop/          Electron Main、Preload、窗口、更新和系统能力
  renderer/         React 产品界面
packages/
  domain/           无运行时依赖的策略与视图模型
  protocol/         可验证的跨进程 command/event/response 合同
  pi-runtime/       AgentRuntime port、PiSdkRuntime、extension UI 与安全扩展
eng/
  dev/              本地开发编排
  packaging/        品牌图标、平台签名权限与可复现图标生成
  quality/          架构、目录和生产 transport 门禁
  release/          产物 manifest 与 SHA-256 验证
```

产品、视觉与运行时边界分别由 `PRODUCT.md`、`DESIGN.md` / `DESIGN.dark.md`、
`AGENTS.md` 和 `docs/architecture/processes-and-protocol.md` 管理。

## 当前证据边界

源码存在、类型检查或浏览器截图不等于安装包可发布。Windows x64 结论必须来自真实
Windows 10/11 运行证据；macOS 结论必须来自 Apple Silicon 上的真实 Electron 和
打包产物。签名、notarization、安装/升级/卸载、长会话性能和 extension 兼容性均按
`docs/testing/performance.md` 与 `docs/release/signing.md` 单独验收。
