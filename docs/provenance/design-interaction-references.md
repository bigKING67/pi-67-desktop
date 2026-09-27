# New Money 设计与交互参考指南

审阅基线：2026-09-20（Asia/Shanghai）。类型：专题设计研究，reference-only。

本指南面向 New Money 的通用工作 Agent 研究方向：研究、写作、分析和编程。
它帮助后续设计者找到适合当前问题的依据；收录来源不表示其能力已经进入产品。
当前用户、行为、视觉、安全和进程合同仍以 [PRODUCT](../../PRODUCT.md)、
[DESIGN](../../DESIGN.md)、[深色设计](../../DESIGN.dark.md) 及相关 ADR/Protocol 为准。
本次不改变现有产品行为，也不新增 Agent、调度、远程计算机或另一套运行时。

## 如何选用

先定义用户要完成的工作及验收标准，再从下表选最相关的 1–3 个条目。
写清“借鉴什么、为什么适合、哪些不采用、如何验证”，无需每次重读全部来源。

| 当前问题 | 优先参考 | 需要回答的问题 |
| --- | --- | --- |
| 导航与工作组织 | [Grok Bot](#grok-bot)、[Beautiful UI](#beautiful-ui) | 用户回来要找项目、对话还是成果？哪些信息应先出现？ |
| 简化输入区 | [Beautiful UI](#beautiful-ui)、[AI Elements](#ai-elements) | 常用操作与展开设置如何分层，同时保持模型、模式和作用域可确认？ |
| 执行过程与状态 | [Grok Bot](#grok-bot)、[Beautiful UI](#beautiful-ui)、[AI Elements](#ai-elements) | 当前在做什么，是否需要用户介入，如何进入完整记录？ |
| 等待授权与失败恢复 | [AI Elements](#ai-elements)、[ChatGPT agent](#chatgpt-agent) | 区分偏好问答、权限决定、执行确认、失败与未知状态。 |
| 成果查看与继续编辑 | [Claude](#claude-artifacts-design)、[AI Elements](#ai-elements)、[Beautiful UI](#beautiful-ui) | 用户能否打开、检查、修改并继续使用成果？ |
| 主题、密度与组件一致性 | [Astryx](#astryx)、[Beautiful UI](#beautiful-ui) | 主次、字阶、间距、控件状态和浅深色能否形成一致系统？ |

## 权威与证据

- Pi 是唯一 Runtime 与行为规范源；pi-gui、t3code 仍是唯一综合实现参考。
  本指南不进入现有 S0/S1 JSON Catalog，详见 [参考治理](external-references.md)。
- 来源事实、项目建议、采用结果分开记录。正文中的“建议”均是候选，不覆盖现行合同。
- `文档已阅` 只证明阅读；`静态呈现已观察` 只覆盖实际画面；
  交互、可访问性、性能及目标 Electron 行为须有各自证据。
- 演示中的状态、进度、置信度、计时与连接标签不是实际执行证明；后台截图不证明动效。
- 不复制品牌、专有素材或文章全文。源码复用单独核验版本、许可证及 notice；
  许可证允许使用不等于已验证项目适配。

## 核心参考

### Grok Bot

- 来源：[Designing Grok Bot for a world of persistent agents](https://x.ai/news/designing-grok-bot)。
- 发布：2026-09-03；正文逐节审阅：2026-09-19；页面可达性/指纹复核：2026-09-20。
- 范围：文章正文和设计取舍；在线页面可变，未进行 Grok Bot 登录态产品验证。
- 权利：文章参考与原创概述；未确立源码或素材的再分发许可。

| 原文部分 | 来源观察：问题与取舍 | New Money 候选建议 |
| --- | --- | --- |
| Rethinking the primitives | 收敛用户需要理解的产品概念。 | 先梳理工作目标、成果及必要控制，避免把运行时概念全部变成导航。 |
| From chat history to a Bot roster | 持续身份承接跨会话责任。 | 先验证用户以项目还是角色组织工作；不直接替换现有对话模型。 |
| Presence as interface | 头像承载身份与状态，执行细节按需查看。 | 研究紧凑状态与详情入口；保留文字、键盘和 Reduced Motion 等价信息。 |
| Their computer, not yours | 比较浮窗、并排、模态与全屏后，分层开放工作环境。 | 先区分状态、查看与操作；预览不得隐含接管或授权。 |
| The shape of information | 让回答形式适合信息和动作。 | 报告、表格、Diff 和确认采用适合的受控组件，普通回答仍可用正文。 |
| Organizing intelligence | 能力共享与角色上下文分界，降低人工协调负担。 | 保持私人/团队边界；不由角色图标推导共享记忆或多代理能力。 |
| Work that keeps moving | 将例行工作及其结果带入主要体验。 | 仅在实际具备调度能力后设计入口，不能只画一个开关。 |
| The disappearing interface | 删除增加管理负担的控制。 | 依据真实任务决定显隐，保留影响授权、恢复和可追溯性的必要信息。 |

适用：任务过程显隐、用户介入、成果优先。限制：文章中的 hover、头像动画、
独立计算机、Bot 名册及 Routines 都不是本项目已实现或已批准的能力。

### Beautiful UI

- 来源：[Beautiful UI](https://www.beautifului.dev/)；[MIT License](https://www.beautifului.dev/license)。
- 审阅：2026-09-20；范围：组件目录、许可证、真实 Chrome 首页及 Prompt Bar 静态截图。
- 版本：在线展示，未固定发布版本或审阅组件源码。截图时页面为后台，
  动效、键盘、Reduced Motion、长内容、浅色和响应式行为均未验证。
- 权利：站点许可证标注 MIT；源码采用时核对实际文件、许可范围及版权通知。

| 优先组件 | 来源观察 | New Money 候选建议与边界 |
| --- | --- | --- |
| Prompt Bar | 输入与展开的来源区域分层呈现。 | 用于研究 Composer 主次；不复制其模型、连接器或 Web Search 开关语义。 |
| Tool Chips | 工具活动采用紧凑表示。 | 为已有关联 Tool Call/Result 提供摘要，保留完整详情入口。 |
| Task Rows | 展示任务及不同状态。 | 映射真实生命周期；不根据演示百分比创造虚假进度。 |
| Context Cards | 将内容片段与来源放在一起。 | 研究来源查阅，不能扩大私人或团队资料可见范围。 |
| Selection Actions | 选区可成为修改请求的对象。 | 研究写作时的局部修改；选区、版本、提交范围须可确认。 |

补充观察：其 Approval Card 示例是偏好问答，不能直接当成工具权限审批。
Agent Screen、Recommendation Card 仅作候选；界面不能声称尚不存在的控制权或置信度。
静态截图保存在审阅会话的仓库外证据中，不纳入 Git，可能按宿主保留策略过期；
后续实施须重新观察实际采用的组件，不能把这次有限观察升级为完整产品验收。

### AI Elements

- 来源：[仓库](https://github.com/vercel/ai-elements)、[文档](https://elements.ai-sdk.dev/)。
- 审阅：2026-09-19；2026-09-20 复核 README 指纹及根 LICENSE。
- 范围：README，以及 [Tool](https://elements.ai-sdk.dev/components/tool)、
  [Plan](https://elements.ai-sdk.dev/components/plan)、[Artifact](https://elements.ai-sdk.dev/components/artifact)、
  [Confirmation](https://elements.ai-sdk.dev/components/confirmation) 的在线说明与示例。
- 版本：可变 main/在线文档，未做固定 commit 源码审阅；浏览器交互及 Electron 适配未验证。
- 权利：[根 LICENSE](https://github.com/vercel/ai-elements/blob/main/LICENSE) 标注 Apache-2.0；
  具体组件、依赖及 notice 在采用时复核。

来源观察：它将 AI 界面拆为可组合组件，覆盖执行状态、计划、确认和成果。
Tool 文档使用 AI SDK 的 ToolUIPart；Artifact 是带操作区的内容容器。

项目建议：借鉴组件分工与信息层级，继续由 Pi-67 Domain/Protocol 提供真实状态。
不引入 useChat、AI Gateway 或第二套 Session/执行循环。当前 React Aria 基础保持不变；
新增依赖或迁移基础组件需有独立问题及兼容性证据。成果容器不等于成果存储、版本或导出能力。

### Astryx

- 来源：[仓库](https://github.com/facebook/astryx)、[文档](https://astryx.atmeta.com/)。
- 审阅：2026-09-19；2026-09-20 复核 README 指纹及根 LICENSE。
- 范围：README、[Core 说明](https://github.com/facebook/astryx/blob/main/packages/core/README.md)
  中的组件、主题和接入方式，以及 CLI 的文档查询入口；未审阅全部组件或 CLI 实现。
- 版本：审阅时 README 标为 Beta，main/在线文档可变；未固定 commit，未验证目标环境。
- 权利：[根 LICENSE](https://github.com/facebook/astryx/blob/main/LICENSE) 标注 MIT；采用时复核。

来源观察：组件、主题、命名约定、文档和 CLI 构成统一系统；提供预构建 CSS，
可用 CSS Modules 等方式覆盖；面向使用者不要求整套改用 StyleX 编写样式。

项目建议：优先学习组件语义、状态覆盖、主题和可查询文档，保持现有设计 token 真源。
不因“agent ready”标签直接迁移组件库；不运行会改写 AGENTS 的初始化命令作为阅读步骤。
其对可访问性和生产规模的描述属于来源声明，不替代本项目的键盘、焦点和性能验证。

## 补充专题

### Claude Artifacts Design

- 来源：[Artifacts](https://claude.com/features/artifacts)、
  [Claude Design 发布说明](https://www.anthropic.com/news/claude-design-anthropic-labs)。
- 发布：Design 说明为 2026-04-17；审阅：2026-09-19；页面指纹复核：2026-09-20。
- 范围：官方成果编辑、评论、导出与设计协作说明；在线页面可变，未验证登录态交互。
- 权利：产品研究参考，未确立界面资产或源码再分发许可。

来源观察：成果可以在对话之外继续编辑，通过评论或直接操作细化，并导出使用。
项目建议：研究报告、文档、表格和代码成果的重新打开与局部修改；区分草稿、
已保存内容、执行动作和确认结果。分享、导出、版本历史及执行生成内容均须各自能力合同。
不因外部产品支持某种格式或协作方式就宣称 New Money 已支持。

### ChatGPT agent

- 来源：[Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/)。
- 发布：2025-07-17；审阅：2026-09-19；范围：官方介入、控制交接、中断及部分结果说明。
- 版本：在线发布文章；未做登录态产品验证。2026-09-20 直接 HTTP 取指纹返回 403，
  页面字节指纹不可用，不能当成来源不存在；实际采用前复核官方内容。
- 权利：产品研究参考，未确立界面资产或源码再分发许可。

来源观察：产品允许用户在执行中补充方向、中断、接管浏览器或停止并获得部分结果。
项目建议：研究用户怎样理解等待、继续与停止；控制交接仅在真实能力支持时设计。
必须保留 Pi-67 已有授权规则，外部产品的审批阈值和远程计算机实现不直接移植。

## 页面指纹与复核

以下 SHA-256 是 2026-09-20 直接 GET 返回的响应体字节指纹，不是源码 commit、
签名、持久归档或完整交互证据。HTML 的构建 ID 和动态内容也可能导致指纹变化；
变化只触发重新阅读，不能自动推导设计或正文发生变化。原文和图片未复制入仓库。

| 来源载体 | SHA-256 |
| --- | --- |
| Grok Bot 文章 HTML | `23aa29aef5457138b18e56d7166e5c126334574dd85b377f20ecc00c48773f17` |
| Beautiful UI 首页 HTML | `def84b08120caf76c78e6216b7c523f62ff3ec53895b86d9ffd75736430e5499` |
| Beautiful UI license HTML | `db588a7e2e63f66caa252e3cc48a87b9fba221cca24bc0cfb5a19bcfb49f036f` |
| AI Elements main README 原始字节 | `9ea7b01645a1e45c1b885060c4b0ace42b88b9334b21b24d35a5f272ad86c20a` |
| AI Elements main LICENSE 原始字节 | `b4f9adb7c568904834d0dd6cc98d16c390d21ca32fc17ae7a267715269bd5529` |
| Astryx main README 原始字节 | `45c68dfd4966f41863a92c534d5840ecae496be8922b2fa1a96f7bf13c774484` |
| Astryx main LICENSE 原始字节 | `a6855be541fc8f446acd1bc4f2f8efce1ace6dce71dba32fcd8da553ee54b473` |
| Claude Artifacts HTML | `54878157b16d967e4a07863b6397872b74578fb670776045d5c7d4fa14a11cf9` |
| Claude Design 发布说明 HTML | `7d01a6f2dbe0a9f13ba526c530e493f226adc807c5421d9e9d62114ff7e4aef1` |
| ChatGPT agent HTML | 不可用：直接 GET 403；既有官方正文阅读证据保留 |

main 文件指纹对应 `raw.githubusercontent.com/<owner>/<repo>/main/README.md` 或 `LICENSE`。
未单独记录指纹的组件文档仍为可变辅助资料，不能将根 README 指纹视为其内容证明。

每次用于实施前复核相关条目。出现链接失效、产品改版、版本/许可变化、
项目定位或目标平台变化时，重新检查适用性和证据。无法核验的部分标为未验证或不可用，
不自动换成第三方转述。新增来源应补足具体缺口，不按热度、数量或“AGI 风格”标签入选。
不新增自动抓取、规则同步或定时任务。

## 项目采用记录

来源研究与项目采用分开维护。状态为：候选建议、已接受设计、已实现、已验证、拒绝采用。
每个状态有各自证据要求，不可仅因收录指南而升级：

- 候选建议：说明目标问题、来源条目、拟借鉴/不借鉴内容及适用限制。
- 已接受设计：链接已接受的 PRODUCT/DESIGN 条款或设计决策。
- 已实现：补充实际实现路径和变更记录，不能仅链接计划。
- 已验证：补充绑定实现版本的测试或真实目标界面证据，标明平台和未覆盖状态。
- 拒绝采用：记录原因和可重新评估的条件；不是对来源整体质量的判断。

| 项目议题 | 参考 | 状态 | 后续验收方向 |
| --- | --- | --- | --- |
| 输入区主次分层 | Beautiful UI、AI Elements | 候选建议 | 保留模型、模式和作用域可确认；键盘和长输入可用。 |
| 可理解且可检查的执行摘要 | Grok Bot、Beautiful UI、AI Elements | 候选建议 | 区分运行、等待、失败和连接未知；详情可达；不伪造进度。 |
| 成果查看与继续编辑 | Claude、AI Elements、Beautiful UI | 候选建议 | 成果与原任务关联，草稿/保存/执行状态明确，退出后可重新找到。 |
| 一致的视觉与组件状态 | Astryx、Beautiful UI | 候选建议 | 浅深色、字阶、焦点、错误和 Reduced Motion 一致。 |

本次实际采用的仅是参考指南及阅读入口；上述 UI 提案均未实施或通过验收。
未来改变行为或视觉规则时，在同一变更中更新对应权威文档；引用外部原则不能绕过合同。

## 索引验收样例

1. 简化输入区：从索引进入 Beautiful UI 的 Prompt Bar 和 AI Elements，
   识别主层/展开层，再对照现有 Composer、模型与权限合同；不能顺带新增 Web Search 开关。
2. 改善成果查看：进入 Claude、Artifact 和 Selection Actions，
   区分内容容器与持久成果能力，定义重新打开、局部修改和版本过期时的行为。
3. 等待授权：进入 Confirmation 与 ChatGPT agent，
   定义待决定、已批准、执行中及结果状态；排除把 Beautiful UI 偏好问答视作执行许可。

文档更新检查：入口与本地链接、来源及许可标记、状态证据、与现有合同的一致性，
以及 `git diff --check`、`corepack pnpm run check:references`、
`corepack pnpm run check:structure`。这些只验证文档与仓库合同，不证明 UI 或产品交互已通过。

## 中性深色主题采用记录

- 2026-09-23：用户确认以 Grok Bot 与 Vercel Geist 为有界视觉参考，采用
  近黑背景、灰阶面板、浅色主按钮；普通选中与强调去掉绿色，保留语义状态色。
- [Grok Bot 官方演示](https://x.ai/news/designing-grok-bot)的浏览器计算样式
  （本会话规划阶段读取）：panel `#070707`、sidebar `#111111`、composer `#181818`。
  仅为文章演示的静态证据，不是登录态 Grok 产品验收。
- [Vercel Geist Colors](https://vercel.com/geist/colors)的官方深色计算样式：
  background 100/200 为 0% 饱和度、4%/0% 亮度；灰阶分别承担组件背景、
  hover/active、边框和文字角色。采用角色分工，不引入组件库或复制品牌。
- 本项目目标值由 `DESIGN.dark.md` 管理；浅色主题和现有信息架构不变。
  实施/验收证据见 `docs/plans/2026-09-23-neutral-dark-theme.md`。

- 后续用户批准浅色主题同样使用黑白灰：白色画布、中性浅灰侧栏/选中、
  近黑主按钮和白色内容，文字、边框与阴影去绿偏。此批准取代前述
  “浅色主题不变”的范围限制；深色结果、语义状态色和信息架构继续保留。
