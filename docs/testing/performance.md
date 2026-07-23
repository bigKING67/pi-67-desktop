# Performance and runtime evidence

## Budgets

预算是 release gate，不是当前已达成声明。使用 release build、干净 profile 和至少 10 次
样本，报告 p50/p95、硬件、OS、commit 和测量脚本。

| Metric | Budget |
| --- | ---: |
| cold launch to first usable window p95 | <= 3.0 s |
| warm launch p95 | <= 1.8 s |
| on-demand Welcome working set: Main + renderer | <= 350 MiB |
| composer input-to-paint p95 | <= 50 ms |
| streaming renderer commits | <= 20/s |
| 1,000-message session first usable projection p95 | <= 1.5 s |
| 1,000-message transcript scroll dropped-frame rate | < 1% |
| Agent Host crash to recovered snapshot p95 | <= 3.0 s |
| app close with active tool p95 | <= 5.0 s |

Code highlighting、Markdown 和长 transcript 必须保持 lazy/virtualized；首屏不加载 Shiki
WASM 或语言 grammar。Streaming batching 默认 50 ms，禁止 token-level React commit。

## Required scenarios

- welcome、首次 workspace、已有大 session、暗色/亮色；
- 连续三轮真实模型 turn，含 read/bash/edit/write、图片、abort 和 compact；
- 1,000 条消息、长 code block、长 tool output、快速滚动和输入；
- Agent Host crash/restart、外部 session 修改和 app quit；
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

```bash
PI67_PERF_SAMPLES=10 corepack pnpm run performance:measure
```

该命令会：

1. 构建 production renderer、Main、Preload 和 Agent Host；
2. 为当前受支持平台生成 unsigned unpacked application；
3. 对 production renderer bundle 运行 browser-tier 1000-message、composer、scroll、
   streaming，以及 Shiki/WASM/TypeScript grammar 延迟加载与长代码测量；
4. 对 packaged Electron 运行 clean-profile launch、warm-profile launch、Welcome working
   set、按需连接但未加载 Pi SDK 的 Agent Host working set、隔离目录中的真实 Pi SDK session
   初始化、官方 `SessionManager.appendMessage()` 生成的 1,000-message JSONL restore，以及
   active-session Agent Host crash recovery 和 `app://pi67` 下的 code worker/WASM smoke 测量；
5. 将报告写入 ignored 的 `artifacts/performance/`。

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
- `connectedAgentHostWorkingSet`：用户显式触发 Agent Host 后统计 Main、renderer 和
  `node.mojom.NodeService`，但此时 Pi SDK 仍未加载；该值是信息项，不能冒充真实 session idle。
- `initializedRuntimeWorkingSet`：用 profile 内隔离的 `PI_CODING_AGENT_DIR` 和 workspace 创建
  真实 Pi SDK session 后统计三进程；不读取用户配置，也不包含 provider turn 或大型 transcript。
- `agentHostRecovery`：在上述隔离 session 已 ready 后终止 Agent Host node utility process，
  等待 renderer 收到 failure notice、新 Agent Host PID 出现并重新得到 `Pi SDK 已就绪`。
- browser-tier message projection 使用 production Vite bundle 和 MessagePort fixture，不包含 Pi
  JSONL 磁盘读取或 Pi SDK restore。
- `realPiSessionProjection`：在 profile 内使用 Pi SDK 的 `SessionManager.create()` 和
  `appendMessage()` 生成并校验 1,000 条 user/assistant message，再通过 packaged Electron
  原生文件对话框 bridge 导入为 managed copy；计时直到 1,000 个 session tree 节点、fixture
  message 和 composer 均完成投影。fixture 位于临时 profile，测量后删除，不进入仓库。
- `welcomeHighlightResources`：在 Welcome 且 Agent Host 尚未连接时检查 production resource
  timing，`code-highlighter`、Shiki WASM 和 TypeScript grammar chunk 必须全部为 0。
- `coldLongCodeHighlight` / `warmLongCodeHighlight`：分别测量 2,000 行冷加载与 1,800 行已加载
  TypeScript 代码块；总行数由 highlight result 元数据校验，DOM 必须只保留有界的虚拟窗口，
  而不是同时挂载全部 `.code-line`。当前为 informational，不在缺少代表性长代码样本时
  臆造 release budget。
- `longCodeHighlightMaxLongTask`：使用 Chromium Long Tasks API 暴露同步 tokenizer 的主线程
  阻塞风险；`longCodeComposerInputToPaint` 单独验证长代码投影完成后的输入响应，不能冒充
  tokenizer 执行期间的真实按键延迟。
- `packagedLongCodeHighlight`：使用另一份临时官方 Pi JSONL 打开 500 行 TypeScript 代码块，
  验证 production `app://pi67`、CSP、same-origin module worker、Shiki WASM、grammar 和虚拟行
  窗口真实协作；该信息项在大 session restore 与 recovery 计时之后运行，不污染两项预算。

当前 harness 不证明 power-cycle cold launch、真实 provider turn 与其 memory、active-tool
close、签名安装包升级或 Windows/macOS 另一平台。报告必须继续列出这些 unverified 项，
不能因为较低层预算通过就删除。
