# Worktree 产品模型与实施规划

状态：`Phase A inspection and Phase B creation are implemented; Batch D progress, Submodule completeness and explicit app-owned recovery have source, targeted-test, exact macOS packaged private-Git, and packaged UI/inspection evidence; manual user-Repository and Windows installed evidence remain pending`

参考上游：`minghinmatthewlam/pi-gui@eb9a7380705dffad36db3efa771ee825aafbef6f`

本文定义产品模型、架构边界、恢复语义、Windows 风险和分阶段验收，并记录当前实现
快照。当前源码已经包含只读 Repository inspection、Workbench V5、事务化 Worktree
创建、可取消的分阶段 checkout、Submodule 完整性、本地优先初始化、显式联网补齐、app-owned
缺失 Worktree 恢复、startup reconcile、保守 pre-Host rollback 和 `当前工作区 | 隔离 Worktree`
入口。当前 Batch D macOS arm64 exact unsigned artifact 已通过完整 packaged smoke/open；打包内
private Git 2.53.0 与精确 `GIT_EXEC_PATH` 通过 26/26 Worktree、Submodule 和 recovery fixtures，
production Renderer preview 通过 5/5 UI 场景。上述结果验证 packaged toolchain、UI/inspection
和 synthetic real-filesystem service lifecycle，不等于用户真实 Repository 的手工完整生命周期；
源码测试、Renderer browser fixture、macOS 或 `pi-gui` 的运行结果均不得外推为 Pi-67 的
Windows 真机证据。

## 1. 决策

Pi-67 吸收 `pi-gui` 的 `Local | Worktree` Thread 产品模型、Git common-dir 分组、
profile-owned Worktree root、创建失败回滚、保守删除和 startup reconcile，但不移植其
AppStore、Renderer-facing Git 权限或直接依赖系统 `git` 的实现。

目标组合是：

```text
pi-gui 的可用产品闭环
+ Pi-67 的 Workspace 物理身份
+ Pi JSONL Session 真源
+ Agent Host Utility Process 隔离
+ Protocol/Host epoch/Session generation 栅栏
+ durable creation/recovery 语义
+ packaged private Git toolchain
+ Windows installed lifecycle 证据门禁
```

明确架构决策：

1. Electron Main 拥有 Repository/Worktree policy、Git subprocess、持久化绑定和 mutation
   journal；Git 不进入 Renderer，也不进入 Pi Agent Host。
2. 每个 primary 或 linked Git worktree 都是一个独立的 Pi-67 physical Workspace，继续使用
   现有 `WorkspaceId`、物理路径身份、trust 和 Host `workspace.register` 合同。
3. Pi JSONL 继续是对话真源；Git 是 Repository/Worktree 事实来源；Worktree Catalog 只是
   可丢弃投影；Workspace 与 app-owned Worktree 的绑定和未完成 mutation journal 属于
   Desktop durable state。
4. 创建 Thread 时提供 `当前工作区 | 隔离 Worktree` 一级选择。选择隔离环境不会立即产生
   Git 副作用；第一次提交才开始 Worktree + Workspace + Pi Session 事务。
5. Phase 1 的 branch/path 使用无 Prompt 内容的 opaque 名称，例如
   `pi67/task-a1b2c3d4`。不得从 Prompt、Session title、源码或用户消息派生 Git branch/path。
6. Main 只接受 `workspaceId`、opaque operation ID 和 bounded UI label；Renderer 不能提交
   任意 Git 参数、任意目标路径、branch、`--force` 或 start point。
7. 默认不提供 force removal。dirty、untracked、unmerged、detached、running、draft、attachment、
   path/identity drift 或非 app-owned Worktree 都 fail closed。
8. Git mutation 按 `RepositoryGroupId` 串行化。Git 命令超时或进程树退出无法证明时，Repository
   mutation authority 进入 `indeterminate`，完成 reconcile 前不接纳下一次 mutation。
9. 初期由 Main 直接管理有界 Git child process；不预先创建无真实收益的第二个 Git utility
   process。只有 profiling 证明 Main responsiveness、shutdown 或进程树隔离不满足预算时，才把
   executor 移入专用 utility process，policy/journal 仍留在 Main。
10. Worktree 不是对现有 Session Changes 的重命名。Session Changes 继续表达 Pi Tool 事实；完整
    Git Diff 必须在 Worktree/Git authority 建立后作为后续 Phase E 实现。

## 2. 背景与问题边界

此前 Windows 无法进入 Workspace、打开/创建对话的直接故障链是 Pi 配置文件读取或离线
ModelRuntime 初始化没有在 Renderer acknowledgement 前完成，导致 Workspace/Session 主链路表现为
无法加载，而不是因为缺少 Git Worktree。该 P0 可靠性问题与 Worktree 是两个层次：

```text
配置读取 / ModelRuntime / Workspace registration / Session creation
= 对话能否进入的 P0 可用性基础

Repository grouping / isolated Worktree / branch lifecycle
= 在基础可用后增强并行任务和代码隔离的产品能力
```

Worktree 实施不能掩盖、绕过或替代配置读取修复。每个阶段都必须先证明普通 Workspace 的
Session 主链路仍可用，再证明 Worktree 增量路径。

## 3. 目标与非目标

### 3.1 目标

- 用户从新对话入口选择当前 Workspace 或隔离 Worktree。
- app-owned Worktree 创建、Workspace 注册、Session materialization 和首次 Prompt 形成可恢复事务。
- 已有对话可以 Fork 到当前 Workspace 或新的隔离 Worktree。
- Worktree 在导航、对话标题区和删除确认中始终可辨认。
- 崩溃、窗口 reload、Host replacement、Git timeout 和局部持久化失败后不重复创建、不静默丢分支、
  不把旧响应提交到新环境。
- Windows x64 使用打包内私有 Git，不依赖系统 PATH、用户安装的 Git 版本或 shell quoting。
- dirty/unmerged/manual Worktree 默认保留；branch 泄漏优于 commit 丢失。
- Catalog 可删除重建，durable binding 和 mutation journal 可确定恢复。

### 3.2 非目标

- 本阶段不实现 PTY Terminal。
- 本阶段不实现 Stage/Unstage/Commit/Push/PR。
- 本阶段不把 Session Tool Patch 扩展成完整 Git Diff。
- 本阶段不允许 Renderer 直接访问 Git、Node 或文件系统。
- 本阶段不把 Pi SDK 移入 Electron Main。
- 本阶段不增加 localhost HTTP Server、业务 WebSocket 或 Pi RPC adapter。
- 本阶段不自动迁移、移动或删除用户手工创建的 Worktree。
- 本阶段不自动 force-remove dirty Worktree，不自动 `branch -D` 删除用户 commit。
- 本阶段不改变 `MAX_RUNNING_TASKS = 8`。
- 本阶段不以 `pi-gui`、macOS preview、hosted Windows 或源码测试证明 Windows installed maturity。

## 4. 当前 Pi-67 基础

已经存在并应保留的基础：

- Main-owned `WorkspaceDescriptor` 包含稳定 `workspaceId`、canonical path、可用时的
  `device/inode/birthtimeNs` 和 `filesystem | path-only` assurance。
- 相同物理目录不会注册为两个 Workspace；path-only 恢复不会自动继承完整 trust。
- `ConversationKey` 使用 `workspaceId + sessionFileIdentity`，不依赖可变 branch name。
- Workbench state 使用有界读取、schema 校验、corrupt quarantine、temp-file + fsync + rename 和
  进程内串行更新。
- Renderer 通过现有 `workspace.register` 把 Main 已验证的 Workspace 交给 Agent Host。
- Agent Host 以 canonical cwd 拒绝重复 Workspace identity，并为所有 Workspace 共享同一个
  disposable Session Catalog owner。
- Session 创建已有 caller-stable `creationId`、durable creation journal、exact marker resolution、
  `REQUEST_OUTCOME_UNKNOWN` 和 Renderer recovery record。
- 打包资源已有经 manifest 验证的 private Node/npm/Git，包含精确 `gitExecutable` 和
  `gitExecPath`；公开状态不暴露私有工具路径。
- Workspace 删除已经在 Renderer 阻止 active Task、provisional Task、draft、attachment 和当前
  active Workspace，并先 unregister Host 再删除 Main registration。

Worktree 设计应复用这些合同，而不是建立第二套 Workspace、Session 或 recovery 数据库。

## 5. 从 pi-gui 吸收什么

### 5.1 吸收矩阵

| `pi-gui` 能力 | Pi-67 决策 | 说明 |
| --- | --- | --- |
| 新 Thread 的 `Local | Worktree` 选择 | `ADOPT` | 作为一级产品选择，但 Git 副作用延迟到首条提交 |
| Git common-dir Repository grouping | `ADOPT` | 使用私有 Git + Main 物理身份增强 |
| primary / linked distinction | `ADOPT` | primary 不能按 linked Worktree 删除 |
| `<userData>/worktrees` profile ownership | `ADOPT` | 路径段改为短 opaque token，降低 Windows long-path 风险 |
| create -> sync Workspace -> create Session | `ADAPT` | 接入 Pi-67 Workspace registration、Host authority 和 Session creation journal |
| downstream failure rollback | `ADAPT` | 只有 outcome 明确未 materialize 才自动回滚；unknown 必须保留并 resolve |
| Fork Thread 到新 Worktree | `ADOPT` | 先 validate fork，再创建环境，最后 materialize exact Pi Session |
| safe branch deletion `branch -d` | `ADOPT` | 仅 app-owned `pi67/*`，失败时保留 branch |
| merged/clean orphan reconcile | `ADAPT` | 默认变成可见 recovery；只有完整证明安全才允许自动清理 |
| Worktree icon/sidebar context | `ADOPT` | 不只靠颜色，提供可访问名称和 environment label |
| JSON Catalog mutation queue/atomic write | `ADOPT PRINCIPLE` | Pi-67 durable authority进入 Workbench state；Catalog 另做可重建投影 |
| 直接 `execFile("git")` | `REPLACE` | 使用 packaged private Git、stage budgets、bounded output 和 process-tree cleanup |
| canonical path 作为 Worktree ID | `ADAPT` | Catalog 可使用 path identity；durable Session 绑定只使用 WorkspaceId |
| `pi/<title-slug>` branch | `REPLACE` | 使用无 Prompt 内容的 `pi67/task-<opaque>` |
| `window.confirm` 删除 | `REPLACE` | typed preflight + exact snapshot + one-shot destructive confirmation |
| AppStore 同时拥有产品和 runtime state | `KEEP PI-67` | 保留 Main/Renderer/Host 分层和 Protocol authority |

### 5.2 已确认的上游实现边界

在锁定 commit 的已审阅路径中：

- Worktree Git 命令运行于 Electron Main，使用 `execFile`，没有 shell 字符串拼接。
- `runGit` 有 10 MiB `maxBuffer`，但没有显式 timeout、AbortSignal、child-tree termination 或
  post-timeout indeterminate state。
- 已审阅 Worktree manager/AppStore 路径中没有 Repository-scoped mutation queue。
- JSON Catalog 本身有按文件共享的 mutation queue、generation cache 和 atomic write，不是裸写。
- UI removal 不传 `force`；`--force` 和 `branch -D` 只用于本次调用新建 artifact 的 best-effort
  rollback，普通删除使用 Git 的保守行为和 `branch -d`。
- startup reconcile 只考虑 active profile root，保留 legacy/manual/dirty/unmerged/detached Worktree；
  reconcile 顶层失败目前只写 `console.warn`。
- 核心测试覆盖 create rollback、merged branch cleanup、unmerged branch retention、dirty/manual/
  detached fail closed、profile isolation、legacy preservation 和 sidebar UI。
- 已审阅测试未提供 Windows 非 ASCII、UNC、long path、locked file、Defender/EDR、process-tree
  timeout 或 installed NSIS lifecycle 的专项证据。

这些结论只覆盖锁定 commit 和列出的源码/测试，不能推断未审阅路径或未来 upstream 状态。

## 6. 目标身份模型

```text
RepositoryGroup
|- observed Git common-dir identity
|- one optional registered primary Workspace
`- zero or more linked Worktree environments
   `- one physical Pi-67 Workspace each
      `- Pi JSONL Sessions / Tasks
```

### 6.1 RepositoryGroupId

`RepositoryGroupId` 是 Main 分配的 opaque ID。匹配依据是：

```text
filesystem assurance:
  canonical common-dir + device + inode + birthtimeNs

path-only assurance:
  platform-normalized canonical common-dir
  + explicit needs-confirmation on ambiguous recovery
```

不得把 common-dir path hash 直接当作唯一物理证明。hash 只能用于日志/诊断脱敏，不能替代
filesystem identity 或用户确认。

### 6.2 WorkspaceId

每个 primary/linked physical directory 继续拥有独立 `WorkspaceId`。Session、Task、draft、attachment、
trust、Host registration 和 Workspace file access 都继续按 `WorkspaceId` 隔离。

### 6.3 WorktreeProjectionId

Catalog 中的 observed Worktree 可以使用 canonical path identity 作为 rebuildable projection key。
一旦 Worktree 被注册为 Pi-67 Workspace，durable 关系必须绑定 `WorkspaceId`，不能让 Session 依赖
projection key。

### 6.4 Branch 与 HEAD

- `branchName`、`headSha`、dirty 状态和 detached 状态都是观察值，不是 Session identity。
- branch rename/delete/detach 不改变已有 `ConversationKey`。
- 创建起点在 Main preflight 时解析为 exact 40-hex HEAD SHA，实际 `worktree add` 使用该 SHA，
  不在 mutation 时重新解释可移动的 `HEAD`。

### 6.5 Durable environment binding

建议把下列 bounded binding 加入下一版 Workbench state：

```ts
interface WorkspaceEnvironmentBinding {
  workspaceId: WorkspaceId;
  kind: "plain" | "repository-primary" | "repository-worktree";
  repositoryGroupId?: RepositoryGroupId;
  ownership: "user" | "app";
  creationId?: string;
}
```

不在 binding 中保存 Prompt、Session title、Git stderr、源码、完整 status 或 branch history。
当前 branch/head/status 由 Worktree Catalog 重新观察。

## 7. 权威与持久化

| 数据 | 权威 | 是否可重建 |
| --- | --- | --- |
| Worktree path、HEAD、branch、detached/prunable | `git worktree list --porcelain` | 是 |
| Repository grouping | Git common-dir + Main physical identity | 可重新观察，opaque group binding 持久化 |
| Workspace registration/trust/availability | Electron Main Workbench state | 否，需 durable |
| Workspace -> environment ownership binding | Electron Main Workbench state | 否，需 durable |
| 未完成 Worktree mutation | Electron Main Workbench state journal | 否，需 durable |
| Conversation body | Pi JSONL | 否，唯一真源 |
| Session metadata list | disposable Session Catalog | 是 |
| Worktree list/status UI | Main-owned Worktree Catalog | 是 |
| active Runtime/Operation | Agent Host + Protocol projection | 可恢复，不是 Desktop 文件真源 |
| draft text | 现有 encrypted Main-owned draft state | 否，按现有合同 |
| attachments | 现有 process-local staging | 否，跨重启 fail closed |

### 7.1 Workbench state 版本

Worktree 实施需要一次显式 Workbench schema migration，例如 V5：

```ts
interface WorkbenchStateV5 extends Omit<WorkbenchStateV4, "version"> {
  version: 5;
  workspaceEnvironments: WorkspaceEnvironmentBinding[];
  environmentMutations: EnvironmentMutationRecoveryRecord[];
}
```

要求：

- migration 只为现有 Workspace 创建 `kind: "plain", ownership: "user"`；
- migration 不运行 Git，不猜测 Repository relation；
- Phase A 的只读 inspection 成功后，才通过普通 atomic update 补充 observed binding；
- 最大 Workspace 数继续是 100；active/recovery mutation record 建议最大 32；
- corrupt/future-version/quarantine 继续沿用现有 Workbench store 合同。

### 7.2 Worktree Catalog

Catalog 建议独立为 Main-owned bounded projection：

```text
<userData>/workbench/worktree-catalog-v1.json
```

要求：

- temp file + file fsync + atomic rename + best-effort parent fsync；
- 单文件 mutation queue；
- schema、byte、record 和字符串长度上限；
- corrupt 时 quarantine/rebuild，不能清空 Workbench durable binding；
- projection refresh 失败保留上一次 snapshot 并标记 stale/error；
- 不保存 Git stdout/stderr、Prompt、源码、凭据或环境变量。

## 8. 进程归属

```text
Electron Main
|- WorktreePolicy
|- RepositoryIdentityService
|- WorktreeCatalogStore
|- EnvironmentMutationJournal (inside Workbench state)
|- RepositoryMutationScheduler
`- BoundedGitRunner -> packaged private git

sandboxed Renderer
|- New Conversation environment intent
|- Worktree creation/removal controllers
|- typed recovery/error UI
`- existing AgentPortClient for Host registration/Session creation

Agent Host utilityProcess
|- existing workspace.register/unregister
|- existing Pi Session create/fork/resolve
`- no Git Worktree management
```

Renderer 是跨 Main 与 Agent Host 的产品流程协调者，但不拥有 Git 或 Workspace persistence 的
提交点。Main mutation journal 和 Host Session creation journal 分别记录各自副作用；Renderer 只通过
稳定 ID 推进 saga，不能用本地 React state 宣称完成。

## 9. Bounded Git Runner 合同

### 9.1 可执行文件

- 只使用 `DesktopToolchain.gitExecutable` 和 `gitExecPath`。
- toolchain 未 ready 时 Worktree mutation fail closed，并显示可诊断错误。
- 不回退到系统 `git`、`where git`、`which git`、shell alias 或用户 PATH。
- development/test 可以显式注入 runner；production 不允许隐式 fallback。

### 9.2 进程调用

- 使用 `spawn`/`execFile` argument array，`shell: false`，`windowsHide: true`。
- stdin 永远关闭；`GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`。
- 设置精确 `GIT_EXEC_PATH`，PATH 只按现有 private toolchain policy 组合。
- stdout/stderr 分开有界捕获；UI 只接收 error class、stage、exit code、recoverability 和
  truncation flag，不接收 raw output。
- mutation child 必须支持 AbortSignal 和 application shutdown。

### 9.3 命令预算

初始预算需通过真实仓库测量校准，建议起点：

| Stage | 初始上限 | 输出上限 |
| --- | ---: | ---: |
| `rev-parse` / common-dir | 5 s | 64 KiB |
| `worktree list --porcelain` | 8 s | 1 MiB |
| status/removal preflight | 10 s | 1 MiB |
| `worktree add` / exact branch restore | 300 s | 1 MiB |
| `worktree remove` | 30 s | 1 MiB |
| `submodule status --recursive` | 10 s | 1 MiB |
| `submodule update --init` | 120 s | 1 MiB |
| branch/merge-base cleanup | 10 s | 256 KiB |

预算不是成功证据；timeout 后必须终止并确认进程树退出。

### 9.4 进程树与 indeterminate

- POSIX 使用独立 process group，先 `SIGTERM` 再 `SIGKILL` 并观察 group 消失。
- Windows 优先使用 Job Object；在 Job Object 尚未实现时，使用有界 `taskkill /PID /T` 和 `/F`
  两阶段清理，但 dead root PID 不能证明 descendants 已退出。
- mutation timeout/abort 后若无法证明 child tree 已退出，journal 记录 `indeterminate`，同一
  RepositoryGroup 后续 mutation 全部拒绝，直到 read-only reconcile 证明 Git 状态。
- application shutdown 不报告 graceful，除非所有 active Git mutation tree 已退出或被明确标记为
  unresolved 并保持 fail-closed fence。

### 9.5 Repository-scoped serialization

`RepositoryMutationScheduler` 以 `RepositoryGroupId` 为 key：

- 同一 Repository 最多 1 个 Git mutation；
- 不同 Repository 可有界并行，初始全局上限建议 2；
- read-only inspect 可以 single-flight 合并；
- create/remove/reconcile-cleanup 不得互相越过；
- queue 有 bounded count，超限返回 recoverable resource-limit，不创建无界 Promise 链。

### 9.6 当前 Batch D 完整性与恢复合同

- 创建活动只跨进程投影 opaque `creationId`、当前阶段、阶段开始时间、阶段预算和可取消标志。
  阶段为 `preflight`、`queued`、`checkout`、`submodules`、`verifying`、
  `workspace-registering`；Renderer 轮询进度只用于展示，最终创建 receipt 仍是权威。
- 排队期取消会从有界队列移除尚未执行的 mutation；Git 已开始后的取消会终止私有 Git，随后按既有
  exact branch/path/HEAD/clean preflight 回滚。只有回滚确认后才返回 `cancelled`；无法证明清理时继续
  fence Repository。应用退出先取消创建 flight，再 dispose mutation scheduler 和 inspection runner。
- `git submodule status --recursive` 只投影 `total/uninitialized/divergent/conflicted` 计数，不跨
  Preload 暴露 URL、路径或 Git 输出。新 Worktree 只会自动尝试已存在于同一 Git common-dir 的
  top-level Submodule object：逐项覆盖到已验证的本地 module source，`--no-fetch`，并禁用 HTTP、
  HTTPS、SSH 和 Git transport。普通 `submodule update` 可能重新 clone，因此不能作为“本地优先”。
- 需要网络的 Submodule 只在用户点击“联网补齐”后运行；该动作仍禁用交互式 credential prompt，
  不自动写 Git config，也不把失败伪装成完整。divergent 或 conflicted 状态不通过网络动作覆盖。
- 缺失恢复只适用于 durable binding 标记为 app-owned、创建记录已 `committed`、source Workspace
  可用且可信的 Worktree。UI 明确说明只重建已提交的 branch 状态，原目录中的未提交改动和未跟踪
  文件无法恢复。
- 恢复只处理 profile 内 exact target。若 Git 留有该 exact missing registration，只定点执行
  `git worktree remove --force <exact-target>`；禁止 Repository-wide `git worktree prune`。随后 checkout
  已存在的 exact branch，验证 common-dir、branch、HEAD、非 detached/locked/prunable 和 clean status。
  如果上一次 Git 恢复成功但 Workbench state 写入失败，重试只对账同一精确 Worktree 并补写状态；
  foreign、dirty、branch elsewhere、identity drift 或任何 ambiguous target 都 fail closed。
- Turn/Session 启动、Provider command 或普通 inspection 永远不触发上述恢复或网络动作。

## 10. Git 安全与信任

`git worktree add` 会 checkout 文件，并可能受到 hooks、filters、LFS、global/repository config 和
外部进程影响。用户点击“隔离 Worktree”是明确产品动作，但不能把潜在任意 checkout side effect
隐藏成普通目录创建。

初始策略：

- 使用 Main-owned empty hooks directory 覆盖 `core.hooksPath`，禁止 checkout hook。
- 设置 `GIT_LFS_SKIP_SMUDGE=1`，Phase 1 不允许 Worktree 创建隐式下载 LFS 内容。
- preflight 检查 configured filter process。已知 LFS 以 pointer-file 状态继续并显式提示；未知
  custom filter 默认阻止 mutation，后续可增加单次确认和更强隔离。
- 不运行 remote fetch/pull，不解析远端 branch，不安装依赖。
- `safe.directory` 只允许对 native-picker 已信任的 exact Workspace 做单次进程内 `-c` override，
  不写 global/system Git config。
- 使用 scoped `-c core.longpaths=true` 支持 Git for Windows long paths，不修改用户仓库配置。
- Worktree root 必须是 Main 创建并验证的 `<userData>/worktrees` real directory；拒绝 symlink、
  junction escape、ADS、NUL 和 root containment 失败。
- 创建路径和 branch 均由 Main 生成，Renderer 不提供 raw path/branch。

## 11. 命名与路径

推荐：

```text
directory:
  <userData>/worktrees/<group-token>/<worktree-token>

branch:
  pi67/task-<worktree-token>

display label:
  隔离任务 <short-token>
```

约束：

- `group-token` 和 `worktree-token` 使用 lowercase ASCII、固定长度、无用户内容；
- branch 只允许 `pi67/task-[a-z0-9-]+`，长度有界；
- 不使用 repo name、Prompt、Session title、用户名或绝对路径生成持久化名称；
- UI auto-title 只改变对话展示，不 rename branch/path；
- 未来显式 branch rename 是独立 Git mutation，需要自己的 preflight、approval 和 recovery，不在
  Phase B 范围。

## 12. 状态模型

### 12.1 Read-only observation

```text
unknown
  -> inspecting
  -> non-git | ready | missing | detached | prunable | protected | error
```

`dirty`、`untrackedCount`、`ahead/unmerged`、`headSha` 和 `branchName` 是 observation fields，不应
被塞进单一 lifecycle enum。

### 12.2 Creation mutation

```text
reserved
  -> git-materializing
  -> git-materialized
  -> workspace-registered
  -> host-registering
  -> host-registered
  -> session-materializing
  -> session-bound
  -> committed

known failure before session-bound:
  -> rollback-pending
  -> rolled-back | rollback-protected | failed

unknown outcome / process-tree uncertainty:
  -> indeterminate
```

### 12.3 Removal mutation

```text
prepared
  -> host-releasing
  -> host-released
  -> git-removing
  -> git-removed
  -> state-cleaning
  -> committed

branch cleanup:
  committed + branch-deleted
  committed + branch-retained

failure:
  protected | stale-preflight | indeterminate | failed
```

State transition 必须由 domain pure functions 校验；Main 不允许直接跳过 durable stage。

## 13. Renderer-Main IPC

所有 payload/result 在 `packages/protocol` 使用 strict TypeBox schema。当前 creation API 是：

```ts
inspectRepositoryEnvironment({ workspaceId })
  -> RepositoryEnvironmentSnapshot

createWorktreeEnvironment({
  requestId,
  creationId,
  sourceWorkspaceId
})
  -> { creationId, workspace, repositoryGroupId, state }

advanceWorktreeEnvironment(
  | {
      creationId,
      targetState: "workspace-registered" | "host-registering" |
        "host-registered" | "session-materializing" | "committed"
    }
  | { creationId, targetState: "session-bound", sessionFileIdentity }
)
  -> EnvironmentCreationReceipt

rollbackWorktreeEnvironment({
  requestId,
  creationId,
  sourceWorkspaceId
})
  -> EnvironmentRollbackReceipt

prepareWorktreeRemoval({ workspaceId })
  -> WorktreeRemovalPreflight

removeWorktreeEnvironment({
  workspaceId,
  removalId,
  preflightRevision
})
  -> WorktreeRemovalReceipt
```

要求：

- `creationId/removalId/requestId` caller-stable；同 ID + 同 fingerprint 返回同一 receipt；同 ID +
  不同 payload 拒绝。
- Main 根据 `sourceWorkspaceId/workspaceId` 查找已持久化路径；不接受 cwd/path。
- create API 不接受 `force`、branch、start point 或 Git args。
- removal 必须绑定 exact preflight revision；Git state、Workspace state 或 Task blocker 改变即
  `stale-preflight`。
- response 不返回 raw Git output、环境变量或 private Git path。

Main-Agent Host 继续复用现有：

```text
workspace.register
workspace.unregister
session.create
session.creation.resolve
session.fork
prompt.submit
```

不为 Worktree 建立第二套 Agent Host protocol。

## 14. 新对话创建 saga

### 14.1 当前工作区

维持现有路径：Renderer-only intent 在首次提交时创建一次 Pi Session，再提交 Prompt。Worktree 功能
不得改变普通 Workspace 的时序或错误语义。

### 14.2 隔离 Worktree

推荐顺序：

1. 用户在新对话 surface 选择 `隔离 Worktree`，继续编辑 draft/attachment；无 Git 副作用。
2. 首次提交捕获 source Workspace、draft revision、attachment handles 和稳定
   `environmentCreationId`。
3. Main read-only preflight：toolchain ready、Workspace available/trusted、Git repository、common-dir
   identity、HEAD SHA、filter/hook risk、profile root containment 和 repository mutation capacity。
4. Main 在 Workbench state 原子写入 `reserved` journal。
5. Main 按 RepositoryGroup 串行执行 private Git `worktree add -b <opaque branch> <path> <exact SHA>`。
6. Main 重新观察新 path/common-dir/HEAD，创建 native `WorkspaceDescriptor`，在一次 Workbench state
   update 中注册 Workspace、写 environment binding、推进到 `workspace-registered`。
7. Renderer 通过现有 Host protocol 注册新 Workspace；成功后向 Main 提交
   `host-registered` receipt。
8. Renderer 把原 draft/attachments 原子转移到新 Workspace 的 provisional Task，并开始现有
   Session creation flow。
9. `session.create` 已明确 materialized 后，Renderer 向 Main 提交 exact Session binding receipt，
   Main 推进 `session-bound -> committed`。
10. Renderer 提交首条 Prompt。Prompt 失败不回滚 Worktree/Session；保留 draft/attachments 并允许
    在同一 Session 重试，绝不再次创建 Worktree 或 Session。

### 14.3 失败语义

- Git add 明确失败且 reconcile 证明没有 path/branch：journal 可标记 failed，无 rollback。
- Git path 已创建但 Workspace registration 失败：creation service 只回滚本次 app-owned exact
  artifact；使用 `worktree remove --force` 和 `branch -D` 前必须证明 branch/path/HEAD/common-dir 仍等于
  本次 creation receipt、没有用户变化。无法证明则 `rollback-protected`。
- 对外 rollback 只允许 durable state 仍为 `workspace-registered`、Main 尚未推进到
  `host-registering`、没有 runtime/session recovery authority、Workspace binding/path/branch/HEAD/
  common-dir 全部 exact、且 Worktree clean、non-detached、non-locked、non-prunable 的情况。Main 必须先
  原子写入 `rollback-pending + rollbackSafety: pre-host-confirmed`，再清理 Git artifact 和 Workspace
  registration。startup reconcile 只有看到该安全标记才可继续收尾；不能从 `rollback-pending` 猜测权限。
- Host registration 开始后或 Session materialization 开始后禁止自动 rollback。失败或未知结果保留
  Worktree 和 recovery authority，进入可恢复或受保护状态，而不是推断 Host 没有接触该 Workspace。
- Session creation `REQUEST_OUTCOME_UNKNOWN`：禁止 rollback。保留 Worktree，使用现有
  `session.creation.resolve`；只有明确 missing 才允许回滚。
- Session 已 materialized、Prompt 失败：commit 环境和 Session，不回滚。
- Renderer/window crash：startup 从 Main mutation journal + Workbench recovery + Host Session creation
  journal 继续，不按 UI memory 猜测。

## 15. Fork saga

1. 先在 source Session authority 下执行现有 `validate fork`；验证失败不创建 Git artifact。
2. 用户选择 current Workspace 时走现有 fork。
3. 用户选择 isolated Worktree 时复用 environment creation saga，但 `startPoint` 仍是 source physical
   Workspace 的 exact Git HEAD，不是 Session tree node。
4. Host 注册新 Workspace 后调用 `session.fork`，target Workspace 为新 Worktree。
5. forked JSONL 和 transcript bootstrap 已发布后 commit environment mutation。
6. fork unknown outcome 保留 Worktree 并恢复；不得重复 fork 或删除可能承载新 JSONL 的环境。

Git branch 与 Pi Session tree 是两套不同维度：Git Worktree 隔离代码目录，Pi fork 创建新的 JSONL。
UI 必须避免把二者都称为“分支”而造成误解。

## 16. 删除 preflight 与 saga

### 16.1 UI 必须显示

- display label 和 `WorkspaceId` 的短标识；
- branch 或 detached 状态；
- 目录位置（安全可读展示，不进入默认日志/诊断）；
- app-owned / user-owned；
- clean/dirty；
- untracked count；
- staged/unstaged summary；
- branch 是否 merged 到选择的 target；
- ahead/unmerged 状态；
- 是否有 active/initializing/provisional Task；
- 是否有 draft/attachment；
- 是否是当前 active Workspace；
- 删除后 branch 会删除还是保留；
- preflight timestamp/revision 和可能已经过期的提示。

### 16.2 默认 blocker

- primary Workspace；
- non-app-owned Worktree；
- unavailable/path-only-unconfirmed/identity-changed Workspace；
- active、initializing、waiting、provisional Task；
- draft 或 attachment；
- dirty、untracked、staged 或 unresolved merge；
- detached HEAD；
- branch 不属于 `pi67/*`；
- branch unmerged；
- Worktree path 不在当前 profile-owned root；
- Git/Workspace identity 与 preflight 不一致；
- active Git mutation 或 indeterminate Repository；
- Host unregister 返回 busy 或无法确认完成。

### 16.3 删除顺序

1. Main read-only preflight 返回 exact revision 和 typed blocker。
2. UI 使用专用 destructive dialog 进行 one-shot confirmation，不复用 Pi Tool approval，也不使用
   简单 `window.confirm`。
3. Renderer 再检查 Task/draft/attachment，并调用 Host `workspace.unregister`。
4. Main 重新执行 exact preflight；任何 drift 返回 `stale-preflight`。
5. Main 写入 durable removal journal。
6. Main 使用不带 `--force` 的 `git worktree remove`。
7. Git removal 成功后，Main 原子清理 Workspace registration/environment binding，并请求清理现有
   draft/file state。跨文件清理失败由 journal 在 startup 继续。
8. 只有 app-owned `pi67/*` 且 `branch -d` 成功才删除 branch；否则返回 `branch-retained`，不把
   Worktree 删除回滚成失败。
9. Renderer 清理 projection 并选择可用 fallback Workspace。

如果 Git 已删除但后续 state cleanup 失败，不能尝试重新创建同名 Worktree。journal 在 startup
完成 state cleanup，branch 默认保留。

## 17. Startup reconcile

Startup reconcile 是有界、可观察、非阻塞的 recovery，不是静默垃圾回收。

顺序：

1. 加载并 refresh Workbench Workspace physical identity。
2. 读取 active environment mutation journal。
3. 对已注册且 available 的 Repository Workspace 执行 bounded common-dir/worktree inspection。
4. 重建/刷新 Worktree Catalog；单个 Repository 失败不阻断其他 Workspace 或普通 Session。
5. 对未完成 create/remove operation 按 exact receipt 推进、标记 protected 或展示恢复动作。
6. 发现 profile-owned orphan 时默认标记 `orphaned/protected` 并在 UI 可见。
7. 只有同时满足以下条件才允许自动清理：
   - app-owned exact path 和 `pi67/*` branch；
   - 没有 Workspace/Task/Session creation/draft/attachment reference；
   - clean、无 untracked、非 detached；
   - branch 已 merged；
   - 没有 active/indeterminate operation；
   - Git identity 与 durable creation receipt 完全一致。
8. 自动清理也不使用 `branch -D`；失败时保留并显示 bounded diagnostic。

Alpha 初期建议默认只报告、不自动清理 orphan。收集真实用户证据后再开启上述严格自动路径。

## 18. 产品与交互

### 18.1 New Conversation

```text
环境
[ 当前工作区 ] [ 隔离 Worktree ]

当前工作区：直接在已选择目录中工作
隔离 Worktree：首次发送时创建独立代码目录和 pi67/* branch
```

- 非 Git Workspace 禁用 Worktree 选项，并显示明确原因。
- private Git/toolchain unavailable、Repository inspection pending/error 都是可见状态。
- 选择 Worktree 后 Composer draft 不丢失，切回 Local 也不产生 Git 副作用。
- 首次提交期间显示可分阶段状态：准备 Repository、创建 Worktree、注册 Workspace、创建对话、发送。
- outcome unknown 使用“正在确认创建结果”，不显示通用失败并允许重复点击。

### 18.2 Navigation

目标信息架构：

```text
Repository group
|- 主工作区
|  `- conversations
`- 隔离任务 / worktrees
   `- conversations
```

- Worktree 使用图标 + 文本/accessible label，不仅依赖颜色。
- active conversation 始终显示 environment context。
- missing/protected/orphaned/dirty 状态可见，但不在导航内执行隐式修复。
- 初期可在现有 Workspace rail 上增加 parent grouping，不改变 Conversation/Task 语义。

### 18.3 Recovery

提供专用 recovery surface：

- 继续注册并打开；
- 重新检查 Git 状态；
- 在系统文件管理器中打开；
- 保留 Worktree、只移除 Pi-67 注册；
- 在满足安全 preflight 时删除 app-owned Worktree；
- 对已提交的 app-owned 缺失 Worktree，显式重建 branch 当前提交状态；
- 在 Submodule 仅缺少 object 且无 divergent/conflict 时，显式执行联网补齐；
- 导出不含 raw path/content 的 bounded diagnostics。

## 19. Windows 设计要求

### 19.1 路径与身份

- 只支持 Windows x64 packaged private Git。
- canonicalization 必须处理 drive-letter case、separator、non-ASCII、long path 和 path-only fallback。
- UNC Workspace 可以 read-only inspect；是否允许 app-owned Worktree root 位于 UNC 初期建议禁止，
  始终在 local profile-owned userData 下创建。
- 拒绝 target root symlink/junction escape 和 NTFS ADS。
- Worktree root 使用短 opaque path segments，避免把 repo/title 复制进 AppData 深路径。
- Git 输出 path 的 case/short-name 表示不能单独覆盖 Main filesystem identity。

### 19.2 Git 与 checkout

- 使用 bundled `git.exe` + exact `GIT_EXEC_PATH`；不依赖 Git Bash。
- argument array，不经过 PowerShell/CMD quoting。
- scoped `core.longpaths=true`。
- 禁止 interactive credential/helper prompt。
- checkout hooks disabled；LFS 自动 smudge disabled；unknown filters fail closed。
- Git error 需分类：toolchain unavailable、dubious ownership、path too long、locked file、filter blocked、
  repository busy、timeout、process-tree cleanup unproven。

### 19.3 文件锁与生命周期

- Agent Host Workspace services、Session Catalog watcher、future Terminal 和 Renderer file state 必须在
  remove 前释放。
- locked file/Defender/EDR 失败不自动 force；显示 retry 和保留目录。
- sleep/resume 后先 refresh identity 和 Git observation，再允许 mutation。
- app quit/relaunch 不能遗留仍被误报为已结束的 Git child tree。
- uninstall 默认不删除 userData Worktree；卸载器不得把用户 commit 当应用缓存清理。

### 19.4 Windows 证据门禁

Windows maturity 至少需要 exact source SHA、candidate identity、installer SHA-256 和真实 Windows x64
installed lifecycle：

1. clean install；
2. non-ASCII Windows account/profile；
3. 添加普通 Git Workspace；
4. Local 创建/打开对话；
5. Worktree 创建、Session materialize、Prompt；
6. restart/reopen exact Worktree Session；
7. dirty/untracked/unmerged 删除保护；
8. clean merged removal + branch retention/deletion；
9. locked file/Defender-like contention；
10. sleep/resume；
11. upgrade；
12. uninstall/reinstall 后 Worktree 保留和 recovery。

hosted Windows、unit tests、macOS packaged smoke 和 `pi-gui` Windows 脚本不能替代这些证据。

## 20. macOS 设计要求

- 只验证 macOS Apple Silicon packaged artifact。
- private Git 路径、quarantine/notarization 和 app relocation 后资源解析必须保持稳定。
- profile-owned Worktree 不放进 `.app` bundle，也不因 preview 替换 app bundle 被删除。
- APFS case-sensitive/case-insensitive volume、external volume 和 file identity 需要测试。
- 当前 exact `preview:mac:unsigned` 已验证 private Git Repository inspection、Repository status、
  Local/Worktree intent 和 Batch D UI/inspection；打包内 private Git 与精确 `GIT_EXEC_PATH` 已通过
  26/26 Worktree、Submodule 和 recovery fixtures。该 smoke 没有在用户真实 Repository 中手工走完
  Worktree 创建、联网补齐、恢复、重启和删除生命周期。

## 21. 分阶段实施

### Phase A：Read-only Repository/Worktree Inspection

当前状态：源码和定向测试已实现；macOS arm64 unsigned packaged smoke 已验证 private Git
Repository inspection，Windows x64 installed 仍未验证。

范围：

- domain identity/view types；
- strict Renderer-Main protocol schemas；
- Main private Git inspection runner；
- common-dir grouping；
- Worktree Catalog projection；
- non-Git/toolchain unavailable/error/stale UI；
- no Git mutation。

验收：

- Renderer 不能提交 path/Git args；
- 普通 Workspace/Session 主链路无行为变化；
- 已注册 primary/linked/manual Worktree 被正确分组；
- Catalog 删除后可重建；
- 单个 Repository timeout 不阻断其他 Workspace；
- Windows path fixtures 和 real Git integration tests 覆盖 case/non-ASCII/long-path contract。

### Phase B：Transactional Worktree Creation

当前状态：Workbench V5、Main creation/reconcile/rollback、Renderer creation saga、草稿环境 intent 和
可见 `Local | Worktree` 入口已实现；定向 unit/integration/browser fixture 已覆盖。当前 exact
macOS arm64 unsigned artifact 已通过 packaged smoke/open，打包内 private Git fixtures 也覆盖了
Worktree 创建、取消、Submodule 和 recovery，但没有在用户真实 Repository 中通过 packaged UI
手工走完完整生命周期；Windows x64 installed lifecycle 和用户 Windows 真机仍未验证，Phase B
不能据此标记为跨平台完成。

范围：

- Workbench V5 environment binding + mutation journal；
- Repository-scoped scheduler；
- private Git create；
- New Conversation `Local | Worktree`；
- Workspace registration；
- Session creation integration；
- known-failure rollback；
- unknown-outcome recovery。

验收：

- repeated click/retry 只产生一个 Worktree/branch/Session；
- exact HEAD SHA start point；
- create success + Host failure、Session known failure、Session unknown、Prompt failure 各自符合语义；
- crash at every durable stage 可恢复且不丢 draft/commit；
- Prompt/title 不出现在 branch/path/log/diagnostics；
- private Git unavailable 时 fail closed，无 system fallback。

### Phase C：Safe Removal and Reconcile

范围：

- typed removal preflight；
- destructive confirmation dialog；
- Host release ordering；
- non-force Git removal；
- safe branch cleanup；
- orphan/protected/recovery surface；
- startup mutation reconcile。

验收：

- primary/manual/dirty/untracked/staged/unmerged/detached/running/draft/attachment 全部阻止删除；
- stale preflight 不执行；
- Git removed + state cleanup crash 可继续；
- unmerged branch 永远保留；
- timeout/process-tree unproven 阻止后续 mutation；
- 不依赖 `window.confirm`。

### Phase D：Product UI Completion

范围：

- Repository group navigation；
- environment marker；
- Fork to Worktree；
- recovery states；
- keyboard/focus/reduced-motion/light/dark；
- PRODUCT/DESIGN/DESIGN.dark 更新。

验收：

- 用户不用理解 Git worktree 命令即可完成创建、恢复和安全删除；
- Local/Worktree、Git branch/Pi Session tree 的语言不混淆；
- narrow/wide layout、keyboard-only 和 screen-reader label 可用；
- visual review 使用真实 renderer/native artifact，不以 source screenshot 替代。

### Phase E：Git Diff

建立 Main-owned Git status/diff authority、bounded Patch、pathspec 和 stage boundary。不得复用 Session
Changes 冒充完整 Git Diff；二者需要明确来源标签和独立 freshness/revision。

### Phase F：PTY Terminal

Terminal 最后接入，默认 cwd 必须是 exact selected physical Workspace/Worktree。Terminal process tree、
shell discovery、resize、shutdown、Windows ConPTY 和 session persistence 另行设计，不能借 Worktree
范围顺带实现。

## 22. 代码落点建议

建议新增或扩展：

```text
packages/domain/src/repository-environment.ts
  identities, observation, mutation state machines, removal policy

packages/protocol/src/repository-environment-contract.ts
packages/protocol/src/repository-environment-schemas.ts
  strict Renderer-Main payload/result

apps/desktop/src/repository-identity.ts
apps/desktop/src/worktree-git-runner.ts
apps/desktop/src/worktree-catalog-state.ts
apps/desktop/src/repository-mutation-scheduler.ts
apps/desktop/src/worktree-environment-service.ts
  Main policy, private Git, persistence and receipts

apps/desktop/src/workbench-state-v5.ts
apps/desktop/src/workbench-state-environment.ts
  migration, binding and mutation recovery

apps/renderer/src/worktree/*
  inspection, creation/removal/recovery controllers and views
```

不要创建 generic `utils/helpers/common`。Process-tree code 只有在 Desktop Git runner 与现有 Agent Host
Package Worker 形成两个真实调用方且错误语义可统一时，才提取共享模块；否则先保持各 owner 内的
清晰实现。

## 23. 测试与验证矩阵

### 23.1 Domain

- identity matching and path-only confirmation；
- allowed state transitions；
- duplicate/stale operation rejection；
- removal blocker matrix；
- app-owned branch/path classification；
- branch retention policy。

### 23.2 Protocol

- exact schemas、unknown fields、oversize、invalid IDs；
- Renderer path/branch/Git arg injection rejection；
- same ID/same fingerprint replay；
- same ID/different fingerprint rejection；
- stale preflight revision。

### 23.3 Main integration

- real throwaway Git repositories；
- primary/linked/detached/prunable parsing；
- common-dir grouping；
- exact SHA create；
- per-repo serialization and cross-repo bounded parallelism；
- timeout/output truncation/process-tree cleanup；
- atomic Workbench journal and Catalog rebuild；
- corrupt state quarantine；
- create/remove crash-point recovery；
- filter/hook/LFS policy；
- symlink/junction/root escape rejection。

### 23.4 Renderer/Host integration

- draft/attachment transfer；
- Host register failure；
- Session creation materialized/missing/ambiguous/unavailable；
- Prompt failure after materialization；
- Host epoch replacement and stale ACK rejection；
- active Task/draft blocker；
- recovery UI actions。

### 23.5 E2E/package

- Local baseline first；
- Worktree create/select/restart/fork/remove；
- profile isolation；
- legacy/manual Worktree preservation；
- packaged private Git identity；
- macOS arm64 packaged preview；
- Windows x64 exact installed lifecycle。

## 24. 性能预算

需要新增测量：

- 1/10/50/100 Worktree 的 `worktree list --porcelain` latency/bytes；
- Repository grouping startup cost；
- Catalog cold rebuild/warm load；
- large repository create checkout time；
- Windows Defender/EDR 下 create/remove tail latency；
- Renderer first usable Workspace 不等待所有 Repository inspection；
- mutation queue wait time 和 timeout rate。

目标：

- 普通非 Git Workspace 不承担 Git process cost；
- startup 不因一个 Repository inspect 失败进入全局失败页；
- Worktree Catalog/UI 使用 cached stale-while-refresh；
- Git mutation 进度不阻塞 transcript streaming 或已有 Task。

## 25. 诊断与隐私

允许记录：

- operation ID digest；
- RepositoryGroupId/WorkspaceId 的 bounded opaque value 或 digest；
- stage、duration、exit code、timeout、output truncated、recoverability；
- observation/mutation state；
- blocker category count。

禁止默认记录或导出：

- raw Workspace/Worktree/common-dir path；
- Prompt、Session title、source body、Patch、file name inventory；
- Git stdout/stderr；
- environment、credentials、cookies、tokens；
- private Git executable path；
- arbitrary branch names。app-owned branch 可只导出 classification，不导出完整值。

支持包只增加 bounded Worktree diagnostic projection，不改变当前 Main-owned export trust boundary。

## 26. Rollout 与 rollback

### 26.1 Feature rollout

- Phase A inspection 独立存在，不因一个 Repository 失败阻断普通 Workspace/Session。
- Phase B 的 app-owned creation 已接入 provisional conversation；Phase C 完成前仍不开放删除。
- Phase C/D 通过前不把 removal、Fork、Repository grouping navigation 当作已交付能力。
- Windows promotion 必须等待 exact installed lifecycle；macOS 通过不能代替。

### 26.2 Software rollback

- 旧版本忽略未知 Worktree Catalog，但不能因 future Workbench schema 把 state 当 corrupt reset。
- Workbench V5 已是当前 durable schema；降级版本不得把未知 schema 当作 corrupt state 重置或覆盖。
- feature flag 关闭时保留已注册 Worktree Workspace 和 Session 可读，不执行 Git mutation。
- rollback 版本不得自动清理 `<userData>/worktrees`。

### 26.3 Artifact rollback

- candidate rollback 只替换应用 artifact，不删除 Worktree、branch、Pi JSONL 或 userData。
- uninstall/reinstall 后 Main 根据 durable binding + Git observation 恢复。

## 27. 未决项与默认建议

| 未决项 | 默认建议 | 反转条件 |
| --- | --- | --- |
| Git executor 是否独立 utility process | 先留 Main | profiling 或 shutdown 证明 Main 方案不满足预算 |
| orphan 是否自动清理 | Alpha 默认只报告 | Windows/macOS 真实证据证明严格 predicate 稳定 |
| custom checkout filters | 默认阻止，LFS pointer-only | 有隔离 executor、明确批准和可恢复下载语义 |
| Worktree 是否允许 UNC root | app-owned root 禁止 UNC | 完成 UNC identity/locking/installed tests |
| branch 是否从 title 派生 | 禁止 | 用户明确 opt-in 且隐私/rename/recovery 合同完成 |
| 是否自动删除 merged branch | 仅 app-owned `branch -d` | 永不允许自动 `-D` |
| 是否在 Phase B 支持 Fork | 创建稳定后再接 | create saga、Session resolve 和 crash tests 全绿 |

## 28. Upstream 持续吸收

`pi-gui` 保持长期一级产品参考，但不是自动 merge upstream：

1. 每周只读 drift audit 继续比较默认分支 HEAD 和许可证。
2. drift 只生成 bounded report，不自动改 lock、源码、Issue、PR 或 Git remote。
3. 只有 Worktree、Terminal、Diff、Orchestrator、Session recovery 等当前 roadmap 路径发生高价值变化时，
   才锁定新的完整 commit 做 source/tests/runtime review。
4. 每次吸收使用 `ADOPT | ADAPT | KEEP | REPLACE | DEFER` 决策，记录 source hash、目标边界和验证。
5. 上游能运行只证明其产品路径；Pi-67 仍需自己的 exact source、packaged artifact、Windows/macOS
   lifecycle 和 Pi authority 证据。

## 29. 当前实现收口条件

当前 Phase B creation batch 只有在以下证据全部独立记录后才可收口：

- strict Protocol revision、Domain/Main/Renderer 定向测试、typecheck、lint 和 build 通过；
- Renderer browser 验证默认 Local、ready Worktree、禁用/错误状态、草稿恢复与选择零 Git 副作用；
- 全量 `check` 与 Renderer Playwright 最终 exit code 通过；
- 当前 source 对应的 macOS arm64 unsigned packaged artifact 通过 smoke 并记录 exact `app.asar` identity；
- Windows x64 installed 明确保留 `UNVERIFIED`，直到独立机器完成配置读取、Workspace registration、
  Local/Worktree Session 创建、Prompt、重启、中文路径、休眠和 installed lifecycle；
- P0 配置/ModelRuntime/Workspace/Session 修复继续作为独立主链路验证，不能用 Worktree 能力代替。

## 30. 上游证据

以下文件来自锁定的 `pi-gui` commit，仅作为重新设计依据：

```text
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

Pi-67 没有复制这些源文件。本规划吸收产品流程和工程原则，后续实现仍必须适配 Pi-67 的
Main/Renderer/Agent Host 分层、协议、物理身份、Session 真源和平台证据合同。
