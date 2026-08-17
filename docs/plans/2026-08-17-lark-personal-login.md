# 飞书个人登录一键准备计划

Status: complete-local
Owner: Codex
Started: 2026-08-17
Last updated: 2026-08-17

## Goal

让普通用户从“登录飞书”直接进入个人授权。首次缺少应用配置时，由
Pi-67 编排官方 Lark CLI 的一键应用准备，再自动继续用户 Device Flow；普通
用户不再需要手工提供 App ID 或 App Secret。

## Non-goals

- 不伪造“无应用 OAuth”；飞书开放平台用户授权仍由一个应用承载。
- 不在 Desktop 中内置 App Secret，也不新增 Pi-67 远端凭据代理。
- 不绕过企业管理员的应用创建、权限或版本审批策略。
- 不修改 Lark CLI、官方 Skills 或用户现有凭据存储格式。

## Acceptance criteria

- 缺少应用配置时，“登录飞书”仍可操作。
- 一次用户动作可启动 `config init --new`，安全取得 HTTPS 配置链接并打开。
- 应用准备完成后，Desktop 自动启动用户 Device Flow 并打开第二阶段授权链接。
- 初次用户授权使用 `--recommend`，不预先申请全部业务域；缺失权限后续按需增量申请。
- App ID、App Secret、Device Code、Token 和完整 scope 不跨 Renderer/Protocol。
- “应用连接”明确是复用已有自建或组织应用的可选高级入口。
- Windows contained process path可以流式转发有界输出，不削弱进程树清理。

## Delivery boundary

- Local implementation: authorized
- Commit: not authorized
- Push: not authorized
- Candidate build/upload: not authorized
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Renderer 用 `!appReady` 禁用“登录飞书”，并提示先配置应用 | `LarkOfficeSettings.tsx` | 2026-08-17 |
| OBSERVED | Lark CLI 1.0.87 的 `auth login` 没有无应用模式 | 本机隔离执行 `npx @larksuite/cli@1.0.87 ... --help` | 2026-08-17 |
| OBSERVED | 官方首选初始化是 `config init --new`，通过一次性 URL 一键创建并保存应用 | larksuite/cli `b6d04738e...` | 2026-08-17 |
| OBSERVED | 当前 bounded process runner 只在进程退出后返回输出 | `skill-pack-process-runner.ts` | 2026-08-17 |
| OBSERVED | 隔离 HOME 下 `auth status` 与 `auth login` 都以 `not_configured` 指示首次准备，而非网络故障 | 本机 Lark CLI 隔离执行 | 2026-08-17 |

## Affected boundaries

- Modules/processes: Agent Host, worker process, Protocol, Domain, Renderer Settings
- Protocol or persisted state: 增加非敏感登录阶段；不新增凭据持久化
- Platform/artifact: Windows x64 与 macOS arm64 共用逻辑，Windows 需新候选真机复核
- Security/privacy: 只把经过验证的 HTTPS URL 送到 Renderer；敏感字段保持 Host/CLI 所有
- Existing WIP: 保留 Windows CLI、执行收口、Inspector 和 Browser67 未提交改动

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| 普通登录自动编排一键应用准备 | 官方 CLI 没有无应用 OAuth，但支持不手输凭据的一键创建 | Pi-67 获得正式托管 OAuth 应用和安全后端 |
| 首次授权只请求推荐权限 | 降低普通员工的审批与共享应用滥用面；业务能力缺失时再增量申请 | 官方 CLI 改变推荐权限合同，或产品明确要求受管全域应用 |
| 已有应用连接保留为高级入口 | 企业/开发者仍可能复用受管应用 | 官方 CLI 提供完整组织托管绑定发现 |
| 输出观察保持 Agent Host 内存态且有界 | 必须在阻塞命令退出前取得配置 URL | 官方 CLI 增加 `--no-wait --json` 配置接口 |

## Checkpoints

- [x] 1. 进程 runner 能跨 Windows worker 安全观察有界输出。
- [x] 2. Agent Host 能完成应用准备 -> 用户 Device Flow 两阶段状态机。
- [x] 3. Renderer 主路径不再要求手工应用凭据。
- [x] 4. 目标测试、全仓门禁、打包态与视觉检查通过。

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | typecheck/lint/diff check | 无类型和静态错误 | passed |
| Tests | Lark auth/process/protocol/renderer E2E | 新合同回归 | passed: 23 targeted unit tests; 4 targeted E2E tests |
| Runtime/host | mocked two-stage process and renderer flow | 两个 HTTPS URL 顺序打开 | passed |
| Packaged artifact | unsigned macOS preview/package smoke | 精确新资源加载 | passed: darwin/arm64 packaged smoke |
| Target OS/manual | 新 Windows x64 candidate | 真实公司账号与策略场景 | pending |

## Rollback

恢复 `LarkAuthLoginStartResult` 旧合同、移除流式输出消息类型，并恢复 App 缺失时的
显式高级配置入口；不触碰已有 Lark CLI 配置和凭据。

## Risks and unknowns

- 企业租户可能禁止普通成员创建应用或要求管理员批准；Desktop 只能准确呈现，不能绕过。
- `config init --new` 当前没有 `--no-wait --json`，必须从有界进程输出中提取 URL。
- 当前 Windows 截图来自旧候选；本地 macOS 证据不能升级成 Windows 真机证据。

## Progress log

- 2026-08-17: 完成现场、最新版 CLI 和固定上游 commit 核对，开始实现。
- 2026-08-17: 完成两阶段登录、Windows worker 有界输出、协议与 UI 合同；Playwright 视觉检查通过。
- 2026-08-17: 完整 `check` 通过（565 files，2917 passed，3 skipped）；macOS unsigned packaged smoke 通过并打开预览。
- 2026-08-17: 复核官方安装向导后，将首次授权从全业务域收敛为推荐权限；共享应用 Secret 不进入 Desktop。

## Closeout

- Final source SHA: base `8a3c1a1117d7c830b1eb1f7259f599b431db0a0c` + uncommitted scoped WIP
- Changed files: Domain/Protocol, Agent Host Lark auth and process worker, Renderer Lark Settings, product/design authority, tests and packaged smoke contract
- Validation completed: targeted unit/E2E, full repository check, visual review, macOS arm64 unsigned packaged smoke
- Validation not completed: Windows x64 manual acceptance
- Remaining risks: enterprise tenant policy
- Commit/push/release state: none authorized
