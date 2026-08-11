# π

`π` 是面向 Pi / pi-67 的本地优先桌面客户端。它保留 Pi 的配置、
模型、Skills、Prompts、Extensions 和 JSONL 会话语义，用图形界面提供会话树、
流式消息、立即纠偏、完成后执行、回滚、压缩和常见 extension 交互。

应用显示名称和图标使用 `π` 品牌；`Pi-67 Desktop` 继续作为仓库、包、可执行
文件、URL scheme、安装产物和 Release 的技术身份，避免破坏已有升级与分发合同。

工作台不使用水平任务标签。左栏按 Workspace 分组显示活动任务、草稿和最近
Session，点击会话直接切换中央工作面；最多八个真正运行或等待输入的 Pi Runtime
（统一合同 `MAX_RUNNING_TASKS = 8`）
可以在切换会话后继续后台运行，普通 Session 历史由可重建 Catalog 分页承载。

当前仓库处于 alpha 实施阶段。日常开发候选不提交到 Git，也不默认创建 GitHub
Release：Windows x64 EXE、macOS arm64 DMG 和 ZIP 在完成对应 packaged smoke 后，
通过内部飞书目录分发并在目标系统人工测试。完整流程见
[`docs/release/internal-candidate-distribution.md`](docs/release/internal-candidate-distribution.md)。
只有另行明确授权时才进入公开 GitHub Release；正式稳定渠道仍要求 Windows
Authenticode、macOS Developer ID 签名和 Apple notarization。

## 支持范围

只构建以下三种产物：

- Windows 10 22H2 / Windows 11 x64：NSIS `.exe`
- macOS 12+ Apple Silicon arm64：`.dmg` 和 `.zip`

不构建 Windows x86/ARM64、macOS Intel/Universal 或 Linux 版本。

## 内部 Alpha 候选

内部测试只分发三个带精确版本的文件：

- Windows x64：`Pi-67-Desktop-<version>-win-x64.exe`
- macOS Apple Silicon：`Pi-67-Desktop-<version>-mac-arm64.dmg`
- macOS Apple Silicon：`Pi-67-Desktop-<version>-mac-arm64.zip`

GitHub Actions 可以作为 Windows x64 的临时构建和验证环境，但 Actions artifact
不是内部产品下载入口。测试者从配置在仓库外的飞书目录获取候选；飞书凭据和目录
token 不进入仓库。内部候选上传、真机测试完成后默认停止，不自动创建 Tag、Release
或 promotion。

## 公开 Alpha Preview

只有已经另行授权并实际创建 GitHub prerelease 时，公开下载入口才是：

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

- 唯一 Agent runtime：`@earendil-works/pi-coding-agent@0.83.0`
- 不实现 Pi RPC Adapter，也不依赖系统安装的 `pi`
- Pi SDK 运行在 Electron Agent Host utility process，不进入 renderer
- Welcome 不预启动 Agent Host；选择工作区或运行 Doctor 时按需启动，随后才动态加载 Pi SDK
- Pi JSONL 会话是真源；桌面索引只能是可丢弃投影
- Workspace 注册以 canonical path 加文件系统物理身份校验；仅有 path-only 证据时，重启后必须由原生目录选择器重新确认，不能仅凭相同路径恢复信任
- Pi 配置、Context Markdown 和 Workspace 文件保存共享同目录临时文件、file fsync 与 atomic replace；Windows 只对 `EACCES` / `EPERM` / `EBUSY` 做有界重试
- 新建对话先进入离线可写的 Renderer Intent；只有首条消息发送时才 exactly-once 创建 Pi JSONL，再在精确 Session authority 下提交 Prompt。创建失败保留草稿；创建成功但 Prompt 失败不会再次创建 Session
- Composer 非空文本和 `streamBehavior` 由 Electron Main 使用 `safeStorage` 加密持久化；附件 staging handle 不跨重启，安全存储不可用时不写明文
- 后台/隐藏会话完成、失败或等待交互时可发原生系统通知；Main 使用固定隐私文案，点击按 opaque Workspace/Session identity 返回精确会话，不显示 Prompt、源码、Tool 结果、错误详情或绝对路径
- 第三方 Pi Package 只有在匹配 Pi-67 已知内容基线，或 Desktop durable 安装/用户确认 receipt 与当前 bounded directory/manifest/content observation 一致时才进入 Runtime；待确认、内容变更、结果不明或检查超限都不会加载，也不会触发 Pi 的隐式安装。确认操作只绑定当前已安装 bytes，不下载、不重装
- 默认 Package 保持有界：除第一方 capability 外，内置并离线激活完整锁定闭包的 `pi-mcp-adapter@2.11.0` 与 `pi-observational-memory@3.0.3`，客户端不运行 npm；两者默认启用，Observational Memory 预留 Desktop-owned durable opt-out（当前没有完成显式开关 UI），不改共享 Pi settings，也不删除既有 memory 数据
- `tmwd_browser` 与 `js-reverse` 由 Desktop 使用私有 Node 注册到当前 Pi Agent Profile 的 `mcp.json`；同名用户自定义项不覆盖，browser67 revision/spec 更新时只定向失效这两项 `mcp-cache.json` metadata，不影响其他 MCP server cache
- Plan Mode 与 Search 已改为 Pi SDK 第一方能力，不依赖 Extension Package。`/plan` 与 `/default` 是 Desktop-owned action；Plan Markdown 以 Pi JSONL 为真源，点击开始执行时 Renderer 只提交 `planId + submissionId`
- `web_search`、`source_check`、`fetch_content`、`get_search_content` 由 Pi-67 原生注册：Web Search 没有用户开关或持久化偏好，由模型按任务自行决定是否调用；`web_search` 只按所选模型声明的协议原生路由执行。无路由、无凭据或 Provider 请求失败都会显式失败，不切换 Provider，也不回退 Exa、Tavily、MCP 或 Search Extension。UI 的“原生搜索 · 已声明”不是 live verification
- Desktop 已退休 Team MCP/Tavily Bridge：不再打包资源、提供设置页、保存/显示 Token 或向 Agent Host 注入环境。启动时只移除完全匹配旧 Desktop-owned identity 的 `mcp.json` entry 与旧 userData token；用户自定义或其他 MCP 配置保持不变
- 内置 `Groland` 是一个 Provider、一个 Credential、七个图片+推理模型：五个 Claude 走 Anthropic Messages/x-api-key，两个 GPT 走 OpenAI Responses/Bearer。DeepSeek 继续走 Pi 官方 Provider，目前仅 `deepseek-v4-flash` 声明原生搜索；它复用同一个 Pi API Key 调用官方 Responses `/responses`，并接收 `in_progress` / `searching` / `completed` 流式搜索状态
- `@narumitw/pi-plan-mode`、`pi-web-access`、`pi-smart-fetch`、`pi-subagents` 的既有用户配置不会被自动删除或改写，但 Desktop Task 不再加载；Settings 会显示原生替代并保留显式卸载入口
- Settings 的 `办公 -> 飞书` 用两个页内 Tab 分开身份流程：`用户授权` 在前并默认选中，负责通过 `lark-cli` Device Flow 登录/重新授权，以访问云空间、日历、消息、任务、邮箱等用户资源；缺少有效应用时会明确引导到第二个 `应用配置` Tab。应用配置支持查看和编辑 App ID，并在当前草稿中显隐核对 App Secret；Agent Host 只通过 stdin 将一次性密钥交给本机 `lark-cli`，保存后 Desktop 不回读或复制明文。`needs_refresh` 表示下一次用户 API 调用会自动续期，不等于必须重新授权。用户 Token 由 `lark-cli` 保存，Device Code 只留在 Agent Host 内存，已保存 App Secret、Token、Device Code、open_id 和完整 scope 不进入 Pi JSONL、持久化、诊断、默认日志或模型上下文。身份显示已连接不代表某个具体飞书 API 已完成实测
- `known-baseline-observed`、`user-approved-observed` 与 `user-installed-observed` 都不是签名或供应链 provenance；当前内容 hash 排除 `.git`/`node_modules`。Package Worker 只隔离安装/update/uninstall，不隔离第三方 Extension import、hook、Tool、UI 或 MCP child
- 后续只跟踪 `pi-gui` 与 `t3code` 两个综合参考源。两者的产品、功能、交互、UI、设计、
  架构、Harness、runtime lifecycle、恢复、测试与工程质量都可选择性吸收；`pi-gui` 是
  当前主力基线，但不是排他权威，`t3code` 也不局限于 Harness
- 所有吸收都固定 commit 并按 Pi-67 合同重新实现；两者都不是 merge upstream、Git Remote、
  Submodule 或自动源码同步源。Pi 仍是唯一 Runtime 与行为规范源

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

## Protocol v4 与运行模型

跨进程控制面使用同仓 clean-break 的 Protocol v4：

- `hello` / `welcome` 协商 `appInstanceId`、`hostInstanceId`、`hostEpoch`、事件序列和消息上限；
- 每个 command、response 和 event 都有 TypeBox schema；Session/Operation 事件还交叉校验 envelope 与
  payload authority，错误使用稳定 code，而不是解析报错字符串；
- `prompt.submit`、extension command、compact 和 session import 先返回
  `accepted + operationId`，业务执行不受通用 30 秒请求超时约束；
- 上述副作用 Operation 在进入 Pi 前先把 caller-stable submission fingerprint、Operation ID 和物理
  Session authority 写入私有 durable receipt；replacement Host 将未确认的 accepted/running receipt
  恢复为同一 Operation ID 的 `lost`，只返回收据而不重放 Prompt、command、compact 或 import；
- Agent Host 关闭、`messageerror` 或 epoch 更换会立即终止旧 pending request，旧响应不能覆盖新状态；
- 应用退出由 Main 异步 gate：Host 先关闭 admission、清理 Queue/交互请求、尝试 abort active Operation
  并 dispose Pi Runtime；超过有界 deadline 才强制 kill，退出期间不会再重启 Host 或 broker 新 Port；
- Renderer 检测到 event sequence 缺口后停止猜测状态，只通过 `projection.resync` 恢复；
- Host 侧 scheduler 管理 control、turn、queue、interrupt 和 query lane，Renderer 的禁用状态不是并发保护边界。
- Extension Catalog 独立于会话快照，过滤 Desktop 内部 hidden extension，并按 command、tool、
  shared UI 与 TUI custom surface 展示保守兼容性；证据不足明确显示为未知。
- Session Catalog 通过 `session.catalog.query` 提供 revision-bound keyset 分页和服务端搜索；
  changed event 只做失效通知，`projection.resync` 只恢复 Catalog status，不回传全量 Session。Pi JSONL
  的 exact creation marker 和 header/path 负责证明 Session 已创建；Catalog 只补标题、时间、搜索和排序，
  不门控已知 Session 的打开或创建恢复。Catalog schema v3 以 opaque 物理 JSONL identity 为主键，path
  只是唯一 locator；同一物理文件的 alias 更新一行，相同 Session ID 的不同物理 JSONL 仍保持独立。
- Renderer 和 Workbench v4 使用 `workspaceId + sessionFileIdentity` 作为正式会话实体键；`sessionId`
  用于 Pi 业务校验，path 只用于显示和打开。Catalog 不会把 provisional 猜成正式 Session，也不门控
  Runtime recovery 持久化。旧 v3 的 path-keyed 正式恢复记录会 fail closed 到 Workspace surface；带稳定
  `creationId` 的 provisional creation recovery 会保留。
- Session 创建副作用由私有 Durable Creation Journal 约束：`creationId` 在调用 Pi 前依次持久化
  `reserved` / `materializing`，exact marker 与物理 JSONL 身份确认后进入 `materialized`，权威 bootstrap
  构建完成后进入 `published`。`materializing` 且无 exact marker 的重启状态一律标记为 `ambiguous`，
  不会再次调用 `newSession()`；Journal 丢失时可从 exact marker 重建，且从不保存 Prompt、源码或凭据。
- Session writer authority 同时使用 Host 内 registry 与 `<storageRoot>/session-writer-leases-v1` 跨进程锁。
  未创建路径先锁定物理 parent + 精确 leaf；JSONL 物化后在仍持有 provisional fence 时 rekey 到
  `device + inode + birthtime` 物理身份。只有 Runtime dispose 成功后才释放 lease；heartbeat compromised
  会触发 Host replacement。owner metadata 只保存 Host/epoch/PID 与 identity hash，不保存 Session path、
  Workspace path、Prompt、源码或凭据。

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

macOS Apple Silicon 本地视觉验收可以使用一键预览入口：

```bash
corepack pnpm run preview:mac:unsigned
```

它会依次退出仍在运行的 `Pi-67 Desktop`、重新生成 unsigned 包、运行 packaged smoke，
然后只在所有步骤通过后打开仓库内的最新 `.app`。成功输出包含 `app.asar` 的修改时间、
大小和 SHA-256，避免 `open` 只激活仍在内存中的旧 Renderer。

可重复性能测量会构建当前平台的 unsigned unpacked application，并把本机报告写入 ignored 的
`artifacts/performance/`：

```bash
PI67_PERF_SAMPLES=10 corepack pnpm run performance:measure
```

每周原生性能认证还会运行 `100 MiB / 100,000 records` 的真实文件 Session JSONL
工作负载。`500 MiB / 100,000 records` 仅允许显式启用，不进入普通 PR 验证：

```bash
PI67_PERF_LARGE_SESSION_PROFILE=standard corepack pnpm run performance:large-session
PI67_PERF_LARGE_SESSION_PROFILE=extended corepack pnpm run performance:large-session
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
  protocol/         Protocol v4 envelope、逐消息 schema 和 Port client
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
Catalog 继续使用 `BEGIN IMMEDIATE` + DELETE journal；在 WAL main/sidecar 的隔离、恢复和 Windows
锁定合同被独立验证前，不把未经证明的 WAL 切换并入 identity schema 变更。

产品、视觉与运行时边界分别由 `PRODUCT.md`、`DESIGN.md` / `DESIGN.dark.md`、
`AGENTS.md` 和 `docs/architecture/processes-and-protocol.md` 管理。

## 当前证据边界

源码存在、类型检查或浏览器截图不等于安装包可发布。Windows x64 结论必须来自真实
Windows 10/11 运行证据；macOS 结论必须来自 Apple Silicon 上的真实 Electron 和
打包产物。签名、notarization、安装/升级/卸载、长会话性能和 extension 兼容性均按
`docs/testing/performance.md` 与 `docs/release/signing.md` 单独验收。
