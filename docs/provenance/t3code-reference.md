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

## 2026-08-26 Batch A：有界 Tool 与 Resource 投影

Batch A 固定审阅 t3code commit
`504177797676048bf70f64ce56c21949d0b8a018`，没有修改 Repository 的 reviewed
reference lock。该批只重新实现投影机制，没有复制 Effect、orchestration、persistence、RPC、
SQLite 或客户端 runtime：

```text
apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
SHA-256 efb4815aee0e584988755ded36d366ef61aca34b50898bac601ae5bd674d4bc5

apps/server/src/orchestration/ActivityPayloadProjection.ts
SHA-256 19aa53d6039519e0871bbec95ce8843d4155fbc60cee3d9bc8d6b37e00bc8bbd

apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
SHA-256 a926a3aad5e7f07acd353fcd8e9f1dc8e101b75a2dde88c22e62fcbc0f472bde
```

Pi-67 的对应重实现为：

- `packages/pi-runtime/src/tool-execution-projection.ts` 在合并、清理 Tool 文本前就施加
  collection-time budget；现有 100 ms throttle 与 terminal flush 继续由
  `tool-execution-projector.ts` 负责，Tool Result 和 Pi JSONL 权威不变；
- `packages/pi-runtime/src/session-snapshot.ts` 只向跨进程边界投影 Resource metadata，增加
  item、aggregate-text 和 per-field budget，并用明确 disposition 报告 omitted item 与缩短字段；
- `packages/protocol/src/session-resource-schemas.ts` 约束投影数组和字段上限；Renderer 明示
  truncation，而 Pi `ResourceLoader` 的内部完整状态与加载优先级不受影响。

具体许可证和 source-target 映射记录在 `licenses/provenance.json`。

## 2026-08-26 Batch B：Pi-native Renderer 只读 Query 生命周期

Batch B 继续固定在 t3code commit
`504177797676048bf70f64ce56c21949d0b8a018`，没有推进 reviewed reference lock。决定性
源码证据为：

```text
apps/web/src/state/query.ts
SHA-256 7e8091ea2708815bd323a2fcddc1ab55b8fc2f9c9fd5ced618072863005220c0

apps/web/src/state/use-atom-query-runner.ts
SHA-256 94ba841ba9821939a63e4456fcc1f1a0f17cad8fe12066ffdb9786b1a3ea517b

apps/web/src/state/queries.ts
SHA-256 41801512ad2db04f53f6994539116c11cc222f2508798b930f3b42d69b24738e

apps/web/src/state/queries.test.ts
SHA-256 5b0884dcefc5d2a8550d18e0b9ead167fc3a7368382b999da0312c7f1760aa70
```

t3code 的 Query view 保留最近成功值并显式表达 pending/error，runner 统一执行 Atom Query，
Thread search key 绑定 environment/query 等目标条件。Pi-67 只吸收这些生命周期不变量，使用现有
TypeScript、React、MessagePort 和 `AgentConnectionController` 重新实现：

- `apps/renderer/src/query/renderer-read-query-client.ts` 只允许
  `session.catalog.query` 与 `session.catalog.contentSearch` 两个 Host 白名单读命令，按完整
  command/context/payload key 单飞，提供 cancellation、Host identity stale fence、last-success
  retention，以及 loading/refreshing/ready/unavailable/error 状态；
- `apps/renderer/src/query/use-renderer-read-query.ts` 通过 observed revision 连接 React Compiler
  与 disposable query snapshot；Navigation 与 Palette 的相同 Workspace/message key 共用 flight；
- reconnect 仍由现有 `connection-state.ts` 持有；普通连接在 Workspace registration 完成后、
  Session recovery 在权威恢复提交后，只刷新仍有 observer 的 read key。Workspace registration、Session mutation、Operation、
  Approval、Tool 与 Plan 均不进入 Query kernel，也不会被其重放；
- 首批仅迁移 Palette Session search、Palette message search 与 Navigation message search。Pi JSONL、
  Host epoch、Session physical identity、generation 和 Pi Runtime 继续拥有权威状态。

没有复制 t3code 源码，也没有引入 Effect、Atom runtime、Effect RPC、SQLite Session truth、
localhost server、业务 WebSocket、多 Provider runtime 或第二套 orchestration loop。具体
source-target 映射记录在 `licenses/provenance.json`。

## 2026-08-26 Batch C：HEIC/HEIF 安全归一化

Batch C 继续固定在 t3code commit
`504177797676048bf70f64ce56c21949d0b8a018`，没有推进 reviewed reference lock。决定性
源码证据为：

```text
apps/web/src/lib/imageCompression.ts
SHA-256 dc384032f3ebaa6fc2d7599ae775ba1d3fe186c9db4d6dd49df3ddd62de3f2dc

apps/web/src/lib/imageCompression.test.ts
SHA-256 3d82a1f3159b5ec18f683230070dcdfb62a20b43ff347a3fe81ed2b4cd683eaa
```

t3code 的实现提供 HEIC/HEIF 识别、转换前 `ispe` 尺寸读取、源文件和像素预算、JPEG 输出及
失败回归。Pi-67 只吸收这些安全不变量，并按自身 Electron/opaque attachment 边界重新实现：

- Desktop Main 在 1 MiB 边界内结构化解析 `ftyp/meta/iprp/ipco/ispe`，不信任文件扩展名或
  Renderer MIME；
- 独立 Node worker 使用冻结的 `heic-decode`/`libheif-js` 和已存在的
  `@napi-rs/canvas`，在 RGBA 分配前复核 5,000 万像素与 16,384 单边上限；
- Main 移除 JPEG APP1/APP2/APP13/COM 段，重新验证尺寸与完整性，再写入现有 version-1
  opaque manifest；Agent Host claim/hash 和 Pi image truth 不变；
- Preload 只接收一次性 source-normalization binding；Renderer 校验后丢弃，不持久化源路径、
  HEIC bytes 或 decoder state，也不为原 HEIC 创建 object URL；
- 失败仅移除本次 staging 目录，Composer 文本和已有附件保持可重试、可移除。

Pi-67 没有复制 t3code 源码，也没有采用 `heic-to/csp` 的 Renderer Blob worker，因此没有扩大
`worker-src` CSP。依赖、许可证、资源预算和完整流程见
`docs/architecture/heic-attachment-normalization.md`，精确 source-target 映射见
`licenses/provenance.json`。

## 2026-08-26 Batch D：Worktree 完整性、取消与显式恢复

Batch D 继续固定在 t3code commit
`504177797676048bf70f64ce56c21949d0b8a018`，没有推进 reviewed reference lock。决定性
源码证据为：

```text
apps/server/src/vcs/GitVcsDriverCore.ts
SHA-256 6e6faf75bef4bde73988ee40e4aa54a88d55dede190e3d84d5c321c491e731e7

apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
SHA-256 3f319cec4693f537655bedc699a5ef71ee1079d44a167c3948e5e482df643242
```

t3code 将 Worktree checkout timeout 提高到 300 秒，并在创建后 best-effort 递归初始化
Submodule；Provider turn 发现缺失 Worktree 时会先执行 Repository-wide `git worktree prune`，
再尝试重建。Pi-67 只吸收“长 checkout 需要合理预算”“Submodule 是创建完整性的一部分”和
“app-owned 缺失 Worktree 需要恢复机制”三个产品问题，不复制它的隐式副作用：

- 使用精确 packaged private Git 生成 10k、50k、100k tracked-file 合成仓库，各测 3 次
  `worktree add`，测得约 0.7 秒、3.6 秒和 7.2 秒；据线性外推约 375k files 为 27 秒。保留
  300 秒 hard timeout，同时让排队和运行中的创建均可取消，并在确认回滚后才报告取消；
- 新建 Worktree 只自动复用同一 common-dir 中已存在、经路径 containment 验证的 top-level
  Submodule objects，禁用所有网络 transport 并使用 `--no-fetch`。普通 `submodule update`
  实测仍会重新 clone，因此不作为 local-only 机制；需要网络时由用户明确点击动作；
- 缺失恢复只接受 committed app-owned durable binding，逐项验证 source/target/common-dir/
  branch/HEAD/clean identity。只对 exact stale target registration 定点移除，永不执行
  Repository-wide prune；Turn/Provider 路径不会触发恢复；
- 恢复只承诺重建当前 branch 的已提交状态，UI 明示未提交改动与未跟踪文件无法恢复。若 Git
  已恢复而 Workbench state 写入失败，后续显式重试只在 exact clean identity 对账成功时补写状态。

具体架构与安全合同见 `docs/architecture/worktree-product-model.md`，精确 source-target 映射见
`licenses/provenance.json`。Pi SDK、Pi JSONL、Workspace/Session authority 和八个 live Task 合同
均未改变。

## 验证边界

- 上述路径已具备 source、TypeScript 和对应 targeted unit test 证据；Plan 的 contextual action、
  requested/started UI 和启动前失败重试具备 hosted Chromium E2E。本轮仍未用该 browser 证据外推
  packaged Electron，而 Snooze、图片 Stash 与 Runtime Health 仍需各自完整 E2E 和 packaged
  validation 才能升级证据；
- Batch C/D 已完成当前 exact macOS arm64 unsigned packaged execution：HEIC 归一化通过真实输入
  与 metadata-free JPEG 检查，打包内 private Git 2.53.0 和精确 `GIT_EXEC_PATH` 通过 26/26
  Worktree、Submodule 和 recovery fixtures，production Renderer Worktree preview 通过 5/5。
  这些证据仍只覆盖 exact macOS artifact、packaged toolchain、UI/inspection 和 synthetic
  real-filesystem service lifecycle，不能外推为用户真实 Repository 的手工完整生命周期；
- 当前文档不证明 Windows candidate、Windows 安装或用户真机生命周期；这些结论必须绑定
  后续精确 source SHA、workflow run/attempt、installer hash 和真实目标机结果。

## 保留的 Pi-67 边界

- Pi SDK 是唯一 Agent Runtime，Pi JSONL 是对话真源；
- Pi Runtime 仍在 Agent Host utility process；
- Renderer 保持 sandbox、context isolation 和窄 Preload bridge；
- production 不增加 localhost server、业务 WebSocket、relay 或 telemetry；
- 外部参考观察不自动成为产品功能或扩大权限；
- 后续吸收仍逐项固定 commit、验证许可证并记录 provenance。
