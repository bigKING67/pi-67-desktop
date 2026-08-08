# t3code reference provenance

参考仓库：`pingdotgg/t3code`

治理记录：`references.catalog.json#t3code`、`references.lock.json#t3code`。t3code 是综合
参考源，不是 Harness-only 项目，也不是可 merge 的 Git upstream。固定审阅 commit：

```text
5661c6116c9d6e9e93e59cf067fc02dd3303ceef
```

审阅时该 commit 同时是 `main` 的 remote HEAD。上游使用 MIT License：

```text
LICENSE SHA-256 935d8f2af0c703f9c39517ee57cc4930b19d02d533be930b63f0e82f93614b43
Copyright (c) 2026 T3 Tools Inc.
```

## 综合审阅范围

产品、交互与 UI 侧检查了应用根布局、侧栏、Chat、Composer、虚拟 Timeline 与滚动锚定、
Command Palette、Diff Panel、Thread Terminal、Agent/Thread 状态、右侧面板和 Branch Toolbar。
这些实现可以作为信息架构、状态表达、键盘路径、工作流组织和细节交互的候选参考，不形成
像素、品牌、组件或 roadmap 的自动继承。

架构与 Harness 侧检查了 `OrchestrationEngine`、`ProviderRuntimeIngestion`、
`RuntimeReceiptBus`、`CheckpointReactor`、`ThreadBackgroundLiveness`、Provider Adapter/
Session Reaper、VCS contract harness、connection supervisor、`safeLog`、`DrainableWorker`
和 `KeyedCoalescingWorker`。高价值模式包括：

- outstanding-work drain 与幂等关闭；
- receipt、事件输入与投影状态分离；
- keyed latest-work coalescing；
- provider session reaping 和 background liveness；
- checkpoint/VCS contract harness；
- 有界、安全的错误和日志表达。

Pi-67 已有 Agent Host、Pi JSONL、operation receipts、projection recovery 和 scheduler。不会
因为相似模式再引入第二套 orchestration engine、第二套 Session 真源或多 Provider runtime。

## 已重新实现的模式

当前固定审阅批次不再局限于 `DrainableWorker`。Pi-67 已按自身 Domain、Protocol、进程和
安全边界重新实现以下高价值模式：

- outstanding-work drain：Session creation resolution shutdown 停止新 admission、abort active
  scan、拒绝 waiter、等待底层 Promise settle、复用同一 shutdown Promise，并对 deadline 与
  late settle fail closed；
- keyed latest-value coalescing：Worktree inspection 对同一 Repository intent 只保留最新请求，
  drain 后再提交权威结果；
- Timeline anchoring/read position：虚拟化对话保持阅读锚点、新消息计数和显式回到最新；
- shortcut/action registry：Command Palette、Composer slash action 与快捷键帮助共享一份
  Desktop action identity 和调用入口；
- Prompt Stash：exact text 与加密图片、两阶段 `safeStorage` acknowledgement、失败回滚和焦点恢复；
- Changes Turn/viewed：`第 N 轮`/`当前操作` 分组，以及基于内容 fingerprint 的
  `未查看`/`已查看` 状态；
- Conversation Snooze：绝对到期时间、可折叠 shelf、单一 bounded timer、打开/attention 自动
  wake 和 Undo；Snooze 只写 organization metadata，不改 Pi JSONL；
- Composer/context/navigation：结构化 `@file` chip、可配置 action shortcuts、Command Palette
  会话正文搜索和 authority-safe exact message locate；
- private Git/VCS contract harness：有界 packaged private Git runner、Repository/Worktree
  transaction、rollback/reconcile、dirty protection 和特殊路径 fixture；
- operation/overlay lifecycle fencing：Host epoch、Session generation、operation identity、
  late result fencing，以及 Approval/Extension/Command overlay 的确定性优先级。
- Runtime Health：按需聚合 Scheduler、Operation/heartbeat、Main Supervisor、Repository service
  和 Renderer acknowledgement；只保留 bounded counts/timestamps，不引入远端 telemetry。

其中 outstanding-work drain 的直接概念性来源文件证据为：

```text
packages/shared/src/DrainableWorker.ts
SHA-256 c0632786c0985a7b899646a053c2b00b9f8b28675ed4ebbf03034e4c29f7e229
```

主要目标文件：`apps/agent-host/src/session-creation-resolution-coordinator.ts`。只有这一条存在
可精确对应的 source path/hash 映射，因此 `licenses/provenance.json` 不为其他概念性参考伪造
源码 provenance。

Pi-67 使用现有 Promise、AbortController、HostCommandError、Workspace fairness 和 shutdown
deadline 重新实现；没有复制 t3code 源码，也没有引入 Effect、TxQueue、TxRef 或共享 Worker
抽象。具体映射记录在 `licenses/provenance.json`。

## 验证边界

- 上述路径已具备 source、TypeScript 和对应 targeted unit test 证据；已有 UI 路径中的一部分具备
  hosted Chromium E2E，但本轮新增 Snooze、图片 Stash 与 Runtime Health 仍需完整 E2E 和 packaged
  validation 才能升级证据；
- packaged private Git smoke fixture 已接入，但在当前 candidate 交付前仍需 fresh packaged
  execution，不能只凭 fixture 存在宣称通过；
- 当前文档不证明 Windows candidate、Windows 安装或用户真机生命周期；这些结论必须绑定
  后续精确 source SHA、workflow run/attempt、installer hash 和真实目标机结果。

## 保留的 Pi-67 边界

- Pi SDK 是唯一 Agent Runtime，Pi JSONL 是对话真源；
- Pi Runtime 仍在 Agent Host utility process；
- Renderer 保持 sandbox、context isolation 和窄 Preload bridge；
- production 不增加 localhost server、业务 WebSocket、relay 或 telemetry；
- 外部参考观察不自动成为产品功能或扩大权限；
- 后续吸收仍逐项固定 commit、验证许可证并记录 provenance。
