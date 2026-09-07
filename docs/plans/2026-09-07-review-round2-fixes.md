# 第二轮审查确认问题修复

Status: completed
Owner: Codex
Started: 2026-09-07
Last updated: 2026-09-07

## Goal

修复三项 Session 导入数据完整性问题、排队控制命令的 Session authority 缺口，以及 Package 实际更新范围与 Host 隔离范围不一致。

## Non-goals

不引入第二套 Session 真源、Agent loop 或 Package updater；两个 LIKELY 只核验真实触发条件，不依据猜测扩展实现。

## Acceptance criteria

- 外部 JSONL 原始字节保持不变；旧版迁移与末尾换行处理仅作用于托管副本。
- SDK 已采用的 Session 文件不因后置绑定失败被删除；切换前失败仍清理孤立副本。
- 原 Session 请求排队后在执行前重新验证 authority，合法重放保持兼容。
- Package fence/reload 范围涵盖 SDK 实际修改的全局资源。
- 针对性回归、跨模块 check、macOS 打包 smoke 完成；真实 Windows 证据单列。

## Delivery boundary

- Local implementation: 已授权。
- Commit: 本轮未授权。
- Push: 未授权。
- Candidate build/upload: 本地 macOS preview；不上传。
- Tag/release/promotion: 未授权。

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | 5 CONFIRMED，2 LIKELY；隔离探针复现 | 第二轮 sealed review，基线 27a0c85f0d5a7aa4e640336f7703794d975aa2a2 | 2026-09-07 |
| OBSERVED | 开始前 worktree clean；修复 selection 已绑定 | live Git 与 Review Craft prepare-fix | 2026-09-07 |

## Affected boundaries

- Modules/processes: pi-runtime Session import，agent-host request router 与 Package mutation coordinator。
- Protocol or persisted state: 保留协议 schema；保护 JSONL，不迁移用户现有数据。
- Platform/artifact: macOS arm64 本机验证；Windows 未重测。
- Security/privacy: 仅合成临时 Session，无真实用户数据或网络 API。
- Existing WIP: 开始前无 WIP；分片拥有不重叠文件。

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| 在既有模块修复不变量 | 问题有直接复现，无整体重写依据 | 出现无法由现有 SDK seam 实现的证据 |
| LIKELY 保留独立核验 | 合成机制证据不等于真实 CLI/SDK 触发 | 真实触发与生命周期合同确认 |

## Checkpoints

- [x] 1. 三项 Session 导入修复及真实 SDK 回归（12/12 targeted tests PASS）。
- [x] 2. Host authority 与 Package scope 修复及针对性回归（Host 13 项，最终 Package 36 项 PASS）。
- [x] 3. 两项 LIKELY 已核查实际调用链；真实永久挂起/CLI 后代触发仍未验证，保留待验证，不扩展修改。
- [x] 4. 集成 diff 审阅、check 与 macOS preview。

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Tests | 受影响 Vitest 文件 | 缺陷回归与兼容路径 | PASS：Session 12、Host 13、最终 Package 36；独立复核 18 |
| Source | corepack pnpm run check | 跨模块完整门禁 | PASS：676 files，3444 tests passed，5 tests skipped |
| Runtime/host | 真实 SDK 合成导入与 Host 交错请求 | 精确数据/authority 断言 | PASS；Host 使用真实 router/scheduler 与模拟 Runtime/Port |
| Packaged artifact | corepack pnpm run preview:mac:unsigned | 重新打包、smoke、打开仓库产物 | PASS：darwin/arm64，app.asar SHA-256 244bb0abd737f3fbd3913ee5543a4d271a4fbc98398a3db255c8dddd0c90353e |
| Target OS/manual | macOS 用户验收 / Windows | 独立目标平台结果 | macOS 新预览已打开待手验；Windows 未重测 |

## Rollback

仅回退本轮 scoped 源码变更；不重置整个工作区，不删除或恢复真实用户 Session。临时测试夹具由测试负责回收。

## Risks and unknowns

Pi SDK 更新实际跨 scope；必须保留原请求 scope 的 receipt 身份。故障恢复与重放例外必须保持。全仓审查覆盖仍未闭合。

## Progress log

- 2026-09-07: 复核 clean 基线并完成修复 selection；开始实施。

- 2026-09-07: Session 三项修复已通过真实 SDK 与既有回归；Host authority 修复通过 13 项针对性测试和 Host typecheck。独立只读复核进行中，Package scope 与集成 gate 待完成。

- 2026-09-07: 集成拒绝私有 SDK getPackageIdentity 方法；使用公开 update(source) 的真实跨 scope 合同，对所有 update 应用 global fence/reload，原 payload scope 仍绑定 receipt。代价是纯 project update 也需所有 Task 空闲；install/enable/uninstall 保持原 scope。

- 2026-09-07: 独立复核接受四项 Session/Host 修复；最终 Package 方案仅增加全局协调条件，不依赖私有 SDK。完整 check 已通过，macOS preview 正在重新打包。


## Closeout

- Final source SHA: 27a0c85f0d5a7aa4e640336f7703794d975aa2a2 加本轮未提交 diff。
- Changed files: PRODUCT.md、本计划、两组 Host router/test，以及 Session import/transitions 与新增真实 SDK 测试，共 9 个文件。
- Validation completed: 受影响测试、独立 Session/Host 复核、完整 check（3444 passed / 5 skipped）、macOS 重新打包与 packaged smoke、新预览启动。
- Validation not completed: 用户手验与 Windows 运行态；两项 LIKELY 的真实特殊触发条件。
- Remaining risks: 纯项目 Package update 也需所有 Task 空闲；保留 SDK queued prompt 挂起和 macOS Skill Pack 后代生命周期两项待验证。旧审查没有配置 canonical commands，本次实际命令日志独立保留，不将空命令 capture 作为测试通过证据。
- Commit/push/release state: 均未执行。
