# New Money Server 独立化与 Desktop 接入

Status: active — local implementation verified in bounded checkpoints; source consolidation pending
Owner: Codex
Started: 2026-09-08
Last updated: 2026-09-20

## Current closeout and source consolidation (2026-09-20)

This summary supersedes dated pending-action statements below, not their evidence
limits. Older checkpoints remain historical records; an unchecked R1–R6 item
does not mean that every subtask is still unimplemented, and individual passing
checks do not establish complete release readiness.

- Account display: the operator confirmed that Desktop now displays the expected
  personal name. Explicit refresh persists only displayName in Main's encrypted
  credential store, with serialized comparison against the current credential.
  Isolated store recreation and Host tests cover persistence; a real-account
  restart observation is still unverified.
- Latest local validation: targeted tests 27 passed; complete `check:source`
  passed with 869 test files / 5,681 tests passed and 24 tests skipped; account
  and shared-knowledge Renderer E2E 13 passed. These results cover the combined
  dirty working tree, not an independently validated future commit subset.
- macOS arm64 unsigned preview rebuilt, packaged smoke passed and preview opened.
  Its app.asar SHA-256 is
  `22cd0e0cad2520356a0caa51a77369677d9abeadf2249ca9fc6c5c6b6c8be72b`.
  Windows and formal distribution are not established by this evidence.
- The operator's prior team-session screenshot shows successful project search
  and read of the synthetic SOP. This is bounded user-reported UI evidence,
  not proof of all membership, revocation or production-use scenarios.
- Server account/profile implementation was committed and deployed separately at
  `831ed0364c25e744135c37ab95f5e6e8ac4bbb0e`; current source consolidation does
  not authorize another deployment. Real-member invitation acceptance is deferred.
- Backups are explicitly deferred. The previously checked timer was disabled;
  no backup activation, off-host automation or deletion is part of this closeout.

Read-only source inventory: Desktop HEAD
`0b2f295ce95db47b5ee3a4b3f841562327397c00` has 168 tracked modifications and
347 untracked entries, with no staged changes. Account, memory, shared knowledge,
protocol and lifecycle changes overlap; do not commit all of them as a profile-only
fix or assume filename grouping proves independent buildability.

Proposed commit order, subject to exact staged-scope review:

1. Server delivery evidence: only `docs/ACCOUNT_PROFILE_INVITATIONS.md`.
2. Desktop memory/team integration: identify the complete dependency closure and
   preserve unrelated Provider, prompt-attachment and other pre-existing WIP.
3. Account/error presentation follow-up only if it can be separated from batch 2
   without a broken intermediate state; otherwise retain one coherent integration
   batch with an honest scope description and associated authority documents.

Server backup templates and backup-specific documentation are excluded from this
proposal and remain untouched. No commit, push, deployment, signing, production
write or runtime replacement was performed during this inventory. Show the exact
first commit scope to the operator before committing; inspect staged diff and run
the checks appropriate to the actual subset rather than reusing combined-tree
results as subset evidence.

## Goal

当前已接受合同见 `../adr/0002-new-money-local-memory.md`。下面的原实现记录仅描述
修订前的服务端 OpenViking 方案；其测试不能证明本地 sidecar、团队投影、项目权限或
只读历史已完成。此前完成状态已撤回。保留旧记录用于理解现有 WIP，不再据其实施。

## Revised checkpoints (2026-09-08)

- [ ] R1. OpenSpec 与两仓库职责、模型/隐私/权限/会话合同一致。
- [ ] R2. 本机 OpenViking 原生运行包、真实范围隔离和私人捕获限制验证。
- [ ] R3. Server 项目成员、范围、版本、事件流、模型政策和租约。
- [ ] R4. Desktop 同步、检索、会话来源、只读历史及 Web 管理。
- [ ] R5. 替代链路验证后删除 DataHub 活动实现，保留生产表和历史迁移。
- [ ] R6. 运维文档、PostgreSQL 本机卸载与完整门禁。

开始时源码基线为 `d3fc303754aa6096a4905632282dbcd200f1ac5b` 加原有未提交 WIP。
2026-09-09 现场 HEAD 已由其他工作推进至 `f22440aad149b4fe72fba9ca56092084f3bd5ebf`
（Provider discovery）；本任务未执行 commit，也未回退该提交。
Provider discovery/editor 与 prompt-attachment 改动不属于本任务。
没有 commit/push/deploy 授权；本机 unsigned preview 属已接受的验证范围。

### Current implementation evidence (supersedes old closeout)

### Active bounded repair: team worker failure stages (2026-09-20)

- Authorized: local implementation and isolated synthetic tests; no paid model calls,
  production mutations, private-memory access, operator signing or installed-runtime replacement.
- Observed: normal-profile project run created job/index files but no result receipt;
  existing worker hides every Python failure behind exit 70 and Host loses the stage.
  The exact production exception is UNVERIFIED, not attributed to credentials or timeouts.
- Scope: fixed native exit-stage codes, strict Main/Host diagnostic propagation and
  synthetic positive/negative regressions. Preserve all pre-existing WIP.
- Acceptance: no raw exception/body/key in diagnostics; failures never publish;
  success and cancellation semantics unchanged. Installed signed bytes remain unchanged.
- Rollback: revert only this repair's hunks; never roll back the dirty baseline.
- Source implemented: fixed exit stages 71..76, strict failed-only IPC field,
  Host error propagation, protocol revision and no raw-error logging.
- Isolated native verification: 5/5 pass on Apple Silicon using the installed
  team's Python as read-only input; success, denial, cancellation, corrupt revision
  and synthetic HTTP 401. Temporary test trust only; original tree hash remains
  558f566f926765ef7b38166334ddd4be5285b067ca9c027d9f941e4a6c59c243.
  Success includes indexed search/body read and physical process-group exit.
- Targeted lifecycle tests 46/46 and Python input/stage tests 11/11 pass;
  full typecheck and aggregate `corepack pnpm run check` pass.
- `corepack pnpm run preview:mac:unsigned` completed: rebuilt macOS arm64 package,
  packaged Electron smoke passed, repository preview opened (PID 43159).
  app.asar: 200652182 bytes, SHA-256
  d76b364f0e6307fdf21b7d266c2d90dabd36f10fdf1ef2cf6c4d5be11d9e2a1f.
  This updates Main/Host diagnostics, not the installed signed Python worker;
  it is not evidence that the user's real-provider indexing failure is fixed.
- The synthetic HTTP failure recreates partial files/no receipt and now exits 74;
  this does NOT establish HTTP 401 as the production cause. No real-provider retry.
- Remaining boundary: new diagnostic Python bytes need separately authorized
  operator signing/isolated acceptance and installation before live-stage proof.

- 2026-09-20 subsequent explicit authorization covered existing-key signing,
  isolated acceptance and replacement of only the team-index runtime with rollback.
  Completed: candidate tree `e57dc9ccf310d1706e5a56953fb194200c01bba9e4228a18ee2a6ca79976a394`
  (54348 files, 641326956 bytes), source-pinned signature verified by independent
  isolated installer and again by the normal-profile installer. The temporary
  bundled signing CLI emitted a storage-CLI usage warning and exited 1 despite its
  PASS assembly receipt; this exit is not counted as a clean CLI pass. Independent
  installer verification succeeded with exit 0; no signature bypass was used.
- Native synthetic suite passed 5/5 using the isolated signed runtime's Python.
  Its success fixture adds the query bootstrap and uses ephemeral test trust;
  this is separate from actual-key installation verification. Direct execution
  of the exact signed index script rejected missing input with exit 72 and empty
  stdout/stderr. No paid provider calls or production service writes.
- Desktop was normally quit before replacement. Old installation is preserved at
  `/Users/gaoqian/Library/Application Support/New Money/openviking/runtime/openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64-team-index-v1.rollback-20260920-stage`;
  its full tree still matches the previous identity. Private and team-query runtime
  trees match their before hashes; no private/shared data migration or deletion.
  Installation receipt: `artifacts/team-stage-upgrade-73GvVr/replacement-receipt.json`.
  Repository preview reopened without rebuilding unchanged Desktop source.
- Remaining acceptance: a user-triggered real-provider index run must report its
  actual stage/result. Installation success does not establish the original cause
  or prove that real-provider indexing now succeeds. No automatic retry was run.


- 2026-09-20 用户继续后的单次同机 API/DB + Mac Desktop 原生联合验收 PASS。
  复用 asar ff1650f3a97c2e007713c328d8500bba0ed3d271b567561a5feb53c237fef102
  和原有两份签名运行包，前后全树/公钥验签与 asar 身份一致，未读取私钥、签名、
  重建或替换日常安装。临时 API 复用 VPS 镜像 3723d597dc26（完整身份见下方同机
  诊断），仅连 newmoney_test；Mac 经专用 SSH 回环隧道访问，无公网测试端口。
  真实设置入口安装、设备登录、项目绑定、合成候选发布/同步、原生索引、Pi 搜索与
  精确正文、冷恢复、撤销后模型计数不增、项目撤权拒绝同步、logout/冷启动未登录
  全部通过。producer/consumer exit0，总179.714秒含隔离安装/冷启动，不是响应时延。
  87请求/87响应、代理超时0；阶段记录中成功 read 的准入987–996ms、正文92–100ms、
  最终校验29–30ms，总1114–1120ms；head授权218–223ms、版本探测222–228ms。
  撤销后 revision-changed 及969ms准入失败为预期负例，不计作正例性能失败。
  对比旧 run-91iq7G 的8812–9251ms准入，相同客户端字节下出现明显改善，支持
  跨网络数据库往返是旧隔离布局的重要放大因素；服务器构建/数据夹具仍非严格配对
  A/B，不能归因全部差值或宣称历史偶发已根治。剩余约220ms单次在线调用包含
  SSH/WAN/服务端处理，未测纯网络RTT；本次不经过Cloudflare公网HTTP入口。
  模型为合成服务（agent5/embedding16/extraction0），不代表真实模型质量或时延，
  未细分完整原生索引/检索CPU及真实模型时间，不由本次数据承诺p95/生产SLA。
  回执 artifacts/evidence/packaged-team-session/run-xJE7Fp/receipt.json；本次操作、
  前后数据库/签名身份和清场证据在 artifacts/evidence/team-native-samehost-20260920-OL8pKg/。
  22业务表恢复空、9迁移与保护标记不变、其他DB连接0；仅删除本次合成Profile、
  测试数据、TLS/会话控制文件和临时API容器，SSH隧道已退出且18167无监听。
  线上API/web/PostgreSQL镜像、启动时间、运行状态不变；未动生产数据、正常Profile、
  权限/超时/产品源码，未commit/push/deploy。后续完整性能验收沿用同机API/DB，
  公网入口、真实模型与规模性能仍独立取证，不为本次结果合并或缓存授权检查。

- 2026-09-20 用户继续授权后的单次 VPS 同机服务端性能诊断 PASS。复用现有 API
  镜像 sha256:3723d597dc26c590a931b0a37dc99ad4e896cfc3cdef69c9b92b530953e38d69，
  启动仅监听回环的临时只读容器，使用独立合成 JWT/邮件接收器以及精确
  newmoney_test/newmoney_test_app；未重建镜像、部署或重启生产。实例/角色/权限、
  22 张业务表空、9 条迁移及无其他连接的前置检查通过。正常注册验证、设备授权、
  项目显式入组、发布 1 条合成 SOP 后，以真实 HTTP 顺序执行 10 组“三次项目授权
  + 一次当前 head sync(limit=1)”：每次授权 1.102–4.992ms，head 1.932–4.128ms，
  每组 6.201–14.606ms；核对权限 revision 一致、epoch/cursor 不变且无待同步变更。
  撤销项目成员后 authorization/sync 均 403，设备 logout 204。仅 1 封本机合成
  邮件，无真实发信或模型调用。前后数据库快照完全一致；仅清空本次合成数据，
  不改 schema/迁移/实例标记；临时容器/邮件监听/私密 env 目录已删除。
  API/web/PostgreSQL 生产容器镜像、启动时间及运行状态前后相同。
  回执与精确 SHA256 对应的无凭据操作脚本保留在
  artifacts/evidence/team-samehost-20260920-s7Ct85/{receipt.json,benchmark.py}。
  此结果支持跨网络 SQL 往返放大历史隔离验收延迟的解释，但不是配对 A/B：本次为
  VPS 已部署 release 镜像、小型暖态数据和本机 HTTP；历史为 Mac 测试 binary，
  数据夹具及环境不同。不含公网 TLS/HTTP、Desktop 文件校验/IPC/模型/原生查询，
  不是生产 SLA、完整 reader-admission 或历史偶发根因已消除的证明。不删授权检查，
  不调超时、不改产品源码；后续端到端采样优先采用 API/DB 同机的测试拓扑。

- 2026-09-20 用户本轮明确授权的一次隔离 native/VPS 联合验收 PASS，未自动重试。
  使用现有应用 asar ff1650f3a97c2e007713c328d8500bba0ed3d271b567561a5feb53c237fef102；
  服务端 clean HEAD 262ce7fd6fd1fee055ea358eeb16dca91e15ab67，测试 binary 身份保留于
  artifacts/evidence/team-native-20260920-fB7YsN/server-identity.json。两份既有团队
  签名源全树/公钥验签通过，未读取私钥或生成签名；独立 Profile 经实际设置入口安装。
  登录、项目绑定、合成知识发布/同步、原生索引、Pi 精确搜索/正文读取、冷恢复、
  撤销后的历史处理拒绝且模型计数不增、项目移除同步拒绝、退出/冷启动未登录均通过。
  Desktop/服务端 exit0，整轮819秒（含约555秒前置数据库流程，不是用户操作延迟）。
  回执 artifacts/evidence/packaged-team-session/run-91iq7G/receipt.json 为 native PASS，
  87请求/87响应、proxyTimeouts0，真实 Pi 两条 Tool Result 均成功且精确正文匹配。
  新分段诊断采集11条：成功 read 的准入8812–9251ms，本地正文94–96ms，最终检查30ms；
  head授权1322–2395ms、head-probe3285–4148ms。撤权后 revision-changed/准入拒绝
  属预期负例。记录不是去重后的独立操作样本或跨进程关联 trace，不能据此断言全部
  准入耗时均来自网络，也不能把这次通过当成历史偶发已根治或生产性能认证。
  前后独立读回：22业务表空、9迁移/保护标记相同、其他连接0；两签名树和应用字节
  不变，测试Profile/临时凭据与证书清理、本次SSH隧道关闭、15432/8787无监听。
  清场证据见 artifacts/evidence/team-native-20260920-fB7YsN/closeout.json；保留失败
  历史回执不覆盖。本轮未改生产数据/部署、调用付费模型、commit/push或写日常Profile。
  下一建议是只读细分团队 reader-admission 耗时；不延长产品期限或放宽授权。

- 2026-09-20 下一次隔离验收准备：工程探针现按每次 Electron 启动独立捕获 Main
  stdout 与 opt-in Host stderr，仅将严格验证的 head/read 阶段元数据写入既有
  receipt 的 phaseDiagnostics。每流单行缓冲 2048 字符，超限整行丢弃至换行；
  每次捕获及最终回执最多保留 128 条，不保存原始错误、身份或内容。未知字段、
  伪造 schema/阶段、负数/非整数耗时、输出分片/跨流及溢出恢复均有离线回归。
  2 文件 24 测试、脚本语法、typed lint、structure 与 dead-code 检查通过；后者
  仅既有 electron ignore 配置提示。只修改验收工具和文档，未重建/重启日常应用；
  现有 asar 仍为 ff1650f3a97c2e007713c328d8500bba0ed3d271b567561a5feb53c237fef102。
  只读核对服务端测试代码：必须精确 newmoney_test/newmoney_test_app，且操作前
  校验实例标记、服务器地址和非特权角色；测试会重置并写入合成数据。模型服务为
  本地合成 fixture，不需用户付费模型。尚未连接 VPS 或验证实时数据库/签名包身份，
  尚未运行真实联合验收；一次性测试库写入与清理待本轮明确授权，失败不自动重试。

- 2026-09-20 本地团队读取超时反馈修正完成：Host 的 8 秒初始 head deadline
  立即发送负回复，Main 不再空等自身 10 秒 fallback；调用方取消/退出清除该计时器，
  未结束 IO 继续占用四槽容量，迟到结果只释放资源、不回复成功。协议与权限预算未变。
  head 与正文读取各新增至多三段的固定阶段/结果/毫秒诊断；无正文、身份、地址、
  模型名、凭据或 raw error。head 使用既有 opt-in Host stderr 调试转发，read 使用
  Main stdout；正常 GUI 不持久保存，不自动开启 debug，未结束 IO 无 settled 记录。
  授权阶段失败不据此推定权限拒绝，阶段日志也不是跨进程关联 trace。
  定向 4 文件 94 测试通过；完整 check:source 865 文件/5636 测试通过、23 跳过。
  门禁后仅将 head 输出从会被丢弃的 stdout 改为既有 stderr 通道，补跑该文件
  25 测试与 typed lint 通过；macOS build/package/smoke、DMG/ZIP 校验和预览打开通过。
  新 asar 为 200648315 字节，SHA256
  ff1650f3a97c2e007713c328d8500bba0ed3d271b567561a5feb53c237fef102，
  identity/smoke 为 artifacts/release/macos-preview-{candidate-identity,packaged-smoke}.json。
  源码基于 0b2f295 加既有 dirty WIP；未 commit/push、连接 VPS、重置数据库、发布共享
  内容或调用真实模型。历史团队正文失败的完整真实链路仍未复验，Windows 未验证。
  下一步是有当前授权的一次隔离团队检索/正文读取验收，并显式采集上述阶段诊断。

- 2026-09-17 用户授权的一次隔离团队原生联合验收已执行，结果FAILED。macOS27.0
  arm64直接解包保留Alpha.41，asar仍为9f6640ab705b46e0adaa7019dc5ae118575da9ca2a730714fb65d990d80782ea，
  未重建产品。独立Profile通过设备登录、绑定、发布、回执同步和原生索引；团队搜索
  42015ms返回1项，随后正文读取18307ms失败，冷恢复/撤权/拒绝阶段未到达。
  新回执见artifacts/evidence/packaged-team-session/run-xhHMBb/receipt.json；
  服务端测试1通过/1失败，825.28秒，consumer退出1、producer退出101。
  63请求/62响应、代理超时0；最后authorization2551ms后sync5445ms关闭且无响应，
  合计7996ms，与共用8秒head观察预算耗尽一致，但Main内部具体失败点未直接记录，
  不据此断定历史偶发根因。无网络的实际head函数受控复现：总延迟7351ms时7353ms
  通过，总延迟8551ms时8003ms以TimeoutError中止；未修改产品超时或权限策略。
  本次API运行于Mac、专用PostgreSQL经VPS隧道连接，跨网络SQL延迟影响仍待单独验证。
  专用测试库清理后与前态一致：22业务表空、9迁移记录/实例保护标记未变、连接0；
  3份签名原生源及Alpha.41 ZIP/DMG哈希不变。正常退出后确认无进程/句柄占用，已
  删除本次恢复的.app、合成Profile和控制目录，停止专用隧道，15432/8787端口关闭。
  原始FAILED回执保留其当时profileRemoved=false，后续清理单独记于
  artifacts/evidence/run-szmflgsf/cleanup.json；同目录保留数据库/签名树/归档前后身份、
  failure-timing-summary.json和head-deadline-controlled-reproduction.json。
  仅执行获准的1次外部联合样本；未重试、commit、push、部署、发布或改日常用户数据。
  服务端测试起点b172559；运行期间另有文档提交，API/Cargo测试输入未变。

- 2026-09-17 本地空间治理提交0b2f295之后的有界查询诊断：第三轮隔离现场已按
  既有记录清理，本仓库evidence/release及任务临时目录未找到该轮原始回执。
  仅有计划摘要不能重建失败阶段。源码核实head观察的8秒覆盖串行authorization
  和sync，而测试代理的timeouts统计35秒自身超时；0代理超时不能排除产品超时。
  不据此调整产品预算或认定根因。仅补团队packaged探针的小型脱敏持久回执及
  定向回归，绑定asar/模式、固定阶段、请求元数据和清理结果，供下一次授权联合
  样本使用；不触碰原生优化、运行包、用户profile、VPS或Git提交边界。
  回滚限新增receipt模块/测试及本轮runner、CONTRIBUTING段落；保留已有WIP。
  定向4文件51项通过（新增回执8项）；type-aware/type-check lint、syntax、结构
  3265文件及knip通过，仅既有electron ignore建议。回执写入/脱敏/独立保留/退出
  未确认不得PASS均为本地合成回归，不是新的packaged或VPS样本。
  流式只读核对保留Alpha.41 ZIP的app.asar仍为200612365字节、SHA256
  9f6640ab705b46e0adaa7019dc5ae118575da9ca2a730714fb65d990d80782ea，匹配已含
  阶段标签的新包；可复用该归档做后续验收，无需因工程探针变化重建产品。
  本轮未解包、启动应用、运行VPS联合或commit/push。历史偶发根因仍未确定。

- 2026-09-17 用户确认继续收口原生运行包/打包WIP的两项死代码门禁：核实
  package-native-unsigned.mjs和package-with-retention.mjs均通过仓库内CLI路径
  调用electron-builder，故保留实际依赖，仅增加精确knip例外并在CONTRIBUTING
  记录调用方/撤销条件；nativeArtifactInUse仅内部调用，移除多余export而保留全部
  占用检测逻辑。未运行真实产物清理、生成或签名，不动现有运行包/安装包。
  13项相关回归、定向lint和knip通过；随后check:source完整exit0：850文件通过/
  9文件跳过，5498项通过/23项跳过，测试阶段175.99秒；statements84.03%、
  branches78.39%、functions87.36%、lines87.68%，覆盖率门禁通过。类型、lint、
  架构（1080模块/4151 imports/0 cycles）、引用、结构、生产通信及工作流检查均通过。
  下方此前的knip阻塞现已解除；electron忽略项仅剩非阻塞配置建议，未扩大本轮改动。
  按环境条件跳过的原生/外部合同测试不算通过；不把源码门禁或旧包验收转为新包
  VPS联合、真实模型质量、最低macOS14、Windows或生产证据。没有commit/push/deploy。
  交付时发现预览.app已不存在：独立artifacts/disk-footprint-cleanup-2026-09-17.json
  记录同一New Money.app状态REMOVED，release/mac-arm64为空，无相关打包进程。
  本轮未调用该清理入口，不擅自恢复已清理目录；DMG/ZIP及candidate/smoke凭据仍保留。
  当前DMG364002303字节、ZIP373198558字节，逐文件SHA256与candidate identity一致。
  因此下方PID/打开预览为当时证据，不表示现在仍有运行中的仓库预览。
  回滚仅恢复内部函数export并撤销本轮精确knip例外及说明，不删除依赖或函数。

- 2026-09-17 原生联合验收后的查询失败可观察性收口：已确认Host事务及Session查询
  owner连续抹平失败阶段。仅增加固定receipt-open/index-preparation/embedding/
  native-query/receipt-close标签，不携带上游message/cause、地址、凭据或正文，
  不变更IPC schema、权限、时限、重试或成功路径。取消与cleanup保留最先失败阶段；
  标签不证明Main内部失败位置、超时原因或物理退出。ADR/协议维护说明同步更新。
  新回归先红（8项失败），修复后加真实70秒IPC超时/迟到响应回归，共4文件118项
  通过；Agent Host typecheck、定向type-aware lint、脚本syntax、结构3257文件和
  生产通信边界998文件通过。正式探针仅提取固定标签，不输出实际Tool正文。
  本轮未重复VPS数据库验收；上轮完整联合PASS仍绑定旧asar 0b0aece…d7e6f6。
  当时全仓knip报其他WIP的electron-builder devDependency及nativeArtifactInUse导出，
  该阶段未改这些文件；后续收口结果见上方记录。preview:mac:unsigned exit0，新包
  packaged smoke、团队Tool身份、记忆设置加密/小眼睛/冷恢复、默认私人记忆关闭、
  DMG/ZIP容器校验及仓库预览启动通过；正常preview PID13864（仅当时观察）。
  新asar为200612365字节，SHA256
  9f6640ab705b46e0adaa7019dc5ae118575da9ca2a730714fb65d990d80782ea。
  新包未重跑VPS原生联合验收，不继承旧asar的完整PASS；第三轮偶发失败根因仍未
  确诊，本轮修复的是已复现的阶段信息丢失，不是宣称消除该偶发故障。
  回滚仅撤销本轮阶段标签、保留逻辑和对应回归/文档，不动其他查询生命周期代码。

- 2026-09-17 继续正式产品原生检索验收：扩展既有packaged-team-session探针的显式
  --native模式，经产品设置安装已签名的独立索引/查询包并保存合成模型配置，再经
  实际项目索引入口、Pi模型工具循环、精确资产/版本/正文与JSONL核验完整正例。
  冷恢复后撤销共享资产，原会话处理必须在任何Agent/embedding调用前拒绝；随后
  保留项目撤权/退出/私人字节不变和物理清场断言。模型fixture仅脚本化提供商响应，
  不替换产品Main/Host/Pi、Tool、授权或OpenViking，也不制造Tool Result。
  沿用已授权专用VPS库、两种本地签名源和既有600秒在线总预算；本地生产代码/
  安装包不变，无真实模型付费、日常profile替换、发布或部署。前三轮失败，第四轮
  完整联合验收通过；不等于生产发布或稳定性问题已修复。
  首轮原生模式在index前拒绝：夹具误沿用私人HTTP模型地址，而团队settings/transport
  明确只接受HTTPS；未放宽产品校验。修正合成服务使用本次隔离TLS证书，并增加
  无TLS的native fixture必须拒绝的回归。首轮数据库1通过/1失败、486.81秒且reset
  执行完毕；5项fixture回归通过，随后使用全新隔离profile/控制目录复验。
  第二轮在项目绑定等待提前失败：Playwright默认5秒小于产品请求8秒上限，失败时
  请求仍在途（8请求/7响应/超时0）；数据库1通过/1失败、481.80秒并reset。
  仅该UI绑定完成等待设15秒并补阶段耗时，不改变产品请求限制或跳过绑定。第三轮
  再用全新profile/控制目录验收，前两轮均不计PASS。
  第三轮正式设置页原生项目索引构建成功，但Pi真实viking_team_search返回isError；
  没有read调用，不计完整原生PASS。Agent/embedding/extraction请求数3/15/0，
  HTTPS请求49/响应48/代理超时0，最大已响应耗时6022ms；团队阶段217114ms包含
  失败后等待成功提示的180秒，不能当作工具耗时。JSONL工具执行约29.2秒。
  数据库1通过/1失败、834.55秒；独立只读复核14表0行、9迁移、测试连接0、受限
  角色与保护标记未变。该轮隧道已关闭。
  对保留的第三轮隔离profile做离线源码组合诊断（不是正式授权证明）：安装查询树
  54346文件/641313703字节，SHA256 b26c7fcb0bd2b8763fda91581621d2ecda17607d79f2161b716b7cd579cbb802，
  30秒预算内全树验证4630ms；完整准入4587ms，真实原生查询9597ms、精确命中1项。
  索引指纹ab5d5eed288d4bc97fe52a6804ea9aed7cf3fd6f1b6832e620e8e34252e8075c，
  32文件/23目录/1166576字节。进一步使用明确合成授权回调隔离reader本地IO：
  打开44ms、运行包准入3712ms、原生查询4513ms、原始正文读取74ms且精确匹配。
  两次查询均使用真实签名树、临时工作副本和物理退出/副本清理边界，不启动模型。
  尚未证明第三轮失败具体阶段；8秒在线head检查包含两次串行HTTP，是待验证假设，
  未据此改产品时限。工程夹具补最多128项固定operation/状态/耗时元数据（无URL、
  ID、header或body）与每轮查询embedding增量；Pi实际失败后立即断言，避免空等成功。
  9项夹具回归和定向lint/syntax通过。
  第四轮PACKAGED_TEAM_SESSION_PASS，consumer/producer均exit0，PostgreSQL 2/2、
  739.93秒。正式产品设置安装两种签名包、原生索引、Pi搜索/读取精确资产与正文、
  来源JSONL、冷恢复、资产撤销后任何Agent/embedding调用前拒绝、项目撤权后的
  同步拒绝、退出撤销与冷启动未登录、私人历史字节不变、物理退出均通过。
  查询阶段新增embedding请求1次；该阶段29次API请求均200，authorization
  1222–2525ms、sync3251–4757ms。全程87请求/87响应/代理超时0，最大7417ms，
  授权55通过/1预期拒绝、会话撤销1。相同产品安装包复验通过只能排除恒定失败，
  不能把第三轮8秒head预算假设提升为已确诊或已修复；暂不再重复数据库验收。
  末次asar复核200611818字节、0b0aece020a5ce62c83d5272547757d5c90362da1fc13a4699c4092f59d7e6f6。
  独立只读清场再次确认14表0行、9迁移、测试连接0、保护标记及受限角色未变。
  本轮和第三轮隔离profile、临时TLS目录及离线诊断编译目录均已精确清除，15432/8787
  无监听；两种签名源及preparation保留，未动日常安装/生产/groland。
  结构门禁3251文件、生产通信边界998文件通过。全仓knip现场其他WIP持续变化，
  当时报告electron-builder未使用devDependency与nativeArtifactInUse未使用导出；
  该阶段未修改这些文件，未将此前完整源码门禁算成本轮通过。后续收口结果见上方记录。
  回滚仅删除新增模型fixture/测试及反向--native和维护说明，保留既有WIP与签名源。

- 2026-09-16 正式Desktop联合验收暴露sync命令准入遗漏：设置页设备登录/团队项目绑定
  及真实默认发布201通过，但同步前即被本地拒绝，9次HTTPS请求全部有响应且超时0。
  新增真实HostTaskStateCoordinator回归先红，复现
  `Command requires Workspace or Task authority: enterprise.knowledge.sync`。
  根因为Protocol app scope清单漏登记sync，而Host按该清单判定App权限；修正仅补
  `enterprise.knowledge.sync: app`，拒绝Workspace/Task上下文，不修改租约/模型/成员
  权限或超时。回归不再只从同一清单枚举，另显式覆盖sync入站。
  定向4文件/16项通过；补两个手动packaged探针的knip工程入口及同步即时失败分类。
  首轮数据库流程1通过/1失败、589.53秒，失败后测试入口执行reset；不计联合PASS。
  修复后的完整源码门禁exit0，覆盖率statements84.03%、branches78.39%、
  functions87.37%、lines87.67%。首轮门禁因两个探针缺少knip入口停止，补登记后
  重跑通过；未移除测试或降低边界。原定旧包诊断复测在等待API时有意终止，明确
  不计PASS；确认旧隔离进程退出后重新打包，在同一仍处于准备阶段的数据库producer
  上启动全新consumer，没有并发消费或修改交接文件。
  preview:mac:unsigned exit0：macOS arm64完整packaged smoke/容器校验和仓库
  新预览启动PASS。新asar为200611818字节，SHA256
  0b0aece020a5ce62c83d5272547757d5c90362da1fc13a4699c4092f59d7e6f6；HEAD仍
  ca043bac加WIP，不是clean exact-SHA发布候选。普通preview配置未被测试profile替代。
  新包联合验收PACKAGED_TEAM_SESSION_PASS、consumer/producer均exit0，数据库
  2/2通过、620.46秒。真实设置页设备登录/绑定/默认发布201后的同步、Pi团队会话
  JSONL精确来源、冷重启UI来源/账号恢复、精确版本撤销204/项目移除204后的同步拒绝、
  退出撤销204及再次冷启动未登录均通过，私人历史字节不变。26次代理请求/26响应/
  超时0、授权成功4/拒绝1、session撤销1；模型仅本机合成响应，不产生真实模型费用。
  独立回查14业务表全0、9迁移、受限角色和保护标记不变、测试连接0；两份旧隔离
  profile及失败控制目录已清理，成功profile由runner在物理退出后清理。
  成功控制目录的临时TLS证书/私钥亦已精确删除，测试SSH隧道停止，15432/8787无监听。
  此为packaged自动功能验收，不是Computer Use人工视觉或完整原生团队查询验收；
  下一步才将已验证的两个签名安装源接入正式团队索引/检索正例。Windows/最低macOS14/
  模型语义质量/生产部署仍未验证；无commit/push/upload/deploy。
  回滚仅反向新增scope登记、定向断言和本次文档/诊断/入口登记，不退其他既有WIP。

- 2026-09-16 中断恢复后的独立团队签名包验收PASS。现场HEAD仍为ca043bac加既有WIP，
  当前asar SHA256仍为db667eccff97f8675cdbcbea60e7ed69fd7799a29c92796a6bc9e15a0350ab01。
  preparation-UX4gPz（team-index-v1）与preparation-dF0pCh（team-query-v1）的
  receipt均为离线准备/迁移导入/nativeProbe PASS；使用现有密钥分别生成新副本
  signed-local-installation-qadQjd与signed-local-installation-Vzbzxd，验签均为
  SOURCE_PINNED_KEY_PASS。索引全树558f566f926765ef7b38166334ddd4be5285b067ca9c027d9f941e4a6c59c243，
  54348文件/641325757字节；查询全树b26c7fcb0bd2b8763fda91581621d2ecda17607d79f2161b716b7cd579cbb802，
  54346文件/641313703字节。原始解释器上游来源独立验证、Windows仍UNVERIFIED。
  新增probe-packaged-team-runtimes.mjs和CONTRIBUTING说明；真实packaged Renderer/
  IPC/Main执行两种安装，仅目录选择器返回值由工程fixture替换。独占profile中两个
  UI入口验签安装、冷重启存在、源/目标全树一致、无私人安装或启用、无staging/lock，
  物理退出/临时profile清理均PASS，runner exit0。语法/type-aware lint/结构3246文件/
  production transport998文件及文档diff检查通过；未重跑全源码门禁、未重建应用。
  Design Craft沿用既有功能合同，无UI设计变更；这是packaged自动测试，不是人工
  Computer Use或视觉评审，也不代表团队模型工具完整检索、最低macOS14或生产验收。
  上轮Desktop/VPS联合runner的最终回执在恢复时不可取得，因此保持UNVERIFIED；
  现场无测试连接但存在合成数据，按已授权范围核对专用库/受限角色/保护标记后清理。
  14业务表合计0、9迁移与标记不变；15432/8787无监听，用户原预览保留。
  两个准备目录与签名源保留在ignored artifacts/openviking-native；未公开任何私钥。
  回滚仅删除新增安装探针并反向本段/贡献说明，不撤回既有WIP或日常配置。
  下一验收仍是正式产品设备登录/团队会话联合链路，再接入这两种已验收安装源完成
  团队原生索引/查询正例；不以本checkpoint冒充联合PASS。无commit/push/upload/deploy。

- 2026-09-16 正式产品入口下一层：复用当前已核对asar的macOS安装包与独占合成profile，
  验证设置页设备登录/团队项目绑定/显式同步、Pi团队会话创建、冷重启恢复及撤权拒绝。
  测试可使用专用newmoney_test与固定本机模型响应，不注入产品凭据、不替换Main/Host。
  仅新增packaged测试驱动与维护说明；回滚删除新增驱动并反向本段说明，保留所有既有WIP。
  独立团队签名运行包尚未验证，不以私人包、测试公钥或mock原生查询代替；该正例另行验收。
  当前待执行，不代表PASS；不含正式签名、commit/push、生产部署或日常profile替换。
  用户随后明确授权用现有key仅生成团队索引/团队查询两种本地验收包并隔离验证。
  复用固定CPython3.12.10与离线锁定依赖，分别准备当前v1 bootstrap、测量全树后
  签署新副本；不覆盖私人包、不改变产品信任锚、不上传、不发布、不替换日常安装。
  包签名证明字节批准，不等于团队原生查询或完整产品联合验收；各层单独报告。

- 2026-09-16 继续完整网页协同验收，范围仅测试驱动与合同。现有native探针的显式
  --native --web模式不自行发布/撤销，而等待真实Web动作后经独立HTTP及原生索引/
  查询校验。新增共享总窗口有界、0700目录/0600精确新标记的phase rendezvous，标记不是
  权限或验收证据；服务端仍独立检查发布、撤销和项目撤权事实。Server只在显式
  NEWMONEY_TEST_LIVE_WEB=1时绑定空闲loopback8787，复用Web4173及真实账号登录，
  不改生产配置或API。仅Web模式使用600秒总窗口（普通模式300秒），不逐阶段
  续期；工程runner1500秒覆盖准备/等待/在线。产品超时/权限/固定合成向量不变。
  只复用已授权newmoney_test；无付费模型、系统TLS信任、用户profile或生产写入。
  回滚删除本次新增测试模式/辅助函数并反向文档patch，保留其余WIP和历史数据。
  第三轮真实Chrome Web→Electron工程Main/utility→原生OpenViking→VPS PostgreSQL
  协同验收PASS：实际cookie登录200、默认发布201、相同资产/版本/正文原生查询命中，
  Web以详情ETag精确撤销204、cursor2、旧索引embedding前拒绝、项目撤权但团队可用，
  OS加密凭据清理/物理进程退出，Web退出204且刷新401。WEB/NATIVE/ELECTRON三项
  标记齐全，consumer/producer均exit0；数据库流程2/2、940.10秒。前两轮协调超时
  不是PASS；仅延长显式Web工程总窗口，不删除断言或修改产品期限。
  全源码门禁在最终计时修正前PASS：845文件通过/9跳过，5464项通过/23跳过，
  247.77秒；最终修正后4项定向回归、type-aware lint、runner语法、Rust严格Clippy/fmt
  均PASS，不宣称完整门禁已在最终时间参数上重跑。独立回查14业务表全0/9迁移/
  受限角色及保护标记不变/测试连接0；浏览器managed页关闭1、验证1、剩余0、错误0。
  三轮临时副本/测试TLS与控制目录均清理，测试隧道/API/Vite停止，原运行包保留。
  截图与精确测试身份见Server docs/LOCAL_MEMORY_CONTRACT.md；此模式不是正式产品
  Main/Renderer/Pi会话或签名安装包验收，也不证明最低macOS14、Windows、模型语义质量
  或生产部署。下一步在正式Desktop产品入口验证同一共享知识生命周期，保持独立
  包/平台/部署授权和证据边界；本轮无commit/push/deploy或生产数据写入。

- 2026-09-16 已完成本地默认发布与 Web 治理接入：Server 的默认 publish 与
  publish-versioned 别名共用 PostgreSQL 事务和 receipt；Web 新增候选正文审核、
  精确 ETag 撤销确认、角色/团队切换隔离及错误恢复。没有新增迁移，不改 Desktop
  运行时代码，旧 hosted 读取兼容实现暂留。验收要求无 hosted OpenViking 时真实
  HTTP 发布/重放/拒绝授权通过，Web 确认与冲突流程有浏览器证据。
  回滚只反向本次路由/响应消费者/页面和合同变更，不删除已写版本、回执、事件，
  不回退整份 dirty 文件，不回退 PostgreSQL schema。发布回执不代表可检索状态。
  当前未 commit/push/deploy；专用 newmoney_test 验证沿用用户明确授权。
  Rust 单元测试32/32、严格Clippy、fmt，Web typecheck/14项测试/build，OpenAPI解析/
  146引用均PASS。真实Chrome合成API组件验证正文审核、精确撤销、冲突不重试、焦点、
  只读角色、团队切换/迟到响应隔离及明暗响应式；发现并修正取消时禁用按钮无法恢复
  焦点，真实重复验证通过。Design Craft L1-F沿用两份DESIGN，局部一致性PASS；
  dark390x1619/light1280x1317截图及digest见Server合同。managed页关闭1/验证1/
  剩余0/错误0，用户页保留。浏览器使用合成API，不是已登录Web到真实数据库验收。
  VPS PostgreSQL17.8完整流程2/2，450.93秒：默认发布/别名并发与单份回执，全文审核
  权限，既有撤销/同步/搜索均通过。先前404旧发布断言按版本化写入403合同调整，
  另保留详情404拒绝；未降低权限检查。独立回查14业务表全0、9迁移成功、受限角色/
  保护标记不变、测试连接0；测试SSH与Vite均已停止。无生产写入、Desktop代码/打包
  变更。本地文档同步不等于发布；剩余兼容消费端退出、完整账号联调及平台/部署验收
  仍单独待办，不能把此checkpoint称为全产品完成。

- 2026-09-16 已完成有界修正：发现 Main 已选 canonical 本地团队路由时，Session 工具工厂仍同时
  注册旧 hosted Experience/SOP 工具，模型仍可选择旧链路。新增两项回归先复现此问题；本轮
  仅修正工具集合选择、保持旧历史授权 reader、补真实 Pi 初始/替换会话和 packaged
  工具身份检查。不改 HTTP 默认发布、Windows 启用策略、用户配置或生产数据。
  验收：canonical 模式只有 viking_team_search/read；本地失败不暴露/调用旧工具；无
  canonical port 的兼容模式及旧历史复核不变。回滚只反向本轮工厂条件、断言和文档，
  保留已有 WIP、Pi JSONL 和本地运行包；不回退完整文件或删用户数据。
  定向 6 文件/78 项通过，打包工具集合校验另 12 项通过。首次完整源码门禁因主 smoke
  脚本 461 行超 460 上限停止；将会话工具断言归入已有 packaged-session-creation-smoke
  模块并保留全部断言后，check:source 退出 0：844 文件通过/9 跳过，5461 用例通过/
  23 跳过，241.93 秒；statements84.03%、branches78.38%、functions87.37%、lines87.67%。
  preview:mac:unsigned 随后退出 0：重建 alpha.41、完整 macOS arm64 packaged smoke、
  DMG/ZIP 容器校验及新仓库预览启动均通过。真实 Main/Host/Pi model context 仅有一份
  viking_team_search/read、旧四工具为零，private consent=false。HEAD 为
  ca043bac043697480ef6e2804ad6bf41a28fb79f 加既有及本轮 WIP，source.clean=false；
  app.asar 200611236 bytes，SHA256 db667eccff97f8675cdbcbea60e7ed69fd7799a29c92796a6bc9e15a0350ab01。
  包身份与 smoke receipt 在 ignored artifacts/release/macos-preview-candidate-identity.json
  和 macos-preview-packaged-smoke.json，不是已提交 exact-SHA 发布候选。未执行 Windows、
  最低 macOS14、真实付费模型或本轮在线知识查询；未 commit/push/upload/deploy。
  下一步仍是默认发布/网页治理与剩余兼容消费端协调；Server 已验证的 keyword 接口保留。

- 2026-09-16 用户继续授权上轮明确的正式密钥签名与隔离packaged验收，不含日常安装
  替换或发布。从保留的preparation-MzDdom运行树生成signed-local-installation-VnpfTu，
  SOURCE_PINNED_KEY_PASS；树仍为a984af4abf5e5185b000b25437cd708b7a73081a12363f1dc76d64df9d6d4f58，
  54346文件/641302721bytes，manifest SHA256
  5f8dc4d1c57154a42c5dcdfd65a1f69fc03bd8ebc31e19af5db9ab23d25b1d1b。
  私钥未复制/回显，原输入和日常安装不动。使用已有alpha.41 app而非重建Desktop，
  现场asar hash仍为60851a669b0ef9aac78879afc6de978a35e1e73c417c324700ca898127054d35。
  verify:memory-session:packaged退出0：真实Main/Host/Pi签名导入、加密设置、显式启用、
  冷启动私人捕获/同会话恢复、UI归档、原生提炼完成、新会话召回、停服及测试Profile
  清理均PASS。本机合成模型调用agent5/embedding81/extraction2/rejected0，偏好提炼1、
  摘要1、recalledPreference=true；三次发送22052/836/13465ms，不作为严格性能对照。
  结束后重新测签名输入树未变。回滚为继续使用保留的旧输入；新签名开发产物可精确
  清理。未更新用户安装、未上传/发布/commit/push；上游解释器provenance、Windows、
  最低macOS14及远端真实模型质量仍未认证。

- 2026-09-16 DataHub退役只读复核：本地DataHub HEAD
  a6ff8945dfd2ccb162ef0994d4d5e3be01bc94dd，加既有测试脚本WIP，未改该仓库。
  backend-rust/src/routes.rs仍挂载agent::router，src/main.rs仍声明agent模块；
  apps/web-vite/src/routes.tsx仍加载AgentPage并注册路由，运行/发布/检索与权限合同
  仍在源码中。018–020迁移保留。通过既有host-local SSH helper仅执行只读盘点：
  datahub-web/api运行中，postgres容器运行；相关数据库有groland/datahub_prefect/
  newmoney_test，无newmoney；包括停止状态的容器列表未匹配New Money/OpenViking名称，
  此结果不证明无其他名称容器或宿主进程。域名A查询返回NXDOMAIN。
  groland的10张public.agent_*表在READ ONLY事务、10秒statement timeout下精确COUNT
  全部为0：accounts/account_members/projects/workspace_bindings/device_authorizations/
  experience_candidates/candidate_sources/shared_assets/operations/audit_events。
  当前无已存Agent业务行需要搬迁，但未证明没有旧客户端请求或未来写入；提议后续
  按空数据退役核对最后调用方、冻结旧写入并复核零行后移除UI/router/runtime及独占
  合同/测试，保留历史迁移和表。此为基于新证据的清理建议，非已批准切流/源码删除；
  R5不标完成，DataHub/数据库/DNS/VPS本轮没有写入、停服或部署。

- 2026-09-16 源码门禁运行条件核对：HEAD仍为ca043bac043697480ef6e2804ad6bf41a28fb79f
  加既有WIP。上轮直接check未限定worker；当前宿主availableParallelism=12，已安装
  Vitest4.1.10非watch默认公式为核数减一（11）。既有check:source则向同一check
  固定传入VITEST_MAX_WORKERS=2，已有边界测试覆盖，未修改runner/用例/超时/阈值。
  本轮按该入口执行完整门禁，不能用上轮定向PASS替代；仅补充CONTRIBUTING及CI文档
  的命令差异与失败证据边界。生产代码、正式签名、用户安装及外部系统均不动。
  check:source退出0：所有静态门禁PASS（dead-code仅既有electron ignore提示），
  843测试文件通过/9跳过，5447用例通过/23跳过/0失败，Vitest耗时234.91秒。
  上轮两超时用例本次完整coverage运行分别2404/3829ms，仍用15000ms阈值。
  statements84.03%、branches78.38%、functions87.37%、lines87.67%，全局与分包
  覆盖率阈值通过，摘要在coverage/coverage-summary.json。当前固定并发源码门禁
  可标PASS；历史默认并发失败保留，资源争用仅为与观察一致的解释，未作同负载
  严格因果实验，不宣称产品Git性能已修复或任意并发均稳定。没有重跑原生/packaged，
  跳过的live/native用例不算本轮通过；正式签名与新版运行包packaged验收仍待单独推进。

- 2026-09-15 私人运行包构建接入：将已验证三处LiteLLM补丁移到eng/capabilities的
  唯一typed构建规则，原生实验复用；新增显式private-lazy-litellm-v1及offline参数，
  原team默认/团队query不变，不复制team worker或测试probe到私人包。
  所有预镜像和RECORD先验，再修改并更新RECORD，嵌入无路径/时间戳的补丁记录，
  其身份随整个运行树校验；正式签名/用户安装不动。回滚限构建规则、准备工具、
  定向测试及文档，新ignored开发输出可按精确路径清理，原签名输入保留。
  首次offline因aiohappyeyeballs缓存缺失停止（preparation-VCst6V，无可用产物）；
  固定锁联网准备166个wheel成功（preparation-sC8v0p），两处原生探针各13项PASS，
  但检查发现uv生成的入口嵌入staging绝对路径，不能作为可复现最终产物。
  修正为构建期相对Python launcher并同步RECORD，拒绝记录不匹配/重复归属/
  未识别wrapper，不删除依赖或放宽验签。新增不同目录两种shebang得到相同字节、
  RECORD损坏不写入、重复补丁记录拒绝及CLI参数边界回归；当前11项定向测试通过。
  两次修正后offline重建preparation-nvGzDv及preparation-MzDdom均PASS，
  各58个launcher完成相对路径/RECORD改写并在搬迁后实际执行normalizer；
  每次两份安装的原生探针各13项通过。同宿主、同Python输入与锁文件的两树均为
  54346文件/641302721bytes，SHA-256
  a984af4abf5e5185b000b25437cd708b7a73081a12363f1dc76d64df9d6d4f58。
  共享补丁规则的完整私人记忆回归PASS（99.63秒）：捕获/提炼/召回、三次生命周期、
  LiteLLM同步/异步请求/401/缺依赖、树不变和物理停止通过，正式信任锚拒绝测试身份。
  该回归使用原已签名输入的独占补丁副本，不冒充新构建包的产品准入或packaged证据。
  架构门禁发现Desktop test-support引用eng；将纯开发夹具移至eng，由测试直接引用，
  不改变生产依赖边界，也不放宽架构检查。搬迁后11项定向测试和Desktop类型检查PASS。
  聚合check的协议/全仓类型/Lint/架构/引用/结构/传输/工作流检查均PASS，dead-code
  仅既有electron ignore提示；coverage运行5445通过/23跳过/2失败（109.27秒），
  失败为worktree-git-runner及worktree-startup-reconcile-service各一项15000ms超时。
  单独复验两文件23项全通过（15.03秒），原失败用例3160/3764ms；未修改实现或阈值，
  未查明全量下超时的根因，不能宣称聚合门禁或coverage阈值已通过。
  构建结束后重新读盘测树再次核对两树及补丁记录相同；随后仅清理本轮失败staging、
  preparation-sC8v0p与preparation-nvGzDv内主/测试重复运行树，保留已有收据。
  preparation-MzDdom完整保留供后续验证，原始signed-local-installation-o58lbB不动。
  本轮有并行构建/功能回归，计时不作为新的性能对照；无commit/push/deploy。

- 2026-09-15 LiteLLM关闭importtime复验与请求/故障合同：只扩展测试，补丁仍是上轮
  固定三份源码，正式准备/签名/安装流程不变。新增private_litellm_probe.py，不进入
  运行树；三次启动和记忆断言结束后，用独立进程检查真实LiteLLM同步/异步聊天/
  embedding与本机合成HTTP服务互通、401不假成功，以及模拟缺依赖时显式选择失败。
  audit hook只允许精确本机夹具连接，拒绝其他DNS/连接且断言没有被拒尝试；
  missing模式禁网，不删除任何依赖。每进程30秒、请求计数有精确断言，不输出
  原始响应/异常日志。回滚限新增probe及native测试/文档，正式运行包、用户数据不动。
  关闭importtime的新副本实验完整PASS（87.86秒）：admission3797/3886/4261ms，
  native+provision10260/2562/2556ms，healthReady10074/2536/2532ms，provision186/26/24ms。
  三生命周期捕获/提炼/召回/停止/树不变及原有导出合同仍PASS；两个新进程分别
  验证同步/异步聊天2次、embedding2次、401拒绝4次、未知请求0，以及缺依赖的
  OpenAI可创建/显式LiteLLM失败4场景，deniedConnections均0。此处真实指实际
  Python后端/LiteLLM/HTTP交互，不是远端真实模型或商业provider验收。
  正式信任锚拒绝实验签名，临时副本已清理。新probe SHA-256
  cd0fb96c77f8b350da4b617a709f53053ca0c6024fb536ce7ba2c6230c6da457。
  同样关闭importtime的未改副本对照完整PASS（80.12秒）：admission3764/4209/4244ms，
  native+provision14259/3872/3879ms，healthReady14112/3846/3852ms，provision147/26/27ms。
  首次native阶段候选10260ms对原版14259ms（本组约28.0%缩短），后续约2.56秒
  对原版约3.88秒；整树验签另计，两组均完整通过记忆链路并清理副本，不是把
  额外兼容进程的总测试时长当作启动时长。宿主仍macOS15.7.9/Apple M4 Pro，
  HEAD ca043bac043697480ef6e2804ad6bf41a28fb79f加既有WIP，无源码提交。
  Python语法、2项防护测试、tests typecheck、定向type-aware lint、结构3240文件、
  dead-code及diff check通过，dead-code仅既有electron ignore提示。
  下一步可进入可复现运行包构建层；正式签名、替换安装及packaged验收尚未执行，
  不把测试临时签名用于产品。完整provider矩阵、远端服务、流式/视觉/限流/超时
  仍未覆盖；不将本轮原生证据当作packaged、统计显著性或p95认证。

- 2026-09-15 LiteLLM按需加载隔离候选：现场除VLM包入口外，embedder包入口也提前
  导入LiteLLM，embedding factory即使选OpenAI仍导入LiteLLMDenseEmbedder。
  测试限定三处修改，固定各原始源码SHA-256，保留VLMFactory和embedding factory
  显式provider分支、公开导出以及embedding缺依赖None约定；不混入OTel/字体修改。
  既有test-support和防护测试改名为lazy-import以复用两个实际候选，生产无新依赖。
  只在验签复制的独占安装副本执行，修改后重新测树/仅内存临时签名，断言正式
  信任锚拒绝；禁止与OTel实验组合、禁止预热。回滚限test-support、防护测试、
  native实验选择和文档；原始运行包、正式签名/准备工具、用户配置不变。
  验收：完整捕获/提炼/新会话召回/停止/树不变；全部计时后再检查完整bootstrap及
  OpenAI实例不导入LiteLLM、显式LiteLLM导出/工厂仍返回原类，未知导出报错。
  真实LiteLLM请求、缺依赖分支和其余provider组合不在本次结果覆盖内。
  原生实验完整PASS（81.20秒）：admission3899/3938/4022ms，native+provision
  10350/2752/2548ms，healthReady10140/2727/2524ms，provision210/25/24ms。
  捕获/提炼/新会话召回、物理停止、运行树不变及显式provider导出/实例兼容均通过。
  补丁树54345文件641306630bytes；正式信任锚拒绝测试签名，临时副本已清理。
  计时后兼容检查确认完整server bootstrap及OpenAI VLM/embedding实例创建没有
  将litellm载入sys.modules，显式LiteLLM VLM/embedding factory仍创建原实现类。
  原始三文件SHA-256复核未变；未改变OTel/字体、正式运行包或生产信任。
  同机未改副本对照完整PASS（79.90秒）：admission3718/3860/4109ms，native+provision
  14139/3853/3964ms，healthReady13998/3828/3939ms，provision141/25/25ms。
  对照与候选均开启importtime，首次native阶段本组样本缩短3789ms（约26.8%），
  后续从约3.9秒降到2.55–2.75秒；完整树admission另计，不能冒充整个Desktop耗时。
  宿主macOS15.7.9、Apple M4 Pro，HEAD ca043bac043697480ef6e2804ad6bf41a28fb79f加既有WIP，
  非clean exact-SHA候选。保留LiteLLM方向继续验证；未采纳到正式准备/安装流程，
  尚需关闭importtime的对照、异常/依赖/显式provider请求回归及独立packaged验收。
  当前是opt-in原生实验，不是正式Desktop性能证据、统计显著性或10样本p95认证。
  快速防护2项、tests typecheck、定向type-aware lint、结构3239文件、dead-code
  与diff check通过；dead-code仅既有electron ignore提示。无commit/push/deploy。

- 2026-09-15 OTel按需加载候选实验（未采纳为产品补丁）：新建两份test-only支持/
  防护测试，扩展既有native opt-in；固定两份OV原始源码SHA-256，先验证全部再改
  独占安装副本。只改metrics exporter包入口与global_api条件分支，保留公开Exporter
  类；字体/日志/模型provider均未改。重新测树、仅内存临时签名及test service公钥，
  真实admission不放宽；显式断言生产信任锚拒绝临时签名，输出REJECTED_TEST_KEY。
  正式源安装和构建/签名工具不改；临时metadata/key不落盘。回滚限新test-support/
  防护测试、native测试中的显式实验分支及文档，不涉及产品或用户运行包。
  首轮实验完整PASS（83.56秒），首次healthReady13861ms；但额外兼容检查位于第2/3
  生命周期之间，后续计时不用于严格对照。已将检查移到三生命周期全部完成之后，
  新副本复验完整PASS（83.38秒）：admission3861/4374/4440ms，native+provision
  14159/3979/3963ms，healthReady13629/3938/3936ms，provision530/41/27ms。
  首次native总阶段14.159秒与未改副本14.177秒接近，无足够收益支持采纳。
  这些是诊断对照，不是10样本release性能认证或统计显著性声明。
  测试树54345文件641306438bytes，运行结束树不变；三生命周期
  捕获/提炼/召回/停止及显式导出兼容检查全通过。
  兼容检查确认仅import global_api未载入metrics OTEL模块，
  公开OTel类与直接import同一对象，Prometheus保持、未知属性报错；不证明真实遥测上报。
  首次grpc._cython.cygrpc仍365643us，Pillow核心/字体仍1222947/914949us。
  静态现场补充：openviking_cli/utils/logger.py顶层仍导入gRPC与HTTP日志exporter，
  所以仅推迟metrics不会移除整条grpc依赖。首次额外约10秒未消失，不能据此
  把这个候选纳入正式运行包或声称已解决冷启动。Pillow的Mach-O只读codesign显示
  adhoc，但这不证明慢加载由Gatekeeper/安全扫描造成，未改变系统安全设置。
  同机未改副本对照完整PASS（79.03秒）：admission3974/4000/4431ms，
  native+provision14177/3964/3959ms，healthReady14045/3936/3933ms，provision132/28/26ms；
  grpc仍368429us。源码内置公钥验签路径保持通过，不使用临时实验签名。
  下一候选是固定VLM包入口对LiteLLM backend的提前导入：当前配置使用现有OpenAI
  backend，VLMFactory本身已有按provider导入分支；应先验证延迟包入口导入是否
  真正避开未使用的LiteLLM，同时保留显式选择和公开导出，不能更换模型/适配器。
  本次尚未修改该路径，也不将候选当作已完成优化。
  两项快速防护回归、tests typecheck、定向type-aware lint、结构3239文件、
  dead-code及diff check通过；dead-code仅既有electron ignore提示。原始两文件
  SHA-256复核未变，独占副本成功清理。无产品源码/用户配置/生产签名/VPS/DataHub
  变更，无commit/push/deploy，不重建或重启用户预览；旧packaged证据不转移到实验包。

- 2026-09-15 原生启动继续细分（接续下方冷启动定位）：只扩展既有opt-in原生测试，
  不改生产代码、签名运行树、启用时机或超时。真实fetch旁路记录首次health成功，
  导入分析另以`PI67_PRIVATE_SESSION_PROFILE_IMPORTS=1`给真实Python增加
  `-X importtime`；保留隔离/进程组/模型/退出合同。只接受有界模块名和微秒，
  每次启动保留self最高12项；不输出/保存原始stderr、配置、路径或凭据。
  首轮测试夹具因Node ESM namespace不可spy在3ms失败，未启动原生服务；改用
  仅转发真实Node exports的Vitest module surface，空临时目录已精确清理。
  新验签副本导入分析完整PASS（79.13秒）：admission3816/4368/4332ms，
  native+provision14430/3858/3859ms，healthReady14290/3832/3833ms，
  provision140/26/26ms。额外等待在health之前，不是账号/用户准备。
  首次self热点为PIL._imaging1197ms、PIL._imagingft898ms、grpc._cython.cygrpc499ms，
  另有protobuf/charset_normalizer/fastuuid/Crypto/brotli等约299–312ms；
  后两次top12由LiteLLM/Pydantic等主导，最大self约102–105ms。
  这是依赖导入的直接计时，尚不证明慢调用底层由Gatekeeper/签名扫描造成；
  也不将前12项或嵌套cumulative之和当成全部启动耗时。固定OV源码的server/app
  直接导入service/core；parser registry顶层导入图像/文档解析器，可评估按需加载，
  但尚未证明可以安全移除这些功能，不能直接删库或篡改签名树。
  关闭importtime的新验签副本对照也完整PASS（77.26秒）：admission3771/4263/4246ms，
  native+provision14029/3882/3872ms，healthReady13876/3855/3845ms，
  provision153/27/27ms；约10秒首次差异仍存在，不是importtime造成。
  捕获/提炼/召回/退出和运行树不变断言均保持，测试副本成功清理。
  下一步优先评估签名运行包构建层的按需加载/原生依赖首次加载成本；若改变
  运行包，必须独立重建、验签与完整原生/packaged回归，不能拿本次旧包证据替代。
  当前没有性能优化已完成声明，也未执行新签名、用户配置、VPS/DataHub或Git外部操作。
  tests typecheck、定向type-aware lint、结构3237文件及diff check通过；未修改
  生产代码，因此不重建/重启用户预览，也不将原生测试当作新packaged性能验收。

- 2026-09-15 冷启动性能定位：既有原生联合测试加真实函数旁路计时，不替换验签/
  启动实现，只输出固定阶段毫秒数和文件/字节数量。首次3生命周期样本admission
  3858/3983/4253ms，native+provision3917/3875/3879ms；54345文件641306289bytes。
  全部捕获/提炼/召回/退出断言仍PASS（49.20秒），两部分约8秒不足以解释packaged
  首次25秒。源码私人启动仅一处整树admission，未发现重复校验；继续通过既有
  PI67_TEST_CAPTURE_AGENT_INIT去敏通道定位产品会话阶段。只保留allowlisted阶段、
  completed及毫秒，至多100条，不记录原始stderr/路径/配置/正文。当前仍是诊断，
  不降低签名验证、不缓存信任、不调整产品超时或启动行为；回滚限测试计时及文档。
  同一旧asar完整packaged复验PASS：首次load-session-resources23915ms，恢复14458ms，
  再新建13105ms；load-model-runtime均1ms，activate-session约96–140ms，表明主要
  等待在资源加载而非模型选择/Renderer投影。发送25064/838/14484ms，提炼/召回仍PASS。
  Electron RUN_AS_NODE只读执行同一完整树算法6450ms，hash仍739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36。
  正式安装器新副本对照PASS（76.67秒）：admission3871/4228/4369ms，native+provision
  13311/3768/3768ms。同一副本首次额外约9.5秒发生在原生启动，不是重复验签；
  当前只证实新路径首次与重复启动差异，尚不能具体归因为Gatekeeper、导入或某个库。
  新副本最小解释器预检对照PASS（82.63秒）：`-I -B -c pass`为985ms，随后
  native+provision13791/3869/3877ms，admission4351/4270/4220ms，说明单独预跑
  Python没有消除首次约10秒差异，不据此向产品加入预热或安装后执行行为。
  下一步应细分新路径的OpenViking/原生依赖导入、子进程ready及初始化；尚未证明
  具体慢库或系统安全扫描，也未完成性能优化。原生对照均执行完整捕获/提炼/
  召回/退出且清理独占安装副本；packaged仍使用原asar，未改生产逻辑或用户配置。
  本轮tests typecheck、定向type-aware lint、结构3237文件、dead-code和diff check通过；
  dead-code仅既有electron ignore提示。无commit/push/deploy，无新签名或密钥操作。

- 2026-09-15 完整packaged长期记忆联合验收PASS：扩展既有显式opt-in入口，在两轮
  捕获/冷恢复后，从真实任务检查器的“立即归档”操作进入既有Host/Pi owner链路。
  本机合成提取模型提供偏好及摘要，真实OV完成归档/写入/索引；精确等待原会话
  archive_001/.done的4条long_term来源和偏好文件，再整应用重启、新建会话，
  核对实际Agent HTTP请求含旧偏好及URI，而新JSONL没有旧标记。沿用测试Profile
  commitKeepRecentCount=0，不更改产品默认值。只改eng探针/夹具及维护文档，
  回滚限这些增量；复用现场asar并记录hash，不重建或重启用户预览，不使用用户
  配置/付费服务/VPS/DataHub，不commit/push/deploy。
  首轮夹具失败：全局正文locator同时匹配无障碍播报，且过早设置保留0条使首次
  shutdown已触发自动提炼。修正为真实Transcript虚拟列表内正文断言，以及首次
  关闭仍保留默认10条、冷恢复前才调整隔离Profile；按钮前提取请求必须为0。
  不修改产品默认值/关闭行为，不将该失败描述为产品缺陷。最终命令exit0，
  asar SHA256 `60851a669b0ef9aac78879afc6de978a35e1e73c417c324700ca898127054d35`；
  三次发送到可见回复并空闲25100ms、833ms、14466ms。model calls agent5（含标题）、
  embedding81、extraction2、rejected0，具体为preferenceExtractions1、summaries1。
  实际Agent HTTP请求中的recalledPreference=true，精确URI/偏好和新Session ID/
  JSONL隔离/持久文件不变/禁用退出全部通过，成功夹具自动清理。
  新增2项夹具独立测试，拒绝把单独回复/标记当召回，也拒绝未知提取用途；
  定向type-aware lint、结构3237文件和diff check通过。未改产品源码、未重打包或
  重启用户预览，不以此宣称真实模型准确率、搜索排序质量或Windows/minimum OS认证。
  本机冷启动样本仍14–25秒，后续优先定位原生启动性能及分发/首次使用体验。

- 2026-09-15 受控模型下原生长期提炼/跨会话召回联合验收PASS：扩展现有显式opt-in原生联合回归，
  通过同一Pi owner EventBus显式Commit，保持默认捕获不触发提炼的断言；仅本机
  合成Chat Completions提供受控偏好和摘要，真实签名OV执行解析、归档、记忆写入及
  索引。随后停止原生服务、创建新Pi会话，要求模型实际上下文含召回偏好，而新
  JSONL不含旧原始消息；同时核对持久文件不变、默认拒绝/关闭与隔离范围。
  验收不能从archived/accepted单独得出完成结论。此轮是原生服务与Pi联合层，
  不是整packaged提炼端到端或真实模型语义质量。暂只修改既有测试/测试SDK夹具及
  文档，回滚限这些增量；不改生产数据/信任/模型配置，不调用付费服务或部署。
  第一次实际运行48.41秒PASS；加强后台完成和来源URI断言后最终48.11秒PASS。
  完成条件为同一OV Session的archive_001/.done记载4条long_term来源、起止消息
  不同，且实际preferences/desktop/communication_style.md已写入；不是仅队列受理。
  新Pi Session ID不同，模型上下文含偏好及精确来源URI，新JSONL不含旧标记，持久
  偏好文件原样；原生进程停止和运行包树不变通过，临时合成资料清理完成。
  测试明确将commitKeepRecentCount设为0以归档两轮，不改变产品默认10条保留。
  另40项Commit/owner/隐私生命周期回归、tests typecheck、定向type-aware lint、
  结构3236文件与diff check通过。仅测试/文档变化，未重复全仓门禁或重启预览。
  下一步为整packaged的显式归档→后台完成→新会话召回联合验收；真实模型的提炼
  准确率/语义质量、长期规模和Windows/macOS14最低版本仍未验证。

- 2026-09-15 完整packaged私人会话捕获/冷恢复联合正例PASS，取代下方旧包失败状态：
  两处修复后`check:source` exit0，statements84.04%、branches78.38%、lines87.68%；
  typecheck/lint/架构1080模块4150imports0cycles/结构3236文件/transport998文件通过。
  索引与事件投影定向10项通过；合成模型夹具另验证标题请求不改变用户轮次标识。
  `preview:mac:unsigned`重新构建、packaged smoke、DMG/ZIP核验并打开新预览成功；
  当前app.asar200608872bytes，SHA256
  `60851a669b0ef9aac78879afc6de978a35e1e73c417c324700ca898127054d35`，
  preview PID82804，Host启动857ms，普通创建265ms，退出98.9ms。真实密钥小眼睛
  reveal/hide/remount隐藏、冷配置读取、显式启用/关闭等既有packaged回归通过。
  随后`verify:memory-session:packaged` exit0：同一asar，真实签名安装/加密配置/
  显式启用/整应用冷启动/Main→Host→Pi→OV捕获/再次冷启动原会话恢复/禁用退出。
  两次发送到可见回复及空闲25065ms、822ms；Pi来源private、同一JSONL/header/OV
  scope/session，watermark2→4；OV原生messages.jsonl同文件旧两条原样、两轮各一份。
  模型调用agent3（含标题）、embedding66、extraction0、rejected0，均为本机合成HTTP/SSE。
  成功夹具已自动清理；无用户资料/付费模型/VPS/DataHub改动，未commit/push/deploy。
  HEAD ca043bac加现有WIP，不是clean exact-SHA发布候选。身份文件SHA256
  `d458f3fa8fd3edddfae61849bd13e11f97d563e44e0002eb347954697e13706f`，
  packaged smoke receipt SHA256
  `548bf3479d6541454602c7e016b6d4029802b196b139d3f79e50017c50af842e`。
  design-craft只指导等待/错误状态合同，未改布局token；真实Electron功能验收而非
  普通浏览器/独立视觉评分。首次冷启动25秒仍偏慢，30秒样本通过不代表性能SLA。
  下一阶段：长期提炼/语义召回及显式模型费用边界；Windows/macOS14最低版本仍未认证，
  R1–R6不整体打勾，不据本次私人会话正例清理DataHub或宣布商业化全部完成。

- 2026-09-15 packaged续验发现并复现另一缺陷：ACK修复后重新构建的app.asar
  `82c323a7f86a9c56162abd606505b25ee677cd51b3e529fabc35c9f5519b07bb`
  实际保存了首轮Pi用户/助手消息及OpenViking原生messages.jsonl两条，但界面未显示正文。
  Pi SDK0.84.3普通消息直接appendMessage，而Extension appendEntry才发entry_appended；
  checkpoint可能先进入投影，掩盖尚未索引的parent，原逻辑把分支截断为空消息。
  真实SessionManager回归在旧实现得到空数组，修复后恢复两条消息、metadata及usage；
  仅missing parent/unknown leaf重建权威entries并递增revision，连续追加不全量重扫。
  新增冷重启验收还直接核对隔离OpenViking原生文件，要求同文件、旧两条原样、新两条
  恰好追加。合成模型回复按测试prompt标识，不再把共享模型的自动标题请求当作轮数。
  此段为失败及修复记录，不代表完整packaged链路已通过；回滚仅本轮索引修复、回归、
  eng探针与合同文档，不删除JSONL/OV数据，不更改密钥、来源或权限合同。

- 2026-09-15 正式packaged私人记忆会话验收推进中：新增独立显式opt-in入口，复用
  现有alpha.41 app.asar（a74eae854675fa4aef8df05bd508cc5d95aea95f850721457e1bdc12d0a83851），
  不重建或重启用户预览。独占userData/Pi Profile经真实设置UI验签安装、保存模型
  和启用，随后整测试应用退出再启动，真实Main/Host/Pi运行两轮并冷恢复JSONL。
  模型走本机合成OpenAI HTTP/SSE，不用注入Provider实现替代实际调用；提取模型
  只解析配置，本阶段不宣称长期提炼已验收。验收要求捕获watermark、来源、同一
  Session/OV scope、关闭和原生退出。失败保留独占测试现场，成功清理；回滚仅
  本轮eng测试及文档增量，不改业务逻辑/生产密钥/用户数据/既有运行包，不部署。
  首两轮在first-product-session失败：Main状态running、agent请求0、embedding40、
  extraction0；Pi已建来源及OV anchor，但Prompt仍保留草稿。首轮Main journal从
  createdAt1789443610278到published1789443633708耗时23.43秒，超过Renderer专用
  ACK的5+10秒窗口。并非签名拒绝或模型网络失败；不据已创建JSONL宣称Prompt成功。
  现修正为5秒后原有confirming状态+同key25秒确认，保持30秒创建验收目标、
  明确unknown终态、原有marker恢复和Host隔离；不扩大通用timeout、不放宽签名。
  新增23秒返回成功与30秒仍未知的定向回归；packaged发送另严格验收30秒，不能
  只增加测试等待冒充修复。回滚追加范围仅该Renderer专用ACK窗口及对应合同测试。
  design-craft L1-F/main serial、normal、pure plumbing，沿用PRODUCT及DESIGN；
  无视觉/token/控件变更，最终以本仓库真实packaged Electron链路验收。

- 2026-09-15 私人会话与签名原生服务联合验收通过：现存signed-local-installation-o58lbB清单
  与源码内置公钥匹配。新增显式opt-in测试，把真实activation文件/控制器、Main
  broker/service、完整树验签及真实Pi ResourceLoader/JSONL/捕获生命周期串联。
  仅合成Agent输出及本地embedding，不读用户配置、签名私钥或付费Provider。
  验收要求默认拒绝、显式启用后新生命周期生效、捕获、冷服务重启后原会话接续
  无重复、关闭拒绝及临时进程配置清理。回滚只移除本轮测试和证据文档增量；
  不改变产品信任/数据格式，不删除既有运行包或WIP。此层不是完整产品Main/
  Renderer、长期记忆模型提炼、真实模型语义质量或Windows认证。
  最终`PI67_PRIVATE_SESSION_TEST_INSTALLATION=<该安装目录> ... vitest run
  apps/desktop/src/private-memory-session.native.test.ts`：1项PASS，30.51秒；真实
  默认关闭/保存后仍拒绝、新controller从文件读取启用、原生启动、两轮中文/英文
  捕获、原生进程停止后新controller/Pi Session重开、相同Profile/Pi/OV会话身份、
  轮换连接凭据、每段内容恰好一份、watermark只增加2、关闭拒绝及.run清理通过。
  此处“重启”是同一测试宿主重建控制器/Pi且真实重启原生进程，不是整应用冷启动。
  本轮只新增两份测试/夹具与CONTRIBUTING、plan增量；无产品源码/UI/协议改变。
  首轮类型检查修正union属性断言；全仓门禁先后发现新增测试finally显式throw与
  共用SDK夹具固定localhost地址，改为清理结果断言和测试宿主传入模型端点。
  不扩大门禁豁免，不改变生产信任；最终输入原生复验通过。`check:source` exit0：
  840文件/5436项通过，9文件/23项条件跳过（包含本项opt-in原生测试，另有上面的
  实际运行证据），252.10秒；coverage lines87.67%、branches78.38%，结构3233文件、
  架构1080模块/4150imports/0cycles、生产transport998文件通过，只有既有knip
  electron ignore提示。diff check通过。HEAD仍ca043bac+既有WIP；未commit/push。
  无可见改动，因此未重新打包或重启用户预览；既有预览PID52184仍运行。
  下一步是正式Main/Host/产品会话同次联合正例与长期提炼/召回链路，不能将
  本轮原生会话捕获证明升级为完整产品、语义质量、平台认证或DataHub清理许可。

- 2026-09-15 私人记忆显式启用设置完成（完整产品迁移仍未完成）：Main独立保存非秘密activation.json，
  默认关闭、损坏未知时拒绝连接；启用只保存意愿，整应用下次启动选中后按需启动。
  关闭先撤销当前连接准入，再等待原生停止和偏好保存；保存失败不声称下次关闭，
  停止失败不声称停止完成。已缓存broker也必须经过同一controller，等待中连接
  在返回前重验。Host崩溃重启不改变本次app选择，不能绕过显式重启生效边界。
  macOS arm64正式Main固定选择managed连接路由，是否启用由controller独立判断，
  避免关闭偏好时回退旧外部OpenViking。其他平台维持未认证边界。与团队查询隔离，
  不自动同步、不选择Provider、不改变运行包信任，不调用真实付费模型。
  Renderer复用Settings行/次级按钮/notice，显示保存意愿与实时生命周期，单请求
  轮询且隐藏页暂停；安装、模型修改、启用操作共享navigation pending护栏。
  验收：协议闭合/IPC来源/偏好持久化/禁用竞态与失败回归；浏览器实际组件、
  packaged真实Main/Preload/UI冷重启与缺少运行包拒绝。回滚限本轮新增activation
  store/controller/bridge/UI、Main接线及合同测试；回到managed默认关闭但保留
  activation.json及私人数据，不删除或修改既有WIP、VPS、DataHub或生产凭据。
  不commit/push/deploy；最后本地preview验证，R1–R6未整体完成。
  最终53项定向测试、全仓typecheck和`check:source` exit0；coverage lines 87.75%、
  branches 78.39%。新增IPC测试首轮参数表展开错误与TypeBox动态数组静态类型never
  均修正后复验，未削弱拒绝断言。新增接线使system-bridge超460行，按记忆设置
  生命周期抽出三路注册/清理聚合模块，现453行；结构3231文件、dead-code通过，
  后者只有既有electron ignore提示。无新增依赖、无生产数据结构变化。
  design-craft L1-F/main serial，沿用PRODUCT/DESIGN及深色权威；browser67在独立
  managed tab挂载实际LocalMemoryModelSettings与合成Main bridge，验证缺运行包/
  模型提示、dirty禁止启用、保存启用不启动、pending互斥、保存失败unknown及
  unmount迟到结果隔离。早期长脚本返回EXECUTION_ERROR（未据此认定产品缺陷），
  一次Vite被协议dist重建刷新的夹具样本无效；拆分并重建夹具后按DOM状态完成。
  pending父状态需等待React提交，未将
  中间渲染采样冒充失败或最终验收。真实Keyboard Shift+Tab有2px焦点环，Enter
  可启用；按钮与同页安装按钮均34px/8px，遵循现有Desktop紧凑控件。浅色及
  深色390px窄窗截图已人工查看，行/按钮/提示可读，未发现阻断性视觉问题。
  轻量一致性sign-off PASS，范围仅该设置组件，不冒充整应用浏览器验收。
  截图在`~/.browser67/runtime/runs/newmoney-private-activation/`：
  `20260915T022250516Z-108462a3/artifacts/screenshot-selector-Private_activation_light-20260915T022250518Z-61a03041.png`
  （1824×476，sha256 ed4b292298053d916575a947c4158ac3ca7568d69bae0e37410b19cbe74b46cc）；
  `20260915T022344347Z-33b3b9fa/artifacts/screenshot-selector-Private_activation_dark_narrow-20260915T022344354Z-d2c3d2c5.png`
  （342×428 selector，viewport390×844，sha256 dadc49e52c03770c899adfc42fa7c2a4346008221060dae68060b108350f9d7d）。
  scoped finalize closed1/verified1/remaining0/errors0；仅结束本轮Vite5188，未关闭用户页。
  `preview:mac:unsigned` exit0：真实Main/Host的managed route=true且private consent=false，
  canonical工具实际Pi上下文各一次；默认关闭、运行包/模型缺失拒绝、真实UI保存
  启用但仍idle、冷进程selectedAtLaunch=true、关闭stopped及再次冷启动disabled/idle
  均PASS。密钥眼睛/加密保存、三用途安装取消/未签名拒绝、冷/热恢复与退出继续PASS。
  普通启用smoke的运行包占位目录不可验签，不称原生启动正例。独立原生测试另将
  同一activation controller接到真实service前，实际双Profile隔离/重启/旧凭据拒绝
  PASS（51.84s）；这里只合成偏好加载与本地模型，真实偏好持久化由packaged覆盖。
  追加原生测试后Desktop类型/该文件oxlint/diff check通过；无产品源码追加变更。
  新预览PID52184，alpha.41，HEAD ca043bac+WIP、clean=false（非可分发exact-SHA
  候选）。app.asar 200601552 bytes，sha256
  a74eae854675fa4aef8df05bd508cc5d95aea95f850721457e1bdc12d0a83851；smoke receipt
  sha256 0de7737c279541c394680a8d5318b8838a6442d24fed621a6298f7c9f2cf2fb0，身份及
  DMG/ZIP校验记录见`artifacts/release/macos-preview-{candidate-identity,packaged-smoke}.json`。
  未开启用户真实模型或修改其偏好；没有VPS/DataHub、生产签名、commit/push动作。
  剩余：完整签名运行包+产品会话私人捕获的同次正例、真实团队在线联合验收及
  Windows/最低系统版本证据；不得据本轮启用设置验收宣称R1–R6完成或清理DataHub。

- 2026-09-15 私人启用前置生命周期修正完成（非设置入口完成）：现场确认managed模式对当前
  Host启动不可变，不能用一个UI开关假装完成热切换；本轮先补齐Main服务的真实
  状态观察与连接交付边界。已解析的启动Promise不能代表进程仍存活，退出/关闭
  后不得交付其旧连接；停止失败不能显示已停止。状态只由现有supervisor推导，
  不探测磁盘、不启动服务、不含凭据或原生日志。验收覆盖冷态、启动、运行、
  崩溃、预算耗尽、关闭未完成和失败，以及已连接服务的重连竞态。
  回滚仅这次supervisor/service及其测试、合同增量，不回退既有WIP，不修改数据。
  启用持久化、重启生效提示和设置界面接线仍是后续工作；不改变默认managed
  开关，不声称设置UI或生产签名运行包正例已完成。无生产、付费模型或Git外部动作。
  追加检查发现native父进程退出还会异步清理子进程/临时配置；shutdown现在即便
  收到exit也等待同一handle的幂等stop，并保存迟到handle同步抛错的清理Promise，
  防止把失败吞成停止成功。最终34项定向回归、Desktop typecheck、定向oxlint及
  diff check PASS。首次尝试eslint发现本仓库未安装该命令，已改用正式oxlint入口，
  不作为代码失败或验证通过。
  `check:source` exit0，lines 87.73%、branches 78.37%；架构1073 modules/
  4115 imports/0 cycles，结构3221文件和transport991文件通过。退出清理追加改动
  发生在该轮coverage运行期间，因此另行验证最终输入的34项定向测试、类型和lint，
  不将此前门禁阶段冒充追加改动后的独立重跑。
  现存`signed-local-installation-o58lbB/runtime`作为显式测试输入，真实原生service
  集成测试1项PASS（57.60s，macOS arm64）：两Profile隔离、向量查询、独立重启
  持久化、旧凭据拒绝、临时配置清理和运行包树不变。测试签名仅内存，本地模型
  合成；未读取真实用户配置、调用付费模型或更改生产信任。测试finally清理其
  独占Profile，未删除既有运行包。未重新打包/重启用户预览，因为本轮无可见UI
  改动；此证据不是产品Main/Renderer激活、正式签名分发或Windows验收。
  下一步：Main持有独立显式启用意愿及重启生效边界，Renderer只展示脱敏状态与
  明确操作，不因安装/保存模型自动启用，不静默重启活跃会话；再做设置页与
  packaged联合验收。设计Skill本轮仅用于确定反馈/状态合同，未宣称浏览器或视觉验收。

- 2026-09-15 正式团队工具启动接线完成：现场发现Host将canonical工具绑定到
  私人managed服务开关，但实际团队查询仅使用独立settings/receipt/query通道。
  本轮解除该无实际依赖的耦合，由Main在支持平台且本地profile建立成功时选择
  团队工具路由，覆盖继承环境；Host严格解析独立开关。工具可发现不等于授权、
  索引就绪或模型调用许可，调用仍执行既有身份/模型/版本/签名复验。私人managed
  仍不默认开启，保留现有共享工具，不触发自动同步/索引/模型。验收要求Host
  模式矩阵、环境拒绝、SDK回归及packaged实际模型上下文工具身份；未过不宣称
  完成。HEAD ca043bac与既有WIP保留；回滚仅本轮启动/合同/测试增量，恢复团队
  默认关闭，无数据迁移、信任密钥变更、部署、清理或commit/push。
  启动接线43项定向回归和首轮全量/packaged通过。随后补齐禁用/完全关闭记忆
  在团队embedding/search/read的共同入口、凭据与IO之前拒绝；只读模式仍允许
  已授权查询。首轮新增断言发现既有catch把明确禁用原因抹成generic unavailable，
  改为仅保留本地固定错误类型，其他异常仍脱敏。最终80项查询/权限/取消回归通过。
  最终源码`check:source` exit0：836文件/5400项通过，8文件/22项依既有合同
  跳过；247.95s，lines 87.72%、branches 78.36%。类型、lint、协议、dead-code、
  架构（1073 modules/4115 imports/0 cycles）、结构和transport门禁均通过。
  preview也按最终代码重跑；首轮包不冒充包含此追加修复。
  最终代码preview exit0：正式Main/Host选择canonical=true、private=false，两个
  canonical名称在实际Pi模型上下文各出现一次；仅测试Provider stream合成且无
  外部模型调用。三用途安装、设置加密/眼睛、冷重启和有界退出smoke仍PASS。
  新预览已打开；alpha.41、HEAD ca043bac+WIP（identity clean=false，非可分发
  exact-SHA候选）。app.asar 200577596 bytes，sha256
  195fdb46a0b4b1b9cfdcafda26ca2b4e32332ddce69e57e4a1d1b5b5e0fe4df5；smoke receipt
  sha256 ffc1907a502740854364a3db064054b18342f4a9646c072572f69f9a36b979b7，均记录于
  `artifacts/release/macos-preview-{candidate-identity,packaged-smoke}.json`。
  本轮没有Renderer视觉改动，没有另开浏览器或调用设计Skill。真实团队在线/签名
  运行树正例、Windows和私人服务显式激活仍未被本轮证明，不授权切流或DataHub退役。

- 2026-09-15 设置页三用途安装接线完成：私人、团队索引、团队检索三种已签名运行包
  的独立安装入口。复用既有安装器及固定目录；窄 IPC 仅接受用途枚举，兼容
  无参数私人调用，三用途共用忙碌/取消所有权。检测存在不代表验签或功能启用。
  验收覆盖用途隔离、非法参数、跨用途并发/取消、Renderer 状态及打包 smoke。
  不改变默认 managed/canonical 开关、信任锚、用户数据、生产或 DataHub。
  HEAD ca043bac 加原有 WIP；回滚仅本轮协议/接线/UI/回归增量，保留其他 WIP。
  27项定向回归通过；`check:source` exit0，835文件/5391项通过、8文件/22项
  原生或在线测试按原合同跳过；242.46s，lines 87.72%、branches 78.34%。
  `preview:mac:unsigned` exit0，真实 Main/Preload/Renderer 在隔离Profile中完成
  三用途 status、跨用途禁用、取消等待、未签名包拒绝及空staging验收；仅picker
  选取由测试代替，没有使用签名私钥、付费模型或真正安装完整运行树。本轮未
  运行可选签名包正例，不能据此宣称正式团队包交付；安装器合成签名回归在全量内。
  browser67专用组件夹具覆盖独立用途、installed/failed/cancelled、重试和卸载后
  取消/迟到结果隔离；夹具使用合成bridge，非完整应用启动。初次无preload的
  Vite整页启动不可用，随后挂载实际组件；浏览器结果不替代上述packaged证据。
  design-craft L1-F/web，沿用 DESIGN.md/DESIGN.dark.md 与 SettingsRow/secondary
  action/SettingsNotice；对照相邻模型设置保存/反馈语义，无新token或布局体系。
  浅深色、disabled、反馈及键盘focus-visible已实看，760px检查无横向溢出；
  本轮组件一致性pass，不宣称全产品视觉验收。packaged截图为
  `artifacts/memory-ui/runtime-vbkI95/{light,dark}.png`；light sha256
  4c24f9eabcd9916aafccfdaf14265c3d2579e954454c3647dd137d5c3dade045，dark sha256
  2d6ec0480d06446ec3f9cc2288aa9a69d54adc29272191d18c27f883e0222661。
  专用浏览器tab已finalize（closed1/verified1/remaining0/errors0），任务Vite已退出。
  本机alpha.41预览已重新打包/smoke/打开；identity记录HEAD ca043bac及clean=false，
  属当前WIP本地验证，不是exact-SHA可分发候选。app.asar 200576772 bytes，sha256
  eb155d8ea7fe4de887a2b91b93241959e5c6080ec257ff1d6cd946feb8c1cbc7；identity和
  smoke receipt位于 `artifacts/release/macos-preview-{candidate-identity,packaged-smoke}.json`。
  未commit/push/上传/部署；Windows和默认启动激活仍待验收。下一步是正式产品
  启动/可用性门槛与团队知识工具接线，不能把本轮安装入口当作R1–R6整体完成。

- 2026-09-15 Pi工具循环与原生知识检索联合验收PASS：已有native流程直接调用
  Tool.execute，不能证明Pi发出工具调用、执行、结果回传和JSONL持久化闭环。
  本轮在既有成功分支追加真实AgentSession/SDK循环，复用Desktop资源/安全扩展、
  canonical工具及shared-history guard；仅模型stream为确定性测试返回，权限HTTP
  沿用合成夹具，索引/查询仍使用真实已验证原生运行包。保留原手动工具/撤权
  回归，不覆盖其证据。先独立SDK定向测试，再原生组合验证。范围限测试helper/
  现有native用例/文档；不改生产loop、默认开关、签名信任或用户profile，不调用
  付费Provider，不跑VPS/部署。失败回滚仅本轮测试增量，原运行包和WIP保留。
  现场HEAD ca043bac加既有WIP。新增独立SDK用例并在native成功分支追加同一
  AgentSession循环：3次合成模型响应、两次真实SDK工具执行、精确原生正文到达
  第三次请求、自动写入3条assistant和2条配对toolResult。重开JSONL后同版本
  history授权通过，私人捕获资格拒绝；撤销Agent政策后新请求在模型stream前
  以明确政策拒绝结束，Main请求/embedding计数不增加。保留原手动工具及取消/
  拒绝/版本分支。首次native 4/4通过（159.711s）；加强JSONL配对与错误原因
  断言后35项SDK回归通过，最终源文件native成功分支1/1通过（144.471s），
  另外3项仅按范围跳过，不另计通过。测试没有增加生产期限或改变SDK循环。
  原始树54345 files/641306289 bytes、sha256 739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36；
  临时安装树54349 files/641333171 bytes、sha256 5ebdecda981d649b2e0887d22828ae63f7ae1af999f6076cec24f03021cccf0d。
  原树/两安装树/manifest/signature前后完整，查询进程退出和临时副本清理通过。
  Pi-runtime/Desktop typecheck、定向type-aware lint、结构、knip、架构和生产
  transport门禁通过（1073 modules/4114 imports/0 cycles）；knip仅既有electron
  忽略项提示。仅测试/文档改动，未重跑全量生产覆盖率或重启用户Desktop。
  尚不证明正式Host/Main/Renderer完整启动、VPS与Pi循环同次联合、实际Provider
  语义效果、产品默认启用、正式签名或Windows；R1–R6仍未整体完成，不授权切流。

- 2026-09-15 正式Host在线设备登录/团队会话验收PASS：复用离线Host驱动和
  受保护VPS newmoney_test窗口，添加显式live模式；Main侧复用真实安全存储及
  credential supervisor，正式Host执行设备授权/交换/团队会话创建/退出登录。
  仅测试夹具可在独占0600交接文件中传入合成账户授权令牌用于真实设备批准，
  不进入Host、环境或日志；窗口结束移除并reset。成功要求两端exit0、私人记录
  保持隔离、团队来源持久化、Host重启恢复和退出后新建拒绝。仍是隔离Main驱动，
  不启动产品Renderer、不开放canonical/managed默认开关，不运行模型/索引或
  部署生产。回滚限本轮探针及测试夹具/文档，不动生产协议、数据库结构、真实
  profile或其他WIP；失败先确认进程/监听退出，再精确清理测试产物。
  现场HEAD ca043bac加原有WIP；Desktop最终输出HOST_SESSION_LIVE_PASS、exit0，
  Server完整postgres_flow 2/2通过、552.61s、exit0。正式Host设备begin/批准/
  exchange经真实TLS/API/VPS PG完成，Main实际safeStorage与credential supervisor
  写入0600加密文件；新store读回并bootstrap第二Host，恢复同一团队会话。
  同一运行验证私人JSONL字节不变、唯一团队来源标记、项目移除后创建拒绝且
  原团队文件不变/无创建凭据/来源仍可读、Host logout触发服务端204和本机凭据
  清除、第三Host启动后未登录创建拒绝。三次Host均正常物理退出，未调用模型。
  原离线Host探针仍PASS；定向类型/lint、knip、结构、架构、production transport
  与两仓whitespace检查通过；Server fmt、编译及all-target Clippy通过。没有
  生产实现/数据库结构修改，不重跑输入未变的生产覆盖率或重启用户预览。
  收尾只读users/teams/sessions/device_authorizations/versions均0，9项迁移成功，
  受保护instance marker未变；交接文件已由Server移除，consumer目录自动清理，
  独占TLS/control目录精确移除、任务SSH隧道退出。无真实profile/系统信任变更。
  此证据覆盖正式Host入口和Main凭据组件，但仍不是产品Main/Renderer完整启动、
  canonical工具激活/原生索引/Pi工具调用联合、实际Provider、签名包或Windows。
  不据此切流/部署/删除DataHub；R1–R6仍未整体完成。

- 2026-09-15 正式Host入口会话验收PASS：新增eng/capabilities隔离Main驱动，
  构建并fork真实apps/agent-host入口，不注入FakeRuntime或替代Host；经真实
  MessagePort握手、命令与Pi SDK验证匿名JSONL落盘、整Host退出/重启恢复、
  未登录冷/热团队会话创建拒绝且不改变私人会话或创建凭据。测试只使用独占
  userData/agent/storage/workspace；不传用户凭据、不启用能力包或managed/canonical
  默认开关、不发送prompt/调用模型、不操作数据库。NODE_ENV=test仅关闭已存在
  的后台模型目录刷新。正式Desktop Main/Renderer、登录正例、团队工具/原生
  运行包和签名安装仍另行验收，不由这一步替代。回滚限新增探针/knip入口/
  维护文档；退出未确认时保留测试目录，不清理真实profile或现有WIP。
  现场HEAD ca043bac加既有WIP，未改生产入口。首轮测试驱动漏传私有工具链，
  正式Host正确返回TOOLCHAIN_MISSING；补用现有Desktop工具链解析器，runner
  前置只读核对锁/manifest/实际版本，不引入系统回退。后续失败定位到重开后
  JSONL字节断言：当前Pi SDK对无消息会话追加thinking_level_change。按实际SDK
  合同修正为完整前缀不变且仅追加一条相同级别、正确parentId的元数据；未登录
  团队拒绝后的字节不变断言仍保留，没有放宽生产权限或协议。最终正式Host+
  Pi SDK探针返回HOST_SESSION_ENTRY_PASS、exit0，两次Host均物理正常退出。
  定向type-aware/type-check lint、dead-code、结构、架构及生产transport门禁通过；
  dead-code仅提示已有electron忽略项可移除，未扩大修改范围。本轮仅测试驱动/
  knip入口/维护文档，不重跑输入未变的生产覆盖率，不重启用户Desktop预览。
  最终源文件重跑再次PASS、exit0；已确认无本任务Host/Electron残留，成功目录
  自动清理，五个已核实的失败合成目录精确清理。仅删除可重建测试产物，未动
  用户profile、共享工具链或其他任务产物；Git whitespace检查通过，无commit/push。
  后续是正式产品Main与Host的登录正例/团队会话联合验收，不因本次离线通过
  启用默认managed/canonical开关、部署生产或退役DataHub；R1–R6仍未整体完成。

- 2026-09-15 继续定位在线query：现场HEAD ca043bac、main ahead2及既有WIP未变。
  复用受保护newmoney_test，新的独占TLS目录和Electron运行树，显式启用上轮
  数字步骤/耗时诊断；无产品期限或权限放宽、无部署/默认切换。保留运行树的
  只读查询包指纹校验54349文件/641333171字节、4261ms，非签名/平台性能验收。
  本轮联合验收PASS：Electron返回SHARED_KNOWLEDGE_NATIVE_PASS及
  SHARED_KNOWLEDGE_ELECTRON_PASS、exit0；Server完整postgres_flow 2/2通过、
  647.60s、exit0。同一隔离运行内通过真实HTTPS/当前授权、OS加密会话重开、
  Main/utility IPC、原生索引发布/向量查询、精确资产/版本/正文、撤销后旧索引
  在embedding前拒绝、项目成员移除但团队仍可访问、物理退出及运行树不变。
  Server另行读回发布/撤销/成员删除事实。仅模型向量为合成返回；不是完整产品
  main/Pi Session、实际Provider语义质量、正式签名包、Windows、macOS14最低
  系统或生产性能证明。前轮查询失败未复现，但原因仍未证明；本轮未修改查询
  实现或期限，不把一次通过称为该故障根因修复。保留此前失败记录与数字诊断。
  只读DB收尾users/teams/versions/events/receipts均0，9项迁移成功、保护标记
  不变。本轮没有生产源码修改，仅补齐两仓库证据文档；不重跑输入未变的源码
  单测/完整覆盖率。下一阶段为完整产品入口与Pi会话联合验收；R1–R6仍未整体
  完成，默认接通/生产部署/DataHub退役仍未由此次探针授权。
  清理完成：本轮runner已移除隔离userData/凭据/运行树；临时TLS/控制目录和
  上轮保留的合成失败运行树已精确清理（均为可重建测试产物）。SSH任务PID6373
  正常退出，15432无监听；两仓库diff whitespace检查通过，HEAD未变，无Git
  提交/推送、正式部署、系统信任变更、默认接通或真实用户profile操作。

- 2026-09-14 在线Electron与原生index/query组合验收进行中：复用上一轮隔离
  Electron探针，显式native选项预先复制/临时测试签名并安装独立index/query树，
  再进入真实Server窗口。实际Host索引事务、Main scheduler/worker/head observer、
  原生OpenViking及查询IPC执行；仅模型invoke/查询向量是确定性测试返回，权限/
  同步/head/版本不伪造。验收原生发布、本次资产精确命中/正文、撤销后旧索引
  拒绝、项目撤权、进程退出与原始/安装树不变。原有非native探针不删除。
  无真实提供商费用/默认切换/生产部署/正式信任键/用户profile写入。本轮回滚
  范围为探针、共享测试helper、下述原生队列预算修复及维护文档；成功后清理隔离产物与专用DB，物理退出
  不确定时保留现场并报告。产品所有8秒/60秒准入期限保持不变；未通过前不
  声称原生与在线联合完成，也不撤销DataHub旧路径。
  第一轮在线组合失败于native-index，未创建发布指针；原生进程已创建index
  目录，但没有result.json。Server整轮654.25s为1 passed/1 failed，退出前
  reset完成；只读核验users/teams/versions均0，短期交接文件/加密会话已清除。
  当时脱敏信息不足以确定模型通道、授权网络或原生处理哪一处失败，不据此改
  生产实现。补充仅数值的模型invoke阶段/计数、原生退出码及授权响应计数后重跑；
  不记录请求正文/凭据/SQL/stack，不把增加诊断当作修复完成。
  已完成的独立检查：7文件155tests、原有native 4/4（153.41s）及完整树哈希
  不变、Desktop/探针严格类型、定向lint、dead-code、architecture和structure。
  这些结果不覆盖尚未通过的在线原生组合。
  第二轮仍在native-index失败（原生code70），Server 646.26s退出101；13次
  模型invoke均完成、23次授权均成功、29个HTTPS请求全部收到响应且无代理超时。
  固定版本OpenViking源码与离线单变量实验定位到每文档队列等待30秒：0延迟
  成功；每次合成授权延迟2500ms时触发DeadlineExceededError、code70，非授权
  拒绝。在线失败本身未输出异常类，不把对照实验的异常声称为在线日志。
  修复使文档等待使用固定240秒作业的剩余预算，单帧模型30秒、请求8秒、查询
  60秒及总任务预算不延长。修复后慢样本15次调用、48.32s完成真实向量写入；
  Python预算单测10/10通过。补充断言式原生对照回归，并重跑最终在线组合。
  全量检查首先发现HTTPS测试夹具位于生产扫描目录；将其移至eng/capabilities/
  shared-knowledge-live-fixture.ts并更新三个调用方，未放宽生产网络门禁；
  定向生产transport检查991文件通过。最终完整门禁结果待收口。
  最终断言版原生队列回归两组exit0：无延迟11.10s，2500ms延迟50.03s，
  各15次授权/模型调用且vectorComplete/contentUpdated均true；进程组退出后
  清除合成作业。完整check静态阶段通过（1073模块/4111依赖/0环，3216文件）；
  默认并发覆盖率阶段为831文件5375tests通过、3文件4tests失败、22tests跳过，
  失败集中于Worktree真实Git超时及超时后fixture清理竞争。未修改无关Worktree
  实现或放宽期限；同一源码固定2 workers定向复核3文件25tests全部通过，
  再以仓库既有源码门禁的2 workers配置重跑完整覆盖率，保留初次失败记录。
  最终源码原有native回归4/4通过（165.79s），覆盖成功、授权拒绝、取消、版本
  不匹配；成功分支含实际查询、只读代际/副本清理和临时测试签名准入，原始树
  54345文件/641306289字节，测试树54349文件/641333171字节完整性均保持。
  这是独立原生回归，不代替仍在等待结果的在线组合或正式生产信任键证明。
  固定2 workers完整test:coverage最终exit0，全部覆盖率门槛通过：statements
  84.05%、branches78.31%、functions87.43%、lines87.69%。未重复已通过且输入
  不变的静态门禁；这与首次默认并发check失败分别记录，不改称首次check通过。
  第三轮在线结果PARTIAL：原生code0、15次模型调用均完成，result.json和
  current-index.json实际生成；先前索引预算问题已越过。后续native-query失败，
  queryEmbeddings=0；41次HTTP请求收到40个响应，32次已返回授权均成功，
  代理超时计数0。该计数不能排除更短的客户端取消/超时，也不能确定未响应
  请求属于哪个查询准备阶段；不推断为模型或索引算法故障，不放宽8秒/60秒合同。
  Server整轮698.71s、1 passed/1 failed、exit101；联合查询/撤权不能标PASS。
  新增仅数字的查询诊断：1/2为句柄打开前/后，3/4为准备前/后，5/6为embedding
  授权前/后，7/8为原生查询前/后；含总耗时和60秒signal是否已取消，close不覆盖
  最后业务步骤。该诊断尚未在线执行，不能据此补造第三轮阶段或原因。
  只读收尾users/teams/versions/events/receipts全0、9项迁移成功、实例保护标记
  不变，三轮合成加密会话均不存在；第三轮现场保留于ignored目录
  artifacts/shared-knowledge-live-electron-OtaFTH，包含合成内容和临时测试运行树，
  无生产凭据。下一步只定位在线query失败，禁止默认接通/部署/DataHub退役。
  新增查询诊断后Desktop typecheck、定向type-aware lint、runner语法及structure
  通过，查询/receipt/reader/runtime四文件195tests通过。全量覆盖率对应诊断
  增补前的同轮源码，未将其冒充新增诊断的在线验证。已清理本轮所有临时TLS
  私钥/证书/交接控制文件、离线诊断构建和前两轮隔离运行树；均为可重建测试
  产物。保留上述第三轮失败现场，不含会话凭据。任务隧道PID85856已退出、
  本机15432无监听；没有commit/push/deploy/生产数据或真实用户profile变更。

- 2026-09-14 完成Electron在线授权联合探针：本轮仅增加隔离Main/utilityProcess
  探针与维护文档，复用现有实时HTTPS测试窗口和专用VPS数据库。使用真实OS
  safeStorage加密合成会话，独占userData重开后由Main独立授权；Host通过实际
  parentPort与receipt broker通信，验收同步/撤销/项目成员拒绝及物理退出。
  不读取或覆盖现有profile/登录、系统信任及密钥，不改生产源码/默认开关。
  系统安全存储不可用则失败，不启用明文降级；原生索引/查询仍单独验收，不能
  拼接为应用端到端或正式签名包证明。回滚限新增探针及本轮维护文档，清理本轮
  私有TLS目录/合成加密凭据/userData/隧道与测试DB，不删既有WIP/生产数据。
  完成条件为真实Electron标志与producer均exit 0、受保护数据库和进程清理确认，
  相关源码检查通过；无commit/push/deploy/DataHub清理。
  实际新增eng/capabilities下runner与Main/utility两入口，knip登记真实入口，
  CONTRIBUTING说明专用窗口只能选择一个consumer及失败清理流程。Main采用
  DesktopSafeStorage/EnterpriseCredentialStore，重开验证后再向utility传递
  短期会话；经真实parentPort执行既有Gateway/sync/receipt broker。源码合同
  和生产开关不变；OS安全存储失败不降级，不修改Keychain访问控制或系统信任。
  macOS arm64 Electron返回SHARED_KNOWLEDGE_ELECTRON_PASS且exit 0；Server
  完整postgres_flow 2/2 passed（649.33s）。首次/重复sync cursor 1、Main独立
  授权及重新打开句柄后追加授权、撤销cursor 2、项目移除后Host/Main/broker
  拒绝且团队权限仍有效均通过。加密文件非明文、0600、重开一致、清空测试会话
  与utility exit事件确认通过；不等于完整产品Host入口/原生索引/搜索/安装包。
  相关5文件80tests、严格显式TS检查、定向type-aware lint、runner语法、
  bundling、dead-code和architecture（1074 modules/4116 imports/0 cycles）、
  structure（3212 files）通过。无env入口明确exit 1，未创建测试profile。
  knip仅原有electron配置提示；首轮lint发现unbound-method后改为闭包并通过，
  不改运行语义。只读收尾users/teams/versions/events/receipts均0，9项迁移
  成功、受保护实例标记不变。隔离userData/加密凭据/探针产物已由runner清理，
  TLS私钥/证书/控制文件/目录及任务隧道PID83438已清理，15432无监听。
  HEAD ca043bac加既有WIP，main ahead 2；无commit/push/deploy。下一步仍需
  将在线授权及真实IPC与原生索引/搜索合并验收，再决定产品入口切换。R1–R6未完成。

- 2026-09-14 完成实时HTTPS测试联调：受保护postgres_flow末尾可选开启独立loopback
  API窗口及合成项目，最长300秒；仅仓库外0700目录交接0600短期测试会话，
  不输出凭据。Desktop测试用本进程额外信任的临时SAN证书提供HTTPS转发，不改
  系统信任/产品HTTPS限制。真实Gateway、Host同步、Main独立授权与receipt broker
  联合验证发布/幂等/同步/撤销/成员移除，使用真实网络和VPS PG，无付费模型。
  IPC传递仍为进程内测试连接，不冒充Electron/原生索引/检索/正式部署。
  仅测试及维护文档；失败先关闭测试listener并保留脱敏诊断，数据库按既有专用库
  reset合同清理，短期凭据/TLS私钥/目录精确删除。无新迁移/依赖、无默认切换；
  回滚本轮helper/测试/文档，不删旧接口/历史数据或改全局配置。
  第一轮Desktop在首次发布控制请求8秒超时（8025ms），Server观察failed标志后
  关闭窗口并reset，整轮444.90s未通过；只读核验users/teams/versions均0。
  尚不能据此认定生产链路失败或归因为SQL性能。新增无凭据的状态/耗时计数，
  仅将测试管理写入预算调为30秒、代理闲置35秒；真实Gateway/Main的8秒不变。
  第一轮临时TLS材料和控制文件已精确清理，第二轮使用新的独占目录，不复用旧标志。
  第二轮实际HTTPS发布201/8280ms、重放200/3252ms、政策GET/PUT200及首次Host/Main
  授权和sync成功；8个请求均收到响应、无代理超时。失败是新增测试错误要求首次
  sync至少2次Main网络授权；现场broker是在open独立取grant，append前后检查
  当前grant/permissionRevision，并非每页重复联网。修正为首次确有独立请求、
  下次sync重新打开句柄后授权请求增加；不改变生产权限/租约/8秒门禁。
  第二轮整轮472.51s未通过，随后只读核验users/teams/versions均0，临时目录已清理。
  第三轮Desktop live 1/1 passed（77.41s），Server完整postgres_flow 2/2 passed
  （585.71s）；23次真实HTTPS请求均收到响应、代理超时0。发布201/12206ms、
  幂等重放200/4101ms，发布管理请求时延不能作为产品性能通过证据。真实Host及
  Main独立当前授权、重复sync重新授权、receipt cursor 1和精确索引输入均通过；
  空模型政策阻断模型授权但允许同步。撤销204后cursor 2，旧job失效且新job为空
  而拒绝；项目成员移除204后Host/Main及broker拒绝项目访问，团队权限仍有效。
  实际索引输入无模型调用；凭据存储/IPC仍为测试连接，不升级为安装包端到端证明。
  相关4文件66tests、Desktop typecheck、定向严格lint、structure（3209文件）、
  Rust fmt及严格all-target Clippy通过；无env探测1 skipped，不冒充live通过。
  结束只读核验users/teams/versions/events/receipts均0，9项迁移及受保护实例
  标记保留；任务隧道PID74952已关闭、15432无监听，第三轮临时TLS私钥/证书/
  控制文件/目录及本地receipt根均清理。两仓只增加测试与维护记录，无commit/
  push/deploy。下一步仍为真实Electron IPC/安全存储与原生索引/检索联合验收，
  默认入口切换及DataHub清理未获本轮测试结果替代，R1–R6仍未整体完成。

- 2026-09-14 完成跨仓真实wire接收合同验收：Server仅在显式测试导出选项下将
  专用newmoney_test合成候选的原始upsert/revoke同步响应交付为仓库外文件；Desktop
  独立读取该文件，通过真实协议校验、Main receipt落盘/重开及索引job物化，验证
  版本相等、跨范围/篡改拒绝和撤销后旧job失效。不导出凭据、不导入sibling源码，
  不从历史page租约推断当前权限；当前读取授权使用明确标注的合成guard。
  仅测试/维护文档，不改生产实现/协议/开关。完成条件为真实DB导出通过、同一
  文件Desktop验收通过及相关类型/lint/结构门禁；不冒充live网络/原生模型/查询
  或打包联合证明。回滚限本轮测试及文档；临时输出清理，不删既有WIP/数据。
  实际Server新增knowledge_contract测试helper，捕获原始同步字节、验证固定合成
  内容及唯一upsert/revoke，输出0600且create_new拒绝覆盖。真实postgres_flow
  2/2 passed（377.97s），严格all-target Clippy/fmt通过；无新迁移/依赖。
  本次输出1722 bytes，SHA-256=c107f757ebc1e3bf5805f8a7dcf8d307f376b64b7cdc8883929d81f0469b008e。
  Desktop同一输出验收3/3 passed：发布回执与canonical哈希/内容一致，receipt
  重开/幂等接收，当前合成读取拒绝时无job写入；允许后生成精确job，实际revoke
  响应使旧snapshot拒绝且新job为空而失败，用户命名空间/跨项目/内容篡改隔离。
  未设置输入的独立探测为3 skipped，已验证不会误报实际跨仓通过。原有binding/job
  47/47 passed；tests与Desktop typecheck、定向type-aware lint、structure
  （3207 governed files）通过。首轮lint发现receipt可能undefined，补显式存在
  断言后通过；没有改生产代码、放宽权限/时间/内容验证或构造替代服务响应。
  两仓维护文档记录显式导出/消费及证据边界；本轮不重复native/preview/完整源码
  门禁，不声称Host实时联网、原生模型检索或端到端交付。R1–R6仍未整体完成。
  测试结束只读核验users/teams/versions/events/receipts均0，9项迁移成功及实例
  标记保留；任务隧道PID73271关闭、15432监听消失，独占临时响应文件及空目录
  清理，仅保留hash/size。两仓本次文件空白检查通过，无commit/push/deploy；
  Desktop HEAD仍ca043bac加既有WIP，Server仍无提交。

- 2026-09-14 完成显式版本化HTTP发布接线与真实DB验收：新增独立publish-versioned入口，
  复用现有受权事务writer；旧publish/search及Web调用方不切换、不删除。
  新入口返回原始发布回执而非检索就绪状态，重复提交保留原版本和时间；当前
  管理员/项目成员/会话权限每次检查。修复旧writer未计入版本资产的共享配额。
  验收真实测试库HTTP并发发布、幂等、权限与跨范围拒绝、同步可见和跨lane配额。
  无新迁移/依赖，无生产部署/模型调用/默认工具激活；回滚仅新HTTP接线和文档，
  保留已发布版本与旧路径，不能自动删数据。复用已授权专用库与任务隧道测试。
  实际验证：31项lib测试、bin目标、postgres_flow编译、fmt与严格all-target Clippy
  通过；真实postgres_flow重跑2/2 passed（400.50s），不是缺DSN跳过。新HTTP在
  OpenViking=None下首次201、并发重放200，版本/事件/回执各1；从cursor=0同步
  获得相同内容版本，未认证/跨团队/非管理员/缺项目成员拒绝，共享配额耗尽时
  旧writer及新HTTP均拒绝新发布，pending状态保留，已有回执重放仍200。
  首次真实回归183.30s失败于同步503：既有stream allocation夹具单独提交了
  项目cursor却无event。改为结束时rollback该独立锁探测，保留作用域隔离断言，
  不放宽生产同步连续性/缺口拒绝；修正后严格Clippy及完整DB回归通过。
  OpenAPI YAML无重复key，133个本地引用与46个唯一operationId检查通过；这是
  结构检查，不冒充完整OpenAPI兼容验证。README/PRODUCT/LOCAL_MEMORY_CONTRACT
  同步显式接口、原始回执语义、真实DB证据与旧默认调用方未切换的边界。
  Desktop仅维护本计划，本轮未改客户端运行时或重新打包；R1–R6总体仍未完成。
  结束只读核验users/teams/versions/events/receipts均0，9项迁移成功、受保护实例
  标记未变；任务隧道PID70087精确关闭，15432监听消失。两仓本次文件空白检查
  通过，无commit/push/deploy；Server仍无提交，Desktop HEAD保持ca043bac加既有WIP。

- 2026-09-14 完成用户授权的VPS专用测试库实施与真实DB验收：仅newmoney_test、newmoney_test_owner/
  newmoney_test_app、受保护实例标记、精确新角色HBA限制，以及受控隧道上的测试
  迁移/清空；不创建生产newmoney，不修改其他数据库权限、DNS或部署服务。
  现场PostgreSQL17.8，现有数据bind=/opt/docker/data/postgres，owner Compose为
  /opt/docker/compose/postgres/docker-compose.yml；414G可用，无目标库/角色。
  现有HBA本地trust及其他用户规则必须逐字保留，仅前置新测试角色的限制。
  为现有三库和globals创建仓库外加密逻辑备份并验目录；不是完整恢复演练，
  生产cutover的恢复演练门禁继续保留。测试仅使用现有端口的SSH loopback转发，
  不创建生产部署专用Docker网络，不安装Mac PostgreSQL。凭据仓库外0600。
  回滚原则：新角色异常先禁止登录，保留测试库和证据；新HBA无效时恢复原文并
  reload，不重启PostgreSQL。不自动DROP任何库；已有服务状态前后核验。
  完成条件为真实DB身份检查、跨库拒绝、实例标记只读、迁移及postgres_flow通过。
  实际创建完成，app角色五项高权限均false、owner为NOLOGIN；只读实例标记
  4c282cd5-07f5-4a86-8795-1a7867778506，TCP实际server=172.19.0.3。
  HBA新增角色块精确前置且原文保留，reload后无解析错误；test库正确密码可连接，
  错误密码拒绝；groland/datahub_prefect/postgres/template1实连均HBA拒绝。
  HBA SHA-256=72e3bef815c5134e9d40b07f2df1de03c46f1c3031fd902a80188ddbb97f9f3d。
  初次临时HBA写入脚本的shell引号错误发生在替换前，复核原文未变后修复；
  留下的精确0-byte staging文件已清理。没有重启容器或改变旧角色规则。
  因SSH批量传输约28KB/s，原Mac流式备份取消；改为VPS本地custom dump目录
  校验后AES-256-GCM CMS加密，仅上传公钥证书，私钥保留Mac仓库外0600。
  四份备份位于/home/sixseven/.local/share/new-money-backups/preflight-20260914.02P1TM，
  明文dump已删除；Mac私密目录中的receipt记录hash/size、HBA原文与备份解密材料。
  旧未完成传输副本已按精确路径清理；不将归档/封装校验冒充完整恢复演练。
  通过127.0.0.1:15432任务SSH隧道运行postgres_flow：2/2 passed，503.55s，
  含真正DB注册/团队/设备及stream/version/change/publication/list/detail/revoke/sync
  夹具，不是缺DSN跳过。9项迁移success；结束users/teams/knowledge_versions/
  knowledge_changes均0，control标记保留。额外31项lib测试、fmt和严格Clippy通过。
  隧道已关闭且监听消失；独立测试库/受限角色保留。凭据、备份私钥及host-local
  安全测试启动器在~/.config/new-money-server/，无秘密入库或输出。
  Server README/LOCAL_MEMORY_CONTRACT/VPS_DATABASE/VPS_DEPLOYMENT同步，明确覆盖
  旧compiled-only测试表述，不代表HTTP发布已切换；当前HTTP仍走旧适配器。
  生产newmoney、域名、服务部署、正式签名包和付费模型未操作。Server仍无提交，
  Desktop HEAD仍ca043bac043697480ef6e2804ad6bf41a28fb79f加WIP、ahead 2。
  两仓diff检查通过，无commit/push，R1–R6总体仍不勾选。

- 2026-09-14 正式联调只读预检：通过已有host-local VPS认证helper查询当前容器
  与pg_database，PostgreSQL仍为17-alpine；非模板库仅postgres/groland/datahub_prefect，
  没有newmoney/newmoney_test；docker ps没有运行中的New Money服务。普通批处理
  SSH认证失败后改用既有helper成功，不读取/回显认证值。Cloudflare公共解析器
  1.1.1.1对newmoney.52671314.xyz A查询返回NXDOMAIN，HTTPS健康检查未到达服务。
  本机NEWMONEY_TEST_DATABASE_URL/NEWMONEY_TEST_SERVER_ADDR/NEWMONEY_TEST_INSTANCE_ID
  均未设置；不把未运行的PostgreSQL集成测试写成通过。Server工作树仍无提交，
  当前HTTP publish_candidate仍调用旧OpenViking适配器；事务式版本发布writer
  已有源码但没有接到该HTTP入口。版本同步接口存在不等于完整发布切流已完成。
  artifacts/openviking-native仅发现既有私人正式签名包及开发测试包的装配回执，
  既有签名包缺少newmoney-team bootstrap；本次未签署新包或安装进用户profile。
  下一步先授权并按VPS_DATABASE/VPS_TEST_DATABASE安全合同创建专用newmoney_test
  及测试角色/只读实例标记，通过受控隧道执行有身份校验的数据库集成测试；
  测试会迁移并清空该专用库的应用数据，绝不能指向其他库。先核对角色/存储/
  备份和连接隔离，再实施；本轮没有建库、迁移、网络/DNS修改或部署。
  生产newmoney、正式域名上线、签名和实际模型调用仍为后续独立边界。

- 2026-09-14 完成测试信任键下的受管原生运行包联合验证：在既有native成功分支接入实际
  安装事务、完整树验签及index/query启动前复验，使用独占临时目录和仅内存
  Ed25519测试密钥。验收真实索引/查询继续通过，导入不激活私人运行包，运行后
  签名树仍完整。仅测试/维护文档，无生产信任键修改、真实profile安装、付费模型、
  VPS或分发；回滚本轮测试增量，不动既有产物/WIP。定向native及相关类型/结构
  门禁足够，不把测试签名等同正式签名包、真实账号或默认工具激活。
  新增team-runtime-native.test-support，原native成功分支复用真实安装事务与
  createInstalledLocalMemory准备/启动前复验，随后通过同一实际索引的Main→Host→Pi
  搜索、精确正文及JSONL重开。无生产代码/协议/产品开关变更；失败分支原覆盖保留。
  第一次native 3/4通过；成功分支完成Pi读取后，旧45秒索引计时继续覆盖后续
  完整树复验，导致取消探针未启动就超时。已将夹具该计时在索引物理退出时结束；
  准备180秒/单例240秒有界，查询仍遵守自身生产期限，没有放宽产品门禁。
  最终native 4/4通过（152.10s，成功分支141.773s）；安装/组合/query准入
  回归3 files/58 tests通过，共62项。tests及Desktop typecheck、定向type-aware
  lint、dead-code、architecture（1073 modules/4111 imports/0 cycles）、structure
  （3206 governed files）及git diff --check通过。knip仅原有electron配置提示。
  实际安装并运行的临时签名树54349 files/641332781 bytes，sha256=
  425cdde45189a0e10fbece3cd67eb2341d72d45cd81c36d3d09efe6c0fa7d62e；
  原始开发运行树54345 files/641306289 bytes，前后sha256均为
  739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36。
  两安装树、manifest及signature运行后未变；查询进程退出、临时副本清理通过。
  成功夹具清理完毕；首轮保留现场在确认无相关进程后按精确路径清理。
  仅内存测试私钥，不保存/输出密钥；不读取正式签名键。CONTRIBUTING同步命令
  与证据范围。仅测试/文档变更，不重复完整源码门禁或用户可见preview。
  HEAD ca043bac043697480ef6e2804ad6bf41a28fb79f加原有WIP，main ahead 2，
  无commit/push/deploy。真实服务/实际模型/正式签名包/Electron端到端及默认
  工具激活仍未验收；R1–R6继续不勾选。

- 2026-09-14 完成显式构建入口及本地验证：L1-F/跨模块高风险，design-craft沿用现有
  PRODUCT/DESIGN/DESIGN.dark的SettingsRow/secondary-button/notice；主代理串行。
  新增app范围index命令，只接受team/project选择，通过既有Host owner构建，
  不接收路径、凭据、模型或授权。8分钟owner预算外加有限ack余量，不自动重试。
  UI独立于仅同步动作，提示用户模型费用、取消与结果未确认；成功仅称本次已
  构建，不冒充实时可检索。scope/identity变更卸载取消并丢弃晚到结果。
  验收协议/Host/生命周期/UI状态、真实浏览器与unsigned preview；回滚仅本次
  接线/UI/文档，保留既有数据和WIP。无线上部署/安装真实运行包/付费调用/
  commit/push；默认工具开关和自动启动/登录调度仍不启用。
  app命令为enterprise.knowledge.index；510秒ack覆盖480秒owner及清理回复，
  indeterminate映射为不可自动恢复的结果未确认，不把停止或close当作回滚。
  新增严格scope/result合同、Host转发/错误、timeout及SSR回归；最终check:source
  exit 0：834 files/5379 tests passed、6 files/18 tests skipped，248.72s。
  覆盖率statements/branches/functions/lines为84.13/78.31/87.49/87.77%；
  typecheck/lint/protocol/架构/结构门禁通过。最终协议revision为
  05843de08ec4b828315d7960a5c2d880c8176d24418db1ed185b1a9ce2364d26。
  冻结renderer后共享内容E2E 6/6通过；随后键盘Tab/Shift+Tab、focus-visible及
  Enter激活定向补验通过（最后last-run passed，16:43:06+08:00，晚于测试修改）。
  早期协议重建/Vite重载及旧renderer样本作废，不据其判断产品失败或通过。
  browser67在任务自建页实际核验深色成功、浅色960px构建中、停止和未知结果；
  使用合成账号/Agent响应，无真实模型调用。现有SettingsRow层级、按钮、提示
  与两主题一致，未观察到溢出或遮挡；轻量一致性检查无已发现P0/P1。
  浏览器截图（实际查看）位于~/.browser67/runtime/runs/pi67-newmoney-index-ui/：
  深色20260914T083942049Z-39c9256f/artifacts/screenshot-selector-New_Money_index_controls_dark-20260914T083942056Z-e60cd32c.png，
  sha256=5b3bac10eb958b6eadf94c19a88f586f8ef1c2bde6277e02b1edd1d5746db533；
  浅色20260914T084030214Z-33c39b0e/artifacts/screenshot-selector-New_Money_index_pending_light_narrow-20260914T084030218Z-86fa90c9.png，
  sha256=33aa4f07b836650da334e920a1d6681924034e3b0e220fc8de03c9eaec3d4ee1。
  finalize_task confirmed closed=1 verified=1 errors=0，无用户页关闭；任务Vite已停止。
  preview:mac:unsigned exit 0：重新打包、DMG/ZIP校验、packaged smoke及启动成功。
  身份与smoke分别见artifacts/release/macos-preview-candidate-identity.json和
  macos-preview-packaged-smoke.json；darwin/arm64，0.1.0-alpha.41，unsigned，
  source=ca043bac043697480ef6e2804ad6bf41a28fb79f加WIP（clean=false），
  app.asar 200567149 bytes，sha256=
  bbfae846e8a0117889cf3ffc608c7c0b1a2545a7e19e9897fd763af81ca845de。
  PRODUCT/DESIGN/DESIGN.dark/ADR/进程协议/CONTRIBUTING已同步。普通packaged
  smoke不能替代新入口的真实服务→受管签名运行包→模型→查询联合验收；该项、
  默认工具激活、Windows及最低macOS验收仍待完成。没有新增运行包安装、外部
  分发、VPS操作或数据库变更，未commit/push，保留既有WIP；R1–R6不勾选。

- 2026-09-14 完成内部索引入口同步前置：现场确认启动/登录不构建索引，设置页
  只接收receipt；内部index也未先追平服务内容。本轮为已显式请求的index增加
  同账号/范围的有界同步，完成且close确认后才进入Main索引准备/模型reservation。
  初始模型政策仍先验证，同步不调用模型；同步失败/取消/页预算耗尽拒绝构建，
  保留已确认receipt供下次显式请求续传。四席位/480秒总预算覆盖同步阶段，
  同步额外60秒/10页上限。验收顺序、失败、账号/Workspace/设置/电源取消及
  既有发布边界。回滚仅本轮index前置及测试/文档，不回滚receipt或其他WIP。
  不自动启动/登录同步构建，不开新工具默认开关，不访问真实账号/付费模型，
  不部署/安装/commit/push；用户入口与受管签名包验收继续待完成。
  实际复用EnterpriseAuthorizationController.indexKnowledge的同一捕获credential、
  scope、取消signal和容量，不另开调度器或重读账号；初始模型配置/政策验证
  在前，同步期间无invoke/reservation。sync返回后复验原租约和lifetime，再进入
  原Main prepare→reserve→register→start/wait→head→publish→close事务。
  新增12项覆盖team/project append与close阻塞顺序、HTTP/保存/close/10页耗尽、
  caller/账号bootstrap/配置/shutdown/suspend/Workspace rebind取消；既有index
  模型准入及发布head测试增加真实同步前置，不mock掉新阶段。定向4 files/99
  tests通过；初次lint发现测试URL的String(url)歧义，改为显式URL/Request取址。
  最终check:source exit 0：833 files/5373 tests passed、6 files/18 tests skipped，
  231.16s；覆盖率statements/branches/functions/lines为84.13/78.31/87.50/87.77%。
  全部typecheck/lint/protocol通过；architecture 1072 modules/4102 imports/0
  cycles，structure 3204 files，production transport 990 files；knip仅既存
  electron提示。协议revision未变。PRODUCT/ADR/进程协议/CONTRIBUTING同步。
  本轮新增5行生产接线，无新文件/目录/依赖或状态存储；默认用户入口未变化，
  未执行preview/原生专项/签名包测试（上一轮native证据不冒充本轮同步联合证明）。
  下一步接入明确的构建入口和索引状态，继续区分receipt已同步与索引可检索；
  自动启动/登录流程及默认激活仍待独立验收。所有原有WIP保留，R1–R6不勾选。

- 2026-09-14 完成隔离原生索引与Pi工具的源码联合验收：复用原生索引成功夹具，将同一实际发布代际
  连接真实Main receipt broker、Host会话查询、Pi工具及持久JSONL重开检查。
  验收搜索/正文同版本、重开不复用瞬态选择、历史重新读取、Main撤权及Agent
  政策拒绝、私人捕获禁止，核实原生查询进程退出与副本清理。账号/提供商、
  Main授权/head观察及运行包准入保持显式合成，不宣称真实服务同步、签名包
  或完整模型循环；默认开关不变。回滚仅本次测试及说明增量，保留原有WIP、
  旧工具与hosted搜索。不打包/安装/部署/commit/push，不使用真实Profile。
  同一实际OV索引经Main broker→Host会话端口→Pi工具返回同资产/版本正文，
  保存JSONL后重开到出生分支仍检查非当前分支来源；重开旧选择拒绝且不发Main
  请求。历史读取只调用current-read，不重复embedding；Main撤权拒绝后重新
  授权可恢复验证，Agent政策拒绝在Main/embedding前失败。历史消息保留、私人
  捕获拒绝；实际查询进程组退出，query副本消失，已发布索引完整性仍通过。
  首轮Desktop直接导入SDK导致依赖拒绝；初次夹具拆分触发runtime反向引用app
  门禁，最终将Main/Host组合留在Desktop原生测试，Pi夹具仅接收typed ports并
  操作自身Session/Tool，没有新增依赖或放宽架构检查。最终native 4项+Pi工具
  25项+Host组合1项全过（3 files/30 tests，16.21s）；受影响两包及tests类型
  检查、定向lint、architecture（1072 modules/4102 imports/0 cycles）、structure
  （3204 files）、dead-code、git diff --check通过，knip仅既存electron提示。
  本轮只修改测试/测试夹具及维护说明，未重复上一轮已通过的完整check:source，
  未运行默认预览（产品代码、协议及用户可见行为未变）。CONTRIBUTING修正两处
  Pi尚未接通的旧描述并补联合验收边界。HEAD仍ca043bac043697480ef6e2804ad6bf41a28fb79f、
  ahead 2。真实服务同步调度、应用启动/索引就绪与受管签名包联合验收仍待完成；
  本用例不证明显式Host开关在产品启动路径已激活，不将手动工具执行称为模型
  自主调用。下一步核验应用启动的同步/索引就绪路径，再决定默认启用；R1–R6不勾选。

- 2026-09-14 完成Pi canonical工具的显式启用接线（默认产品启用未完成）：新增独立team knowledge搜索/读取工具，
  复用真实团队出生身份封装及现有模型/Tool租约；只允许读取本会话最新搜索返回的
  范围/资产/版本，使用canonical文档结构而不伪造旧Experience/SOP字段。JSONL
  保存来源并在每次模型处理前重验证，包括非当前分支；旧工具/hosted搜索保留。
  历史验证新增私有current-read：Main选当前已准入索引但仍要求同assetId/revision，
  避免无关索引更新锁死未变资产，不绕过撤销/head/read/模型检查，不查询/调用模型。
  验收协议/Main/Host/Pi选择/真实JSONL/安全分类及组合；高风险回滚仅本次协议与
  工具/接线/文档增量，保留既有索引、私人资料及所有其他WIP。不部署/提交/推送。
  安装包可用性独立验收，不凭source通过宣称完整商业化完成。
  Host以canonicalTeamKnowledgeTools=true、managedLocalMemory及settings端口共同
  准入，通过Workspace-bound port→TaskRuntimeRegistry→PiSdkRuntime→既有Session
  wrapper注册viking_team_search/read。应用入口未打开新开关，防止在索引同步/
  运行包未就绪时意外暴露不可用工具；旧工具/hosted搜索不受影响，无用户可见
  默认行为变化，未执行常规预览。新工具输出newmoney-team-knowledge不可信JSON
  与确定性文本；历史检查同时验证text/details一致、范围/版本及正文身份，随后
  通过当前授权索引核对同一资产版本，拒绝变更、撤销、错配及错误/未完成工具。
  current-read保留Main独立授权、head/模型、receipt重放、容量/取消/关闭与哈希
  合同，不调用Python/查询/模型，也不把新版本替换进旧历史。正常read仍固定
  搜索snapshot。协议revision由生成器更新为
  b61415316b77648e032b246655d18bcc3e4885232342117d717191ff8afd6ecf。
  定向验证通过：canonical工具/真实Pi JSONL25项、既有history21项、Session封装
  15项、安全分类20项、Task registry14项、真实SDK出生/替换注册9项、协议15项、
  Main read owner21项、真实临时receipt/publication reader84项、Host正文13项、
  receipt client32项、Host查询授权58项、真实Host组合1项。组合Main/HTTP仍为
  合成，不称为真实提供商、完整Pi模型循环或安装包联合证明；未调用真实模型。
  初次typecheck修正了新协议联合分支及历史document.kind收窄；结构检查发现
  pi-sdk-runtime.ts超限一行，按既有options布局整理，不放宽阈值。后续定向
  typecheck/lint与最终check:source均通过（exit 0）；架构1071 modules/4092
  imports/0 cycles，结构3203 files，production transport989 files；覆盖率
  statements/branches/functions/lines为84.15/78.30/87.59/87.79%。knip仅既存
  electron提示。最终门禁后仅回填本checkpoint，git diff --check通过。
  新增四个同目录文件：typed access/结果约定、Pi工具、历史解码及相邻回归；
  无新目录/依赖/数据库/后台循环。HEAD仍ca043bac043697480ef6e2804ad6bf41a28fb79f、
  ahead 2，所有原有WIP保留；未打包/签名/安装/部署/commit/push。下一步为隔离
  Profile下的索引同步与显式工具启用联合验收，完成后才考虑默认激活；R1–R6未完成。

- 2026-09-14 完成Host会话模型授权入口接线：普通canonical搜索/正文仅有读取及
  embedding授权，不可直接给Pi模型消费。本轮在既有Host查询owner上增设显式
  Session入口，固定出生身份/Agent模型、从身份推导team或project范围，先用同一
  当前账号核验出生项目和Agent政策，再执行原Main事务，完成前复验租约/生命周期。
  共用四席位和60秒预算，拒绝不能回退普通内部read/search；不新增权限系统。
  验收身份/模型错配、授权先后、租约/取消/并发、team/project显式范围及真实Host
  组合。回滚仅本轮Host会话入口/接线/回归/文档增量，保留旧工具和内部事务、
  私人资料、现有索引及其他WIP。Pi工具展示、搜索选择及历史重验证尚待接通；
  不部署/付费调用/打包/安装/commit/push，不将本轮入口称为Pi端到端完成。
  已接入真实AgentHostServer.teamKnowledge.session.search/read；身份和模型在首个
  await前复制，Agent项目授权用本次run的同一credential，避免独立外层grant与
  登录切换竞态。Agent租约期限取消stalled Main读；同一owner覆盖授权与清理，
  无新timer轮询/续租器/缓存/数据库或模型路由。正文不加载embedding settings；
  search仍在Main准入索引后才加载embedding密钥并独立核验embedding政策。
  27项新增回归通过；完整查询owner58/58、原embedding生命周期18/18、底层
  搜索15/15、正文12/12、真实Host组合1/1通过（104项）。组合使用合成Main及
  HTTP回复，未加载Pi runtime/调用真实提供商；不能拼成Pi/受管原生包联合证明。
  最终check:source通过：832 files/5321 tests passed、6 files/18 tests skipped，
  231.49s；覆盖率statements/branches/functions/lines为84.14/78.24/87.58/
  87.77%。架构1068 modules/4076 imports/0 cycles、结构3199 files、production
  transport986 files；typecheck/lint通过，protocol revision不变，knip仍只有
  既存electron提示。本轮没有新增文件/目录/依赖；门禁后只回填本checkpoint。
  HEAD仍ca043bac043697480ef6e2804ad6bf41a28fb79f、ahead 2，原有WIP保留。
  下一步：Pi canonical工具、瞬态搜索选择、JSONL来源及历史重验证一并接线，
  再做真实运行包联合验收；现有工具/hosted搜索未切换，R1–R6保持未完成。

- 2026-09-14 完成现有共享工具的会话边界加固：复用既有Pi团队出生身份及Agent模型租约，
  在共享工具完成/更新时重新核对当前manager、Session ID、身份和请求模型；失效时
  丢弃瞬态搜索选择，防止晚到结果及同ID重新打开的会话沿用旧选择。验收包含身份/
  manager/模型变化、取消、成功返回及重新搜索恢复。只改会话工具封装及对应回归/
  合同；回滚仅该增量，不更改正文协议、已发布索引或其他WIP。canonical新通道
  与旧Experience/SOP展示结构尚未切换，不新增模型授权系统或产品入口。
  新增15项回归全部通过；既有provenance/selection/model guard/Tool admission/
  renewal共60项通过。使用真实Pi内存SessionManager及合成内容/transport，不调用
  模型或读取私人记忆。源码复核确认Pi ExtensionContext的model与sessionManager
  是带runner活性检查的getter；保留原有模型请求/Tool租约，不替换Pi调用链。
  初次定向typecheck只发现测试的局部ExtensionContext夹具转换缺少unknown桥接，
  已修正，未弱化产品类型。定向typecheck/lint及最终check:source通过：832 files/
  5294 tests passed、6 files/18 tests skipped，232.84s；覆盖率statements/branches/
  functions/lines为84.13/78.23/87.56/87.76%。架构1068 modules/4075 imports/
  0 cycles，结构3199 files；协议revision不变。门禁后只回填本checkpoint。
  仅一个既有会话wrapper、相邻回归及PRODUCT/ADR/协议/计划文档增量；无新依赖/
  数据库/目录/持久状态，HEAD仍ca043bac043697480ef6e2804ad6bf41a28fb79f、ahead 2。
  未打包/预览/安装/签名/部署/commit/push；原生专项本轮未重跑。旧工具和hosted
  搜索保留。下一步仍是canonical文档的独立工具展示/来源合同及真实会话接线，
  不能把本轮已有工具封装加固称为新正文通道已接通；R1–R6保持未完成。

- 2026-09-14 完成内部精确正文读取：Main从当前发布索引及receipt读取指定snapshot/assetId/
  contentRevision的单份canonical正文，私有Host事务重新open/read/close并验证哈希。
  复用read/head/模型观察、四席位及60秒取消生命周期，不启动Python、不调用模型、
  不建正文缓存或新数据库。现场canonical文档与旧Experience/SOP详细结构不同，
  本轮不伪造转换，也不接Pi工具/Renderer或删除旧搜索；真实会话选择绑定和模型
  处理许可仍为下一步。验收当前/旧版/撤销/越界、途中变更、取消和返回边界。
  回滚仅本轮reader/body私有协议/Host事务及回归文档，保留已发布索引、receipt、
  私人资料、旧入口和其他WIP；不部署/安装/签名/付费调用/commit/push。
  协议14/14、真实临时receipt/reader78/78、Main共享查询/读取owner20/20、Host
  生命周期31/31、Host正文事务12/12、receipt client29/29和真实Host类组合1/1
  已通过定向验证。正文读前重新准入当前reader、匹配snapshot，再逐版本重放；
  只暂存选中的canonical字符串，全量重放和最终检查成功前不交付，不使用OV摘要/
  旧job正文。Host与同步页共用canonical hash/结构解析，读取不加载embedding
  settings或调用模型。共享replay注释/权威文档同步说明新消费者仍需独立授权，
  不是存储重放本身授予内容访问。跨进程revision已通过生成器更新为
  0089eeff8ad3cb7f6c8e359afc8cd417561ce16bb3d83733c785c76741daac99。
  OpenViking原生回归4/4通过（14.90s），覆盖既有索引/查询/取消/原件完整性，
  仍是source bootstrap与合成准入；不把它与合成Host body回复拼成安装包联合
  证明。正文通道不是Pi会话选择凭据或模型权限；旧消费者/服务端搜索未切换。
  最终check:source通过：831 files/5279 tests passed、6 files/18 tests skipped，
  234.34s；覆盖率statements/branches/functions/lines为84.12/78.21/87.55/
  87.75%。架构1068 modules/4074 imports/0 cycles；结构3198 files；production
  transport986 files；typecheck/lint/diff通过，knip仅既存electron配置提示。
  门禁期间只同步了replay注释/权威文档，无逻辑输入变更，未重复已过门禁。
  新增一个同目录Host正文事务及相邻回归、一个协议回归，未新增依赖/目录/数据
  库；没有用户可见变更，未预览/打包/签名/安装/部署/commit/push。HEAD保持
  ca043bac043697480ef6e2804ad6bf41a28fb79f，ahead 2，原有WIP保留。
  下一步：将搜索选择和正文读取绑定当前Pi团队会话、保留资产来源并重新校验
  Agent模型处理权，再完成canonical知识的工具展示合同；这些未由本轮内部
  通道证明，不接私人会话、不自动写私人记忆。R1–R6保持未完成。

- 2026-09-14 完成Host内部元数据搜索事务：串接receipt open→Main query prepare→逐请求
  授权embedding→Main query→close事务。共用现有身份/设置/Workspace/电源生命周期，
  四个查询名额覆盖准备、模型工作和清理；先确认索引可用再调用模型，只返回精确
  snapshot及assetId/revision/score，不提供正文处理许可。验收成功次序、错误/晚到/
  取消/关闭失败、模型及snapshot匹配、容量和真实Host组合；旧搜索及Renderer不切换。
  回滚仅本轮Host事务/组合/生命周期重用及对应测试文档，保留Main查询、私人记忆、
  原有WIP及运行包；不签名/安装/付费调用/部署/commit/push。
  已完成事务15、完整查询生命周期24、原embedding生命周期18、receipt client26、
  真实Host类组合1项定向验证（84/84）；统一内部teamKnowledge接口后重跑查询
  生命周期24及Host索引/查询组合各1项（26/26）通过。测试初期的团队/project
  字符串不是合法UUID，被真实receipt client在发送前拒绝；修正合成夹具后回归
  通过，未弱化协议。type-aware lint另发现夹具open结果字段和callback this类型，
  均已修正。首次源码门禁仅在Host入口461/460行结构约束停止；整理成一个有真实
  调用方的teamKnowledge.index/embed/search内部port并同步测试/文档，替代分散
  的Host字段，不提高门禁阈值；复测结构3195 files通过。协议revision不变。
  最终check:source通过：829 files/5219 tests passed、6 files/18 tests skipped，
  239.16s；覆盖率statements/branches/functions/lines为84.10/78.19/87.52/
  87.73%。架构1067 modules/4070 imports/0 cycles；production transport985 files；
  typecheck/lint/diff通过，knip仅既存electron配置提示。协议仍为
  31d3e5071c874b55aa29c7735a229121bed4620d288de41bbf0cc9ed50179238。
  新增两个同目录Host实现及相邻回归文件，分别负责事务次序和共享查询生命周期，
  没有新增依赖或目录。真实Host类组合使用合成Main回复与HTTP响应，未运行真实
  提供商/账号/受管查询包/Electron联合验证；Main原生实现未改，未重复其原生专项。
  没有用户可见变化，未预览/打包/安装/签名/修改VPS/commit/push；HEAD保持
  ca043bac043697480ef6e2804ad6bf41a28fb79f，ahead 2，原有WIP保留。
  下一步：当前命中版本的正文读取与会话来源/模型处理授权，再接产品搜索入口及
  真实运行包联合验收。当前返回的是元数据观察，不能当作正文处理许可；R1–R6未完成。

- 2026-09-14 完成Main一次性查询私有协议：Main从已校验发布清单选定模型，新增receipt私有协议的
  一次性query-prepare/query请求。仅返回opaque queryId、embedding模型和snapshot；
  Host提交有界向量，不能提交目录/程序/资产allowlist。Main绑定原receipt/身份，
  复用受管query runtime、reader副本/版本检查与物理退出；close/失效取消，容量
  直到准备/查询settle才释放。Host客户端的超时/取消关闭该独占receipt句柄。
  本轮验收协议/reader/查询owner/生命周期，接入Main应用composition，不新增
  Renderer搜索入口或自动模型调用。Host完整搜索编排和packaged联合验收后续完成。
  回滚仅本轮协议/reader模型选择/query owner/接线及测试文档增量，保留旧搜索、
  正式索引、既有运行包与其他WIP；不签名/安装/部署/修改生产数据。
  定向协议21、查询owner13、Host客户端26项通过；reader新增模型推导及真实临时
  文件/broker组合后61项通过，既有receipt broker30、publication broker25和
  publication flow7项回归通过。type-aware lint发现表驱动测试数组展开不符合
  预期，改为具名fixture后重新验证21项协议测试，不降低输入校验或规则。
  真实OpenViking原生回归4/4通过（15.95s）：恢复reader、副本FD3查询、取消后
  物理退出/清理和原索引完整性均通过。该原生测试使用source bootstrap与合成
  准入；私有协议组合测试使用真实临时文件和合成native回调，两者不拼成签名包/
  真实账号/付费提供商/Electron端到端证明。本轮未接完整Host搜索事务、正文
  访问和Renderer入口，旧服务端搜索保留，R1–R6仍未完成。
  最终check:source通过：827 files/5180 tests passed、6 files/18 tests skipped，
  243.40s；覆盖率statements/branches/functions/lines为84.08/78.17/87.50/
  87.72%。架构1065 modules/4061 imports/0 cycles；结构3191 files；production
  transport983 files。typecheck、type-aware lint及diff检查通过。私有wire schema
  已通过规范生成器更新protocol revision为
  31d3e5071c874b55aa29c7735a229121bed4620d288de41bbf0cc9ed50179238。
  没有用户可见变更，未重启预览/打包/签名/安装/commit/push/deploy；HEAD仍为
  ca043bac043697480ef6e2804ad6bf41a28fb79f，本地ahead 2。下一步将Host的准备→
  授权embedding→Main查询→关闭串成完整有界事务，再处理正文访问/会话授权和
  产品入口；不能把当前元数据命中结果直接当作获准发送给模型的正文。

- 2026-09-14 完成Host内部查询embedding阶段：查询模型来源、严格单向量响应校验和逐请求
  团队/项目模型授权，接入现有身份/配置/电源/Host生命周期；复用有界HTTPS
  transport，不新增私人通道或extraction调用。请求须匹配调用方持有的索引模型
  endpoint/id/dimension，文本上限8KiB，最多4个在途调用，取消后等底层工作settle
  才释放容量。验收包括拒绝/撤销/晚返回/维度或模型不匹配/配置变化与Host组合测试。
  不接搜索IPC/UI、不调用真实付费提供商、不签署/安装/部署。回滚仅本轮Host
  query helper/组合及transport复用增量，保留既有索引/查询/私人链路及其他WIP。
  定向查询31、生命周期18、真实Host组合1项通过；既有transport31、模型授权8、
  团队生命周期48、Host索引1及head观察19项回归通过。type-aware lint先发现测试
  URL的通用String转换，改为明确string/URL/Request分支；没有弱化规则。首轮
  check:source在结构检查中发现router/host入口越过460行，整理为窄teamKnowledge
  port和统一Host知识组合，保留现有indexTeamKnowledge/observeIndexHead接口；
  结构复测通过，未提高上限或移除行为。最终check:source通过：825 files/5134
  tests passed、6 files/18 tests skipped，237.42s；覆盖率statements/branches/
  functions/lines为84.05/78.14/87.48/87.70%。架构1064 modules/4055 imports/
  0 cycles；结构3188 files；production transport982 files；协议revision保持
  6bfe4d95dd89d48f5c8f296941d9b251c077b6a98f262e304eaaaf816bcd2100。
  typecheck/lint/diff通过，knip仅既存electron配置提示。没有新Renderer/worker
  协议，没有执行Python/native/packaged/真实账号或付费模型验证。真实Host类组合
  使用合成父通道和HTTP响应，不等于Electron打包联合证明。未修改VPS/私人记忆/
  已安装运行包，未commit/push/deploy；HEAD保持ca043bac043697480ef6e2804ad6bf41a28fb79f。
  下一步绑定Main当前reader模型/资产版本与查询IPC，在查询前后重新核对scope/
  receipt/head并限制正文读取和后续模型处理；旧搜索不删除，R1–R6仍未完成。

- 2026-09-13 完成查询运行包准入源码层：为查询增加独立team-query-v1安装身份、固定query/v1
  bootstrap与Main准备/启动前重新验签；沿用签名树及显式安装事务，不修改现有
  private/index-v1树，不创建索引run目录，不启用搜索IPC或模型调用。验收包括
  缺包/错误能力/篡改/有效签名替换/取消拒绝、三版本隔离、复制后复验及源码门禁。
  正式签名/安装、Host query embedding、产品入口与packaged证明不在本轮范围。
  Main application绑定第三个固定目录，缺失不fallback；准备及启动前都重新测量
  签名树，核对物理路径分离与原Python/bootstrap/tree，每次准入30秒取消上限。
  开发prepare工具可显式选择fresh query-only bootstrap，安装命令新增互斥
  --team-query-v1；本轮没有运行实际prepare/sign/install命令，也不修改现有安装。
  查询准入21/21、bootstrap12/12、installer28/28、fresh staging5/5，及原有
  application/installed/index preparation回归通过。完整check:source通过：
  822 files/5084 tests passed，6 files/18 tests skipped，225.56s；覆盖率
  statements/branches/functions/lines为84.03/78.12/87.45/87.68%。架构1062
  modules/4047 imports/0 cycles；结构3183 files；production transport980 files。
  typecheck/lint/diff/脚本语法通过；knip仅既存electron ignoreDependencies提示。
  用内存测试密钥和合成运行文件验证签名/复制事务，不把它和此前source-bootstrap
  native结果拼成正式签名包联合证明；本轮未重跑不受影响的Python/native专项。
  下一步为Host query embedding来源与逐请求模型授权，然后接reader/search IPC、
  正文读取/模型处理及packaged验收；R1–R6保持未完成。未动VPS/私人数据/旧搜索，
  无用户可见变更，未重启预览/打包/commit/push/deploy。HEAD保持
  ca043bac043697480ef6e2804ad6bf41a28fb79f，本地ahead 2。
  回滚仅撤本轮query准入、安装目的及文档增量；保留既有WIP/查询primitive/旧搜索。

- 2026-09-13：完成Main内部一次性原生向量查询与当前资产版本校验。复用已有macOS进程组owner，
  FD3传递有界向量与资产ID/score，不持久化prompt/vector/结果正文，不新增HTTP或
  Main模型请求。reader固定scope/dimension并映射当前receipt版本，查询完成和结果
  交付仍须原授权/完整性复核。查询bootstrap先保留源码与隔离原生证据；不修改已安装
  index-v1签名树，不把repo路径接为产品fallback。受管查询版本验签/安装、Host的
  query embedding模型准入及用户入口保持后续独立接线。已补物理退出不确定分支：
  保留工作副本和reader容量，进程级阻止新查询，不能把cleanup rejection当安全删除。
  原生联测证实OV还索引自动目录记录，底层URI为编码路径；修正为top-k前同时过滤
  Main当前asset IDs和account_id=team-<scopeKey>，命中后再次核对，不能以非空hits
  充当文档检索证据。新增索引存在/维度检查时又发现factory返回公共Collection，
  其公开metadata删除内部Dimension；最终使用get_meta_data().Fields[].Dim，
  未改vendor或删校验。上述原生失败均保留记录，最终复测通过后仅删除本轮合成
  失败夹具A8pa06/WgyqD1/uwaVlQ，不涉及用户数据或安装目录。
  最终Python离线4/4通过；native index/query 4/4通过（16.56s），成功分支包括
  restored reader→副本→实际FD3查询→具体SOP/receipt版本→group退出及取消后
  group不存在、副本清理、原件仍完整。原生进程owner另外4/4通过，含后代清理；
  Node Main/Host仍在测试进程，runtime/read/head/model准入为合成回调，非产品
  Electron/真实账号/提供商/签名安装联合证明。协议22、native query owner18、
  reader55、artifact37、native process owner14项已由定向/最终源码运行覆盖。
  check:source最终通过：821 files/5050 tests passed，6 files/18 tests skipped，
  230.76s；覆盖率statements/branches/functions/lines为84.02/78.12/87.44/87.67%。
  源码门禁不执行Python专项，最终Python修正由上述离线及真实原生复测单独验收。
  架构1061 modules/4042 imports/0 cycles，结构3181 files，production transport
  979 files；typecheck/lint/diff检查通过，knip仍只有既存配置提示。
  后续须先做受管query runtime准入与Host query embedding来源/模型准入，再接
  搜索IPC、正文读取/处理和packaged证明；本轮未完成这些项，R1–R6仍不勾选。
  未签名/安装/打包/commit/push/deploy；HEAD仍为ca043bac043697480ef6e2804ad6bf41a28fb79f，
  ahead 2，保留原有WIP和旧搜索。回滚只撤本轮
  query/reader/worker错误类型及测试合同增量，不回滚其他WIP、旧搜索或正式代际。

- 2026-09-13：完成已获用户确认的Main受控工作副本基础层。复用Main artifact流式
  校验器复制私有独占query-*目录，不使用hard link，复制前后核对原件并校验副本
  内容指纹；reader保持原授权/receipt/head校验和4席位/60秒生命周期。回调必须在
  查询子进程及后代物理退出后才settle，取消通知本身不得触发提前删除或释放席位。
  Main复制/隔离/失败/取消/目录替换拒绝定向回归85/85通过；补齐清理期间取消或
  receipt撤销的最后结果窗口，清理失败必须报错并保留残留，不报告清理成功。
  最终代码原生4/4通过（15.34s）：实际OV在副本中查询命中并改写metadata，
  子进程退出后副本删除，原已发布artifact仍通过Main检查。合成样本1,166,699
  bytes/32 files，准备23ms、查询子进程839ms、收尾34ms；运行时存在源码门禁
  并发，不是代表性性能基准。Desktop typecheck和定向oxlint通过。源码门禁首轮
  通过，但期间补过末尾检查，故固定最终代码再跑一次。最终check:source通过：
  819 files/5003 tests passed、6 files/18 tests skipped，223.86s；覆盖率
  statements/branches/functions/lines为83.99/78.10/87.42/87.65%。架构1059
  modules/4036 imports/0 cycles，结构3175 files，生产transport 977 files；
  knip仅有既存electron ignoreDependencies配置提示，不是门禁失败。
  尚不增加Host/Renderer查询入口或签名bootstrap，
  不调用真实模型或修改VPS。回滚仅本轮artifact/reader及相关测试/合同增量，保留
  正式索引、原搜索与其他WIP。复制预算沿用4096条目/256 MiB单文件/512 MiB总量，
  这不是SDK运行期写盘硬配额；生产进程监督和崩溃残留恢复仍需后续实现与验收。
  后续在此bracket上接查询进程、逐请求模型准入及结果asset/revision检查，再做
  Host/Renderer和packaged联合验收；本轮不宣告R1–R6完成。无用户可见变更，
  未重启预览/打包/安装/签名/commit/push/deploy；HEAD保持
  ca043bac043697480ef6e2804ad6bf41a28fb79f（本地ahead 2），没有改动服务端仓库。

- 2026-09-13：完成查询worker前置原生核验，否定固定OV 0.4.16普通本地
  collection接口可直接原地只读查询已发布代际的假设。
  LocalCollectionAdapter/get_or_create_local_collection会进入PersistCollection；
  PersistentDict初始化调用update并写回metadata，集合还有后台维护及close持久化。
  新增诊断专用probe-team-index-readonly.py，只接受带精确synthetic marker的
  隔离测试临时代际；缺marker时拒绝且原artifact仍通过检查。沿用worker的
  umask 0077，在实际Python 3.12.10/OV 0.4.16上重新打开、固定8维向量查询、
  关闭：命中结果非空，但发生collection_meta.json.tmp写入及collection_meta.json
  身份变化，既有Main assertArtifactCurrent正确拒绝。不输出正文或凭据，
  不对真实profile试开，不改vendor包、生产bootstrap或放宽reader校验。
  最终验证：team-index-worker.native.test.ts 4/4通过（12.26s），Desktop
  typecheck、定向oxlint、结构检查3175 governed files及git diff --check通过。
  本轮仅诊断/测试/合同变更，未重跑全量source gate；不构成packaged Electron、
  Windows、真实模型或生产查询验收。HEAD仍为ca043bac043697480ef6e2804ad6bf41a28fb79f，
  保留既有dirty WIP，未commit/push/deploy或修改运行包签名。
  下一步建议先验证Main管理的有界可丢弃工作副本：SDK只操作副本，已发布代际
  保持完整；须明确复制验证、磁盘/启动延迟预算、取消和清理生命周期。另一选项
  是为固定SDK提供真正只读适配，维护成本不同。该实现取舍待确认，尚未接通
  生产查询或改变旧搜索；不据此宣告R1–R6完成。回滚限本次探针/测试增量及合同
  记录，不改既有索引格式或其他WIP。

- 2026-09-13：完成Main已发布索引的读取准入模块team-index-reader及内部
  broker.openIndexReader入口。绑定现有receipt handle和Main提供的root/models，
  初始独立read授权在四项容量和60秒deadline内、文件读取前完成。核对既有
  profile、私有owner/staging/receipt目录身份、pointer/manifest、receipt
  全链最新有效版本和artifact。复用publication固定格式的有界读取与现有
  流式artifact扫描；binding.project只暴露版本metadata，不向reader交付正文。
  manifest严格绑定schema/scope/generation/snapshot/receiptRecord、模型及
  dimension、完整active asset/revision集合和artifact指纹/counts；重算hash
  但内容不符合合同的manifest仍拒绝。保守要求receipt与发布snapshot完全一致，
  任何追加/upsert/revoke都拒绝旧代，不做部分陈旧索引降级。重型扫描后再次
  Main独立read+current-Host head/model复核，再重读pointer/receipt并重扫字节。
  返回Main-only directory/snapshot/frozen版本metadata/signal/dispose/checker，
  不产生Host路径授权、查询worker、Renderer命令或搜索切换。后续使用时批量
  检查最多100项asset/revision，未知asset（包括缺revision）明确拒绝；检查
  失败锁定取消，不因权限恢复复活。Caller/binding退休和dispose取消；时限
  使用timer+wall/monotonic，不续期。同lease重叠检查拒绝，不排队；四项额度
  包含待准入和成功lease，取消中未结束的reader IO直到settlement才释放名额。
  receipt回放上限10000页/100000版本，当前active最多100；manifest 64KiB，
  artifact沿用4096 entries/512MiB总量等流式上限。这是保守准入与完整性
  观察，不是OS锁、remote push revocation或查询性能证明，不应用于逐token/
  逐hit重复扫描。没有改写/删除索引、修复私人profile或迁移用户目录。
  原定向三文件73项通过；补容量/超时/broker拒绝/receipt父目录symlink及
  未知asset用例后reader自身40项通过。使用真实隔离临时profile、receipt链、
  job/result、文件哈希、原子发布及新binding恢复；索引字节和授权/head均为
  合成夹具。实际Main broker的fresh read/observer/credential失效也有回归；
  不是原生数据库查询、真实模型/VPS、Electron IPC或packaged联合证明。
  新测试callback返回类型经typecheck发现并修正；首轮全量4985项通过，但其
  运行期间补了未知asset guard，因此在最终源码重新跑完整门禁，没有复用旧
  结果充当最终证据。最终check:source exit 0：819 files / 4986 tests passed，
  6 files / 18 tests skipped，224.19s；coverage 83.97/78.09/87.41/87.63。
  architecture 1059 modules / 4036 imports / 0 cycles，structure 3174 files，
  production transport 977 files；全部静态门禁通过，protocol schema未变。
  ADR0002、process contract与CONTRIBUTING同步准入/失效、测试和性能边界。
  HEAD ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP，main本地
  ahead 2；R1–R6未完成。下一步为Main指定已验证代际的只读查询worker、实际
  模型/结果交付权限及版本门禁，再接检索切换与UI，旧搜索继续保留。
  回滚限reader、publication读取复用、binding/broker入口与tests/合同，保留
  所有旧WIP与磁盘代际。无真实密钥/模型、VPS/DB、安装/打包、Windows/native
  新验证、commit/push、部署或分发；历史Memory只读核对private/shared分scope。

- 2026-09-13：完成内部Host index事务的本地publish步骤，保留worker/Main双
  完成证明和早期head观察。早期观察失败不请求发布；通过后仅携带原handle/
  indexId调用publish，Main仍在提交边界重新组合独立read与current-Host复核。
  成功要求published-local回应与wait snapshot的epoch/cursor精确一致，并确认
  cleanup和当前caller/credential/原观察；最终只返回state及snapshot，不授予
  检索权。普通receipt sync/startup不触发索引，尚无Renderer入口或reader。
  从发布请求发出起，丢失/错配回应、错误snapshot、Main明确不确定错误、确认
  发布后的cleanup/lifetime/原观察失效均保留outcome=indeterminate；关闭或
  cleanup自身错误不能改写成未发布/已回滚，不能自动重试。Main精确普通拒绝
  仍为普通失败。早期观察是提前拒绝陈旧结果，不替代Main提交授权。
  定向原Host三文件64项通过；新增回归后Host事务25项及联合流程7项通过。
  联合用例使用实际Host事务、receipt client、Main receipt broker/独立read
  authorization、head client/responder和Host credential controller/Gateway，
  配合合成HTTP、worker/scheduler/artifact/文件提交及真实临时receipt目录。
  证明成功顺序、Main边界read/model/head拒绝、Host观察撤销、提交后错误与
  lost-reply保真；不是Electron跨进程、原生文件提交或真实模型/VPS联合证明。
  测试夹具reservation UUID类型标注经typecheck发现并修正；完整源码门禁通过。
  check:source exit 0：818 files / 4946 tests passed，6 files / 18 tests
  skipped，226.42s；coverage 83.92/78.04/87.37/87.59，静态门禁全部通过。
  architecture 1058 modules / 4026 imports / 0 cycles，structure 3172 files，
  production transport 976 files。协议schema未改变；现有revision校验通过。
  ADR0002、process contract与CONTRIBUTING同步当前流程、错误语义及测试边界。
  HEAD仍ca043bac043697480ef6e2804ad6bf41a28fb79f，main ahead 2，保留全部
  dirty WIP；R1–R6未完成。下一步实现当前权限/receipt allowlist/model/完整性
  约束的本地reader，再切换检索与用户入口；旧搜索保留到端到端cutover验证。
  回滚限Host事务及对应tests/合同，保留磁盘代际和用户数据。本轮无真实凭据/
  付费模型、VPS/DB、安装/打包、原生/packaged/Windows新验证、commit/push或
  分发；历史Memory仅辅助private/shared分scope约定并依当前ADR核对，未写入。

- 2026-09-13：完成Main→当前Host的head/model observation私有通道，并安装到
  Main publisher复核依赖的程序装配代码；不是VPS部署。请求绑定精确Main
  owner/models/snapshot及新read permissionRevision，不发送localProfileId、
  正文、密钥、路径或自授grant。Host在当前credential/config/power lifetime内
  使用既有Gateway重新检查scope、两种模型政策和exact cursor处单页head。
  Main只接受当前ready Host的exact request回应，继续与独立read授权合取，
  不拓宽Main网络例外。成功不是一次性布尔值：Host保留可撤销观察并发送失效
  消息；Main同步checker校验caller/Host及wall/monotonic期限。边界为scope/
  page/credential较早expiry、Main请求起90秒及原index期限，不互相续期。
  Host观察IO 8秒，Main初始等待10秒；两端各限四项，成功观察仍占容量，Host
  已取消但未结束的IO不提前释放槽位。取消、身份、任意Workspace模型通道退休、
  设置、Host替换/exit/poison、power和shutdown不允许复活旧结果。Workspace
  retirement保守撤销所有head观察，因为该请求绑定scope而不携带Workspace。
  Host index编排仍wait→head观察→close；本轮不自动publish或改变检索入口。
  新通道定向四文件81项通过；另补Supervisor ready/dispatch及power/exit/stop
  回归，相关两文件34项通过。证据为同进程实际Main client↔Host responder、
  真实Host credential controller/Gateway配合合成HTTP，以及Supervisor的
  fake UtilityProcess；不是Electron跨进程、真实服务、原生文件发布或检索联合
  证明。首轮门禁仅因新测试夹具URL隐式字符串化lint失败，修正后完整重跑通过。
  check:source exit 0：817 files / 4929 tests passed，6 files / 18 tests
  skipped，226.21s；coverage 83.92/78.03/87.36/87.59，静态门禁全部通过。
  architecture 1058 modules / 4026 imports / 0 cycles，structure 3171 files，
  production transport 976 files。生成并校验protocol revision
  6bfe4d95dd89d48f5c8f296941d9b251c077b6a98f262e304eaaaf816bcd2100。
  ADR0002、process contract与CONTRIBUTING已同步当前接线及验收边界。源码
  ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP，main ahead 2；
  R1–R6仍未完成。下一步接Host自动publish编排与联合生命周期回归，再接授权
  reader/检索和用户入口。回滚仅新观察协议、双端owner、最小装配/转发及
  tests/docs；不改旧WIP/用户数据。无真实凭据/付费模型、VPS/DB、安装、打包、
  commit/push或分发；未重跑原生/packaged/Windows验证。Memory只读1条历史
  private/shared分scope约定并按当前ADR核对，手动写入0。

- 2026-09-13：完成Main结果限时保留及私有publish request/result。wait成功后
  保留精确结果和publication capability，绑定原handle/indexId，不传路径/正文/
  凭据或Host自授grant。publish必须消费成功wait，拒绝提前/跨handle/重复请求。
  原publisher提交回调内重新调用Main既有独立read authorization（8秒取消），
  然后将Main owner/models/verified snapshot与新permissionRevision交给固定
  current-Host observer依赖，只有精确head/model观察成功才能更新handle grant。
  Main明确read拒绝会撤销同scope的既有/正在打开handle；不拓宽Main网络职责。
  生产未安装该observer，收到publish也在filesystem publisher之前拒绝；既有
  Host编排仍wait→head观察→close，不自动publish或改变搜索入口。
  所有registered settled任务从Main任务完成（含verification）起保留90秒，
  包括未读成功/失败结果；wait/publish不续期。timer+wall/monotonic检查覆盖
  延迟timer和时钟变化。关闭/身份/配置/Host失效及取消撤销原signal，清除引用/
  timer/listener；发布IO未结束仍占四项容量，settlement前不释放。失败wait或
  publication尝试一次性消费结果，保留磁盘旧代/候选，不增加文件清理。
  成功只回published-local及committed epoch/cursor。PUB不确定错误使用独立
  PUBLICATION_INDETERMINATE，仅publish响应可用，即使身份失效也不改写成
  STALE_HANDLE。Host publish等待100秒但不延长Main期限；超时/取消/关闭/错配
  回应会关闭exact handle，lost-reply异常携带outcome=indeterminate，迟到回包
  不能复活，不重试且不声称已回滚。Main授权取消仍沿用既有late-response观察。
  定向四文件88项通过；之后补充Host不确定响应保真一项。最终完整门禁中四个
  核心文件89项（Main publication 25、原broker 30、Host client 20、协议14）
  全通过，覆盖容量、取消中IO、deadline、fresh denial及新permissionRevision、
  observer缺失、乱序/伪造、rename后结果与身份失效竞态。使用真实临时credential
  binding/receipt目录，但scheduler/publisher/授权/head为合成夹具；不是实际
  文件原子提交或真实服务端/Electron跨进程联合验证。本轮不重跑原生/packaged。
  check:source exit 0：814 files / 4863 tests passed，6 files / 18 tests
  skipped，223.90s；coverage 83.86/77.98/87.35/87.55，所有静态门禁通过。
  architecture 1056 modules / 4022 imports / 0 cycles，structure 3166 files，
  production transport 974 files。生成并校验protocol revision
  aa900e1c7f0b9ec09a3cd4c4ad6cd65c3e2254ddb0bb8d55ccbd87af354e0052。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；R1–R6未完成。
  下一步接current-Host精确head/model observer及publish编排，再做授权reader/
  检索切换和用户入口。回滚限协议、Main broker、Host client、tests/docs，保留
  旧WIP和全部用户数据。无真实凭据/付费模型、VPS/DB、commit/push、安装、打包
  或外部分发操作。

- 2026-09-13：完成Main内部POSIX索引publication操作，不添加Host/Renderer请求
  或自动调用。只从已验证job闭包创建一次性发布能力，构造无IO；逐文件/目录
  bottom-up刷盘并复核原索引，写exclusive publication.json（64KiB上限），
  绑定精确snapshot/models/documents/fingerprint。临时pointer刷盘后必须经
  Main组合的最新read授权及Host精确scope/model/head复核callback；再检查
  artifact/snapshot/storage、manifest/temp pointer及原pointer身份，最后
  atomic rename current-index.json（2KiB上限），目录fsync、读回与有效性复查。
  callback不等于Host可提交的grant；生产组合及跨进程publication ticket未接。
  原索引不复制/移动，已发布代保留staging/run-*；指针引用后不再是可清理临时
  目录。旧代、失败留下的orphan metadata/temp均保留，不自动清理/修复。现有
  指针/manifest损坏、cursor倒退或epoch变化拒绝；同epoch同cursor重建可替换。
  epoch恢复与retention另待实现；读者仍需实时权限/allowlist及完整性检查。
  限同canonical owner单次在途、全局四项，无队列；每capability只接受一次尝试。
  90秒取消预算与原job/caller及每scan60秒边界组合，scan接收operation signal；
  不强制打断不协作callback/fsync，容量保留至IO收尾。rename前失败报本次
  not-published；rename开始后任何异常报indeterminate，不假称回滚/自动重试。
  Windows发布明确拒绝；不是跨进程文件锁、remote head锁或持久权限grant。
  publication定向26项通过，覆盖真实临时FS刷盘/替换、同cursor重建、旧代保留、
  输入快照、取消/拒绝/失效、文件/指针漂移、同owner及四项并发、rename失败和
  rename后取消/过期/目录fsync失败。job/artifact/Main broker定向92项亦通过，
  最终全部改动另经完整门禁。首次完整门禁发现未用Error类export，已收回模块内，
  未放宽Knip或其他门禁；保留其现有electron ignoreDependencies配置提示。
  原生合成index复用test-installation-rVt9TE/runtime/bin/python3.12，四项全过
  （12.22s）。成功分支真实OV输出完成文件刷盘、发布、指针读回；各项確認进程组
  已退出后清理临时数据。签名准入/reservation/授权/head/model为夹具，Main/Host
  在Node测试进程；不等于生产签名包、Electron产品入口、真实Provider、Windows
  或macOS14最低系统验证。没有启用真实用户索引或移除旧搜索。
  最终check:source exit 0：813 files / 4833 tests passed，6 files / 18 tests
  skipped，222.34s；coverage 83.83/77.95/87.34/87.54，所有静态门禁通过。
  architecture 1056 modules / 4022 imports / 0 cycles，structure 3165 files，
  production transport 974 files。protocol未变。源码ca043bac043697480ef6e2804ad6bf41a28fb79f
  加保留dirty WIP；R1–R6未完成。下一步保留Main结果、组合commit复核并接私有
  publish协议，再做reader/检索切换和用户入口；published-local本身不授权搜索。
  回滚限新增publisher、job/artifact集成及tests/docs；保留旧WIP和全部用户数据。
  无私人profile/真实凭据、付费模型、VPS/DB、安装/打包、commit/push或外部分发。

- 2026-09-13：完成Main索引产物文件树验证。在确切worker物理完成及版本回执
  匹配后，对固定index目录执行内容/文件身份捕获及第二次完整复核，再返回结果。
  POSIX要求owned/private目录及非执行的single-link普通文件；拒绝软/硬链接、
  特殊文件、缺失/空/零字节树及不安全名字。目录流式枚举、文件64KiB读取，固定
  4096 entries / 32 child levels / 单文件256MiB / 总512MiB；每次scan 60秒
  取消预算，仍受原owner/read grant限制，不是性能容量承诺或强制中断文件IO。
  Main仅持有冻结content fingerprint/counts、捕获的无凭据model选择和再次检查
  能力；复核纳入文件/目录inode/dev/mode/owner/link/size/纳秒mtime/ctime及
  原receipt snapshot。Main scheduler保留该结果，Host协议不新增字段或路径。
  这是变更检测而非durable/不可篡改封存；不证明数据库语义，不抵御恶意同UID
  进程，不修改/移动/删除产物，不添加active pointer。Host wait/close后仍没有
  publication ticket；后续须保留精确结果并在Main提交边界重新核验授权/head。
  定向四文件121项通过：artifact 28、job 34、scheduler 29、Main broker 30。
  类型检查发现旧broker夹具缺少新增字段，已补齐；没有放宽合同/断言/门禁。
  使用既有test-installation-rVt9TE/runtime/bin/python3.12实际运行native index
  四项全部通过（15.20s）：成功/拒绝/取消/revision mismatch；成功输出通过
  新文件树捕获及再次校验，各项确认进程组已不存在后清理合成临时目录。Main/Host
  仍在Node测试进程，签名准入/reservation/授权/模型响应为夹具，不是生产签名包、
  真实Provider、Electron三进程产品入口、macOS14最低版本或Windows证明。
  最终check:source exit 0：812 files / 4807 tests passed，6 files / 18 tests
  skipped，228.36s；coverage 83.81/77.92/87.34/87.51。静态门禁全部通过，
  architecture 1055 modules / 4015 imports / 0 cycles，structure 3163 files，
  production transport 973 files。全量的native skip与上述独立native pass分开。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；R1–R6未完成。
  下一步是Main原子发布、current pointer与检索切换，再接用户入口；旧搜索保留。
  回滚限产物验证模块、job集成、测试夹具/原生断言及docs，保留全部旧WIP和数据。
  无私人profile/真实凭据、付费模型、VPS/DB、commit/push、安装、打包或发布操作。

- 2026-09-13：完成索引结束后的发布前置复核。Main wait附带实际已验证snapshot
  的非空epoch/正decimal cursor，严格拒绝缺失/越界/额外字段；不是open时的旧
  进度，不传路径/正文/权限grant。Host必须等worker与Main双完成，再取得当前
  scope及embedding/extraction政策授权，以同一捕获scope/model和Main返回cursor
  调用既有sync endpoint（limit=1）。响应必须同epoch、无changes/hasMore且
  next/head均等于已索引cursor；有效新撤销页也拒绝，不追加receipt或自动重建。
  两项请求共用8秒取消budget；复核覆盖caller/身份/power/配置失效，仍由既有
  Gateway约束HTTP流，不能强制打断不协作IO。结果还受授权及page lease的墙钟/
  monotonic与receipt-time上限约束，跨专用handle关闭后再次检查，过期不能成功。
  定向五文件124项通过（head 18、编排15、企业生命周期48、协议13、Main broker
  30），覆盖team/project、大cursor、快照捕获、真实Gateway合成响应、模型拒绝、
  新撤销/epoch/权限变更、迟到/取消、清理期间过期，以及open cursor 1与实际
  verified cursor 7的完整Host编排。初轮测试Mock函数/构造器泛型及URL字符串化
  在typecheck/lint被发现并修正；无产品门禁或断言覆盖放宽。
  最终check:source exit 0：811 files / 4773 tests passed，6 files / 18 tests
  skipped，223.37s；coverage 83.79/77.90/87.33/87.49。静态门禁全部通过；
  architecture 1054 modules / 4010 imports / 0 cycles，structure 3161 files，
  production transport 972 files。协议revision为
  9831b3ef12ea47e9c697aa2d00b2b2267704c56e9a4e1942165e717e9a5deea1。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；R1–R6未完成。
  本轮只是瞬时post-index观察，不是远端stream锁、atomic publication、active
  pointer、可搜索证明或真实服务端/原生/packaged/Windows验收。下一步仍需索引
  文件封存和Main发布提交边界的本地snapshot/artifact/当前权限与head复核，再接
  原子指针、检索切换及用户入口；不能删除旧搜索路径或暴露verified-unpublished。
  回滚限本轮协议、Main wait元数据、Host复核/编排/tests/docs，保留其他WIP。
  无真实凭据/模型调用、数据迁移、VPS/DB、commit/push、发布、安装或打包操作。

- 2026-09-13：完成Main加密设置到当前ready Host的按需私有read/result/cancel/
  invalidate协议与生产内部组合，不添加Renderer命令或第二份凭据文件。Main
  broker只接收UUID，不接收路径/设置/正文；严格校验团队模型快照，只有当前
  ready、bootstrap完成、非休眠/poison/stopping的Host能收到设置。提取模型只传
  Pi选择，凭据仍在Host经Pi解析，不在Main复制或调用模型。
  两端各限四项读取；Main 5秒取消、Host 8秒等待并发送exact request取消；
  Main容量保留至原IO收尾，迟到/重启/关闭/取消不回传旧密钥，重复ID不发矛盾结果。
  有效save先入队写入，再同步淘汰旧设置signal，监听者读取排在写入之后；即便
  后续持久化失败也取消旧任务，但保留旧文件。非法输入不改变generation。
  Main取消团队worker/receipt资源并通知Host；Host索引owner从首个await之前
  捕获设置signal，覆盖配置、授权、准备、运行和清理。私人runtime不因此重启，
  仍下次启动应用配置；不监听外部手工编辑加密文件，后续读取仍验证文件。
  新增host-team-index组合模块接通store client→Pi source→既有indexKnowledge，
  AgentHostServer只暴露内部indexTeamKnowledge，sync和Renderer没有自动入口。
  定向八文件111项通过；包含真实临时加密store与双端broker/client，以及真实Pi
  合成配置+Host owner的授权中取消。结构整理后三文件11项通过（与前组部分重叠）。
  初步lint发现监听函数this声明缺失；结构门禁发现两份装配文件超460行，已将
  Main options移到现有contract、索引组合独立、Host初始身份构造移到现有loader，
  保留原身份缓存/环境优先级；随后清除搬移后未用import/export，无门禁放宽。
  最终check:source exit 0：810 files / 4750 tests passed，6 files / 18 tests
  skipped，226.36s；coverage 83.77/77.89/87.32/87.48。全部静态门禁通过；
  architecture 1053 modules / 4007 imports / 0 cycles，structure 3159 files，
  production transport 971 files。新协议加入canonical revision材料并生成
  b8babc491c0b323f846e222a04fac7ef14c0bdc32c11cc94a56217a5e96bdf09。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；R1–R6未完成。
  不是Electron/Python原生、真实用户配置/模型、packaged或Windows证明。
  下一步：verified-unpublished结果的live head/model policy复核、原子发布和
  检索切换，再接用户操作入口；禁止将当前未发布结果或同步完成视为可搜索。
  回滚限本轮协议、store signal、双端broker/client/组合接线、上述等价结构整理
  和tests/docs，保留原有WIP和全部用户数据。无持久格式迁移、真实凭据读取、
  付费模型、VPS/DB/commit/push/发布/安装或打包操作。

- 2026-09-13：完成Host内部受控模型source与精确HTTPS transport。source捕获
  显式embedding设置及Pi extraction选择，沿用Pi resolver；不读取真实凭据。
  只给团队job收紧HTTPS/model ID/dimension，不改private设置合同；拒绝当前
  memory adapter无法保留的OAuth/subscription/custom execution/header要求。
  凭据只在Host闭包中，返回metadata和Main job不带key。解析设15秒取消期限，
  不把该期限误用为后续模型调用的lifetime，不强行中断不协作Pi IO。
  indexKnowledge增加内部loadModels入口，在已登录credential准入之后解析，
  纳入现有四项容量/取消生命周期；解析完成后仍须精确模型政策准入，方可准备。
  每帧保持原企业guard；transport只向捕获base URL下的embeddings或
  chat/completions发POST，不带cookies，不跟重定向、不隐式重试/换模型。
  实际响应流读取限2MiB，不信Content-Length；非JSON成功响应被拒绝，错误
  body不读取/转发，异常脱敏。取消中止fetch/reader，不证明远端停止已收到请求。
  定向四文件104项通过（source 15、transport 31、企业生命周期46、原编排12），
  包含真实Host guard+source+transport配合合成HTTP响应的逐帧撤权测试。
  首轮修正Uint8Array/Buffer夹具断言及exact optional字段；完整门禁首轮发现
  两处unbound method lint，已用this:void与spy引用修复，没有放宽门禁。
  最终check:source exit 0：806 files / 4710 tests passed，6 files / 18 tests
  skipped，223.13s；coverage 83.73/77.86/87.27/87.45。静态门禁全部通过；
  architecture 1049 modules / 3982 imports / 0 cycles，structure 3151 files，
  production transport 967 files。protocol未改，revision仍为
  780dd00812cdb73fa743a3277bbce0ce4ab8103b91ecb94f90cc44932eb41256。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP。该证据仅为
  source/合成Pi配置/HTTP流，不是已安装runtime、实际模型、packaged或Windows证明。
  下一步：Main加密设置到Host的私有generation绑定桥及设置失效接线，再组合
  production source、用户入口和live head/model policy发布/检索切换。R1–R6未完成。
  回滚仅本轮Host source/transport/controller/tests及文档增量，保留其他WIP。
  不改持久格式/private runtime，不执行commit/push/deploy/DB/付费模型或安装。

- 2026-09-13：实现Host内部indexKnowledge owner的scope/model捕获、初始模型
  政策准入及open→prepare→reserve→register→start/wait→close编排。新增邻接
  shared-knowledge-index.ts与测试，承担显式索引事务，不是另一Agent loop或
  工作流脚手架。初始8秒授权检查所选embedding/extraction政策；重型准备后才
  经既有企业guard预留worker通道，同一捕获scope/model贯穿job与逐帧授权。
  不新增Provider adapter、不解析真实凭据、不接Renderer命令或用户按钮。
  Host最多四项含准备/清理的运行，480秒取消budget不延长既有Main/worker期限，
  也不强行中断不协作IO。配置/重绑定/身份/调用者/power/shutdown失效覆盖
  reservation之前的准备阶段；同步仍不调用索引，取消或失败不自动重试。
  Main wait在请求spawn前开始，和worker完成并行观察，任一失败立即取消；
  提前Main失败也会等待已发出的迟到startup收尾。成功必须同时取得worker
  completed与Main verified-unpublished，关闭专用handle并复核当前生命周期；
  不能将EOF、启动ACK或矛盾完成状态当成功。Host丢失后的物理清理由Main继续
  负责，不从一次失败或取消响应推断清理成功，不自动删除已登记staging。
  定向四文件80项通过，后增scope/model捕获回归，最终两文件49项通过（12项
  编排、37项企业模型生命周期，包含旧回归）；覆盖顺序、取消、初始拒绝、容量、
  错误/迟到/矛盾结果、登记失败及close ACK丢失。首轮测试的UUID字面量与参数化
  key类型被拓宽，已修正夹具类型，无门禁放宽；故意延迟的配置读取全部收尾。
  最终check:source exit 0：804 files / 4655 tests passed，6 files / 18 tests
  skipped，226.54s；coverage 83.70/77.82/87.26/87.43。全部静态门禁通过；
  architecture 1047 modules / 3975 imports / 0 cycles，structure 3147 files。
  protocol未改，revision仍为780dd00812cdb73fa743a3277bbce0ce4ab8103b91ecb94f90cc44932eb41256。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；R1–R6未完成。
  授权响应、Main结果和worker启动为合成夹具，部分生命周期使用真实Host receipt
  client/admission；不是实际Electron/Python联合、模型费用、packaged或Windows证明。
  下一步为受控模型配置/凭据读取与精确Provider transport，冻结模型配置来源并
  保留逐次授权，再接用户入口及live head/model policy发布与检索切换。
  回滚限本轮Host owner/controller/tests/docs，保留private数据、runtime、VPS及
  其他WIP。本轮无commit/push/deploy/DB/真实模型/生产签名/安装/打包操作。

- 2026-09-13：补Host→Main索引prepare/register/cancel/wait内部请求，复用当前
  receipt handle的Main身份与读权限，不从Host接收路径/本地身份/权限/凭据/正文。
  model选择仅允许有界HTTPS endpoint/id与4–4096且为4倍数的dimension，和既有
  native job合同一致；Main固定100页/100资产预算。准备完成后以一次性indexId
  绑定worker reservation；sync仍只下载，不触发模型。Main应用依赖接入既有
  indexJobs和独立teamPreparation，尚非用户入口或真实Provider编排。
  Host准备等待70秒，不占用模型reservation；登记后wait最多400秒，仍须通过
  worker自己的各阶段期限与物理清理，不延长模型权限。Host取消/超时/关闭/响应
  操作不匹配时关闭专用handle，取消Main任务；同handle拒绝重复准备，最多四项，
  取消后仍持有容量至底层准备/物理完成。Main登记ACK不表示已索引，wait绑定
  exact scheduler完成和输出验证；错误返回脱敏INDEX_FAILED，已完成错误结果
  保留至读取/关闭，避免被静默遗忘。成功仅为verified-unpublished，不发布或检索。
  定向request/receipt/sync五文件78项通过；scheduler/worker/lifecycle五文件
  119项通过（含部分重叠broker测试，不累加为独立总数）。覆盖跨handle、重复、
  迟到、四项容量、身份/读权限失效、取消、登记失败及成功/失败结果单次消费。
  类型验证发现回放callback修改epoch被返回值推断为仅null，补明确的
  ProjectionSnapshot返回合同，运行行为未改；修正测试scope夹具及两处lint
  问题（回调this边界、可选Promise聚合），未放宽门禁或测试期限。
  最终check:source exit 0：803 files / 4634 tests passed，6 files / 18 tests
  skipped，220.25s；coverage 83.69/77.80/87.28/87.42。全部静态门禁通过；
  architecture 1046 modules / 3969 imports / 0 cycles，structure 3145 files。
  protocol revision为780dd00812cdb73fa743a3277bbce0ce4ab8103b91ecb94f90cc44932eb41256。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；R1–R6未完成。
  回归使用真实临时receipt目录和合成调度完成/授权，不是本轮真实Electron/Python
  联合请求、实际用户入口、模型调用、生产签名运行包、packaged或目标平台验收。
  下一步为Host索引owner的模型配置/逐次授权/内部请求编排，再接用户入口及
  live head/model policy发布检查和检索切换；现有团队搜索继续保留。
  回滚限本轮protocol及revision、receipt broker/client/credential owner、Main
  接线、projection返回类型与tests/docs；保留私人数据、runtime及其他WIP。
  本轮无commit/push/deploy/VPS/DB/真实模型/生产签名/安装/打包或目录新增删除。

- 2026-09-13：产品入口核对确认sync仅下载receipt，不应隐式变成模型消费；发现
  application原先仍将team preparation指向私人固定安装目录。本轮完成既定runtime
  revision前置：新增固定team-index-v1并行安装目标、签名树内v1 bootstrap验收，
  application团队准备及启动前复验显式独立，缺失即失败，无private/Lab/artifacts
  fallback；私人路径/数据/settings不重定向。低层factory保留省略team root时的
  调用方单目录组合兼容，production始终显式传两个独立目录，拒绝重叠。CLI仅增加
  --team-index-v1显式选项，默认及设置UI仍针对私人版本。双版本分别加锁、拒绝覆盖，
  复制前后验证签名树和固定bootstrap；两个完整副本有额外磁盘成本，不共享可变树。
  定向4 files / 61 tests passed、1平台条件skip；覆盖并存/缺少或篡改bootstrap/
  有效签名下的错误文件类型与权限/复制后复验/取消清理/版本锁隔离。独立准备回归
  验证private树被破坏不影响已选team复验、team篡改则拒绝，且不解析模型或改profile；
  相反方向验证team缺失仍用原private Python。新增private测试首轮错把native参数
  断言为runtimeRoot，已按实际python实路径接口修正，未修改产品接口或放宽门禁。
  最终check:source exit 0：803 files / 4609 tests passed，6 files / 18 tests
  skipped，228.42s；coverage 83.67/77.76/87.27/87.40。typecheck/lint/protocol/
  knip/references/transport/workflow等静态门禁通过；architecture 1046 modules /
  3967 imports / 0 cycles，structure 3145 files。安装CLI bundle构建及JS语法检查通过。
  以上为真实临时文件系统+内存测试签名+合成运行文件，非实际新运行包安装/启动、
  生产签名、packaged、最低macOS或Windows证据。源码仍为
  ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP，R1–R6未完成。
  下一步接产品index请求/reservation，再做live head/model policy发布校验与检索
  切换；正式签名/分发/实际安装单独验收，替代链路通过前保留现有团队检索。
  本轮无用户机器安装、生产签名、模型调用、commit/push/deploy/VPS/DB/打包操作。
  回滚限installer/assembly/CLI与tests/docs；保留旧runtime、私人数据及其他WIP。

- 2026-09-13：将worker握手拆为不可接收模型端口的有界准备阶段与
  验签后的5秒port/start阶段。完整signed-tree验证仍紧邻spawn，不提前缓存准入，
  不放宽既有普通port的5秒期限；worker准备上限60秒，Host另保留5秒dispatch余量。
  Main只对已有exact permit运行preflight，prepared状态不表示spawn或索引完成。
  两种reservation共享4项总上限及credential/caller/power/config/rebind生命周期；
  提前端口、重复/迟到prepared、未prepared就started、未连接就completed均拒绝。
  started但端口未准入时必须主动cancel Main，不能只等待EOF；旧测试夹具未在stop
  时reject connected，首轮missing-port用例超时，已按真实admission语义修正夹具，
  未放宽测试超时或产品门禁。Main/Host/port对关键阶段额外检查单调时钟期限，
  即使timer callback延迟也不能恢复过期任务。协议revision已生成并通过一致性门禁：
  e2f413e0c03d1e81a98e88afa9d0b17b45a17d396bdffa0c0a398e12357159fc，
  同时绑定prepared状态和60秒/5秒时序常量，不静默兼容旧单阶段协议。
  定向5 files / 110 tests通过；后续加入Host迟到状态两项，最终Host 19项与native
  index 4项联合23项通过。native index四场景11.194s，经实际receipt/writer/
  scheduler/permit/Python/result，仍是Node内Main/Host与合成授权，非生产索引入口。
  三进程verify:team-worker:native通过：Main、真实utility Host、固定Python分别运行，
  Main preflight在临时内存测试公钥下重新完整验证实际runtime；success刻意加入
  6秒可取消延迟，实测preflight 13339ms仍正常进入prepared→port→started。
  success/deny/cancel/Host exit均通过，确认Python进程组不存在、utility退出后才清理
  本次独占临时目录。这是超过旧5秒窗口的时序压力证明，不是p50/p95性能基准；
  bootstrap/授权/模型仍为探针夹具，非生产签名、真实Provider、最低macOS或Windows证明。
  最终check:source exit 0：803 files / 4596 tests passed，6 files / 18 tests
  skipped，222.02s；coverage 83.66/77.75/87.26/87.40及全部静态门禁通过。
  architecture 1046 modules / 3966 imports / 0 cycles；structure 3145 files。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP，R1–R6未完成。
  内部worker启动时序风险已处理；下一步是产品索引请求/reservation接线、独立runtime
  revision升级、实时发布校验及检索切换，不重复以内部握手探针充当产品入口验收。
  回滚限worker协议及revision、Host admission/client/controller、Main supervisor、
  对应tests/probes/docs，保留其他WIP、runtime和用户数据。本轮不启用产品自动索引
  或调用真实模型，无commit/push/deploy/VPS/数据库/安装/生产签名/打包操作。

- 2026-09-13：在既有Main worker supervisor内接入indexJobs调度owner，
  有界四任务、exact owner去重、准备/ready期限、binding retirement即时取消，以及
  准备到物理完成全过程的失效/shutdown接线。permit前只清理原input/空run；登记后
  保守保留staging，未证实清理阻断新准备。索引permit在spawn前重新验签并拒绝换树，
  检查当前snapshot/grant/Host。无spawn的准入拒绝与实际native containment失败分开；
  native清理失败即使同时收到cancel也只能报告failed，不能伪装物理取消成功。
  定向scheduler 29项、supervisor 14项通过，覆盖重复、取消、迟到、关闭等待、
  异常清理和选择快照；准备测试额外验证原树成功、取消、未签名篡改，以及重新
  有效签名的不同树仍拒绝；credential生命周期验证在store/clear持久化前同步abort。
  native改经真实scheduler→Main permit→Python→Main result，最终4项通过
  （10.911s），各项确认process group不存在。runtime admission、Host reservation、
  relay attachment和grant/model response为夹具，Main/Host仍在Node测试进程；
  不等于产品入口、Electron三进程联合、生产签名包、真实Provider或索引发布证明。
  初轮native改造出现satisfies换行解析错误，lint另指出finally抛错及可选worker
  闭包类型；已修正语法、将cleanup改为显式成功/失败续接并捕获确定pid，无门禁放宽。
  最终check:source exit 0：803 files / 4568 tests passed，6 files / 18 tests
  skipped，223.11s；coverage 83.64/77.72/87.26/87.39及全部静态门禁通过。
  architecture为1046 modules / 3966 imports / 0 cycles，structure为3145 files。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；R1–R6未完成。
  另对既有artifacts/openviking-native/test-installation-rVt9TE/runtime执行单次
  只读runtimeTreeIdentity：54345 files / 641306289 bytes / 3999ms，tree SHA-256
  739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36。
  这是缓存条件未控制的单样本，不是签名bootstrap联合、p50/p95或release性能证明。
  当前5秒Host reservation/start窗口余量偏小：正式握手接线前必须验证/调整重型
  准入与短时reservation的先后关系，不以缓存信任或直接放宽门禁掩盖耗时风险。
  尚未交付生产reservation握手、自动索引、live head发布/检索切换或runtime升级。
  下一步优先收口上述握手/启动时序，再接实时发布校验与独立runtime revision。
  回滚限scheduler/supervisor/binding lifetime、installed准备复核及相应tests/docs，
  不删除runtime/私人数据/旧WIP。无commit/push/deploy/VPS/DB/模型调用/签名/打包操作。

- 2026-09-13：Main新增writeIndexJob，receipt binding提供受退休状态约束的scoped
  materialize，不暴露底层store。owner key必须匹配；每次异步交付前后检查caller
  lifetime、prepared identity与独立assertReadable，不采用历史page lease作授权。
  最新active正文逐项写入独占0600 job.json，保留100资产/正文2MiB/序列化整体8MiB
  边界，不在内存汇总整个正文快照；模型字段快照不序列化多余凭据。未达到captured
  local head或empty/all-revoked明确失败，不截断、不创建可检索空索引。
  失败只删除原inode的input文件；assertStorage允许取消后的身份校验清理，不授予
  内容读取/模型权限，替换文件或目录保留并报错。index/result及非空目录不自动删除。
  job handle只接受该worker的Main physical completion，之后以no-follow/nonblocking
  有界32KiB读取result，拒绝软链接/FIFO/异常大小/额外字段/错误scope/缺失、重复或
  错误资产版本；读取前后复核grant、身份及local receipt record，单次接受，仅返回
  冻结snapshot/version metadata。发布仍需实时server head/政策/世代及atomic swap。
  定向3 files / 58 tests passed，1项不适用平台用例跳过；覆盖撤销、退休、取消、
  预算、文件替换及完成状态伪成功。native已改为真实receipt→Main writer→Python
  vector indexing→Main result验证，4项通过（11.673s），各项确认process group
  不存在；Main/Host位于Node测试进程，read grant与model response为合成，无真实
  service/Provider/Electron三进程/签名包/生产发布证明。首轮aggregate在Knip指出
  POSIX FIFO回归的系统mkfifo尚未登记；已精确补充binary声明及开发文档，无规则
  放宽或npm依赖变更。最终check:source exit 0：802 files / 4537 tests passed，
  6 files / 18 tests skipped，222.53s，静态及coverage（83.60/77.70/87.24/87.36）
  通过。aggregate条件跳过与上述4项显式native证明分开，不提升为Windows/最低OS验收。
  源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；R1–R6未完成。
  下步是应用index owner、实时发布校验/读路径切换及独立运行包revision升级，不因
  本轮局部交付成功自动启用团队模型或推进searchable cursor。回滚只限本轮job、
  binding/prepared/assembly接线及对应tests/docs，保留receipt、runtime和其他WIP。
  无commit/push/deploy/VPS/生产DB/真实模型/签名/打包操作；测试索引仅在独占临时目录。

- 2026-09-13：新增正式用途team_index_worker.py及固定v1 runtime bootstrap定位。
  developer preparation仅向新runtime staging复制worker/transport/channel三文件后
  测量签名树，不改已安装包；prepareIndexWorker要求三文件完整并基于新验签结果，
  缺失/不安全即拒绝并回收空run。旧private runtime路径/安装名保持不变，生产升级
  revision、签名分发和安装事务仍待完成，不能同名覆盖旧包以“启用”团队索引。
  worker只读独占scope目录job.json：严格schema、100个唯一资产、正文2MiB/整体
  8MiB及逐正文SHA-256；禁止路径、凭据、任意OV配置，先完整验证再建index目录。
  直接初始化固定OV core/local RAGFS/VectorDB，无HTTP server；关闭私人提取、
  自动会话提交及watch。只执行vectors_only，所有embedding仍通过FD3→Host当前
  授权；Python审计阻止connect/bind/DNS回退，不声称native OS网络沙箱。
  完整向量状态、storage close、result.json fsync后持有FD3直至原子exit，未发布
  receipt只含scopeKey与资产版本，不授予权限/可检索游标。取消/拒绝不得采用残留。
  原生首轮暴露config不支持embedding.dense.max_retries，随后确认本地VectorDB
  维度合同为4..4096且4的倍数（模型adapter的2维夹具不代表存储兼容）。修正配置、
  前置维度校验及8维存储夹具；拒绝用例补必须实际进入授权的断言，旧失败样本不计PASS。
  最终Python输入边界9项通过；定向4 files / 31 tests passed，1项平台用例跳过。
  最终native单独复验4项通过（10.973s），真实合成SOP写入/向量处理、授权拒绝、
  取消及hash拒绝，各项确认group不存在。Main/Host在Node测试进程，Python独立；
  非Electron三进程、签名包联合证明、真实Provider或产品检索/索引发布验收。
  最终check:source exit 0，静态门禁及coverage通过（83.57/77.65/87.23/87.33）；
  aggregate默认跳过显式Python native用例，独立原生证据如上，不混称平台验收。
  R1–R6保持未完成。下步接Main受授权job materializer、
  result与snapshot复核及index publication owner，再设计运行包revision升级。
  验证源码ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP；回滚仅本轮
  worker/bootstrap/prepare复制与组合、对应tests/docs；不触碰既有runtime或私人数据。
  无commit/push/deploy/VPS/DB/真实模型/生产签名/打包操作。

- 2026-09-13：完成Main团队worker启动前的runtime/staging准备能力，尚不生成生产
  launch许可。私人service与团队prepare共用manifest/tree/interpreter验签入口，
  无信任缓存；receipt与projection复用原v1 owner key，原receipt目录不迁移。
  installed/application assembly暴露teamPreparation，构造仍无IO、不解析模型。
  prepare只读校验已建立的私人profile，缺失/不匹配/不安全均拒绝，不创建、采用或
  chmod修复私人身份。独占0700空run位于team-projections/<owner-key>/staging，
  与private data/settings/runtime分开；拒绝软链接、非当前用户或非user-only目录，
  复核目录inode/dev。owner key包括本机profile、规范服务、用户、团队及team/project。
  60秒准备期限、caller lifetime及assertCurrent复核；后者不是runtime/权限租约。
  discard仅删除原始空run，非空或被替换时保留并报错，父namespace空目录允许保留。
  后续正式index owner须负责bootstrap/runtime临近spawn再准入、当前授权及非空
  staging的物理退出后清理；产品尚未调用prepare、注册许可或执行团队ingestion。
  定向6 files / 59 tests passed，1项非macOS目标拒绝测试在本机条件跳过；覆盖
  签名/内容篡改、身份只读、取消、并发owner隔离、目录替换/软链接及保守清理。
  三进程Electron探针以临时内存测试密钥签署实际runtime树，经新准备入口后使用
  独占cwd串联Main、utility Host、Python；success/deny/cancel/Host exit全部通过，
  各项确认进程组不存在、utility退出及空run回收。运行包未改写；不等于生产签名
  bootstrap、产品entrypoint、实际模型/索引、最低macOS或Windows验收。
  类型检查、结构、Knip通过；lint发现未绑定方法签名，已补this:void，不改变行为。
  最终check:source exit 0：800 files / 4501 tests passed，5 files / 14 tests
  skipped，221.67s；静态门禁与coverage（83.56/77.65/87.22/87.33）通过。
  14项为既有13项条件跳过加本机不适用的unsupported-target拒绝用例，不代表
  Windows或最低macOS已验证。R1–R6保持未完成；下一步为正式受管bootstrap与
  index owner接线，不以prepare成功推进可检索游标或隐式启动真实团队模型。
  源码为ca043bac043697480ef6e2804ad6bf41a28fb79f加原dirty WIP；回滚限本轮
  admission/owner抽取、prepare、只读profile reader、assembly及对应测试/探针/文档，
  不改私人数据、运行包或其他WIP。无commit/push/deploy/VPS/DB/真实模型操作。

- 2026-09-13：新增Host→Main启动/取消与Main→Host状态协议，仅携带reservation UUID
  和固定状态，不接受路径、参数、scope、模型或凭据。Main内部先登记exact Host的
  一次性许可，拷贝已验证启动配置，最多4项pending/running、许可5秒、运行5分钟。
  无许可不spawn，重复start取消旧运行；startup/port connected与物理完成分离。
  completed/cancelled只在root/pipes/group确认退出后报告；Host端口EOF不能冒充完成。
  Main supervisor shutdown等待worker物理completion；低层启动/清理拒绝保持可观察
  并阻断该supervisor的新许可。restart/power/poison/Host退出同步取消pending/active。
  Host client、server shutdown与parent消息分流已接线；没有Renderer入口或目录清理。
  使用独立Main/utility探针与固定Python将三进程实际串联，真实OV embedding经Host
  合成grant与model response返回；success/deny/cancel/Host exit均通过且native进程组
  确认不存在。不是产品Host entrypoint、真实Provider、团队ingestion/index或签名包证明。
  正式Main staging owner尚未准备runtime/bootstrap/目录许可，因此产品不会自动启动
  团队worker；后续须先完成签名/隔离准备，再进入短时reservation/许可交换。
  修正Host字段初始化与测试UUID类型后，定向5 files / 64 tests通过；全包typecheck、
  lint、architecture、structure、knip通过。最终三进程native复验4场景通过，确认
  所有本次Python进程组不存在，utility退出后清理独占临时目录。
  最终check:source exit 0：799 files / 4484 tests passed，5 files / 13 tests skipped，
  222.88s；静态及coverage（83.55/77.63/87.21/87.31）通过。源码为
  ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP，未提交。原生联合
  探针与aggregate条件跳过的旧native/live条目分开记录，R1–R6保持未完成。
  新增文件留在现有protocol/context/
  desktop/capabilities目录；回滚本轮broker/owner/protocol/probes/docs，不动私人
  数据、运行包和其他WIP。无VPS/DB/真实模型/commit/push/deploy/package操作。

- 2026-09-13：接入Main supervisor专用端口移交owner与Host server/index专用分流，
  不增加Renderer命令。严格UUID单次reservation、4项pending/active总上限与5秒等待；
  未登记/多端口/畸形/迟到端口关闭，duplicate还退休旧entry。Enterprise controller
  先复制scope/models并捕获credential/power/caller lifetime，config/rebind/login/
  shutdown清理pending，再由既有逐请求guard执行模型授权。Main锁定exact ready Host
  且等待credential bootstrap；restart立即清除readiness，stop/poison/power/exit
  退休旧通道，避免kill等待窗口继续准入。协议metadata纳入revision并已生成。
  独立Electron Main→utilityProcess探针通过双向180KB合成数据、owner取消、Host
  退出和未登记拒绝；使用独占临时userData并确认子进程退出后清理。它不是产品Host
  entrypoint/Python/真实模型的联合端到端证明。新增模块位于现有protocol/context/
  desktop/capabilities职责目录，无新目录；保留其他WIP，没有扩大结构门禁。
  监督器定向12项、准入10项、授权生命周期22项通过。首轮源码检查指出探针未登记
  工程入口，已按现有方式加入verify:team-model-port:native与两个精确Knip entry，
  未放宽检查。Electron 43.2.0独立探针最终复验通过。最终check:source exit 0：
  797 files / 4463 tests passed，5 files / 13 tests skipped，228.96s；静态及coverage
  （83.51/77.60/87.18/87.28）通过。源码为ca043bac043697480ef6e2804ad6bf41a28fb79f
  加保留dirty WIP，未提交；13项条件跳过与本轮独立Electron证明分开记录。
  产品worker启动owner、reservation到启动请求的编排、受管签名bootstrap、实际
  provider/index仍未启用。下一步接这些真实调用方；R1–R6不标完成。
  回滚仅撤销本轮端口准入/监督器接线、协议revision、探针及文档，不动私人数据/
  运行包和其他WIP。本轮无VPS/DB/commit/push/deploy/package操作。

- 2026-09-13：新增 Main/Host 专用模型 MessagePort 中继与 Host Duplex adapter。
  每方向最多一个未ACK块、严格递增sequence、3MiB+4字节块上限、10秒接纳期限，
  拷贝字节并拒绝SharedArrayBuffer/多余字段；native暂停读取及Host读取缓冲背压
  传播到ACK。错误/关闭/取消退休通道，不重连、不接受报文身份、不授予模型权利。
  Main仅中继，Host继续逐请求按当前身份/政策授权。真实Node MessageChannel已串入
  pinned Python原生探针；success/deny/cancel/descendant 4项通过（9.45s）。
  此处Main adapter与Host controller仍同一Node测试进程；未验证Electron父通道
  转移/生命周期准入、正式team bootstrap/签名包、应用startup、提供商或索引发布。
  中继定向2 files / 20 tests通过（含真实双向分块、Host读取背压、关闭/取消）。
  修正两处测试Promise回调类型后，最终check:source exit 0：795 files / 4435 tests
  passed，5 files / 13 tests skipped，213.95s；静态门禁与coverage通过
  （83.47/77.57/87.16/87.26）。原生4项显式运行通过，aggregate默认跳过，不混称。
  验证源码为ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP，未提交。
  R1–R6保持未完成。下一步是Electron父通道绑定与应用owner。
  回滚仅撤销本轮relay/adapters及对应tests/docs，不动私人运行包、数据和既有WIP；
  无真实模型/VPS/DB/commit/push/deploy/package操作。

- 2026-09-12：新增 Main 低层 native-team-model-worker adapter，不复用私人启动器。
  macOS14+ arm64独立process group、固定正数PGID、裁剪env、FD3模型通道；调用方
  必须提供已准入runtime与app bootstrap，不接Renderer输入、不自行验签/创建目录。
  关闭通道、取消、启动失败、root exit 均收口relay和进程组；completion必须等root/
  pipes退出及group不存在。观察到root已为Z但Node尚未处理exit时group signal返回
  EPERM；单项提权测试曾通过，但完整复验仍失败，因此撤回仅归因sandbox的假设。
  实现改为有界等待root reaping再检查/清理group，持续EPERM仍失败；只保留去敏
  stage/errno，不输出native日志、参数或凭据。初步14项单元与4项真实native通过，
  后者实际覆盖真实OV embedding经Host授权、拒绝、取消及root退出后的/bin/sleep
  后代清理。独占临时cwd下最终4项native复验通过（10.54s），每项成功确认group
  不存在后删除自身临时目录。最终check:source exit 0，793 files / 4415 tests
  passed，5 files / 13 tests skipped，227.87s，静态/coverage全部通过。新增native
  4项在aggregate默认跳过，已在前述显式运行实际通过，不混淆两层证据。
  当前仍为ca043bac043697480ef6e2804ad6bf41a28fb79f加保留dirty WIP。
  当前只有独立探针调用Main adapter，Host controller与Main adapter在同一测试进程；
  不是Electron Main↔Host relay、正式team bootstrap/签名包、应用startup、索引或
  Windows证明。下一步仍需父通道中继和应用owner；本轮未启用产品团队进程。
  回滚仅撤销本轮adapter/probe/tests/docs，不动私人运行包/数据及其他WIP。
  无真实模型/VPS/DB/commit/push/deploy/package操作。

- 2026-09-12：将 team model channel 接入现有 EnterpriseAuthorizationController，
  不新增 Renderer route。最多4个通道，user/service 从当前凭据绑定，逐请求重新读取
  配置/凭据并获取精确team/project grant；凭据替换/clear开始即退休旧lifetime，
  仅已确认持久化的新凭据可创建新lifetime。登录重启/logout/shutdown、凭据到期、
  bootstrap、power suspend/resume 主动取消；Workspace rebind仅取消对应workspace。
  配置保存终态（含写入后回读失败）退休所有团队通道。caller取消不改变登录或其他
  通道；老channel不能被新凭据复活。Main独立worker启动/FD relay、实际provider与
  index owner 尚未接入；未复用私人进程，未改变Main网络例外。
  16项生命周期与2项credential回归通过，native三项改走真实enterprise controller，
  success/deny/shutdown取消均通过（13.95s），仍是合成凭据/授权/模型响应。
  初次回归发现显式stop后active slot等待close事件才释放，改为stop同步移除后通过。
  为保持既有460行门禁，将candidate evidence校验移至既有enterprise method合同模块，
  mutation record类型归入既有command types模块；行为与错误保持不变，未抬高门禁。
  check:source exit 0：791 files / 4399 tests passed，4 files / 9 tests skipped，
  235.72s，coverage通过。该轮开始后补的配置finally退休与2项配置终态测试未全部
  纳入该次全量发现；最终单独复验配置终态/command router共8项通过，全仓typecheck
  通过后再修测试bound method，最终Host typecheck、全仓lint/structure/diff-check通过。
  不把新增2项合并虚报成同次全量结果。native仍为另行显式通过的3项，不是aggregate
  skipped证明。回滚仅撤销本轮生命周期接线/类型归位，保留上一轮native channel及
  其他WIP。不操作VPS/DB/真实用户记忆，
  无commit/push/deploy/package。下一步仍需Main独立worker及relay接入。

- 2026-09-12：新增 dedicated native team model FD channel 与 strict protocol schema，
  Python exchange 接上 Host runSharedMemoryModelRequest；单请求在途、3MiB frame/
  2MiB body、canonical base64、UTF-8、exact endpoint/model、禁止 native identity、
  redirect/stream/pipeline，半包按首字节固定5秒关闭。Python lock/IO 有总预算，
  async取消 shutdown 唤醒线程；owner abort/EOF/拒绝/畸形输入退休整个通道。
  11项 wire 回归与8项既有 model guard 回归通过，全仓 typecheck/协议版本检查通过。
  已以固定 Python 3.12.10 / OV 0.4.16 子进程验证 Node Host guard ↔ Python ↔
  真实 embedder/VLM 同步/异步调用：success/deny/cancel 共3项通过；模型响应与
  service授权为合成数据；补半包deadline与严格UTF-8后3项 native 复验通过（13.79s）。
  首次lint发现native测试URL union字符串化警告，已按类型明确取URL修复。
  随后完整 check:source exit 0：静态门禁、覆盖率通过，790 files / 4383 tests
  passed，4 files / 9 tests skipped，234.43s；其中新native 3项为默认不启用的
  显式测试，已在前述独立命令实际通过，不能把aggregate跳过当作原生验证。
  源码基线仍为 ca043bac043697480ef6e2804ad6bf41a28fb79f 加保留的dirty WIP。
  未接 application team worker owner/Main relay、真实 provider、索引发布或运行包；
  不改私人进程/签名树，不调用 VPS/DB/真实模型，无 commit/push/deploy/package。
  回滚仅移除本段新 channel/probe/schema 与 export，保留既有 guard/transport 和其他 WIP。

- 2026-09-12：补原生 team_model_transport.py（未安装进运行包），以模块局部
  OpenAI constructor facade 给固定 OpenViking embedder/VLM 注入同步/异步
  HTTPX transport；仅允许绑定 purpose/HTTPS endpoint/model 的 POST，2MiB
  请求/响应上限，禁 redirect/stream/不支持的额外客户端配置。SDK 自身重试为0，
  OV 后端每次重试仍经过 exchange；不含 socket、真实凭据或直接 HTTP fallback。
  使用 team-broker-only 占位凭据，不转发 SDK headers；provider 错误正文与 broker
  异常去敏，仅保留状态。该 facade 仅供未来独立 team worker，不能在私人服务
  进程全局替换 openai，也不自动安装/更改签名树。CONTRIBUTING 记录显式测试入口。
  7 项 Python 原生离线回归通过，入口强制 Python 3.12.10 / OpenViking 0.4.16：
  真实 embedder/VLM 同步和异步调用、真实 VLM 同步/异步503重试再次经过 exchange、
  取消传播、错 route/model、额外配置/大小限制、错误去敏。响应为合成数据，未
  启动 OV server 或真实模型。尚未实现 native IPC exchange → Host guard、团队
  worker 启动/生命周期隔离、全部允许后端约束、运行包集成或 packaged proof；
  所以这里只证明这两个固定后端的 transport 接口，不宣称完整团队链路已接通。
  对上一轮失败的测试阶段按固定 2 workers 完整复验：789 files / 4372 tests
  passed，3 files / 6 tests skipped，206.79s，coverage 通过。默认并发那次失败
  根因未确定，仍保留原记录。Python 最终回归后 structure/diff-check 通过；
  未重复输入未变的 TS 静态门禁。无用户记忆/VPS/DB/commit/push/deploy/package。

- 2026-09-12：用户确认继续采用“本地 OpenViking 适配层 + Host 逐次授权团队
  模型请求”，ADR 记录该方向，未扩大 Main 的网络例外。核对本地固定运行包
  OpenAI embedder/VLM 源码：存在独立同步/异步客户端及后端重试，后续原生适配
  必须覆盖这些入口，不能只做启动授权。本轮 parseScopeAuthorization 增加
  purpose-specific assertModel（agent/extraction/embedding），原 assertAgentModel
  转调用同一检查，保留已有行为。新增 Host runSharedMemoryModelRequest，每次
  调用重新请求精确 team/project grant，固定所选 endpoint/model，调用前后校验；
  组合 owner signal 与 lease deadline，取消/超期拒绝迟到结果。即便 transport
  忽略取消，也结束调用方等待并观察迟到 rejection；不据此声称远端计算已停止。
  scope/model 必须来自可信 indexing owner，signal 随身份/政策/Host 生命周期退休；
  每次 retry 必须重新进入，不缓存 grant、不 fallback。新原语仍未接原生 IPC/
  provider adapter，故不是运行时索引切流或逐请求 native proof。补 8 项回归并
  更新受影响 grant 测试夹具的形状（未弱化旧断言）；受影响测试与 Host typecheck
  通过。完整 check 的静态门禁通过，测试阶段 4368 passed / 6 skipped / 4 failed：
  失败分布于 worktree-git-runner、worktree-startup-reconcile-service、
  worktree-submodule-hooks 三个未修改文件。随后按固定 2 workers 仅复验这三文件，
  25/25 通过（15.62s）；未改变用例、实现或超时。尚未确定全量失败根因，不能将
  定向复验提升为 aggregate PASS；本轮完整门禁为 PARTIAL。无真实凭据/模型调用、
  私人记忆或 VPS/数据库操作，未 commit/push/deploy/package。下一步仍是原生
  IPC/provider adapter 接线和隔离 native 验证，不据本轮 Host guard 宣称完成。

- 2026-09-12：在既有 projection-stage 中补 materializeSharedKnowledgeProjection，
  先完整验证/构造 manifest，再逐页回放只把最新 upsert 的 canonicalContent
  交给 caller-owned unpublished staging；历史旧版本和最终 revoked 资产不转发。
  复用同一历史 page decoder；正文不汇总进数组，不写新持久状态。每页及 sink
  await 前后核对 receiptRecord，接收快照变化、sink 错误或取消均拒绝成功返回，
  caller 必须丢弃全部部分产物。结束后再次核对 replay snapshot 和版本覆盖。
  此校验不提供原子发布权：返回后仍可能有新事件，运行时 owner 仍须在发布/
  检索时独立检查实时权限、head、撤销与 index generation。历史 lease 不是授权。
  现有 managed connection 明确限定 private-localProfileId，未将其复用为团队
  连接。本轮未接 OpenViking ingestion、模型调用、active-index swap 或搜索切流，
  只补齐受限正文 materialization 原语。4 项新增回归覆盖最新版本/撤销过滤、
  sink 中并发 revoke、异常/取消、全清单验证先于正文处理；合计 13 项 projection
  与 21 项 receipt 测试通过，Desktop typecheck、定向 lint、diff-check 通过。
  完整 check 通过：788 files / 4364 tests passed，3 files / 6 tests skipped，
  76.01s；此为源码门禁，不是 packaged/native 或模型/索引实测。仅临时合成测试，
  无真实记忆/VPS/DB/commit/push/deploy。回退仅本轮 materialization 函数与回归，
  保留上一阶段 manifest 与全部 receipt 数据。

- 2026-09-12：新增 Main shared-knowledge-projection-stage，从现有 receipt store
  的固定快照按提交顺序回放，重新验证 wire page、可信 team/project scope、
  content hash、epoch、连续 cursor 与不回退 head。按 assetId 保留最新版本标识
  或 revoke tombstone，不保留正文。历史 permissionRevision 可变化，只用于
  历史格式验证，历史 lease 不产生权限。输出冻结且仅为 unpublished manifest，
  标明 receiptRecord、receipt cursor 和最后捕获的 head；不暴露 searchable 状态。
  maxPages 沿 receipt replay 上限，maxAssets 最多 100000（包含 tombstone）；
  超限、取消、损坏均拒绝整个结果，无持久写入、模型请求、授权刷新或索引切换。
  当前仅完成并测试重建原语，尚未连接运行时索引 owner/搜索入口，不能视作
  R4 或本地检索切流完成。后续 owner 必须独立绑定本地 profile/service/user、
  校验实时权限/模型策略/当前 head，完成 indexing 后才可发布；旧 hosted search
  仍不删除。9 项新增测试与 21 项 receipt 测试通过，Desktop typecheck、定向 lint、
  dead-code 和 structure 通过；随后完整 corepack pnpm run check 通过（exit 0），
  diff-check 通过。测试只用临时合成数据；未启动真实 OpenViking、未操作私人
  记忆/VPS/数据库，未执行 commit/push/deploy/package。回退仅移除本轮新增
  staging 原语及回归测试，不改动或删除既存 receipt 数据。

- 2026-09-12：补充 renderer-shared-knowledge-sync.spec.ts 三项交互回归，使用现有
  Playwright Renderer 框架、合成账户和模拟 Host，不访问 VPS 或用户真实配置。
  实际 Chromium 验证精确 team/project payload、app scope、未绑定项目禁用、
  pending 禁止重复、取消后重试、业务失败后恢复、切换页签卸载后的新请求。
  发现 SharedKnowledgeSyncSettings 外层 status 与 SettingsNotice 自带 status
  重复，移除外层区域并复用原有状态语义；不改变产品行为或设计 token。
  初始 fixture 缺 total、epoch 非 UUID、错误码 INTERNAL_ERROR 不在协议枚举，
  均修正为现有合同，未放宽产品校验。最终三项 E2E 通过（9.0s），Renderer
  typecheck、测试工程 typecheck、两项组件静态测试、定向 oxlint 与 diff-check
  通过；仅局部语义修复，本轮未重跑完整 check，不沿用前轮全量作为当前证明。
  design-craft L1-F/normal/main_serial；DESIGN/SettingsNotice 为权威与同族基线。
  Chromium 自动回归不是 browser67 人工视觉验收，也不是 packaged Electron；
  双主题/焦点视觉与隔离配置打包验证仍 INCOMPLETE。现有 native memory smoke
  仅覆盖本地模型配置，不能替代本轮共享同步，未运行或宣称其通过。测试进程
  与专用 5199 服务由 runner 结束；未执行真实账户/记忆/VPS/DB/commit/push/deploy。

- 2026-09-12：在 Desktop 团队经验设置接入显式团队/当前绑定项目同步按钮，
  仅登录、已选择团队且配置已保存时显示；未绑定项目禁用项目同步。独立组件
  阻止重复请求，提供取消与 polite 状态提示，身份/范围/草稿变化或离开时取消。
  成功仅表示本地接收页，不代表索引就绪，也不上传私人记忆。同步调用沿既有
  enterprise.knowledge.sync 协议进入 Host/Main，不新增 Renderer 网络路径。
  PRODUCT/DESIGN 同步记录合同。design-craft 路由 L1-F/normal、main_serial，
  复用既有 SettingsRow/secondary-button，无新设计 token。Renderer typecheck、
  两项静态渲染测试与最终 corepack pnpm run check 通过（exit 0）；不以静态测试
  代替交互验收。browser67 独立 localhost fixture 挂载后为空，真实页面验证
  INCOMPLETE，未点击真实账户同步。未运行默认 unsigned preview：其启动路径
  使用日常用户配置，与本轮不触碰真实记忆的边界冲突；packaged/native、双主题
  及取消/错误交互仍未验证。无 VPS/数据库操作、commit/push/deploy。
  下一步先补隔离配置下的真实 UI/打包验证，再推进本地投影到检索索引的接线；
  不据此宣称 R4 或架构整体完成。回退仅移除本轮 UI 入口/调用，不删除接收数据。

- 2026-09-12：修复显式sync命令仍使用通用15秒ACK且未接请求取消的问题。
  AgentPortClient仅对enterprise.knowledge.sync使用75秒默认ACK（60秒run+8秒
  close+余量），其他命令/override规则不变。HostRequestRouter把现有request
  AbortSignal经server/app dispatcher/context router传到authorization owner，
  组合进入sync transport；取消一项不退休login或影响后续run。新增ACK边界和
  caller取消后再次同步回归，扩展router信号传递断言，定向10tests通过。
  首次测试误用不存在client.close已移除；结构门禁发现server多1行，合并同一
  options初始化行，未放宽门禁。随后corepack pnpm run check通过：786files/
  4349tests通过，3files/6tests跳过。此为协议内部deadline/信号接线，无schema
  变更；未做真实UI/网络/OS验证或VPS/DB/真实记忆/commit/push/deploy/package。
  UI按钮、自动调度、索引检索仍待接。回退仅本轮超时特例和signal传递，不删数据。

- 2026-09-12：新增正式app command enterprise.knowledge.sync（teamId、可选
  projectId/maxPages），经Host dispatcher/router/EnterpriseContextController进入
  authorization owner并实际调用syncSharedKnowledge；默认10页、最多100页，同时
  最多4run，60秒run deadline加有界close cleanup。使用active credential，login
  begin/disconnect/shutdown主动abort；组合power/client取消。仅返回收包progress/
  pages/headCursor，无正文/凭据/模型权限；无自动重试/检索fallback。新增协议2项
  与Host入口3项测试（路由、实际client回复关联+模拟Gateway、并发容量/关闭取消）
  通过；生成protocol revision为6010198e5f1109a095a70243aef1cd8d0b374e1ae959fd6857e474991da98520。
  全量首次structure发现router多1行，仅移除空行，未改门禁；随后corepack pnpm
  run check通过：786files/4347tests通过，3files/6tests跳过。HEAD ca043bac，
  git diff --check通过。此为显式命令生产入口，未新增UI按钮/自动调度/本地索引
  或检索切换，未调用真实服务。无VPS/DB/真实记忆/commit/push/deploy/package。
  回退命令定义/路由及owner方法并重新生成revision，不删除已收数据。

- 2026-09-12：EnterprisePowerEpoch增加每代AbortSignal，既有Main parent电源消息
  transition主动abort旧代；suspend新signal保持aborted，resume仅新代可用。
  syncSharedKnowledge捕获该power fence并组合caller/client/power取消信号，
  使stalled transport主动结束，休眠期不鉴权，恢复必须新run并重新鉴权；不新增
  OS listener或scheduler，不取消caller/client本身，也不回滚已开始Main写入。
  新增power signal与stalled sync/wake回归，定向3files/67tests通过；agent-host
  typecheck、定向Oxlint通过。同Host局部生命周期改动未重跑全量coverage，未做
  真实OS休眠/唤醒测试。Host生产调用调度及索引检索仍待接；无VPS/DB/真实记忆/
  commit/push/deploy/package。回退本轮power signal与sync组合，不删除持久数据。

- 2026-09-12：修复Host receipt client退休只关闭IPC、未取消同步网络请求的缺口。
  client暴露稳定lifetime AbortSignal，shutdown同步abort；syncSharedKnowledge
  将其与caller signal组合，覆盖授权、拉页、收包，不反向取消caller；close仍独立，
  退休client发不出close时依赖Main generation清理。新增退休期间stalled transport
  和预退休不发请求回归，并扩展真实client shutdown信号断言。定向3files/26tests、
  agent-host typecheck、定向Oxlint通过；同Host局部取消修复未重跑全量coverage。
  未接Host自动同步调度/原生power取消订阅或索引检索；无VPS/DB/真实记忆/
  commit/push/deploy/package。回退仅本轮lifetime signal组合与文档，不删除数据。

- 2026-09-12：修复Main收到新授权明确拒绝后同scope旧句柄仍可使用的问题。
  HTTP401/403返回absent grant，broker退休精确user/service/team/project既有
  handles并标记当前pending opens；迟到成功或FS读完成不能重新开句柄，其他scope
  不受影响。transport/timeout仍拒绝新open但不提前退休既有有效lease，保留网络
  故障合同。pending fence沿用16操作上限，settle即清除；后续新请求必须重新鉴权。
  新增并发迟到/其他scope隔离与网络失败回归，并扩展HTTPS组合测试断言旧handle
  STALE_HANDLE。定向22tests、desktop typecheck/lint通过；corepack pnpm run check
  通过：784files/4338tests通过，3files/6tests跳过。HEAD ca043bac，diff check通过。
  本轮为已接授权路径的安全修复，未新增Host生产同步调度，索引检索仍待接；无
  VPS/DB/真实记忆/commit/push/deploy/package。回退仅本轮授权拒绝传播逻辑及文档。

- 2026-09-12：用户明确批准Main仅做独立只读权限HTTPS核验，修订ADR/架构中的
  Host-only网络约束。新增authorizeSharedKnowledge，从Main secure store加载并
  匹配用户/endpoint及credential expiry，GET精确team/project authorization；
  HTTPS-only、禁止redirect/refresh/retry/fallback，stream最多128KiB，沿用broker
  8秒timeout及失效取消；scope/role/revision和wall/monotonic五分钟lease验证，
  receipt grant不消费modelPolicy、不授予模型权限。main.ts实际配置broker，通过
  supervisor传入Main身份owner；支持平台启动时加载stable profile，独立receipts
  目录，不启动OV或发送网络。profile损坏仅脱敏警告并禁用收包，不阻塞整个应用。
  新增授权8tests及真实broker/临时FS+合成fetch组合1test；定向20tests通过。
  首次typecheck发现fetch mock的空参数tuple，修正后corepack pnpm run check
  通过：784files/4336tests通过，3files/6tests跳过。HEAD ca043bac；git diff --check
  通过。未请求真实服务或触碰VPS/DB/真实记忆/commit/push/deploy/package；真实
  OS/在线授权尚未验证，Host调用调度、索引/检索切换仍未完成。回退Main getter及
  profile配置即可恢复默认拒绝，保留收包数据；不删既有文件或回退其他dirty WIP。

- 2026-09-12：Main SharedKnowledgeReceiptBroker授权依赖支持异步结果及AbortSignal，
  固定8秒deadline；invalidate取消等待，超时/迟到provider不占据pending slot，
  授权返回后在任何FS读取前复查身份与broker generation。provider即使忽略取消，
  迟到resolve/reject也被观察且不打开句柄；实际网络provider仍必须实现自身资源
  取消，Promise race不能强制终止其网络。新增3个测试，broker共11tests通过；
  首次lint发现测试Promise.all包含可选返回，修正Promise.resolve后定向lint及
  corepack pnpm run check通过：783files/4327tests通过，3files/6tests跳过。
  这只是实际远程鉴权所需异步接缝，不是已接通真实授权：Main provider、应用
  入口/调度与索引检索仍未配置。HEAD ca043bac，保留既有WIP；未操作VPS/DB/
  真实记忆/commit/push/deploy/package。回退本轮broker异步改动和文档即可。

- 2026-09-12：新增Host syncSharedKnowledge收包编排入口，显式team/project授权后
  open，串行拉页、保持原始UTF-8/BOM、等待Main append ACK并匹配epoch/cursor后
  才推进；每次运行预算1–100页，无重试/续租/索引或模型调用。异步前后校验
  cancellation、owner身份/power fence和grant。close不继承已取消signal，仍由
  receipt client超时约束；清理失败不覆盖原失败，原路径成功时清理失败阻止成功。
  10项编排测试通过，覆盖连续ACK翻页、Main拒绝、落盘失败、取消、身份切换、
  授权过期、ACK不匹配、页预算和清理。首次全量lint发现unsafe-finally及unbound
  method，已改为显式成功/失败清理路径；随后corepack pnpm run check通过，
  783files/4324tests通过，3files/6tests跳过。HEAD仍ca043bac，git diff --check通过。
  当前gateway/receipt编排测试使用替身，不代表真实端到端：生产调度与Main独立
  授权processor仍未配置，索引/检索切换待接。未操作VPS/数据库/真实记忆/
  commit/push/deploy/package。回退仅撤销本轮新编排入口和对应文档，不动已有收包。

- 2026-09-12：Host syncKnowledge改为返回validated page与独立持有的exact wire
  bytes，保留BOM/空白/原始timestamp表达；禁止用解析对象重新序列化为receipt。
  reader在异步读取前复制expectation，仍限制2MiB并在校验/取消失败时不返回数据；
  返回buffer裁到实际长度，不让小页面长期持有2MiB预分配。定向3files/36tests
  通过（transport新增3个回归），agent-host typecheck、定向Oxlint、架构和目录门禁通过。
  本轮仅同Host模块内部返回合同调整，未重跑全量coverage；真实Main授权processor、
  Host同步编排及索引切换仍未接，不代表端到端同步已启用。HEAD仍ca043bac，
  保留既有dirty WIP；未操作VPS/数据库/真实记忆/commit/push/deploy/package。

- 2026-09-12：Main actual private dispatcher通过EnterpriseCredentialSupervisor接入
  receipt请求识别，options可提供Main-owned processor；无身份NOT_SIGNED_IN、
  无processor SCOPE_DENIED，未配置时不落盘/放行。credential/Host invalidate
  同时通知processor；await期间generation改变回STALE_HANDLE，异常仅回脱敏
  PERSISTENCE_FAILED。复用exact-current-Host回复guard，不向替换Host交付旧结果。
  定向27tests先通过，另补actual AgentHostSupervisor fallback分发测试；desktop
  typecheck/定向lint通过，corepack pnpm run check通过：782files/4311tests通过，
  3files/6tests跳过。未配置真实授权processor，Main授权桥
  和同步编排仍待接；无真实网络/记忆/VPS/数据库/commit/push/deploy/packaged操作。

- 2026-09-12：Host index实际parent消息入口接receipt回复分发，shutdown立即关闭
  credential broker。credential owner在bootstrap/成功store后创建身份client，
  store/clear开始前退休旧client；generation阻止旧保存/清除晚到覆盖新身份，
  shutdown后bootstrap不复活client。store请求先复制身份，失败不恢复旧client。
  旧generation回复不交给新client，Main身份/Host失效为最终清理所有者。
  创建client不发送任何同步请求，Main dispatcher/真实授权桥与同步编排仍未完成。
  定向4files/23tests通过（新生命周期5、client9、旧credential2、refresh7），
  agent-host typecheck通过；corepack pnpm run check通过，781files/4305tests通过，
  3files/6tests跳过。无真实网络/记忆/VPS/数据库/commit/
  push/deploy/packaged或Windows操作。

- 2026-09-12：新增未接Host parent-port dispatcher的SharedKnowledgeReceiptClient，
  复制身份/请求scope，精确匹配requestId与回复operation；open核对Main返回的
  userId/endpoint，错身份拒绝并best-effort close。默认8秒timeout、取消/shutdown、
  16pending和128abandoned-open上限；迟到open成功只用于清理，不重新完成旧请求。
  无回复持续积累时停止接纳open，Main generation invalidation仍是最终清理者；
  取消不承诺回滚Main已开始的落盘。无自动retry/fallback或权限grant。
  client9+Main broker8+protocol11共28tests通过，agent-host typecheck、定向lint、
  架构/结构检查通过。本轮未运行全量门禁；真实parent-port接线、账号变化shutdown、
  授权桥与同步编排仍未完成。未操作网络/VPS/数据库/真实记忆/commit/push/deploy。

- 2026-09-12：核对server源码已有team/project两类authorization路由，team响应按
  （本轮结束HEAD已由并行工作推进至ca043bac043697480ef6e2804ad6bf41a28fb79f，
  本任务未commit或回退该变化。）
  serde合同省略projectId。Desktop Gateway此前只有authorizeProject，本轮新增
  authorizeTeam，使用既有认证/取消/timeout/redirect:error传输与同一租约及模型
  政策parser；team显式期望projectId缺席，拒绝项目响应、null/undefined字段伪装，
  不做跨scope fallback。scope parser21+gateway15共36tests通过，agent-host
  typecheck/定向lint/架构/结构通过。实际Main授权桥和生产receipt IPC仍未接。
  仅源码对照和mock fetch，未请求真实server、未修改server、未运行本轮全量门禁，
  无真实记忆/数据库/VPS/commit/push/deploy/packaged操作。

- 2026-09-12：接线前发现并修复heartbeat虚报进度：旧Main receiver对无变化页面
  直接返回metadata，caller可自报一致但领先磁盘的cursor。现在heartbeat也read并
  核验磁盘cursor/epoch，拒绝超前/倒退/epoch替换；匹配时返回existing receipt，
  不append或授予权限。receiver11+broker8共19tests通过，另在broker原回归里
  加入ahead-of-disk heartbeat INVALID_PAGE断言；desktop typecheck/定向lint通过。
  未接真实授权或生产IPC，未运行本轮全量coverage；无真实记忆/网络/VPS/数据库/
  commit/push/deploy/packaged操作。

- 2026-09-12：新增未接生产dispatcher的Main SharedKnowledgeReceiptBroker，实现
  open/append/close临时handle及typed失败。必需注入Main-owned verified scope grant，
  没有默认授权；open读取游标前后验grant，append核对permissionRevision且落盘前后
  验有效性，identity generation/close/invalidate竞态拒绝成功回复。factory新增
  非敏感identity和isCurrent，不持有token。队列16/handle128上限，open清理过期或
  retired条目，pending open遇broker invalidate不产生可用handle。
  定向broker8+credential lifecycle8通过，desktop typecheck通过。聚合门禁静态项
  通过，coverage汇总因默认coverage/.tmp/coverage-7.json缺失失败；现场另有并行
  test:coverage进程，未停止或清理其输出。改用独占/tmp/new-money-receipt-coverage.zpTDau
  重跑同一全量coverage（不修改threshold）：779files/4284tests通过、3files/6tests
  跳过，coverage通过；结果单独记录，不称原check通过。
  测试使用真实临时receipt文件和注入授权替身，不能证明真实成员权限。授权来源、
  parent-port分发、broker失效接线、Host消费者仍待实现，无网络/VPS/数据库/真实
  记忆目录/commit/push/deploy/packaged操作。

- 2026-09-12：新增private receipt IPC消息合同open/append/close与typed metadata/
  redacted error回复。open仅选scope；禁止caller user/endpoint/path/profile/token/
  grant，append以Main待分配的generation-bound handle关联，cursor/epoch保持无损，
  pageJson按UTF-8≤2MiB并拒绝孤立surrogate。permissionRevision只作关联，不能
  自授权限。结果无正文/凭据。11项协议测试通过，schema纳入protocol revision并
  用仓库generator更新。corepack pnpm run check通过，778files/4276tests通过、
  3files/6tests跳过。不是已运行broker：句柄分配/失效、权限
  检查、dispatcher与Host消费者仍需实现。本轮无真实网络/记忆/数据库/部署操作。

- 2026-09-12：移除任意预构造binding注册入口，改为Main-only createReceiptBinding，
  从成功load/store的不可变非敏感快照取endpoint/userId，再创建并注册绑定；caller
  只提供Main-owned root/profile/scope，不使用其额外userId/endpoint字段。store请求
  在await前复制，阻止调用方后续修改影响落盘凭据及目录身份。retire/generation/
  128handle上限和release保留，不把activeTeamId当userId，也不留token于factory。
  定向27tests先通过，补充目录数量断言后聚合corepack pnpm run check通过：
  777files/4265tests通过，3files/6tests跳过。初次类型检查发现mock零
  参数tuple，已显式标注broker store签名。实际自动调用、scope membership与sync
  IPC仍未接，不宣称运行时团队同步完成。仅测试临时目录，无生产/真实资料操作。

- 2026-09-12：receipt存储改为同Main进程、同resolved目录跨实例共享队列，覆盖旧
  binding退休但写入未完成时新binding到来的竞态。新操作等旧写入结束后重新校验
  cursor/epoch；失败不污染队列。全进程最多接纳16个读写操作，溢出明确报错，
  空闲tail自动移除，不保留永久scope缓存。不是跨进程锁，不处理symlink/case
  alias，未来Main接线须统一canonical root且保持单写入进程。
  定向store21/binding13/lifecycle6共40项通过（两次有界测试覆盖），desktop
  typecheck通过；未连接自动创建/注册/sync IPC，不宣称端到端恢复已完成。
  测试仅独占临时目录；无真实记忆、数据库/VPS/commit/push/deploy/打包操作。

- 2026-09-12：EnterpriseCredentialSupervisor新增Main-only receipt绑定注册与失效，
  bootstrap/store/clear开始前即retire；失败不恢复旧handle。generation防止旧异步
  bootstrap/store在logout或Host reset后重新开放注册。Host实际start/current-exit/
  stop已接invalidate；无关旧Host exit不影响新generation。注册最多128handles，
  显式release也retire；同用户token refresh保守失效，不保留凭据副本。
  原有credential IPC结果语义不变，registration-ready不代表membership/lease有效。
  尚无生产自动创建/注册绑定或sync IPC；注册时exact identity核对、跨generation
  单store writer所有权仍是后续必需项，不能直接把新handle当作端到端可用。
  定向5files/32tests先通过，另补Host生命周期失效调用测试；最终corepack pnpm
  run check通过，777files/4260tests通过，3files/6tests跳过；这是源码门禁证据。
  首次聚合检查命中supervisor增加3行后的460行上限，仅去除3个空行，未改门禁。
  无真实记忆目录/VPS/数据库/commit/push/deploy/packaged/native Windows操作。

- 2026-09-12：Main新增未接生命周期的SharedKnowledgeReceiptBinding，独占store，
  使用versioned tuple(localProfileId, canonical endpoint, userId, teamId, scopeKind,
  scopeId)派生目录hash。现场确认credential.accountId=activeTeamId，不能替代userId。
  保留endpoint base path/非默认port，拒绝userinfo/query/fragment/远端HTTP；
  不复制额外credential字段。scope不匹配在磁盘操作前拒绝。retire后拒绝操作及
  在途结果；已开始写入允许完成在旧namespace，不删除/迁移数据，不返回成功。
  绑定必须由可信Main状态构造，每owner单实例；真实登录/退出/切换生命周期、
  IPC和成员权限校验尚未连接，不宣称账户端到端隔离已完成。
  定向3files/39tests通过（binding12），desktop typecheck、定向lint、架构与结构
  门禁通过。未操作真实记忆/VPS/数据库/commit/push/deploy/packaged/Windows。

- 2026-09-12：页面decoder移入runtime-neutral protocol，Host/Main共用同一套
  scope/epoch/permission/cursor/正文hash及大小规则，由各自Node边界提供SHA-256；
  Host保留INVALID_PAYLOAD错误投影。Main新增未接IPC的receiveSharedKnowledgePage，
  复制输入与期望、先校验再append；空heartbeat不落receipt，存储失败原样传播。
  精确profile/account/service/scope与store绑定仍由未来Main broker负责，不能接收
  Host任意指定路由/期望后当作授权。历史租约只作metadata，无权限grant/index推进。
  定向5files/60tests通过（Main新增8项，覆盖输入快照/精确字节重放/重试、scope/
  permission/hash/gap/超限拒绝、heartbeat及存储冲突）。corepack pnpm run check
  最终通过（协议版本/全仓类型/lint/架构/死代码/结构/transport/workflow/coverage）；
  曾命中Unicode spread lint及Host无调用方的类型re-export，等价修正/移除后通过，
  未放宽门禁。覆盖率statements83.24%、branches77.38%、functions87%、lines87.05%。
  未操作真实记忆目录、VPS/数据库、commit/push/deploy或packaged/native Windows。

- 2026-09-12：存储primitive新增replayHistory，完整校验捕获链后保留有界hash清单
  （调用方预算，最多10,000页），逐页重新验hash再按旧到新await暂存callback。
  callback在writer队列外，可等待append而不死锁；新append不纳入本次snapshot。
  不累积正文、不写index cursor或权限lease；错误/取消不返回完成结果。取消信号
  传给callback，活动callback需协作响应。调用方必须使用未发布staging，失败丢弃；
  存储层不负责回滚callback外部副作用，也不授予旧版本模型访问权限。
  定向19tests通过（新增6项：字节/顺序/并发append、预检失败零callback、预检后
  文件损坏、callback失败/取消及重试、空链/预算），desktop typecheck通过。
  尚未连接Main broker、完整page/账户验证、索引恢复或实时检索。只使用临时目录，
  未执行真实记忆/数据库/VPS/commit/push/deploy/packaged或Windows验证。

- 2026-09-12：接收存储补齐显式verifyHistory(maxPages, signal)，捕获receipt尾指针后
  在writer队列外逐页向零游标校验hash/epoch/游标连续性，内存不累计历史payload；
  严格递减游标排除循环。取消/超页数预算/旧页缺失损坏均报错，不返回部分成功，
  不改变receipt/index游标；成功只证明捕获的snapshot，不覆盖随后append。
  读取记录另拒绝非canonical base64、空payload及解码后超过2MiB的数据。
  定向13tests和desktop typecheck通过：包括正常三页、预算、旧页缺失/损坏、
  hash有效但游标断裂/epoch错误/截断链/base64异常、遍历中取消后继续写入。
  仅临时文件系统证据，无真实记忆目录、数据库/VPS或打包操作。read/append仍只
  验尾页；历史顺序重放、broker身份/page验证及index恢复尚未接入运行时。

- 2026-09-12：Main新增未接运行时的SharedKnowledgeReceiptStore存储primitive。
  专用scope hash目录下保存content-addressed页记录（含previous链接）与receipt指针；
  页文件flush/rename/directory fsync完成后才替换并flush指针，精确重试也重新fsync
  directory。单instance队列串行、fromCursor CAS/epoch匹配，拒绝同游标不同payload；
  不重置epoch、不更新index cursor、不持久化权限grant。页≤2MiB、私有文件/目录，
  load校验当前指针和尾页hash；显式历史链校验见上方后续checkpoint，重放/index恢复未接入。
  当前接口只接已校验opaque bytes，未来Main broker须另校验account/service/scope
  身份和完整page；不能直接把Host消息当作授权。每scope只允许一个Main-owned实例，
  未实现跨process writer协调。Windows directory fsync未验证，失败明确报错，不宣称
  Windows可用或真实断电恢复。磁盘孤立页允许保留，未做GC或自动清理真实资料。
  定向5tests通过（实际临时目录+pointer rename故障注入），desktop typecheck通过。
  用例覆盖重开/重试/CAS并发/损坏或缺失尾页/指针发布失败时游标不前进与重试恢复。
  仅使用独占测试目录；无真实记忆目录、网络/数据库/VPS/commit/push/deploy/打包操作。

- 2026-09-11：Desktop Gateway增加syncKnowledge，显式team/project GET，保留
  bearer/redirect:error/8秒timeout/调用方取消。网络response通过固定2MiB缓冲流式
  读取再交给page decoder，不信任Content-Length；超限/取消/超时丢弃partial并cancel
  reader，不返回可用page。同步428不再落入device pending分支，403/409不重试或
  fallback；期望scope/permission/cursor在请求开始复制以免异步漂移。
  定向4files/50tests通过（transport6/page12/client15/authorization17），agent-host
  typecheck通过；首次发现mock零参数tuple类型错误已修正。旧client/auth回归一并跑。
  这是mock transport/source证据，未调用VPS、未持久化游标或索引、未接自动同步/
  search、未跑full source/packaged/native Windows。无renderer产品变化，不打包。
  下一步将已校验page交给原子持久接收，落盘成功后推进receipt cursor，索引游标独立。

- 2026-09-11：Desktop Agent Host新增同步page decoder（尚未接transport/persistence）。
  按原始UTF-8 bytes限制2MiB，绑定exact team/scope/permissionRevision与epoch，
  bigint cursor不经Number、逐条验证连续性/next/head/hasMore，拒绝空页假进展。
  upsert正文≤1MiB，核对exact SHA256及固定tuple/schema/kind/字符上限；拒绝NUL/
  非法surrogate。revoke不允许正文，未知字段拒绝；租约只校验形状/≤5分钟，不产出
  assertValid/grant、不延长会话权限。定向12tests和agent-host typecheck通过。
  未接网络流式限长、持久receipt cursor、index/current allowlist或模型搜索；未运行
  full source/candidate/真实Electron/Windows/VPS，不宣称Desktop端到端同步完成。
  本轮无renderer用户可见改动，不打包重启；无数据库/commit/push/deploy操作。

- 2026-09-11：旧GET shared-assets合并legacy与versioned project管理列表，单条SQL
  同snapshot校验session/verified user/entitlement/显式active project成员，再按
  publishedAt DESC/id ASC统一LIMIT500；不分别截断。legacy保留原status展示，
  versioned仅receipt+active head，使用当前不可变元数据与首次发布时间、不带正文；
  存在新版identity就抑制同ID旧记录，不让revoked/无权新版借旧列表再出现。
  Rust lib31/31、fmt、workspace --no-run、clippy通过，DB/HTTP混合列表/排序/
  发布时间/撤销排除用例仅编译。OpenAPI/PRODUCT/LOCAL_MEMORY_CONTRACT同步。
  未把旧接口称为新keyset/keyword分页，也未验证VPS查询计划。发布仍旧链路：须先
  接好Desktop新版本消费/搜索，否则Agent搜不到新发布资料；禁止用关键词搜索冒充
  原语义搜索。无数据库/迁移/VPS/commit/push/deploy或Desktop产品/打包操作。

- 2026-09-11：DELETE shared-assets/{assetId}接新版project事务撤销。scope解析先查
  receipt/active project显式成员，无权新版ID不fallback；writer再次事务内鉴权。
  GET提供strong ETag/no-store，新版DELETE要求单个quoted lowercase SHA256
  If-Match：missing428、非法400、stale409、同版本重复204不追加事件。CORS仅在
  既有exact origin策略下允许If-Match/expose ETag，legacy-only DELETE不变。
  Rust lib31/31、fmt、workspace --no-run、clippy通过；DB/HTTP回归仅编译。
  OpenAPI/PRODUCT/LOCAL_MEMORY_CONTRACT同步；publication/list及Desktop消费端
  仍待切换。无数据库连接/迁移、VPS、commit/push/deploy或Desktop产品/打包。

- 2026-09-11：旧GET shared-assets/{assetId}接入新版project详情，保持原响应字段。
  readonly repeatable-read中先区分versioned identity，再读取receipt/current version
  并核对session/verified user/entitlement/active project显式成员；只有不存在新版
  identity才交回legacy路径，revoked/越权/缺receipt/team scope不fallback。publishedAt
  来自首次receipt，externalRevision来自当前canonical hash，正文保留原JSON解析/
  body wrapper行为，不读后来改动的candidate正文、不伪造OpenViking locator。
  Rust lib30/30通过；wire mapping单测和DB/HTTP fixtures覆盖新版detail/不可变正文/
  revoked404，数据库部分只编译。fmt、workspace --no-run、clippy -D warnings通过，
  OpenAPI/PRODUCT/LOCAL_MEMORY_CONTRACT同步。发布/list/DELETE/POST search尚未
  切换，无数据库连接/迁移、VPS、commit/push/deploy或Desktop产品/打包操作。

- 2026-09-11：核对旧Web/HTTP SharedAsset合同发现publishedAt为必填，不能用
  version.created_at伪造。Server migration009补immutable publication receipt，
  FK绑定candidate scope/asset/version并记录publisher/time；同发布transaction写入，
  candidate reviewed_at使用同一时间。重试读取首次receipt，不再从可变candidate
  文本重算revision；不恢复revoked head，不自动接管无receipt旧发布。普通UPDATE/
  DELETE trigger拒绝，不声称防schema owner/TRUNCATE。DB fixtures覆盖单回执、
  时间一致、candidate文本变化后的稳定重试、23514拒改、无receipt拒绝，只编译。
  Rust lib29/29、fmt、workspace --no-run、clippy -D warnings通过。旧HTTP发布/
  列表/详情/搜索仍未切换，下一步基于receipt适配这些响应；无数据库/迁移/VPS/
  commit/push/deploy或Desktop产品/打包操作。

- 2026-09-11：Server接入GET team/project shared-assets/sync两条HTTP路由及OpenAPI。
  复用Authenticated/team scope与repository snapshot授权；query未知/重复/非法字段
  structured400，成功响应保持原始限长JSON bytes并设private,no-store。仅读新版事件
  存储，旧发布不会自动进入同步流，旧列表/详情/搜索和Desktop/Web调用未切换。
  新增query与bytes/header单测，Rust lib29/29通过；DB fixture补充两类路由/空页/
  事件页/成员撤销拒绝，只编译。fmt、workspace --no-run、clippy -D warnings通过；
  OpenAPI YAML和123内部引用检查通过，不等于完整schema/runtime验证。同步更新
  PRODUCT/LOCAL_MEMORY_CONTRACT。无数据库/迁移/VPS/deploy/commit/push/打包。
  下一步仍为发布/列表等HTTP兼容切换及Desktop receipt/index，不声称端到端完成。

- 2026-09-11：Server新增未接HTTP的versioned管理列表/关键词过滤：同一只读snapshot
  验证scope/user/session/entitlement，仅返回active head元数据，不含正文/旧版本/
  revoked资料。kind过滤，keyword≤200字符，标题/摘要/正文按DB lower+literal
  substring匹配（%/_不是通配符）；默认50/max100、UUID升序keyset、多取1条判断
  hasMore。它不是语义搜索或同步枚举，各页新snapshot，并发更新需要刷新。
  migration008定义active scope/asset索引，未执行；关键词仍可能扫描范围内当前
  内容，statement timeout 10秒，不宣称VPS性能通过。Rust lib27/27、fmt、workspace
  --no-run、clippy -D warnings通过。新DB fixtures编译但未运行。HTTP/Web/Desktop
  和旧POST搜索保持不变，切换时需一起适配旧字段/分页，不能伪造publishedAt。
  本轮只改Server实现/测试/索引定义及两仓文档，无数据库/VPS/commit/push/deploy。

- 2026-09-11：Server新增未接HTTP的versioned sync repository方法：只读repeatable-read
  transaction内复用scope authorization，再读stream head/events；单statement 10秒
  上限，返回前按DB clock复核租约。cursor用canonical bigint字符串，非零必须带epoch；
  epoch不匹配/ahead显式拒绝。未分配stream返回epoch null/zero cursor且无写入。
  默认50/最多100事件，SQL先限条数再取保守byte prefix，实际JSON≤2MiB，编码逐事件
  计量而非反复序列化整页；缺口/首事件过大fail closed，revoke不带正文。新增5个pure
  tests，Rust lib26/26通过；DB fixture只编译，未验证SQL/snapshot并发/VPS性能。
  workspace --no-run、fmt、clippy -D warnings通过。HTTP/openapi尚未切换；响应是
  receipt数据，不能跳过head追平/当前版本许可/index freshness来直接用于模型。
  无Desktop产品/打包、数据库连接/迁移、VPS、commit/push/deploy；下一步列表/检索
  兼容及HTTP合同切换，之后接Desktop持久接收/索引。

- 2026-09-11：Server新增versioned asset governance read/revoke repository方法。
  read同一SQL snapshot检查session/user/team entitlement/精确scope，仅返回当前
  未撤销版本；team不借用project权限，project明确成员要求无admin豁免。revoke与
  publication复用事务写权限，entitlement先锁，要求observed revision，保留版本并
  原子写head/event/audit，重复撤销不追加事件且仍检查权限/到期。DB fixtures覆盖
  错team/project/scope、viewer权限、session到期、成员移除、team独立可见性、权益
  暂停、stale/retry和历史保留；仅编译，未运行PostgreSQL，不声称并发验证通过。
  Rust lib21tests、workspace --no-run、fmt与clippy -D warnings通过。HTTP尚未切换，
  read不是模型处理授权或sync租约；list/search/sync、Desktop投影与实库验证仍待完成。
  本轮只改Server实现/测试及两仓文档，无Desktop产品/打包、数据库/VPS/发布操作。

- 2026-09-11：Server新增未接HTTP的versioned candidate publication事务：按旧链路
  相同的entitlement→candidate顺序加锁，复核session/verified user/admin/project成员/
  entitlement，提交前复核到期时间。candidate UUID作为稳定asset ID，版本/head/event/
  audit及review status同事务；重试要求匹配upsert事件，不追加事件/占额度，也不恢复
  已撤销资料。旧发布不自动接管。DB fixture覆盖无效session、满额度重试、撤销后重试、
  项目成员撤销；仅编译，未执行数据库验证。HTTP读取/发布/撤销及sync切换仍待完成。
  本轮无Desktop产品改动、数据库连接/迁移、VPS操作、commit/push/deploy。

- 2026-09-10：Server migration007和storage writer补充active head与append-only
  upsert/revoke events。版本/指针/事件/metadata audit在caller transaction内的
  savepoint写入，stream row序号锁保留至outer commit；stale expected revision或
  scope冲突拒绝。相同revision/state无变化回滚allocation，revocation保留内容版本。
  新DB fixture验证事件顺序、无变化不占游标、stale拒绝、audit FK失败后即使outer
  commit也无孤立version/head/event；只编译未运行，不宣称PostgreSQL验证通过。
  cargo fmt、offline lib21tests、workspace --no-run、all-targets clippy -D warnings
  通过。HTTP发布/撤销/读取仍走原有链路，权限事务/candidate幂等/sync尚未接入。
  本轮无Desktop产品改动/打包，无数据库连接/迁移、VPS、commit/push/发布。

- 2026-09-10：Server新增migration006 knowledge_versions，按stream scope/asset/
  revision保存canonical content，FK绑定stream，1MiB字节上限，UPDATE/DELETE
  trigger拒绝普通变更。transaction writer内部计算SHA256、幂等insert并回读比较
  冲突内容，不自行commit/授权。canonical v1为固定UTF-8 JSON tuple（schema/kind/
  title/summary/content），保留Unicode/换行/空白，不声称通用JCS；身份/游标不混入
  contentRevision。仍未接旧发布路由、pointer/event/audit/sync，无legacy迁移。
  Server cargo fmt、offline lib21tests、workspace tests --no-run、all-targets
  clippy -D warnings通过。隔离PostgreSQL流程增加幂等/多版本/23514防变更/rollback
  fixtures，只编译未运行。schema owner/管理员仍可改schema或TRUNCATE，不声称
  防管理员篡改。协议HTTP行为未改；文档同步Server LOCAL_MEMORY_CONTRACT。
  本轮无Desktop产品源码或打包，无VPS/DB、commit/push/发布。

- 2026-09-10：转入Server不可变同步基础。新增source-only migration005
  knowledge_streams，显式team/project、epoch、bigint cursor、composite project FK；
  allocator要求传入现有Transaction，lazy insert后UPDATE持锁至caller commit/rollback，
  cursor返回十进制字符串，不自行commit、不授予权限。现有发布/搜索仍未切换，
  尚无immutable versions/events/active pointer/sync endpoint，不称端到端完成。
  Server cargo fmt、offline lib19tests、workspace tests --no-run、all-targets clippy
  -D warnings通过。新增隔离DB流程检查独立scope、held lock SQLSTATE55P03、
  rollback复用cursor与epoch，仅编译，未连接数据库/执行migration。
  本轮无Desktop产品源码/界面改动，未重新打包；无VPS/DB、commit/push/发布。

- 2026-09-10：共享召回反馈此前仅Workspace+provider/asset ID，跨账号/团队/项目
  同ID可能复用旧评分或过滤。现在recordEnterprise与applyEnterpriseFeedback使用
  相同的versioned opaque item hash，包含canonical endpoint/user/team/project。
  Experience/SOP的治理和模型调用均传入当前已解析范围；旧无范围记录保留但不会
  被新范围读取采用。没有明文身份字段、数据迁移或权限扩展；工作区级诊断列表
  仍是诊断，不宣称团队ACL视图，也未实现资料版本级反馈或不可变同步。
  新增两个route回归覆盖四种身份变化、等价endpoint、legacy隔离、distinct IDs及
  无明文记录。定向2 files / 60 tests PASS；check:source exit 0：771 files /
  4196 tests PASS，3 files / 6 tests skipped，coverage 83.18/77.27/86.95/86.98。
  日志 `/tmp/new-money-feedback-scope-{targeted,source,preview}.log`。
  preview:mac:unsigned exit 0，通用packaged smoke/DMG/ZIP通过，最新预览已打开；
  app.asar 200122625 bytes，SHA-256
  `be308dbc978d94aeb1ae6d5cf03fc529e1896861fc5cc01ce00a8d104bbb6456`。
  无真实账号/多团队资料/撤权/Windows联调，无VPS/DB、commit/push/发布。

- 2026-09-10：四个模型侧共享Experience/SOP读取已从Workspace binding解耦。
  resolveSharedReadScope使用Runtime传入的Pi birth scope，先核对当前user/service，
  再按其team/project执行原有authorizeProject和Agent model policy。模型侧不读写
  Workspace绑定；model-free治理仍走requireBoundWorkspace。null model仍被模型
  政策拒绝。保留generation/power、返回project/revision、SOP expiry及异步前后检查。
  rebind仍保守拒绝在途读取，下一请求不被binding重新指向。没有迁移或修改绑定。
  旧测试的“another-team即拒绝”改为“another-user拒绝”：team允许与Workspace
  不同，但服务端项目授权不可省略；新增四接口未绑定读取和途中logout回归8项。
  定向3 files / 56 tests PASS。初次全量停在测试unbound-method lint，改用spy
  引用后check:source exit 0：771 files / 4194 tests PASS，3 files / 6 tests
  skipped，coverage 83.18/77.27/86.95/86.98。git diff --check PASS。
  日志 `/tmp/new-money-shared-birth-{targeted,source-final,preview}.log`。
  preview:mac:unsigned exit 0，通用packaged smoke及DMG/ZIP通过并打开最新预览；
  app.asar 200121631 bytes，SHA-256
  `9cdd1fa8ed887b3f6b60e7476b0b952af2e6e18e21f7670741a4fb2f6aba01ca`。
  这是本地Host/Runtime合同和受控transport证明；真实团队/权限/资料联调仍未验证。
  无VPS/DB、commit/push/发布；未删除DataHub实现或改变共享同步目标。

- 2026-09-10：provisional页面已接会话范围disclosure，复用Settings React Aria
  team/project Select，明确选择后另开空team draft；转private也是新草稿，原内容/
  附件不搬迁。列表按展开读取，清除旧project选择，取消旧effect发布，错误/空/
  loading/retry/creation-locked有显式状态；实际发送仍由Host校验。Session identity
  projection保留memoryOrigin，旧snapshot为unverified；live conversation增加来源行，
  不把team来源当当前权限。stopped历史的来源展示仍待接入。新对话区增加有界纵向
  滚动，避免展开后挤占Composer；整体Electron布局/键盘仍需专项验收。
  实际使用design-craft + browser67，L1-F/web/normal/main_serial，无subagent，
  PRODUCT/DESIGN enforce，keep现有React Aria，不新增依赖。
  定向2 files / 15 tests PASS；check:source exit 0：771 files / 4186 tests PASS，
  3 files / 6 tests skipped，coverage 83.18/77.26/86.95/86.98。之后仅CSS按钮状态与
  滚动边界校准，未重复全量源码门禁。日志 `/tmp/new-money-scope-ui-{targeted-final,source,preview-final}.log`。
  browser67隔离Vite fixture使用合成team/project，实际点击确认team draft scope
  精确、task count 1→2，原private text保留；转private count 3且原text仍在。
  夹具早期Vite preamble/CJS导出及HMR模块身份问题已修正，不是产品验收失败；
  之后CSS HMR重置夹具，不把reset后的截图当成先前点击状态证明。
  已查看最终light展开/disabled截图1240×1138，SHA-256
  `40ab7e43cc20b57bb6fdf8aa7adbf2922651cce14df91be2ccdf046836479346`；
  dark展开/disabled截图620×569（viewport 760×900），SHA-256
  `e51b9c477ad1db8adb660ddda6ec4e665e1ded6f9382b1f38a3a8dda42cd6dc1`。
  文件位于repo外browser67 runtime/runs/new-money-scope-ui；fixture在ignored artifacts。
  轻量一致性结论incomplete：组件两主题中性风格已检查，但未覆盖完整Electron布局、
  keyboard/focus/hover、错误/迟到响应真实交互、真实登录/撤权和Windows。
  browser67同实例同workspace finalize closed=1 verified=1 errors=0 remaining=0，
  未操作用户tab；已停止本轮Vite。无VPS/DB、commit/push/发布。
  最终CSS对应preview:mac:unsigned exit 0，packaged smoke/DMG/ZIP通过并打开；
  app.asar 200121224 bytes，SHA-256
  `4c0c19a5ece22f3b649b7b30cebcf1e2adeb27a1317260c9beb48e71b7a8b2f3`。
  后续现场只读确认：EnterpriseContextController四个共享经验/SOP读接口仍先
  requireBoundWorkspace，再将model.scope与binding比较。新team birth本身不依赖
  binding，因此未绑定或选择不同项目会在共享读取时被拒绝（fail-closed，不是越权）。
  下一修正应分离模型侧birth scope读取与管理侧Workspace绑定读取，同时保留
  current user/service、项目ACL/model policy、generation/power及asset revision检查；
  不自动写入或更换用户Workspace绑定。此依赖尚未修复，不能宣称团队端到端完成。

- 2026-09-10：SessionSnapshot新增可选memoryOrigin，Runtime从完整Pi JSONL
  复用既有provenance校验，输出private/team/unverified；team只投影teamId/projectId，
  不暴露user/endpoint/lease，不代表当前授权。无标记、畸形、重复、继承或私人
  标记下存在非当前分支共享记录均不认证为private。旧snapshot缺字段仍兼容，
  消费方必须按unverified处理；可见选择器/身份展示尚未连接。
  抽出session-snapshot-schema保持协议职责/460行门禁，未改变其他snapshot字段。
  定向5 files / 38 tests PASS，含真实Pi SDK初始/后续team和private创建快照断言。
  初次门禁发现测试TSchema访问类型和schemas.ts行数超限，修正后稳定
  check:source exit 0：770 files / 4180 tests PASS，3 files / 6 tests skipped，
  coverage 83.18/77.26/86.95/86.98，git diff --check PASS。
  protocol revision为`f58f2ffc82ea791b666cd44ba04e300109ed36592285bef4b2c01a035ec620a4`。
  日志 `/tmp/new-money-memory-origin-{targeted-final,source-final}.log`。
  本轮仅来源投影/协议，无可见UI变化，未重建preview；旧预览不证明本轮源码。
  无真实服务端/模型/Windows验证，无VPS/DB、commit/push/发布操作。
  下一步接可见private/team选择和已创建Session身份展示，权限仍以实时Host检查为准。

- 2026-09-10：provisional team intent现已贯通非空草稿serialize/Main严格parse/
  cold storage load/Renderer restore/首次session.create。仅teamId/projectId，
  不持久化user/endpoint/lease；Main拒绝畸形或已materialized记录上的scope，
  不剥离为private。空草稿只在同scope复用，scope参与fingerprint，旧恢复记录
  不覆盖当前不同scope；connection等待中漂移则拒绝创建。成功materialize后
  去掉草稿创建意图，Pi JSONL保留身份真源。直接创建失败但用户已输入时也保留
  team意图供重试。可见选择器、已创建Session身份展示仍未连接。
  为保留文件职责/行数边界，抽出Main creation-intent解析和Renderer restored
  Task构造；未加依赖、数据库或新Host命令。protocol revision生成已运行，
  仍为现有WIP的`2a69e7add0364149ee37de85bc5e973ff65d2f2cfcaeac80450d7a471a665573`。
  定向6 files / 74 tests PASS（含受控加密夹具的真实临时文件cold load，不是系统
  密钥链证明）。早期类型/静态门禁发现Desktop domain依赖出口、unused import及
  control-regex问题，已修正；稳定check:source exit 0：769 files / 4170 tests PASS，
  3 files / 6 tests skipped，coverage 83.17/77.26/86.94/86.98。
  preview:mac:unsigned exit 0，通用packaged smoke和DMG/ZIP验证通过，已打开
  最新仓库预览；不是团队UI或服务端联调验收。app.asar 200104574 bytes，SHA-256
  `7fedd2a605bd60bcaefca6c58abb8b557a40f2043a807eab7675d57f91cc3b42`。
  日志 `/tmp/new-money-team-draft-{targeted-final,source-final,preview}.log`。
  无真实团队/模型/Windows验收，无VPS/DB、commit/push/发布；保留其他dirty WIP。

- 2026-09-10：Renderer immediate createRendererSession已接可选teamScope，等待
  connection authority前只复制teamId/projectId，与creationId一起传给Host；独立
  Task不复用私人草稿，不从登录/Workspace binding推断scope，拒绝不降级private。
  workspace变化与unconfirmed creation沿用原拦截/恢复规则。仍未连接可见选择器，
  普通provisional首条发送仍为private；下一步须做team intent持久化/恢复/首条发送
  再开放UI，不能把此immediate API当成团队UI已完成。未新增持久schema/依赖。
  design-craft已实际使用（L1-F/web/main_serial，PRODUCT/DESIGN enforce）；本轮
  仅plumbing，无组件/样式改动，无browser/native/visual验收，原UI目标保持未完成。
  新增5项Renderer回归，定向2 files / 26 tests PASS；初始测试错误构造器改为真实
  ProtocolRequestError对象参数后，稳定check:source exit 0：768 files / 4154
  tests PASS，3 files / 6 tests skipped，coverage 83.16/77.19/86.94/86.97。
  日志 `/tmp/new-money-renderer-team-create-{targeted,source}.log`。
  本轮无可见变化，未重建/打开preview，上一份预览不能证明本轮源码。
  无真实服务端/模型联调、VPS/DB、commit/push/发布操作；保留其他dirty WIP。

- 2026-09-10：等待Tool hook/用户审批期间也retain同一Tool lease，按既有basis
  规则续租；审批返回后仍再次核验，finally释放，无自动批准。任务idle停止轮询，
  新用户run重新准入。不响应取消的审批hook仍待真实settle，但失效授权不能在
  之后批准时执行。新增5项等待审批/撤权/断网到期/取消/错误及idle停止回归，
  定向3 files / 35 tests PASS。首次check:source为4148 PASS + 1 FAIL：既有
  host-server-operation-crash-recovery等待operation.lost未达成；该fixture注入
  fake runtime，不经过本轮Pi guard。原样单独复跑1 PASS，未改源码/测试/超时，
  完整check:source原样重跑exit 0：767 files / 4149 tests PASS，3 files / 6 tests
  skipped，coverage 83.16/77.18/86.94/86.97。首次偶发失败根因仍未确认，保留记录。
  preview:mac:unsigned exit 0，通用packaged smoke、受控memory设置冷读取和
  DMG/ZIP验证通过，最新预览已打开。app.asar 200102869 bytes，SHA-256
  `238b98e07a95888f11c1e0324d9f29126d9a128d8c61a95bd87b4ec264b77367`。
  日志 `/tmp/new-money-approval-renew-{targeted,source,crash-repro,source-rerun,preview}.log`。
  无真实审批UI/服务端撤权/模型/休眠/Windows专项验收；无VPS/DB、commit/push/发布。
  下一主线仍为团队创建UI和共享资料不可变版本/同步投影，不以本轮源码通过宣称完成。

- 2026-09-10：运行中Tool组已共享每分钟单次在途续租，以生成调用的模型已准入
  history basis为依据，重新检查身份/项目/model政策和全部既有asset revision。
  允许追加尚未完成的Tool记录，但不能离开原basis分支；新资料须在下一次模型
  请求前通过完整history准入。新grant只有完整成功且旧grant未失效才替换。
  仅已分类transport失败保留原期限；权限/版本/身份/无效响应锁存拒绝。
  新回归发现并修复旧逻辑在工具到期后仍进入下一模型准入的漏洞：同run失效
  不能自动恢复，新用户run独立重新授权。最后一个Tool settle、abort或expiry
  取消在途renew，迟到成功不得换grant。工具不响应abort仍等待其真实settle。
  Tool组从开始执行计时；审批等待/idle不续租，尚非统一whole-Task续租。
  定向5 files / 60 tests PASS；早期expired回归超时促成上述run fence修复，
  测试消息类型收窄后稳定源码check:source exit 0：767 files / 4144 tests PASS，
  3 files / 6 tests skipped，coverage 83.16/77.18/86.94/86.97。
  preview:mac:unsigned exit 0，通用packaged smoke、受控memory设置冷读取、
  DMG/ZIP验证通过，最新仓库预览已打开。app.asar 200100732 bytes，SHA-256
  `66d59935240bd34abf9ad654e59f891165b6fabf268ab70c2689ae3adea50606`。
  日志 `/tmp/new-money-tool-renew-{targeted,source,preview}.log`。
  未做真实服务端撤权/模型/休眠/Windows验收；无VPS/DB写入或commit/push/发布。
  剩余工作仍包括统一Task生命周期、团队创建UI、不可变版本/同步投影和替换部署。

- 2026-09-10：Tool执行保护已覆盖Pi preparation保留的确切AgentTool对象，
  不改变Pi并行/串行调度、schema或既有审批。在真正execute前复核当前run grant，
  因此后续审批失效也能阻止先前已prepared的并行调用。运行期间每秒及每次update/
  result前检查，失效锁存并abort工具signal；不再透出迟到update/success。
  忽略abort的工具仍保持pending直至底层settle，不假报idle/rollback；已发生的
  外部副作用不能撤销。没有Tool阶段续租，沿用旧grant直至到期后取消；whole-Task
  续租、真实撤权/休眠联调、Windows仍待完成。仅Pi调度工具，不拦截扩展任意直接I/O。
  新增7项回归（执行前并行竞态、两种调度、运行中撤权/abort、update/error清理），
  定向3 files / 28 tests PASS。早期测试字段result更正为Pi事件partialResult后，
  稳定源码check:source exit 0：766 files / 4130 tests PASS，3 files / 6 tests skipped，
  coverage 83.13/77.16/86.91/86.95。preview:mac:unsigned exit 0，通用packaged
  smoke、受控设置冷进程读取及DMG/ZIP验证通过，最新仓库预览已打开。
  app.asar 200082236 bytes，SHA-256
  `fa00a23db146701018d2554059299a88f08e74570408ed123bd0bbd0fae2cf0d`。
  日志 `/tmp/new-money-tool-execution-{targeted,source,preview}.log`。
  无Server/VPS/DB、真实密钥、commit/push/发布操作；整体计划仍为active。

- 2026-09-10：普通Tool preparation通过Pi原生beforeToolCall接入当前model grant，
  在既有Tool hook/审批前后复核；保留原safety决定，绑定Agent run signal及Session，
  已知失效返回block/terminate。私人路径保留既有hook行为，不新建授权网络请求。
  这是准入补强，**不是执行阶段闭环**：现场Pi并行批次先prepare再统一execute，
  executePreparedToolCall本身不先检查abort；已prepare的其他Tool仍可能执行。
  下一步必须覆盖execute-time和running Tool取消/续租，不能仅凭beforeToolCall
  或发送abort宣称已阻止全部工具，更不能宣称撤销了外部副作用。
  新增7项真实Pi Agent循环回归，连同既有guard/refresh定向3 files / 21 tests PASS。
  稳定源码check:source exit 0：766 files / 4123 tests PASS，3 files / 6 tests skipped，
  coverage 83.12/77.16/86.90/86.94。preview:mac:unsigned exit 0，通用packaged
  smoke及DMG/ZIP验证通过，已打开当前仓库预览；不是团队服务端/真实模型联调。
  app.asar 200072370 bytes，SHA-256
  `5c07bc98e0b0f0a8fe293318c284fa4a0f8edfcee5902f8dc8e0b00486c7e000`。
  日志 `/tmp/new-money-tool-admission-{targeted,source,preview}.log`。
  未做真实休眠/Windows、VPS/DB写入、commit/push或发布；整体计划仍未完成。

- 2026-09-10：Main原生suspend/resume已用严格parent消息通知Host；不依赖Renderer，
  不eager启动Host，启动中保留最新状态并在ready后先于renderer handoff发送。
  Host收到消息推进瞬态power epoch，旧team grant/pending共享读取失效；suspend
  拒绝新team准入，resume只允许新核验，不复活旧grant。不清凭据/私人数据、不
  重启私人运行时。当前为Host receipt后的fence，真实OS/IPC与唤醒网络包竞态、
  whole-Task仍未验证/未完成。protocol revision生成已运行，此parent控制消息不改
  当前command revision。定向6 files / 67 tests PASS；新增readiness测试移到既有
  readiness文件以遵守结构上限，没有删减断言。check:source exit 0：765 files /
  4116 tests PASS，3 files / 6 tests skipped，coverage 83.11/77.16/86.90/86.93。
  preview:mac:unsigned exit 0，通用packaged smoke（含合成power resume）、
  冷重启/受控memory设置读取PASS，已打开当前仓库预览。app.asar 200063957
  bytes，SHA-256 `8b434d72530fea956fa126fb395df321df19794120426c56eaaeeaf27157388a`。
  日志 `/tmp/new-money-power-{targeted,source,preview}.log`；未执行真实Mac休眠、
  团队服务端/模型联调或Windows验收。无VPS/DB、commit/push/发布操作。

- 2026-09-10：活跃model stream已接每分钟monotonic单次在途的完整历史复核。
  identity/model政策与所有历史asset读取都通过、旧grant仍有效才换新grant。
  仅明确标记的network/timeout/HTTP408/429/5xx保留旧租约，不续期；权限/版本/
  身份/无效响应立即停止。HTTP拒绝先于error body读取分类，防止拒绝被body失败
  改判网络故障。终态/abort取消refresh，signal传到Host/Gateway，迟到成功不能
  复活到期/结束请求。仍无whole-Task/idle续租、显式wake fence、push撤销或不可变
  同步。定向renew/stream/history/Host 6 files / 94 tests PASS，随后补充428
  pending response body释放回归15 tests PASS。首次全量运行中补此修复，产生
  旧实现/新测试混合结果，不作验收。稳定源码check:source exit 0：763 files /
  4107 tests PASS，3 files / 6 tests skipped，coverage 83.10/77.16/86.89/86.92。
  preview:mac:unsigned exit 0，通用packaged smoke、冷重启与受控memory设置
  读取PASS，已打开当前仓库预览。app.asar 200058899 bytes，SHA-256
  `cb2a23dfa47973f9a9a6152b62dba82bdb8e3ec1e940ff13a9d16e7fc6182485`。
  日志 `/tmp/new-money-team-refresh-{targeted,source,preview}.log`；无真实服务端
  撤销联调/性能数据/真实模型调用，无Server/VPS/DB写入、commit/push/发布。

- 2026-09-10：逐次team准入返回live grant/SOP到期检查；请求stream每个Pi事件前
  和静默时每秒复核，并检查Session替换。已知失效发送provider abort，同时以无
  Tool内容的Pi error收口；即使provider忽略abort，迟到事件也不能恢复成功或执行
  Tool。调用者abort保留aborted语义；终态清timer/listener，私人transport不包装。
  仍未实现每分钟服务器refresh/撤销发现，不延长现有租约；不能收回已发送内容，
  也不保证远端停止计费。定向stream/历史/实际Agent loop回归31 tests PASS，
  check:source exit 0：762 files / 4089 tests PASS，3 files / 6 tests skipped，
  coverage 83.09/77.13/86.90/86.91。preview:mac:unsigned exit 0，通用packaged
  smoke/冷重启/受控memory设置读取PASS，已打开当前仓库预览。app.asar
  200049397 bytes，SHA-256
  `a834bb80b9bb7089d254e061ab522472e124a8c5871348d0af1b8faef51a6ee5`。
  日志 `/tmp/new-money-team-cancel-{targeted,source,preview}.log`。无真实服务器
  撤销联调/真实model调用；无Server/VPS/DB操作、commit/push/发布。

- 2026-09-10：团队模型请求入口已接每次Host项目/model授权，再比对出生identity。
  从Pi全量entries（含inactive branches）收集共享Tool Result的id/project/revision，
  去重后经当前authorized detail逐个复核；拒绝版本变化、撤销、错误/缺失metadata、
  unresolved shared调用和无asset来源的derived summaries。检查期间history变化/
  abort及SOP过期也拒绝transport；不替换内容、不切模型、不改Pi loop。
  此为逐次请求准入，尚无后台refresh、in-flight取消、不可变同步与team创建UI；
  title/compaction/fork/private写入限制未解除。新增真实Pi JSONL重开/非活动分支
  版本验证和真实Agent loop下一轮撤销回归。另阻断team-derived原生子代理
  spawn/resume/steer，避免fresh子任务绕过来源；status/wait/stop不变。
  定向5 files / 75 tests PASS，受影响文件type-aware lint PASS。首次全量运行中
  补入子代理修改，出现旧实现/新测试混合结果，不作为验收。稳定源码
  check:source exit 0：761 files / 4080 tests PASS，3 files / 6 tests skipped，
  coverage 83.07/77.11/86.89/86.90。preview:mac:unsigned exit 0，通用packaged
  smoke/冷重启/受控memory设置验证PASS，已打开当前仓库预览。app.asar
  200032332 bytes，SHA-256
  `5f626809952bd75bd8b8872697bc0b4ce6ce638c2b9ebe5c0ad8b6d157f2ba18`。
  日志 `/tmp/new-money-team-model-{targeted,source,preview}.log`。无真实团队
  Server/model请求或端到端延迟证据；无Server/DB/VPS写入、commit/push/发布。

- 2026-09-10：检查逐次团队模型授权的前置条件时发现，Server detail 允许治理
  历史状态返回，而 Desktop parser 未校验 status/revokedAt/kind，SOP 也未拒绝
  已到期内容。已在 Experience/SOP search/detail 入站检查预期kind、active状态、
  显式null revokedAt；SOP解析与Host异步返回前检查到期（相等也拒绝）。不改
  Server治理历史，也不把当前读取检查当作历史revision授权。定向2 files /
  44 tests PASS（含四入口状态矩阵和异步到期回归）；check:source exit 0，
  760 files / 4059 tests PASS，3 files / 6 tests skipped，coverage
  83.04/77.07/86.88/86.87。preview:mac:unsigned exit 0，通用packaged smoke、
  受控memory设置/密钥显隐/冷进程读取 PASS，已打开当前仓库预览。
  app.asar 200007836 bytes，SHA-256
  `2c5df2d1aa52d160548ee960b8a31c09395adb38c30ea5779ab295ee7fe17f35`。
  日志 `/tmp/new-money-active-assets-{targeted,source,preview}.log`；不代表真实
  Server团队资料或真实模型请求已验证。
  团队模型主循环仍阻断，下一步仍是历史revision与逐次模型授权；无VPS/DB动作。

- 2026-09-09：共享 Tool 读取出生时的完整 Pi team identity（唯一marker、当前
  Session ID、非继承、bounded IDs、安全服务URL），随当前模型传给 Host，
  不让模型参数提供 scope。Host 对 user/service/team/project 与当前凭据、配置、
  binding 精确比对，不匹配在 authorization/content transport 前拒绝，改绑不会
  将旧Session指向新资料。有效team Tool不再追加shared-unverified marker；私人/
  异常来源调用在transport前拒绝并保留保守限制。用户governance读取仍单独授权。
  定向检索/出生/Host 6 files / 58 tests PASS，随后追加6项持久化身份坏输入回归；
  追加后身份parser/真实出生 8 tests PASS。check:source exit 0：760 files /
  4055 tests PASS，3 files / 6 tests skipped，coverage 83.03/77.05/86.88/86.86。
  preview:mac:unsigned exit 0，通用 packaged smoke/冷重启 PASS，已打开当前
  仓库预览（非真实服务器团队检索证明）。app.asar 200006998 bytes，SHA-256
  `1341cf6f37d1be4bbc917ba096f1b2b2d2b837742a3296bf2c8e09b16b1fc2a9`。
  模型主循环仍拒绝team，逐次模型/历史asset授权未完成。无VPS/DB/发布动作。

- 2026-09-09：已接 session.create 可选显式 teamScope(teamId/projectId)，含首次
  Host bootstrap 与已有 runtime create。Runtime 在创建副作用前通过 Host port
  验证；Host 从当前凭据确定 userId/endpoint，调用 exact-project authorization，
  不借 Workspace binding 认领。出生时写唯一 kind=team + origin/user/team/project/
  endpoint；禁止有历史/现有来源时重新赋值。setup 与发布前检查 grant 有效，
  不把凭据/租约持久化成身份。未提供授权port拒绝，退出登录使创建grant失效。
  scope 未提供时保留私人创建；同creationId重放不能创建第二会话或改归属。
  新 protocol revision 2a69e7add0364149ee37de85bc5e973ff65d2f2cfcaeac80450d7a471a665573。
  定向 runtime/protocol 11 tests PASS；Host/routing/lifetime 68 tests PASS。
  首次全量止于测试 unbound-method lint，改用明确spy；第二次止于两入口文件
  各超结构门禁1行，整理新增接线、保留门禁后重跑。最终 check:source exit 0：
  759 files / 4043 tests PASS，3 files / 6 tests skipped，coverage
  83.03/77.05/86.90/86.86。preview:mac:unsigned exit 0，通用 packaged smoke、
  冷重启 PASS，已打开最新仓库预览（非真实服务器团队创建验收）。
  app.asar 199996553 bytes，SHA-256
  `43b7470725a73c0b12e71f747f3ca0720930d2e37addb1549ecec3fcd44058d5`。
  此阶段无团队创建UI、不开放模型/压缩/分支或
  私人捕获，逐次模型授权、租约、检索scope绑定仍待接线。VPS/DB未操作。

- 2026-09-09：首次 Task 创建此前在 createInitial 完成 Desktop 绑定后才 append
  creation marker；现通过 initial setup，在 bindSession/extension session startup
  前初始化私人来源并持久化创建标记。已有 Task 的 Pi newSession.setup 路径保留。
  setup 失败 dispose 尚未绑定的 Session，不伪报发布，不清除已有 journal/marker。
  定向 3 files / 28 tests PASS，实际 AgentSession.bindExtensions 前检查精确 marker，
  创建恢复/防重复与私人来源回归保持通过。首次全量止于 test unbound-method
  lint：观察器保存 SDK 原方法再 apply 到同一个 Session。已对这一行添加明确
  原因的局部豁免，不改产品逻辑/测试断言；check:source exit 0：758 files /
  4039 tests PASS，3 files / 6 tests skipped，coverage 83.02/77.03/86.91/86.85。
  preview:mac:unsigned exit 0，packaged 创建标记、恢复和冷重启 PASS，已打开
  最新仓库预览。app.asar 199983875 bytes，SHA-256
  `e8f5ced37c54aa94558a778f3fc41b21bebbba6989ccfc950f0a4cc46da8f30f`。
  这只是出生时序修复；未增加团队范围协议、未开放模型处理，团队创建/Host验证/
  JSONL团队身份/逐次授权仍需完整接线。无 VPS/数据库/真实模型/commit/push动作。

- 2026-09-09：团队创建接线现场：session.create 目前只有 creationId，初始化复用、
  Main/Host 创建回执与 runtime newSession setup 均需成套携带并确认显式 scope；
  不能以可变 Workspace binding 自动认领历史。本轮尚未改变创建协议或放行。
  发现现有授权租约只看 Date.now，过期后回拨时钟可重新有效；已修复为请求前
  同时捕获 wall/monotonic，响应等待时间消耗租约，两种时限取更严格者。
  已观察时钟回拨或任一超时将 invalidation latch 置位，不可自动复活，需重新
  请求服务器。定向 3 files / 54 tests PASS，新增过期回拨、有效期内回拨、
  wall 不前进但单调超时、传输延迟超时回归。check:source exit 0：758 files /
  4039 tests PASS，3 files / 6 tests skipped，coverage 83.04/77.04/86.91/86.86。
  preview:mac:unsigned exit 0，packaged smoke 和冷重启 PASS，已打开最新仓库
  预览。app.asar 199982262 bytes，SHA-256
  `a94349157601284c983dd4152847760c5b94e852b4be3aa483b1519727012d03`。
  下一完整工作项仍为显式团队范围创建+Host验证+出生时JSONL标记+逐次模型授权；
  不把本租约修复写成团队 Session 完成。无数据库/VPS/真实模型/commit/push动作。

- 2026-09-09：现场确认 Pi Agent 公开的 streamFunction 是主循环每次 transport
  调用入口。主/重绑定和 child Session 已安装幂等 guard，逐次检查完整来源，
  保留原 transport/模型/参数；shared/异常/继承标记在发送前阻止，未标记
  legacy 兼容但不获得私人真源认定。真实 Pi Agent 循环 + 合成 stream 定向
  3 tests PASS：私人正常、已有共享零 transport、Tool 后下一迭代不再 transport。
  初始 2 FAIL 是测试错误期待 prompt reject；SDK runWithLifecycle 将拒绝变成
  error event 后正常 settle。已修正为检查 errorMessage/idle 和零/一次 transport，
  不弱化发送拦截断言。check:source exit 0：758 files / 4035 tests PASS，
  3 files / 6 tests skipped，coverage 83.03/77.04/86.91/86.86。
  preview:mac:unsigned exit 0，packaged smoke 和冷重启 PASS，已打开最新仓库
  预览。app.asar 199981611 bytes，SHA-256
  `e1eed8e9a23326a0ffda8bdcb9effbbd952e816466a5eb627de328e01f5bb684`。
  目前共享检索成功也不会开放后续模型处理，需后续 immutable team Session grant。
  不覆盖已开始请求撤权、transport 前凭据解析或 Extension 自行调用模型。

- 2026-09-09：共享历史转换迁移 fence 已接入 inline Pi Extension 的
  session_before_compact/fork/tree；使用显式 cancel，读取来源异常也返回 cancel，
  不依赖被 SDK 吞掉的异常。完整 entries 中 shared Tool 或非私人/异常/继承
  Desktop marker 拒绝转换；未标记 legacy 维持兼容，不授予 verified private。
  cross-runtime fork 在创建子 JSONL 前检查源；树取消后不再发送回滚成功事件。
  定向 2 files / 8 tests PASS：实际 SDK fork/rollback/cross-runtime fork 拒绝，
  identity/source bytes/files 不变、无成功事件；实际 ExtensionRunner 对 manual/
  threshold/overflow 三种事件返回 cancel（不是完整自动压缩模型调用测试）。
  check:source exit 0，757 files / 4032 tests PASS，3 files / 6 tests skipped，
  coverage 83.03/77.04/86.91/86.86。preview:mac:unsigned exit 0，packaged smoke
  和冷重启 PASS，已打开当前仓库预览。app.asar 199975289 bytes，SHA-256
  `d81e93c9c3e9efae3c00357d10390091d14d04f5eab0efb0ae51c12a37ea28ed`。
  该 fence 不覆盖任意第三方 Extension
  的自行模型调用，不等于主 Agent loop 拦截、团队 Session 授权或撤权续期完成。

- 2026-09-09：继续核对历史内容的模型出口，发现语义标题生成直接调用
  ModelRuntime.completeSimple，不经过共享 Tool；打开历史也会调度自动标题。
  已在标题请求前要求完整 Pi entries 的 verified private provenance，自动模式
  对 shared/unknown/malformed/inherited 跳过，手动生成报可恢复错误；保留
  本地 seed/既有标题、手动命名和历史阅读。写回成功/失败 metadata 前重验，
  来源变化时丢弃迟到结果，不把拒绝记录成 Provider 失败或自动重试。
  定向 3 files / 23 tests PASS；check:source exit 0，756 files / 4030 tests
  PASS，3 files / 6 tests skipped，coverage 83.02/77.03/86.90/86.86。
  preview:mac:unsigned exit 0，packaged Electron smoke、运行包取消/未签名
  拒绝、模型密钥眼睛/加密/冷重启 PASS，已打开最新仓库预览。
  app.asar 199966102 bytes，SHA-256
  `967c349293a89a49d65af5733408089f2b35166e86bc7118fa6bf97a6fa99e18`。
  新现场证据：锁定 Pi 0.84.3 ExtensionRunner.emitBeforeProviderRequest 会捕获
  handler 异常后返回 payload，不能用普通 hook 抛错证明 fail-closed；
  session-before 类需要显式 cancel。这一轮仅关闭独立标题出口，主 Agent
  循环、压缩/分支、团队身份、撤权/续期仍待闭环。不调用真实模型，不部署 VPS。

- 2026-09-09：共享 Experience/SOP 的四个模型 Tool 将 Pi 当前 model.baseUrl/id
  逐请求传给 Host；Tool adapter 将缺失身份强制转换为 null，不能降级到用户
  governance 读取。Host 在内容 transport 前用同一授权快照的 agent-purpose
  endpoint/ID 精确匹配，URL 仅标准规范化，不将不同 path、模型大小写或
  extraction/embedding 授权互相替代。空政策拒绝，无自动模型/Provider 切换。
  用户管理读取仍要求 scope authorization，但不要求 Agent 模型授权。
  定向 5 files / 56 tests PASS，含 4 个拒绝后无内容 transport、模型规则匹配
  与四个 Tool 的 Pi 模型字段转发（合成上下文，非真实模型调用）。check:source
  exit 0：755 files / 4024 tests PASS，3 files / 6 tests skipped，coverage
  83.04/77.06/86.92/86.87。preview:mac:unsigned exit 0，packaged smoke、
  密钥眼睛/加密/冷重启与运行包取消/未签名拒绝 PASS，已打开最新仓库预览。
  app.asar 199960486 bytes，SHA-256
  `3f981fb69bf9d710d42defc3f8d52055aaf30fb27ffa9671087622383fccb774`。
  本步骤不宣称已覆盖含旧团队内容的后续模型请求、团队 Session 不可变绑定、
  撤权取消或周期续期；尚未部署 VPS，也未执行数据库迁移。

- 2026-09-09：Desktop Host 共享 Experience/SOP 四入口消费 exact-project authorization。
  校验 user/team/project、role、permission revision、政策字段/URL/去重与 lease，
  请求前记录时间并将 deadline 取 server expiry 和 start+duration 的较小值，返回
  内容前重验。不缓存/自动续期，不兼容回退旧无授权接口。定向 parser/lifetime/router
  首次 44 PASS / 1 FAIL：旧 router fixture 固定期待 8 个授权请求，新增 4 个
  scope 请求后更新为 12 并单独断言 4 个 authorization 路径，保留凭据头检查。
  test TS PASS；服务端拒绝时不执行共享内容 transport。
  修正 mock 参数类型与 Request.url 分流后，定向 45 tests PASS；最终 check:source
  exit 0：755 files / 4019 tests PASS，3 files / 6 tests skipped，coverage
  83.02/77.05/86.92/86.86。preview:mac:unsigned exit 0，通用 packaged smoke、密钥
  眼睛/加密/冷重启、运行包取消/未签名拒绝 PASS，已打开最新仓库预览。
  app.asar 199957534 bytes，SHA-256
  `c9bd4426d57b62004e06cca0bca630d7c619ec0861e7808b8346ba1df9830895`。
  此处仅授权读取，不执行模型白名单、定时续期或不可变团队 Session，也不为旧
  投影延权；VPS API 未部署、真实数据库尚未验收。无 VPS/commit/push/发布动作。

- 2026-09-09：Server 新增 team / exact-project authorization snapshots。单 SQL
  statement snapshot 校验当前 session、成员、项目 grant、有效权益并读取模型政策。
  返回 user/team/project/role、policy、issuedAt 和最长五分钟 lease，取 session/
  trial expiry 更早值。permissionRevision 绑定当前 session、scope、成员/grant
  incarnation、role、权益/政策版本，不含续期时间，不作为内容版本或排序游标。
  Rust lib 18 tests PASS（新增 2）；PostgreSQL fixture 增加未加入拒绝、加入后
  精确scope与lease上限、撤销后拒绝、团队授权不隐式包含项目。fixture 尚未执行。
  全部测试编译、Clippy -D warnings、格式、OpenAPI YAML 语法检查 PASS。
  Desktop periodic refresh/cancel、不可变 team Session、policy执行、sync freshness
  均待接入；不以服务端新 lease 为旧本地投影续权。无 VPS/migration/发布操作。

- 2026-09-09：Server migration 004 + GET/PUT team model-policy 实现政策管理真源。
  最多 32 条 purpose/endpoint/modelId，拒绝 URL credentials/query/fragment，
  允许 HTTPS 或明确 loopback HTTP，规范化后去重；缺失政策为 revision 0 + 空集。
  expectedRevision 乐观检查，team 行锁序列化首次创建和更新，事务内再次确认管理员，
  实际变更与 metadata-only audit 同事务；相同集合不增版，空集合撤销规则。
  Rust lib 16 tests PASS（新增 4），数据库 default/update/stale/clear fixture 已写。
  全部测试编译、Clippy -D warnings、格式与 OpenAPI YAML 语法检查 PASS；数据库
  fixture 未执行，不以编译证明 SQL、事务或并发版本控制已通过。
  仅本地源码，未运行 PostgreSQL、未调用模型；Desktop 政策执行与租约仍待接入，
  不宣称此接口已阻断客户端模型请求或完成旧 hosted OpenViking 切换。

- 2026-09-09：Server 现有知识入口接入显式 project membership。candidate/asset
  list 在 SQL LIMIT 前过滤，candidate review / asset detail / revoke / locator
  查询带当前 user_id、team_id 和 active-project 条件，无 admin 绕过；详情 join
  同时匹配 candidate 的 team/project，防止跨范围关联。submit/search 检查项目
  资格，legacy 外部 search 返回后重验。扩展 PostgreSQL fixture：授权前拒绝
  submit，授权后列表/详情可见，撤销后列表清空且 submit/search/detail/review/
  revoke 被拒绝。所有测试编译、Rust lib 12 tests、Clippy -D warnings PASS；
  PostgreSQL fixture 尚未实际执行，不宣称数据库/并发撤权已验证。
  已同步 OpenAPI/PRODUCT/LOCAL_MEMORY_CONTRACT。未部署或执行数据库迁移，
  versioned sync、policy/lease、Web project 管理及旧 hosted OV 切换仍待完成。

- 2026-09-09：转入 sibling server 核对权限真源，确认现有实现仍无 project_members、
  模型政策或授权租约，不能用 Desktop binding cache 冒充已验证团队身份。
  Server 新增 migration 003 显式项目成员复合外键，不自动授权 owner/admin/creator，
  不回填旧项目；PUT/DELETE project member 接口在事务内校验并锁定管理员、项目与
  目标成员，实际变更及 self-grant 一并审计。Workspace bind/get 要求项目成员资格。
  已同步 server OpenAPI/PRODUCT/LOCAL_MEMORY_CONTRACT。Rust lib 12 tests PASS，
  所有测试编译 PASS；新增数据库场景覆盖 owner 默认拒绝、幂等自我授权一次审计、
  授权后绑定和撤销后旧绑定拒绝。数据库测试尚未执行，未迁移/写入 VPS。
  知识 list/detail/review/sync 的项目过滤、模型政策、租约和 Web 管理仍待实现；
  不把此 checkpoint 部署为完整项目隔离，不启用 verified team Session。

- 2026-09-09：OpenViking 接入持久化 Desktop 来源 guard。full-history restore 和
  syncBranch 检查 pi67.memory-provenance.v1，shared/malformed/duplicate/foreign
  标记单向阻断现有 scope guard；有效 OV anchor 不能覆盖限制。缺失 Desktop 标记
  的 external 兼容模式继续原有 OV anchor 校验，不冒充新的 Desktop 私人来源授权。
  定向 3 files / 65 tests PASS（新增 5 场景），test TS PASS；覆盖离开活动分支的
  限制记录、恢复后 remember/commit/capture/replay 拒绝、队列保持及合法私人的
  正向行为。tree lock `5dd5face5eb21cb7eecd3e113d61120be0571a851c5eb13820eed047b7a53cb0`。
  `check:source` exit 0：754 files / 4003 tests PASS，3 files / 6 tests skipped，
  coverage 83.01/77.03/86.91/86.85。`preview:mac:unsigned` exit 0；通用 packaged
  smoke、模型密钥眼睛/加密/冷重启回读、运行包取消/未签名拒绝 PASS。
  已打开最新预览，包内 capability sync.ts 与源码 cmp PASS；本轮为外置扩展变更，
  app.asar hash 未变不是扩展代码未更新。无 VPS/真实模型/commit/push/发布动作。
  不宣称 team/project 身份、成员租约或只读模型历史完成，managed 仍默认关闭。

- 2026-09-09：开始持久化会话来源迁移。通过 Pi SessionManager custom entries 写
  `pi67.memory-provenance.v1`，仅空白/非 fork 的新 Session 可初始化 private origin；
  first-party shared Tools 在 transport 前写 shared-unverified，覆盖初始、替换及
  child 工具工厂。Runtime 私人 Commit 在调用 owner 前及异步 admission predicate
  扫完整 entries，拒绝未知/共享/多重/异源来源及 parentSession，不凭当前分支判断。
  定向 2 files / 12 tests PASS，test TS PASS；包括真实 JSONL reopen 与 Pi fork。
  首次 fork fixture 没有 assistant，SDK 尚未落盘，误打开不存在文件得到新 Session；
  补合成 assistant 使真实 fork 落盘后验证通过，未弱化断言。
  `check:source` exit 0：754 files / 3998 tests PASS，3 files / 6 tests skipped，
  coverage 83.01/77.03/86.91/86.85。`preview:mac:unsigned` exit 0，通用 packaged
  smoke、模型密钥眼睛/加密保存/冷重启回读、运行包取消/未签名拒绝 PASS，
  已打开最新仓库预览。app.asar 199953757 bytes，SHA-256
  `89044e2f8393c5a330ca0d84215b6085a2e9bcabdeca9dae548d444469390ee9`。
  记录不含凭据/知识正文，不创建第二数据库；这不是已验证的 team/project 身份，
  也不替代 OpenViking 自动捕获 guard、成员租约或只读模型历史。无真实模型/
  VPS/commit/push/发布动作，managed 仍默认关闭。

- 2026-09-09：共享内容请求生命周期加固。Host 在 begin/disconnect/shutdown 时
  失效旧请求并清理 binding cache，bind 开始即失效该 Workspace 的旧请求。
  binding 网络响应在写 cache 前校验；缓存命中仍检查有效登录凭据。
  Experience/SOP search/read 在网络及本地异步反馈/观测后校验登录代次和精确
  binding。23 新定向 tests PASS；现有 auth/router 9 tests PASS，test TS PASS。
  首次全量 lint 发现上一轮最后追加的 refresh 测试对 Request 使用 String(input)
  不符合 no-base-to-string；已按 Request.url / string / URL 正确分流，未放宽门禁。
  最终 `check:source` exit 0：753 files / 3987 tests PASS，3 files / 6 tests
  skipped，coverage 83.00/77.01/86.94/86.85。`git diff --check` PASS。
  `preview:mac:unsigned` exit 0，通用 packaged smoke、模型密钥眼睛/加密保存/
  冷重启回读、运行包取消/未签名拒绝 PASS，已打开最新仓库预览。
  app.asar 199937570 bytes，SHA-256
  `08cd49be968f8d95bbc66dd020bdbde0aa9fae09e8cb6cfdf3106fec8ddff1eb`。
  这是迟到响应保护，不是持久化会话归属、成员租约或已进入 Pi 历史内容的撤权
  证明。边界测试使用合成 Gateway/credential broker，不冒充真实服务器端到端。
  无真实服务器请求、生产写入、commit/push/发布；managed 仍默认关闭。

- 2026-09-09：检查团队撤权前置授权链路时发现自动 refresh 未绑定登录代次。
  本轮先修该已观测实现缺口：begin/disconnect/shutdown 使旧 refresh 失效，
  阻断凭据访问，在串行 secure store 前后校验，迟到写入先清理再允许下一变更。
  disconnect 仅撤销捕获的凭据，不为退出续期；迟到 logout 不清除更新登录。
  定向 2 files / 10 tests 与 test TypeScript PASS：覆盖三个失效入口、两个
  store-ack 竞态、正常 single-flight，以及迟到 logout 与新账号登录交错。
  无真实凭据/服务器请求。`check:source` exit 0：752 files / 3964 tests PASS，
  3 files / 6 tests skipped；coverage 82.98/76.99/86.93/86.84。
  `preview:mac:unsigned` exit 0，通用 packaged smoke、密钥眼睛/加密保存/冷重启
  回读、运行包取消/未签名拒绝 PASS，已打开最新仓库预览。
  app.asar 199936042 bytes，SHA-256
  `efd7947f661ffe8fb2374f0a9a24d384d5d9fa4f78f2cee197e3cb1c992e5122`。
  授权竞态由合成 transport/broker 测试证明，通用 smoke 不冒充真实账号端到端。
  本轮不宣称已完成不可变团队 Session 来源、只读历史、取消已开始模型请求或
  旧 payload 来源审计；无 commit/push/VPS/发布，managed 仍默认关闭。

- 2026-09-09：队列回放增加精确 OV Session/lineage 边界。当前 SyncManager 必须有
  有效私人 anchor，并捕获当前 OV id；异步回放若 lineage 改变即停止。storage context
  的 Session 条件覆盖 listing、stale processing recovery、claim/release、retry/
  dequeue 和 TTL cleanup；其他会话文件不发送、不恢复、不清理。createSession 的
  payload id 也须匹配。原目录与 dedup 格式不变，不迁移/删除队列。
  定向 lifecycle/sync/outbox 60 tests PASS（新增 5 场景），test TypeScript 与
  Extension typecheck PASS。旧 scope 测试最初期待新会话回放任意旧 id，现改为恢复
  原会话，同时保留 scope 隔离和 managed 端口/密钥轮换的正向验证。
  当前 tree lock `1b2cfaab39206644909bce14b3ea247d57c922d7283e3a1b401dfe26d97cfeda`。
  `check:source` exit 0，coverage 82.94/76.96/86.88/86.80；全量 stdout 被截断，
  不推断测试总数。`verify:extension-adapters` 与 `git diff --check` PASS。
  `preview:mac:unsigned` exit 0；通用 packaged smoke、模型密钥眼睛/加密保存/
  冷重启回读、运行包取消/未签名拒绝 PASS，已打开新仓库预览。
  包内 sync.ts、scoped-pending-queue.ts、shared/pending-queue-storage.mjs、
  shared/pending-queue.d.mts 与源码逐字节一致。app.asar 199935158 bytes，
  SHA-256 `bb0b2260d35799a565ac355c9a9c34bbe795c80bf9dfd1cafc0027231fbecacc`；
  本轮改动位于外置 capability，不能仅用未变的 app.asar hash 证明新队列代码。
  runtime smoke screenshots：`artifacts/memory-ui/runtime-yGE6Hg`。
  不以回放隔离冒充旧 payload 内容来源审计或团队撤权验收；无真实模型请求、
  VPS 写入、commit/push/发布。下一步仍为不可变团队归属与撤权只读历史合同。

- 2026-09-09：工作台手动 Commit 改为 Host -> 唯一已初始化/未关闭 Task ->
  精确 idle Pi Session -> 当前 ResourceLoader EventBus -> OpenViking owner ->
  SyncManager 当前 OV lineage；不再用 Pi sessionId 直接拼接 HTTP commit。
  Host 先拒绝 read-only/off，Runtime 检查外部文件变更、会话/代次/切换状态；
  owner 在异步 health/flush 后再次检查同一来源/隐私 guard。零/重复 owner、
  并发 Commit、错误 Workspace/Session、未知/共享来源明确失败，无 HTTP fallback。
  reload/shutdown 取消注册并使旧 handler 失效；仅返回精简 receipt。
  managed job id 不交给旧外部 candidate tracker，managed candidate 同步仍待切换。
  定向 9 files / 61 tests PASS，test TypeScript PASS；包括真实 Pi SDK 的
  initial/new/reload 路径和真实 EventBus + OpenViking lifecycle 的提交/拒绝测试，
  均使用合成数据与假 transport，无真实付费模型。旧 candidate 测试最初仍期待
  HTTP task id，更新为显式 owner receipt 后通过，并断言无 HTTP commit。
  扩展 tree lock：
  `21bff1e6e271d36bfc7dd51a91e6f0cc4210c93875dc801fa84c5d34e729d6b4`。
  同一 SyncManager 的自动/手动 Commit 共用在途互斥，snapshot OV target，
  失败不向已变化 lineage 排入旧 Commit；成功/503 并发回归均 PASS。
  追加 lifecycle/sync/outbox 55 tests PASS，受影响 3 包 typecheck、定向 lint PASS。
  首次全量在 Host 遗留 `result.reason` 字段处失败，已改为精确的无外部 candidate
  receipt 描述；目录门禁发现 router 超一行，仅去掉冗余空行，未放宽上限。
  第二轮全量 3951 PASS / 1 FAIL，模块闭包门禁发现分发 allowlist 漏掉
  `desktop-memory-commit.ts`，已补精确文件清单，保留原模块完整性门禁后重验。
  最终 `check:source` exit 0；分发/源码锁定向 14 tests、`verify:extension-adapters`
  PASS。该次全量 stdout 被工具截断，记录成功退出，不冒用前一次失败运行的测试计数。
  coverage summary：82.94 statements / 76.96 branches / 86.88 functions / 86.80 lines。
  `preview:mac:unsigned` exit 0，通用 packaged smoke、模型密钥眼睛/加密保存/
  冷重启回读、运行包取消/未签名拒绝均 PASS；DMG/ZIP 校验后打开最新预览。
  包内 desktop-memory-commit.ts/index.ts/client.ts/sync.ts 与源码 cmp PASS；
  新模块 SHA-256 `39cca3a901abbbe98457bf1d0f5e60efeea79532e329f94e70b2e75562a41745`。
  app.asar 199935158 bytes，SHA-256
  `bb0b2260d35799a565ac355c9a9c34bbe795c80bf9dfd1cafc0027231fbecacc`。
  手动提交新链路的行为证据为 SDK/EventBus/Extension 合成测试；通用 packaged
  smoke 和 cmp 不冒充真实付费模型提取或团队端到端验收。无 commit/push/VPS/
  发布动作；managed 继续默认关闭。下一步：旧队列按会话来源隔离/恢复核验，
  不可变团队归属与撤权只读历史仍待完成。

- 2026-09-09：封住“私人 anchor 仍有效、但后续已调用共享 Experience/SOP”的
  Extension 私人捕获路径。Pi tool_call 在共享执行前单向阻断 SyncManager，
  覆盖自动捕获、remember、Extension commit/takeover/shutdown 与 pending replay；
  restore 读取完整 Pi entries，不能用活动分支/压缩摘要隐藏历史共享调用或结果。
  不删除队列/历史，不引入第二份会话真源，普通文本提及与普通工具不误判。
  定向 25 tests PASS（新增 9 个场景）；一个正向夹具最初把默认不捕获的纯工具调用
  误计为文本，已加入真实 assistant 文本，保留捕获及不误拦断言后 PASS。
  扩展源码锁同步为 `255059a2959b0ec4f71d523d1854c300890640bfb58de0e387308936adad3286`。
  首次全量被 index.ts 的 460 行结构门禁拦截；将等价的 URI guard 返回分支简化，
  未抬高上限或删减行为，重新验证。
  最终 `check:source` exit 0：748 files / 3932 tests PASS，3 files / 6 tests
  skipped，coverage 82.93/76.93/86.87/86.79；`verify:extension-adapters` PASS。
  `preview:mac:unsigned` exit 0，通用 packaged smoke、模型密钥眼睛/加密/
  冷重启回读、运行包取消/未签名拒绝 PASS；DMG/ZIP 校验后打开最新仓库预览。
  包内 capability 的 index.ts/sync.ts 与源码逐字节 cmp PASS，SHA-256 分别为
  `2225961bc5489955f23758b613dcb74859dc650a6831cdc1ba207ebbaf6c3e23` /
  `c76d47d18d4ed7b21737c93bab6fe539c75f676b787e5628b4ec49f2aca13e8d`。
  新捕获规则由 Extension lifecycle/sync 定向测试覆盖；通用 smoke 不替代真实
  团队知识端到端验收。未做 VPS 写入、真实模型请求、commit/push/发布。
  边界：不宣称完整不可变团队来源；独立 Host 手动
  Commit、旧队列来源验证和撤权只读历史仍待切换，managed mode 继续默认关闭。

- 2026-09-09：共享 Experience/SOP 工具增加当前 Pi Session 的临时搜索选择记录，
  两类工具各自隔离，只允许读取最近一次搜索返回的精确 id，并在返回正文前核对
  projectId 与 externalRevision。新搜索立即清空旧选择；失败、超量/重复结果、
  取消、会话切换和并发过期返回均 fail closed。Host 仍逐次执行原授权访问；
  不持久化正文或把该记录当作团队身份/租约。定向 19 测试、test TypeScript、
  定向 oxlint PASS。全量 `check:source` exit 0：748 test files / 3923 tests
  PASS，3 files / 6 tests skipped，coverage 82.93/76.93/86.87/86.79。
  `preview:mac:unsigned` exit 0：通用 packaged smoke、记忆模型密钥加密保存/
  眼睛显示隐藏/冷重启回读、运行包取消/未签名拒绝 PASS；DMG/ZIP 校验后已打开
  最新仓库预览。app.asar 199920945 bytes，SHA-256
  `adb36229ac4283e4aab2c8e67bc0caea26dd299cfb08d26fd67be792ca8b450f`。
  这些 packaged 检查不是共享工具真实团队账户端到端证据；新选择约束由定向
  Tool/helper 测试覆盖。本轮没有付费模型请求或 VPS 写入。
  本轮不宣称完成不可变团队来源、团队内容禁止私人捕获、撤权只读历史或 VPS 切换。

- 2026-09-09：修复无归属摘要历史的私人记忆准入缺口。Pi SDK 中 `compaction`、
  `branch_summary` 和 `custom_message` 都可进入模型上下文，不能因为没有普通
  `message` 就在 restore 时被当作空会话自动建立私人 scope。现纳入历史检查；
  有效同会话/同 scope 标记仍可恢复，普通 `custom` 状态及模型/思考/标签/名称元数据
  不误判。Takeover 在 scope 阻断时也拒绝 overview 读取和状态追加，避免 shutdown
  写入新的无归属归档状态。未更改 Pi JSONL 内容或删除历史。
  定向 lifecycle/outbox/sync 36 测试 PASS（新增 7 个场景），test TypeScript 与
  定向 oxlint PASS。首次全量 3909 测试 PASS、1 个失败：内置扩展源码哈希未同步；
  保留 gate，更新精确 tree identity 为
  `b5fb57e400b28a644cdf88bd810f39db27e9561e18208fefee4cb5b08fcbf075`，
  对应 capability 定向 14 测试 PASS。最终 `check:source` exit 0，coverage
  82.92/76.92/86.86/86.78，`verify:extension-adapters` PASS；未改覆盖率门槛。
  `preview:mac:unsigned` exit 0，通用 packaged smoke、模型加密/眼睛/冷重启回读、
  运行包取消/未签名拒绝/清理均 PASS，DMG/ZIP 校验后已打开最新仓库预览。
  `app.asar` 仍为 199906704 bytes、SHA-256
  `b5dba4f1e179d0722f80068c5b40f1c9f41835af79baa57c67d2db0df0fb6218`；
  本轮改动在 extraResources 的 capability 中，而非 Main/Renderer asar。已将 packaged
  `capabilities/packages/openviking-pi-extension/{sync,takeover}.ts` 与当前源码逐字节
  比较，均一致。source-guard 的行为证据来自定向生命周期测试，普通 packaged smoke
  不冒称验证了完整团队来源或开启了受管记忆。未改变 UI 布局、提交、推送或部署。
  本修复不是完整团队来源合同：下一步必须把不可变 team/project provenance 接入
  `RuntimeSessionBindings` 与 `createSharedExperienceTools` 的共享内容准入链路，
  再覆盖恢复/压缩/fork/撤权；不能以工具名称猜测来源，也不能据本修复放开默认开关。

- 2026-09-09：扩展 opt-in Main 原生测试，使用同一运行包并发启动两个独立 Profile。
  `PI67_NATIVE_MEMORY_TEST_RUNTIME=<signed-local-installation-o58lbB/runtime>` 配合
  `vitest run apps/desktop/src/local-memory-service.native.test.ts` 实际 PASS，1 个集成
  场景，48.79 秒，实测 macOS 15.7.9 / arm64；test TypeScript 与定向 oxlint、diff check
  PASS。覆盖同 URI 不同内容、
  私人向量检索隔离、跨进程凭据拒绝、身份头不能改变 token 所属内容或提升管理员权限、
  两个 Profile 独立重启持久化/密钥轮换、一方重启不影响另一方、旧 token 失效、
  `.run-*` 清理及运行包树哈希前后一致。只用临时 Profile、本地合成 embedding 服务、
  内存测试签名，不读取用户配置、私钥或付费模型；finally 停止两个服务并删除夹具。
  第一轮在身份头断言处失败：误预期伪造 actor header 一律返回 401/403。核对所测
  OpenViking 0.4.16 的 `server/auth/plugins/api_key.py` 后确认该模式忽略身份头，
  改为必须读到原 token 的内容、不能读到另一 Profile 内容且 admin API 仍 403。
  第二轮完整通过；未更改产品实现、放宽认证或增加重试。此证据不是同 OS 用户文件
  沙箱、团队/项目撤权、私人捕获来源、生产签名或 macOS 最低版本认证。
  本轮仅测试与验证文档，没有可见产品变更，因此未重复打包/重启既有预览；上轮
  3903 测试与 packaged PASS 保留为当时证据，未冒称本轮重新运行全量。

- 2026-09-09：设置页新增“本地运行包”分组、Main 原生目录选择器、安装/取消与状态提示。
  Renderer 无 source/target/trust 参数；Main 校验当前 main frame 并串行化 picker/install，
  导航、窗口失效、shutdown 会取消工作；status 只表示存在，不冒充验签或服务启用。
  新增 controller/IPC 16 个回归，与 application 接线共 26 测试 PASS。
  `check:source` exit 0：747 文件、3903 测试 PASS，3 文件/6 测试条件跳过；coverage
  82.92/76.92/86.86/86.78。协议 revision 同步为
  `609aaa2c1803c4dc7896d40a5eaeb05c2fb941bee1aff261c36528dfa26bcde3`。
  PRODUCT、双主题 DESIGN、进程合同同步；L1-F/main_serial，实际使用 design-craft，
  沿用现有 Settings authority，未委派。最终 `preview:mac:unsigned` exit 0：全量
  packaged smoke、真实签名安装、取消选择、拒绝未签名目录、临时文件清理，以及模型
  加密保存/显式眼睛/冷重启回读 PASS。仅 native picker 返回受控目录，实际 IPC、验签、
  安装和加密没有 mock；签名包写入独占测试 Profile，随测试退出清理，未安装到真实
  用户 Profile。未执行手动系统目录选择器操作。此入口不下载、不启用，不使用签名私钥。
  新预览已重新打包并打开；`app.asar` 199906704 bytes，SHA-256
  `b5dba4f1e179d0722f80068c5b40f1c9f41835af79baa57c67d2db0df0fb6218`，
  modified `2026-09-09T06:40:33.818Z`。DMG/ZIP 与 smoke identity 由正式 preview
  命令校验生成；dirty 工作树本地验证不等于 exact-commit 发行。
  双主题实际截图 `artifacts/memory-ui/runtime-gynS2I/{light,dark}.png` 已查看，
  安装后 presence、禁用按钮和说明未见遮挡/溢出；仅该分组轻量视觉检查，非全页面 sign-off。
  初次夹具直接设置 `nativeTheme.themeSource` 后主题读取停滞；可见窗口仍复现。
  两次失败不算 PASS，停止对应测试进程并确认测试 Profile 清理。改为产品现有外观
  设置按钮切换主题、可见但不接收鼠标的测试窗口和 15 秒截图超时后，独立分支及
  最终完整流程均 PASS。夹具改动另经定向 oxlint；产品源码未因失败改动或放宽验签。
  Computer Use 原生管道启动失败，因此没有该工具的手动操作证据；上述来自仓库
  packaged Electron 测试及实际截图。

- 2026-09-09：补齐 Main/operator 本地签名目录安装事务与显式 CLI：source 验签/哈希、
  独占版本锁、同级私有 staging、副本再次验签/哈希、rename 发布。固定 macOS arm64
  版本，不下载、不覆盖、不启用、不迁移私有数据；应用与安装入口共用固定目录名称。
  13 个安装回归 + 10 个应用接线测试 PASS，Desktop typecheck/定向 lint/knip PASS；
  包含最后一次异步目标检查期间取消的回归，正式 rename 前再次检查 cancellation。
  取消/失败只清理本次 staging/lock；进程崩溃残留需人工精确恢复，尚无 power-loss
  durability 承诺。父目录信任边界不包含恶意同用户并发改写。CLI 真实目录安装 PASS：
  `artifacts/openviking-native/installer-validation-4Q1HZt/` 下生成固定版本目录，
  54345 文件、641306289 bytes，tree SHA-256
  `739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36`，
  与已签名来源一致，`activated=false`。来源和新验证副本均保留，未写入用户 Profile。
  本轮 `check:source` 完整门禁 exit 0（全量实际含 13 个新安装回归），coverage
  82.90/76.91/86.85/86.76；最终安装 CLI bundle 构建通过。真实副本测试后补入最后
  取消边界检查，并以定向/全量回归验证；未再次复制无变化的大目录。重复目标 CLI
  按预期 exit 1；目录清单仅一个固定版本，没有 lock/staging 残留。新增约 612 MiB
  本地验证产物保留。未改变可见 UI、未重新打包或重启旧 preview。
  用户安装 UI、下载/发行来源认证与启用仍未完成。

- 2026-09-09：安装包设置验收前发现测试隔离缺口：`--user-data-dir` 只隔离旧状态，
  新增 memory 仍会选 canonical appData。现将显式 Profile 的 memory/runtime/settings
  一并限制在 `<userData>/openviking`；无该 switch 的正常路径不变、不迁移数据，
  Renderer 无目录选择权限。增加 4 个隔离/非法路径回归，application wiring 共 10 测试
  和 Desktop typecheck PASS。新增 packaged 表单回归覆盖草稿离开确认、页签禁用、
  保存/无密钥 snapshot、眼睛显示隐藏、离开重入隐藏、冷进程重启后的显式回读；
  仅测试独占 Profile 和合成值。独立 packaged 分支实际 PASS（表单、IPC、OS 存储、
  冷进程重启）；最终 `preview:mac:unsigned` exit 0，整体 packaged smoke、DMG/ZIP
  容器校验及最新仓库预览启动均 PASS。最终 `app.asar` 199891427 bytes，SHA-256
  `a7e94099cfd605a4c5d9de56bd52d95807f427dbe6a552dad9895bb4ecdb55b9`，
  modified `2026-09-09T05:59:44.014Z`。临时测试 Profile 随测试退出清理，正常预览保留。
  现场修正两项夹具假设：macOS `/var` 与 `/private/var` 必须以 realpath 比较；
  通用 smoke 的 fake HOME 使真实 Keychain 操作失败，故保持原通用测试不变，新增
  独立 Keychain 分支，仅该分支继承系统 HOME，Pi/Desktop/memory 仍用显式独占目录。
  未放行失败、未模拟加密、未填写真实凭据。另补齐新窗口 ready/工作区打开后再进入设置
  的等待顺序。完整源码 gate 744 文件、3874 测试 PASS，3 文件/6 测试条件跳过；
  coverage 82.89/76.90/86.84/86.74，exit 0。之后只调整 smoke 夹具并复核其门禁。
  本轮 route L1-F/web/main_serial，实际使用 design-craft，保持现有 DESIGN authority，
  未改视觉组件、未启用子代理。运行证据来自受控 packaged Electron Playwright；
  无 browser67 tab 或截图新增，不把功能 smoke 当成全页面视觉 sign-off。
  上轮独立 native probe 补入正式 package script 和精确 knip entry，未放宽死代码门禁。

- 2026-09-09：新增可复测的真实 Electron Main 加密存储检查：
  `node eng/capabilities/probe-local-memory-settings-electron.mjs`。调用现有 tsdown
  构建当前 store/controller/secure-storage 源码，在仓库 artifacts 下的独占临时目录
  运行 Electron；仅合成模型与 `.invalid` endpoint，不加载产品 Main、不读取真实配置、
  不启动 sidecar 或模型请求。macOS arm64 实测 PASS：OS 加密可用、文件及解码后密文
  不含测试明文、文件 0600、get/save 无密钥、重新创建 store 后配置一致、显式查看正确、
  endpoint 不匹配拒绝、keep 保留原值。执行后清理本次独占测试目录。
  相关 store/controller/IPC 回归 3 文件 17 测试 PASS。本次仅增加验证工具和记录，
  未修改产品行为、未重新打包；该证据不是完整 Renderer→Preload→Main 的安装包交互、
  跨进程重启、macOS 14 最低版本或 Windows 认证。系统加密不可用时直接失败，无明文降级。

- 2026-09-09：用户明确将自己配置的模型 Key 改为默认隐藏、点击眼睛可查看（不是运行包
  签名私钥）。新增独立 endpoint-bound revealKey IPC；get/save snapshot 仍无 key；
  Main 在解密前后验证当前可信文档，错误脱敏。模型表单接入隐私页服务组之后，独立
  保存/撤销；已保存 key 仅显式读取到组件局部 state，隐藏/失焦/页面隐藏/卸载丢弃显示引用，
  generation 阻止迟到结果。保留草稿替换与显示副本的区别，不宣称 JS heap 密码学擦除。
  L1-F/web/main_serial，实际使用 design-craft + browser67，保持 PRODUCT/DESIGN 双主题
  authority 与 React Aria；无子代理。专用 managed browser 合成夹具验证首次不读 key、
  点击显示、再次隐藏清空、取消迟到结果、blur 清空。真实用户 key 未读取/未写入。
  浅色截图 880×825 SHA `46c3cbbeba69c4e2bb33adb9e63d0a6d02c91acfeb8c7a263417d0c43e0ed088`；
  修正窄窗 eye 换行后深色截图 600×825 SHA `62b8d95e7184959bb78ddf8ca14d99fbf6fd7e3de445dc1db0417035cc74e099`，
  均在 repo 外 `.browser67/runtime/runs/pi67-local-memory-settings/`。样式热更新曾重载夹具，
  空页面那次不作为截图证据，重新挂载后捕获有效截图。
  reveal 后端 11 tests passed；首次完整 gate 743 files / 3868 tests passed、6 tests skipped。
  集成发现原 Settings guard 只能登记一个表单，已改为聚合所有 dirty/busy 事务，并对本地
  模型未保存修改禁用跨 Memory 页签导航；2 项聚合回归通过。最终 `check:source` exit 0：
  744 files / 3870 tests passed、6 tests skipped；coverage 82.89/76.90/86.84/86.74%。
  最终 `preview:mac:unsigned` package/smoke/open 全部通过，app.asar 199891061 bytes，
  SHA `de5b034a5f5318433ad5fb480df80e82ca9704c47d49df19965e0ecc2837d2d7`，
  mtime `2026-09-09T05:34:21.046Z`，启动 PID 39214（瞬时运行证据）。原临时 Vite 已停止，
  同实例 managed tab finalize 验证关闭 1/1、remaining 0、errors 0，用户 tabs 保留。
  组件默认/显示/隐藏/取消与两主题截图已核验；完整页面交互一致性 sign-off=incomplete，
  不能以组件夹具及通用 smoke 冒充整页验收。尚未验证真实用户 key
  的 Keychain readback、完整页面键盘/草稿导航、Windows 或记忆默认启用。
- 2026-09-09：接通 `DesktopSystemBridge.localMemoryModels` 可选 rollout get/save API，
  Preload → 独立 Main handler → 串行设置 controller → 原有加密 store。仅当前主窗口的
  mainFrame + Main 选择的精确 renderer URL 可调用。TypeBox 精确有界输入、回读投影校验；
  返回 hasApiKey 而非 key。save 明确 keep/replace，首配/换 endpoint 必须替换，串行读保留写
  并快照请求，避免并发/调用方修改导致错误目标。跨 IPC 错误固定脱敏。
  定向 3 files / 15 tests passed；类型/lint/架构通过，首次完整 gate 因入口行数超过 1 行
  停止，已仅移除空行修正。完整复验 `check:source` exit 0：743 files passed / 3 skipped；
  stmt/branch/function/line coverage 82.88/76.89/86.83/86.74%，diff 检查通过。
  没有新增依赖，沿用 TypeBox；协议 revision 为
  `75901bac219c2b661eecc7e5290fb79ef1898d1c2976eb88f2c2ae948baf9b5c`。
  仅完成设置通道，未接 UI 表单/未真实写入用户配置/未探测付费模型/未激活记忆；
  保存不热重启，已有 index 不兼容仍须单独重建。没有安装/上传/部署/提交。
- 2026-09-09：Main 在 app ready 后装配 `createApplicationLocalMemory`，使用已有
  DesktopSafeStorage 和 Supervisor 私有模型 client，并接入已有 broker/shutdown。
  macOS arm64 固定 `appData/New Money/openviking`，选择独立版本 child
  `runtime/openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64`；不迁移原会话，
  不提供 shell/Renderer path 或 key override，不采用 Lab/artifacts。构造无磁盘/加密/启动副作用，
  Windows 原生未验证继续不绑定。缺少模型先失败，缺少安装不解析模型凭据/不创建身份。
  Main 环境和 broker 定向 3 files / 14 tests passed；完整 `check:source` exit 0：
  741 files / 3857 tests passed，6 tests skipped；stmt/branch/function/line coverage
  82.86/76.87/86.81/86.72%，diff 检查通过。
  Host managed flag 保持 off，尚无用户模型设置入口/正式运行包安装；不宣称默认启用或
  packaged 验收。没有修改用户配置/数据、安装签名包、上传、部署或 Git 提交。
- 2026-09-09：针对实测全树校验耗时，将逐文件串行读取改为最多 8 个文件并行流式读取，
  保持原有 sorted DFS 哈希顺序、完整内容/mode/inode 检查，不加可信缓存，不跳过验签。
  目录递归和链接记录前 drain，错误/取消后等待全部活动句柄关闭。测试发现 metadata await
  期间取消后创建已取消 stream 会产生未捕获 AbortError，已在创建 stream 前补取消检查；
  修复后定向 3 files / 25 tests passed，含 5 次取消回归；最初有未捕获错误的运行不计通过。
  M4 Pro / Darwin 24.6.0，既有签名包 54345 files / 641306289 bytes，前后各 10 次：
  serial ms `[8703,5488,5889,5765,5760,5689,5705,5844,5845,5547]`，
  bounded-eight ms `[3185,3092,3061,3101,3059,3079,3079,3238,3091,3141]`；
  p50 5760→3091ms（约 -46%），nearest-rank p95 8703→3238ms。20 次 tree 均与原签名一致。
  此为分批、带 OS cache 的源码函数测量，不是交错 A/B、packaged 或 cold-start SLA；
  不改变用户数据/配置/运行包，不重新签名/上传/部署。真实 Main-service/native 集成测试
  1/1 passed（临时数据/测试 key，34.55s），覆盖启动/重启、私人持久化及 tree 未变化。
  完整 `check:source` exit 0：740 files / 3851 tests passed，6 tests skipped；
  stmt/branch/function/line coverage 82.86/76.86/86.81/86.72%，diff 检查通过。
- 2026-09-09：完成独立本地签名副本工具，不覆盖原包、不复制私钥，拒绝错误 key、
  宽松权限、符号链接、源内容漂移、递归输出及位于运行包内的私钥；定向 7 tests passed。
  已授权专用 key 实际签署 `artifacts/openviking-native/signed-local-installation-o58lbB`，
  Main reader + source-pinned verifier 通过；运行包 54345 files / 641306289 bytes，
  tree SHA-256 `739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36`。
  此副本真实原生 probe 的 13 项检查通过，100 次合成 embedding 调用；回执为
  `/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/new-money-native-probe-kdmEJC/receipt.json`。
  probe 后 tree 未变化，单次全树校验 11064ms（非冷启动基准、同时有源码测试负载），
  当前服务每次启动重新校验，不是每次提问；默认启用前仍需启动性能验证/优化。
  完整 `check:source` exit 0：739 files / 3842 tests passed，6 tests skipped；
  stmt/branch/function/line coverage 82.85/76.86/86.80/86.71%，diff 检查通过。
  签名只证明固定 key 认可的字节，不补齐 upstream interpreter
  provenance、macOS 14 最低主机、Windows、完整 packaged Desktop 或真实模型语义质量。
  本次未发布/上传/部署/默认激活；原包、旧测试包保留，增加约 612 MiB 本地诊断副本。
- 2026-09-09：用户明确授权后，专用 Ed25519 密钥已创建于仓库外
  `/Users/gaoqian/.config/new-money-signing/`，目录 0700、三份文件 0600；工具拒绝已有
  目标，不覆盖或轮换。私钥为未加口令加密的 PKCS8，仅当前用户可读；尚未建立备份。
  保存后挑战签名、验签、篡改拒绝通过。Main 默认固定对应公钥（SPKI SHA-256：
  `637e17fea62eaca283d4179548edeae0ce144472fea6fbc08adce28bd9cdbb31`），应用不读取私钥。
  定向 2 files / 10 tests passed，含默认信任拒绝临时测试包且不创建身份或启动进程。
  完整 `check:source` exit 0：738 files / 3835 tests passed，6 tests skipped；
  stmt/branch/function/line coverage 82.85/76.86/86.80/86.71%，diff 检查通过。
  尚未用该 key 签署原生运行包；不自动启用记忆，
  不含上传、发布、VPS 部署或 Git 提交。覆盖下方历史的“尚未生成公钥”状态。
- 2026-09-09：补齐 Main runtime environment → utility-process 启动参数 → Host 构造
  的受管模式选择。`PI67_MANAGED_LOCAL_MEMORY` 每次由 Main 覆盖为精确 0/1，父 shell
  不能开启模式；无 runtime setup 时也覆盖为 0。Host 在构造前解析，非法值固定报错，
  不把输入值写入错误，不发送安装路径、公钥或模型凭据。该选择在本次 Host 生命周期内固定。
  Main 环境、Main broker、Host parser/broker、真实 Pi Task 定向验证 4 files / 16 tests
  passed；完整 `check:source` exit 0：737 files / 3832 tests passed，6 tests skipped；
  stmt/branch/function/line coverage 82.85/76.86/86.80/86.71%，`git diff --check` 通过。
  尚未生成或绑定正式签名信任公钥，测试 key 不作为生产信任；没有激活默认用户记忆。
  正式密钥创建/签名与部署授权分开；模型设置 UI、Main 安装选择和 packaged 联调仍待完成。
- 2026-09-09：接通显式 Host `managedLocalMemory` → TaskRuntimeRegistry → PiSdkRuntime
  → session services → Pi ResourceLoader EventBus → 现有 OpenViking initializer。
  broker 的存在不等于选择受管模式；默认未启用，缺失 broker 不回退到外部模式。
  采用 SDK 已有会话级 EventBus 传递 scoped connection，不另建 loader、不重复加载 owner；
  enabled/owner 检查之后才请求连接。失败成为脱敏的 Extension load error，Pi 保持可用。
  此 bus 是同一 Host 内 admitted Extension 的通信机制，不宣称它隔离恶意同进程代码。
  38 项定向回归通过；另以真实 TaskRuntimeRegistry + PiSdkRuntime + Pi ResourceLoader
  和 Host parent broker 验证可用/NOT_CONFIGURED 两条路径，均能建立 Pi Session。
  可用路径仅请求指定 loopback，携带 scoped key 并禁止 redirect；不可用路径无 HTTP 请求。
  后者两项组合测试使用合成 parent reply/HTTP，不是 Electron IPC 或真实原生服务联调。
  准备模块闭包/锁定测试 14 项通过，内部 extension tree SHA 已按当前内容刷新。
  初期测试夹具补上 SDK EventBus，保持生产 SDK 合同；错误断言保留 SDK 的明确前缀；
  入口行数门禁保持不变。完整 `check:source` exit 0：737 files / 3831 tests passed，
  6 tests skipped；stmt/branch/function/line coverage 82.85/76.85/86.80/86.71%。
  Pi Runtime `build:runtime` 实际 JS/declaration 构建通过，构建后 structure 与 diff 检查通过。
  Main trust/settings 应用装配、默认启用、团队 provenance/投影和 packaged 验证仍待做；
  本轮不变更用户配置、不启动用户记忆、不部署/提交/推送。
- 2026-09-09：实现 `createManagedOpenVikingExtension` 显式 Pi ExtensionFactory 入口，
  受管私人连接替换扩展 transport，不从 environment/ovcli 推断受管身份；外部默认入口保留。
  发现原 outbox scope 包含 endpoint，不适合随机端口的本地服务。受管模式改用独立 namespace
  + localProfileId/account/user/workspace peer，端口/key 轮换保持归属；外部/旧队列不自动迁移。
  仅允许 loopback 和对应 private-profile account，并禁止受管 HTTP redirect，避免离开本机。
  定向回归证明待发送私人内容在端口轮换后重放到新连接；不同 profile/user/peer、外部
  endpoint 仍隔离，非法连接拒绝。真实 Pi ResourceLoader 成功加载显式 factory，未访问模型。
  初次结构检查遇到入口行数超限，factory 移到独立模块并保持 460 行原门禁；无循环依赖。
  首次完整测试还发现准备工具的模块清单缺项和内部 source tree lock 过期；补入两个
  managed 模块、验证两个入口的完整依赖闭包，并实测更新 source tree SHA。
  准备工具/outbox/Pi loader 共 32 项定向测试通过；最终 `pnpm run check:source`
  exit 0：735 files / 3822 tests passed，6 tests skipped（含显式 opt-in native 测试）；
  stmt/branch/function/line coverage 82.83/76.83/86.74/86.69%，`git diff --check` 通过。
  生产 Host 选择、Main trust/setup 与设置入口仍未接通，
  不把 factory 证明当作默认应用、真实 Pi Recall 或打包证据。无用户配置变更/部署/提交/推送。
- 2026-09-09：新增显式 opt-in 的 Main service 原生组合测试，不模拟 spawn。
  使用已验证 `test-installation-rVt9TE/runtime`、临时数据目录、内存测试签名和 loopback
  synthetic embedder，实际经过 `LocalMemoryService` + `LocalMemorySupervisor`。
  错误 trust key 在创建身份前拒绝、并发 connect 合并、private key 无管理权限、私人内容
  写入及服务重建后读取、localProfileId 保持、key 轮换、临时配置清理与 runtime tree 不变
  首次实测全部通过（单项组合测试 46.92 秒）。测试结束停止自己的子进程并清理合成数据；
  不修改已有运行包、不加载用户配置、不调用付费模型。普通无环境参数调用已验证为 skipped。
  Desktop typecheck、lint、architecture、structure 通过；初次类型检查指出 broker reply
  可为 undefined，补上显式拒绝后通过。最终 service/native/supervisor 组合回归
  3 files / 13 tests passed，真实原生项 45.78 秒，`git diff --check` 通过。
  本轮无生产源码变更，未重复全量 coverage；上轮全量结果不冒充本轮重新执行。
  本轮只补实际集成证据及维护入口，不是 Pi consumer、应用 entrypoint、Keychain、
  production trust 或 packaged Desktop 已完成；不改变默认路径，无部署/提交/推送。
- 2026-09-09：补齐开发运行包安装目录生成端，准备工具现在保留独立的 test-installation
  副本，检查原 tree 与复制 tree 一致，再用临时 Ed25519 key 经实际 Main reader/verifier
  验证 manifest 格式。临时公私钥均不落盘，不设置默认 trust；源运行包不覆盖。
  生成端与准备工具共 5 项定向测试通过。实际安装目录
  `artifacts/openviking-native/test-installation-rVt9TE/assembly-receipt.json` PASS，
  54,345 files / 641,306,289 bytes（新增约 612 MiB 开发产物），tree SHA-256
  `739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36`。
  从该目录运行原生探针 13 项全通过，回执
  `/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/new-money-native-probe-VACmc5/receipt.json`；
  启动后再次扫描 tree 未变。测试使用 synthetic vectors，本机 macOS arm64；不证明
  真实模型语义质量、macOS 14 最低版本主机、Windows、正式签名或 packaged Desktop。
  本轮复用了已锁定准备产物，未重新安装全部依赖；更新后的完整 preparation 流程尚未整体重跑。
  首次全量检查与大运行包复制并行时出现 3 个 worktree 测试超时及 1 个夹具 ENOENT；
  资源争用仅为待验证解释。失败的 3 个文件单独复核 25 tests 全通过，未修改其测试/超时。
  停掉额外原生/复制工作后完整 `pnpm run check` exit 0：735 files / 3819 tests passed，
  5 tests skipped；stmt/branch/function/line coverage 82.83/76.83/86.74/86.69%。
  `git diff --check` 通过。应用默认路径仍未切换，无 commit/push/deploy。
- 2026-09-09：新增固定目录的 runtime metadata reader 与 `createInstalledLocalMemory`
  装配入口，组合 encrypted settings、私有模型 client、配置 loader 与生命周期 service。
  公钥必须由 Main 单独提供，安装目录不能自带信任；metadata 有界读取并检查替换/链接，
  writable memory 与安装目录做 lexical/canonical overlap 检查，无下载/默认 key/自动采用。
  7 项定向测试通过，含重新打开后身份稳定、runtime/signature/key 篡改拒绝、元数据界限、
  取消及目录安全。夹具为合成 tree/临时签名 key/mock native，不是安装器或正式签名包。
  首次全量检查遇到 extraction 凭据轮换测试失败（单独运行通过）；测试直接覆写 auth.json
  与解析后的后台 prewarm 存在交错。改用产品既有 getGlobal/storeGlobalCredential revision
  更新流程，未改变生产 fail-closed 合同或增加重试。解析/prewarm 共 10 项定向回归通过。
  最终 `pnpm run check` exit 0：734 files / 3817 tests passed，5 tests skipped；
  stmt/branch/function/line coverage 82.83/76.83/86.74/86.69%，`git diff --check` 通过。
  应用 entrypoint 的真实 installation/trust 选择和设置 UI
  尚未绑定，不切换默认路径；旧 unsigned preparation receipt 不冒充新的安装布局。
- 2026-09-09：新增 `LocalMemoryModelSettingsStore`（Main-owned 加密文件，抽取只存
  Pi 选择，不复制 Pi key；embedding 显式参数及 key 加密保存）及配置 loader。
  通过既有 DesktopTextEncryption 接口，无明文 fallback；原子替换、队列输入快照、
  锁定/损坏/符号链接拒绝，配置不得提供解释器路径或信任公钥。
  14 项 settings/service 定向测试通过，含配置 loader→签名准入→native adapter
  组合测试。加密为测试专用 AES-GCM、native spawn mock；不是真实 Keychain、
  付费模型或打包应用证据。本轮未写用户配置、未切换默认记忆路径。
  最终 `pnpm run check` exit 0：733 files / 3810 tests passed，5 tests skipped；
  stmt/branch/function/line coverage 82.82/76.81/86.73/86.68%，`git diff --check` 通过。
  设置 UI/commands、应用级 provider 实例化、正式运行包
  信任配置和 Pi memory consumer 仍待做。
- 2026-09-09：接入 Main↔Host 私有 extraction resolve/cancel/result，request 仅接受
  Provider/Model，result 不经过 Renderer。Host 复用现有 configuration service，
  Main 绑定 ready/current Host、requestId 和所选模型，覆盖关闭/替换/取消/超时与迟到回包。
  12 项定向测试通过，包括真实 AgentHostServer + Pi 配置夹具（无 Agent runtime加载、
  无付费模型请求）和 Main supervisor 路由。协议 revision 更新为
  `b8ef089ba0d19259d77660b1838bdb577bd82ec5b93705c6f167aeb9963fd5e8`。
  首次全量检查因两个入口文件各超结构门禁 1 行停止；保持原门禁，做等价排版/返回简化后重跑。
  最终 `pnpm run check` exit 0：732 files / 3803 tests passed，5 tests skipped；
  stmt/branch/function/line coverage 82.80/76.79/86.71/86.66%，`git diff --check` 通过。
  持久选择、embedding 配置、Main service loader、正式信任配置
  和 Pi memory consumer 仍待接通，本轮不切换默认路径、不打包或部署。
- 新增 Host/Pi-owned `resolveLocalMemoryExtractionModel`，复用当前 Pi configuration
  service 和 ModelRuntime 的明确模型选择/凭据解析。无新增 auth 文件或模型目录，
  无 Renderer secret-bearing command/event，不改变 Agent 当前模型。
  8 项定向测试通过（实际 Pi 配置夹具 + 合成凭据，无模型请求），覆盖凭据轮换、
  缺失模型、协议不兼容、OAuth 拒绝、额外 headers/env 拒绝、endpoint override、
  取消和错误脱敏。Host→Main 私有配置交换、持久选择及 embedding 配置仍待接入。
  本轮最终 `pnpm run check` exit 0：729 files / 3794 tests passed，5 tests skipped；
  stmt/branch/function/line coverage 82.77/76.76/86.68/86.64%，`git diff --check` 通过。
  本轮无产品默认路径/界面变更，未重新打包或执行外部模型请求。
- 配置接入前发现模型切换的持久化边界尚未强制执行，先补 `embedding.json` 非敏感
  绑定（protocol/endpoint/model/dimension 的 SHA-256，不含 API key）。
  Main service 在 spawn 前校验；模型/维度/endpoint 变化、损坏记录和已有无绑定数据
  一律保留原内容并拒绝自动采用。并发初始化不覆盖，密钥轮换不要求重建索引。
  7 项 binding 定向测试通过；service 新增 reopen 后维度改变不得 spawn 的回归。
  最新真实原生回执：
  `/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/new-money-native-probe-YmCQti/receipt.json`
  13 项 PASS / 100 synthetic embedding calls，新增拒绝不兼容模型/维度后用原配置
  重启并读回旧数据。最终 `pnpm run check` exit 0：728 files / 3786 tests passed，
  5 tests skipped；stmt/branch/function/line coverage 82.76/76.74/86.68/86.63%。
  `git diff --check` 通过；实际索引重建/原子切换及模型安全存储接入仍未实现。
- 新增具体 `LocalMemoryService`，组合共享 tree hash、外置信任公钥签名校验、
  稳定本地身份和原生 supervisor，已通过现有 Main broker 的组合测试。
  签名/内容/目标篡改在身份创建及 spawn 前拒绝，崩溃重启重新测量，不复用准入缓存。
  6 项 service、4 项 Host broker、3 项 preparation 测试通过。
  现有可搬移运行包用共享校验器重新测量：54,345 files / 641,306,289 bytes，
  SHA-256 `739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36` 未变；
  本机单次测量 9,873 ms（不是 cold-start/p95 或正式签名包证据）。
  因此服务启动含校验预算设为 60 s，Host reply 70 s，覆盖 native cleanup；
  本轮最终 `pnpm run check` exit 0：727 files / 3778 tests passed，5 tests skipped；
  stmt/branch/function/line coverage 82.75/76.74/86.67/86.62%，`git diff --check` 通过。
  未配置生产信任锚，不把临时测试密钥作为正式信任；本轮无用户可见切换，未重新打包。
- 新增 Main-owned 本地身份存储与 macOS 原生进程适配器；probe 已使用实际模块。
  `profile.json` 仅存 UUID/version；并发首次加载一致，损坏身份/孤立 data 不自动重建。
  子进程随机 loopback、独立进程组、限定启动/退出时间；数据与运行目录分离。
  根密钥/模型密钥通过子进程专用环境变量注入，临时 JSON 只存占位符；返回私人 scope
  的 user key，不能访问 root accounts API。当前模型适配明确限定 OpenAI-compatible。
  本轮 8 项身份/进程测试通过，覆盖并发身份与同步/异步启动失败清理。最新 native 回执
  `/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/new-money-native-probe-JxBskP/receipt.json`
  12 项通过：含私人内容重启持久化、稳定本地身份、非 root 凭据、模型名/密钥字面量
  插值隔离和临时配置清理；
  100 次 synthetic embedding 调用，无付费模型/真实用户数据。最终 `pnpm run check`
  exit 0：726 files / 3771 tests passed，5 tests skipped；stmt/branch/function/line
  coverage 82.74/76.73/86.66/86.61%。`git diff --check` 通过。
  Windows 原生适配器仍拒绝启动；生产模型配置/安全存储/可信包提供方与 Pi 工具接线待做。
  生产 transport gate 补齐 `.mts/.cts` 扫描，仅对 Main 原生适配器的即时释放随机
  loopback 端口预留开放窄例外；3 项门禁回归继续拒绝公开/固定端口、额外监听、
  connection handler、WebSocket 及缺失认证/进程组约束。
- 已加入 Main↔Host `local-memory-connect` 内部 broker，纳入 protocol revision。
  Main 的当前 Host 身份检查与退出清理、Host 的超时/关闭/迟到回包处理已接入 entrypoint；
  请求不接受任意 endpoint/account/model，凭据回包不经过 Renderer。生产 service provider
  和 Pi extension 消费者尚未绑定，不把这个传输层 checkpoint 说成完整记忆功能。
  10 项新 broker/Host routing 测试通过，既有 supervisor/enterprise 相关回归通过。
  结构门禁要求 supervisor 保持 460 行以内，已抽出两个私有 broker 共用的身份/回包路由，
  未放宽门禁；同时拒绝应用 stopping 后的凭据写操作。
  `corepack pnpm run check` exit 0：723 test files/3756 tests passed，2 files/5 tests
  skipped；coverage Statements 82.72%、Branches 76.73%、Functions 86.63%、Lines 86.57%。
  protocol revision `136096971574c6f386f548f7b571714075a6281cb7e6b7a31c2c28d737858181`。
  `preview:mac:unsigned` exit 0：重新打包、darwin/arm64 packaged smoke、DMG/ZIP 校验
  和仓库 app 打开通过；Main/Host 启动、warm/cold restore 与主动退出回归通过。
  app.asar SHA-256 `e8debddcb53d3642e85185600b1d8ed4f0e1e5af6a2d273c642e8793b13bcd2e`。
  本机预览包含已有 WIP，不是 exact-SHA 发布；smoke 不证明 managed OpenViking 功能已启用。
- 新增 Main-owned sidecar lifecycle 与 Ed25519 manifest 校验模块，当前由开发准备/
  native probe 实际调用，尚未接入 Main→Agent Host 的生产按需凭据/模型配置链路。
  生命周期覆盖启动合并、退出抢占、迟到句柄清理、失败去重、10 分钟 3 次失败封锁；
  校验覆盖独立可信 key、签名/内容/目标/版本漂移及恶意 manifest。13 项相关测试通过。
  新增 `.mts` 源码明确纳入 Desktop typecheck、coverage、结构及架构 import 解析。
  native probe 回执 `/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/new-money-native-probe-gyi0dq/receipt.json`
  7 项通过；复核原生包 hash 未变，实际包 hash 的临时 Ed25519 签名校验通过。
  临时 key 未持久化，不是正式运行包签名或生产信任配置。
  `corepack pnpm run check` exit 0：全部源码门禁通过；coverage Statements 82.67%、
  Branches 76.69%、Functions 86.60%、Lines 86.53%。未改用户可见运行链路，本轮未重打
  Desktop preview；新 lifecycle 的真实进程证据来自独立 native probe，而非 packaged Main。
- 新增 `prepare:openviking:native` 开发准备工具：复制独立 CPython（不继承其
  site-packages）、按 hash lock 安装 166 个依赖、拒绝逃逸符号链接、搬到中文/空格路径，
  再以 `-I -B` 运行真实 native probe。3 项准备工具测试与 structure/knip/oxlint 通过。
  回执 `artifacts/openviking-native/preparation-yb5ByG/receipt.json`：7 项原生测试通过，
  63 次合成 embedding 调用；运行后独立复核树 hash 未变化。
  runtime 共 54,345 文件、641,306,289 bytes；hash
  `739107d2ff271b8f0830d22bbb62254c988d8f4cda0558c7a703401f19506f36`。
  这证明本机可搬移 vectors-only 路径，不证明完整文档处理/真实模型、跨机器或 Windows。
  Python 来源仍为本机 operator input，包未签名、未被生产下载器或 Desktop 自动启用。
- macOS 基线改为用户批准的 14+，并增加 unsigned packaging 的实际 Info.plist
  检查，拒绝 LSMinimumSystemVersion 漂移。相关 packaging/branding 8 测试、oxlint、
  git diff --check 及更新后的 OpenSpec 严格验证通过。已重新生成当前工作树 app，
  原生 plutil 读回 LSMinimumSystemVersion=14.0.0。`preview:mac:unsigned` exit 0，
  darwin/arm64 packaged smoke、DMG/ZIP 容器校验和仓库 app 重新打开通过。
  app.asar SHA-256 `690dd9e8d5466c461e769f353735ec8b39998b064fcf464f172521592c266f67`。
  这是包含现有 WIP 的本机预览，不是 exact-SHA 分发、macOS 14 真机或 sidecar 接入证据。
- 已更新两仓库 AGENTS、Desktop ADR 0002、产品/进程边界、Server 集成与 VPS 文档。
  OpenSpec `refactor-new-money-local-openviking` 严格校验通过。
- 已删除 Server Compose 的 OpenViking service/依赖、开发和生产环境模板中的
  OpenViking 配置。旧 API gateway 源码与 Desktop 调用尚未切换；文档明确禁止
  把这个中间状态部署为已完成产品。
- Server 正常启动不再运行迁移；显式 `new-money-api --migrate` 使用迁移角色。
  destructive test 在迁移/TRUNCATE 前检查精确 DB、低权限非 owner 角色、服务器地址
  和 operator-owned 只读实例标识。VPS 测试建库 SQL 已准备但未执行。
- macOS 15 arm64 上，隔离 Python 3.12.10 + OpenViking 0.4.16 / SDK 0.1.10
  原生启动、写读、私人/项目及跨项目隔离、向量检索隔离、重启持久性、物理撤销共
  7 项通过。使用本机 synthetic vectors-only 模型，63 次合成 embedding 调用；
  不证明真实模型质量、跨范围摘要、私人 capture、portable bundle 或 Desktop 集成。
  回执：`/var/folders/np/87rgyzv508l28zy3fzvpgwrr0000gn/T/new-money-native-probe-rrcp0T/receipt.json`。
- 已生成 macOS arm64/Windows x64 Python 3.12 dependency hash locks。macOS 的
  166 个已安装依赖与 lock 经 `uv pip sync --require-hashes --dry-run` 核验，无变化。
  Windows lock 仅证明解析可行，不是 Windows 执行证据。
- 已卸载 Homebrew postgresql@14；原 42 MB 数据目录已移动至
  `/Users/gaoqian/.Trash/postgresql@14-2026-09-08`，未清空废纸篓。复核无本机 5432
  listener。现有 Docker OpenViking Lab 和 VPS 未修改。
- Rust 12 单元测试及 1 DSN 拒绝用例通过，fmt/clippy 通过。真实 DB flow 因未配置
  `NEWMONEY_TEST_DATABASE_URL` 跳过，不计为通过。Compose config --no-env-resolution
  --quiet 通过。Desktop structure/production-transport 与 probe 语法/oxlint 通过。

### Active blockers and next checkpoint

1. 已解决：用户明确将整个 Desktop 最低系统要求提高到 macOS 14+（Apple Silicon），
   PRODUCT.md、README.md、electron-builder minimumSystemVersion 与 ADR 已同步。
   无需保留 macOS 12/13 的 Memory 特例；最低系统真机与可搬移包仍须独立验证。
2. VPS `newmoney_test` 建库/角色/隧道测试需要独立授权；已发送具体授权请求，未执行。
3. R2 已有可搬移目录、本地身份、原生 lifecycle、本地持久签名、模型设置/显式查看
   的 packaged 回归和本地目录安装事务证据。仍缺发行包 upstream provenance、
   发行下载/启用入口、完整私人捕获/团队会话来源/投影验收，不能切换默认记忆路径；
   R3/R4/R5 均未完成。DataHub 上次现场 clean
   (`3874be19`)，未删除活动代码，因为替代链路尚未达到接受计划的切换门禁。
4. 当前安装 UI 检查 `check:source` exit 0：protocol/typecheck/lint/architecture/knip/
   references/structure/transport/workflows/coverage 全部通过；Statements 82.92%、
   Branches 76.92%、Functions 86.86%、Lines 86.78%。这是当前工作树源码证据，包含
   原有 WIP，不是默认 managed sidecar 或正式发行验收。最新安装包设置 smoke 与
   preview 的精确制品身份见上方记录；本轮新 preview 与真实签名安装 UI 已通过。

## Historical implementation record (superseded architecture)

建立独立兄弟仓库 `new-money-server`，实现 New Money 的账户、开放注册、邮箱验证、团队、成员、项目、设备授权、权益与 OpenViking 私网代理；同时让 Pi-67 Desktop 以 New Money 身份与团队边界接入，不再把 DataHub 当作账户和 Agent 治理宿主。

## Non-goals

- 不在本次本地实现中操作 Cloudflare DNS、VPS、证书或生产数据库。
- 不 push、部署、发布、上传候选包或创建正式收费支付链路。
- 不把本地匿名记忆自动上传；不改变 Pi 作为唯一 Agent Runtime 和 Session 真源。
- 不删除 DataHub 既有 Agent 表或接口；正式切流前保留兼容与回滚空间。
- 产品名统一为 `New Money`；`new-money-server` 仅作为技术仓库名，不引入 `Cloud` 或 `Hub` 品牌。

## Acceptance criteria

- 独立仓库能在本地构建并提供注册、验证、登录、刷新/退出、团队创建/切换、成员邀请、项目、工作区绑定、设备授权、权益和审计接口。
- OpenViking 仅由服务端私网代理访问，映射为 New Money 团队 `account`、用户 `user`，客户端不持有 OpenViking 根凭据。
- 默认开放个人注册；每个新账户可创建一次 30 天、最多 5 人的团队试用；只实现 entitlement/配额，不接真实支付。
- Web 管理后台覆盖桌面和窄屏的注册、登录、团队总览、成员、项目、共享知识与设置主流程。
- Pi-67 Desktop 使用 New Money 文案和显式团队选择，设备授权后按团队获取项目并绑定 Workspace；本地模式无需登录且保持可用。
- 相关产品、设计、协议和迁移文档与实现同步，关键边界有自动测试或可复现验证。

## Delivery boundary

- Local implementation: 已授权，覆盖独立兄弟仓库及 Pi-67 Desktop 必要接入改动。
- Commit: 未授权。
- Push: 未授权。
- Candidate build/upload: 未授权。
- Tag/release/promotion: 未授权。

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Pi-67 canonical checkout 位于当前目录；存在用户 WIP，必须隔离 | `git status --short` | 2026-09-08 |
| OBSERVED | DataHub 当前承载旧 Agent 治理表、设备授权及 OpenViking 网关 | DataHub migration 018-020 与 Rust agent 模块 | 2026-09-08 |
| OBSERVED | Desktop 当前协议和 UI 假定单一 enterprise account，并显示 DataHub/企业文案 | domain/protocol/agent-host/renderer 现场源码 | 2026-09-08 |
| VERIFIED | `new-money-server` 已建立为独立兄弟 Git 仓库，不嵌套在 Desktop 或 DataHub | 文件系统与 `git status --short` | 2026-09-08 |
| OBSERVED | `newmoney.52671314.xyz` 当前无可解析 A/AAAA 记录 | DNS/HTTP 只读检查 | 2026-09-08 |
| VERIFIED | 目标 VPS 为 `159.195.56.20` / x86_64，运行 Docker 29.2.1、Compose 5.0.2、Traefik `traefik-public` 与 PostgreSQL 17 容器 | VPS 只读 SSH、Docker 与网络清单 | 2026-09-08 |
| VERIFIED | VPS PostgreSQL 当前有 `postgres`、`groland`、`datahub_prefect`，尚无 `newmoney`；VPS 当前未运行 OpenViking | PostgreSQL 只读目录查询与容器清单 | 2026-09-08 |

## Affected boundaries

- Modules/processes: 新 Rust API、新 Web 管理后台、Pi-67 domain/protocol/agent-host/renderer。
- Protocol or persisted state: New Money PostgreSQL schema、REST contract、Desktop enterprise context protocol。
- Platform/artifact: 本地源代码与本地构建；无生产制品或目标 VPS 变更。
- Security/privacy: 密码哈希、短期访问令牌、哈希刷新令牌、邮箱验证、设备码、团队隔离、服务端 OpenViking 根凭据、审计。
- Existing WIP: 不修改 `apps/agent-host/src/desktop-shared-profile.ts`、`apps/agent-host/src/desktop-shared-profile.test.ts`、`apps/agent-host/src/prompt-attachment-access.test.ts`。

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| 新服务是 `codeproject/new-money-server` 独立 Git 仓库 | 账户、团队和商业边界不属于 Desktop 客户端，也不应继续绑定 DataHub | 产品重新决定采用单体仓库且给出迁移收益证据 |
| API 使用 Rust/Axum/PostgreSQL，Web 使用 React/Vite | 与现有 Rust 服务能力对齐，同时保持管理后台独立交付 | 现场工具链或维护成本证明该组合不可持续 |
| New Money Team ID 直接映射 OpenViking `account`，User ID 映射 `user` | 保证租户隔离且不引入第二套映射真源 | OpenViking 官方身份模型发生不兼容变化 |
| OpenViking 根凭据仅驻留服务端，默认 memory fail-closed | 避免客户端越权或跨租户泄露；Agent 主流程仍 fail-open | 经安全评审批准新的受限委派方案 |
| DataHub 本次不删除旧实现 | 本地新服务尚未生产验证，删除会破坏回滚 | 生产迁移完成且用户另行授权清理 |
| 复用 VPS PostgreSQL 17 实例但使用独立 `newmoney` 数据库/最小权限角色 | New Money 是事务型应用，不是数仓；不能污染或依赖 DataHub 的 `groland` 数据库 | 容量、故障域或合规评审要求独立 PostgreSQL 实例 |
| MacBook 不安装 PostgreSQL；开发/测试通过安全隧道使用 VPS 专用非生产数据库 | 避免本地常驻数据库，同时禁止开发和破坏性测试指向生产 | 后续采用隔离的临时 CI 数据库服务 |

## Checkpoints

- [x] 1. 建立独立仓库、权威文档、迁移和可构建的 API/Web 工程。
- [x] 2. 完成账户、团队、成员、项目、设备授权、权益、审计与 OpenViking 代理纵向闭环并通过测试。
- [x] 3. 完成 New Money Web 管理后台核心页面与响应式、键盘/焦点验证。
- [x] 4. 更新 Pi-67 Desktop 的产品/设计/协议/Host/Renderer 接入并通过相关门禁。
- [x] 5. 完成本地集成验证，记录未执行的 VPS、Cloudflare、生产迁移与发布边界。

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| New server source | `cargo fmt --all -- --check`、`cargo clippy --workspace --all-targets -- -D warnings`、`corepack pnpm check`、OpenAPI YAML 解析、production compose config | Rust/Web 命令成功、31 条 OpenAPI path 可解析、容器编排模板有效 | PASS |
| New server tests | `cargo test --workspace -- --nocapture`；专用 PostgreSQL 回归仅允许 `_test` 数据库 | 当前源码 12 个单元测试通过；结构拆分前的一次性 PostgreSQL 集成通过。按用户要求移除本地数据库后，当前精确源码的真实 DB 用例安全跳过，等待 VPS `newmoney_test` | PARTIAL |
| Desktop source | `corepack pnpm run typecheck`、目标 55 测试、协议/架构/transport/workflow/coverage 门禁 | New Money 范围内门禁通过；全量 `check` 仅被并行 Provider WIP 的 `ProviderModelWorkspace.tsx` 461/460 行结构门禁中止 | PARTIAL（范围内 PASS，聚合命令受无关 WIP 阻塞） |
| Runtime/host | 一次性 API/Web/PostgreSQL；browser67 桌面/390px 窄屏/键盘检查 | 注册后验证、登录、首个团队、成员、项目创建、共享知识、设置、焦点环和零横向溢出完成；真实页面发现并修复异步表单 reset 缺陷。随后组件仅按职责拆分并通过当前 production build | PASS（生产/VPS 仍未验证） |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | macOS arm64 DMG/ZIP 构建、packaged Electron smoke、冷/热恢复与仓库制品启动成功；`app.asar` SHA-256 `5c0adb6bf41d7f967fb25212ddea48090c165561a8ea2dd5215d1e74bf853ce7` | PASS（当前工作树，未签名） |
| Target VPS/production | DNS/TLS/容器/迁移/备份/监控/回滚演练 | 生产证据 | not authorized |

## Rollback

- 新兄弟仓库尚未部署，可通过停止本地进程和保留/移除该明确目录回到原状态；未获授权前不删除目录或历史。
- Desktop 改动保持在未提交 scoped diff，可逐文件审查；不触碰列出的用户 WIP。
- DataHub 旧接口与数据结构保持原状，生产切流前可继续使用原路径。
- 生产阶段另行要求数据库备份、向后兼容迁移、DNS 回切与 OpenViking 版本/数据快照；本阶段不冒充已验证。

## Risks and unknowns

- 邮件投递供应商、生产域名 DNS、TLS 与 VPS 网络拓扑尚未配置，只能提供显式配置合同和本地 fake/sink 验证。
- 更正：此前 Apache-2.0 归属错误，OpenViking 主项目为 AGPL-3.0；固定制品的许可证、依赖与源码提供须在分发前核对。
- 支付未接入，entitlement 仅提供可审计状态机和管理员/未来 billing webhook 接缝。
- Windows 与生产 VPS 未在当前本地实现阶段验证。
- 当前 VPS PostgreSQL 对全部宿主接口发布 5432，继承文档还记录了临时 non-TLS 路径；New Money 上线前需独立完成网络收敛且验证不破坏 DataHub/Prefect。

## Progress log

- 2026-09-08: 复核两个现有仓库、旧数据模型、Desktop 单账户假设、域名状态与工具链；确认本地实现边界和用户 WIP 隔离。
- 2026-09-08: 前端 route 判定为 L1-F/system，使用 `design-craft`，由主代理串行执行；Web 采用克制、高密度、明确租户边界的运营后台语义。
- 2026-09-08: 建立独立 `new-money-server` Git 仓库，完成 Axum/PostgreSQL API、React/Vite 管理后台、OpenAPI 合同、迁移、容器与反向代理模板。
- 2026-09-08: 完成团队到 OpenViking account、用户到 OpenViking user 的服务端私网代理边界；补齐设备会话团队硬隔离、幂等候选提交和发布失败补偿。
- 2026-09-08: Desktop 改为 New Money 身份、团队、项目和 Workspace 绑定模型；本地匿名模式保持无需登录，私有记忆不自动上传。
- 2026-09-08: browser67 完成真实桌面/窄屏/键盘验证并清理唯一托管 tab；测试中发现并修复异步提交后访问失效 `currentTarget` 的表单重置缺陷。
- 2026-09-08: Rust/Web/数据库集成测试通过；Desktop 范围内类型、协议、架构、transport、workflow、coverage 与 packaged macOS smoke 通过。全量 `check` 的唯一失败属于未纳入本任务的 Provider 并行 WIP 行数门禁。
- 2026-09-08: 用户确认 MacBook 不运行 PostgreSQL。移除本地 PostgreSQL Compose，增加测试库 `_test` 硬门禁，并把 API repository 与 Web 主组件按职责拆分到所有源码文件 361 行以内；Rust/Web 门禁继续通过。
- 2026-09-08: 只读核验目标 VPS、Traefik、PostgreSQL 17 与现存数据库；新增独立 New Money VPS、数据库和 DataHub 退役 runbook。模板改为 Traefik ingress、独立数据库网络、无公开 API/OpenViking 端口及固定 OpenViking v0.4.16 linux/amd64 digest。

## Closeout

- Final source SHA: 两个仓库均未提交；以 2026-09-08 最终工作树为准。
- Changed files: 独立仓库包含产品/设计/第三方说明、Rust API 与迁移、React Web、OpenAPI 和部署模板；Desktop 包含 domain/protocol、Agent Host gateway/controller、Renderer 设置/Experience 与权威文档。未把 Provider 与 prompt attachment 的用户 WIP 计入本交付。
- Validation completed: 当前源码 Rust fmt/clippy/单测、Web typecheck/test/build、OpenAPI/production compose 解析、结构检查、Desktop 目标测试/typecheck/架构/transport/workflow/coverage、browser67 真实页面、macOS arm64 未签名打包与 packaged smoke；结构拆分前另有一次真实 PostgreSQL 集成通过。
- Validation not completed: 当前精确源码对 VPS 专用 `newmoney_test` 的真实数据库回归、真实邮件投递、真实 OpenViking 实例、VPS/Cloudflare/DNS/TLS、生产数据库创建/迁移/备份/监控/回滚、Windows、签名、支付与发布。
- Remaining risks: 上述生产链路仍需独立实施和验收；边缘代理需配置速率限制；OpenViking 上线版本及依赖需要法律/合规复核；Desktop 全量 `check` 仍会被当前无关 Provider WIP 的单文件行数门禁阻塞。
- Commit/push/release state: 均未授权、未执行。
