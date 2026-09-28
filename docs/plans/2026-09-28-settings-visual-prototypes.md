# 设置页视觉统一：双方案原型

Status: closed (2026-09-28)
Owner: Claude main
Started: 2026-09-28
Last updated: 2026-09-28

## Goal

设置页 V2（2026-09-25）只重构了信息结构，视觉沿用原有组件，16 页各自发挥。
用户评价“有点丑”并接受了“先原型、再抽共享组件、再分批迁移”的三步方案。本计划只覆盖
第一步：用三个代表页（外观+快捷键、账户与数据、扩展）做两个可切换方向，供用户选择。

## Observed problems (baseline, mock 1440 dark, 16 pages)

- 文案过载：页/节/行三层都有说明，多为工程或安全边界表述；快捷键每行三行字。
- 层级平：单节页 H1 与 H2 同名；节标题与行标题字号字重几乎相同。
- 同类元素不统一：≥5 种状态写法；两种折叠区与框中框；行首图标同卡片内时有时无；
  四种按钮轻重；原生 select/checkbox；蓝色文档式提示条；常驻禁用保存按钮。
- 宽度 880/1120 左对齐，1440 下右侧空约 280px，页头操作位置随页跳动。
- 根因：`SettingsPrimitives` 存在但 26 个页面私有 CSS 各自加样式。

## Non-goals

不接入真实 Host/Pi/账户；不改生产入口、生产组件、共享 token、DESIGN/PRODUCT 已接受合同；
不新增依赖；不打包 Electron。原型目录在选定并迁移完成后删除。

## Directions

| Direction | Divergence axis | Hypothesis | Invariants | Cost / risk |
| --- | --- | --- | --- | --- |
| A 安静列表 | 单列内联、低密度噪音 | 设置是低频浏览：居中单列、分组行、无行首图标、说明收进 ⓘ，最快降低“满屏小字” | 同一内容、token、导航分组、状态、主题、键盘可达 | 目录类页面（扩展、技能）条目多时滚动更长 |
| B 分栏目录 | 标签列+控件列表单；目录用列表+详情 | 利用宽窗口：表单左标签右控件，目录页选中条目在右侧看详情，页头操作固定 | 同上 | 窄窗口需退化为单列；实现成本更高 |

共同规则（两方案都遵守，便于比较真正差异）：统一状态标记（点+文字，四种语气）、
一页一个主按钮、一层下划线标签、页尾“高级”单一折叠样式、仅在有改动时出现的底部保存条、
非原生控件、单节页不重复标题。

## Acceptance criteria

- 方向 A/B、浅/深色可即时切换；三页内容一致，差异只在布局、密度、展开方式。
- 可到达状态：账户已登录/未登录、高级连接编辑后出现保存条（保存/放弃）、扩展有可更新与
  出错条目、快捷键存在自定义与冲突、空搜索结果。
- 键盘可达、focus-visible、对比度；1440 与 900 宽截图人工观察后评审。

## Delivery boundary

- Local: `apps/renderer/design-preview/`（独立 Vite 入口，生产代码不导入）与本计划。
- Commit / push / 打包：不包含，选定后另行确认迁移范围。

## Checkpoints

- [x] 1. 独立原型骨架与 fixture。
- [x] 2. 方向 A、B 三页。
- [x] 3. typecheck/build、生产隔离检查。
- [x] 4. 真实浏览器截图（1440/900 × 浅/深 × A/B）并复核，交付 ready_for_selection。

## Validation

| Layer | Command / procedure | Result |
| --- | --- | --- |
| Source | `pnpm --filter @pi67/renderer exec tsc -p design-preview/tsconfig.json --noEmit` | PASS |
| Build | `vite build --config design-preview/vite.config.ts` → `artifacts/design-preview/settings` (ignored) | PASS |
| Isolation | no `design-preview` import under `apps/*/src`; `lint`; `check:structure` | PASS |
| Browser | browser67 managed tab, port 5188: A/B × 外观/账户/扩展 at 1440 dark, B 扩展 light, B 外观 900; 保存条 dirty state | PASS (observed) |
| Packaged / Windows | 原型不在范围 | UNVERIFIED |

Findings fixed during review: A 卡片行分隔线被行重置覆盖；B 页头与标签双线；多组快捷键缺“或”分隔。

## Selection

用户选择“以 A 为主、目录页借用 B”。生产迁移见 `2026-09-28-settings-visual-unification.md`；
原型目录已在迁移完成后删除。

## Rollback

原型无生产接线与持久数据；停止预览服务并删除 `apps/renderer/design-preview/` 即可。
