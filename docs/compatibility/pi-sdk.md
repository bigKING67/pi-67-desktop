# Pi SDK compatibility

## Locked contract

当前唯一支持版本：

```text
@earendil-works/pi-coding-agent 0.81.1
@earendil-works/pi-agent-core   0.81.1
@earendil-works/pi-ai           0.81.1
@earendil-works/pi-tui          0.81.1 (transitive override)
```

根依赖和 `pnpm-workspace.yaml#overrides` 双重固定，避免上游内部 caret dependency 在重新
安装时漂移。不得使用 `^`、`~` 或 latest tag。

`eng/release/pi-runtime-contract.mjs` 从 `packages/pi-runtime/package.json` 读取版本并验证三个
Pi suite 直接依赖与 workspace overrides 完整一致。Release manifest、artifact verify 和
unsigned preview 共用该 contract，不维护另一份运行时版本常量。

## Desktop coverage

已实现的 SDK seam：

- `createAgentSession`、`SessionManager.create/open/list/listAll`，以及基于相同
  JSONL contract 的 collision-safe managed import；
- accepted prompt Operation、steer、follow-up、abort；
- 最近 100 条 bootstrap、稳定 entry cursor 分页、有界 flat session tree 和增量 projection；
- model list/select、thinking levels；
- session tree navigation、新文件 branch、rollback、compact、name；
- Skills、Prompts、Extensions、AGENTS/SYSTEM 上下文发现与 reload；
- 图片输入、stream events、token/cost/context snapshot；
- common extension UI bridge 和 Desktop safety inline extension。
- 独立的有界 Extension Catalog：过滤 hidden 内部扩展，使用 Pi 已解析的 invocation name，
  并按命令、工具、共享 UI primitive 与 TUI custom surface 保守报告兼容性；
- 声明式 Extension Adapter Registry v1：只在 Pi resolved package `baseDir/package.json`
  证明 package name 与 canonical installed SemVer、Registry version range 匹配，并且命令/工具
  确实出现在 Pi 最终 resolved runtime surface 时投影 Adapter 元数据；
- Adapter 命令元数据进入 Command Palette；工具元数据在 `tool_execution_start` 按
  `toolCallId` 和 Session generation 固化，结束后进入有界 settled attribution，再由
  Transcript 选择声明式 Tool presenter。Adapter 不携带或执行 HTML、JavaScript、CSS、
  React component 或 Renderer module；
- Queue 查看与 Pi SDK `clearQueue()` 的原子清空。
- `SessionManager.list/listAll` 仅用于后台 Catalog reconcile；日常 Session 导航使用
  metadata-only SQLite keyset page、revision invalidation 和安全 SDK fallback。
- 活动 Session 使用 bounded JSONL tail 对账：文件/目录 watcher 只标记 dirty，实际判断依赖
  identity、offset、strict UTF-8、完整 JSON record 和当前 `SessionManager` entries。Pi 自写 append
  被吸收，外部 append/truncate/replace/unavailable/invalid 会锁死后续 mutation 并在活跃 turn 中
  请求 abort；跨进程事件不携带 Session path。
- 当前活动分支中 `edit` / `write` Tool 事实的有界 Recorded Changes projection；`edit` 可恢复
  Pi Tool Result 的 Patch，`write` 只提供输入 byte/line metrics。
- 绑定 Pi `toolCallId` 的结构化单次 Safety Approval；用户 Extension 修改 Tool input 后，
  inline Desktop Safety Extension 最后分类并 fail closed。

## Explicit limitations

- 不支持 `ctx.ui.custom()` 或 TUI component widget/footer/header/editor；
- TUI autocomplete 不会替换 Desktop composer；
- SDK 当前未向 UI bridge 提供稳定的 calling extension identity，因此 capability 明确声明
  `attribution: none`。Desktop 不猜测或伪造 extension ID；可证明的 package/path identity
  才会进入兼容状态；
- Extension Adapter Registry 已接通命令和工具 projection，runtime capability 返回
  `adapterRegistry.available: true`、`manifestSchemaVersions: [1]` 和真实
	  `activeAdapterCount`。当前 production built-in inventory 包含 source-pinned
	  `pi-rewind@0.5.0` `/rewind` command metadata，以及
	  `@feniix/pi-sequential-thinking@5.0.3` 的八个静态 Tool surface。Rewind 的快捷键和所有
	  shared UI attribution 仍保守报告，Sequential Thinking 的写入类工具也保持 generic；这些
	  Adapter 都不构成完整 Extension UI 兼容证据。新增 built-in 必须通过
	  `createExtensionAdapterConformanceInventory()`，记录 canonical package、精确 installed SemVer、
	  npm sha512 integrity、license、canonical HTTPS source repository、完整 Git object id、
	  repository-relative source path 和实际观察到的 command/tool surface。Manifest 声明必须是该
	  source-pinned surface 的子集；
- `realtimeUiAttribution` 仍为 `false`，shared `ctx.ui` primitive 继续使用 truthful generic
  `Pi extension` 标签。Adapter command/tool attribution 不能外推成 shared UI caller attribution；
- 应用重启后，历史 JSONL 没有 package attribution 的 Tool Call 继续使用 built-in/generic
  presenter；Desktop 不会仅按当前同名工具猜测历史归属；
- Catalog 中的 `unknown` 表示 SDK 没有足够证据，不等于失败，也不等于已证明 headless。
  命令可调用或工具可执行不代表 shared `ctx.ui` 已具备 package attribution；
- Session transition、resource reload、abort、timeout 和 runtime dispose 会取消 pending
  extension request；`ctx.ui.custom()` 等 TUI-only 能力不会把 HTML、JavaScript 或 React
  component 注入 renderer；
- 不支持同一 JSONL session 的并发 Desktop/TUI writer；watcher 只检测并止损，不把外部 JSONL
  entry 合并进当前 `SessionManager`、Conversation projection 或 Renderer；
- Pi SDK `0.81.1` 的 cold Session discovery 会临时构造 `firstMessage/allMessagesText`；Desktop
  立即丢弃这些字段，既不持久化也不跨进程传输。Catalog 不做 FTS、transcript index 或 Prompt
  派生名称，cold reconcile 的时间和 RSS 仍需按平台持续测量；
- 不实现 system Pi/RPC session import adapter。当前 agent directory 内的已
  managed session 通过 `SessionManager.list/open` 原地恢复；文件选择器中的
  外部 Pi JSONL 会先以不覆盖同名文件的方式复制到当前 workspace session
  directory，再打开副本。源文件保持只读且不会成为 Desktop 的后续 writer。副本只在 Pi
  Session switch 尚未生效时因失败而清理；一旦新 Session 已成为 Runtime authority，即使后续
  Catalog 更新失败也保留 managed copy，Host 通过 bootstrap 把实际 writer authority 投影给
  Renderer，不能删除正在使用的副本或继续展示旧 Session。Renderer 缺失 Bootstrap 时只做一次
  bounded projection resync，不会重放 import；若 Host 连权威 Snapshot 都无法构建，则 Runtime 标记为
  poisoned 并由 Main Supervisor 替换 utility process。
- Session Snapshot 和 Message Page 不再携带图片 data URL。支持的 PNG/JPEG/WebP/GIF 图片投影为
  Session-generation-bound `AssetReference`，Renderer 在图片实际挂载时通过 `asset.read` 以最多
  1 MiB chunk 读取 transferable `ArrayBuffer` 并生成 Blob URL。单图片上限 10 MiB，Host handle
  最多 512 项、decoded cache 最多 64 MiB；Session/Host generation 变化后旧 handle fail closed。
  不支持的格式、损坏内容或超过边界的图片显示明确占位。
- Recorded Changes 不是完整 Git/workspace Diff。`write` Tool Result 不包含写入前版本，Bash
  和未知 Extension Tool 也没有可证明的文件变化结构，因此 Desktop 不为这些情况猜测 Diff。

## Upgrade procedure

1. 固定一个候选 Pi commit/package version，阅读 SDK、extension 和 session 变更；
2. 同时更新三个直接包和 `@earendil-works/pi-tui` override；
3. 运行 `eng/release/pi-runtime-contract.test.mjs`、protocol/policy/runtime contract tests、
   typecheck、build 和真实模型 smoke；
4. 单独验证常用 extensions 的 common UI 与 TUI-only 失败行为；
5. 在 Windows x64 与 macOS arm64 复测 session 恢复、abort、process exit 和打包；
6. 证据通过后再更新本文件和 release notes。

TypeScript 7 对部分上游 declaration 的检查存在实验期兼容问题，因此本仓库启用
`skipLibCheck` 只跳过第三方 `.d.ts` 内部检查；所有仓库源码仍使用 strict、
`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`。
