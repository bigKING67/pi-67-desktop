# Processes and protocol

## Process topology

```text
Electron Main
  |- BrowserWindow
  |    `- sandboxed renderer (React, app://pi67)
  |          `- AgentPortClient
  `- utilityProcess: Agent Host
         `- PiSdkRuntime
              `- @earendil-works/pi-coding-agent
```

Main 创建 `MessageChannelMain`，把一端交给 Agent Host，另一端经 Preload 转给 renderer。
Agent 消息不经过 IPC invoke、HTTP 或 WebSocket。Preload 的 invoke API 只用于文件夹选择、
诊断保存、通知、外部链接和更新等系统能力。

## Responsibility boundaries

- `packages/domain`：无运行时依赖的策略、状态和 renderer-facing view。
- `packages/protocol`：command/event/response envelope、schema 验证和请求相关性。
- `packages/pi-runtime`：Pi SDK 适配、session/resource/model、stream batch、extension UI、
  project trust 和一次性批准。
- `apps/agent-host`：protocol command router、错误脱敏和 runtime 生命周期。
- `apps/desktop`：窗口、Preload、`app://`、utility process、更新与原生对话框。
- `apps/renderer`：产品 UI；不读取文件、凭据或 Pi SDK。

依赖方向由 `eng/quality/check-architecture.mjs` 检查，并包含循环依赖检测。

## Startup and recovery

1. Main 注册 secure `app` scheme 并创建窗口；Welcome 不启动 Agent Host。
2. 用户选定 workspace 或运行依赖 Agent Host 的 Doctor 后，renderer 通过窄 IPC 请求按需启动。
3. Agent Host `spawn` 后，Main 转移新的 MessagePort；窗口 reload 的 `did-finish-load` 也会重连已有 host。
4. renderer 在模块加载时接收并缓存端口，React 挂载后建立 `AgentPortClient`。
5. 用户选定 workspace 后发送 `runtime.initialize`，此时才动态加载 Pi SDK。
6. Agent Host 在 60 秒内最多自动重启三次，退避为 0.5/1/2 秒。
7. 新端口到达时 renderer 关闭旧 client，并用当前 workspace、trust、approval mode 和
   session path 重新初始化。

恢复不是成功声明：只有 `runtime.ready` 和新的 `SessionSnapshot` 到达后 UI 才显示 ready。

## Protocol

所有 envelope 使用 `protocolVersion: 1`：

- command：`messageId`、`requestId`、timestamp、typed command/payload；
- response：复用 `requestId`，返回 data 或 redacted structured error；
- event：可选 sessionId/sequence 和 typed event/payload。

Agent Host 对不可信 renderer 消息先执行 TypeBox envelope validation。命令 payload 的
业务边界由 command handler 和 Pi SDK 再校验。图片仅允许 PNG、JPEG、WebP 和 GIF，
最多 8 张、单张最多 10 MiB、总计最多 30 MiB；每个 `data` 必须是当前 Agent Host
realm 的 `ArrayBuffer`。ArrayBuffer 图片通过 transfer list 移交，
避免复制。

Pi SDK session events 不做通用深拷贝或 raw payload 转发。Streaming 只投影 renderer 实际
消费的 `text_delta` / `thinking_delta`；其他 session delta 只跨端口发送 event type，完整状态
通过受控 `SessionSnapshot` 重建。

## Streaming and sessions

Pi JSONL 是会话真源。UI snapshot 是可重建视图，不得回写私有 session 格式。Streaming
delta 在 Agent Host 内批处理，renderer transcript 使用 variable-height virtualization。
检测到非 Desktop writer 修改当前 session 时，写入前停止并要求重载；不支持并发 writer。

## Extension UI

`select`、`confirm`、`input`、`editor`、notify、status 和文本 widget 映射到可访问的 React
UI。`ctx.ui.custom()`、component widget/footer/header/editor 和 TUI autocomplete 不允许
注入 renderer，必须报告 `tui-only` 或抛出明确兼容错误。
