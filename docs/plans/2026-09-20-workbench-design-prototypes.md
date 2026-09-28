# New Money 主工作台双方案原型

Status: superseded (2026-09-28)
Owner: Codex main
Started: 2026-09-20
Last updated: 2026-09-28

## Goal

用相同研究、写作、编程示例比较 A「阅读优先」与 B「工作并排」，交付可交互预览和
同状态截图。用户在参考指南完成后接受了双方案工作台原型步骤。

## Non-goals

不接入真实 Pi 会话、账户、文件读取或权限执行；不改生产入口、共享 token、组件、
PRODUCT/DESIGN 已接受合同或依赖；不新增第二套运行时。

## Acceptance criteria

- 两方案可即时切换，内容、状态、模型/模式显示及示例行为一致；差异是信息布局与密度。
- 研究、写作、编程 × 新建、执行中、等待确认、完成、中断均可到达。
- 输入、搜索、来源弹窗、过程展开、确认/拒绝、重试、成果查看、局部编辑和下载可操作。
- 清楚标注示例边界；授权不冒充执行完成，失败可恢复。
- 浅深色、窄窗口、键盘焦点和 Reduced Motion 有适用检查；真实浏览器截图须观察后评审。

## Delivery boundary

- Local implementation: apps/renderer/design-preview 独立 Vite 入口与本计划。
- Commit / Push / Candidate build/upload / Tag/release/promotion: 不包含。
- 保留原型供选择；未选定前不接入生产。选定后的集成范围需另行明确。

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | HEAD 5b0bfac4853168560e7c049368a8f6e1c74393d5，main 比跟踪分支领先 5 | Git | 2026-09-20 |
| OBSERVED | React 19、Vite 8、CSS Modules、Lucide、既有品牌 PNG | renderer manifest/source | 2026-09-20 |
| OBSERVED | 先前真实 New Money 深色窗口外围密集、回答权重偏弱 | 本会话 Computer Use 观察，非当前 SHA 包验证 | 2026-09-19 |
| OBSERVED | 原型独立 typecheck/build 通过 | 本地命令 | 2026-09-20 |

## Affected boundaries

- Modules/processes: 仅独立前端原型，既有 renderer 不导入此目录；使用既有依赖。
- Protocol or persisted state: 无；状态只在页面内存，刷新重置。下载是用户点击的示例 Markdown。
- Platform/artifact: 本地 Chrome；构建进入根 artifacts/design-preview，未打包 Electron。
- Security/privacy: 资料、模型和状态均为 fixture，无账号、真实工作区或远端接口。
- Existing WIP: AGENTS、PRODUCT、DESIGN、参考文档、附件测试及本地 artifact retention 计划均不处理。

## Decisions

| Direction | Axis / hypothesis | Invariants | Tradeoff |
| --- | --- | --- | --- |
| A 阅读优先 | 中央正文为主，按需打开成果；适合阅读和研究 | 内容、五种状态、交互能力、品牌、语义色 | 查看完整成果需要主动打开 |
| B 工作并排 | 进展与成果并排；适合核对和反复修改 | 同上 | 更高信息密度，窄窗口需叠层查看 |

本轮用户授权测试布局、字阶、密度和表面层次；仅在原型内演进，未升级成生产设计规范。
参考：Grok Bot 的分层过程、Beautiful UI 的输入区主次、AI Elements 的成果和确认语义；
根据项目实现原创原型，不复制上游源码。基础组件决策 keep，未采用新库。
原型以完整主工作台为本轮比较单位，按用户已接受范围覆盖五种状态。

## Checkpoints

- [x] 1. 独立原型与方向假设。
- [x] 2. 原型 typecheck/build。
- [x] 3. 真实浏览器场景检查、截图和设计复核。
- [x] 4. 交付 ready_for_selection，保持生产边界。

## Validation matrix

| Layer | Command or procedure | Result |
| --- | --- | --- |
| Source | pnpm --filter @pi67/renderer exec tsc -p design-preview/tsconfig.json --noEmit | PASS |
| Build | pnpm --filter @pi67/renderer exec vite build --config design-preview/vite.config.ts | PASS |
| Browser | browser67 managed tab 1903755547 / port 5187 | PASS: 30 state combinations; bounded interaction checks |
| Source isolation / structure | production import scan / check:structure / diff check | PASS |
| Packaged / Windows | 不在原型交付范围 | UNVERIFIED |

## Rollback

原型没有生产路由接线或持久数据。停止本次 5187 Vite 服务即可结束预览；源文件与计划保留供选择。
未来删除或集成仅处理本次目录及计划，不删除用户 WIP，不创建新 clone/worktree。

## Risks and unknowns

示例状态不证明实际任务生命周期；没有真实模型调用。浏览器截图不能证明 Electron 或 Windows。
已观察 1440×900 浅色 A 新建/确认/完成/中断和 B 完成，以及深色 B 1440×900、760×900、390×900。
另已采集两方案全部五态同尺寸截图；未逐张放大评审的截图不计视觉验收。
后台静态截图不证明前台动效。完整原生键盘/屏幕阅读器、系统 Reduced Motion 切换、下载落盘未验证；
已检查 CSS Reduced Motion 分支、DOM 快捷键事件、弹窗初始焦点。

## Closeout

已交付独立原型、README 和本计划，保持 ready_for_selection。
浏览器检查覆盖两方案 × 三工作类型 × 五状态；搜索无结果/清空、新建清空、起点填入、
附件、Ctrl+Enter 事件发送、允许后执行中、停止、重试、资料弹窗焦点、成果关闭不切换方案、
结论编辑同步及三项设置显示已核验。修正中断文案，不再把主动停止/拒绝误称为连接故障。
3.2 秒 console observation 无 error/exception；只见 Vite debug 与 React DevTools 提示。
独立 typecheck/build、structure、diff whitespace 通过；production import scan 无引用。
证据清单：artifacts/design-preview/verification.json（忽略输出，包含截图路径/hash）。
服务保留 http://127.0.0.1:5187/ 供选择；源文件未 commit/push，未打包 Electron。
建议以 A 为日常默认，B 为展开成果后的工作方式；这是设计建议，尚未形成生产合同。

最终结构检查曾发现格式化后单文件超限；按工作内容、输入区拆为组件，响应式 CSS 独立。
修正后 typecheck/build/structure/diff 再次通过；浏览器无 Vite error overlay，正文和输入区正常，
最终 A/B 1440×900 截图重新观察，布局保持一致。managed tab finalize kept=1、unkept=0、errors=0。

## Outcome (2026-09-28)
The owner selected A「阅读优先」. It was absorbed as a direction within existing contracts by
`docs/plans/2026-09-28-workbench-reading-first.md` (phase 1 dbc751b, phase 2 ed58c64). The
prototype directory `apps/renderer/design-preview` was never committed and has been deleted; B and
the later `agent-workspace` preview were not adopted. Local captures under `artifacts/design-preview`
are ignored output and not part of the repository.

