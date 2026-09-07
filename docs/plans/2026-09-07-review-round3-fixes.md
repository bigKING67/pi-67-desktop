# 第三批审查修复

Status: completed
Owner: Codex
Started: 2026-09-07
Last updated: 2026-09-07

## Goal

修复 RC-RECOVERY-201/202、RC-CATALOG-201/202、RC-USAGE-201，保留正常恢复、JSONL 真源和有界索引。

## Non-goals

不扩大审查范围，不迁移用户 Session，不新增运行时、依赖或协议。

## Acceptance criteria

- 重启预算耗尽后普通连接不再 fork，显式 restart 可重新开始。
- 同一断线恢复期间保留 Operation 身份，权威终态可恢复；新 incident 和 Host replacement 不采纳旧终态。
- 短暂读取失败可在同版本恢复后重试，正常有界截断仍可缓存；失效 flight 停止后续读取。
- Usage 拒绝物理身份替换，正常同文件追加保持有效。
- 针对性回归、完整 check 与 macOS preview/package smoke 通过；人工与 Windows 证据单独记录。

## Delivery boundary

- Local implementation: 已授权这五项修复与本地验证。
- Commit: 本批未授权。
- Push: 未授权。
- Candidate build/upload: 仅本地 macOS 预览，无上传。
- Tag/release/promotion: 未授权。

## Current evidence

- 基线 0512bcd，开始时工作区干净。
- 上轮五项均 CONFIRMED/P2，使用隔离文件或合成 Host/Renderer 故障复现；未读取用户数据。
- Review Craft prepare-fix 已绑定全部五项；只配置 usage-tests，其余门禁单独保留实际回执。

## Affected boundaries

Desktop Supervisor、Renderer recovery ledger、Pi Runtime content-index/Usage；不变更跨进程 schema。

## Decisions

使用现有状态与物理身份合同做局部修正；派生索引失败须可重试，禁止改写 JSONL 真源。

## Checkpoints

- [x] 复核基线、合同、准备修复证据。
- [x] 修复及定向回归。
- [x] 集成 check、macOS packaged smoke 和预览。
- [x] 收口实际证据及剩余风险。

## Validation matrix

| Layer | Command | Result |
| --- | --- | --- |
| Tests | 受影响 Vitest 测试 | PASS；新增 13 个机制回归 |
| Source | corepack pnpm run check | PASS；678 files passed / 2 skipped，3457 tests passed / 5 skipped |
| Packaged artifact | corepack pnpm run preview:mac:unsigned | PASS；darwin/arm64 smoke、DMG/ZIP 校验、新应用启动 |
| Target OS/manual | 用户验收；Windows 未运行 | UNVERIFIED |

## Rollback

以独立 scoped diff 撤销本批源码/测试/文档；不得删除或回滚用户 Session、DB、无关文件。

## Risks and unknowns

保持正常有界不完整索引的缓存语义；同文件合法追加不能误报身份替换。合成故障时序不代表真实故障发生频率。

## Closeout

- Final source: 0512bcd + 本批 14 个源码、测试与文档文件；未 commit/push/release。
- 全量 source gate 通过，678 个测试文件通过、2 个跳过；3457 项通过、5 项跳过。
- macOS packaged smoke 通过，已打开仓库预览。app.asar SHA-256：`3cc76dc10cfd373476b18949f53a3f4db02b8bcd5acf77fead1fa9d4fb13c172`，198057410 bytes。
- 完整日志：`/tmp/pi67-round3-check-verified.log`、`/tmp/pi67-round3-preview.log`。
- 代码验证后的修改仅为本计划的验收记录更新。人工 macOS 验收、Windows 与真实故障发生频率仍未验证。
- 派生 content-index 算法更新导致现有索引在下一正常 flight 一次重建；不迁移 JSONL 或 SQLite schema。
