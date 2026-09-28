# 设置页视觉统一（生产迁移）

Status: in progress
Owner: Claude main
Started: 2026-09-28
Last updated: 2026-09-28

## Goal

把 `2026-09-28-settings-visual-prototypes.md` 中用户选定的方向落到生产：以 A「安静列表」为主，
目录类页面（模型、扩展、技能、提示词、规则、快捷键）采用 B 的「列表 + 详情」。16 页的
信息结构、保存事务、草稿守卫与路由合同（Settings V2）保持不变，只改视觉与呈现层。

## Rules (land in DESIGN.md with batch 1)

- 布局：标准页 760px、目录页 1040px，均在内容区居中；页头操作与内容边缘对齐。
- 行结构：标题（13 medium）+ 最多一行提示（12 tertiary）｜右侧控件或状态；**行首不放图标**。
- 状态：`SettingsStatus`（点 + 文字；neutral/success/warning/danger）是唯一状态语言。
- 小节：标题 13 medium secondary；说明可选，仅在影响决定时出现；单节页不重复 H1。
- 标签：只用下划线表示选中；每页最多一层。
- 折叠区：单一「高级」样式（上分隔线 + 右侧箭头），脏或出错时不能折叠（沿用）。
- 提示框：只用于需要行动的警告/错误；信息性边界说明进入 `SettingsInfo`（ⓘ）或删除。
- 按钮：每页一个主按钮；次要刷新类为图标按钮或 quiet。
- 保存：仅在有改动时出现的底部保存条，替代常驻禁用按钮（批 3）。
- 控件：不使用原生 select/checkbox（批 3）。

## Batches

- [x] 1. 地基：布局宽度、共享组件样式、`SettingsStatus`/`SettingsInfo`、移除 `SettingsRow.leading` 并迁移调用方、DESIGN.md。
- [ ] 2. 文档页：外观/快捷键、关于、更新与诊断、账户、运行服务、飞书、浏览器集成。
- [ ] 3. 表单页：下载源与网络、上下文与记忆、视觉辅助（保存条、非原生控件）。
- [ ] 4. 目录页：模型、扩展、技能、提示词、规则、用量（列表 + 详情）。
- [ ] 5. 收尾：删除原型目录与失效私有样式、全量门禁、打包预览。

## Validation per batch

typecheck、lint、相关 unit、`renderer-settings*` 与受影响 e2e；`renderer-settings-layout` 16 页截图人工复核；
browser67 不能驱动 Electron，Electron 证据用打包预览窗口截图。每批本地提交，push 另行授权。

## Rollback

每批独立提交，按批 revert；无协议、配置或持久化变更。
