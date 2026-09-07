# 排队消息取消与终态收敛

Status: completed
Owner: Codex
Started: 2026-09-07
Last updated: 2026-09-07

## Goal

修复已复现的 RC-AUTH-102：队列异步准备未结束时，普通取消和 watchdog 恢复信号不能无限等待；迟到准备不能继续写入 Session 或入队。

## Non-goals

不扩大剩余审查、不更换 Pi runtime、不修改用户 JSONL、SQLite schema 或跨进程消息。

## Acceptance criteria

- 取消使用独立队列信号；不改变主任务 abort 失败后的恢复合同。
- Host 不等待不响应取消的队列准备，迟到 resolve/reject 均被观察且不能写入 Session。
- 正常排队、单一终态 receipt、Host replacement 信号顺序和恢复后新队列保持有效。
- 定向回归、全量 check 与 macOS packaged smoke 通过；人工/Windows 独立记录。

## Delivery boundary

Local implementation 已授权；本批不 commit/push、上传、发布。仅本地 macOS 打包预览。

## Current evidence

基线 ac85d06、开始时 worktree clean。上轮两项合成慢附件准备复现成立；实际 Registry 与 RuntimePromptAttachments，SDK Session 端点为夹具。普通 SDK 文字 steer/followUp 同步入队不是慢依赖来源。

## Affected boundaries

Host queue execution / terminal lifecycle；AgentRuntime 和 Pi Runtime 内部 steer/followUp 调用新增可选 AbortSignal。Renderer/protocol wire schema 不变。

## Decisions

队列取消独立于主 Operation signal；Host 将执行等待与底层 Promise 分离，保留迟到错误观察。Pi Runtime 在各异步准备和最后一次 Session mutation 前检查信号。

## Checkpoints

- [x] 复核缺陷触发条件及既有取消合同。
- [x] 实现与机制回归。
- [x] check / macOS preview 验证。
- [x] 结果与风险收口。

## Validation matrix

| Layer | Command | Result |
| --- | --- | --- |
| Tests | 取消队列与 runtime attachment 定向测试 | PASS；新增7项机制回归 |
| Source | corepack pnpm run check | PASS；3464 passed / 5 skipped |
| Packaged | corepack pnpm run preview:mac:unsigned | PASS；darwin/arm64 smoke、DMG/ZIP 校验与新应用启动 |
| Manual | macOS 人工 / Windows | UNVERIFIED |

## Rollback

只撤销本批 scoped diff；不删除或回滚用户 Session、DB、附件或无关 WIP。

## Risks and unknowns

无法撤销取消之前已完成的 Session 写入；保证取消后的下一次写入被阻止。底层未支持 AbortSignal 的 I/O 仍可能继续，但 Host 不依赖它完成才能发布终态。真实故障频率和 Windows 时序未验证。

## Closeout

- 基线 ac85d06 + 本批 12 个文件；未 commit/push/release。
- 完整 check：3464 passed / 5 skipped；新增7个机制回归。
- macOS arm64 packaged smoke 与新应用启动通过；app.asar SHA-256 `40cdc5aa8a328283086e096ddce1c812dc74115bd8eb56f5e260c3673c9460a5`，198060565 bytes。
- 独立验证回执 `/tmp/pi67-round4-fix-evidence.json` 绑定已通过门禁的代码文件哈希；关闭记录更新不改变运行代码。
- macOS 人工验收、Windows 及真实故障频率未验证。
- 收口时发现 CONTRIBUTING.md 的并发验证路由说明改动，非本批所有，保持原样；不计入本批12个文件。
