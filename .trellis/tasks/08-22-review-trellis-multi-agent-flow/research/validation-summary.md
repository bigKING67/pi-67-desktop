# Trellis 混合协作实现验证摘要

日期：2026-08-22

## 结论

实现、目标测试、跨 Provider Channel 复审和一次完整仓库门禁均已收口。
四平台顺序接力的共享合同已经落地，但本轮没有把 Claude、Pi、Grok
三个交互式 Main CLI 全部串成一次真实模型调用链；这是按预算和信任边界
停止后的已记录验证缺口，不能表述为四 Host 端到端 Smoke 已通过。

## Channel 复审

- Durable Relay：`relay-2026-08-22-review-trellis-multi-agent-flow`，无 Worker。
- R1 Channel：Claude Worker 发现继承的 `TRELLIS_CHANNEL_PROJECT` 会让
  Relay 测试读取错误项目桶，并补了项目级
  `.claude/settings.local.json` ignore。该 Worker 在最终总结前以 error
  结束，因此 R1 不计为成功复审。
- Codex 主会话随后在 Relay 子进程中移除继承的项目桶、保留测试隔离所需的
  `TRELLIS_CHANNEL_ROOT`，并增加污染环境回归测试；又修复了 Ephemeral
  Worker Channel 被误判为 Durable Relay 候选的问题。
- R2 Channel：Claude Worker 返回 `PASS`。本轮重新运行 Relay 9 项测试、
  Trellis static/live gate 和 CI classifier 19 项测试，均通过。之后主会话
  增补 Ephemeral Channel 回归用例，最终 Relay 套件为 10 项。
- R2 live 进程证据显示 Claude Worker 参数包含
  `--permission-mode bypassPermissions --dangerously-skip-permissions`。
  这证明本机 Claude Channel Worker 的 full-danger 权限，不证明 Codex
  Worker 的实际启动参数，也不证明其他机器配置。
- R2 费用回执为 `USD 1.487261`。两个 Ephemeral Channel 最终均为
  `workersAlive=0`，没有遗留 Channel Supervisor。

## 顺序接力 Host 边界

| 平台 | 当前证据 | 未验证项或停止条件 |
|---|---|---|
| Codex | Codex CLI `0.149.0`；Durable Relay ensure/checkpoint/status 已真实运行 | 无新的模型调用 |
| Claude | Claude Code `2.1.238`；真实 Channel Worker 复审和 full-danger 参数已验证 | Interactive Claude Main 的 Relay resume/release 未另行付费调用 |
| Pi | Pi `0.80.6`；项目 Prompt、Extension、`trellis_subagent` 和共享 Relay 合同由 static gate 验证 | 交互式 Pi Main Relay resume/release 未调用；预算止损 |
| Grok | Grok `1.0.5`；`grok inspect` 能发现项目 Skills/Agents | `Project trusted: no`，且预算止损；未自动修改信任状态，未调用模型 |

Claude Main -> Codex Channel Check 的可行性只验证到 Trellis 0.6.15 live
CLI 支持 `provider=codex`、显式 `--sandbox` 和 one-worker guard；没有启动
实际 Codex Worker，因此只属于可行性证据，不属于 Host Smoke。

## 预算止损

本任务较早的两次直接 Claude Code 复审已有可核对回执
`USD 3.175484`；R2 Channel 另有 `USD 1.487261`。可确认的累计下限为
`USD 4.662745`，R1 Channel error 没有生成费用字段，不能推断为零。
因为计划的 `USD 3` 上限已经被早期尝试超过，本轮没有继续发起 Pi、Grok
或 Claude Main -> Codex Worker 的付费模型调用。这是 AC6 使用 blocker
分支收口的原因，不是四平台真实串行 Smoke 成功。

## 工程门禁

- Relay：10/10 通过；在显式污染
  `TRELLIS_CHANNEL_PROJECT=parent-worker-bucket` 下仍为 10/10。
- Trellis：`check-trellis-integration.mjs --live-cli` 通过，live CLI 为
  Trellis `0.6.15`。
- CI classifier：19/19 通过；纯 Trellis/平台适配变更只触发 quality，
  不触发 Windows/macOS native packaging。
- `git diff --check` 与 Task manifest validation 通过。
- 首次完整门禁暴露 Knip 对生成的 Pi Extension 和全局 Trellis binary 的
  误判；已在 `knip.json` 做精确声明。
- 第二次完整门禁暴露产品结构规则错误扫描生成的 `.trellis`/`.pi` 目录；
  已让产品结构 gate 排除生成的 AI/Trellis adapters，并由专用 Trellis
  gate 验证 Pi Extension 入口、Tool 和 SessionStart hook。
- 后续一次全量测试中，既有 Provider configuration 测试出现单次离线启动
  预算超时；目标复跑 1/1 通过。最终完整 `corepack pnpm run check` 通过：
  581 个 Test Files 通过，3005 项测试通过、3 项跳过。
- 没有产品 UI 改动，因此按项目合同未运行 unsigned macOS preview。

## Git 与外部动作

- 未修改 `apps/`、`packages/`、产品协议、Runtime、Renderer 或发布逻辑。
- 未 commit、push、tag、release、deploy、上传或修改 Grok 项目信任状态。
- `.claude/settings.local.json` 保持项目本地、ignored、untracked。
