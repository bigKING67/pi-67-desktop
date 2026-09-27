# External reference governance

Pi-67 Desktop 只持续跟踪 `pi-gui` 与 `t3code` 两个综合参考项目。两者都可以用于研究
产品、功能、交互、UI、设计、架构、Harness、orchestration、runtime lifecycle、恢复、
测试和工程质量；不做永久领域分工，也不把 `t3code` 限定为 Harness 专项。

[设计与交互参考指南](design-interaction-references.md) 另行收录有界的专题研究来源，
用于信息架构、视觉、组件、Agent 反馈和成果交互。它不是第三个综合实现上游，
不扩展以下 S0/S1 Catalog，也不自动授予依赖安装、源码复用或产品行为变更。

`references.catalog.json` 是机器可读目录，`references.lock.json` 记录完成过的固定 commit
审阅，`licenses/provenance.json` 记录已经发生的代码重实现、改造或复制。删除旧参考项目的
治理记录不重写 Git 历史，也不删除已有实现；未来不得再以旧项目作为新功能的参考依据。
这条历史清理约束不排除用户新批准的专题来源；新增来源须在专题指南中明确范围和证据。

## Authority order

发生冲突时按以下顺序裁决：

1. `PRODUCT.md`、`DESIGN.md`、`DESIGN.dark.md` 和已接受 ADR；
2. Pi-67 Domain、Protocol、安全、隐私、平台和发布合同；
3. `earendil-works/pi` 的 SDK、Session、Extension、Model、Provider、Auth 和 Tool 语义；
4. 固定 commit 的 `pi-gui` 与 `t3code` 实现观察；
5. README、截图、宣传文案和未审阅的远端 HEAD。

专题指南中的来源观察和项目建议均服从以上项目合同及 Pi 行为规范；文档、截图和
真实交互证据分别标记，不能仅因被收录就获得固定 commit 实现审阅的证据等级。

`earendil-works/pi` 不是第三个可选产品参考，而是唯一 Runtime 与行为规范源。
`@earendil-works/pi-coding-agent` 是唯一 Agent Runtime；Pi JSONL 是对话真源。Pi 的实际
版本由 package manifest、workspace overrides 和 release contract 管理，不在 reference
lock 中维护第二份版本常量。

`pi-gui` 是当前主力参考基线，但不具有排他权威；`t3code` 与它同属综合参考源。同一能力
可以同时对照两者，再按 Pi-67 自身合同重做。仓库只保留 `origin`，不为参考项目增加长期
Remote、Submodule、vendored checkout 或自动同步。临时源码检查位于仓库外。

## Tiers

### S0 - specification

- `earendil-works/pi`：唯一 Runtime/SDK/Session JSONL/Extension/Tool 行为规范源。
- 每周检查 release/package 元数据；每次 SDK 升级使用独立 PR，并执行
  `docs/compatibility/pi-sdk.md` 的完整升级流程。

### S1 - comprehensive references

- `minghinmatthewlam/pi-gui`：当前主力综合参考基线。
- `pingdotgg/t3code`：并列综合参考源；Harness、orchestration 和 lifecycle 是当前已确认的
  强项，但交互、UI、功能、设计、架构、测试和其他优秀实现同样可以吸收。

两者每周只读检查远端 HEAD 与许可证漂移，并在相关功能立项时做固定 commit 深审。Catalog
中的 `reviewTriggers` 只是发现提示，不是允许研究范围的白名单。漂移审计只生成 Git ignored
artifact，不自动更新 Lock、Issue、PR、Remote 或源码。

## Review states

- `contract-managed`：仅用于 Pi；实际版本由 package/runtime contract 管理。
- `reviewed`：Catalog 与 Lock 同时存在记录，审阅范围、commit、许可证和结论可复核。

Lock 不接受 `null`、branch、tag 或短 SHA。`reviewedCommit` 表示实际读过的版本，
`remoteHeadAtReview` 只表示审阅当时观察到的远端 HEAD。远端前进不会自动改 Lock。

## Reuse policy

默认优先级是：问题定义 -> 固定 commit 研究 -> 按 Pi-67 Domain/Protocol 重新实现 -> 有来源地
改造 -> 最后才是复制。Reference 不自动扩大 roadmap、产品边界或进程权限。

从 S1 综合参考吸收实现时必须：

1. 先定义 Pi-67 自己的问题和验收标准；
2. 选择 `pi-gui`、`t3code` 或两者，并记录实际审阅职责；
3. 固定完整 commit，阅读相关源码、`LICENSE`、文件头和依赖；
4. 对照 Product、ADR、进程、安全、隐私和平台边界；
5. 增加对应的 protocol、policy、runtime、recovery、UI 或平台测试；
6. 更新 review lock；发生代码复用时同时更新 `licenses/provenance.json`；
7. 使用独立 scoped change，不与 Pi SDK 升级或无关功能混合。

多 Provider runtime、localhost server、业务 WebSocket、relay、telemetry、第二套 Session 真源、
Renderer Node/文件系统权限和自动源码同步仍不吸收。上述拒绝项来自 Pi-67 产品与架构合同，
不是对参考项目质量的评价。

`reimplemented`、`adapted` 和 `copied` 必须记录 source repository、完整 commit、source
path/hash、target path、license hash 和修改说明；`adapted` 或 `copied` 还必须提供发行物
所需的 third-party notice。

专题指南当前只记录设计研究，没有代码吸收记录。未来从专题来源复制、改造或基于
源码重实现时，必须先固定实际源码版本、核验许可证及文件头、记录来源与目标文件，
并在该次已授权复用变更内完善可表达该来源的 provenance/schema/检查器和发行 notice。
上述问题与验收定义、项目边界核对、适用测试及独立 scoped change 要求同样适用。
当前 Catalog 不接受这些来源，因此不能伪装成 pi-gui/t3code 条目或绕过既有检查；
未完成治理适配前保持 reference-only。文章启示与原创界面设计不冒充源码复用。

## Commands

离线合同检查，不访问 GitHub 或 npm：

```bash
corepack pnpm run check:references
```

只读远端漂移审计：

```bash
corepack pnpm run audit:references -- --id pi-gui --json
corepack pnpm run audit:references -- --id t3code --json
corepack pnpm run audit:references -- --tier S1 --json
corepack pnpm run audit:references -- --all --json
```

审计报告只写入 Git ignored 的 `artifacts/quality/`，不会更新 Catalog、Lock、Git Remote 或源码。
