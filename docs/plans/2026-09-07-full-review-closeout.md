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
