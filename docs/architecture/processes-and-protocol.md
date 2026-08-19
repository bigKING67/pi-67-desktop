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
  project trust、一次性批准、disposable metadata Session Catalog，以及由 Pi 配置与 Agent Host
  Workspace 文件共同复用的有界原子文件 replace。
  `PiSdkRuntime` 只保留 `AgentRuntime` 操作语义；`RuntimeSessionBindings` 独占 Pi SDK
  `AgentSessionRuntime`、services、session generation、extension rebind 和 transition 生命周期。
- `apps/agent-host`：protocol command router、错误脱敏和 runtime 生命周期。
- `apps/desktop`：窗口、Preload、`app://`、utility process、更新与原生对话框。
- `apps/renderer`：产品 UI；不读取文件、凭据或 Pi SDK。

依赖方向由 `eng/quality/check-architecture.mjs` 检查，并包含循环依赖检测。

## Workspace identity and atomic file mutations

Electron Main 的 Workspace Registry 保存稳定 `workspaceId`、native canonical path、lossless
`dev` / `ino` / `birthtimeNs` 物理身份（可用时）和最近一次成功验证时间。同一挂载周期内的重复目录判定
继续严格比较三项物理字段；跨启动恢复则区分持久文件身份和挂载期设备编号：macOS/APFS 在重启或重挂载后
可能只改变 `dev`，因此仅当 native canonical path、`ino` 和 `birthtimeNs` 仍全部精确匹配时，Main 才更新
`dev` 并恢复原 trust。旧版严格比较已经生成的 bounded `identity-changed + unknown` 误报也只在这组精确条件
下恢复。路径、`ino` 或 `birthtimeNs` 任一变化仍标记 identity changed 并撤销继承 trust；路径缺失按
offline 状态保留注册但禁止 Host admission。只有 path-only 证据时，即使 canonical path 字符串相同也进入
`needs-confirmation`，必须经 native picker 明确修复。用户通过 picker 选择移动后的同一目录或明确选择替代
目录属于显式 rebind；Main 不扫描无关用户目录猜测 relocation。

Pi Provider/configuration、Context Markdown 和 Agent Host Workspace file save 使用同一
`safeAtomicReplaceFile`：在目标同目录以 `wx` 创建临时文件、写入并执行 file fsync，在调用方最后一次
opaque revision 校验后 atomic rename，再 best-effort sync parent directory。Windows rename 仅对
`EACCES` / `EPERM` / `EBUSY` 使用 25/50/100/200/400 ms 有界退避；`EEXIST`、revision conflict、
path escape、invalid payload 和其他错误不重试。Pi 配置仍在 path-scoped lock 内校验 aggregate revision；
Context/Provider validation 或 Runtime reload 失败时，只有当前文件仍等于本次写入版本才允许回滚，外部
再次修改会保留冲突而不是覆盖。该合同不把多个独立用户操作伪装成不存在的多文件事务。

## Startup and recovery

1. Main 注册 secure `app` scheme 并创建窗口；Welcome 不启动 Agent Host。
2. 用户选定 workspace 或运行依赖 Agent Host 的恢复与诊断后，renderer 通过窄 IPC 请求按需启动。
3. Agent Host 启动协调器先按 Agent 目录和有效 Desktop capability receipt 分类
   `fresh | existing-shared | desktop-managed-upgrade`，再依次处理 Desktop capabilities、managed Packages、
   retired MCP cleanup、browser67 MCP 和核心 Server construction。它不检查系统 `pi` 命令，也不创建第二套
   Profile。`existing-shared` 的无 receipt 资源全部视为用户拥有；Desktop 只写
   `desktop-capabilities/**`、`rules/pi67-desktop/**` 和带有效 receipt 的精确 MCP 条目。首次在 shared
   Profile 写入 capability state 时会持久化 `profileOwnership=shared`，后续升级仍保持 shared 分类。
   Alpha.21 等旧 state 没有该 ownership 字段，同样按 shared 迁移，不能由旧 capability 安装事实推断整个
   Profile 归 Desktop 所有。
4. `fresh` packaged Profile 的 capability manifest/hash/private toolchain 错误属于确定性 fatal；
   existing/shared 或 managed-upgrade Profile 的用户资源冲突、MCP cache/CAS conflict 和 Desktop-owned
   enhancement I/O failure 只形成最多八条安全 startup issue。核心 Server 构造成功后 Host 发送严格的
   `agent-host-ready { startup }`，状态可为 `ready` 或 `degraded`；消息不含 path、raw error 或 stack。
5. Agent Host `spawn` 且 Main 收到有效 ready 后才转移新的 MessagePort；窗口 reload 的 `did-finish-load` 以及 renderer
   的显式恢复请求都会为仍存活的同一 Host broker 新 Port，而不会 fork 第二个 Host。若 Host 正处于
   supervised restart backoff，恢复请求不能绕过退避计时器。
6. Preload 只在可信 renderer origin 上转交 MessagePort；renderer 的
   `AgentConnectionController` 独占 Client 生命周期；feature controller 发出 typed request，Store 只消费
   typed event 与 teardown，组件不持有底层 Port。Controller 只接受当前 window source 与精确 origin 的 handoff；
   Port `close`、`messageerror`、Host generation replacement 或 Controller dispose 会立即释放旧 Client、
   拒绝 pending request 并阻止旧响应重新进入 Store。Controller dispose 同时移除全局 message listener，
   后续 handoff 和公开请求均 fail closed。
7. 用户选定 workspace 后发送 `workspace.open`；Host 以同一
   `runtime.initialize(payload)` 生命周期加载 Pi SDK，并通过 `runtime.ready` 投影权威
   `sessionGeneration`。`session.create` 只在当前 workspace 创建新 Session，不接受伪 cwd。
8. 未发送结构化 startup failure 的未知 crash 在 60 秒内最多自动重启三次，退避为 0.5/1/2 秒。
   `agent-host-startup-failed` 是确定性失败：Main 记录安全 stage/issue、向当前 Renderer document 只发送
   一次失败并停止自动重启。显式 Main-owned restart 可开始新 Host epoch。
9. 新端口携带 `appInstanceId` 与 `hostEpoch`。Renderer 的连接请求是有界 single-flight：Port-only
   断线会自动请求 renewal，重复调用不会并行建立多条恢复链。若 Main 已交接一个开放 Port 但 welcome
   握手尚未完成，后续调用先等待该 Port，不能再次请求交接并关闭握手中的 Client。同 epoch 重连通过
   `projection.resync` 恢复 Snapshot、Recorded Changes、Catalog status、session generation 和 active
   Operation；若 Operation 在断线窗口内结束，resync 还可返回最近的 typed terminal receipt。Renderer
   只在 receipt 的 Operation ID 与断线前 active Operation 相同时恢复它，不采用无关历史。只有
   `hostEpoch` 变化才用当前 workspace、trust、approval mode 与 session path 重新初始化。

打包环境无条件忽略 `PI67_RENDERER_DEV_URL`，只加载 `app://pi67/index.html`；开发环境只接受
精确的 `http://127.0.0.1:5173`。生产协议解析只接受 exact `app://pi67` authority，拒绝 credentials、
port、query、fragment、malformed/repeated percent encoding、encoded separator、control byte、dot segment、
drive/UNC/ADS 形式，并在单次解码后验证 resolved Renderer root containment。导航、redirect 和 Port attach
都重新验证当前 document。
恢复不是成功声明：same-host renewal 必须完成握手和权威 resync，Host replacement 必须完成握手、
`runtime.initialize`、`runtime.ready` 携带的新 `SessionSnapshot` 和对应窄 acknowledgement，之后 UI
才能离开 recovering。

## Application shutdown

`before-quit` 由 Desktop Main 的单一 shutdown controller 持有。第一次 quit 会阻止 Electron
继续退出，立即把 Supervisor 置为 stopping，并执行以下有界链路：

1. 清除 Host restart、poisoned-runtime replacement 和 Port renewal；新的 connect、attach 与窗口创建全部拒绝。
2. Main 发送严格校验的 `agent-host-shutdown` parent message，只携带 reason 和 100-10000ms deadline。
3. Agent Host 关闭 Scheduler 与 managed-resource admission，使未开始的 exclusive/recovery/Queue/Package
   work 失效；新的请求返回 `CONNECTION_CLOSED`，不能在关闭过程中静默执行。Host-owned Package Worker
   supervisor 同时拒绝新操作，对所有 active worker 执行 graceful tree termination，再在有界 grace 后执行
   forced tree termination，并等待 root exit。POSIX worker 以 detached process group 启动；Windows 使用
   `taskkill /PID <pid> /T` 与 `/F` 的两阶段 tree cleanup。只有观察到退出才算该 worker 已清理。
4. Runtime 以 `runtime-dispose` 取消 Extension/Approval 请求；Operation Registry 使用关闭专用语义尝试
   abort active Operation。成功产生一次 `operation.cancelled`，不可取消、abort failure 或 abort timeout 产生
   一次 `operation.lost`，但不触发 poisoned-runtime restart。
5. Runtime dispose 保留 Pi `session_shutdown(reason="quit")` 与 JSONL 所有权；Desktop 不自行写 Session 文件。
6. Host 关闭 MessagePort，返回只含 bounded count 和 Operation 终态的
   `agent-host-shutdown-complete`，随后退出 utility process。Main 只有在收到 completion 且观察到 exit code 0
   后才标记 graceful；deadline 到期则 kill 并继续退出。

Supervisor `stop()` 是 idempotent Promise。graceful 路径等待 Host 实际退出；forced 路径有固定上限，且两条
路径都保持 stopping fence，不能因 late exit、late parent message、`activate` 或 `did-finish-load` 复活 Host。
Shutdown metadata 不包含 Prompt、Session path、命令、source、raw Tool payload 或错误堆栈。

## Package operation isolation

Extension Package 的 check/install/update/uninstall 不在长期存活的 Pi Runtime 对象中执行。Agent Host
为每个操作启动一个 Electron-as-Node worker，但由同一个 Host-owned supervisor 持有全部 child record；
Workspace 间不会各自创建无法统一关闭的 worker owner。每个 request 使用独立 correlation ID、最长 1 MiB
的 JSON IPC response、最多 512 个结果项和字段级长度校验。oversize 或 malformed correlated response
立即 fail closed，不能等待超时后猜测成功。

Package worker 不继承 Agent Host 的完整环境。只允许私有 Node/npm/Git 路径、Package network settings
locator、PATH、临时目录、home/profile locator、Windows system process variables 和 locale；Provider key、
MCP bearer token、OAuth/Cookie、任意 npm auth 环境变量和 Session/Workspace secret 不传入。stdout/stderr
均丢弃且不进入日志。Package worker 仅隔离 Package mutation；它不证明已安装第三方 Extension 的
module import、factory、hook、Tool 或 MCP child 已隔离。

Package mutation 的业务提交点位于 worker 返回之后。Host 先 reload 自己持有的 Pi Settings，再由
`PackageTrustRegistry` 对当前安装目录做 bounded observation，最后把 redacted receipt 持久化到
`<storageRoot>/package-mutation-receipts-v1/<owner digest>.json`。receipt 使用 `0700` 目录、`0600`
文件、进程内串行化、跨进程 lock、2 MiB/512-record 上限和 `SafeAtomicIo` replace。它只保存 source、
idempotency key、fingerprint、owner 的 SHA-256 digest，以及 bounded package name/version、manifest hash、
content hash、directory identity digest 和时间戳；不保存 raw source、Git URL、安装路径、Workspace 路径、
凭据、Prompt、源码正文、stdout/stderr 或文件列表。

状态为 `reserved -> mutating -> active|removed|ambiguous`。`active` 需要 Main-Host Settings reload、当前
observation 与 durable commit 全部成功；`removed` 需要目标 `(source, scope)` 在 reload 后确实不存在。
Host replacement 遇到 terminal receipt 只重验当前 trust projection；`reserved`、`mutating`、`ambiguous`
或 active receipt 对应的当前 drift 都返回 `ambiguous`，绝不再次调用 worker。Pi SDK 的 update 可能同时
改变 global/project 同一 package identity，Host 会刷新另一 scope 已有 active receipt 的 observation。
receipt commit 后的 Task `reloadResources()` 仍是独立阶段：失败会返回错误，但不撤销已证明的 Package
提交，也不盲目重放副作用。

`PackageTrustRegistry` 只把 `builtin-verified` 与 `user-installed-observed` 暴露给 Session 专用 Settings
view，因此缺失、无 receipt、mutation ambiguous、identity/hash drift 或 inspection limited 的 configured
Package 不会被 Pi ResourceLoader 隐式安装或加载。第三方 bounded content hash 排除 `.git` 与
`node_modules`，限制 10,000 files、128 MiB、depth 32 和五秒；它不是 registry integrity、签名、provenance、
完整依赖树证明或不可变文件系统 snapshot。

当前 Pi SDK 0.84.2 没有 Extension executor、module-loader transport、Hook/Tool RPC 或 MCP supervisor
injection point。`DefaultResourceLoader -> jiti.import -> factory(pi) -> ExtensionRunner` 仍在 Agent Host
utility process 内运行。Package worker 也不拥有第三方 Extension 自行启动的 MCP child。真正的 runtime
isolation 需要上游 executor/proxy port、经审计的 loader/runner fork，或明确禁用 unsupported third-party
execution；仓库不创建无真实调用方的 Extension Worker 空壳。

Team MCP bootstrap 对 `<agentDir>/mcp.json` 使用 `SafeAtomicIo`：保留首次读取的 exact bytes 或 missing
revision，写同目录私有临时文件并 flush，在 rename 前重新读取。revision 不一致返回
`revision-conflict`，保留外部版本并清理临时文件；invalid JSON 仍保持原文件不变。文件只保存
`bearerTokenEnv`，不会保存 bearer token。

## Protocol

所有 envelope 使用 `protocolVersion: 4`：

- hello/welcome：协商 `appInstanceId`、`hostInstanceId`、`hostEpoch`、初始 event sequence、
  capability、`idempotentControlMutations` 和 envelope byte budget；
- request：`requestId`、`hostEpoch`、typed command/payload；replay-safe control mutation 还必须携带
  caller-stable `idempotencyKey`；
- request-cancel：只携带同一 MessagePort 上已有的 `requestId + hostEpoch`，用于释放单个 caller，
  不关闭共享 Port，也不授予新的 command authority；
- response：复用 `requestId` 和 command type，返回 typed result 或 redacted structured error；
- event：单调递增 sequence，并按需携带 `sessionId`、`sessionFileIdentity`、
  `sessionGeneration` 与 `operationId`。

Agent Host 对不可信 renderer 消息先执行 TypeBox envelope validation。命令 payload 的
业务边界由 command handler 和 Pi SDK 再校验。可安全关联的无效请求立即返回
`INVALID_PAYLOAD`；Host epoch 不匹配时 fail closed。Prompt 输入图片仅允许 PNG、JPEG、WebP 和
GIF，最多 8 张、单张最多 10 MiB、总计最多 30 MiB；每个 `data` 必须是当前 Agent Host realm
的 `ArrayBuffer`，并通过 transfer list 移交以避免复制。Session 输出图片使用独立的
`AssetReference` / `asset.read` 合同，不复用 Prompt 输入数组。

Renderer 对 Host event 不只校验 type-specific payload schema，还按完整事件清单校验 context：Session-scoped
事件必须同时携带 `sessionId + sessionFileIdentity + sessionGeneration`，Operation/Turn/Approval
事件还必须携带
`operationId`；bootstrap snapshot、Operation view、Workspace Change、Approval 和 Extension UI payload
中的 authority 必须与 envelope 一致。新增事件类型若未声明 context requirement 会在 TypeScript 编译期失败。
当前 Host 发来的 event-shaped 非法帧会立即以 `INVALID_PAYLOAD` teardown Port 并拒绝所有 pending request，
不能静默忽略并等待下一条 event 才通过 sequence gap 间接发现。

每个 MessagePort 的 `hello` 握手是 single-flight。Host 在异步加载 SDK version 和 event sequence
期间只接受第一条通过 app instance 与 envelope 校验的 `hello`；重复帧不会再次执行 welcome work、
不会产生第二个 `welcome`，也不会扩大 Runtime loader 并发。握手完成后的重复 `hello` 不会重新协商
当前 Port；Port replacement 必须建立新连接并重新执行一次完整握手。

`prompt.submit`、`command.invoke`、`session.compact` 和 `session.import` 使用 accepted Operation 合同，
并由 caller-stable `submissionId` 与 SHA-256 payload fingerprint 去重：同一 submission 重试返回同一
Operation，同一 ID 携带不同内容则拒绝。Prompt fingerprint 覆盖 delivery、text 与图片元数据/bytes；
其他三类文本 Operation 使用 `command type + NUL + canonical text field`。Host receipt 只保存 fingerprint，
不保存 import path、compaction instructions、Extension command 或 Prompt 原文。Host 的 accepted/running/
settled submission record 同时绑定创建时的 Session ID、opaque physical identity 和 generation；
当前 Runtime 的物理 Session identity 改变后，同一 `submissionId` 不能重放旧 accepted Operation，
而是返回 `STALE_SESSION_IDENTITY`；只有 generation 单独推进时返回
`STALE_SESSION_GENERATION`。Renderer 在发出 Prompt 前捕获 Host epoch、Session ID、opaque physical
identity、generation 和本地 projection revision，并在清空 Composer 前同时校验 accepted response 与当前
Session authority；
Host 替换、Session 切换或同 Session projection transaction 已推进时，迟到确认都会被忽略，草稿和附件保留。
Host 必须在 accepted receipt 持久化成功后才返回 accepted response，并在 running receipt 持久化后异步发送
`operation.started` 和调用 Pi；完成、失败、取消和 Host 丢失是互斥 terminal state，terminal receipt 必须
先提交再发布对应 event。Session transition
串行执行，Turn 互斥，steer/follow-up 只在 active Operation 可接收队列时进入独立的严格 FIFO Queue
Lane。Queue Lane 默认最多 admission 32 条正在执行或等待执行的 delivery，容量耗尽返回可恢复的
`RESOURCE_LIMIT_EXCEEDED`，不创建无界 Promise 链。abort、`queue.clear` 和 extension response 仍通过
interrupt 路径绕过普通队列。Query lane 可受控并行，control mutation 与 active Turn 不会竞争。

Workspace-scoped `session.creation.resolve` 不经过 Task Scheduler，而由 Agent Host 的独立 query
coordinator 管理。同一 `workspaceId + creationId` 共享一次 single-flight 扫描；Host 最多并行 4 个、
每个 Workspace 最多并行 1 个 resolution，最多保留 64 个 distinct job 和 256 个 waiter。超过边界返回
`RESOURCE_LIMIT_EXCEEDED`。单个 Renderer Port 最多保留 256 个 pending request；Port retire/close 会取消
该连接的 waiter，只有最后一个 waiter 离开或 Host shutdown 才取消共享扫描。JSONL fallback scan 还受
10,000 个文件、64 MiB 总读取量和 10 秒总时间预算约束，预算耗尽返回 `unavailable: scan-limit`，不能
退化成无界目录/文件读取或伪装成 storage error。exact marker 与 matching header/canonical path 是
创建事实；Renderer 不再等待 SQLite Catalog 二次确认。Catalog upsert 在 authoritative bootstrap 之后
异步执行，失败只触发 metadata refresh/rebuild，不能把已创建结果改写为 `REQUEST_OUTCOME_UNKNOWN`。

Workspace-scoped `workspace.usage.report` 同样不创建 Task 或加载 Pi Task Runtime。Agent Host 按
`workspaceId + window` single-flight，同一 Workspace 最多运行一个冷扫描、全 Host 最多并行四个扫描，
最多保留 32 个 job 和 128 个 waiter；新窗口替换旧窗口，最后一个 waiter 取消、Renderer 单请求取消、
Port 关闭或 Host shutdown 都会向 JSONL scanner 传播 `AbortSignal`。扫描仍受 500 个 Session、128 MiB
总读取量和五秒 deadline 约束。Renderer 在窗口、Workspace、连接状态或 Host epoch 变化时撤销旧请求，
同 Host 重连也必须重新构建，不得保留旧报告或永久 loading。

Pi Runtime 在 `session-creation-journal-v1` 中维护私有 Durable Creation Journal，并通过 per-creation
跨进程文件锁串行化状态推进。事务顺序是 `reserved -> materializing -> materialized -> published`：
`reserved` 在任何 Pi 创建副作用前持久化，并必须先完成上述有界 exact-marker 扫描；只有明确 `missing`
才写入 `materializing` 并调用 Pi。marker 持久化且 Session ID、path 与物理 JSONL identity 一致后写入
`materialized`；权威 Snapshot/bootstrap 构建完成后写入 `published`，Catalog upsert 不在提交关键路径。
进程在 `materializing` 后死亡时，唯一 exact marker 可恢复 `materialized`；没有 marker 或存在多个 marker
则写入 `ambiguous`，后续创建请求返回 `REQUEST_OUTCOME_UNKNOWN`，绝不再次调用 `newSession()`。Journal
丢失或旧 `session-creation-receipts-v1` 存在时，只能经 exact marker 验证后重建/迁移。entry 仅保存
creation/workspace key、状态、Session ID/path、物理文件 identity 与时间戳，不保存 Prompt、Assistant、
Thinking、Tool 参数、源码、附件或凭据。Protocol v4 尚无 Renderer-to-Journal ACK，因此生产路径当前止于
`published`；`acknowledged` 仅保留为后续显式协议状态，不能作为当前完成声明。

Session writer lease 使用两层 authority：Agent Host 内 Map 负责同进程 Task transition，Main-owned
`PI67_STORAGE_ROOT/session-writer-leases-v1` 下的 `proper-lockfile` 锁负责 Host replacement 的跨进程窗口。
每组 identity 去重、稳定排序后依次 acquire，失败按逆序 release，避免多 key 获取次序漂移。未物化 JSONL
先持有物理 parent + 精确 leaf；commit 在该 provisional fence 仍存活时重新 canonicalize Runtime 最终路径，
取得 `device + inode + birthtime` 物理 key 和 canonical leaf key 后才完成 rekey。replacement transition 会同时
保留 old active 与 new pending lease：cancel 只释放 new，commit 才在新 physical fence 成功后释放 old。

跨进程 lock directory 的 mtime heartbeat 是 stale 判定依据，PID 只作诊断，不能单独授权抢锁。默认 stale
阈值为 30 秒、lock heartbeat 为 10 秒；明确 stale 才允许 `proper-lockfile` 原子恢复。每个 identity 的私有
metadata 只记录 version/token、app/Host instance、Host epoch、PID、acquired/heartbeat time 以及 Task/Session
identity hash，不记录 Workspace/Session path、Prompt、源码或凭据。metadata 可在崩溃中损坏且不参与所有权
判断；真实 fence 是原子 lock directory。heartbeat compromised 会发送严格无 payload 的
`SESSION_WRITER_LEASE_COMPROMISED` supervisor message 并触发 Host replacement。Task close、replacement 和
Host shutdown 只在 Pi Runtime dispose 成功后异步 release；dispose 无法证明完成时保持 lease 到进程退出，
绝不提前授权新 writer。

Agent Host 为每个 Task generation 在 `PI67_STORAGE_ROOT/operation-receipts-v1` 维护最多 512 条
insertion-ordered durable receipt。目录和文件在 POSIX 上分别收紧为 `0700` / `0600`；写入使用
`proper-lockfile`、同目录临时文件、file fsync、atomic rename 和 directory fsync，Windows 只对
`EACCES` / `EPERM` / `EBUSY` 做有界退避。symlink、hard-link、超限、损坏或不可写 ledger 返回带
`operationReceiptIntegrity` 的 `RUNTIME_POISONED`，且不会调用 Pi。容量只淘汰 settled receipt；若 512 条
全部未确认则返回 `RESOURCE_LIMIT_EXCEEDED`。

Operation 进入 completed、failed、cancelled 或 lost 后，指向该 Operation 的主 submission 与 queued
steer/follow-up submission 会在一个 locked atomic commit 中统一更新为同一 typed `OperationSettled`。
Session import 的 terminal receipt 可绑定导入后实际生效的 Session ID、opaque physical identity 和 generation。
receipt 只保存 lifecycle、时间、Host/Task/Session authority 和脱敏结构化错误；不保存 Prompt、import path、
command、compaction instructions、source、attachments、credentials 或 raw tool payload。

replacement Host 在 `projection.resync` 或下一次副作用接纳前读取同一 Task ledger：settled receipt 以当前
Host epoch 恢复；accepted/running receipt 原子提交为同一 Operation ID 的 `lost`，reason 明确表示旧 Host
终态未确认且没有重放。旧 Host 的迟到 completed/failed 只能读取并发布已经存在的 canonical `lost`，不能覆盖。
Renderer 对 `session.import`、`session.compact` 和 `command.invoke` 的 accepted ACK 仍只允许同 Host epoch
的一次有界 transport retry；新 Host 只做 receipt reconciliation，从不自动发送原业务 payload。
`prompt.submit` 不进入这条自动 retry 分类：图片通过 transferable `ArrayBuffer` 移交，第一次发送后
buffer 已 detached；Composer 保留草稿和附件，由用户在当前 authority 下显式重试。

Renderer 还将一次 `session.import` 绑定到提交前捕获的 Host epoch、Session identity/generation 和
projection revision。只有匹配的 accepted ACK 可以进入运行态；导入后的匹配 `session.bootstrap`
才有权安装新 Session 并解除 transition。Bootstrap 之后到达的旧 terminal response 或 rejection
不得覆盖新 Runtime/Operation，也不得清除下一次 transition。若同 Host replay 返回 completed receipt
但 Renderer 没有观察到对应 bootstrap，或 imported-Session terminal event 先于可接受的 Bootstrap
抵达，Renderer 启动 100ms、按 Host epoch + Operation ID 去重的一次性 Bootstrap watchdog。宽限期内
到达的匹配 Bootstrap 会取消 watchdog；到期后只执行一次 `projection.resync`，不把旧 projection 标记
为 ready，也不重复 import。resync 失败才进入明确的 recoverable failure。若导入已经切换 Pi Runtime
后才失败，Host 先发布当前 Session bootstrap，再发布 failed terminal，使 Renderer 与 Pi 的实际 writer
authority 保持一致。

同步 control mutation（runtime/workspace initialize、Session create/open/fork/rollback/name、
model/runtime key/thinking 和 resource reload）使用独立的 replay-safe 合同。Renderer 为一次逻辑
mutation 生成一个稳定 key，遇到 ACK timeout、Port close 或本地 connection generation 替换时最多
重试一次，并在第二次 request 中复用同一个 key。Host 的内存账本按 Host epoch、command、canonical
payload SHA-256、Session identity/generation 和 mutation revision 校验；同 key 同 payload 共享 pending
Promise 或返回已完成结果，同 key 不同 payload 返回 `DUPLICATE_REQUEST`，Session authority 已变化则
返回 `STALE_SESSION_GENERATION`。账本不保存原始 payload，不写磁盘，默认最多 16 条、8 条 pending、
settled result 保留 5 分钟；容量耗尽 fail closed 为 `RESOURCE_LIMIT_EXCEEDED`。Provider runtime key
只参与瞬时哈希，不进入 ledger、日志或 renderer state。

`session.rollback` 是增量投影 control mutation，不返回 `SessionSnapshot`。Pi Runtime 先发出
`conversation.changed`、`tree.changed` 和 `usage.changed`，Host 再返回仅含 Host/Session authority
与已发布 `eventSequence` 的窄 acknowledgement。MessagePort 顺序保证 ACK 不会越过这些事件；Renderer
只验证 acknowledgement，不用 command response 重装 Conversation、Tree、Queue、Resources 或 Usage，
从而避免宽 Snapshot 覆盖已经开始的增量刷新，也避免为一次 rollback 重建和 structured-clone 全会话。
`session.name` 使用同一投影变更合同：Runtime 先持久化名称、更新 disposable Catalog 并发布
`session.metaChanged`，Host 再返回窄 acknowledgement；重命名不再重建或传输 Conversation、Tree、Queue、
Resources、Model Catalog 和 Usage。

`runtime.initialize`、`workspace.open`、`session.create`、`session.open` 和 `session.fork` 的完整投影只由
`runtime.ready` / `session.bootstrap` 事件发布。Host 必须先发送该权威事件，再捕获当前 Host epoch、
Session ID/generation 和已发布 `eventSequence`，最后返回 `ProjectionMutationAcknowledgement`。Command
response 不再重复携带 `messages`、Tree、Queue、Resources 或 Usage，因此同一 lifecycle Snapshot 不会被
Structured Clone 两次。Renderer 只允许 bootstrap 事件安装 Session；ACK 到达时若 bootstrap 尚未提交则
fail closed，若旧 Host 或更晚的 Session transaction 已经取代请求则丢弃迟到 ACK。协议不再暴露含糊的
`session.branch(newFile)`：Pi `fork()` 创建新 JSONL Session，对应 `session.fork` + bootstrap ACK；同文件
Tree 导航继续使用 `session.rollback` + incremental ACK，二者不会共享宽 Snapshot response 或布尔分支语义。

`projection.resync` 使用独立 recovery lane：它可以捕获 active Turn，但若 control transition 已经
admit，则排在该 transition 后读取一致投影；后续 control mutation 又排在 resync 之后。这样 Port
renewal 不会因 `runtime.initialize` 或 Session transition 的 `BUSY` 假失败，也不会在 transition
中途拼接两个 session generation。由于当前 resync projection 不携带 pending interactive request，
Host 会先以 `projection-resync` 显式取消 Approval 和 blocking Extension wait，再捕获 event sequence
与 active Operation；Renderer 因此不会清空 Dialog 后让 Pi Bridge 无界等待。未来若引入 bounded
pending-interactive projection，必须替换该 fail-closed 路径，不能同时维护两套恢复语义。

`OperationAccepted` 和 `OperationView` 的 `cancellable` 由 Host 是否为该 Operation 注册真实 abort
回调决定，而不是由 Renderer 按 kind 猜测。Prompt 和 compact 绑定 Pi `session.abort()`；Pi SDK 的
Extension command handler 不属于 Agent streaming abort signal，因此 `command.invoke` 与 Session import
当前都明确为 `cancellable=false`。应用关闭仍通过 Pi `session_shutdown(reason="quit")` 和 bounded Host
deadline 收口；Host 对不可取消 Operation 的 `operation.abort` 返回 `aborted=false`，Renderer 不显示虚假的
停止按钮。

可取消 Operation 的 Pi abort 受 10 秒 watchdog 约束。watchdog 到期不代表底层工作已经停止，因此
Host 绝不清除保护后继续接收新 Turn：Operation 先进入 `operation.lost`，stream buffer 只 flush 一次，
Registry 标记为 poisoned，并以 `RUNTIME_POISONED` 结束 abort request。Host 随后发送 recovering status，
通过严格、无 raw payload 的 `agent-host-runtime-poisoned` parent message 请求 Main Supervisor 替换 utility
process；Main 给 MessagePort 50ms terminal-event 投递窗口后 kill，Agent Host 自身另有 250ms forced-exit
fallback。替换继续使用既有 restart backoff 并产生新的 Host epoch。旧 Runtime 无论 abort Promise 之后
resolve、reject 或原 Turn 结束，都不能再发送 completed/cancelled terminal event，也不能恢复 admission。

Session import 的 post-switch recovery 使用同一 poisoned-runtime replacement 边界：如果 Runtime identity
已切换到 managed copy，但 `getSnapshot()` 或 Bootstrap 发布失败，Host 不能继续以不可投影的 writer
authority 服务请求。Registry 将 import 标记为 `operation.lost` 和 poisoned，并发送严格的
`SESSION_IMPORT_PROJECTION_FAILED` parent message；消息只携带 Operation ID，不携带路径、异常、Snapshot
或 raw payload。Main Supervisor 随后按既有 50ms/250ms、restart backoff 和新 Host epoch 流程替换 Host。

Transport timeout 只保护握手、查询、同步 control mutation 和 accepted ACK：握手、状态查询与
accepted ACK 为 5 秒，普通查询和 Session Catalog query 为 15 秒，replay-safe control mutation 为
60 秒。控制类请求在第一次 transport failure 后只允许一次同 key retry；Operation 本身没有 transport
timeout，由 terminal event、abort、Host epoch 和恢复语义管理。超过该同步边界的 mutation 应迁移为
accepted Operation，而不是继续扩大通用 request timeout。
同步 request 超时使用结构化 `REQUEST_TIMEOUT`，不能伪装成 `CONNECTION_CLOSED`，也不能因此触发
同 Host 的 transport retry；只有 Port close、message error 或 Host epoch 替换才属于连接故障。

Renderer 检测到 event sequence 缺口后停止消费增量事件，只允许一次 `projection.resync`。
重同步结果在 Host 同步屏障内返回 Snapshot、Recorded Changes、Extension Catalog、Session
Catalog status、event sequence、Host epoch、session generation、active Operation 和可选的最近 terminal
receipt；Session Catalog page 不进入 resync。Renderer 在 teardown 或 sequence gap 前只捕获非终态
Operation ID：active Operation 优先恢复；若已无 active Operation，则只采用相同 ID 的 terminal receipt。
不匹配的历史 receipt 被忽略，completed/failed/cancelled/lost 也不能被迟到 accepted ACK 降级。恢复该
sequence 后才重新接收事件。旧 Port 只可完成它已经接收的相关 response，不得把 response 迁移到新连接。

Renderer 将三条 terminal 入口统一投影到 `notifications/notification-store`：实时 `operation.*` event、
accepted ACK 的 `OperationSettled` replay、以及 matching interrupted Operation 的 resync receipt。
Operation 通知按 `operation:${hostEpoch}:${operationId}` 去重；相同 ID 在不同 Host epoch 保持独立，
旧 Host receipt 不能覆盖新 Host 当前任务。历史最多 50 条、recent terminal dedupe key 最多 512 条、
可见 Toast 最多 4 条，全部只存在于 Renderer 内存。Operation notification 只存 kind/lifecycle、
Host/Session authority、时间和 error code，不存 error
message/raw details、Prompt、command、path、source 或 Tool payload。普通通知在进入 Store 前做长度边界和
凭据/链接/绝对路径脱敏，并使用五秒 dedupe window。

Pi SDK session events 不做通用深拷贝或 raw payload 转发。Streaming 只投影 renderer 实际
消费的 `text_delta` / `thinking_delta`；其他 session delta 只跨端口发送 event type。未知消息
使用安全占位，不把 raw object stringify 到 renderer；Tool argument summary 有深度、数量、
字符边界并脱敏。完整状态只在 initialize/`runtime.ready`、create/open/new-file branch/import
的 `session.bootstrap`、仍明确返回 Snapshot 的 control command result 或 `projection.resync` 中重建；日常事件不会
为了 envelope metadata 调用完整 snapshot。Bootstrap event 在对应 command response 前发送，
因此 Renderer 在首个 Approval 或 Extension 输入到达前已经拥有权威 session generation。

## Streaming and sessions

Pi JSONL 是会话真源。UI snapshot 是可重建视图，不得回写私有 session 格式。默认 bootstrap
只包含最近 100 条消息；`message.page` 使用 Pi entry ID cursor，每次最多 200 条，并受 1.5 MiB
JSON page budget 约束。单个 projected text/thinking part 最多 64 KiB，每条消息最多 16 parts；
Snapshot 和 Conversation Page 不携带图片 base64 或 data URL。可展示图片投影为
`{ id, byteLength, sessionGeneration }`；不支持的 MIME、损坏 base64、空图片或超过 10 MiB 的图片
保留明确不可用占位，不把原始数据跨进程发送。

Agent Host 为当前 Session generation 维护最多 512 个可丢弃 Asset handle，懒解码缓存最多
64 MiB。`asset.read` 属于 Query lane，每次最多返回 1 MiB 新 `ArrayBuffer`，response 使用 transfer
list；Host 在读取前同时校验 Host epoch 和 Session generation。Session bind/reset、Host restart
或 epoch replacement 会使旧 handle 失效。Asset Registry 不写 SQLite 或 Pi JSONL。

Renderer 只有在虚拟化 Transcript 实际挂载图片时才分块读取，完成后生成 Blob URL；二进制和
Blob URL 不进入 Zustand。Renderer 缓存最多 64 项 / 64 MiB，零引用 URL 保留 10 秒以吸收快速
滚动重挂载，Host replacement 时立即 revoke。当前不提供 `asset.release` command：Virtuoso 的
卸载/重挂载不能删除仍被 settled message 引用的 Host handle；Host 侧由 generation、epoch 和有界
LRU 生命周期回收。

Agent Host 在 Session bind 时对 `SessionManager.getEntries()` 执行一次全量读取，构建可丢弃的
`SessionProjectionIndex`。Catalog live metadata、usage totals、活动 branch cursor lookup、tree source、
Conversation page 和 Recorded Changes 共用该索引；`entry_appended` 增量维护，leaf 导航只从已有
entry map 重建活动 branch。Bootstrap、`usage.changed`、`session.tree` 和 Catalog upsert 不得各自
重新复制并扫描完整 entries。索引只持有 SDK entry 引用和派生 metadata，不写入数据库，也不改变
Pi JSONL 或 `SessionManager` 的所有权。

Session tree 是 flat projection，最多 512 nodes / 128 KiB JSON；活动节点优先，`truncated`
和 `total` 明确表达裁剪。Renderer 使用 Virtuoso，不递归挂载完整树。Tree 不进入宽 App Store：
`sessionTreeStore` 独占 projection、loading/stale 状态、change revision 和 request revision，
`session-tree-controller` 独占 `session.tree` transport。`tree.changed` 必须先通过 Renderer Session
authority，再触发单飞刷新；刷新期间的新 dirty signal 合并为一次 trailing query，旧 Host、旧 Session、
旧 generation 或旧 projection 的成功/失败结果均被静默丢弃。

Streaming delta 在 Agent Host 内批处理，renderer transcript 使用 variable-height virtualization。
`conversationStore` 独占 settled messages、page cursor、Virtuoso anchor、older-page loading 和
stale request guard；`liveTurnStore` 按 Operation 保存合并后的 text/thinking chunks。Live Turn
使用独立 Footer，不进入 settled array，也不再让 stream batch 更新宽 App Store。流式代码只显示
纯文本，settled page 到达后才清空 Live Turn 并进入 Worker 高亮。

当前活动 Session 使用 JSONL watcher，但 `fs.watch` 只提供 dirty signal，不作为变更事实源。既监听
文件内容变化，也监听父目录中的 delete/replace/recreate；75 ms debounce 后由单飞 tail drain 重新
`lstat/open/fstat/realpath`，校验 regular file、单 link、canonical path、`dev + ino + birthtime` identity、
byte offset、strict UTF-8、完整 JSON object 和 physical line。每个 read chunk 为 256 KiB，每次 drain
最多 4 MiB，连续最多 64 次并在 pass 间让出 event loop；单行沿用 import 的 64 MiB 上限。文件首次
尚未落盘时从 offset 0 开始，只有 header/entries 与当前 Pi `SessionManager` 完全对应才吸收为自身写入；
已有文件只接受此前未观察且已存在于当前 Manager 的新 entry ID，重复 ID、blank line、未知 record、
partial terminal line 或 malformed JSON 都 fail closed。这样覆盖 Pi `message_end` 先发事件、后同步写入
JSONL 的真实顺序，而不依赖易漂移的 mtime baseline。

append、truncate、same-size mutation、atomic replace、delete/unavailable、symlink/hardlink/indirection 和
invalid JSONL 会锁存当前 Session conflict；运行中的 Pi turn 会立即请求 abort，之后所有 Prompt、Queue、
model/thinking、compact、rollback/name、branch 和 resource reload mutation 在 Runtime 边界返回结构化
`SESSION_CHANGED_EXTERNALLY`。`session.externalChangeDetected` 只跨进程发送 typed reason 与
recoverable，不发送 path。Session generation 切换同步 dispose 旧 watcher，迟到 drain/callback 不能污染
新 Session。该机制是并发 writer 的检测和止损，不是外部 append merge；Desktop/TUI 仍必须顺序使用。

Queue 事件会传输用户需要查看的 steer/follow-up 文本，但 UI 最多挂载 20 条、每条最多展示
500 字符并清理控制字符。`queue.clear` 是 Queue Lane 的有序 barrier：已经开始进入 Pi 的单条 delivery
先完成；已被 Agent Host admission 但尚未执行的旧 generation delivery 以 `STALE_OPERATION` 取消；随后
Runtime 原子清除 Pi 已接收的 steer/follow-up 队列；clear 之后的新 delivery 排在 barrier 后。响应只返回
`steeringCount`、`followUpCount` 和 `pendingCount` 三类数量，分别表示 Pi 已清除的两类消息和 Host 已取消的
未开始 delivery，不把 Prompt、path、command 或其他原始 payload 再次回传或写入日志。

### Disposable Session Catalog

Pi JSONL 始终是 Session 真源。Electron Main 将 Catalog 目录固定在自己的 `userData` projection
路径并覆盖外部同名环境变量；创建路径时逐级拒绝 symlink/junction 类间接路径并验证 canonical
containment，Agent Host 打开 DB/recovery 前再次拒绝 symlink、非普通文件和多 hard-link 文件。
POSIX 上 Catalog 目录必须收紧并验证为当前用户拥有的 `0700`，DB 必须为当前用户拥有的 `0600`；
`chmod`、最终 mode 或 owner 验证失败都会 fail closed 到 SDK fallback。Windows ACL 需要独立平台证据，
不从 POSIX mode 测试外推。
Renderer 和 command payload 都不能选择数据库位置。Agent Host 的
SQLite 只保存 bounded metadata：opaque physical JSONL identity、Session path/id/cwd、显式 `session_info.name`、modified time、
message count、parent path 和 Catalog revision/status。它禁止保存 Prompt、Assistant、Thinking、
Tool payload/output、源码、Patch、图片/data URL、transcript 或 FTS 数据；无显式名称时仅返回固定
`Untitled session`，不从首条 Prompt 派生名称。

`session.catalog.query` 支持 workspace/all scope、服务端 NFKC 搜索、最多 100 项的
`modifiedAt DESC, path DESC` keyset page 和 1.5 MiB JSON page budget。Cursor 通过 SHA-256 query key
绑定 source、workspace、scope、NFKC-normalized search、sort contract 和 Catalog revision；跨结果集复用
或旧 revision 都返回 recoverable `STALE_SESSION_CATALOG`，Renderer 清空旧页并重新请求第一页。
`session.catalog.changed` 只携带 revision/reason，不能重复发送 Session 数组；
`projection.resync` 也只恢复 status/revision。
Renderer 的 `sessionCatalogStore` 是纯分页投影和请求状态机：first/next page target 都绑定本地
request revision，Workspace/Host reset、Catalog revision change 或 resync status change 会立即使旧成功和
失败失效。`session-catalog-controller` 独占 `session.catalog.query` transport、Protocol error 分类、
`STALE_SESSION_CATALOG` 首屏重载和 changed-event refresh；Command Palette 的独立服务端搜索也经过
该 Controller，但不写入 Navigation Catalog Store。

NFKC 只用于用户搜索和 SQLite search columns，不参与 source/workspace 文件系统身份。路径 fallback
保留平台原生 resolved path 的精确拼写，不再对整条 Windows 路径 lowercase；现存 JSONL 以
`device + inode + birthtime` 物理身份去重，writer lease 还为未创建路径绑定物理 parent 与精确 leaf。
Catalog schema v3 将该 opaque 物理身份贯穿 discovery、pending upsert、fallback、Protocol 和 SQLite，
以 `file_identity` 为 PK、`path` 为唯一 locator；相同 Pi Session ID 的不同物理文件仍保留为两行。
增量 upsert 遇到同物理身份不同 Session ID，或同 locator 不同物理身份时 fail closed 并触发完整 reconcile。
source-key 算法使用 `session-catalog-source-v3` 前缀，变更后旧的可丢弃 projection 会自动 rebuild。
任何 transaction 或 upsert 改变数据集时 revision 必须严格
递增；后台 discovery 开始后完成的 current-Session upsert 通过 mutation generation 合并，不能被
较旧的 reconcile 结果覆盖。

Warm cache query 不读取 JSONL。首次或显式 refresh 在后台 single-flight reconcile：Pi SDK discovery
投影出安全 metadata 后，以一个 SQLite transaction 原子替换；source key 仅随 agent directory 或
configured Session directory 改变。损坏或 schema mismatch 只替换可丢弃 Catalog，不触碰 JSONL；
`SQLITE_BUSY/LOCKED` 不 rename/delete DB，并在有界退避期间使用 metadata-only SDK fallback。
运行期 query/upsert 失败也会立即失效旧 revision，进入 rebuilding 并自动重建完整 SDK fallback，
不会长期伪装成权威空目录。`quick_check` 之外还验证 state 非负、row count 一致和 bounded metadata；
逻辑损坏与 schema mismatch 一样只替换可丢弃 Catalog。Schema 创建与校验复用同一组 canonical DDL，
open 时精确验证两张 `STRICT` table 的 `table_xinfo`（列顺序、declared type、nullability、default、
PK、hidden/generated、rowid mode）、foreign-key 空集合、两个分页 index 的 key column/cid/order/collation、
`sessions.file_identity` PK 与 `sessions.path` UNIQUE autoindex，以及完整 `sqlite_schema` object inventory。额外 table/view/trigger/index、
`ANALYZE` 生成的未受控统计表、缺失或放宽的 `CHECK`、PK/`STRICT`/index 合同变化都会触发 rebuild。
`sqlite_schema.sql` 使用有界 token fingerprint：最多 32 KiB / 4096 tokens，只忽略 token 间 whitespace
和 comments，对未引用 token 做 ASCII case fold，保留 quoted value/identifier、Blob、number、operator 和
token boundary；malformed、未闭合或超限 SQL fail closed。

Catalog 的 persistent SQLite connection 在同一个 `BEGIN IMMEDIATE` 中完成 create/validate 和
`PRAGMA data_version` / `schema_version` baseline capture，关闭 validation→baseline writer gap；另一 writer
持锁时 open 返回 bounded busy fallback，不能把竞争误判成 corruption 后 rename。`getState` / `query` 在
读取前后比较同一 connection 的 baseline，避免 COUNT/page 跨外部 commit 混合；`replaceAll` / `upsert`
先 fast-fail，再取得 `BEGIN IMMEDIATE`，在锁内重新比较 baseline、读取 revision 并写入，commit 后通过完整
guarded state read 才返回或清理 recovery。自身 data commit 不刷新该 connection 的 `data_version`，因此
baseline 固定不变；第二连接只读不会误报。发现外部 data 或 schema commit 时抛出结构化
`SESSION_CATALOG_CHANGED_EXTERNALLY`，上层立即关闭旧 SQLite、增加公开 revision、进入 SDK fallback /
rebuilding 并调度 bounded discovery。Retry 重新打开 SQLite 后，在完整 JSONL discovery `replaceAll`
完成前不能恢复增量 upsert fast path；期间 current-Session upsert 只更新 fallback 并保留 pending mutation，
由下一次完整 reconcile 合并后再切回 SQLite，外部独有 rows 不得重新进入公开 projection。
该合同用于 fail-closed 检测，不等于同用户恶意进程隔离或跨平台
single-owner lock；文件替换、恶意重写 version cookie、多 utility-process 和 Windows lock timing 仍需独立证据。
Catalog 当前继续使用 DELETE journal。WAL 的 main/`-wal`/`-shm` private-file 校验、checkpoint、整组隔离、
外部 writer detection 和 Windows Defender/同步盘锁定尚未形成同等证据，因此不与 schema v3 同时切换。
当前 Pi SDK `0.84.2` 的 cold discovery 内部仍会临时构造 `allMessagesText`，但该值在适配边界立即
丢弃，不进入 SQLite、Protocol、Renderer、日志或 diagnostics。当前不实现 FTS 或 transcript index；
活动 Session watcher 与 Catalog metadata discovery 保持独立，前者不会把 JSONL entry 写入 SQLite。

### Pi Session Recorded Changes

`workspace.changes` 和 `workspace.changeChanged` 只投影当前 Pi Session 活动分支中的 `edit` /
`write` Tool 事实，不扫描 Git，也不声称覆盖外部进程或其他工具产生的工作区变化。最多保留
100 项、每条 path 最多 1 KiB、Edit Patch 最多 64 KiB、整个 projection 最多 512 KiB。

- `edit`：完成后的 Pi Tool Result 同时提供 `patch`、`diff` 时，才投影 unified Patch、首个
  变化行和增删行；失败、缺失或已截断 Patch 不生成未经证实的统计。
- `write`：只投影输入的有界 byte/line metrics。Pi Tool Result 没有写入前版本，因此 Desktop
  明确不生成历史 Diff。
- Bash 和未知 Extension Tool 不根据 command、summary 或猜测字段生成文件变化。
- Live update 以 Pi `toolCallId` upsert。Session bootstrap 先清空旧 projection；sequence gap
  后只使用 `projection.resync.changes`。`workspaceChangesStore` 以 Host/Session authority、feature
  projection revision 和 request revision 同时约束 query 成功与失败，延迟结果不能覆盖新 Session，
  Port teardown 后的旧 rejection 也不能改写恢复状态或发布噪声通知。

## Renderer state flow

### Agent event projection map

`apps/renderer/src/app/renderer-agent-event-controller.ts` is the single entry for a validated
Agent event after connection sequence checks:

```text
validated Host event + envelope
  -> applyRendererAgentEvent
      -> workbench Task summary router (all registered Tasks)
      -> selected live App/Session projection (active or unscoped events only)
      -> feature stores owned by the live projection
      -> projection-freshness observer (accepted live events only)
```

The Workbench Store owns the bounded multi-Workspace/Task index used by navigation. It may retain
background Task lifecycle and runtime summaries, but it must not own a background transcript or a
second full Session projection. App, Session, Conversation, Live Turn and their feature stores own
detail for the selected Task only. A Task-scoped event rejected as `background` or `stale` must not
reach the selected live projection.

Formal Workbench identity is `workspaceId + sessionFileIdentity`; `sessionId` remains a Pi business
check and `sessionPath` remains a display/open locator. Workbench persistence v4 therefore accepts
the opaque physical identity emitted by the authoritative Snapshot even though its internal format
may contain separators. It persists live Runtime recovery without consulting the disposable Catalog.
The v3 migration never promotes a path-only formal record into physical identity: it drops formal
runtime recovery and falls back to the Workspace surface, while retaining a provisional selection
only when a matching durable `creationId` recovery record exists. Catalog reconciliation may update
title and locator metadata for an already materialized identity, but it cannot materialize a
provisional Task.

The two views are intentionally allowed to differ only at explicit transition boundaries: a lost
Workbench Task may coexist briefly with a recovering live projection, and Settings keeps its return
Task active while the Settings surface is selected. Outside those windows, active events are applied
to the Task summary before the live projection so a new authoritative `session.bootstrap` can update
Task identity before installing Session detail. `WorkbenchProjectionBridge` remains a compatibility
projection for workspace registration and non-event-derived Session metadata such as name/path and
recent user-message preview; it is not an alternative Agent event reducer.

Session authority remains
`hostEpoch + sessionId + sessionGeneration + projectionRevision`. Installation, control transition,
import watchdog and resync details stay in their existing focused modules; this map is the stable
entrypoint for callers and does not collapse those distinct recovery responsibilities into a broad
facade.

```text
MessagePort
  -> AgentConnectionController
  -> Protocol decoder / hostEpoch / sequence checks
  -> typed projection and operation reducers
  -> App lifecycle state / conversationStore / liveTurnStore / feature stores
  -> React
```

Raw `AgentPortClient` 不进入 Zustand。宽 `SessionSnapshot` 只保留在 bootstrap、强制 resync 和
Session lifecycle response 边界；model/thinking/runtime key、workspace trust 与 resource reload
返回只包含命令实际拥有分组的窄结果。宽 Snapshot 进入 Renderer 后会拆成分组的 `sessionProjectionStore`、独立 Conversation projection、
Session Tree projection 和 Operation-scoped Live Turn。Session Projection Store 不保存一个供 UI 宽订阅的
聚合对象，而是分别保存 identity、model/provider controls、queue、resources 和 usage。
`session/session-authority.ts` 与 `sessionProjectionStore` 以
`hostEpoch + sessionId + sessionGeneration + projectionRevision` 定义并持有当前 Session authority；
`renderer-session-transaction` 统一处理 workspace/session replacement、same-Host resync、Port teardown、
Host replacement、runtime crash 和同 Session control transition。Session 切换、Host replacement、
sequence-gap 和 transition 会在一个同步 transaction 中失效旧 event/response target、分页请求、
Conversation、Live Turn、Recorded Changes 与 interactive projection，旧成功和旧 rejection 都不能跨
transaction 写回。新 Host 或新 Session 只能由携带明确 generation 的 `runtime.ready`、
`session.bootstrap` 或 `projection.resync` 安装 authority；普通增量事件不能激活 authority。同一 active
Host/Session 的 control response 可以复用当前 generation，缺失 authoritative bootstrap 时显式失败，
不能从后续普通事件猜测或采用 generation。
Snapshot replacement 使用单一 canonical authority 的两阶段提交。`sessionProjectionStore` 先进入带新
`projectionRevision` 的 inactive installation；Conversation、Session Tree、Recorded Changes、Extension
Catalog 和 resync Catalog status 依次安装，并在每次同步 Store publish 后重新验证 installation。只有全部
feature projection 仍属于该 revision 时，Session identity/controls/queue/resources/usage 才作为最后一步提交
active authority。任何 subscriber 重入、Host/Session replacement 或 recovery transaction 都会推进 revision，
使旧安装立即停止；旧失败路径不得 reset 或清除更新 transaction。authority module 只保存 transaction phase
和 revision，不在 App Store 或额外 coordinator Store 复制 Host/Session identity。
`extensionUiStore` 独占 pending request、status/widget、
compatibility、Catalog 和临时 title；App Store 只消费 Host 已投影的 Operation activity，不从 blocking
Extension 或 Approval Dialog 的本地开关推断等待状态，也不持有 Extension UI 副本。Renderer 在发起 Session/resource transition 前清理该
Feature Store；Host replacement、runtime crash 和 sequence gap 也显式清理，resync 只恢复权威
Extension Catalog。`approvalStore` 独占 pending Safety Approval request；Host 的 Activity Controller
维护 Pi base activity 与 Approval/Extension interactive overlay，终止交互后恢复最新 base activity。
Approval 和 Extension Store 通过 Session transaction 随 transition、Host replacement、runtime crash
和 sequence gap 一起失效。Pi Runtime 会在 `runtime.ready` / `session.bootstrap` 之前发送新 generation
的 `extension.catalog.changed`；Renderer 不再用“generation 未知即接受任意 Session”的旧路径，而是
只在当前 Host/projection revision 下暂存 catalog，等 bootstrap 的 Session ID 与 generation 精确匹配后
再安装，不匹配即丢弃。App Store 只管理 connection、runtime、workspace/trust、Operation、Doctor 状态和
Dialog 投影，不再发起 MessagePort request，也不保存 Session identity/generation/revision/authority phase、
Session view 或 UI metadata 副本。Workspace、Session lifecycle/import/control、Prompt/Queue、Operation command
和 runtime diagnostics 分别由 feature controller 直接持有 transport、authority fence 与失败投影；React 只调用
这些领域入口，不通过 Zustand action facade 间接访问 Agent Host。
`session/session-projection-selectors.ts` 是当前 Session view 的只读消费边界，不拥有 transport。Transcript
只订阅 Session ID，Navigation 只订阅 Session ID/path，Trust 只订阅 Session 是否存在；Composer、
Context、Credential、TitleBar 和 Command Palette 使用 feature-scoped selector。增量
`usage.changed`、`tree.changed`、`queue.changed`、resource 或 model 更新只通知实际消费对应投影的
surface。同步 control request 捕获每个分组的 revision；迟到 response 只能更新请求期间未变化且由该命令
拥有的分组。`workspace.setTrust` 与 `resource.reload` 使用
`SessionResourceCatalogResult`，只携带 `sessionId`、controls、model catalog 和 resources，不再投影或跨
MessagePort 复制 messages、tree、queue、usage 与 Session identity。`workspace.setTrust` 的 success、error
和 finally 还同时绑定 Workspace、Host、Session 和本地
request revision，旧请求不能覆盖新恢复状态或清除新 transaction 的 pending 标记。
`model.list` 与 `resource.list` 也直接读取各自的窄 Runtime projection，不得为了返回一个数组构造完整
`SessionSnapshot`。
`workspaceChangesStore` 独占 Session Recorded Changes projection、同步状态和有界 `toolCallId` 索引；
Transport request 位于独立 controller。`ChangesPanel` 和 Tool Card 不再订阅 App Store，Operation、
Runtime、Queue 或 Dialog 更新不会重复扫描修改记录。
Notification history 已迁移到独立 `notificationStore`，App Store 不再持有 notice 数组。Toast dismissal
只移除瞬时呈现，不删除历史；打开 Notification Center 只更新 read state，不触发 Agent 命令、Session
切换或 Operation 状态变更。

## Safety and resource limits

- Shell command text is not classified as safe by prefix. Every Bash/Shell tool
  call requires one-shot approval; structured read/search tools are the path for
  approval-free reads.
- Safety Approval 与普通 Extension `confirm` 使用不同 event、pending registry、Store 和 Dialog。
  Approval 绑定 `hostEpoch + sessionId + sessionGeneration + operationId + requestId + toolCallId`；
  Port 不可投递、session/operation 过期、requester 异常、等待期间 abort 或 target/cwd 无法完整
  展示时立即拒绝，不能等待超时后继续执行。
- Pi `0.84.2` 中用户 Extension 先运行，Desktop inline Safety Extension 后运行；Safety 因而检查
  其他 Extension 修改后的最终 Tool 输入。真实 Pi ordering contract test 固定该属性，SDK
  升级若改变顺序必须失败。
- Project trust only enables project resources. It does not replace per-action
  approval for destructive、external、system or workspace-external work.
- Session import performs a streaming preflight before creating a managed copy:
  the file is limited to 256 MiB and each physical JSONL line to 64 MiB,
  including a final line without a trailing newline.
- Diagnostics and tool summaries use bounded redaction; credential values、raw
  Prompt、source bodies and raw tool payloads do not enter default logs.
- Prompt attachment staging uses one UUID run root per app instance. After Main owns
  the single-instance lock it scans only direct UUID directories, skips the current
  run, links/junctions and non-directories, and removes at most 16 roots older than
  24 hours through a same-parent atomic quarantine rename. Failure is background-only;
  logs contain bounded counts and error classes, never attachment names or paths.
- Path-backed staging binds picker size/mtime and physical file identity to one
  non-following handle, copies and hashes from that handle, then compares a second
  handle stat before publishing the manifest. Supported PNG/JPEG/GIF/WebP content
  has a 32 MiB aggregate native-image budget independent from the 250 MiB ordinary
  attachment budget. Renderer applies it to the complete draft from Main's staged
  metadata and Host applies it before accepted publication; unknown `image/*`
  declarations remain ordinary files instead of entering Pi native image content.
- Agent Host claims are stored under hashed Task and submission directories. A
  claim copies from each revalidated non-following payload handle into a temporary
  directory, syncs its payloads/manifests, atomically publishes the set, and removes
  draft copies only after commit. Pre-commit failure therefore preserves retryable
  opaque draft references. New claim admission and replacement recovery share the
  same 128-set Task ceiling; an existing submission replay does not consume a slot.
  A replacement Host may recover only the requested set for that exact Task, scans at
  most 128 claimed sets, and revalidates the directory inventory, item metadata,
  regular-file identity, byte length, and SHA-256 before restoring the in-memory
  index. Tool reads revalidate and read the selected item from one handle, then
  transfer immutable bytes to a Worker without reopening a payload path. Explicit
  Task disposal removes its claimed directory only after Runtime disposal succeeds;
  cleanup failure remains retryable. Host replacement does not remove it, and Main
  removes the complete run root only after Host shutdown. Archive workers enforce the same
  entry limit for list and read plus full-archive path depth/name length, expanded
  bytes and compression-ratio validation, bounded execution time and worker memory,
  and truncation-aware output size.

## Extension UI

`select`、`confirm`、`input`、`editor`、notify、status 和文本 widget 映射到可访问的 React
UI。`ctx.ui.custom()`、component widget/footer/header/editor 和 TUI autocomplete 不允许
注入 renderer，必须报告 `tui-only` 或抛出明确兼容错误。当前 SDK 未提供可靠的 calling
extension identity，因此 capability 明确声明 `attribution: none`，不得伪造 extension ID；
Host 只补入其权威拥有的 epoch/session/operation context。Session transition、resource reload、
projection resync、abort、timeout 和 runtime dispose 都取消 pending request，并通过 `extension.ui.cancelled` 清除
renderer 中对应的阻塞 UI。

普通 Extension Request 在显示和响应前都校验 Host/session/operation authority；Safety Approval
则使用独立的 `approval.requested/respond/resolved/cancelled` 生命周期。二者的取消和响应不能
交叉解析。Extension Bridge 成功解析 request 时发送 `extension.ui.resolved`，Host 在 command ACK 前
同步结束 interactive overlay；Renderer 只按该权威 event/envelope 清理领域状态。Extension response
只有在 Host 返回 `resolved=true` 后才视为已接受；`resolved=false`
会移除已失效请求并给出可观察警告，transport failure 则保留请求、返回失败并显示可重试错误，不能
向 React event handler 泄漏未处理 rejection。`approval.resolved` 和 `approval.cancelled.requests[]` 都携带
`requestId + toolCallId`；Renderer 只在这两个身份及 event envelope 的 Host、Session、generation、
Operation 仍与当前待处理请求一致时清除授权界面。
Approval response 同样只在 `resolved=true` 时视为被 Host 接受；`resolved=false` 会移除失效请求并
明确保持工具阻止语义，transport failure 保留请求并转为可观察、可重试的错误，不把 rejection 泄漏给
React event handler。

`packages/extension-compat` 提供纯 TypeScript 的声明式 Manifest v1 校验、SemVer 匹配和
immutable Registry；它不 import Pi SDK、Node、Electron 或 React，也不加载文件或执行 Adapter
	代码。内置 Adapter 还必须先通过 conformance inventory：证据固定 npm sha512 integrity、license、
	canonical HTTPS repository、完整 Git object id、repository-relative source path、精确 installed SemVer
	和观察到的 command/tool surface，
	Manifest 不能声明证据中不存在的 surface。Agent Runtime 只信任 Pi resolved package
`baseDir/package.json` 的 name/version，并以 Pi
最终 resolved command catalog 与 `AgentSession.getAllTools()` 作为 surface 真源。Runtime capability
报告 `adapterRegistry.available: true`、schema version、已接通的 `commands/tools` surface 和真实
	active count；production built-in inventory 当前覆盖 `pi-rewind@0.5.0` 的 `/rewind` command
	metadata，以及 `@feniix/pi-sequential-thinking@5.0.3` 的八个静态 Tool surface。
	该 Extension 的快捷键/TUI surface 仍按 runtime 事实标记为 `partial`，不能外推成完整兼容。

命令 Adapter 元数据随 `command.list` 返回。工具 Adapter 在 `tool_execution_start` 按
Session generation + `toolCallId` 固化，完成后只在当前 generation 的 bounded settled cache 中保留，
再进入 Message projection；历史 JSONL 缺少本进程绑定时保持 generic，不按当前同名工具猜归属。
`realtimeUiAttribution` 和 shared `ctx.ui` caller attribution 仍为 `false/none`。`working indicator`、
直接修改 Desktop composer、custom component 和 autocomplete 继续以结构化 limitation 公开，不能
把 common primitive bridge 或声明式 command/tool Adapter 描述为完整 Extension UI 兼容。

`extension.catalog.list` 与低频 `extension.catalog.changed` 使用独立、有界 projection，不把
Extension 目录塞回 `SessionSnapshot`。目录最多投影 128 项和 1.5 MB JSON，过滤 `hidden` 的 Desktop 内部
Safety Extension，并按 `commands`、`tools`、`ui-primitives`、`tui-custom` 四个 surface 分别
报告。Pi 已解析的 command catalog 是 invocation name 的权威来源；Desktop 不再从 raw
`extension.commands` 猜测命令冲突后的名称。加载成功但证据不足时必须显示 `unknown`，不能
默认标记 `native`、`headless` 或 `adapter`。`projection.resync` 同时恢复该目录，避免 sequence
gap 后保留旧 Host 或旧 Session 的 Extension 状态。

## Source layout

- Desktop Main：`app-protocol`、`main-window`、`agent-host-supervisor`、`system-bridge` 分别拥有
  scheme/window/process/system 能力，`main.ts` 只做组合。
- Agent Host：`host-server`、`command-scheduler`、`operation-registry`、`operation-submission-ledger`、
  `control-mutation-ledger`、`connection-context` 和 `protocol-error` 分离协议、并发、Operation/watchdog、
  submission/control 幂等重放与错误映射。
- Main Supervisor 只接受 `packages/protocol/supervisor-messages` 的严格 startup ready/failure、
  poisoned-runtime 与 shutdown request/completion message；malformed 或携带额外 raw state 的 parent
  message不触发 readiness、kill 或 deterministic failure，也不能伪造 graceful shutdown completion。
- Renderer：`connection` 独占 Port 和有界 control-mutation retry，`conversation` 独占 settled page 与分页控制，`live-turn` 独占
  流式 chunk，`approval` 独占 Safety Approval projection/response lifecycle，`extension-ui` 独占普通 Extension UI
  projection/response lifecycle，`notifications` 独占内存通知历史、
  Toast 生命周期和 terminal dedupe；`operation`、`tool-cards` 和 feature 目录拥有 UI。基础样式位于 `styles`，
  feature-specific 样式使用 colocated CSS Modules。
