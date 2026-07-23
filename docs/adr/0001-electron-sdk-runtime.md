# ADR 0001: Electron with an embedded Pi SDK runtime

- Status: Accepted
- Date: 2026-07-23

## Context

产品必须同时支持 Windows x64 和 macOS arm64，并尽可能完整地表达 Pi 的 SDK、资源、
session tree、streaming 和 extension 语义。候选方案是：

1. WinUI/WPF 原生 UI + Node/Pi sidecar；
2. Electron + 系统 `pi --mode rpc`；
3. Electron + 直接嵌入 Pi SDK。

原生 Windows UI 会引入第二种 UI 技术栈，但 Pi 仍需要 Node sidecar，且不能复用到
macOS。RPC 方案需要发现系统 Pi、处理版本漂移、严格 JSONL framing、stderr、崩溃和
子进程树，同时重复 SDK 已提供的 session/model/resource 抽象。

## Decision

采用 Electron + React + Node/TypeScript，并固定
`@earendil-works/pi-coding-agent@0.81.1` 作为唯一 runtime。

- Pi SDK 运行在 Electron utility process Agent Host；
- renderer 运行于 sandbox，只通过 MessagePort 使用版本化 protocol；
- Main 只负责桌面系统能力和进程生命周期；
- 生产 renderer 使用 `app://pi67`，不启动 localhost Server 或业务 WebSocket；
- 不实现 RPC Adapter、系统 Pi fallback 或非 Pi Provider；
- 上游升级先通过 Pi contract tests，再修改锁定版本。

## Consequences

收益：单一 TypeScript 能力栈、无跨语言 RPC、直接使用 AgentSession、平台 UI 复用、
更少的网络攻击面和部署状态。

代价：Electron 有基础内存开销；Pi SDK 崩溃必须由 utility process 隔离和恢复；依赖
TUI component 的 extension 不能直接渲染；Windows 子进程树清理仍需真实测试，只有
测量证明不足时才增加小型原生 helper。

## Rejected fallback

不允许在 SDK 失败时静默切到系统 Pi/RPC。双 runtime 会造成配置、session、extension、
版本和故障诊断的双重真源，违背可维护性目标。
