# Internal candidate distribution

本文是 Pi-67 Desktop 日常开发候选包的分发真源。目标是让 Windows x64 和 macOS Apple Silicon
尽快拿到同一轮源码对应的可测试安装包，同时保持 Git 仓库不跟踪安装包、构建目录、验证截图、日志或凭据。

内部候选分发与正式发布是两条独立通道。默认开发闭环到飞书真机测试为止，不创建 GitHub Tag、
GitHub Release，也不触发 unsigned-preview promotion。签名、公证和公开发布仅在用户另行明确授权后，
按 [`signing.md`](./signing.md) 执行。

## Channel contract

- Git 跟踪源码、测试、工作流和文档；`artifacts/` 下的 EXE、DMG、ZIP、identity、receipt、日志和截图
  都是 ignored build output，不得提交。
- Windows x64 使用 Windows runner 从完整、可从 `origin/main` 到达的 source SHA 构建 unsigned NSIS；
  GitHub Actions artifact 只是短期构建传输，不是产品下载入口。
- macOS arm64 在 Apple Silicon Mac 上从同一轮源码构建 unsigned DMG 和 ZIP，并完成相关 packaged smoke。
- 内部分发入口是配置在仓库外的飞书云盘文件夹；不使用 Taildrop，也不使用 GitHub Release 分发日常候选。
- 飞书只是分发镜像。source SHA、workflow run/attempt、candidate identity、size 和 SHA-256 才是候选身份。

## Product files

每轮只分发以下三个带精确 package version 的产品文件，不使用 `latest` 等模糊名称：

```text
New-Money-<version>-win-x64.exe
New-Money-<version>-mac-arm64.dmg
New-Money-<version>-mac-arm64.zip
```

Windows candidate 还必须保留 `windows-preview-candidate-identity.json` 作为构建证据。macOS 构建必须保留
`macos-preview-candidate-identity.json` 和 `macos-preview-packaged-smoke.json`，用于把 app、DMG、ZIP、
packaged smoke、source SHA、version 和 Pi runtime 绑定为同一候选。上述 identity/receipt、`win-unpacked`、
验证截图和日志都不上传到面向测试者的飞书产品目录。

## First New Money installation

首次名称迁移需要手动安装：旧版更新器固定识别旧安装包/应用包名称，不向其发布无法识别的新名称包。

- macOS：先完全退出旧应用。若已安装的是 `Pi-67 Desktop.app`，将该应用包改名为
  `New Money.app` 后，以新版同名应用替换；若目标位置已有同名包，先核对其版本与来源。
  只替换应用包，不改动 Application Support 中的 `pi-67-desktop` 数据目录或 Pi Profile。
- Windows：先完全退出旧应用，再运行新版 NSIS，沿用已有安装目录。应用 ID 和安装注册身份保持
  不变；安装、旧快捷方式处理、重启及卸载后数据保留仍需 Windows 真机验收。
- 安装后先检查原工作区、历史会话和设置，再进行功能测试。不要以空白新 Profile 的启动成功
  替代已有数据兼容结论。macOS 当前已观察到正常用户 Profile 的工作区和会话目录加载；
  未测试真实凭据解密/模型请求，Windows 本次仍未验证。

## Default development loop

1. **Freeze source**：完成相关测试后 scoped commit；push 必须有当前明确授权。记录完整 source SHA，
   并确认本地 HEAD 与目标远端分支的关系。运行 capability source reachability 与 freshness；包括
   `browser67` 在内的分支跟踪能力必须让远端 ref 精确等于 lock commit。唯一例外是官方 AI Berkshire
   的 `desktop-ai-berkshire-v1`：freshness 必须从两个精确提交的完整根树证明 `codex-skills/`、
   `tools/` 和 `LICENSE` 的类型、模式与 Git 对象身份全部相同，才可报告 `input-equivalent` 并通过。
   报告保留 locked/latest commit 和两组输入身份；该状态不表示上游 HEAD 等于 lock，也不更新 lock、
   version、manifest 或 bundle。完整目录树身份覆盖新增/删除成员；输入变化仍为 stale，证据缺失、
   截断或网络失败阻断门禁。其他适配器不继承此例外，适配器输入边界变化须同步更新此证明合同。
   未提交的并发 WIP 不得进入本轮候选。
2. **Build Windows**：使用 `Windows candidate` workflow 构建精确 source SHA。只有 provenance、
   packaged smoke、synthetic scale/IME、candidate identity 和完整 NSIS lifecycle 全部成功后，才下载
   `windows-candidate-<run-id>-<attempt>` 中的 NSIS EXE。NSIS lifecycle 必须在中文且带空格的受控 Pi
   profile 中运行两个并列 lane。`clean-profile` 从不存在的 Agent 目录启动，先验证完整 Desktop capability、
   managed Package、Rules 和 browser67 MCP receipt，再写入受控测试 Provider；`existing-pi-profile` 预置
   Pi TUI-like `auth/settings/models/mcp/mcp-cache/AGENTS/Rules/Extensions/Skills/Prompts/Themes/Sessions`，
   包含用户拥有的同名 browser67 MCP，并对所有预置文件做 SHA-256 前后比对。两个 lane 都在 Main 初始化后
   把进程环境指向另一个空目录，并分别验证 Agent Host ready、Workspace、Provider、Catalog、Session
   materialization、Prompt、退出和三次冷重启。该探针只使用合成测试凭据和 Profile，不读取 runner 操作者
   的真实 Pi profile。
   前一版本 Candidate 若通过 rerun-failed-jobs 才完成认证，调度参数必须把标准 Candidate Artifact
   所在的成功 attempt 与 identity 记录的原始 build attempt 分开传入；普通未重跑的 Candidate 两者相同。
3. **Build macOS**：在 Apple Silicon Mac 上运行相关 quality gate 和
   `corepack pnpm run preview:mac:unsigned`。该命令必须重新打包、执行 packaged smoke 并打开当前仓库
   artifact；不能用一次 `open` 冒充新包已加载。命令在 open 前还会用原生 `hdiutil verify` 和
   `unzip -tq` 验证 DMG/ZIP 容器，并写入绑定 app executable、`app.asar`、DMG、ZIP 和 smoke receipt
   SHA-256 的 macOS candidate identity。分发的是生成的 DMG 和 ZIP。
4. **Record identity**：对三个产品文件记录 version、完整 source SHA、size 和 SHA-256；Windows 另记录
   workflow run/attempt、candidate identity SHA-256、installer identity 和 `signed=false`；macOS 另记录
   candidate identity、packaged-smoke receipt 和 app 内关键运行文件 identity。进入 promotion/R2 前，
   macOS 与 Windows evidence 必须声明相同 repository、source SHA、version 和 Pi runtime。
5. **Resolve destination**：飞书文件夹 URL/token、OAuth token、cookie 和登录态必须留在仓库外。
   目标可由 `PI67_FEISHU_CANDIDATE_FOLDER_TOKEN` 等 operator configuration 提供；不得把实际值写入文档、
   workflow、`.env` 或日志。
6. **Upload with authorization**：上传属于外部写操作，必须有当前明确授权。三个文件全部在本地准备完毕后，
   可以对三个不同 file token 并行 multipart 上传；同一个 file token 不得并发写。覆盖同名文件时使用原
   file token，让飞书保留版本历史并避免目录出现重复名称。删除远端文件或历史版本需要单独授权。
7. **Verify mirror**：上传成功后重新列出目标文件夹，确认本轮期望的三个产品名称全部存在，逐项核对远端
   size 与本地 size，通过后再请求人工测试确认。旧候选可以在获准清理前保留；不得为了目录只剩三个文件而
   提前删除它们。构建记录中的 SHA-256 继续作为内容身份，不以飞书文件名代替。
8. **Manual test**：Windows x64 和 macOS Apple Silicon 分别下载并测试。Windows 同一组 exact bytes
   必须在一台从未安装/使用 Pi TUI 的电脑和一台已有 Pi TUI/Profile 的电脑上分别测试。人工结论必须记录所测文件的
   version、source SHA、size、SHA-256，以及 Windows run/attempt 和 identity；不得把一轮结论转移给
   另一轮 bytes。Windows 必须另外使用测试者正常启动路径和自己的现有 Pi profile，确认模型服务不再
   停留在“正在读取 Pi 配置”或暴露 acknowledgement timeout，已有 Workspace/Session 可打开，一次
   New + Send 只新增一个 JSONL/侧栏行，完全退出并重启后仍恢复同一 Session identity。
9. **Stop by default**：内部测试候选上传并复核后，本轮默认结束。不要因为测试通过而自动创建 Tag、
   GitHub Release、promotion、签名或公证任务。

## Dispatch preflight

调度 Windows candidate 前，使用上一版已保留的 `windows-preview-candidate-identity.json`
运行只读预检。`source-sha` 必须是已推送且可从远端 main 到达的完整 SHA；源码版本从 GitHub
该 SHA 的 `package.json` 读取，不读取当前 dirty checkout 的版本。构建 attempt 和源码身份由
baseline identity 提供，artifact attempt 单独指定，以支持失败 job 重跑后才上传成功的基线。

```bash
corepack pnpm run release:windows:preflight --repository bigKING67/pi-67-desktop \
  --source-sha <full-source-sha> \
  --baseline-identity <retained-baseline-identity-path> \
  --baseline-artifact-attempt <successful-upload-attempt>
```

预检复用现有 identity 合同，并检查远端 main 可达性、源码与基线版本、原始 build job、成功的
认证 attempt，以及精确 artifact 是否存在、未过期且非空。只读 GitHub 查询需要可用的 `gh`
认证；查询失败会停止，不以未知状态放行。成功输出的 `workflowInputs` 是本次调度的完整参数。
预检不调用 `gh workflow run`，push/调度仍使用现有授权边界。

此处是 metadata 预检，不证明远端安装包内容与本地 baseline identity 相同，也不能消除预检后
artifact 过期或远端变化的可能。workflow 必须继续下载精确 artifact，复核 identity、文件哈希、
版本和运行身份，保留所有现有 provenance、freshness、审计和安装认证门禁。Tag/Release 的
版本占用检查也继续由 workflow 执行。候选完整源码前置检查统一使用 `corepack pnpm run check:candidate`。

## Failure and replacement rules

- build、package 或 smoke 失败时不上传该平台文件；保留最低失败阶段，修复后从新 source SHA 重建。
- multipart 上传失败时，原 file token 的已完成版本仍是当前可用文件；只重试失败的文件，不删除其他候选。
- 若新的源码产生不同 bytes，之前的人工测试结论立即失效。优先使用新的 prerelease version；若内部迭代
  有意复用尚未发布的 version/file token，必须记录新 source SHA 和 SHA-256，并明确废弃旧测试 receipt。
- 三个新文件都上传成功并重新列目录复核之前，不清理旧候选。远端清理需要当前明确授权。
- hosted Windows lifecycle、macOS packaged smoke 和飞书可下载都不能替代目标系统的人工真机结论。
- hosted Windows 的双 Profile lane 证明合成 clean/existing Profile 的 ownership、Main/Agent Host 目录
  一致性和预置文件不变，但不覆盖同事真实 Profile 的全部第三方资源、真实凭据、历史规模、Defender/EDR、
  OneDrive、重解析点、网络盘或企业目录重定向；这些仍属于两台目标 Windows 的人工验收。

## Local artifact retention

本地产物用于完成打包、smoke、identity、上传和精确字节验证，不是长期归档。候选已经镜像或发布、对应的
小型 identity、manifest、smoke、人工验收和发布 receipt 已保留后，应先运行只读计划：

```bash
corepack pnpm run release:local:cleanup
```

计划只识别固定 `artifacts/` 边界内、符合 Pi-67 版本化命名的 EXE/DMG/ZIP/Blockmap、Electron Builder
解包目录和上传 staging 中的产品副本。它保留 JSON/text 证据、SHA256SUMS、验证截图、快捷方式观察和
R2 发布 receipt，也不读取或删除未知目录。核对计划后使用精确确认参数执行：

```bash
corepack pnpm run release:local:cleanup -- apply --confirm-local-artifact-cleanup
```

执行前会检查当前仓库 `artifacts/release/mac-arm64` 预览是否仍在运行；有占用、符号链接、未知平台或目标
在计划后发生身份变化时 fail closed。该命令只清理本机 ignored output，不上传、删除或修改 Feishu、R2、
GitHub Actions artifact、Tag、Release 或 CDN 缓存。`preview:mac:unsigned` 必须从仓库 artifact 启动应用，
因此只能在预览退出后运行本地清理。

### Automatic archive retention

`package:native:unsigned`、`package:mac`、`package:win` 在打包成功后执行
`release-archive-retention.mjs`。按平台保留当前构建版本与最近另一个版本的本地
EXE/DMG/ZIP/Blockmap。`archive-build-status.json` 记录新流程的 BUILDING/FAILED/COMPLETE；
成功版本与失败版本分别选择，最多保留两个成功版本和一个失败版本集合，失败残包不得
挤掉成功的回退包。未指定当前构建时按 SemVer 选择；历史无状态归档沿用原版本选择。此策略针对本地
可重建的旧归档，与上面的整批手动清理及远端镜像保留策略分开，不执行任何远端操作。

只扫描 `artifacts/release` 顶层规范命名的普通归档文件，不清理 `.app`、解包目录、
JSON/文本收据或未知目录。因此预览正在运行时也可以回收不再需要的旧归档。任意归档
旁的 `<完整文件名>.keep` 会保护同平台、同版本的全部归档；固定保留版本属于显式上限
例外。归档仍被打开/执行，或在计划后被修改、替换、固定保留时，执行会报错停止。

打包与两种本地清理共用 `.archive-retention.lock`。失败打包不回收前一可用版本；
保留策略失败不能报告为成功。同平台已有三个成功版本或两个失败版本集合时，拒绝开始
新的不同版本，防止固定保留、占用或回收失败导致持续增长；可重试原版本，或先核对并
执行归档保留计划。一次构建允许临时多一个版本，结束后恢复上述成功/失败保留数量。
进程异常退出后的遗留锁需要先核对 PID 再人工恢复。

```bash
# 只读查看；不会关闭正在运行的应用
corepack pnpm run release:local:retain
# 显式执行当前保留策略
corepack pnpm run release:local:retain -- apply --confirm-local-artifact-retention
```

此处两版本自动策略不限制旧的 candidates/上传 staging 或未知目录；这些仍由上面的
精确整批清理流程管理。小型历史证据保留也不等于全仓有固定字节上限。

### Repository storage budget

`eng/packaging/local-storage-policy.json` 定义本仓库的容量保护：十进制 8 GB
开始提醒，达到 10 GB 时强提醒。总量和预计总量都只用于诊断，不阻止构建，
也不把已经完成的构建判为失败。10 GB 是排查参考线，不是项目异常的判定标准。
只读检查命令：

```bash
corepack pnpm run storage:check
corepack pnpm run storage:check --for desktopPackaging
corepack pnpm run storage:check --json
```

统计整个 checkout，包括 `.git`、依赖、ignored 产物及未知目录；不跟随符号链接，
硬链接仅计一次。每项按内容长度和已分配块大小的较大值计量，因此是保守估算，
与 `du`、Finder 或 APFS 克隆/压缩后的物理独占空间可能不同。

原生运行时的新准备、新签名副本及上述三个打包入口共用
`artifacts/.storage-budget.lock`，避免它们同时启动、各自误以为剩余空间充足。
预检在当前占用上增加准备 1.5 GB、签名 1 GB、桌面打包 2.5 GB 的估计余量，
用于提前提醒；它不扣除旧文件覆盖或完成后的回收，因此可能高估实际增长。
打包资源复制在同一检查范围内。经过内容验证的原生缓存复用不创建新副本，仍可复用。

构建成功或失败后都会重新统计；实际达到 10 GB 时输出 `HIGH_WARNING`，保留产物
和原始构建结果。只读命令在两级提醒下均返回成功，便于串联开发脚本；无效配置、
不安全路径、扫描失败和锁冲突仍明确报错，真实构建错误不会被提醒吞掉。
不新增自动删除或强退应用行为。已有的归档/原生保留规则独立继续生效，固定保留或
运行中产物导致数量无法安全回收时，仍可能拒绝新产物；需要核对实际占用关系，不能
通过空间提醒规则绕过这些保护。
异常退出遗留锁需先核对 PID、进程和当前构建再人工恢复，不能自动抢锁。

日常 `dev`、`build`、测试和已安装应用更新未接入总量检查。此处是构建前后提醒，
不是文件系统硬配额或磁盘可用空间保证。直接运行
electron-builder、独立资源准备/性能脚本、外部写入及未接入的命令不受锁限制，
但写入 checkout 的内容会计入下次检查。仓库外的原生签名输出和系统缓存不在该预算内。
本次未据此扩大清理范围，也不提供真实 Windows 打包或空间核算认证。

## Formal release boundary

小团队的未签名应用内更新是候选测试之后的独立分发层，使用 Cloudflare R2，并遵循
[`internal-r2-update-distribution.md`](./internal-r2-update-distribution.md)。飞书候选通过不会自动上传 R2；
R2 安装包和可变 manifest 上传仍要求对 exact version 的当前明确授权。

只有用户明确要求正式发布时，才从已验证候选进入签名、公证、promotion、Tag 或 GitHub Release。正式流程
必须重新核对授权、版本、source SHA、目标平台证据和 exact bytes；内部飞书候选通过不等于已经发布。

## Support report diagnosis

候选使用者提供私有诊断报告后，必须先完整阅读
[`support-diagnostics-operator-read.md`](./support-diagnostics-operator-read.md)，再按当前授权读取精确对象。
候选构建或分发授权不自动授权读取报告、配置诊断凭据或操作诊断存储桶。
