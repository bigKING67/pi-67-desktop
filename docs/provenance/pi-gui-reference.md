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
