# Pi-67 Desktop Trellis 混合协作与顺序接力

## Goal

把当前未完成的 Trellis 初始化收敛为 Pi-67 Desktop 可长期使用的开发协作流：当前 CLI 或其原生子代理负责实现，L2 默认由一个跨 Provider Trellis Channel Worker 独立复核；只有用户明确要求时才把实现交给 Channel Worker；额度、质量或操作意图需要换平台时，由 Codex、Claude Code、Pi、Grok 在同一 Task 上顺序接手且尽量不丢上下文。

该能力只服务开发协作，不得成为 Pi-67 产品 Runtime、Agent Loop、Provider Router、Pi JSONL Session、Release 或 Git 的第二真源。

## Background

- 仓库已经生成 Codex、Claude Code、Pi Agent、Grok Build 和共享 `.agents/skills/` 的 Trellis 集成，但仍全部未跟踪。
- Codex 静态与 Hook 验证已通过；Claude 的旧独立复审因上游模型超时未产出，Pi/Grok 也尚未完成真实接续 Smoke。
- `AGENTS.md`、`PLANS.md` 仍禁止 Trellis，与已生成的 Workflow/Hook 冲突。
- `session_auto_commit` 当前使用 `true` 默认值，违反显式 Scoped Commit 合同。
- `default_package` 使用不存在的 `@pi67/agent-host` Key；大部分 Spec 仍是占位模板。
- `bigKING67` 和 `sixseven` 是同一用户的历史/当前名称；后续统一使用 `sixseven`。
- Trellis 0.6.15 的 Channel Worker 只支持 Claude/Codex。Claude Channel Adapter 使用 bypass permissions；Codex Channel Worker 默认 `workspace-write`，Pi-67 必须显式传 `danger-full-access`。

## Requirements

### R1. 工作路由

- L0 直接处理，不创建 Task/Channel。
- L1 默认当前平台原生执行与检查，并启用可接力的 Task/Handoff。
- L2 默认 `execution_mode=native`、`review_mode=channel`、`handoff_mode=relay`。
- 高风险 L2 必须完成独立 Channel Review，除非用户明确豁免。
- `execution_mode=channel` 只能由用户明确要求触发。

### R2. Channel 分层

- 每个 L1/L2 Task 可有一个非 Ephemeral Durable Relay Channel，只记录接力元数据。
- 每次 Channel Implement/Check 使用独立 Ephemeral Worker Channel。
- 普通接力不得 Spawn Worker；普通 Worker 运行不得写入 Durable Relay Channel 的 Progress 流。
- 同一项目最多一个 Live Channel Worker，完成后必须退出。

### R3. 顺序接力

- 提供项目本地 Relay CLI，支持 Ensure、Resume、Checkpoint、Release、Close、Status。
- “继续/接手”按 Continue 模式恢复；“换个思路/接手并复核”先独立核对现场再读前序结论。
- Session 可识别时做状态中立 Attach；不得因 Attach 把 `planning` 变成 `in_progress`。
- 多个候选 Task/Channel、路径不匹配、损坏事件必须 Fail Closed。
- Channel 不可用时回退到 Task Artifact、Git 和精确 `trellis mem`，不得伪造成功。

### R4. 真源与安全

- 冲突裁决顺序：Live Git/Worktree -> Task Artifact -> `handoff.md` -> Relay Channel -> `trellis mem`。
- Channel Event 不得包含 Prompt、源码正文、完整 Diff、Raw Log、Tool Payload 或凭据。
- Channel Actor 是协作标签，不是授权身份。
- 自动 Commit、Push、Deploy、Publish、Provider/Model 静默切换均禁止。

### R5. 权限和 Worker

- 交互式 Claude 在项目本地使用 `bypassPermissions`，配置文件保持 Git Ignore。
- Claude Channel Worker 的 Full Danger 必须通过 Live Smoke 验证。
- Codex Channel Worker 必须显式 `--sandbox danger-full-access`。
- Worker Brief 必须包含 Task、Editable/Forbidden Scope、验证命令和禁止操作。
- Worker 运行时主会话不得并发修改同一 Scope；结束后主会话必须重新核对 Diff。

### R6. 可维护性和工程门禁

- 只保留薄而真实的 Spec Map，不手工复制 79 份占位规范。
- 新增无第三方依赖的 Relay 单元测试和静态集成检查。
- 配置、平台入口、Workflow、权限边界和 Channel CLI 兼容性必须可自动验证。
- Trellis/平台适配改动不能无意义触发产品 Windows/macOS 打包。

## Acceptance Criteria

- [x] AC1. `AGENTS.md`、`PLANS.md`、`.trellis/workflow.md` 对 L0/L1/L2、Native/Channel/Relay 的定义一致。
- [x] AC2. `session_auto_commit: false`、有效 Package 策略、`max_live_workers: 1`、`idle_timeout: 5m` 和 Codex Native dispatch 已显式配置。
- [x] AC3. Relay CLI 通过单元测试，覆盖零/一/多候选、状态中立 Attach、事件校验、Hash 漂移、Takeover 和 Channel 降级。
- [x] AC4. 四个平台的 Continue/Review 入口使用同一 Relay 合同，且不会依赖隐式单 Session Fallback。
- [x] AC5. Same-CLI Smoke 完成 Codex Main -> Claude Channel Check；Claude Main -> Codex Channel Check 至少完成可行性验证或给出可复现 Blocker。
- [x] AC6. Codex -> Claude -> Pi -> Grok 顺序接续 Smoke 在总付费预算 USD 3 内完成，或逐平台记录真实 Blocker。
- [x] AC7. Worker 完成后没有遗留 Supervisor，未 Commit/Push，未修改 Scope 外用户 WIP。
- [x] AC8. 静态 Gate、目标测试和一次仓库完整 `pnpm run check` 通过；没有产品 UI 变更时不运行 unsigned preview。
- [x] AC9. 所有 Trellis/平台/治理改动形成可审查 Scoped Diff；不自动 Commit 或 Push。

## Out of Scope

- 修改 Pi-67 产品业务代码、Agent Runtime、Protocol、Renderer 或 Release 机制。
- 将 Channel Worker 扩展到 Pi/Grok Provider；当前只接受 Claude/Codex 边界。
- 修改 Trellis 全局 npm 安装或上游 Marketplace 模板。
- 自动信任 Grok 项目、修改全局 CLI 权限或写入凭据。
- 自动 Commit、Push、Tag、Release、Deploy、上传或删除 Channel 历史。

## Key Decisions

- Native-first implementation；L2 cross-provider Channel review；Channel implement explicit-only。
- 不全局采用 `channel-driven-subagent-dispatch`，而在 Native Workflow 上增加条件化 Channel 路由。
- Durable Relay Channel 与 Ephemeral Worker Channel 分离。
- 采用当前 canonical root checkout，不创建新的 Clone/Worktree。
- 当前目标设计分为 92/100；只有所有 Gate 与 Live Smoke 完成后才可声明达到。
