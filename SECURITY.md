# Security Policy

## Supported versions

当前没有公开支持版本。报告问题时请提供准确 commit、平台、架构和最小复现，不要
附带真实凭据、私有 Prompt、源码正文或原始 session。

## 信任边界

- renderer 运行于 `sandbox: true`、`contextIsolation: true`、
  `nodeIntegration: false`，只获得窄化 Preload API 和一个 MessagePort。
- renderer CSP 仅为 Shiki 的 Oniguruma engine 开放 `'wasm-unsafe-eval'`，并只允许
  same-origin module worker 承载语法高亮；不开放 JavaScript `'unsafe-eval'`、inline
  script、远程 script/worker 或 extension script 注入。
- Pi SDK 只在 Agent Host utility process 内运行；Main 负责窗口、原生对话框、更新、
  外部链接确认和 Agent Host 生命周期。
- 生产资源只从 `app://pi67` 加载，不启动本地 HTTP Server，不监听应用 TCP 端口，
  不使用业务 WebSocket。
- 所有 protocol envelope 都包含固定协议版本并在 Agent Host 边界验证。
- Extension 不得向 renderer 注入 HTML、JavaScript 或 React component；TUI-only UI
  必须明确失败。

## 数据边界

默认日志、诊断和应用投影不得保存或发送：

- API key、OAuth token、cookie、密码或 credential payload；
- Prompt、源码正文或原始 tool payload；
- 用户 Pi JSONL session 内容；
- 与当前工作区无关的路径或文件。

Pi 的 AuthStorage 和 JSONL session 保持真源。诊断导出由用户明确触发，限制为 1 MB，
在 Agent Host 和 Main 两层脱敏后写入用户选择的位置。
Agent Host 的原始 stderr 默认丢弃；只有开发者显式设置
`PI67_DEBUG_AGENT_STDERR=1` 时才输出经过截断和脱敏的 stderr，发布构建不得启用该开关。

Renderer localStorage 仅允许保存非敏感的 `pi67.themePreference` 外观偏好。API key、
OAuth token、prompt、source、tool payload、workspace path 和 session 内容不得写入
localStorage、sessionStorage 或 IndexedDB。

## 项目信任与一次性批准

项目信任决定项目级资源是否可加载，不等于 Tool 批准或操作系统 sandbox；未信任
Workspace 阻止 Tool 执行。受信任 Workspace 默认 AUTO（`balanced`）：已分类的有界
Workspace 读写、本地检查、常用项目脚本、Workspace 内依赖变更、非破坏性本地 Git，
以及已验证只读 Web Tool，可按策略执行。AUTO 无法可靠分类的 Shell 返回纠正结果。

启用且内容已准入的 Package/MCP 能力，其有效 Tool 身份唯一时构成 AUTO 授权，覆盖该能力
已注册的外部路径、系统、上传、认证、发布、依赖或远端副作用；仅加载资源不构成此授权。
AUTO 在此能力授权及明确只读例外之外的外部、系统与 Workspace 外操作仍需单次批准。
明确只读例外包括规范化 Workspace 读取、能力检查、已验证只读 Web，以及当前 Session 的
Pi ResourceLoader 已加载的 Skill 目录内 read/search/list，以及其他已加载资源的精确规范
文件 read/search（不扩大为目录 list）；它不授予写入或
任意 home 目录访问。可信 YOLO 自动执行其他有效注册
Tool，但不会使无效身份、schema、路由或目标有效；ASK 保留上述只读免批范围，其余动作单次批准；PLAN 保持只读。

已识别的文件、持久状态、外部对象、Shell 或破坏性 Git 删除，在 AUTO 能力授权和 YOLO
之前都必须经过精确目标的一次性硬确认，不持久化为永久允许。完整行为与资源读取例外见
[产品安全合同](PRODUCT.md)和[进程协议](docs/architecture/processes-and-protocol.md)；这些是
Pi-67 产品行为，不授予开发代理发布或操作外部系统的权限。

HTTP/HTTPS transcript 链接会显示完整目标，并在每次交给系统浏览器前确认。其他 scheme
直接拒绝。

## 报告

启用私有安全报告渠道后，请使用该渠道。不要在公开 issue 中粘贴 credential、session、
Prompt、源码、日志或诊断 bundle。
