# pi-gui reference provenance

参考仓库：`minghinmatthewlam/pi-gui`

治理记录：`references.catalog.json#pi-gui`、`references.lock.json#pi-gui` 和
`licenses/provenance.json`。`pi-gui` 是 Pi-67 Desktop 的首要产品与交互参考，
不是可 merge 的 Git upstream。仓库不增加它的持久 Remote、Submodule、vendored checkout
或自动源码同步。

固定审阅 commit：

```text
eb9a7380705dffad36db3efa771ee825aafbef6f
```

审阅时版本为 `0.1.0-beta.33`，默认分支与远端 HEAD 均为上述 commit。MIT License
SHA-256：

```text
887989ae1d3323becad917f0cdc9ca67f6c185416304b65f85c471fdbfbf798c
```

## 本次吸收范围

本次针对 Workspace / Session 主链路研究并重新实现以下状态流：

- `addWorkspace -> syncWorkspace -> ensureSessionReady(firstSession)`：先同步真实
  Workspace/Session 列表，再决定打开已有 Session 或创建第一个 Session；
- `selectSessionFast -> asynchronous hydration -> selection epoch check`：先表达用户选择，
  但只允许仍属于目标 Session 的异步结果提交；
- `createSession -> real SessionSnapshot -> select exact ref`：新建动作只发生一次，
  结果以真实 Session identity materialize，而不是保留 provisional ghost。
- `new-thread surface -> first Prompt -> real Thread`：允许用户先完成首条消息准备，
  再把创建和首次提交收敛成一次产品事务；
- `Composer draft hydration/debounce/flush`：草稿按当前会话身份恢复，异步回写不能
  覆盖更新的本地编辑；
- `run terminal/attention -> background notification -> exact Session selection`：只为非活跃
  会话或非前台窗口通知，并在点击后回到对应会话。
- `startup recovery -> bounded diagnostics -> keep healthy state usable`：启动同步或持久化恢复
  局部失败时保留已恢复状态并呈现 bounded diagnostic，而不是把整个产品入口变成失败页。
- `changed files -> selected file -> inline Diff`：把修改摘要、明确选择、加载/空/不可用状态和
  bounded Inline Diff 组织成一条用户可完成的审阅路径。

Worktree 产品模型已从规划进入实现。正式合同和分阶段门禁见
`docs/architecture/worktree-product-model.md`。当前重新实现包括：

- read-only Repository inspection、Git common-dir 分组和 primary/linked identity；
- provisional `Local | Worktree` 新对话 intent，以及创建锁定期间的真实状态表达；
- profile-owned Worktree root、packaged private Git transaction、创建失败回滚、保守 branch
  cleanup 和 orphan reconcile；
- Catalog mutation serialization、startup reconcile 和 dirty/unmerged/manual/detached 保护；
- system Git 不可用、无 origin、空格/非 ASCII/特殊路径的 packaged smoke fixture。

上述 source/type/unit/targeted hosted Chromium E2E 已验证；packaged private Git smoke 仍需在
本次候选交付中 fresh 执行。fixture 存在不等于 packaged smoke 或 Windows 真机已经通过。

规划明确不复制：

- 直接依赖系统 `git` 的 runner；Pi-67 使用 packaged private Git；
- 无 timeout/进程树证明的 Git mutation；
- 从 Prompt/title 派生 branch/path；
- `window.confirm` 删除和 Renderer 提交任意 path/branch/Git args；
- 将 Worktree Git authority 放入 Pi Agent Host 或 Renderer。

Pi-67 的实现不是源码移植：

- `apps/renderer/src/workspace/workspace-open-controller.ts` 以 disposable Session Catalog
  做 bounded opening decision；Catalog 有真实行时调用 `runtime.initialize`，只有
  `ready + complete + empty` 才调用一次 `workspace.open`；rebuilding/unavailable 期间
  不创建 provisional Task；
- `apps/renderer/src/workbench/task-activation-controller.ts` 使用明确 Task context、
  generation、Host epoch 和 projection disposition 拒绝迟到选择，并在 Runtime 缺失时
  轮换 Task authority 后重新打开精确 JSONL；
- 跨 Workspace 新建先走 select/register-only，再发出一次 `session.create`，不借用会
  隐式创建默认 Session 的 Workspace open 入口。
- `apps/renderer/src/session/new-session-intent-controller.ts` 把 New Session 作为
  Renderer-only intent；首条发送才 materialize Pi JSONL，并在 exact authority 绑定后提交
  Prompt。创建成功但 Prompt 失败时重试不会再次创建 Session；
- Composer 只持久化非空文本和 `streamBehavior`。Electron Main 用 `safeStorage` 加密独立
  bounded state；附件 bytes/preview/staging handle 不跨重启，安全存储不可用时 fail closed；
- 原生通知只接收固定 kind 与 opaque Workspace/Session identity。Main 生成固定隐私文案，
  不复用 `pi-gui` 可显示 Session title/error body 的内容策略；点击后按 exact identity 激活。
- 诊断导出由 Electron Main 拥有。Renderer 对 Host 诊断只等待 3 秒；Host 不回
  acknowledgement 时仍导出 Supervisor 生命周期、Desktop recovery 和固定
  `auth.json/settings.json/models.json` 的存在性、大小与 JSON 可解析状态。文件正文、绝对路径、
  原始错误、stdout/stderr、Prompt 和凭据均不进入支持包。
- Provider 配置读取沿用“局部失败不阻断健康入口”的恢复模式，但在 Pi-67 Runtime 边界内
  重做：文件访问、离线 ModelRuntime 校验、Settings reload 和 Renderer acknowledgement
  使用嵌套预算；手动读取只刷新目标 Workspace。校验超时返回 invalid snapshot，文件访问超时
  返回不含绝对路径的 recoverable error，不依赖 Task Runtime 或 Session Catalog。
- 真正 Workspace/Session 使用的 Task ModelRuntime 也在 Agent Host 内采用 4 秒离线创建预算；
  超时返回 `RUNTIME_NOT_READY`/`session-model-runtime`，重试重新创建，迟到结果不进入 Task 权威状态。
- `apps/renderer/src/changes/ChangesPanel.tsx` 重新实现 `pi-gui` 的修改列表、选择和 Inline Diff
  产品闭环，并明确拆为 `会话修改` 与 `工作区变更`。前者只消费既有
  `WorkspaceChangesProjection`，保留 Host epoch、物理 Session identity、Session generation 和
  projection revision 栅栏；`write` 没有 before-version 时只显示规模，不补造 Diff。
- 审阅 `apps/desktop/electron/app-store-diff.ts` 后只吸收了 read-only Git status/diff 的产品闭环，
  没有复制其进程或权限边界。Pi-67 由 Electron Main 从 Workbench 权威 Workspace 解析 cwd，使用
  packaged private Git、预算、revision/status fingerprint 和 opaque `changeId` 重做；Renderer 不
  获得 Git/文件系统权限，也不能提交 path/cwd。Stage、Discard、Commit、Push 和 PR 不在合同内。
- Composer context chips、可配置快捷键、Command Palette 会话正文搜索和 Conversation Snooze
  继续吸收 pi-gui 的清晰状态与键盘路径，但分别使用 Pi-67 的 opaque attachment、action registry、
  physical Session identity 和 disposable Catalog 边界重做。

## 源文件证据

```text
apps/desktop/electron/app-store.ts
SHA-256 615cf68135ca3652ec84588625c375066a6b687a5d3a60c1591d2e75c91428f4

apps/desktop/electron/app-store-workspace.ts
SHA-256 9bb2eee941706ae3a0d57086800c03348ebb8e2bc88c75a445998874a34f7edb

apps/desktop/electron/app-store-persistence.ts
SHA-256 47df43955dbd56ba0c4099710a9e9fa6fc7406dd062207cc94914a30115d09b2

apps/desktop/electron/app-store-composer.ts
SHA-256 033ef7d44494bf1d7fb18fde3dd0a6f4464fe024d7bf3536f7f4968cdb784d57

apps/desktop/electron/session-state-map.ts
SHA-256 0f9aa497f9c54f8731372c586c46c6af4563aa32c60517194690c25aed6d64bf

apps/desktop/src/hooks/use-composer-draft-sync.ts
SHA-256 dbb0cf41a20334aeba181c218498c6257738233b0861cc6591faef82d0e42179

apps/desktop/src/new-thread-view.tsx
SHA-256 0c37056e0d4ce657db8b27890e2a8818dedb67dba4ef6861714083b88cdba071

apps/desktop/src/hooks/use-new-thread-controller.tsx
SHA-256 7ab95bd8658710af69c2e26e270e7e1ea60629862fc5a75fbde23396dd532d0f

apps/desktop/electron/notification-manager.ts
SHA-256 daf4ac20f3818f14a4c08626003b413aae435bffa49a5580c9fe1c9a6231e70c

apps/desktop/electron/notification-permission.ts
SHA-256 bdac040068480076d25364eef0ad6ed1f871a086fb00725561899696c9b9b81a

apps/desktop/src/App.tsx
SHA-256 6f5a9d372e9a9a8c6b9198a9016902766ce5d17c5879abfdd7f44a03dbae6f30

apps/desktop/src/desktop-state.ts
SHA-256 7ba73893a26ec58b0f0feed8a399b4046f773f9e833a8ee52ca84d57d8ecbe0e

apps/desktop/tests/core/persistence.spec.ts
SHA-256 2e41787c35d5df1d6d79336b2ae4ece7f75d06bfd0e8925900c149d72b9ce76a

apps/desktop/src/diff-inline.tsx
SHA-256 5d440aac8d82179f6fb065973342ab1381575eadfcc2e637b9814ab8b9dfafa4

apps/desktop/src/diff-panel-types.ts
SHA-256 68da5a50944d064e17b52f9d06e132abb483a5e32224ff08b2ce92d2267e8067

apps/desktop/src/diff-panel.tsx
SHA-256 edab7dc404304c0c956e11da380553117ddce673ba4181d8d9b16bd65d222a12

apps/desktop/electron/app-store-diff.ts
SHA-256 fc605d7e74721d308bcbfe76873e8df2937d0479f258a309587e5d8d2071536b

apps/desktop/tests/core/mentions-diff.spec.ts
SHA-256 37eb95ce122b477016a9d0814f0ea5c3fa738bb74d0bfe254343f1091c5d4f2d

apps/desktop/tests/core/terminal-diff-layout.spec.ts
SHA-256 0ce9b5919b37dd1eb6b4aefbb2b9d898111c7e1456481d159b9785b9d129e82d

apps/desktop/electron/worktree-manager.ts
SHA-256 78daf097b978eb8dce3cf5162b87bdc61fe22dacf95670a554ab06772e40dd27

apps/desktop/electron/app-store-worktree.ts
SHA-256 0c51b6a898e051bd0c135d2e1a11452803dc2c483be025a2c3816fc5de574548

apps/desktop/src/hooks/use-workspace-menu.tsx
SHA-256 0b6a2a855a8640f2bdfeae60d300c5f4756e9b509e2171a88f09f6b4d3178f4a

apps/desktop/src/thread-groups.ts
SHA-256 432bd1f856e6f0cd243897ada97a8c11c9cb4c2bb576f879ecc04ea2aa8922ad

packages/catalogs/src/types.ts
SHA-256 04edc97342d9935ec2f86dd1a8f2fe6db3c0915123f8f99764955d7e43baa150

packages/catalogs/src/storage.ts
SHA-256 f7324a8ffef1e9a8258bb2c3ab6075bc177a02d12581c226a08e74f957ab8640

packages/pi-sdk-driver/src/json-catalog-store.ts
SHA-256 c9a1b4e88a6437bf9f1e36fd593935de65e83cace6b4089c98f3b7cfbac734b1

packages/pi-sdk-driver/src/atomic-write.ts
SHA-256 8a08c8c33f25ed333814860a477b8e9c5dbda00e57973e0ce0b809f7edc49f7d

apps/desktop/tests/core/worktree-manager.spec.ts
SHA-256 2d6ccee502b29c6aa4efcea30769870bbb18dfe3dfca32144bb2db4ee11339f3

apps/desktop/tests/core/worktrees.spec.ts
SHA-256 49e66c3dd5e2947cf63b6ed6d4516559d4d8c75941764843623ca8ad00cb7fe7
```

## 保留的 Pi-67 边界

- `@earendil-works/pi-coding-agent` 仍是唯一 Agent Runtime；
- Pi SDK 仍只运行在 Agent Host utility process，不移动到 Electron Main；
- Renderer 仍保持 sandbox、无 Node/Electron/文件系统权限；
- Pi JSONL 是会话真源，Catalog 是可丢弃、可重建的投影；
- `app://pi67`、MessagePort、Protocol、Task authority、审批和隐私合同不变；
- Windows 修复结论必须来自精确 Windows x64 candidate 的真实安装生命周期，不能由
  `pi-gui`、源码测试、macOS 或 hosted Windows 推断。

## 持续跟踪

CI 每周只读审计 `pi-gui` 默认分支 HEAD 与许可证 hash。发现 drift 只生成 bounded artifact，
不会自动更新 lock、创建 Issue/PR、修改源码或增加 Git Remote。只有相关功能立项或高价值
路径变化时，才固定新的完整 commit 做源码审阅并更新 provenance。
