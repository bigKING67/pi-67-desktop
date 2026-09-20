# Contributing

## Authority

开始修改前先阅读 `AGENTS.md`，再按其 `Reading and authority` 路由读取本次涉及的
产品、设计、进程协议或架构决策章节。不要求每次修改全文读取全部权威文档；范围或
引用合同不清楚时，先扩展阅读再修改。

行为、视觉 token 或交互改变时，必须在同一改动中更新对应 authority 文档。

## 工程规则

- 使用精确依赖版本；Pi 三个核心包保持同一版本，并由 `pnpm-workspace.yaml`
  overrides 固定传递依赖。
- renderer 不得导入 Electron、Node、Pi SDK 或文件系统 API。
- 不增加 Pi RPC Adapter、业务 WebSocket 或第二个 Pi runtime。生产环境不增加 localhost
  业务或资源 Server；开发时 Vite 仅用于 `127.0.0.1` 上的资源和 HMR。
  本机 OpenViking sidecar 是独立的受认证 loopback 记忆服务，按
  `docs/adr/0002-new-money-local-memory.md` 管理，不承载 renderer 或业务通信。
- 内置和自定义 Provider 通过 Pi 支持的机制接入，以 Pi 配置为真源；不增加非 Pi Provider
  adapter、独立 Provider 配置真源或第二套模型路由。
- 跨进程消息先在 `packages/protocol` 定义并验证，再实现调用方。
- protocol、策略、恢复和 extension UI 变化必须增加 targeted tests。
- 不创建 `utils`、`helpers`、`common`、`misc`、`legacy` 等兜底目录。
- 不提交 build/installer 输出、日志、数据库、截图、trace、用户 session 或凭据。

## 工程入口与职责

| 需要回答的问题 | 维护位置 |
| --- | --- |
| 产品、架构、授权和平台边界 | `AGENTS.md` 路由到产品、设计、协议与 ADR |
| 如何开发、选检查和交付 | 本文；专项细节链接到对应合同 |
| 哪种改动运行哪些验证 | `docs/testing/ci.md` 与 `eng/ci/` 分类器/聚合门禁 |
| 覆盖率的范围、排除理由、阈值 | `docs/testing/coverage.md` 与 `vitest.config.ts` |
| 产品性能预算和测量方法 | `docs/testing/performance.md` 与 `eng/performance/` |
| 候选、内部更新与正式发布 | `docs/release/` 各自操作合同 |
| 复杂变更计划与长期决策 | `PLANS.md`、`docs/plans/`、适用 ADR |

规则、配置和执行证据各有职责。规则规定合同，配置实现合同，运行结果证明具体版本是否通过。
计划、旧报告和一次成功不替代当前 Git、产物身份或目标平台证据。

## 日常命令选择

以下命令在仓库根目录运行；不是每次任务都必须执行完整列表。

| 场景 | 入口 | 证据边界 |
| --- | --- | --- |
| 开发应用 | `corepack pnpm run dev` | 开发环境，不能代替打包验收 |
| 局部 TS/逻辑改动 | 受影响包 `typecheck` + `pnpm exec vitest run <test-path>` | 定向验证，默认无覆盖率 |
| 复现完整源码 CI | `corepack pnpm run check:source` | 固定 2 workers 调用原有完整 `check`，测试和阈值不变 |
| 仅覆盖率检查 | `corepack pnpm run test:coverage` | V8 覆盖率；并发说明见 CI 合同 |
| 构建源码 | `corepack pnpm run build` | 生成 packages/apps 的 dist，不含安装认证 |
| Renderer/组合 E2E | `corepack pnpm run test:e2e` | 先构建，再执行默认 Playwright 项目 |
| 仅原生 Electron E2E | 使用 CI 合同中的专用配置命令，先 `build` | 本机 Electron；不等于安装器验证 |
| 候选源码前置检查 | `corepack pnpm run check:candidate` | 含联网 freshness/审计，不构建或分发 |
| 本机 macOS 候选 | `corepack pnpm run preview:mac:unsigned` | 按候选合同打包、smoke 和打开预览 |
| Windows 调度参数预检 | `release:windows:preflight`，参数见候选合同 | 只读 metadata，不调度 workflow |

## 配置和测试的维护约定

团队正文读取/在线 head 检查回归使用 `team-index-head-client.test.ts`、
`team-index-query-sessions.test.ts`、`shared-knowledge-index-head.test.ts` 和
`enterprise-index-head-observation.test.ts`。Host 8 秒超时必须立即返回失败，
底层未结束的 IO 不释放并发名额，不能因 Main 同步回传取消而重复回复。
本地 `[team-head]` / `[team-read]` 仅输出固定阶段、结果与毫秒数，每次至多三段；
阶段失败不是确定的权限拒绝，正文阶段还包括该阶段内部的有效性校验。
输出在 IO 结束时产生，不含正文、账号、地址、模型名、密钥或原始错误；
无输出不等于没有发起操作。离线回归不证明 VPS 或真实团队检索已经通过。
Host 的 head 记录走 stderr，采样启动时用既有 `PI67_DEBUG_AGENT_STDERR=1`
才会由 Main 脱敏转发；正文读取记录走 Main stdout。正常 GUI 启动不持久保存
这些记录，本轮不打开日常 Profile 的 debug 转发。隔离验收需显式捕获进程输出。
`probe-packaged-team-session.mjs` 仅在其独立测试 Profile 启用上述转发，并分别解析
每次启动的 stdout/stderr；单行缓冲上限 2048 字符、溢出丢弃至换行，回执最多保留
最近 128 条通过严格字段/阶段校验的 `phaseDiagnostics`。不保存原始输出；分片、
跨流、未知字段、超长行和敏感内容拒绝由 `packaged-team-phase-diagnostics.test.mjs`
覆盖。阶段采样为空或不完整不能解释为操作成功；记录是结算阶段证据，不是关联 trace。

私人记忆启用回归使用`local-memory-activation-{store,controller,bridge}.test.ts`：
冷启动预热另外覆盖`local-memory-startup.test.ts`、`local-memory-service.test.ts`和
`agent-host-supervisor-readiness.test.ts`：只在已保存启用并重启后、Host确实ready时
后台准备一次，与首个Session共用启动；撤销/退出阻止迟到成功，失败不自动重试。
`openviking/startup-diagnostics.json`只保留最近一次启动的固定阶段/结果/毫秒数；
`native-start`包含`process-ready`和`scope-provisioning`，不能重复相加。
默认关闭、只有显式保存、整应用重启生效、缓存broker禁用、迟到连接拒绝，以及
存储/停止失败不能冒充成功。packaged memory settings smoke还覆盖真实Main/
Preload/UI保存与两次冷重启回读；缺运行包/模型时拒绝启用。普通smoke仅在独占
测试Profile创建不可验签的占位目录来区分presence和readiness；不修改生产信任，
不把这个偏好正例当作已签名原生运行包或模型处理正例。测试模型均为合成配置。

私人会话与签名原生服务联合回归使用显式本地输入：
`PI67_PRIVATE_SESSION_TEST_INSTALLATION=/absolute/signed-installation corepack pnpm exec vitest run apps/desktop/src/private-memory-session.native.test.ts`。
输入目录含`manifest.json`、`manifest.sig`与完整`runtime/`，必须通过源码内置公钥
和完整树校验；不生成密钥、下载或修改信任。默认没有环境输入时跳过，不算原生通过。
测试在独占临时目录保存真实启用偏好，经Main controller/broker/service和Pi
ResourceLoader/EventBus连接，验证真实JSONL及两轮自动捕获、原生进程停止/重启后
同一Profile与Session恢复、凭据轮换、无重复、关闭拒绝及运行包树不变。随后以
测试Profile的`commitKeepRecentCount: 0`显式归档两轮，通过同一owner EventBus
触发真实提炼；核对偏好文件及同一OV会话archive的`.done`完成记录，而非只看
accepted/archived。重启原生服务、新建Pi会话后，实际模型上下文须含偏好及其
来源URI，新会话JSONL不得混入旧消息，持久偏好文件不变。默认保留10条的短会话
Commit可能没有可归档内容；本测试不改变产品默认值，也不据其声称默认必定提炼。
Agent、提取模型输出与本地embedding均合成，不读取用户配置或调用付费模型；成功清理独占
夹具，停止失败保留现场。此层使用同一测试宿主重建控制器和Pi Session，并非
正式Main/Renderer或Host跨进程端到端测试；覆盖受控模型响应下的原生提炼/召回机制，
不覆盖真实模型提炼准确率、长期语义召回质量、
Windows或macOS14最低系统认证。测试SDK夹具归属`packages/pi-runtime`，Desktop
不新增生产Pi依赖。与独立packaged设置测试的证据不能合并冒充完整产品验收。
该原生回归输出三次真实启动的`PRIVATE_MEMORY_STARTUP_PHASES`，区分整树验签
和native+provision毫秒数，不含配置或凭据。额外设置
`PI67_PRIVATE_SESSION_FRESH_INSTALL=1`可先由正式安装器验签复制到独占临时目录，
对比新安装路径首次与重复启动；增加复制/校验成本，成功随夹具清理，不改既有安装。
这些是诊断样本，不是10次release-build性能认证或p95/SLA。
与FRESH_INSTALL同时设置`PI67_PRIVATE_SESSION_PRECHECK=1`可做最小解释器对照：
仅在新验签副本以清洁环境执行`-I -B -c pass`，30秒上限，不启动服务/模型或
写入bytecode。输出预检耗时，不属于产品安装行为；当前样本未改善首次原生启动，
不能将它作为默认预热步骤。
同一回归还输出`healthReadyMs`（真实native入口到首个成功health响应）和
`provisionMs`（随后账号/用户准备完成）；前者包含启动前文件准备和健康轮询，
不是纯Python导入时间。显式设置`PI67_PRIVATE_SESSION_PROFILE_IMPORTS=1`时，
仅测试夹具给真实Python增加`-X importtime`并消费stderr：每次启动只输出健康就绪前
self耗时最高的12个合法模块名及微秒数，单行最多512字符，超长行整行丢弃，
不输出/保存原始日志、参数、路径、配置或凭据。此模式增加观测开销，需与未开
importtime的样本区分；cumulative为嵌套累计值，不能相加或当作self。
它不修改已签名运行树、隔离参数、模型或生产启动实现，也不绕过验签。

开发实验`PI67_PRIVATE_SESSION_LAZY_OTEL_EXPERIMENT=1`必须同时设置FRESH_INSTALL，
且不能同时预热解释器。它仅在正式安装器已验签复制出的独占夹具内修改OV
`metrics/exporters/__init__.py`和`metrics/global_api.py`，把OTel导入移到实际使用处；
两份原始源码均以固定SHA-256约束，任一漂移在写入前失败。测试重新测量修改后的
树，并以仅内存临时密钥签名，通过真实admission；另断言正式公钥拒绝此签名。
不写出测试密钥或修改后的manifest，不接入准备/签名/产品安装流程；输出
`lazyOtelExperiment: true`与`productionAdmission: REJECTED_TEST_KEY`，不得混同正式签名验收。
三次启动与完整记忆断言结束后，另验证未使用时不导入OTel、显式请求仍返回同一
Exporter类、Prometheus导出保持、未知名字仍报错；不向OTel端点发送请求，真实
遥测上报仍未验收。成功清理测试副本，失败停止不完整则保留；这是性能候选实验，
并非已采纳的上游补丁或消费者可安装产物。字体按需加载仅为另一个候选，未混入此对照。

另一个独立候选为`PI67_PRIVATE_SESSION_LAZY_LITELLM_EXPERIMENT=1`，同样要求
FRESH_INSTALL且禁止预热，不可与OTel实验同时开启。两者复用
`eng/capabilities/private-memory-lazy-import.test-support.mts`中有界、固定源码hash的夹具修改机制。
LiteLLM候选仅延迟VLM/embedding包入口导入，并将embedding工厂的LiteLLM导入
限制在显式选择该provider时；保留公开导出、原有工厂及embedding缺依赖返回None的
约定。重新验签仍用仅内存临时身份，正式信任锚必须拒绝，测试产物不进入产品安装。
三次服务启动和真实合成模型记忆链路结束后，再检查完整server bootstrap及OpenAI
实例创建没有加载LiteLLM，显式选择LiteLLM仍返回原类/工厂实例，未知导出仍报错。
该兼容检查不调用远端模型。LiteLLM实验随后在两个独立Python进程执行
`eng/capabilities/openviking-runtime/private_litellm_probe.py`，不将脚本复制进运行包：
requests模式经原factory/后端/LiteLLM向本机合成HTTP服务执行同步与异步聊天、
embedding正例（各2次）及401拒绝（共4次），核对原始异常或embedding因果链，
请求数必须精确匹配、未知请求为0；配置重试为0，外层每进程30秒上限。
missing模式用import finder注入缺失LiteLLM，不删实际文件：OpenAI实例仍可创建，
显式选LiteLLM必须报预期缺依赖错误，不能假成功。两个模式均用audit hook拒绝
非夹具连接/外部DNS；missing不允许任何连接，实际被拒绝尝试也必须为0。
只输出固定状态/计数，第三方响应/异常日志不输出，合成监听器和临时数据随测试关闭。
这覆盖本地OpenAI兼容协议及特定401/缺依赖分支，不证明付费provider、限流/超时/
流式/视觉输入或完整provider矩阵。计时输出含profileImports，关闭计时的候选/
原版对照需分别明确设置`PI67_PRIVATE_SESSION_PROFILE_IMPORTS=0`，不能混合样本。

私人运行包的显式准备入口为：
`corepack pnpm run prepare:openviking:native /absolute/standalone-python3.12 --private-lazy-litellm-v1 --offline`。
输入必须是独立CPython3.12.10 arm64；不使用系统Python或创建本机数据库。首次缓存
不足可去掉`--offline`下载锁文件中的固定wheel，仍要求hash、禁止源码包和隐式依赖解析。
默认team-index-v1及显式team-query-v1保持原样；私人模式不复制team worker或测试probe。
`eng/capabilities/openviking-runtime-patches.mts`是构建和原生实验共享的唯一LiteLLM
补丁规则。先校验所有源码和wheel RECORD，再写三处延迟导入、更新RECORD；上游
漂移、已存在补丁收据、符号链接或记录不匹配都失败，不原地重试失败staging。
运行树内`newmoney-runtime-patches.json`记录revision、recipe hash及三文件前后hash，
随后纳入整个运行树身份。生成的site-packages/bin入口另改为相对Python路径并更新
RECORD，避免临时目录进入字节；搬迁后执行normalizer --help，并跑原生存储/隔离探针。
准备收据包含锁文件hash、补丁记录、入口改写数量、树身份及验证结果；收据在运行树外。
此阶段仅生成本地开发产物及临时测试签名，不操作正式密钥或导入用户安装；不能
将准备/原生探针通过等同完整packaged验收。双构建相同树只能证明同宿主、同独立
Python输入及同依赖锁的这一组重建结果，跨机器复现仍须另验。旧运行包保留不动。

查询 embedding 合并候选使用独立选项`--private-query-coalescing-v1`，不可与其他
purpose 同时选择。它先应用上述延迟导入补丁，再通过
`eng/capabilities/openviking-query-patch.mts`校验固定的候选收集、检索器和 embedder
源码，只在新 staging 写入单请求 helper、两个调用点及 wheel RECORD。运行树中的
`newmoney-query-embedding-patch.json`记录 recipe、依赖和 helper 身份；已打补丁、
源码漂移、符号链接、RECORD 不匹配均拒绝，不原地重试失败 staging。
此选项不改变默认模式，也不自动激活现有安装。helper 不跨请求缓存，不改变权限、
排序、模型或 SDK 重试；每次最多保留 32 个不同的短文本请求，其他输入走原路径。

独立的真实本地数据库对照入口为
`node eng/capabilities/probe-query-embedding-native.mjs /absolute/signed-installation`。
仅将明确提供且树身份匹配的运行树复制进临时目录，用合成 HTTP embedding 服务
和真实 AGFS/向量索引运行 context assembly。先原版，再给副本打补丁并冷启动；
比较召回正文/来源/顺序/分数，检查请求数、独立及并发请求、账号隔离和无效凭据。
同时运行源码/RECORD 漂移拒绝和 helper 生命周期回归。外部模型配置及用户数据不读取，
不生成任何签名、不替换安装；保留独占夹具和 receipt 供核查。固定合成向量只证明
链路与结果保持，不证明真实语义质量或实际提供商加速，也不替代 packaged 验收。

完整产品私人记忆入口另运行
`PI67_PRIVATE_SESSION_TEST_INSTALLATION=/absolute/signed-installation corepack pnpm run verify:memory-session:packaged`。
它使用现有macOS arm64仓库app（不自动重建），输出实际app.asar SHA-256；先完成
源码门禁和相关打包，不能把旧包测试转移到新源码。真实设置UI导入签名运行包、
保存加密embedding配置、显式启用，再整应用冷启动，通过真实Main/Host/Pi及
本机OpenAI HTTP/SSE合成模型创建会话，核对界面正文、Pi JSONL及隔离OpenViking
原生messages.jsonl；冷恢复后同文件旧记录不变、两轮消息各一次，再验收关闭。单次发送到
合成回复和空闲须在30秒内；无环境输入明确失败，不作跳过成功。原生picker只
固定选择独占测试来源，IPC/验签/安装/模型解析/会话均不替换实现；不用用户配置、
付费模型或VPS。成功清理独占Profile，失败保留并报告路径；调用方只能在确认
该应用及原生进程退出后精确清理。此入口仍不证明长期模型提炼/语义召回质量、
Windows或最低系统版本。普通packaged smoke不自动启用此有成本的完整运行包测试。
该入口另覆盖真实“任务检查器→上下文→记忆→立即归档”：首次关闭仍使用默认
保留10条，只有隔离Profile的冷恢复前改成保留0条；按钮前须没有提取请求，
随后等待精确OV archive的`.done`及偏好文件。整应用再启动、新会话发送不含
旧偏好的问题，模型实际HTTP请求必须带偏好和来源URI，新JSONL不得混入旧标记。
提取输出和向量为合成夹具，只证明产品机制，不证明模型准确率或搜索排序质量。
Transcript正文断言限定实际虚拟列表，不能把无障碍播报区误当正文或重复元素。
该探针使用既有测试专用Agent初始化观测通道，输出至多100条固定阶段、completed
耗时记录，关联当前验收阶段；不保存原始stderr。阶段可能包含子阶段，不能相加
重复计时；native Node与packaged Electron、已有安装与新复制安装须分别报告。

正式Agent Host入口的离线会话验收：
`node eng/capabilities/probe-agent-host-session-electron.mjs`（macOS arm64，无参数）。
前置是已准备的`artifacts/toolchain/current`；runner只读核对工具链锁、manifest和
实际版本，不下载/重建工具链、不回退系统Git/Node。它构建真实Host及依赖，再由
隔离Electron Main驱动正式`apps/agent-host/dist/index.mjs`，使用真实MessagePort、
命令校验和Pi SDK，不注入FakeRuntime。验收未登录的冷/热团队创建拒绝、私人
JSONL来源标记和创建凭据、拒绝后文件逐字节不变，以及Host物理退出/重启后
同一会话恢复。当前Pi SDK重开无消息会话会追加一条`thinking_level_change`；
探针要求原JSONL完整前缀不变，仅允许同级别、正确parentId的这一条元数据。
成功必须得到`HOST_SESSION_ENTRY_PASS`及exit 0，且两次Host均正常退出、无丢弃命令。
runner只用自己新建的`artifacts/agent-host-session-*`目录；成功自动清理，失败
仅输出阶段/协议错误码并保留现场。失败目录只能在确认对应进程退出后精确清理。
此入口不传用户凭据、不启动OpenViking/能力包、不调用模型/数据库；`NODE_ENV=test`
仅关闭Host已有的后台模型目录刷新。它不启动产品Main/Renderer，不证明登录正例、
团队工具默认接通、私人记忆提取、签名安装、Windows或macOS14最低系统验收。

同一正式Host探针的设备登录联调使用显式`--live`，与离线验收分开执行。
先按下述专用VPS测试库流程创建独占TLS目录，Server producer额外设置
`NEWMONEY_TEST_LIVE_DEVICE_AUTH=1`；等本次`connection.json`出现后运行：
`NODE_EXTRA_CA_CERTS=/absolute/private-directory/cert.pem PI67_NEWMONEY_LIVE_DIRECTORY=/absolute/private-directory node eng/capabilities/probe-agent-host-session-electron.mjs --live`。
此模式不把夹具凭据直接bootstrap为登录成功：正式Host发起设备授权，夹具通过
真实API批准，Host交换凭据并通过真实Main credential supervisor写入系统加密存储。
它验证私人/团队JSONL分离、凭据重开、Host重启后的团队来源、项目移除后创建
拒绝且不修改历史、退出登录的远端204及本地清除、下次Host启动恢复未登录状态。
Server独立读回同一夹具的发布/撤销/项目成员移除事实。必须同时有
`HOST_SESSION_LIVE_PASS`、consumer exit 0、producer完整测试exit 0和清理确认。
Main仍为隔离测试驱动，不启动产品Main/Renderer，不证明实际模型调用、团队工具
默认启用或完整产品上线。共享TLS代理只在设备模式额外允许精确的
`DELETE /v1/auth/sessions/current`；无重定向/全局信任修改。合成账户批准令牌只在
独占交接文件和夹具Main内存中使用，不传给Host/环境/日志。沿用单consumer、
300秒Server窗口及现有退出/精确清理合同；无环境输入不是live通过。

真实Electron在线授权探针复用下述实时Server测试窗口、专用VPS测试库和私有TLS
目录，但同一窗口只能选择一个consumer，不能与Vitest live consumer并发运行。
等新的`connection.json`出现后执行：
`NODE_EXTRA_CA_CERTS=/absolute/private-directory/cert.pem PI67_NEWMONEY_LIVE_DIRECTORY=/absolute/private-directory node eng/capabilities/probe-shared-knowledge-live-electron.mjs`。
仅macOS arm64；入口构建独立Main/utility探针，使用新建的隔离userData，不导入
产品main、不读现有登录/profile。Main使用真实Electron safeStorage及现有凭据
存储保存/重开合成短期会话，检查密文文件、0600权限与重开一致；系统安全存储
不可用则失败，不降级明文或修改Keychain权限。Host在真实utilityProcess内执行
Gateway及sync，receipt协议经parentPort到Main独立授权/落盘。测试验证重复sync
重新授权、撤销cursor推进、项目撤权拒绝及团队权限保留，清空测试凭据并确认
utility退出后才写通过标志。TLS只在探针进程生效，utility不继承数据库凭据。
runner上限240秒，单次Host探针操作45秒（IPC等待50秒），产品Gateway/Main及
receipt客户端原有8秒不变。runner成功清理其临时产物/userData，失败仅报告固定
stage并保留隔离目录；不输出会话、密文或子进程原始错误。失败后先核实进程退出，
再精确清理测试目录，并按下述步骤核验数据库及TLS/任务隧道清理。
此探针不运行原生索引/付费模型/查询，不证明完整产品入口、打包签名、Windows、
macOS14最低版本或生产性能。必须同时取得Electron通过标志、Server exit 0和
清理证据；单独的标志、之前的native测试或缺env退出不能合并成端到端交付。

上述runner的显式`--native`选项进一步接入真实OpenViking索引和查询：另设置
`PI67_TEAM_MODEL_TEST_PYTHON=/absolute/isolated-runtime/bin/python3.12`，启动Server
producer后即可启动该runner，不必等待`connection.json`。Main先在独占userData
复制运行树、用仅内存测试密钥签署、经真实安装事务导入index/query版本；准备
限180秒，之后有界等待服务窗口720秒，runner总上限1080秒。既有非native模式
的240秒限制不变；Server在线窗口仍300秒，产品各请求/模型/查询期限不变。
测试helper现在使用Node严格断言，可同时供Vitest和独立Electron引用；runner
显式提供仓库bootstrap目录，避免打包探针后的import.meta相对路径误指其他目录。
结束树完整性检查使用自己的90秒信号，不把早已结束的安装准备计时当成长期租约。

native模式通过真实Host索引事务（含catch-up）、Main scheduler/worker、私有
head观察、独立读取授权和原子发布，然后从同一代际执行原生向量查询与精确正文
读取。每个索引模型帧及查询embedding都先走真实项目/模型授权，只有模型输出
是固定8维测试向量；没有真实Provider请求，也不证明语义检索质量。验证命中的
资产/版本与本次发布一致，查询副本清理、原代际字节不变，撤销同步后旧索引
在embedding前拒绝，随后验证项目撤权。最后确认原生索引进程组不存在、Host
退出、原始树及安装树/签名不变；不允许把源树当成生产runtime fallback。
必须额外出现`SHARED_KNOWLEDGE_NATIVE_PASS`且整体双方exit 0并确认清理，
否则只报告已通过的具体层。退出不确定则保留整个隔离目录供诊断，不强删运行树。
仍非完整产品入口/Pi会话/实际模型/正式签名安装包联合证明，不授权切流或部署。
失败时`LIVE_QUERY_DIAGNOSTIC`只报告步骤/总毫秒/信号取消标志：1/2句柄打开前后、
3/4索引准备前后、5/6查询embedding授权前后、7/8原生查询前后；清理close不覆盖
最后业务步骤。HTTP代理超时0不代表8秒客户端或60秒作业未超时，必须结合阶段
诊断判定；不得从查询embedding计数0直接推断原生查询算法或提供商故障。

网页协同验收另用显式`--native --web`，不与其他consumer共享窗口。Server producer
除专用目录外设置`NEWMONEY_TEST_LIVE_WEB=1`，只在已有端口空闲时绑定127.0.0.1:8787；
原Web dev4173通过现有代理连接真实测试API。仅此模式使用600秒总窗口，普通模式
仍300秒；外层工程runner为1500秒以覆盖准备/等待/在线流程，不修改产品超时。
浏览器必须使用任务owned managed页和本次合成账号实际登录，不注入凭据或mock API。
同一目录的`web-publish-ready.json`给出精确team/project/candidate身份：在页面核对正文
后明确发布，观察成功再创建0600的`web-publish-done.txt`，内容严格为`done`加换行。
探针自己不发布；独立GET校验后继续真实同步/索引/查询。看到`web-revoke-ready.json`
后在网页重新读取精确对象/版本并确认撤销，观察成功再写同规则`web-revoke-done.txt`。
探针验证GET404、cursor2、旧索引在embedding前拒绝及项目撤权。最后根据
`web-logout-ready.json`在网页退出，确认回到登录页才写`web-logout-done.txt`。
所有阶段共用自Server交接文件创建时起600秒窗口的剩余时间，不逐阶段续期；
拒绝既有/非私有/符号链接标记。先在同目录准备0600暂存文件，
确认真实页面结果后原子移动为该阶段done文件，避免读取半写入内容。标记仅协调，
不是HTTP或用户交互证据。
必须同时有浏览器真实状态/HTTP观察、SHARED_KNOWLEDGE_WEB_PASS及原生/双方exit0、
数据库和进程清场才能报告这一层通过。失败保留诊断且按原清场合同处理，不伪造完成标记。
测试证书只信任于Desktop探针进程，Web仍是受限loopback开发HTTP，不修改浏览器/系统TLS。
此模式仍不是正式Desktop产品Main/Pi Session、已签名安装包、真实模型语义质量或部署证明。

正式产品Main/Renderer/Host/Pi的下一层使用独立
`node eng/packaging/probe-packaged-team-session.mjs`，只接受macOS arm64与显式
`PI67_NEWMONEY_LIVE_DIRECTORY`、同目录`NODE_EXTRA_CA_CERTS`。先核对当前仓库
安装包asar身份；不修改或复制安装包，不替换日常安装/profile。runner沿用packaged
fixture，先用独占userData/Agent目录及本机固定模型响应创建私人会话，再等待真实API。
producer使用同一专用目录，另显式设置`NEWMONEY_TEST_LIVE_DEVICE_AUTH=1`与
`NEWMONEY_TEST_LIVE_WEB=1`以取得独立600秒窗口；不能与其他consumer并行。
设备授权必须从设置页发起，测试管理员仅批准显示的设备码；不注入产品凭据。
设置页保存HTTPS地址、登录、选择团队和项目、绑定、显式同步都经过产品入口。
测试控制端发布合成候选/设置本机Agent模型允许项/撤销和移除项目成员，不模拟API。
团队草稿由正式范围选择器创建，发送经真实Pi并检查JSONL的精确来源标记；重启
验证账户恢复和同一团队历史保留，撤权后设置页同步拒绝，退出并冷启动确认未登录。
此层不证明重启后继续团队模型处理、团队原生索引/检索、最低macOS14或Windows。
固定模型响应不是语义质量证据；未配置的团队签名运行包不能用私人包或测试公钥替代。
必须有`PACKAGED_TEAM_SESSION_PASS`、双方exit0、专用库清场、物理退出和临时目录
清理证据才报告通过。失败只记录固定阶段并保留隔离profile；确认进程退出后精确
清理。查询诊断只记录最多128项固定操作类别/状态/耗时和模型请求增量，不含URL、
ID、header或body；实际Pi工具或模型失败后立即断言，不把等待成功提示算成工具耗时。
不得保存/回显设备码、凭据、原始子进程日志或真实用户内容。无生产部署授权。

该产品联合探针的显式`--native`模式还要求下述两个签名安装源环境变量。它在等待
API前，经两个真实设置入口安装团队运行包，并保存本机合成Embedding模型配置，
不安装或启用私人运行包。团队模型夹具必须使用该私有目录的临时证书提供HTTPS，
并仅通过探针进程的NODE_EXTRA_CA_CERTS信任；不能沿用私人HTTP夹具或降低产品校验。
服务端测试策略仅放行本次loopback Agent/embedding/
extraction身份；设置页构建当前项目索引后，真实Pi循环请求`viking_team_search`
与`viking_team_read`，测试模型只根据实际Tool Result选择返回资产，不伪造命中。
成功必须核对精确发布资产、版本、正文及Pi JSONL中的两次成功Tool Result；冷恢复
后撤销该资产，再次处理原会话须产生实际错误记录且Agent/embedding调用计数不增加。
随后仍执行项目撤权、退出及原有清场合同。沿用同一600秒在线窗口与产品期限，
不自动续期。固定向量/响应不是模型语义质量证据；普通模式PASS不证明此原生模式。

团队会话探针完成初始化后，成功、失败及清理异常都会尝试写入独立小型
`artifacts/evidence/packaged-team-session/run-*/receipt.json`，控制台输出精确路径。
回执绑定asar哈希与native/non-native模式，仅保留固定失败阶段、计数、至多128项
脱敏请求耗时和退出/清理状态；不保存凭据、身份、URL、正文或原始异常。
`proxyTimeouts`仅统计测试代理自身超时，不能据其为0排除产品内部更短的超时；
无响应状态记为null，不推断服务端错误。query计数从该查询开始累计到回执生成，
未取得Session观察时显式标为observed=false。成功必须同时完成应用退出和profile清理；
失败回执独立保留，后续成功不能覆盖它，也不能据单次成功宣称偶发问题已修复。

团队签名包的独立安装验收使用`node eng/packaging/probe-packaged-team-runtimes.mjs`，
必须显式设置绝对路径`PI67_TEAM_INDEX_TEST_INSTALLATION`和
`PI67_TEAM_QUERY_TEST_INSTALLATION`，分别指向现有信任锚签名的两种独立安装源。
该驱动只替换原生目录选择器的返回值，正式Renderer/IPC/Main验签与用途检查不替换。
它使用临时profile，验证两个安装入口、冷启动后存在、源和目标全树一致、私人运行包
仍缺失且未启用、无残留staging/lock，最后确认物理退出并清理临时profile。
签名源保留，不能写入日常profile。仅`PACKAGED_TEAM_RUNTIMES_PASS`加exit0代表
此层通过；不等于团队原生查询、模型授权、Windows或最低macOS14验收，不含发布。

原生index作业总预算固定240秒，各文档的队列等待只使用该作业剩余预算，不为
每个文档重新计时，也不再额外截断为30秒；单帧模型30秒及Host/Main授权期限不变。
离线回归`team-index-deadline-probe.ts`对同一个原生worker分别施加0/2500ms的
合成授权延迟，要求两者实际完成向量写入，慢样本累计授权延迟必须超过旧30秒
截止线。先在本仓库`artifacts/`下创建独占构建目录，以Desktop的tsdown构建该
入口，再用Node传入固定隔离Python和绝对bootstrap目录；不要移到仓库外运行
bundle，否则外部workspace包无法解析。观察器`team_index_deadline_probe.py`
仅输出布尔/计数诊断，不属于签名安装的生产bootstrap集合，不进入在线探针。
该对照回归不代替真实网络、运行包准入、IPC或产品性能验收。

实时New Money测试联调使用独立的`shared-knowledge-live.test.ts`：先在仓库外创建
0700临时目录及带`IP:127.0.0.1` SAN的一日测试证书`cert.pem`/0600私钥`key.pem`；
不安装到系统信任，不使用`NODE_TLS_REJECT_UNAUTHORIZED=0`。在Server既有受保护
测试入口设置`NEWMONEY_TEST_LIVE_DIRECTORY`为该目录，等`connection.json`出现，
然后在本仓库运行：
`NODE_EXTRA_CA_CERTS=/absolute/private-directory/cert.pem PI67_NEWMONEY_LIVE_DIRECTORY=/absolute/private-directory corepack pnpm exec vitest run apps/desktop/src/shared-knowledge-live.test.ts`。
只对这个测试进程添加证书信任；不要读取/打印`connection.json`，其中含短期合成
测试会话。Server提供300秒loopback真实API窗口，测试HTTPS代理只转发到该
loopback目标；通过真实Gateway/Host同步/Main独立授权/broker、网络及VPS PG验证。
夹具管理写入使用30秒控制请求预算、代理35秒闲置上限，以覆盖Mac→VPS数据库的
多次往返；产品Gateway/Main各自的8秒限制保持不变，不能用夹具预算证明产品性能。
凭据存储和Host/Main消息连接仍是进程内测试实现，不是系统安全存储或Electron IPC。
模型白名单为空时仍可同步，但模型授权拒绝；只生成索引输入，不运行模型/原生worker。
Desktop关闭监听后写`complete.txt`；Server关闭其监听、移除会话交接文件并按
专用测试库合同reset。必须同时检查两进程exit 0及测试库清理，不能仅凭标志文件
宣称通过。失败/超时也检查监听、私有目录和数据库残留；最终精确删除TLS私钥、
证书、控制文件及空目录，关闭任务隧道。没有设置目录时此项跳过，不是live通过。
命令不构建/导入sibling源码，不修改产品HTTP限制、全局TLS配置或默认工具开关。

跨仓wire接收验收：在Server仓库的受保护`postgres_flow`测试中显式设置
`NEWMONEY_TEST_CONTRACT_OUTPUT=/absolute/task-directory/publication.json`，沿用
该仓库`docs/VPS_DATABASE.md`中的专用VPS测试库/凭据/隧道启动方法。只有整轮
测试exit 0后才消费本次新生成的文件；导出拒绝覆盖，不能复用旧文件冒充新结果。
随后在本仓库运行：
`PI67_NEWMONEY_CONTRACT_INPUT=/absolute/task-directory/publication.json corepack pnpm exec vitest run apps/desktop/src/shared-knowledge-server-contract.test.ts`。
缺少输入时这3项跳过，不是验收通过。输出仅含固定合成内容、发布回执事实及原始
upsert/revoke同步JSON，不含凭据；两仓不互相导入源码或构建。测试通过真实协议
校验、Main receipt落盘/重开及索引job物化，当前读取权限使用显式合成guard。
不更改响应时间/租约，也不把历史响应当作实时授权；不是Host在线同步、原生索引/
模型/检索、Electron或生产服务联测。文件放仓库外独占临时目录，验收后按精确路径
清理，只保留hash/字节数与结果摘要，不提交内容文件。

Canonical Pi工具回归：`corepack pnpm exec vitest run packages/pi-runtime/src/team-knowledge-tools.test.ts packages/pi-runtime/src/team-session-birth.test.ts packages/pi-runtime/src/team-history-authorization.test.ts packages/pi-runtime/src/safety-extension.test.ts apps/agent-host/src/task-runtime-registry.test.ts`。
验证真实Pi内存/JSONL及SDK注册、选择/版本/来源/模型检查，默认不启用Host的
`canonicalTeamKnowledgeTools`。历史current-read复用下方正文协议/reader/client
入口测试；与exact-read相同的资产revision约束，不允许因无关snapshot更新取新版本。
Host显式开启仅为分阶段接线，不替代索引生命周期及安装包联测，不删除旧工具。

Main一次性查询/receipt私有协议回归入口：
`corepack pnpm exec vitest run apps/desktop/src/team-index-query-sessions.test.ts apps/desktop/src/team-index-reader.test.ts apps/agent-host/src/context/shared-knowledge-receipt-client.test.ts packages/protocol/src/shared-knowledge-query.test.ts`。
验证Main读取并检查发布模型、queryId单次消费、四席位/60秒时限、关闭取消但底层
完成前不释放、模型/向量/结果字段边界，以及真实临时receipt/索引副本/资产版本。
reader组合用合成runtime admission/native查询回调；真实OV另跑已有
`team-index-worker.native.test.ts`，两组通过不等于正式签名包联合验收。私有协议
改动需运行`corepack pnpm --filter @pi67/protocol run generate:revision`并检查生成差异。
Host内部元数据搜索及独立精确版本正文传输已接通；Pi会话绑定的canonical工具
已有显式启用接线，产品默认未启用、Renderer入口尚未接通，不因此删除旧服务端搜索。
精确正文回归入口：
`corepack pnpm exec vitest run packages/protocol/src/shared-knowledge-read.test.ts apps/desktop/src/team-index-reader.test.ts apps/desktop/src/team-index-query-sessions.test.ts apps/agent-host/src/context/shared-knowledge-read.test.ts apps/agent-host/src/context/enterprise-team-query.test.ts apps/agent-host/src/context/shared-knowledge-receipt-client.test.ts apps/agent-host/src/host-server-team-query.test.ts`。
覆盖真实临时receipt/发布快照、旧版本/撤销/途中变化、正文哈希/结构、四席位及
关闭取消后等待IO、Host身份/配置失效和关闭确认。正文读取本身不触发Python/模型；
Pi通过出生身份和模型授权入口消费，不能直接放开内部read。上述Host单测的Main
回复仍是合成；原生联合用例见下文，不等于安装包端到端验收。
Host会话模型入口复用上面的`enterprise-team-query.test.ts`和
`host-server-team-query.test.ts`：新增同账号/服务匹配、出生项目与Agent模型先授权、
team/project明确范围、晚到/过期/取消/四席位及settings组合回归。普通内部read仍
不是模型许可；新入口也不能代替Pi真实会话、搜索选择或历史版本来源验证。
Host完整事务回归入口：
`corepack pnpm exec vitest run apps/agent-host/src/context/shared-knowledge-query.test.ts apps/agent-host/src/context/enterprise-team-query.test.ts apps/agent-host/src/context/enterprise-query-embedding-lifecycle.test.ts apps/agent-host/src/host-server-team-query.test.ts`。
验证先Main准备再embedding、精确模型/snapshot匹配、关闭确认、共享四席位、整个
事务60秒和身份/设置/Workspace/电源取消、模型工作完成前不释放。真实Host类组合
使用合成Main回复/账号/HTTP响应，不调用真实提供商或运行包，不等于packaged联测。

Host查询embedding回归入口：
`corepack pnpm exec vitest run apps/agent-host/src/context/team-query-embedding.test.ts apps/agent-host/src/context/enterprise-query-embedding-lifecycle.test.ts apps/agent-host/src/host-server-team-query.test.ts apps/agent-host/src/context/team-index-model-transport.test.ts apps/agent-host/src/context/shared-memory-model-request.test.ts`。
使用合成账号/HTTP响应和隔离Host配置，验证逐次团队/项目embedding授权、索引模型
匹配、8KiB文本与单向量/维度/模型校验、身份/设置/电源/Host取消和底层完成前
不释放四个并发名额；不调用真实付费模型，不解析extraction、不启动OpenViking。
设置仍从既有Main加密存储通道读取。新增Host内部方法不等于搜索IPC、真实索引
查询或packaged验收；实际提供商需满足严格的model/data/index/float响应合同。

正式团队工具启动回归：`corepack pnpm exec vitest run apps/desktop/src/agent-host-environment.test.ts apps/agent-host/src/host-server-team-startup.test.ts`。
Main在macOS arm64本地组成/profile成功后选择团队工具，独立于仍默认关闭的私人服务；
Host拒绝非法环境枚举及缺少settings通道的接线。`package:smoke`还从隔离合成Provider
收到的真实Pi模型上下文核对两个canonical工具各出现一次、私人开关为0（其他平台
两工具均不出现）。证据仅包含工具名/模式，测试不调用付费模型；不等于成功检索或
正式签名运行包安装，也不授予团队数据访问权限。

`corepack pnpm run verify:memory-settings:native` 在 macOS arm64 上使用现有 tsdown
构建独立 Electron Main 探针，验证合成记忆模型配置的系统加密和显式回读。需要已安装
依赖和可用系统安全存储；不读取真实模型配置、不调用模型，临时目录在退出后清理。
它不是安装包认证；`package:smoke` 另验证隔离 Profile 中的表单、IPC 与冷重启回读。

`corepack pnpm run memory:runtime:install-local <signed-installation-directory> <existing-runtime-parent>`
先构建当前 Main 安装事务，再将本地已签名目录导入到目标父目录下的固定版本目录。
两个参数必须是绝对路径、互不包含且由当前用户控制的目录；目标父目录须预先存在。
该运维入口会写入指定目标，使用前必须确认具体安装范围；开发验证使用独占临时目录，
不能把正常用户的 runtime 目录当夹具。它不下载、不替换已有版本、不启动服务、不读取
签名私钥。取消/失败回收本次 staging；进程异常退出留下的 lock/staging 需核对进程和
具体路径后人工恢复，不自动抢锁或删除。显式在两个参数后加 `--team-index-v1`，
导入同父目录下独立的团队版本；不加时仍是私人版本。团队版本要求签名树内的固定
v1 bootstrap，并在复制后再次验收，不覆盖/切换私人运行包。设置页提供私人、团队
索引和团队检索的独立安装行；用途由窄 IPC 传递，路径仍由 Main 固定，三用途共用
安装/取消事务，不自动启用功能。应用团队准备及启动前复验只读取团队目录，缺失
不回退私人或开发产物。
查询版本使用互斥的 `--team-query-v1` 选项，目标后缀同名，签名树内必须含
`newmoney-team/query/v1/team_query_worker.py`。三版本独立加锁并拒绝覆盖。
Main的 `teamQuery.prepareRuntime` 不创建run或私人profile，不调用模型；准备和
启动前都重新验签/测量完整树、核对固定bootstrap及物理路径分离，已正确签名但
内容更换也会使旧任务失效。省略查询目录则不可用，没有私人/index/repo fallback。
安装/三路径接线回归入口为
`corepack pnpm exec vitest run apps/desktop/src/openviking-runtime-installer.test.ts apps/desktop/src/application-local-memory.test.ts apps/desktop/src/installed-local-memory.test.ts apps/desktop/src/team-worker-preparation.test.ts`。
查询准入和固定bootstrap另运行
`corepack pnpm exec vitest run apps/desktop/src/team-query-runtime.test.ts apps/desktop/src/team-worker-bootstrap.test.ts eng/capabilities/prepare-openviking-native.test.mjs`。
这些测试使用独占临时目录、合成运行文件与内存测试签名；不证明正式团队运行包已
签署/安装、真实模型接通或 packaged 平台验收。文档命令不是执行安装的授权。

新增 script、配置或 workflow 须说明真实调用方、职责、输入/输出、前置条件和验证方式。
团队模型 transport 的离线原生回归为
`<pinned-runtime-python> -I -B eng/capabilities/openviking-runtime/team_model_transport_test.py`。
将占位符替换为已准备的受管测试运行包 `bin/python3.12` 绝对路径；入口强制核对
Python 3.12.10 / OpenViking 0.4.16。它在独立进程内使用真实 embedder/VLM 后端和
合成 exchange 响应，不启动服务、不使用模型凭据、不修改运行包。通过仅证明
adapter 的同步/异步、重试及错误边界，不证明 native IPC、Host 联通、签名或打包。
显式验证跨语言 IPC 时，在 macOS 设置 `PI67_TEAM_MODEL_TEST_PYTHON` 为同一个
固定运行包的 Python 绝对路径，再执行
`corepack pnpm exec vitest run apps/agent-host/src/context/native-team-model-channel.native.test.ts`。
它启动独立 Python 子进程，通过继承 FD 连接 Host enterprise controller 和逐请求
guard，并验证合成授权成功、拒绝和 controller shutdown 取消；未设置路径或非 macOS
时明确跳过。测试不读取真实配置或启动 OV server，不证明 Main 应用进程管理、真实
提供商、团队索引、运行包签名或 packaged Electron 已接通。Host 生命周期回归入口为
`corepack pnpm exec vitest run apps/agent-host/src/context/enterprise-team-model-lifecycle.test.ts`。
同一 `PI67_TEAM_MODEL_TEST_PYTHON` 下运行
`corepack pnpm exec vitest run apps/desktop/src/native-team-model-worker.native.test.ts`，
可验证独立团队进程的成功、拒绝、取消和根进程退出后的后代清理。该测试创建独占临时
工作目录；确认进程组退出后清理，失败时保留目录。stdout/stderr 不转发，只在失败时
读取本次进程组的 PID/状态/程序名。运行环境须允许操作本次创建的 macOS 进程组，
权限受限必须标记失败，不把 EPERM 当作清理成功。此入口不启动 OV server、调用真实
模型或写用户记忆；Main adapter 与 Host controller 经真实 Node MessageChannel 中继，
但仍在同一测试进程，不证明 Electron 父通道的端口移交或应用启动接线。
专用中继的消息验证、ACK/超时和真实 MessagePort 背压/关闭回归入口为
`corepack pnpm exec vitest run packages/protocol/src/team-model-relay.test.ts apps/desktop/src/native-team-model-relay.test.ts`。
真实 Electron 父通道移交使用
`corepack pnpm run verify:team-model-port:native`。它在 macOS arm64 上以现有
依赖构建两个独立探针入口，使用独占临时 userData、MessageChannelMain 与 utilityProcess，
验证合成字节双向传输、owner取消、Host退出及未登记端口拒绝；不运行产品入口、
Python、OV server、模型或用户配置。确认子进程退出且通过后清理本次临时目录，
失败保留目录且不输出子进程载荷。它不证明产品worker启动、签名、索引或Windows。
准入/监督器/授权生命周期的源码回归为
`corepack pnpm exec vitest run apps/agent-host/src/context/team-model-port-admission.test.ts apps/desktop/src/team-model-port-supervisor.test.ts apps/agent-host/src/context/enterprise-team-model-lifecycle.test.ts`。
同一`PI67_TEAM_MODEL_TEST_PYTHON`下执行`corepack pnpm run verify:team-worker:native`
验证独立Electron Main/utility Host/Python的两阶段worker握手。准备席位不接受端口，
Main完整验签后才发送prepared并打开5秒移交窗口；success夹具额外延迟6秒，专门
回归旧5秒窗口冲突，非性能基准。其临时测试签名、合成授权/模型、固定探针bootstrap
不代表生产签名包或产品入口；成功、拒绝、取消、Host退出均须证实进程组已退出。
源码时序回归使用
`corepack pnpm exec vitest run apps/agent-host/src/context/team-worker-broker-client.test.ts apps/agent-host/src/context/team-model-port-admission.test.ts apps/desktop/src/team-worker-supervisor.test.ts`。
团队准备定向回归使用
`corepack pnpm exec vitest run apps/desktop/src/team-worker-preparation.test.ts apps/desktop/src/local-memory-identity.test.ts apps/desktop/src/shared-knowledge-receipt-binding.test.ts apps/desktop/src/installed-local-memory.test.ts apps/desktop/src/local-memory-service.test.ts apps/desktop/src/application-local-memory.test.ts`。
它验证隔离目录、现有档案只读匹配、固定验签入口、原receipt namespace及拒绝/清理，
不启动真实模型或索引；非macOS 14+ arm64只验证不支持目标拒绝，不能据此声称原生支持。

正式用途的团队bootstrap有独立原生索引回归。在同一固定
`PI67_TEAM_MODEL_TEST_PYTHON`下运行
`corepack pnpm exec vitest run apps/desktop/src/team-index-worker.native.test.ts`，
验证合成SOP实际向量写入、模型授权拒绝、取消及版本hash拒绝。使用Node测试进程内
的Main/Host owner和独立Python，不等于真实Electron三进程或生产签名包联合验收。
该原生用例从实际receipt binding经Main job writer生成输入，物理退出后由Main校验
完整scope/资产版本回执；Main读取授权为合成回调，不声称线上授权或索引发布已接通。
成功分支还将同一真实发布索引串联Main receipt broker、Host Workspace-bound
会话端口、Pi canonical搜索/读取工具及持久JSONL重开；Main协议结果和原生向量
查询均非预制返回。验证重开清除搜索选择、非当前分支历史按同版本重新读取、
Main撤权/Agent政策拒绝、历史保留且禁止私人捕获，以及查询进程退出/副本清理。
成功分支另追加真实Pi AgentSession工具循环：使用Desktop资源/安全扩展和
shared-history guard，仅将模型stream替换为确定性的搜索、读取、结束响应。
由SDK执行已注册的canonical工具并自动保存assistant/toolResult配对JSONL；
同一原生索引返回的正文必须到达第三次模型请求，重开JSONL后仍按精确版本
重新授权读取，且不具备私人捕获资格。撤销Agent模型政策后，下一次请求必须在
进入测试模型stream之前拒绝，不能增加embedding或Main请求。原手动调用回归
继续保留。独立SDK接线检查入口为
`corepack pnpm exec vitest run packages/pi-runtime/src/team-knowledge-agent-loop.test.ts`；
该项不带原生运行包，不能单独证明native/Electron/在线授权或真实模型语义质量。
Pi夹具位于`packages/pi-runtime/src/team-knowledge-native.test-support.ts`，仅依赖
自身Session/Tool合同及注入端口，不使Desktop直接依赖Pi SDK或runtime反向依赖app。
成功分支现在先复制真实运行树，在独占临时目录以仅内存Ed25519测试密钥签署，
经实际安装事务分别导入index/query版本；实际Main准备和启动前复验不再mock。
同一安装包执行原生索引、查询及上述Pi链路，结束后检查原始运行树、两安装树、
manifest/signature均未改变。source仅更新临时副本的当前bootstrap；不读取正式
私钥、不安装/激活日常profile、不修改产品信任键。完整复制与验签增加测试IO，
夹具准备限180秒、单例限240秒；45秒索引截止在物理退出时结束，后续查询保留
各自生产期限，不把索引计时误用于多轮验证。进程退出不确定时保留现场目录。
该联合用例仍手动接收合成同步页并执行发布guard；Main授权/head、HTTP提供商
是合成输入，信任键是临时测试键；同时包含手动工具检查和确定性模型stream驱动
的真实Pi循环，不证明真实服务同步调度、实际Provider的自主决策/语义效果、
产品默认开关、Electron IPC或正式受管签名安装包。
读取和重开历史不再调用embedding；失败分支仍保留较小的合成准入夹具。
Main交付/失效/结果拒绝边界可单独运行
`corepack pnpm exec vitest run apps/desktop/src/team-index-job.test.ts apps/desktop/src/shared-knowledge-receipt-binding.test.ts apps/desktop/src/team-worker-preparation.test.ts`。
实际索引文件树与job集成回归为
`corepack pnpm exec vitest run apps/desktop/src/team-index-artifact.test.ts apps/desktop/src/team-index-job.test.ts`。
使用合成临时文件验证内容指纹、目录/文件替换、权限、link/FIFO拒绝、预算、取消和
再次使用时的snapshot/read-grant校验；不证明数据库可查询或真正不可变封存。
超大文件案例使用稀疏临时文件并在读取内容前拒绝；不会扫描用户profile。
native index成功分支另要求真实输出通过文件树验证，源码测试跳过native不算通过。
Main内部原子发布的POSIX回归为
`corepack pnpm exec vitest run apps/desktop/src/team-index-publication.test.ts`。
覆盖真实临时文件刷盘/指针替换、旧代保留、版本倒退/epoch拒绝、篡改、并发、
取消、强制提交复核和rename后不确定结果。callback为合成授权/head断言，不是
服务端授权或Host publish协议证明。Windows整组跳过；当前生产准备只允许macOS。
上述native index成功分支还使用显式合成commit guard发布临时指针并读回；真实
Python/OV输出会经历刷盘及多次文件校验，但不代表用户入口或实际检索已接通。
同一native成功分支现在还运行`eng/capabilities/probe-team-index-readonly.py`：
只允许带显式标记的`new-money-team-index-*`测试临时目录，缺标记须拒绝且
保持原文件不变。它用固定8维合成向量调用OV本地collection的reopen/query/
close，不调用模型；应观测到query hits、metadata写入和Main完整性拒绝。
这是证伪普通SDK原地只读打开的回归，不是只读worker验收；严禁对用户profile
运行或将探针纳入签名运行包。SDK代码及生产bootstrap未因此修改。
同一成功分支还通过Main artifact的工作副本bracket运行该探针：真实查询须命中，
SDK只改副本metadata，子进程退出后清理副本，正式代际仍通过完整性检查。
输出仅含合成索引bytes/files及准备/子进程/收尾时间，不输出命中正文；这些数值
不是生产性能预算。Main bracket/reader回归仍使用上述artifact与reader测试入口，
覆盖逐块复制、内容一致但inode分离、部分复制取消、超限/篡改拒绝、查询失败、
撤销/超时后的结果拒绝、目录替换保留以及退出确认前不删除/不释放容量。
callback必须等查询子进程及后代物理退出才settle；该合同还需未来生产监督器实现，
不能把Promise取消当退出证明。异常进程死亡后的遗留副本、SDK运行期磁盘硬配额、
大语料性能和packaged查询尚未验证；本入口不删除真实残留或启用用户搜索。
同一native成功分支另覆盖真实restored reader→工作副本→FD3原生向量查询→进程组
退出→当前资产版本映射，断言命中具体合成SOP而非仅检查hits非空；随后在真实spawn
后取消查询，确认group不存在、副本被清理和正式artifact不变。scope/模型授权与
query runtime admission仍为合成回调，不证明签名安装/Host embedding或产品入口。
低层进程和协议回归为
`corepack pnpm exec vitest run packages/protocol/src/native-team-query.test.ts apps/desktop/src/native-team-index-query.test.ts apps/desktop/src/native-team-model-worker.test.ts apps/desktop/src/team-index-reader.test.ts apps/desktop/src/team-index-artifact.test.ts`。
Python离线请求/root校验为
`<pinned-runtime-python> -I -B eng/capabilities/openviking-runtime/team_query_worker_test.py`。
查询进程使用固定OV底层编码路径及account/asset双过滤，不以自动目录记录充当文档。
覆盖分帧/额外帧/UTF-8/容量/结果范围、ACK后等待物理退出、取消及cleanup不确定隔离。
不确定退出须保留副本及reader席位并禁止本Main进程继续查询，不自动删除残留或
重试；原生监督器的后代清理另运行上述native-team-model-worker.native.test.ts。
`team_query_worker.py`有独立受管查询版本准入，未加入已安装index-v1签名树；实际
查询运行包尚未签署/安装，不允许以repo路径绕过准入。本轮未新增Main模型调用
或更改用户搜索接口。上述native fixture仍使用合成runtime admission；不要把
两组独立测试拼成正式签名包的原生联合验收。
私有发布请求及Main保留/消费/权限组合回归为
`corepack pnpm exec vitest run apps/desktop/src/shared-knowledge-index-publication-broker.test.ts apps/desktop/src/shared-knowledge-receipt-broker.test.ts apps/agent-host/src/context/shared-knowledge-receipt-client.test.ts packages/protocol/src/shared-knowledge-receipt-broker.test.ts`。
覆盖限时保留、时钟/身份变化、旧handle/重复请求、四项容量、Main重新读取授权、
精确head/model回调，以及可能已提交时的错误保真和Host迟到/超时。使用真实
credential binding与临时receipt目录，但scheduler、publisher及授权/head响应为
合成夹具；实际文件发布另由上面POSIX/native用例证明，不是生产跨进程联合证明。
恢复已发布索引的Main读取准入回归为
`corepack pnpm exec vitest run apps/desktop/src/team-index-reader.test.ts apps/desktop/src/team-index-publication.test.ts apps/desktop/src/shared-knowledge-receipt-binding.test.ts`。
使用真实独立临时profile、receipt链、job/result、文件哈希和原子发布后重新
建立binding读取；索引文件内容及read/head授权是合成夹具，不启动数据库或模型。
覆盖私有目录/profile/指针/manifest/模型/有效资产版本/字节检查、receipt撤销、
替换与取消、期限、四项容量、等待期间篡改及Main broker fresh read/Host观察。
新接口仅Main内部使用，不开放Host路径、Renderer命令或检索入口；Windows跳过。
读取准入会完整重放有界receipt metadata、流式扫描artifact并在后来使用时复核。
这不是实际查询性能证明，不应在每条结果或每个token上重复调用完整扫描；查询
worker接入时须分别验证只读数据库行为、结果批量门禁和真实规模延迟。
生产装配已接入current-Host head/model observer；缺少该依赖仍明确拒绝，
内部Host索引编排已在成功wait/早期head观察后调用publish；普通receipt同步仍
不触发索引。不得将这组测试描述成团队索引已可搜索。
该复核通道回归为
`corepack pnpm exec vitest run apps/desktop/src/team-index-head-client.test.ts apps/agent-host/src/context/enterprise-index-head-observation.test.ts apps/agent-host/src/context/shared-knowledge-index-head.test.ts packages/protocol/src/shared-knowledge-index-head.test.ts`。
覆盖同进程Main client↔Host responder真实消息逻辑，以及实际Host credential
controller/Gateway配合合成HTTP响应的范围、模型政策、head/revision与可撤销期限。
包含超时、迟到回包、身份/配置/电源/Host失效和取消中IO容量；不读取真实凭据，
不访问真实服务或调用付费模型，也不是Electron跨进程、文件发布或检索联合证明。
团队索引调度/生命周期使用
`corepack pnpm exec vitest run apps/desktop/src/team-index-scheduler.test.ts apps/desktop/src/team-worker-supervisor.test.ts`。
该调度回归使用合成存储/运行包，不等于原生证明；上面的 native index 测试现经过
真实 scheduler → Main permit → Python → result 校验，但验签、reservation 握手、
read grant 与模型返回仍是测试夹具。生产入口、实时发布检查及运行包升级须另验。
内部receipt→index准备/登记/取消/等待请求的回归为
`corepack pnpm exec vitest run packages/protocol/src/shared-knowledge-receipt-broker.test.ts apps/desktop/src/shared-knowledge-receipt-broker.test.ts apps/desktop/src/enterprise-credential-supervisor.test.ts apps/agent-host/src/context/shared-knowledge-receipt-client.test.ts apps/agent-host/src/context/shared-knowledge-sync.test.ts`。
该链路固定Main身份、读权限和索引预算；请求不携带路径、凭据或正文。Host必须单独
拥有一个receipt handle，准备后才reserve/register/start，最后wait、早期head
观察、请求Main publish并close。
Host的显式index入口现在先验证模型政策，再用同一账号/范围追平receipt并确认
sync close，然后才开启独立index handle。同步阶段共用四席位/480秒总预算，
另限60秒/10页；失败保留已确认游标但不构建、不自动重试、不触发模型调用。
回归入口为`apps/agent-host/src/context/enterprise-team-model-lifecycle.test.ts`：
团队/项目范围、append/close顺序、分页超限、HTTP/存储失败和账号/配置/Workspace/
电源/关闭取消；结合`shared-knowledge-sync.test.ts`与`shared-knowledge-index.test.ts`。
这不改变设置页的仅同步行为，不代表启动/登录调度或产品工具开关已经开启。
设置页另有显式“本地共享索引”动作，经app范围`enterprise.knowledge.index`
调用上述Host owner；renderer仅提供team/project选择，不提供授权、路径或模型。
构建前提示用户模型费用和独立团队运行包要求；同一界面的同步/构建互斥，
身份或范围卸载取消，迟到回复丢弃。510秒ack期限不重放构建；取消或发布结果
不确定时不自动重试，成功仅说明本次本地发布确认，不是实时检索就绪。
入口定向回归为
`corepack pnpm exec vitest run packages/protocol/src/enterprise-knowledge-command.test.ts packages/protocol/src/port-client-request-timeout.test.ts apps/agent-host/src/host-app-command-dispatcher.test.ts apps/renderer/src/settings/SharedKnowledgeSyncSettings.test.ts`。
真实renderer交互回归为`tests/e2e/renderer-shared-knowledge-sync.spec.ts`；协议重建
完成后先构建renderer，再用`PI67_E2E_RENDERER_MODE=preview`运行，避免开发服务
重载造成无效样本。覆盖键盘焦点/激活、精确范围、并发禁用、停止、卸载和未知结果。
该UI测试使用合成Agent回复；普通packaged smoke也不证明真实服务、付费模型与
受管签名团队运行包的联合构建。默认canonical工具开关继续关闭，旧检索保留。
wait成功只表示Main验证的未发布结果，不表示可搜索；失败必须可观察。测试用合成
调度结果与临时receipt目录验证取消/跨handle/重复/迟到/容量/错误脱敏；Main应用
接线经源码门禁，尚非真实模型、生产签名包或packaged入口证明。
Host→Main发布联合回归为
`corepack pnpm exec vitest run apps/agent-host/src/context/shared-knowledge-index.test.ts apps/desktop/src/team-index-publication-flow.test.ts`。
联合测试使用实际Host事务、receipt client、Main broker/独立authorization reader、
head client/responder与Host credential controller/Gateway；HTTP、worker/scheduler、
artifact与文件提交是合成夹具，receipt目录为独立临时目录。覆盖提交边界read/
model/head拒绝、Host观察失效、提交后失败与丢失回应，不重试、不把cleanup当
回滚；成功只表示本地发布确认，不是检索、真实模型或Electron跨进程联合证明。
Host索引编排及准备阶段生命周期回归为
`corepack pnpm exec vitest run apps/agent-host/src/context/shared-knowledge-index.test.ts apps/agent-host/src/context/enterprise-team-model-lifecycle.test.ts apps/agent-host/src/context/shared-knowledge-sync.test.ts apps/agent-host/src/context/team-worker-broker-client.test.ts`。
它验证准备先于reservation、登记先于启动、Main验证与worker完成缺一不可，及
Main提前失败/迟到启动/身份或配置失效的取消和专用handle关闭。调度/授权响应为
合成夹具，不是正式模型凭据解析、真实Provider、用户入口或跨进程原生索引证明。
完成后的scope/model/head复核回归为
`corepack pnpm exec vitest run apps/agent-host/src/context/shared-knowledge-index-head.test.ts apps/agent-host/src/context/shared-knowledge-index.test.ts apps/agent-host/src/context/enterprise-team-model-lifecycle.test.ts packages/protocol/src/shared-knowledge-receipt-broker.test.ts apps/desktop/src/shared-knowledge-receipt-broker.test.ts`。
Main返回实际验证snapshot的epoch/cursor，Host使用真实Gateway及合成HTTP响应检查
最新版本、撤权、重置、超时/取消与清理期间过期。不会追加探测页、自动重建或发布；
该瞬时观察不等于原子发布/可搜索状态或真实服务端证明。
Host模型source与精确请求传输回归为
`corepack pnpm exec vitest run apps/agent-host/src/context/team-index-model-source.test.ts apps/agent-host/src/context/team-index-model-transport.test.ts apps/agent-host/src/context/enterprise-team-model-lifecycle.test.ts`。
使用合成Pi配置/密钥和HTTP流验证配置捕获、逐帧授权、重定向拒绝、响应大小、
错误脱敏与解析/传输取消，不读取真实设置或支付模型费用。
Main加密设置私有桥及Host组合回归为
`corepack pnpm exec vitest run packages/protocol/src/team-index-settings.test.ts apps/desktop/src/team-index-settings-broker.test.ts apps/desktop/src/local-memory-model-settings.test.ts apps/desktop/src/agent-host-local-memory.test.ts apps/agent-host/src/context/team-index-settings-client.test.ts apps/agent-host/src/host-server-team-index-model.test.ts`。
覆盖严格消息、临时加密store、当前ready Host、设置保存/重启/取消/超时/容量、
Host真实Pi合成配置与初始企业授权组合；不读取真实密钥，不启动索引worker或
Agent，不代表用户入口、真实模型调用、原生跨进程索引或已安装产品通过验收。
其中POSIX输出文件类型回归使用系统`mkfifo`创建独占测试FIFO，验证读取拒绝且不阻塞；
Windows条件跳过该场景。该系统命令在Knip中精确登记，不引入npm二进制依赖。
执行`<pinned-python> -I -B eng/capabilities/openviking-runtime/team_index_worker_test.py`
验证job输入边界；不读取用户配置、调用外部模型或修改已安装运行包。
bootstrap定位/签名树组合回归为
`corepack pnpm exec vitest run apps/desktop/src/team-worker-bootstrap.test.ts apps/desktop/src/team-worker-preparation.test.ts eng/capabilities/prepare-openviking-native.test.mjs`。

三进程联合验证使用同一固定 `PI67_TEAM_MODEL_TEST_PYTHON`，执行
`corepack pnpm run verify:team-worker:native`。它复用上述隔离探针驱动，以真实Electron
Main/utility Host加独立Python，验证Main预登记许可、逐请求合成授权、真实OV embedder
经中继取得合成模型响应、拒绝、取消及Host退出。每项确认native进程组不存在；不会
启动OV server、读用户配置、调用外部模型或写索引。子进程清理失败不声称通过，不删除
对应临时目录。探针用内存中临时测试密钥签署实际runtime树的manifest，经过共享准入
和独占staging准备，物理退出后仅回收空run目录；不改写运行包或生产信任配置。
它不证明产品启动编排、生产签名包/bootstrap、真实服务/Provider或最低系统版本。
启动协议与终态等待的源码回归为
`corepack pnpm exec vitest run apps/desktop/src/team-worker-supervisor.test.ts apps/agent-host/src/context/team-worker-broker-client.test.ts`。
跨平台单元回归为 `corepack pnpm exec vitest run apps/desktop/src/native-team-model-worker.test.ts`，
它模拟进程和信号，不是 Windows 或 macOS 原生证据。
先检查现有入口；重复实现可以合并，前置条件、外部副作用或证据等级不同的命令不能仅因名称相近合并。
共享代码至少有两个真实调用方；框架要求的配置继续放在约定位置，不作无收益目录迁移。

测试靠近所属模块；共享夹具明确资源所有权、等待期限和清理路径。优先事件/状态同步，
用于验证迟到事件或 debounce 的固定观察窗口须保留其行为目的。真实 Git、SQLite、进程等
重测试采用有依据的局部预算；禁止统一加大超时、用重试隐藏失败或降低覆盖率换取通过。
聚焦测试只用于本地诊断，CI 必须拒绝 `.only`。

分别测量产品性能、测试耗时和 CI 最长路径；记录源码、环境、样本和失败/重试。
并发、缓存或夹具优化应有前后对比；单次测量只证明该次结果，不声明长期 p95。
新增预算应先取得代表性基线，不能凭经验把目标写成已达成。

源码目录不接收生成声明、JS、日志或缓存；构建输出进入包的 `dist/`，测试和发布证据进入
已有 ignored 输出目录。发现泄漏先定位生成命令，保留证据，再修发射路径；不得用新增 ignore
规则掩盖源码污染。提交仅包含任务源码，生成文件和无关 WIP 保留在提交范围外。

## 本地门禁

以下为依赖安装及可用检查命令清单，并非每次任务都必须顺序执行。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test
corepack pnpm run check:architecture
corepack pnpm run check:dead-code
corepack pnpm run check:structure
corepack pnpm run check:production-transport
corepack pnpm run build
corepack pnpm run test:e2e
```

按 `AGENTS.md` 的 Validation routing 选择验证范围。先执行受影响包的检查和对应边界门禁；
跨模块、高风险、候选发布或影响不明时执行聚合 `corepack pnpm run check`。
输入未变且相关检查已通过时，仅因新失败、未解决疑点或明确门禁要求扩大或重复验证。

`knip.json` 对 `electron-builder` 保留精确的依赖检查例外：
`eng/packaging/package-native-unsigned.mjs` 与 `package-with-retention.mjs` 通过当前
仓库的 `node_modules/electron-builder/out/cli/cli.js` 子进程调用它，静态依赖扫描
不能识别这条文件路径。此例外不允许删除该依赖或改用全局 CLI；移除这两个调用方
时须重新核对例外，而不是扩大忽略范围。

本地与 CI 的统一源码验证入口为 `corepack pnpm run check:source`：调用原有完整 `check`，
固定使用 2 个 Vitest worker，不改变断言、超时、覆盖率或测试范围。需要候选源码前置检查时，
运行 `corepack pnpm run check:candidate`；它依次检查生产依赖审计、能力来源可达性、freshness、
Extension Adapter provenance 和完整源码门禁，任一步失败立即停止。这两个入口都不打包、
调度 workflow、上传或发布；候选仍需 clean exact-SHA 源码及平台打包/人工验收证据。

验证分流、测试并发、重试、报告和原生入口见 [CI 验证合同](docs/testing/ci.md)。
覆盖率范围与阈值见 [覆盖率合同](docs/testing/coverage.md)，产品性能预算见
[性能合同](docs/testing/performance.md)。文档与配置发生漂移时应修复两者的不一致，
不得以当前实现覆盖约定，也不得仅修改文档把未验证行为写成已通过。

TypeScript、浏览器预览、真实 Electron、真实平台和安装包证据必须分别报告，不能互相替代。

## Git 与发布

只暂存任务相关文件。`commit` 不等于 `push`；push、签名、notarization、GitHub
Release 和发布更新元数据都需要当前明确授权。不要 amend、force push、改写历史或
回滚无关 WIP。
