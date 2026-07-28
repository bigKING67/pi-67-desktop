# π

`π` 是面向 Pi / pi-67 的本地优先桌面客户端。它保留 Pi 的配置、
模型、Skills、Prompts、Extensions 和 JSONL 会话语义，用图形界面提供会话树、
流式消息、立即纠偏、完成后执行、回滚、压缩和常见 extension 交互。

应用显示名称和图标使用 `π` 品牌；`Pi-67 Desktop` 继续作为仓库、包、可执行
文件、URL scheme、安装产物和 Release 的技术身份，避免破坏已有升级与分发合同。

当前仓库处于 alpha 实施阶段。GitHub Releases 可以提供明确标记的 unsigned
preview 安装包；正式稳定渠道仍要求 Windows Authenticode、macOS Developer ID
签名和 Apple notarization。

## 支持范围

只构建以下三种产物：

- Windows 10 22H2 / Windows 11 x64：NSIS `.exe`
- macOS 12+ Apple Silicon arm64：`.dmg` 和 `.zip`

不构建 Windows x86/ARM64、macOS Intel/Universal 或 Linux 版本。

## 下载 Alpha Preview

公开下载入口：

```text
https://github.com/bigKING67/pi-67-desktop/releases
```

Unsigned Preview 只提供：

- Windows x64：`Pi-67-Desktop-<version>-win-x64-unsigned-preview.exe`
- macOS Apple Silicon：`Pi-67-Desktop-<version>-mac-arm64-unsigned-preview.dmg`
- macOS Apple Silicon：`Pi-67-Desktop-<version>-mac-arm64-unsigned-preview.zip`

这些 preview 不包含稳定自动更新 metadata，并且没有 Windows publisher、macOS
Developer ID 或 Apple notarization。Windows SmartScreen 可能要求通过“更多信息”继续；
macOS 可以在 Finder 中右键选择“打开”，或在“系统设置 -> 隐私与安全性”中允许。
如果 Gatekeeper 仍阻止从本仓库下载且已经核对 SHA-256 的应用，可以在拖入
`/Applications` 后执行：

```bash
xattr -dr com.apple.quarantine "/Applications/Pi-67 Desktop.app"
```

下载后应使用同一 Release 中的 `SHA256SUMS.txt` 或
`unsigned-preview-manifest.json` 核对文件身份。

打包的 Unsigned Preview 只在用户点击“检查更新”后请求公开 GitHub prerelease
元数据，并验证目标版本同时包含上述三种安装包、`SHA256SUMS.txt` 和 manifest。
发现新版本后，应用只会在再次确认后打开该版本的 GitHub Release 页面；不会请求
`latest.yml` / `latest-mac.yml`，也不会在应用内下载、后台下载或退出安装。

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

## Protocol v2 与运行模型

跨进程控制面使用同仓 clean-break 的 Protocol v2：

- `hello` / `welcome` 协商 `appInstanceId`、`hostInstanceId`、`hostEpoch`、事件序列和消息上限；
- 每个 command、response 和 event 都有 TypeBox schema；Session/Operation 事件还交叉校验 envelope 与
  payload authority，错误使用稳定 code，而不是解析报错字符串；
- `prompt.submit`、extension command、compact 和 session import 先返回
  `accepted + operationId`，业务执行不受通用 30 秒请求超时约束；
- Agent Host 关闭、`messageerror` 或 epoch 更换会立即终止旧 pending request，旧响应不能覆盖新状态；
- 应用退出由 Main 异步 gate：Host 先关闭 admission、清理 Queue/交互请求、尝试 abort active Operation
  并 dispose Pi Runtime；超过有界 deadline 才强制 kill，退出期间不会再重启 Host 或 broker 新 Port；
- Renderer 检测到 event sequence 缺口后停止猜测状态，只通过 `projection.resync` 恢复；
- Host 侧 scheduler 管理 control、turn、queue、interrupt 和 query lane，Renderer 的禁用状态不是并发保护边界。
- Extension Catalog 独立于会话快照，过滤 Desktop 内部 hidden extension，并按 command、tool、
  shared UI 与 TUI custom surface 展示保守兼容性；证据不足明确显示为未知。
- Session Catalog 通过 `session.catalog.query` 提供 revision-bound keyset 分页和服务端搜索；
  changed event 只做失效通知，`projection.resync` 只恢复 Catalog status，不回传全量 Session。

日常更新使用 `conversation.changed`、`queue.changed`、`session.metaChanged`、
`tree.changed` 和 `usage.changed` 等窄事件。初始/恢复状态通过受控 bootstrap 或
resync 取得；消息默认只投影最近 100 条并按稳定 cursor 向前分页，会话树采用有界 flat
projection。Agent Host 在 Session bind 时只做一次全量 SDK entry read，Catalog metadata、
usage、branch cursor、tree、Conversation page 和 Recorded Changes 共享可丢弃的内存索引，
后续 entry 通过事件增量维护。完整限制见 `docs/architecture/processes-and-protocol.md`。

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

`check` 包含按 package 划分的 branch coverage 回归门禁；完整 inventory、当前 floor、
长期目标和 Electron/E2E 证据边界见 `docs/testing/coverage.md`。

`pnpm run dev` 会先构建 packages/Main/Preload/Agent Host，然后启动 Vite 与真实
Electron。仅预览 renderer 不能证明 utility process、`app://`、原生标题栏、文件
对话框或进程清理正确。

在当前受支持的原生平台上，可以生成明确不带签名的 CI 冒烟包并验证 packaged runtime：

```bash
corepack pnpm run package:native:unsigned
corepack pnpm run package:smoke
```

该入口只接受 Windows x64 或 macOS arm64，会清除签名环境变量并拒绝交叉平台构建。
它验证目标平台原生依赖、隔离 user-data、`app://pi67`、主题持久化、sandbox、按需
Agent Host，以及活跃受控 Extension command 关闭时的 `session_shutdown(reason="quit")`、
child process / utility process 回收和五秒关闭预算；但不生成可发布的签名产物。

可重复性能测量会构建当前平台的 unsigned unpacked application，并把本机报告写入 ignored 的
`artifacts/performance/`：

```bash
PI67_PERF_SAMPLES=10 corepack pnpm run performance:measure
```

预算、测量定义和证据边界见 `docs/testing/performance.md`。

## 目录

```text
apps/
  agent-host/       Protocol server、command scheduler、Operation registry 与恢复边界
  desktop/          Electron Main、Preload、窗口、app scheme、Host supervisor 与系统能力
  renderer/         React 产品界面、Connection Controller、增量投影和 feature UI
packages/
  domain/           无运行时依赖的策略与视图模型
  protocol/         Protocol v2 envelope、逐消息 schema 和 Port client
  extension-compat/ 声明式 Extension Adapter manifest、校验与 immutable registry
  pi-runtime/       AgentRuntime port、PiSdkRuntime、extension UI 与安全扩展
eng/
  dev/              本地开发编排
  packaging/        品牌图标、平台签名权限与可复现图标生成
  quality/          架构、目录和生产 transport 门禁
  release/          产物 manifest 与 SHA-256 验证
```

Renderer 的 Raw `AgentPortClient` 只由 `connection/AgentConnectionController.ts` 持有；
feature controller 发出 typed request，Zustand 只接收 typed domain events，不再保存转发 MessagePort
request 的 action facade。宽 `SessionSnapshot` 在 Renderer 边界拆分：
`conversationStore` 持有 settled message pages/cursors/Virtuoso anchor，`liveTurnStore` 持有
Operation-scoped text/thinking chunks，`extensionUiStore` 持有 Extension request/status/widget/
compatibility/Catalog/title，`approvalStore` 持有 Safety Approval request；两者在 Host 或 Session
authority 失效时统一清理。App Store 不再保存 messages、message page、streaming 字符串、
Extension UI、Approval、Workspace Changes 或 Session view 副本。`workspaceChangesStore` 独占有界修改投影、
同步状态和 `toolCallId` 索引，独立 controller 负责 transport 与延迟响应失效。App Store 不再保存
Session ID、generation、projection revision 或 authority phase 的镜像；`sessionProjectionStore` 按 identity、
model/provider controls、queue、resources 和 usage 保存稳定分组引用；control response 只更新命令拥有且
请求期间未被更晚增量事件推进的分组，不能用迟到 full snapshot 回滚 Queue 或 Usage。`sessionTreeStore`
独占 flat tree、同步状态和请求 revision，
独立 controller 合并并发 dirty signal，且只接受当前 Host/Session/generation 的 response。
Session authority 由 `session/session-authority.ts` 和 `sessionProjectionStore` 绑定 Host epoch、Session ID、
generation 与本地 projection revision；`renderer-session-transaction` 统一使 Conversation、Live Turn、Changes、Approval、
Extension UI 和 Catalog request target 失效。Session/Host/resync transaction 之后的旧 event、成功响应和
rejection 均不能写回。Pi 在 bootstrap 前发送的 Extension Catalog 只做 revision-bound 暂存，必须与随后
bootstrap 的 Session ID/generation 精确匹配，不能把未知 generation 当通配符。
Snapshot 安装采用单 authority 两阶段提交：先把 canonical Session authority 置为 inactive，逐项安装并校验
Conversation、Tree、Changes 和 Catalog，最后才提交 active authority；subscriber 重入或新 transaction 推进
revision 后，旧安装立即停止，且不得通过失败清理覆盖更新状态。
Session view 通过 `session/session-projection-selectors.ts` 消费；Transcript、Navigation、Trust、Composer、
Context、Credential、TitleBar 和 Command Palette 不再订阅 App Store 的 Session 数据。Usage、Queue、
Resource 或 Model 更新只替换对应分组引用，不会
触发这些 surface 的宽重渲染。`sessionCatalogStore` 只管理分页投影和请求状态，独立 Controller
负责 `session.catalog.query`、stale cursor 重载和延迟结果失效；Store 不持有 transport。样式基础位于 `styles/`，
feature-specific CSS Module 与组件同目录。Electron Main 的
scheme、window policy、Agent Host supervisor 和 system bridge 分文件维护，不再集中在单一入口文件。

当前 Alpha 已有有界 Tool Presentation Registry、运行状态栏、响应式导航/上下文抽屉、
Session 搜索、Queue 查看与原子清空，以及 Pi Session Recorded Changes Inspector。后者只展示
当前活动分支中可验证的 `edit`/`write` 记录：`edit` 可展示有界 Patch，`write` 不伪造写入前版本；
	它不是完整 Git/workspace Diff。声明式 Extension Adapter Registry v1 已接通 Catalog、Command
	Palette 和 Tool Card；当前 source-pinned built-ins 覆盖 `pi-rewind@0.5.0` 的 `/rewind`，以及
	`@feniix/pi-sequential-thinking@5.0.3` 的八个静态 Tool surface
	命令元数据。它的快捷键/TUI surface 仍明确标记为 `partial`，shared `ctx.ui` caller attribution
	仍不可用；不得据此宣称完整 Extension UI 已兼容。文件预览、完整
Diff、Queue 逐条编辑和 asset handle 仍是后续能力。Session 导航
已经使用 disposable metadata-only SQLite Catalog：Pi JSONL 仍是唯一真源，SQLite 不保存
Prompt、Assistant、Thinking、Tool payload、源码、Patch、图片或 transcript，也不提供 FTS。

产品、视觉与运行时边界分别由 `PRODUCT.md`、`DESIGN.md` / `DESIGN.dark.md`、
`AGENTS.md` 和 `docs/architecture/processes-and-protocol.md` 管理。

## 当前证据边界

源码存在、类型检查或浏览器截图不等于安装包可发布。Windows x64 结论必须来自真实
Windows 10/11 运行证据；macOS 结论必须来自 Apple Silicon 上的真实 Electron 和
打包产物。签名、notarization、安装/升级/卸载、长会话性能和 extension 兼容性均按
`docs/testing/performance.md` 与 `docs/release/signing.md` 单独验收。
