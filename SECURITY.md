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

## 项目信任与一次性批准

项目信任只决定是否加载项目级 Skills、Prompts、Extensions 和上下文文件，不等于工具
批准或操作系统 sandbox。未信任工作区阻止工具执行；受信任工作区仍按 guided / balanced
策略处理写入、工作区外路径、破坏性命令、依赖变更、外部 Git 和网络副作用。高风险动作
只允许一次，不持久化“永久允许”。

HTTP/HTTPS transcript 链接会显示完整目标，并在每次交给系统浏览器前确认。其他 scheme
直接拒绝。

## 报告

启用私有安全报告渠道后，请使用该渠道。不要在公开 issue 中粘贴 credential、session、
Prompt、源码、日志或诊断 bundle。
