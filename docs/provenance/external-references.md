# External reference governance

Pi-67 Desktop 会持续研究外部项目，但外部项目不是同一种“上游”。本文件负责解释角色、
审阅频率、允许的复用方式和产品边界；`references.catalog.json` 是机器可读目录，
`references.lock.json` 只记录真正完成过固定 commit 审阅的仓库。

## Authority order

发生冲突时按以下顺序裁决：

1. `PRODUCT.md`、`DESIGN.md`、`DESIGN.dark.md` 和已接受 ADR；
2. Pi-67 Domain、Protocol、安全、隐私和平台合同；
3. `earendil-works/pi` 的 SDK、Session、Extension 和 Tool 语义；
4. 固定 commit 的外部实现参考；
5. README、截图、宣传文案和未审阅的远端 HEAD。

`@earendil-works/pi-coding-agent` 是唯一 Agent Runtime。Pi 的实际版本由
`packages/pi-runtime/package.json`、`pnpm-workspace.yaml` overrides 和现有 release contract
共同管理，不在 reference lock 里维护第二份版本常量。

`pi-gui` 是首要产品与交互参考；Peak Code 保留为工程血缘和历史信息架构参考。两者都
不是可 merge 的 Git upstream。仓库只保留 `origin`，不增加外部 Remote、Submodule 或
长期 vendored checkout。需要源码比较时使用只读审计命令，临时 checkout 必须位于系统
临时目录。

## Tiers

### S0 - specification

- `earendil-works/pi`：Pi SDK、Session JSONL、Extension、Model、Provider、Auth、Tool Event、
  Compaction、Branch、Queue、Steer、Follow-up 和平台行为的唯一外部规范源。
- 每周检查 release/package 元数据；每次 SDK 升级使用独立 PR，并执行
  `docs/compatibility/pi-sdk.md` 的完整升级流程。

### S1 - core product references

- `minghinmatthewlam/pi-gui`：首要产品/交互参考，覆盖 Workspace、Thread、Session、
  Timeline、Worktree、Terminal、Diff 和多 Agent 编排；吸收时仍按 Pi-67 Domain、Protocol
  和进程边界重新实现。
- `PeakCode-AI/PeakCode`：工程血缘、三栏信息架构和历史产品对照。
- `justhil/pi-app`：Extension Adapter、Session Tree、Queue、Composer 和 Tool Card。
- `heyhuynhgiabuu/openpi`：Electron 权限边界、Command Palette 和工作台结构。
- `dodo-reach/apple-pi`：Session Catalog、Resume、Fork 和项目/会话导航。

`pi-gui` 每周只读检查远端 HEAD 和许可证漂移，并在相关功能立项时做固定 commit 深审；
其他 S1 保持每月与功能触发。漂移审计只生成 Git ignored artifact，不自动更新 Lock、
Issue、PR、Remote 或源码。

### S2 - feature and contrast references

- `Stack-Cairn/LiveAgent`：事件序列、恢复重放和未来远程能力；当前不得引入 Gateway、
  业务 WebSocket 或自定义 Agent Runtime。
- `shixin-guo/picot`：Windows 安装、更新和 Runtime 组合；不得迁移 Tauri 或增加 Windows ARM64。
- `gustavonline/pi-desktop`：Capability/Extension-first 对照；Pi RPC 和 system Pi fallback
  仍是明确拒绝的架构。
- `espennilsen/pilot`：Staged Edit、Change Review、Task Board；不得绕过 Project Trust 或
  one-shot approval。
- `BlackBeltTechnology/pi-agent-dashboard`：未来 Remote Companion；当前不得增加应用 TCP
  listener、Tunnel 或远程 Web 控制端。
- `amirlehmam/wmux`：未来 ConPTY 和终端性能；通用终端仍是 v1 non-goal。
- `Dwsy/pi-session-manager`：Session Library 和大 Catalog 导航；SQLite 不得保存 Prompt、
  Transcript、Thinking、Tool、Source 或 Patch。
- `carderne/pi-sandbox`：Sandbox/Allow-Deny Policy；平台实现必须分别在 Windows 和 macOS 设计、验证。

### S3 - supporting references

- `marcbaque/pi-ui`：只用于简单 Pi GUI 路径的快速对照，不是架构权威。
- `Eugeny/tabby`：只在通用终端、SSH、IME、Unicode 或 Terminal Profile 正式立项后研究。

S2/S3 不做定时深审，只允许功能触发或手动审计。

## Review states

- `contract-managed`：仅用于 Pi；实际版本由 package/runtime contract 管理。
- `candidate`：已进入参考池，但尚未完成固定 commit 的源码和许可证审阅。
- `reviewed`：Catalog 与 Lock 同时存在记录，审阅范围、commit、许可证和结论可复核。

Lock 不接受 `null`、`main`、tag 或短 SHA。`reviewedCommit` 表示实际读过的版本，
`remoteHeadAtReview` 只表示审阅当时观察到的远端 HEAD。远端前进不会自动改 Lock。

## Reuse policy

默认优先级是：架构研究 -> 按 Pi-67 Domain/Protocol 重新实现 -> 有来源地改造 -> 最后才是复制。

每次吸收必须：

1. 先定义 Pi-67 自己的问题和验收标准；
2. 选择最相关的一个参考；组合多个参考时说明各自职责；
3. 固定完整 commit，阅读相关源码、`LICENSE`、文件头和依赖；
4. 对照 Product、ADR、进程、安全、隐私和平台边界；
5. 增加对应的 protocol、policy、runtime、recovery、UI 或平台测试；
6. 更新 review lock；发生代码复用时同时更新 `licenses/provenance.json`；
7. 使用独立 scoped PR，不与 Pi SDK 升级或无关功能混合。

`architecture-only` 不进入代码 provenance ledger。`reimplemented`、`adapted` 和 `copied`
必须记录 source repository、完整 commit、source path/hash、target path、license hash、修改说明；
`adapted` 或 `copied` 还必须提供发行物所需的 third-party notice。

## Commands

离线合同检查，不访问 GitHub 或 npm：

```bash
corepack pnpm run check:references
```

只读远端漂移审计：

```bash
corepack pnpm run audit:references -- --id peakcode --json
corepack pnpm run audit:references -- --id pi-gui --json
corepack pnpm run audit:references -- --tier S1 --json
corepack pnpm run audit:references -- --all --json
```

审计报告只写入 Git ignored 的 `artifacts/quality/`，不会更新 Catalog、Lock、Git Remote 或源码。
