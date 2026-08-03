# Performance and runtime evidence

## Budgets

预算是 release gate，不是当前已达成声明。使用 release build、干净 profile 和至少 10 次
样本，报告 p50/p95、硬件、OS、commit 和测量脚本。

| Metric | Budget |
| --- | ---: |
| cold launch to first usable window p95 | <= 3.0 s |
| warm launch p95 | <= 1.8 s |
| Welcome production renderer assets | <= 0.60 MiB |
| Runtime initialization incremental renderer assets | <= 0.40 MiB |
| packaged Command Palette loading feedback p95 | <= 50 ms |
| packaged Command Palette first interactive open p95 | <= 400 ms |
| on-demand Welcome working set: Main + renderer | <= 350 MiB |
| composer input-to-paint p95 | <= 50 ms |
| streaming renderer commits | <= 20/s |
| 1,000-message session first usable projection p95 | <= 1.5 s |
| 1,000-message transcript scroll dropped-frame rate | < 1% |
| Agent Host crash to recovered active session p95 | <= 3.0 s |
| app close with active controlled Extension command p95 | <= 5.0 s |
| app close with active tool p95 | <= 5.0 s |
| 1,000-Session warm Catalog first page p95 | <= 50 ms |
| 10,000-Session warm Catalog first page p95 | <= 100 ms |
| 10,000-Session warm Catalog search miss p95 | <= 150 ms |
| Session Catalog page JSON | <= 1.5 MiB |
| 10,000-message shared projection full entry reads | exactly 1 per bind |
| 10,000-message recent page + bounded tree p95 | <= 100 ms |
| 10,000-message stable-cursor older page p95 | <= 50 ms |
| browser retained heap: load 900 older messages | <= 6 MiB delta |
| browser retained heap: 10 Session switches | <= 4 MiB delta |
| browser DOM nodes: 1,000 loaded messages | <= 1,000 |
| browser DOM nodes: after 10 Session switches | <= 500 |

Code highlighting、Markdown 和长 transcript 必须保持 lazy/virtualized；首屏不加载 Shiki
WASM、语言 grammar、WorkspaceShell 或全局 Overlay。Runtime 初始化可以加载 WorkspaceShell，
Operation freshness/recovery controller 也只能在 Workspace 存在后按需加载，不能进入 Welcome
资源集合；加载失败必须保持可观察且不能阻断 Workspace 主流程。
但不能提前加载 Approval、Extension、Doctor、Credential、Update 或 Command Palette Overlay。
Command Palette 首次 `Ctrl/Cmd+K` 到可见加载反馈的 packaged p95 不得超过 50 ms，完整可访问
Dialog 就绪不得超过 400 ms，避免以初始 bundle 变小为代价制造无反馈的首次交互停顿。
Asset 预算按 production build 文件 bytes 计算，不冒充网络传输或 decoded memory。Streaming
batching 默认 50 ms，禁止 token-level React commit。

## Required scenarios

- welcome、首次 workspace、已有大 session、暗色/亮色；
- 连续三轮真实模型 turn，含 read/bash/edit/write、图片、abort 和 compact；
- 1,000 条消息、长 code block、长 tool output、快速滚动和输入；
- 最近 100 条恢复后连续加载到 1,000 条、连续切换 10 个 1,000-message Session，并在显式 GC 后
  检查 retained JS heap 与 DOM node 上限；
- Agent Host crash/restart、外部 session 修改和 app quit；
- 1k/10k Session Catalog warm first/next page、search hit/miss、reopen、cold rebuild、
  SQLite unavailable/busy/corrupt fallback，以及 raw DB banned-marker privacy contract；
- active Session JSONL 的 1 KiB/256 KiB Pi-owned append、4 MiB bounded drain、64 MiB physical-line
  boundary、1,000 条顺序写入、external append、truncate、atomic replace、missing-create 和
  generation/dispose race；
- Windows 10/11 x64 与 macOS Apple Silicon 分开测量。

## Evidence levels

1. Static：type/lint/unit/architecture/transport/build；
2. Browser：renderer 交互、响应式、截图和 accessibility smoke；
3. Electron：utility process、MessagePort、`app://`、Preload、原生对话框；
4. Packaged：签名、安装、升级、卸载、进程清理和性能；
5. Platform：真实 Windows/macOS 证据。

较低层不能替代较高层。截图不能证明 native lifecycle，macOS 不能证明 Windows。

## Reproducible harness

运行完整本机基准：

```zsh
PI67_PERF_SAMPLES=10 corepack pnpm run performance:measure
```

该命令会：

1. 构建 production renderer、Main、Preload 和 Agent Host；
2. 为当前受支持平台生成 unsigned unpacked application；
3. 对 1k/10k in-memory Pi Session 运行共享 entry projection、最近/更早消息页、bounded tree 和
   full `getEntries()` read-count 门禁；
4. 对真实临时 JSONL 文件运行 active-Session tail/watcher 基准，记录 append drain、bounded pass、
   peak pending line、event-loop yield 和外部变更分类；
5. 对 production renderer bundle 运行 browser-tier 1000-message、composer、scroll、
   streaming、older-page/session-switch 显式 GC retained heap、DOM counters，以及
   Shiki/WASM/TypeScript grammar 延迟加载与长代码测量；Renderer E2E 另外验证可见图片才触发
   `asset.read`、单 chunk 不超过 1 MiB、Blob URL 不使用 data URL 且 Host replacement 会 revoke；
6. 对 packaged Electron 运行 clean-profile launch、warm-profile launch、Welcome working
   set、平台原生 owned/effective memory、按需连接但未加载 Pi SDK 的 Agent Host memory、隔离
   目录中的真实 Pi SDK session 初始化、官方 `SessionManager.appendMessage()` 生成的
   1,000-message JSONL restore，以及 active-session Agent Host crash recovery 和
   `app://pi67` 下的 code worker/WASM smoke 测量；同时记录 Welcome、Runtime 初始化和 Session
   restore 阶段新增的同源 production resource；每个样本还运行一个无 Provider 的受控
   Extension command 和 child process，测量关闭并验证 `session_shutdown(reason="quit")`、child 与
   Agent Host 退出；
7. 将报告写入 ignored 的 `artifacts/performance/`。

共享 Session entry projection 的 Node 基准可独立运行：

```bash
PI67_PERF_SAMPLES=10 PI67_PERF_ENFORCE=1 \
  corepack pnpm run performance:session-projection
```

它对每个 bind 动态记录 `SessionManager.getEntries()` 次数并严格断言为一次，再测量 1k/10k
索引构建、最近 100 条 + bounded tree bootstrap、稳定 cursor 的更早 200 条 page 和 page bytes。
这是纯 Node/in-memory 证据；物理 JSONL read、Utility Process、MessagePort clone 和 retained RSS
分别由 packaged Electron 场景承担。

Session Catalog 的 Node 层 metadata projection 基准可独立运行：

```bash
PI67_PERF_SAMPLES=10 PI67_PERF_ENFORCE=1 \
  corepack pnpm run performance:session-catalog
```

它使用真实 `createSessionCatalog`、`node:sqlite`、1k/10k bounded metadata 和独立临时 DB，
测量 cold SQLite transaction、warm first/next page、search hit/miss、reopen 和 page bytes。该报告
明确标记为 Node evidence，不包含 Pi SDK JSONL discovery、MessagePort、packaged Utility Process、
Windows、OneDrive、junction/reparse point、杀毒软件或慢磁盘证据。

Active Session JSONL tail/watcher 的真实文件基准可独立运行：

```bash
PI67_PERF_SAMPLES=10 PI67_PERF_JSONL_BOUNDARY_SAMPLES=3 \
  corepack pnpm run performance:session-jsonl-tail
```

它使用 package-internal performance entry 调用生产 `SessionJsonlWatcher`、
`createSessionJsonlTailCursor()` 和 `drainSessionJsonlTail()`，不会扩大 `@pi67/pi-runtime` 的公开
exports。每个样本只使用临时 synthetic Pi-shaped JSONL，并在结束后删除；报告记录 1 KiB/256 KiB
Pi-owned append acceptance、4 MiB bounded drain、64 MiB 最大 physical-line 边界、1,000 条顺序
append/check、external append、truncate、atomic replace、missing-create 和 generation/dispose race。
64 MiB adversarial boundary 默认最多取 3 次样本，其余场景使用 `PI67_PERF_SAMPLES`；可通过
`PI67_PERF_JSONL_BOUNDARY_SAMPLES` 显式调整，但不得超过总样本数。

这一级证据标记为 `node-real-file`。计时的 watcher detection 使用显式 `checkNow()`，不把
`fs.watch` callback coalescing 或 75 ms debounce 冒充检测性能；它也不证明 packaged Utility
Process、MessagePort、Windows NTFS identity、OneDrive、junction/reparse point、Defender 或慢盘。
第一轮 macOS/Windows baseline 完整积累前，所有时间指标保持 informational；bytes、records、
pass count、peak pending line 和 event-loop yield 由 harness 断言正确，不先臆造 release budget。
CI 会在 `windows-2025` x64 与 `macos-15` arm64 的真实文件系统上各运行 10 个常规样本和 3 个
64 MiB boundary 样本，并上传 14 天保留的 JSON 报告。该 artifact 用于建立分平台 baseline，
在出现足够多的稳定版本数据前不自动转换为统一跨平台预算。

报告包含 nearest-rank p50/p95、原始样本、预算判断、OS、CPU、内存、Node、commit、dirty
状态、测量方法、证据等级和未验证项。默认只生成证据，即使预算失败也保留报告并以 verdict
标识；release gate 可显式设置 `PI67_PERF_ENFORCE=1` 让预算失败返回非零。

### Measurement definitions

- `cleanProfileLaunch`：每个样本使用新的 Electron user-data directory；不会刷新操作系统文件
  缓存，因此不能冒充断电重启 cold launch。
- `warmLaunch`：同一 profile 的第二次 packaged launch。
- `welcomeIdleWorkingSet`：Agent Host 尚未按需启动时，只统计 Main 和 renderer；不统计 GPU
  和 network utility process。macOS 使用 RSS，Windows 使用 `WorkingSetSize`。进程 working set
  求和可能重复计算共享页，报告保留这一限制。
- `warmRestoredWorkspaceWorkingSet`：同一 profile 第二次启动并恢复 Workspace 后、Agent Host
  尚未按需启动时的 Main + renderer 信息项。它保留 warm restored Workspace 的内存证据，但不与
  clean-profile Welcome 样本混合，也不参与 `welcomeIdleWorkingSet` 的 release budget 判断。
- `cleanProfileElectronHandshake` / `cleanProfileFirstWindow` / `cleanProfileDomContentLoaded` /
  `cleanProfileWorkspaceActionVisible`：与 `cleanProfileLaunch` 使用同一起点的累计 phase 信息项，
  用于区分操作系统与 packaged process 启动、首窗、Renderer DOM 和 Welcome 交互阶段；预算仍只由
  完整的 `cleanProfileLaunch` 样本执行，不得用单个 phase 替代。
- `*OwnedMemory`：保留 working-set 指标作为跨版本连续基线，同时补充平台原生的进程占用证据。
  macOS 使用 `/usr/bin/footprint` 的 `phys_footprint`；Windows 使用
  `Win32_Process.PrivatePageCount`。两者都比直接求和 RSS 更适合定位 Main、Renderer 和 Agent
  Host 的真实优化对象，但语义并不相同，因此报告必须按平台解释，禁止把 macOS
  `phys_footprint` 与 Windows private pages 横向排名。当前 owned/effective memory 是信息项；在
  积累 Windows 与 macOS 多版本基线之前不设置武断的统一预算。
- `rendererResources`：Welcome 从 DOM 的 `script[src]` / `link[href]` 建立 production asset 基线；
  Runtime 初始化与 Session restore 使用 Playwright request lifecycle 捕获操作期间新增的同源
  `app://pi67` 请求，并记录路径、resource type、body/transfer bytes 和 duration。单阶段最多 512 项，
  报告最多保留 128 项；不记录外部 URL、Workspace 路径、Prompt 或 Session 内容。自定义 scheme 的
  页面 `PerformanceResourceTiming` 在 packaged Electron 中可能为空，因此不能把该 API 的零条目当成
  “没有加载资源”的证据。报告同时按同名 production renderer build asset 记录静态文件 bytes，避免
  custom scheme 的零 transfer size 把“更多但更小的本地 chunk”误判为未知；该值不是网络传输、解析
  成本或 decoded memory。请求监听仍看不到 Worker 内部 fetch 和运行时分配，不能替代 heap/footprint
  证据。
- `connectedAgentHostWorkingSet`：用户显式触发 Agent Host 后统计 Main、renderer 和
  `node.mojom.NodeService`，但此时 Pi SDK 仍未加载；该值是信息项，不能冒充真实 session idle。
- `initializedRuntimeWorkingSet`：用 profile 内隔离的 `PI_CODING_AGENT_DIR` 和 workspace 创建
  真实 Pi SDK session 后统计三进程；不读取用户配置，也不包含 provider turn 或大型 transcript。
- `runtimeInitialization`：从用户触发“选择工作区”开始，经过原生目录对话框 bridge、Pi SDK
  初始化，直到 runtime phase 为 `ready` 且 lazy WorkspaceShell 的 conversation region 已可见。该指标
  防止用更小的 Welcome bundle 换取不可见的工作区等待回归；在取得代表性的 Windows/macOS 多版本
  基线前保持 informational。
- `packagedCommandPaletteFeedback` / `packagedCommandPaletteFirstOpen`：在真实 packaged
  `app://pi67` Renderer 中，首次按下 `Ctrl/Cmd+K` 到加载状态可见、以及 `Command Palette`
  lazy chunk 完成并呈现可访问 Dialog 的时间；预算分别为 p95 `<= 50 ms` 与 `<= 400 ms`。
  使用 Renderer 内 `performance.now()` 和同一快捷键处理路径，排除 Playwright transport /
  locator polling，并在 Dialog 可见后等待两帧；不等待 Session 搜索或 Extension Command
  查询完成。
- `runtimeInitializationWorkingSetDelta` / `runtimeInitializationAgentHostDelta`：同一样本中 initialized
  Runtime 减去 connected-but-unloaded Agent Host 的 aggregate / Agent Host RSS，用于区分 Pi SDK、
  model/resource/extension 和 Session 初始化阶段的增量；它仍是 sampled RSS，不是 retained heap。
  报告同时保留 initialized 状态的 Main、Renderer 和 Agent Host 分量。
- `agentHostRecovery`：在上述隔离 session 已 ready 后终止 Agent Host node utility process，
  等待 renderer 收到 failure notice、新 Agent Host PID 出现并重新得到 `ready` runtime phase。
- `activeExtensionCommandClose`：在 packaged Runtime 中调用受控、不可取消的 Extension command，
  由该 command 启动一个无网络 child process；从 `ElectronApplication.close()` 开始计时，随后验证
  Pi `session_shutdown(reason="quit")`、child PID 和 Agent Host PID 均退出。该指标有独立的五秒预算，
  但它不调用 Provider，也不是 Pi Tool，因此不能替代 `activeToolClose`。
- browser-tier message projection 使用 production Vite bundle 和 MessagePort fixture，不包含 Pi
  JSONL 磁盘读取或 Pi SDK restore。
- transferable Session asset 当前由 Runtime Registry unit、Protocol round-trip、Agent Host transfer-list
  test 和 Renderer Playwright E2E 证明边界与生命周期；现有 packaged 性能报告尚未单独输出大型图片
  decode/transfer/Blob memory 指标，因此不能从无回归的启动/消息投影数字推断 10 MiB 图片性能。
- `rendererLoaded1kHeapDelta`：同一样本中，加载 9 个 older page 后的 CDP used heap 减去最近
  100 条恢复后的 used heap；预算为 6 MiB。`rendererAfter10SwitchesHeapDelta` 使用连续 10 次
  Session bootstrap 后的 used heap 减去首次恢复值，预算为 4 MiB。两项都先调用
  `page.requestGC()` 并等待两帧，再读取 `Runtime.getHeapUsage`；DOM 上限来自
  `Memory.getDOMCounters`。它们能发现 Renderer retained tree/array/listener 回归，但不是
  packaged Electron RSS、heap snapshot dominator、系统内存压力或 Windows 证据。
- `transcriptScrollDroppedFrames` 对同一个 1,000 条消息虚拟列表连续执行三次 1 秒全程快速
  滚动，并对三轮丢帧率取平均。每轮仍保持原有滚动速度，避免单个调度抖动决定整个样本，
  同时持续掉帧仍会超过 1% 预算。
- `realPiSessionProjection`：在 profile 内使用 Pi SDK 的 `SessionManager.create()` 和
  `appendMessage()` 生成并校验 1,000 条 user/assistant message，再通过 packaged Electron
  原生文件对话框 bridge 导入为 managed copy；计时直到最近 100 条 message page、有界且
  虚拟化的 flat session tree、fixture message 和 composer 均可用。fixture 位于临时 profile，
  测量后删除，不进入仓库；不能把该指标描述为在 DOM 中挂载全部 1,000 条消息。
- `sessionRestoreWorkingSetDelta` / `sessionRestoreAgentHostDelta`：同一样本中 1,000-message restore
  减去 initialized empty Runtime 的 aggregate / Agent Host RSS，避免只报告恢复后的三进程总量。
  报告同时保留 restored 状态的 Main、Renderer 和 Agent Host 分量。
- Session Catalog warm 指标使用已完成 reconcile 的真实 `node:sqlite` metadata DB；first/next
  page 和 search 不得触发 Pi SDK discovery。Cold rebuild 单独报告 JSONL 文件数/bytes、SDK
  discovery、transaction、RSS 和 event-loop delay，在取得 Windows/OneDrive 数据前不设武断
  release gate。所有临时 Catalog/fixture 在测量后删除，报告只进入 ignored artifacts。
- `welcomeHighlightResources`：在 Welcome 且 Agent Host 尚未连接时检查 production resource
  timing，`code-highlighter`、Shiki WASM 和 TypeScript grammar chunk 必须全部为 0。
- `coldLongCodeHighlight` / `warmLongCodeHighlight`：分别测量 780 行冷加载与 720 行已加载
  TypeScript 代码块；样本启动时读取 64 KiB projected text budget 并断言不越界。总行数由
  highlight result 元数据校验，DOM 必须只保留有界的虚拟窗口，
  而不是同时挂载全部 `.code-line`。当前为 informational，不在缺少代表性长代码样本时
  臆造 release budget。
- `longCodeHighlightMaxLongTask`：使用 Chromium Long Tasks API 暴露同步 tokenizer 的主线程
  阻塞风险；`longCodeComposerInputToPaint` 单独验证长代码投影完成后的输入响应，不能冒充
  tokenizer 执行期间的真实按键延迟。
- `packagedLongCodeHighlight`：使用另一份临时官方 Pi JSONL 打开 500 行 TypeScript 代码块，
  验证 production `app://pi67`、CSP、same-origin module worker、Shiki WASM、grammar 和虚拟行
  窗口真实协作；该信息项在大 session restore 与 recovery 计时之后运行，不污染两项预算。

当前 packaged smoke 会注入 Electron `powerMonitor.resume`，证明 Main → Preload → Renderer →
Projection resync 链路，但不等于真实操作系统 suspend/resume、网络重连、时钟跳变或硬件唤醒证据。

Windows CI 在 unsigned packaged runtime smoke 之后运行 `package:smoke:windows-ui`。该脚本分别以
`--force-device-scale-factor=1.25`、`1.5` 和 `2` 启动三个独立的 Windows x64 packaged 进程，
验证实际 `app://pi67` Renderer 的 DPR、1040/760 CSS 断点、Context/Navigation Drawer、焦点恢复、
Composer、Send/Stop 顶层命中、横向溢出和 Windows 标题栏原生按钮预留区。结果和截图写入 ignored 的
`artifacts/validation/windows-packaged-ui/`，CI 保留 14 天供人工复核。Composer E2E 另行验证
`isComposing` 与 legacy `keyCode === 229` 时不产生 `prompt.submit`；packaged 脚本只重复验证 bundle
wiring 下的草稿保留和 Enter 未被提交分支消费。

这条证据只能命名为 **Windows packaged synthetic-scale and composition smoke**。forced scale factor
不能证明 Windows 显示设置的真实 125%/150%/200%、Per-Monitor DPI v2、`WM_DPICHANGED`、多显示器迁移、
ClearType 或 RDP；synthetic DOM composition 也不能证明 Microsoft Pinyin、候选窗定位、TSF、Narrator
或真实 `isTrusted` 输入。正式 Windows DPI/IME 结论仍要求交互式 Windows 会话逐档录制配置、窗口、
候选确认和第二次 Enter 发送行为。

## Explicit real Provider long-turn validation

`eng/provider/measure-real-provider-long-turn.mjs` 提供显式 opt-in 的 packaged Electron 纵向验证，
但不会由普通 CI、`check`、`test:e2e` 或常规性能命令自动调用。本地执行前必须先生成当前宿主的
native package，并明确授权一次真实 Provider Operation 所需的 Provider、模型和临时 API key。
一次带 Tool continuation 的 Operation 通常会产生多次可计费 Provider 请求，SDK/Provider retry 也可能
增加请求数；当前 harness 不提供请求数、token 或金额硬上限，不能把一次 Operation 描述成一次付费请求。

```bash
corepack pnpm run package:native:unsigned

read -r -s "PI67_REAL_PROVIDER_API_KEY?Provider API key: "
echo
export PI67_REAL_PROVIDER_API_KEY
PI67_REAL_PROVIDER_OPT_IN=1 \
PI67_REAL_PROVIDER_ID=<provider-id> \
PI67_REAL_PROVIDER_MODEL_ID=<model-id> \
corepack pnpm run validate:provider-long-turn
unset PI67_REAL_PROVIDER_API_KEY
```

安全与证据合同：

- 每次运行创建独立的 Electron user-data directory、HOME、workspace 和 `PI_CODING_AGENT_DIR`；
- 不继承用户 Provider credential environment，不读取用户 Pi AuthStorage、Session 或 Extension；
- API key 只通过 `Provider 与凭据` 密码框进入 Agent Host runtime memory，不写入 JSONL、报告或日志；
- 不要把真实 key 直接写进 shell 命令、`.env`、仓库文件或 workflow input；本地示例使用隐藏输入，正式
  certification 优先使用受保护的 CI secret；
- 固定 Prompt 只用于要求真实模型调用受控 `pi67_long_turn_probe` Tool，不写入回执；
- 受控 Tool 默认等待 95 秒；认证 harness 同时核对 `approval.requested` 的 Host epoch、Operation、
  Tool Call、Tool name、target、cwd 和 `single-tool-call` scope。只有精确的受控 Tool 可以被允许一次，
  任意 `bash`、内置 Tool 或其他 Extension Tool Approval 都会先被拒绝，再让认证 fail closed；
- MessagePort 旁路观察只保留 `hostEpoch`、accepted ACK、受限 Approval authority、`operationId` 和
  terminal event，不记录
  request、Prompt、stream text、raw Tool payload 或源码；
- 运行结束后从隔离目录读取 Pi JSONL header，回执只记录 Session ID、相对路径、bytes 和 SHA-256；
- 去敏回执写入 ignored 的 `artifacts/validation/provider-long-turn/summary.json`。
- 成功或 Provider 失败都会生成有界回执；失败回执只保留固定错误码、allowlisted harness stage 和
  各阶段布尔证据，不保存任何第三方 `error.name`、message、cause、stack 或 Provider body，也不会把
  原始 Provider 异常重新抛到 CI 日志；
- 本地回执至少绑定 packaged executable SHA-256；正式 Windows certification 还必须绑定完整 checkout
  commit/tag、GitHub run identity、signed NSIS installer、预期 signer 和共享 Windows signed candidate identity。

仓库另提供只允许手动触发的：

```text
.github/workflows/provider-long-turn-certification.yml
```

该 workflow 必须显式填写 tag、Provider、Model、thinking level、90,000–300,000ms Tool delay，
并把 `confirm_paid_request` 设置为 `true`。Job 固定绑定 GitHub Environment：

```text
provider-certification
```

该 Environment 必须启用 required reviewers、禁止 self-review，并只允许受保护的 release tag。
以下 Secrets 应配置在该 Environment，而不是普通 repository scope：

```text
REAL_PROVIDER_API_KEY
WINDOWS_CSC_LINK
WINDOWS_CSC_KEY_PASSWORD
```

Publisher identity 不是签名私钥，应配置为 repository 或 organization Actions variable：

```text
WINDOWS_SIGNER_THUMBPRINT
```

不要在 `provider-certification` Environment 中创建同名 variable 覆盖该 authority。该变量必须是预期
Windows Publisher certificate 的 40 位 SHA-1 thumbprint。Workflow 不只接受
`Get-AuthenticodeSignature.Status=Valid`，还要求 installer 与 packaged executable 使用同一个预期 signer。

Workflow 在 Windows 2025 x64 checkout 精确 tag 且不保留 Git credential，运行全仓 `check`，构建
Authenticode-signed Windows candidate，并通过共享 Node CLI 生成 `pi67.windows-signed-candidate.v2`
identity。Provider 认证从精确 package version 派生 source policy：prerelease 使用
`source.policy=version-tag`，稳定版本使用 `source.policy=stable`。Stable Signed Release 始终保持默认
`source.policy=stable`，不会因为 Provider prerelease 路径而接受 prerelease。
Workflow 验证 installer 和 `win-unpacked/Pi-67 Desktop.exe` 的签名，执行 packaged
smoke，然后只发起一次获授权的真实 Provider Operation；该 Operation 可能包含 Tool continuation 或
retry 产生的多次可计费 Provider 请求。Receipt 记录实际 checkout 40 位 commit、tag、
candidate identity SHA-256、signed NSIS installer 与 packaged executable 的 bytes、SHA-256、Signer
thumbprint、GitHub repository/run/attempt、Provider/Model/实际 thinking level，以及纵向 Operation/JSONL
证据。Provider summary 只保留有界 candidate reference，不复制 certificate subject。Provider Operation
结束后共享 candidate verifier 还会重新核对 installer/executable 的 bytes、SHA-256、Authenticode 和预期 signer，
防止认证期间发生字节漂移。CI artifact 同时保留这次认证绑定的 signed installer、实际运行的
`win-unpacked` 树、shared candidate identity 和 receipt，并以：

```text
provider-long-turn-windows-x64-<workflow-run-id>-<workflow-run-attempt>
```

作为 30 天 CI artifact 上传。Workflow 不发布 Release，也不会在 schedule、push 或 PR 上运行。

该手动 workflow 与 Windows native / Signed Release 共用同一 candidate schema、source policy、hash、
Publisher 和 verifier authority，但仍会在自己的 workflow run 中构建候选，因此只证明该手动 run 的
candidate。Stable Signed Release 另有不可跳过的 `provider_long_turn_certify` Job：它直接下载同一 run/attempt
中 build Job 生成的 exact signed Windows artifact，不重新 build；`verify_release_gate` 再把 Provider summary
绑定到与 Windows native certification、最终 publish 完全相同的 candidate identity SHA-256。

验收要求是 accepted ACK 不超过 5 秒、受控 Tool 实际持续时间不少于请求值、Operation 最终为
`operation.completed`，并存在有效的 Pi JSONL identity。该回执可以证明“真实 Provider + packaged
Electron + accepted Operation + 超过 90 秒业务操作 + terminal receipt”的单条纵向链路，但受控 Tool
提供了长时段，因此不能把它当作一般 Provider latency benchmark，也不能替代真实业务 Prompt 的长期
稳定性样本。没有实际执行并保留回执时，只能报告“harness 已实现”，不能报告真实 Provider 已验证。

当前常规 harness 仍不证明 power-cycle cold launch、真实 Provider turn 的完整 memory 曲线、
Provider-driven active-tool close、签名安装包升级或 Windows/macOS 另一平台。报告必须继续列出这些 unverified 项，
不能因为较低层预算通过就删除。
