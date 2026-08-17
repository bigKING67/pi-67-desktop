# t3code reference provenance

参考仓库：`pingdotgg/t3code`

治理记录：`references.catalog.json#t3code`、`references.lock.json#t3code`。t3code 是综合
参考源，不是 Harness-only 项目，也不是可 merge 的 Git upstream。当前固定审阅 commit：

```text
949feb61e4bfd96669ba0e8cf3dca7c6d7f885b3
```

2026-08-17 现场 fetch 后，默认分支 `main` 与 remote HEAD 均为上述 commit。此前
`5661c6116c9d6e9e93e59cf067fc02dd3303ceef` 的 Plan、Tool lifecycle 与 Harness 审阅仍作为
历史 provenance 保留；本轮把当前锁点推进到 live HEAD，而不是把远端漂移当作已吸收。
上游使用 MIT License：

```text
LICENSE SHA-256 935d8f2af0c703f9c39517ee57cc4930b19d02d533be930b63f0e82f93614b43
Copyright (c) 2026 T3 Tools Inc.
```

## 2026-08-17 当前 HEAD 增量审阅

旧锁点到当前 HEAD 共 271 个提交、920 个变更文件（`+107,738/-16,623`）。本轮先盘点完整
commit/range，再对决定性路径做源码审阅；该范围盘点不等价于逐行审阅 920 个文件，也不支持
“已全面吸收”的结论。

本轮唯一立即重实现的是“Provider Turn 启动前拒绝超大 Prompt”：t3code 在 contracts 与
Composer 共用 120,000 字符上限，并在 dispatch 前保留可编辑草稿。Pi-67 以自身边界重做：

- `packages/protocol/src/prompt-text-limits.ts` 与 TypeBox command schema 共用上限，越界请求不能
  穿过 MessagePort 进入 Agent Host；
- `apps/renderer/src/composer/prompt-text-validation.ts` 给出精确超额与拆分建议；
- `submitComposerDraft` 在 provisional Session materialize 前拒绝，`submitRendererPrompt` 再做
  独立防线；草稿、附件和现有 `role="alert"` 错误面保持不丢失；
- 没有引入 t3code 的 Provider adapter、Effect contracts、server、SQLite、RPC 或 WebSocket。

决定性当前源码证据：

```text
packages/contracts/src/orchestration.ts
SHA-256 c9fe8d097b90605f8dd1c0441b2510e2f32c62d87b352014ee713b71464913b2

packages/contracts/src/provider.ts
SHA-256 79a71ae1c67965265c85cbc3eb06cabdab27386da53290db83a2f51aff900251

apps/web/src/components/chat/composerSubmission.ts
SHA-256 e5d35313f4c1968a73834bfe69a9e15a0d728dcd44de124247bb97858164ddb3

apps/web/src/components/chat/ComposerPromptLengthValidation.tsx
SHA-256 d696d3cca7a49dfa40e7b1af3d67b9ad7fbdba6eaf10ec676e261113af133238
```

其余高信号变化按比例处置：

- `KEEP`：Pi-67 已有图片 MIME 白名单、Task-bound 草稿防迟到覆盖、Operation receipt/authority
  fencing、pending Approval/Extension input settlement 与 Host shutdown 合同，不重复实现；
- `DEFER`：原生 `title` tooltip 迁移、长按退出、24 小时用量视图有产品价值，但不构成本次
  候选安全 blocker；其中 Usage 继续服从当前 7/30/90 天 UTC 日期横轴合同；
- `REJECT`：mobile、remote relay、localhost server、业务 WebSocket、多 Provider runtime、SQLite
  Session projection 与 Pi-67 的 Electron/Pi JSONL/security boundary 冲突；
- 最新 HEAD 的 browser default settings 只作为 Browser 集成后续候选，不在本轮改写现有
  browser67 权威、登录态或 managed-tab 生命周期。

## 综合审阅范围

产品、交互与 UI 侧检查了应用根布局、侧栏、Chat、Composer、虚拟 Timeline 与滚动锚定、
Command Palette、Diff Panel、Thread Terminal、Agent/Thread 状态、右侧面板和 Branch Toolbar。
这些实现可以作为信息架构、状态表达、键盘路径、工作流组织和细节交互的候选参考，不形成
像素、品牌、组件或 roadmap 的自动继承。

Provider 设置专项又检查了 `AddProviderInstanceDialog`、Wizard steps 和
`ProviderSettingsForm`。可吸收原则是按当前 Provider 能力只呈现真实可用字段、让新增流程先完成
身份再进入专项配置、对敏感值使用明确的 replace/hidden 状态；不应拿一张通用表单展示大量禁用项。
Pi-67 的模型 Provider 语义与 t3code 的 CLI Provider instance 不同，因此本轮只用它校验交互原则，
不伪造一条源码复用映射，也不引入 t3code 的 Provider runtime。

```text
apps/web/src/components/settings/AddProviderInstanceDialog.tsx
SHA-256 4ac19b8b6a9c1daf1e06efb6fc63df15fce38ed7fc0d599b6c4c00d0d313f221

apps/web/src/components/settings/AddProviderInstanceWizardSteps.tsx
SHA-256 cdb178e5d294f1828f5d4edffb7199cc1765eeba5ad9cbbdda30555b803be0ba

apps/web/src/components/settings/ProviderSettingsForm.tsx
SHA-256 711279ea2670013642d2f356b6648a0d6dca52d7cde95966f276f5a993021b43
```

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

## Plan 专项审阅与重实现

Plan 专项固定在同一 commit `5661c6116c9d6e9e93e59cf067fc02dd3303ceef`，重点审阅了
proposal identity、Composer follow-up、持久化投影、来源 lineage，以及 Provider Turn 启动后才
消费 proposal 的边界。决定性源码证据为：

```text
apps/web/src/proposedPlan.ts
SHA-256 8a7969787c95d3b8802ac088e7a9c092c8cc735375018bf7f3973558d6766fea

apps/web/src/components/chat/ProposedPlanCard.tsx
SHA-256 deed8d256cceaf5330c801a784395f2fbf9f671e9d9607f97d5c77dd7e8d63e0

apps/web/src/components/chat/ComposerPlanFollowUpBanner.tsx
SHA-256 3f9b5bd26a0cc2023555d5df556f7339ebd0c4365966c4dadc102035f1e6d087

apps/web/src/components/chat/ComposerPrimaryActions.tsx
SHA-256 d3e3c1e5eab043584ea5d9791aeb1e82ab554386e1b6f189f6e5d881ecc2e103

apps/server/src/orchestration/ThreadPlanProgress.ts
SHA-256 0647a46e345aed49ffa939603775b89586d98bdbc6271ea6ccecb2d20e45f741

apps/server/src/persistence/Services/ProjectionThreadProposedPlans.ts
SHA-256 6065ee483a6844968361fc39ff3ade744673e8723aad9f4fd33bf23964d378ff

apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
SHA-256 5282b5b35e74c10578300deb3966f2c191506c49ff850e1e6c93e47c2e782d20

apps/server/src/orchestration/Layers/ProjectionPipeline.ts
SHA-256 5714821b20718654d3925ce1a85e347916ab06ae20a4e4b62f16162e70837a86
```

Pi-67 吸收的是以下机制，而不是 t3code 的技术栈：

- Composer 有用户草稿时呈现 Refine，空草稿时呈现 Implement；
- Plan proposal 与实现 Turn 保留可核对的来源 lineage；
- accepted request 不是 implemented，只有真实 Provider/Pi Turn started 才消费 proposal；
- stale/replay Turn 不得消费当前 Plan，启动前失败可恢复，启动后失败不重复实施。

这些机制按 Pi-67 边界重新实现：Pi JSONL 中的 `requested | started | start-failed` durable entry
是 lifecycle 真源；Agent Host 从 accepted Operation 绑定 `submissionId`、`operationId`、Host epoch、
Session physical identity 和 generation；Pi Runtime 只在同一绑定 Session 的真实 `agent_start` 后
写 started 并消费 Plan；Renderer 仍只发送 `planId + submissionId`，Refine 直接提交现有 Composer
内容。没有复制 t3code 的 client-side Markdown implementation Prompt、SQLite projection、Effect
orchestration、多 Provider adapter、新 Thread 实施、保存、下载或导出功能。

t3code 后续产品版本把部分手动 Plan Mode 入口归到 Legacy/default-off，只表示其后续入口与默认值
选择，不否定上述 durable proposal/Turn lineage 机制，也不代表 Pi-67 弃用第一方 Plan。该后续
分类不推进本文件的固定审阅 commit。

## Tool 执行生命周期专项审阅与重实现

本次继续固定在同一 commit，审阅 Provider runtime event、ingestion/projection、Web Session
folding、Timeline process item 和 orchestration timing。决定性源码证据为：

```text
packages/contracts/src/providerRuntime.ts
SHA-256 466b86d5f90d41743660fa3e4849941610d152fcf9794bc6d426d9ddf492e737

apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
SHA-256 5282b5b35e74c10578300deb3966f2c191506c49ff850e1e6c93e47c2e782d20

apps/web/src/session-logic.ts
SHA-256 7bdf795d576702c3d83fd1642e65e3f8b84ecda97a4c213871e0c964f22d72c6

apps/web/src/components/chat/MessagesTimeline.tsx
SHA-256 3b5c1b2f3f11d40585341f7e81d6167fd704fe2cf740bf7d671f94f30e7bab79

apps/web/src/components/chat/MessagesTimeline.logic.ts
SHA-256 3d116d6f2986d76ce57be4711480476655145333b3259867c214938be935fa9c

packages/shared/src/orchestrationTiming.ts
SHA-256 5e80de85f459d22eeb1759e7bc7c8db292c18a4034d97f22ae16b11150b39912
```

Pi-67 重新实现 keyed Tool lifecycle、event/projection separation、live/durable merge、process
item folding、durable timing receipt 和 bounded error projection。Pi Runtime 在 Agent Host 内
投影真实 Tool start/update/end；Pi JSONL receipt 仅保存 Tool identity、terminal status 与 timing，
重开时 Tool Result 仍决定成功或失败，receipt 只补 timing。Renderer 将“中间 Tool 未成功但已有
最终答案”表达为可折叠 warning，只有权威 Operation failure 才表达为红色 `执行失败`。

没有复制 t3code 源码，也没有引入它的 Provider runtime、Effect orchestration、SQLite projection、
RPC/WebSocket server 或第二套 Session 真源。精确 source/target 映射记录在
`licenses/provenance.json`。

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
- Tool execution lifecycle：按 `toolCallId` 合并并行 start/update/end、100ms progress 节流、
  bounded/redacted input 与 error、真实 Runtime timing、终态收口、Pi JSONL timing receipt、
  durable Tool Result 核对和 Renderer process outcome 分层；
- Plan proposal/Turn lineage：同一 Pi JSONL 的 requested/started/start-failed marker、accepted
  Operation authority、真实 Pi `agent_start` 消费门、启动前恢复和 contextual Refine/Implement；
- Runtime Health：按需聚合 Scheduler、Operation/heartbeat、Main Supervisor、Repository service
  和 Renderer acknowledgement；只保留 bounded counts/timestamps，不引入远端 telemetry。

其中 outstanding-work drain 的直接概念性来源文件证据为：

```text
packages/shared/src/DrainableWorker.ts
SHA-256 c0632786c0985a7b899646a053c2b00b9f8b28675ed4ebbf03034e4c29f7e229
```

主要目标文件：`apps/agent-host/src/session-creation-resolution-coordinator.ts`。此外，Plan 专项对
`ProviderRuntimeIngestion.ts` 的 started-after-authority 语义和 `ComposerPrimaryActions.tsx` 的
contextual Refine/Implement 语义建立了两条精确 source path/hash 重实现映射。其余概念性参考仍
不伪造源码 provenance。

Pi-67 使用现有 Promise、AbortController、HostCommandError、Workspace fairness 和 shutdown
deadline 重新实现；没有复制 t3code 源码，也没有引入 Effect、TxQueue、TxRef 或共享 Worker
抽象。具体映射记录在 `licenses/provenance.json`。

## 验证边界

- 上述路径已具备 source、TypeScript 和对应 targeted unit test 证据；Plan 的 contextual action、
  requested/started UI 和启动前失败重试具备 hosted Chromium E2E。本轮仍未用该 browser 证据外推
  packaged Electron，而 Snooze、图片 Stash 与 Runtime Health 仍需各自完整 E2E 和 packaged
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
