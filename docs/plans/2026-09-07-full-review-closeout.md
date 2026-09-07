# 全仓审查覆盖闭合

Status: active
Owner: Codex
Started: 2026-09-07
Last updated: 2026-09-07

## Goal

完成当前 Pi-67 Desktop 全仓工程审查，关闭逐文件覆盖和候选问题处置；修复已授权范围内的确认缺陷。

## Non-goals

不将源码审查冒充 Windows/macOS packaged 验收；不 push、上传、发布或修改无关 WIP。

## Acceptance criteria

- 以当前工作区 canonical inventory 为分母；每个文件有可追溯处置，未读文件不得标记已审。
- 旧证据仅在文件摘要一致且相关合同无漂移时复用；所有新文件和漂移文件重新审查。
- correctness、恢复、架构、维护性、性能、测试、构建依赖与发布、文档均有覆盖。
- 候选全部验证或明确否定；已确认缺陷按现有授权修复及针对性验证，不遗留未决候选冒充完成。
- 最终报告绑定源码状态和证据，列出运行态/平台缺口；canonical validation/finalize 通过。

## Delivery boundary

- Local implementation: 已授权全仓审查及确认缺陷的必要修复。
- Commit: 按已有授权，仅 scoped commit。
- Push: 未授权。
- Candidate build/upload: 不含上传；本地打包遵守候选隔离合同。
- Tag/release/promotion: 未授权。

## Current evidence

- 起点 HEAD 72cc9a3；现场存在独立的设置 UI、PRODUCT/DESIGN、预览脚本与 e2e WIP，必须保留。
- 历史 canonical 全仓 inventory 2851 文件，最高一次 REVIEWED 666；后续局部审查没有闭合全仓分母。
- 最近源码门禁 3563 passed / 5 skipped；不能代替逐文件审查。

## Decisions

采用一份全仓审查清单、内容摘要绑定的历史证据复用，以及有界只读分片；根代理统一验证及整改。

## Checkpoints

- [x] 建立当前 inventory 与历史证据可复用映射。
- [x] 分模块完成全仓文件处置；候选中 8 项验证受阻，尚未满足全部验证完成条件。
- [ ] 完成必要修复、独立复核和相关门禁。
- [x] 生成并校验源码审查报告，明确 provisional / E2 与运行证据缺口。

## Validation matrix

源码：逐文件证据 + 相关测试/typecheck/结构与边界门禁；运行态：按缺陷选择真实默认路径验证。
packaged/macOS/Windows：独立记录已验证与未验证，不由源码门禁推断。

## Rollback

仅逐批撤销本任务明确路径的变更；不回滚用户 WIP、用户数据或 Git 历史。

## Risks and unknowns

独立 WIP 可能继续漂移，需要内容摘要复核；旧证据不能仅凭 REVIEWED 标签继承。

## Progress log

- 2026-09-07：从连续局部修复转为全仓覆盖闭合，重新核实历史台账。

- 2026-09-07：全仓 canonical run `rc-20260907T090649Z-0d709a295bce` 已封存并通过 final validation。2894/2894 路径完成处置：2724 REVIEWED、43 COVERED_BY_PARENT、110 VENDORED、2 GENERATED、15 BINARY；后127项不计正文审阅。42项 CONFIRMED、8项 BLOCKED、5项 REJECTED。自动评分74/100，provisional / E2；不是无缺陷或目标平台验收通过。
- 报告在 `/tmp/pi67-full-review/pi-67-desktop/rc-20260907T090649Z-0d709a295bce/report.md`，规范化JSON与内容绑定证据同目录；测试源码门禁3563 passed / 5 skipped。未执行Windows、打包GUI、付费Provider、远端API操作或发布。
- 已准备首批P1修复 `rcf-20260907T101536Z-ea8e0083c244`：RC-PROTO-001、RC-PROTO-002、RC-RUNTIME-005；Worktree opaque身份、视觉证据协议、只读Git fsmonitor。37项针对性回归通过；独立审阅与聚合门禁以最终修复receipt为准。
- 其余39项确认问题尚未修复；8项BLOCKED不能并入已修复数。此前自动安全审查中止的验证未重试或换路径规避。
- 首次P1聚合源码检查通过，但独立审阅发现视觉附件额外字段仍被严格协议拒绝，因此首次修复attempt如实记为PARTIAL。补正时建立3文件focus基线（非重做全仓），在实际投影显式摘取附件四字段；13项该边界回归通过，后续聚合receipt独立保留。
- 本地macOS预览未运行：`docs/release/internal-candidate-distribution.md` 明确要求“未提交的并发WIP不得进入本轮候选”，当前独立UI/预览脚本WIP仍存在；不得为验收复制项目或擅自创建worktree。
- 首批3项P1源码修复完成：独立复核AGREE；最终聚合检查3578 passed / 5 skipped。首次attempt保留PARTIAL，视觉补修attempt `rcf-20260907T102550Z-3b0ee7860112/attempts/attempt-0001-365f4e58e2c1` 已VERIFIED且live validation通过。全仓原报告74分是修复前基线，未重新评分。其余39项确认问题和8项BLOCKED仍未闭合。

- 第二批已实施12项功能整改，尚未全部验收：保存/重载保护后续草稿、Workspace导入目标与排队身份、Memory面板Workspace生命周期、企业授权generation及凭据串行清理、Catalog请求级Workspace捕获、附件分页控制记录恢复、npm标签识别、Rules Loader用户目录所有权、Package Worker共用来源分类、接收限流时间单调性。
- 独立复核发现并补正两种真实交错：旧授权store等待期间发起新授权时需在同一凭据队列补偿clear；Visual Assistance记录会隔开附件控制记录和user消息，分页需跨越精确已知类型。回归分别覆盖真实Broker ACK顺序及Pi SessionManager双向单消息分页。
- 本批仍需聚合门禁、最终独立复核与Memory面板真实页面验收；不得仅凭源码修复把12项全部标记关闭。原8项BLOCKED维持原处置。

- 第二批源码整改关闭11项：RC-RUNTIME-001/002/003/004/006/007、RC-STATE-001/002/003/005、RC-SUPPORT-001。聚合3598 passed / 5 skipped；独立复核同意。首次12项attempt保留PARTIAL（RC-STATE-002当时残余非文本边界，RC-STATE-004缺UI验收）。重载补修15项回归、类型与lint通过，独立审阅同意；补修attempt `rcf-20260907T123958Z-3cc8f1276434/attempts/attempt-0001-d906e570ef90` VERIFIED且live validation通过。
- 第二批提交排除MemoryInspectorPanel未验收改动及全部并行UI WIP；企业登录生命周期独立为EnterpriseAuthorizationController，保留原Broker/事件与外层接口。累计14项已关闭，剩余28项确认问题（其中Memory面板源码已改但验收未闭合）及8项BLOCKED。未重跑修复前全仓评分；未push或新建候选。

- 第三批关闭26项：RC-BUILD-001、RC-DOC-001至006，以及19项RC-RESOURCE确认问题（001至008、010、012至021）。发布job显式绑定GH_REPO；文档对齐实际IPC clone、Windows Job Object、安全模式、性能预算和Pi版本；内置资源修正链接、CLI参数、分页/附件完整性、身份、权限及示例结构/算术。
- 第三批7项初次attempt保留PARTIAL；安全模式文档补修 `rcf-20260907T125337Z-3c183edd1100/attempts/attempt-0001-70dd6f370046` VERIFIED，资源 `rcf-20260907T125420Z-98844dcdc2e4/attempts/attempt-0001-9bc6622d27c5` VERIFIED。全部snapshot validation和lineage检查通过，独立复核同意。合同测试、资源有界检查、结构/外部引用/Action pin/PowerShell静态门禁通过；附带仅格式化既有store接口签名以满足结构门禁。
- 累计40/42项确认问题关闭；剩余RC-BUILD-002的真实Provider脚本存在5处旧UI/草稿生命周期假设，RC-STATE-004仍缺Memory面板跨Workspace真实UI验收。8项BLOCKED未重试或绕过。未执行飞书业务API、付费Provider、Windows或macOS新候选验收；未push。并发WIP使clean-checkout delivery attestation暂不适用。

- 第四批：RC-STATE-004 在组件范围关闭。真实Chrome内挂载当前React MemoryInspectorPanel，经controller替换仅延迟memory.search响应：A查询pending后切B立即清空查询，A晚返回不展示；B较新成功后较旧失败不覆盖新结果/错误/busy。独立源码复核AGREE。证据 `/tmp/pi67-memory-lifecycle-evidence.json`、挂载夹具 `/tmp/pi67-memory-lifecycle-browser.js`、独立报告 `/tmp/pi67-memory-isolation-independent.json`。这是组件运行证据，无独立重放/原始wrapper归档，不等于完整导航、Electron或OpenViking服务验证。提交仅包含Workspace key与搜索代际屏障，保留归档UI等并行WIP。
- RC-BUILD-002 的旧控件/草稿时序源码已修复：使用命令面板与精确Provider身份、React Aria模型与思考ListBox，首次发送后绑定thinking.set实际模型与Prompt接受的完整Host/Workspace/Task/Session身份。34项Provider测试通过（新增8项实际监听器回归），Renderer typecheck及受影响文件oxlint通过；独立审阅AGREE。attempt `rcf-20260907T131025Z-bfe7fe1188b9/attempts/attempt-0001-bbf14399d2a3` 保留PARTIAL，validation/lineage通过。
- browser67真实页验证草稿和模型选项结构；命令面板RAF在hidden页面暂停，前台激活后visibilityState仍hidden，样本INVALID，完整Provider UI/打包认证保持UNVERIFIED。专用managed页已scoped finalize：closed=1、verified=1、remaining=0、errors=0；测试Vite已停止。累计41/42项确认问题在各自验证范围关闭，Provider 1项仍PARTIAL；8项BLOCKED不变。没有push、付费Provider或候选构建。

- 第五批：从RC-GAP-008分离出可直接确认的schema合同矛盾RC-IDENTITY-001。同一679字符合法fallback身份原先在Operation/context/accepted拒绝而settled接受；三处现统一使用既有32832字符上限。新增9项回归及独立复核12项通过，完整Envelope合成检查保留身份匹配和2MiB边界。真实Windows零dev/ino及长路径触发仍UNVERIFIED，不能把原GAP-008全部关闭。
- 首次身份修复attempt `rcf-20260907T134526Z-f6932dcb4f15/attempts/attempt-0001-a9ef040e5f24` 保留FAILED并通过完整性校验：聚合检查发现前一Provider提交的无调用导出。该残留按有界原生修复移除，后续聚合检查单独记录，不改写失败attempt为成功。独立报告 `/tmp/pi67-identity-independent.json`；相邻Provider认证探针对长物理身份仍使用512上限，属于认证工具的剩余限制。
- 更正原8项BLOCKED原因：GAP-001至004明确为自动安全审查中止，不重试或绕过；GAP-005/006为临时测试解析失败且0执行；GAP-007缺少专项连接绑定验证；GAP-008存在schema兼容性证据但真实OS触发未知。继续保留原封存台账，后续证据以增量处置记录，不把“schema拒绝fixture”误写成“自动安全审查拒绝”。
- RC-GAP-006新增运行证据：`/tmp/pi67-readonly-lifecycle-probe.ts` 加载实际Extension、临时只读配置及进程内fetch替身，`session_start -> session_shutdown`仍产生Session commit POST。输出 `/tmp/pi67-readonly-lifecycle-proof.json`，无外部网络。该生命周期只读合同违反已由探针确认，尚未修复；原封存报告不变，下一批补登记并完成默认路径回归。
- 第五批最终验证：所有静态聚合门禁通过；默认并发完整测试出现2项15秒超时，原日志 `/tmp/pi67-identity-final-check.log` 保留FAILED。两文件单worker复验23/23通过；完整覆盖率使用 `vitest run --coverage --maxWorkers=2` 复验3618 passed / 5 skipped，全部覆盖率阈值通过，日志 `/tmp/pi67-identity-coverage-recheck.log`。这是受限并发验证通过，不将默认聚合失败或canonical FAILED改写为PASS。本批scoped提交7文件，其余38个WIP路径内容摘要另行核验。

- 第六批关闭RC-GAP-006的客户端只读合同问题：启动保留本地恢复和读取但不创建/重放；压缩、关闭、手动commit及分支对齐尊重当前写权限，shutdown清理独立于写权限。首次生命周期attempt `rcf-20260907T135903Z-abd4e1506865/attempts/attempt-0001-b8fa68c26a59` 保留PARTIAL；结构清理attempt `rcf-20260907T140443Z-9e4686238d1e/attempts/attempt-0001-14a3fc19d696` 保留FAILED（默认并发Worktree测试超时），不改写历史。
- 独立复核进一步复现Pi默认并行Tool交错：remember在预检等待时另一browse边界收紧只读，旧流程仍POST；原证据 `/tmp/pi67-readonly-outstanding-write-proof.json` 保留。补修RC-REVOKE-001统一8个显式写方法发送前权限检查，队列在claim/预检/失败响应后复核权限，撤权后释放claim并保留队列及重试次数，成功ACK正常结算。新增8项实际Extension回归，含默认takeover、恢复lineage、单调撤权、并行Tool及503/400/200响应；既有Sync测试补完整配置/transport，未削弱断言。
- 最终模块58 passed /1 skipped；`env VITEST_MAX_WORKERS=2 corepack pnpm run check` 3626 passed /5 skipped，全部静态与覆盖率门禁通过。该环境变量已从当前Vitest实现核实，仅限本次命令，不改全局/仓库配置。独立复核4项通过且AGREE，报告 `/tmp/pi67-revoke-independent.json`。最终补修attempt `rcf-20260907T140841Z-9193506b635d/attempts/attempt-0001-cb41e374cf56` VERIFIED，live validation与lineage通过；scope绑定实现及生命周期测试，类型声明和既有Sync测试另由当前源码门禁及独立文件摘要覆盖。
- RC-GAP-005也已完成有界源码核实：队列没有Endpoint/account/user/effective peer归属，上层没有隔离；当前client预检不能证明旧条目归属。独立报告 `/tmp/pi67-outbox-scope-independent.json`，结论是客户端存在错作用域派发路径，不声称真实服务接受/泄露。下一批为队列绑定不可变作用域并保留隔离旧无归属条目，需覆盖恢复watermark；尚未实施。GAP001-004自动安全审查边界、GAP007专项和GAP008真实平台未知继续保留；Provider完整UI仍PARTIAL。
- 本批仅本地scoped提交；38个无关WIP路径摘要保持不变。无真实服务、外部网络操作、macOS新候选、Windows验收或push。原全仓74分仍是修复前provisional基线。

- 第七批完成RC-GAP-005派生RC-OUTBOX-001的客户端作用域修复：队列目录、条目、去重身份与最新v2 watermark绑定实际Endpoint/Account/User/effective peer；缺少Actor字段时凭据仅参与整体摘要，不存原文或独立凭据摘要。旧根队列及foreign条目保留隔离，历史归属不明时禁止capture/replay/commit并要求新Session，禁止重置后重采历史。
- 新Session先写归属锚点再入队；健康检查前完成锚定，断网恢复保留有效归属。等待期间peer变化阻止后续派发；恢复、清理、claim与重试均过滤归属。拆分明确职责的pending-queue-storage.mjs和scoped-pending-queue.ts，保留原队列公共入口与既有重放策略。PRODUCT同步行为合同，仅提交该段，保留其他UI/品牌WIP。
- 模块74 passed /1 skipped；独立复核27/27通过且AGREE，报告`/tmp/pi67-outbox-final-independent.json`。主Desktop的materializeSession在Extension绑定前重开Pi JSONL，源码支持首次锚点同步追加；不声明其他宿主、fsync/断电持久性或真实服务身份映射已验收。
- Canonical attempt `rcf-20260907T142855Z-bcee509c39f5/attempts/attempt-0001-910e814a60f2`保留FAILED：聚合type-aware lint发现新增测试隐式URL字符串转换，snapshot validation及lineage通过。补正仅显式区分string/URL/Request，不改行为断言；最终原生`env VITEST_MAX_WORKERS=2 corepack pnpm run check`退出0，703测试文件通过、3642 tests passed /5 skipped，全部静态及覆盖率门禁通过，日志`/tmp/pi67-outbox-final-check.log`，源码摘要`/tmp/pi67-outbox-final-source-hashes.json`。此后验通过不改写canonical FAILED，也不声称VERIFIED_WITH_RETRY或clean-checkout delivery attestation。
- 两个既有测试fixture（index-peer/lifecycle-recovery）另由独立摘要与最终聚合门禁覆盖。38个无关WIP路径已核验保留；无push、服务端操作、macOS新候选或Windows验收。GAP001-004自动安全审查边界、GAP007连接绑定专项、GAP008真实平台未知和Provider完整UI PARTIAL仍未闭合；原74分仅为修复前基线。

- 第八批修复Provider认证工具的物理身份上限残留：真实安装的startup receipt监听器仅对sessionFileIdentity使用协议一致的32832上限，普通ID保持512限制。监听函数需要被序列化进Renderer，因此保留自包含数值，由引用domain权威常量的边界回归约束一致性。新增679字符、最大值接受、空/超长物理身份和普通ID越界拒绝7项回归；eng/provider 9文件41/41通过，受影响文件type-aware lint通过。本批为两文件工具局部修复，不改产品协议，不重复全仓门禁；不将监听器fixture通过宣称完整Provider UI或打包认证。
- 上一批聚合通过后仅清理新增storage文件末尾空行并检查staged diff，不涉及逻辑变化。当前仍需完整Provider UI/打包证据、GAP007专项连接绑定与GAP008真实Windows证据；GAP001-004的自动安全审查中止不通过重试或替代路径绕过。
