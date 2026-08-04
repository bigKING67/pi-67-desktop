# Signing and release

## Artifacts

唯一允许的产品产物：

```text
Pi-67-Desktop-<version>-win-x64.exe
Pi-67-Desktop-<version>-mac-arm64.dmg
Pi-67-Desktop-<version>-mac-arm64.zip
```

Windows 使用 NSIS；macOS 使用 hardened runtime、Developer ID 签名和 notarization。
不得发布 Windows ARM64/x86、macOS Intel/Universal 或 Linux artifact。

正式稳定 Release 只允许上述签名产物。经明确授权，alpha 阶段可以通过独立的
`Unsigned preview release` workflow 发布显式带 `-unsigned-preview` 后缀的 GitHub
prerelease，供非商业测试和反馈使用。Unsigned Preview 不是正式签名 Release。

`Signed release` 只接受 canonical `vMAJOR.MINOR.PATCH` tag。SemVer prerelease 或 build
metadata 不得进入 stable workflow；需要签名 prerelease 时必须另建显式 prerelease channel，
不能让 `gh release create` 把 alpha/beta tag 发布成 GitHub stable Release。

## Credentials

签名证书、密码、Apple API key 和 notarization credential 只能存在于 CI secret store，
不得写入 repo、artifact、日志、`.env` 或诊断。Release workflow 应 fail closed；缺少 secret
时在安装依赖和打包前终止，不生成“unsigned release”。

正式签名和发布 Job 必须绑定受保护的 GitHub Environment `production-release`，配置 required
reviewers、禁止 self-review 和 release-tag deployment rule。签名证书、证书密码和 notarization
credential 只存在于该 Environment secrets。

仓库还必须配置独立的 GitHub tag ruleset，匹配 `v*`，禁止更新和删除既有 release tag，并只允许
受保护的 release authority 创建。Environment deployment rule 只约束 Job 能否取得发布权限，不能阻止
高权限 actor 在最终 tag commit 复核与 `gh release create` 之间移动 tag；没有不可移动 tag ruleset 时，
workflow 只能证明检查时的 tag identity，不能宣称发布引用在整个窗口内不可变。

非敏感但决定发布身份的以下值必须配置为 repository 或 organization Actions variables：

```text
WINDOWS_SIGNER_THUMBPRINT
MACOS_EXPECTED_TEAM_ID
```

真实 Windows DPI、IME 和睡眠恢复 Job 必须绑定独立的受保护 Environment
`windows-native-certification`。它不接收签名证书或 Provider credential，只允许专用、已登录、
桌面未锁定的 Windows 11 x64 self-hosted runner 执行，并要求人工 reviewer 在机器准备完成后批准。
不要在 Environment 中创建同名 variable 覆盖 repository/organization authority。任一 variable 缺失、
格式错误或被 shadow 都会使 build、native certification 或 release gate fail closed。

真实 Provider 长任务 Job 必须绑定受保护 Environment `provider-certification`，配置 required reviewers、
禁止 self-review，并只保存 `REAL_PROVIDER_API_KEY`。Stable Signed Release dispatch 还必须显式填写
Provider、Model、thinking level、90,000–300,000ms Tool delay，并把
`confirm_paid_provider_operation` 设置为 `true`。该 Job 不接收签名证书，只下载 build Job 已生成的
exact signed Windows candidate。

Windows previous installer、candidate installer、`win-unpacked` executable 和 native certification
executable 必须匹配同一个预期 Publisher thumbprint；macOS App 必须匹配预期 Team ID。

常用 electron-builder secrets：

- Windows：`CSC_LINK`、`CSC_KEY_PASSWORD`；
- macOS：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_API_KEY`、
  `APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。

## Release gate

1. 更新版本并生成冻结 `pnpm-lock.yaml`；
2. 对 release tag 重新执行 Built-in Extension Adapter npm/Git provenance gate；
3. 两平台运行完整 `pnpm run check` 和 `pnpm run build`；
4. 在原生 runner 打包、启动 packaged Electron，并验证目标 arch、`app://`、
   preload sandbox 和 Agent Host 连接；
5. Windows release 候选额外执行 packaged synthetic scale/composition smoke，并保留有界验证 artifact；
6. 验证 Windows Authenticode、macOS codesign、Gatekeeper 和 notarization ticket；
7. Windows 使用真实 NSIS artifact 执行静默安装、从安装目录启动、状态保留、静默卸载和
   已知 Main/Utility/Extension child 进程回收；workflow 自动解析 direct previous stable
   Release，按 Release ID 和 asset ID 下载 manifest 与 installer，验证 size、SHA-256 和
   预期 Publisher 后执行跨版本覆盖升级；只有明确的 `first-stable-release` resolution 才允许
   没有历史 baseline；
8. 三种目标产物全部存在后才生成 `release-manifest.json`，再逐文件流式验证
   `schemaVersion=2`、`channel=stable`、`signed=true`、identity、target、size 和 SHA-256；
9. 同一 workflow 必须把 exact signed Windows candidate 交给 `provider-certification` Job，完成一次
   显式授权的真实 Provider Operation、accepted ACK、至少 90 秒受控 Tool、`operation.completed` 和
   Pi JSONL identity；认证前后都重新验证 candidate bytes 和 Publisher；
10. 同一 workflow 必须把该 exact signed Windows candidate 安装到专用交互式 Windows runner，顺序完成
   125%、150%、200% 的真实 DPI、Microsoft Pinyin trusted Enter、至少一档真实 sleep/resume、
   responsive layout 和进程关闭认证；
11. `verify_release_gate` 必须重新计算 Provider/native 两条证据链的 candidate identity、receipt、
    screenshot 和 summary SHA-256，生成 `provider-long-turn-release-gate.json` 与
    `windows-native-release-gate.json`；`publish` 只能依赖该 gate，不能直接依赖 build；
12. 在干净 Windows 机器上补充 assisted installer、默认用户目录、SmartScreen、首次启动、
    “添加或删除程序”和系统级残留进程人工认证；
13. 明确授权后才创建 GitHub Release。当前 stable release 只发布三个 product artifact、manifest、
    candidate identity、Provider gate/summary、native gate/summary、三档 receipt 和三张脱敏截图；在
    updater metadata 建立独立签名与校验合同前，不发布 `latest*.yml` 或 blockmap。

`pnpm run check` 还会执行 `check:workflow-powershell`。所有 workflow 中声明 `shell: pwsh` 的命令块和
`eng/packaging/*.ps1` 都必须被发现；Windows x64 CI 会用 PowerShell AST parser 逐段做纯语法解析。
非 Windows 主机只验证发现与抽取合同，不能替代 Windows parser 结果，也不会执行签名、安装或
Provider 操作。

`eng/release/generate-manifest.mjs` 与 `verify-artifacts.mjs` 只证明文件身份和 checksum，
不证明签名、notarization、安装或运行质量。

## Native package smoke

普通 CI 先由 `change-scope` 按实际 diff 选择验证范围：纯文档不启动产品验证，纯 Renderer
browser spec 只运行 `quality-gates` 与 `renderer-e2e`，Windows/macOS 专属变更只启动相关
native job，共享产品或未知路径继续 fail safe 到完整跨平台验证。`quality-gates` 与
`renderer-e2e` 在两个 macOS arm64 job 中并行执行，分别形成可独立重跑的失败边界；Renderer
测试按文件使用两个 worker 且 CI 内不做自动 retry。native job 独立构建
clean-checkout runtime resources，串行运行真实 Electron E2E，随后执行 unsigned native
packaging 和 `package:smoke`。该路径会显式移除签名和
notarization credential，只用于提前发现 electron-builder、平台可选原生依赖、
`app://pi67`、preload sandbox、主题持久化、按需 Agent Host，以及活跃受控 Extension
command 退出时的 Pi shutdown hook、child/utility process 回收和五秒关闭预算回归。

Windows CI 还会运行 `package:smoke:windows-installer`。它直接执行当前构建的 NSIS
installer，在隔离的含中文和空格路径中完成 silent install，启动真实 installed
executable，验证生产 `app://pi67`、Agent Host 和受控子进程关闭；随后对同一候选执行
same-version reinstall，确认隔离 user data 中的主题仍可恢复，再运行 silent uninstall
并确认安装目录删除、已知进程退出且隔离 user data 仍存在。验证报告写入
`artifacts/validation/windows-installer-lifecycle/summary.json`，只作为 CI artifact 保留。

Signed Release workflow 不接受人工 `previous_tag` 选择器。Provenance job 会读取有界 GitHub
Release catalog，排除 draft、GitHub prerelease、SemVer prerelease、未发布记录和 malformed tag，
再按 SemVer 选择严格小于 candidate 的最大 stable 版本。重复 stable identity、已存在的 candidate、
比 latest stable 更旧的 candidate、缺失或重复 asset 都会 fail closed。

Resolver 生成的 receipt 绑定 repository、candidate tag/version、baseline Release ID、published time、
`release-manifest.json` asset ID 和 exact Windows installer asset ID。Windows job 会按 asset ID 下载，
重新读取 fresh Release metadata，并验证 signed manifest v2、local size/SHA-256、可用的 GitHub asset
digest、Authenticode `Valid` 和 `WINDOWS_SIGNER_THUMBPRINT`。全部通过后才设置
`PI67_WINDOWS_BASELINE_INSTALLER`：

```text
previous signed NSIS
→ baseline install and launch
→ create persistent theme state
→ current signed NSIS overwrite upgrade
→ current version launch from the same install directory
→ restore the previous user state
→ run controlled Agent Host/Extension shutdown
→ uninstall and verify process/data boundaries
```

只有 resolver 明确输出 `first-stable-release` 时，Windows lifecycle 才走 same-version reinstall。
一旦 resolver 输出 `resolved`，下载、fresh metadata、manifest、hash 或 signer 任一失败都必须终止，
不得静默退化为 same-version reinstall，也不能人工跳过 direct previous stable。

未提供 `PI67_WINDOWS_BASELINE_INSTALLER` 时，该脚本不是跨版本升级证明。即使提供基线并
完成自动覆盖升级，它仍不能证明交互式 assisted installer、SmartScreen、machine-wide
install、真实默认用户目录或 Windows“添加或删除程序”的人工体验。上述证据仍需在干净
Windows 主机上使用签名 Release Candidate 单独认证。

在 signed lifecycle 中，current installer、`win-unpacked/Pi-67 Desktop.exe`、previous installer、
baseline installed executable 和 upgraded installed executable 必须全部匹配受保护变量中的预期
Publisher。升级后的 installed executable 还必须与同一次 build 的 `win-unpacked` executable 在
byte length 和 SHA-256 上完全一致，避免只验证 installer 签名却运行另一份 EXE。

## Windows native DPI, IME, and sleep certification

`package:smoke:windows-ui` 使用 Chromium `--force-device-scale-factor`，只能作为自动布局
回归。真实 Windows 认证必须绑定同一份 signed candidate identity。手工终端模式示例：

```powershell
$candidate = 'C:\candidate\windows-signed-candidate-identity.json'
$installer = 'C:\candidate\Pi-67-Desktop-1.2.3-win-x64.exe'
$executable = 'C:\certification-install\Pi-67 Desktop.exe'
$repository = 'bigKING67/pi-67-desktop'
$tag = 'v1.2.3'
$commit = '<40-hex-tag-commit>'
$runId = '<signed-release-run-id>'
$runAttempt = '<signed-release-run-attempt>'
$signer = '<publisher-certificate-sha1>'

corepack pnpm run certify:windows-native `
  --expected-scale 1.25 `
  --candidate-identity $candidate `
  --installer $installer `
  --executable $executable `
  --expected-signer-thumbprint $signer `
  --expected-repository $repository `
  --expected-source-tag $tag `
  --expected-source-commit $commit `
  --expected-candidate-run-id $runId `
  --expected-candidate-run-attempt $runAttempt

corepack pnpm run certify:windows-native `
  --expected-scale 1.5 `
  --sleep `
  --candidate-identity $candidate `
  --installer $installer `
  --executable $executable `
  --expected-signer-thumbprint $signer `
  --expected-repository $repository `
  --expected-source-tag $tag `
  --expected-source-commit $commit `
  --expected-candidate-run-id $runId `
  --expected-candidate-run-attempt $runAttempt

corepack pnpm run certify:windows-native `
  --expected-scale 2 `
  --candidate-identity $candidate `
  --installer $installer `
  --executable $executable `
  --expected-signer-thumbprint $signer `
  --expected-repository $repository `
  --expected-source-tag $tag `
  --expected-source-commit $commit `
  --expected-candidate-run-id $runId `
  --expected-candidate-run-attempt $runAttempt

corepack pnpm run certify:windows-native:verify `
  --candidate-identity $candidate `
  --installer $installer `
  --executable $executable `
  --expected-signer-thumbprint $signer `
  --expected-repository $repository `
  --expected-source-tag $tag `
  --expected-source-commit $commit `
  --expected-candidate-run-id $runId `
  --expected-candidate-run-attempt $runAttempt
```

实际安装路径按 assisted installer 的选择结果填写；上述路径只是示例。每次运行前必须在
Windows 设置中把真实显示缩放调整为对应的 125%、150% 或 200%，并完全重新启动应用。
至少一个 scale 使用 `--sleep`。

默认 `terminal` 模式必须在 Windows x64 的本机交互式桌面和 TTY 中运行。Signed Release 使用
`--interaction-mode workflow`：不依赖 Actions stdin TTY，但仍要求真实解锁桌面和操作者完成 DPI、
Microsoft Pinyin、第二次 Enter 与 sleep/resume；认证结果只来自 Electron、Renderer 和
`powerMonitor` 的真实观测，workflow 日志提示不能直接写入通过状态。Workflow mode 会先用探测实例
等待目标 DPI，完全关闭后再启动新的认证实例；receipt 必须声明应用在目标 scale 下 cold start。
认证器不会：

```text
使用 --force-device-scale-factor
dispatch synthetic CompositionEvent/KeyboardEvent
调用 powerMonitor.emit("resume")
修改系统 DPI、IME、注册表或电源策略
读取用户现有 Pi Session、凭据或工作区
```

Self-hosted native Job 的安装根固定为 `RUNNER_TEMP` 下绑定 `run_id/run_attempt` 的单一目录。
启动 NSIS 前，workflow 会在 HKCU/HKLM 的 32/64 位 uninstall Registry view 中建立基线；审计只接受
`InstallLocation` 规范化后与本次 install root 精确相等的 entry，不按产品名、Publisher、
`UninstallString` 或模糊路径匹配。安装成功后必须观察到至少一个相对基线新增的精确 entry。

`if: always()` cleanup 即使遇到 installer 非零、只写入 ARP 而尚未生成 EXE/uninstaller 的 partial
install，也会重新计算相对基线的新增 entry。正常 uninstaller/有界目录清理后如仍有新增 entry，guard
会在删除前再次读取并确认 `InstallLocation` 仍精确等于本次 install root，只删除这些 exact new keys，
随后再次审计并使 Job fail closed。已观察 entry 如果保留相同 key identity 但改变 `InstallLocation`，guard
只报告 hashed identity 并拒绝删除，避免把被篡改或重定向的 Registry key 当作本次有界残留清理。日志只输出
`hive:view:SHA-256` key identity，不输出 Registry values；
基线已有 key 永远不会被 cleanup 授权删除。

每个 scale 都会使用隔离 userData、Agent 目录和中文/空格 Workspace，并自动验证：

1. installed executable 的 bytes、SHA-256 和 Authenticode 必须匹配显式指定的 Publisher thumbprint；
2. Electron `screen.getDisplayMatching(...).scaleFactor` 等于目标真实缩放；
3. Renderer `window.devicePixelRatio` 与 Electron display scale 一致；
4. 1040px Context Drawer 和 760px Navigation Drawer 的几何、overflow、Send、Stop、
   focus restoration 和 Windows title-bar native-control reserve；
5. 操作者在 Microsoft Pinyin 中输入 `ceshi` 并用 Enter 确认“测试”时，Composer 接收到
   `isTrusted=true` 且 `isComposing=true` 或 `keyCode=229` 的真实 Enter；
6. 该候选确认不会提交 Prompt，Composer 中“测试”稳定保留至少 1.5 秒；
7. 操作者随后在 Composer 内第二次按真实 Enter，必须以 `follow-up` 恰好提交一次、返回 accepted、
   绑定当前 Operation，并在 ACK 后清空 Composer；receipt 只保存固定文本 SHA-256，不保存 Prompt；
8. `--sleep` 场景必须观察真实 `powerMonitor.suspend` 后再观察 `resume`，两者时间有序且间隔至少
   1 秒；随后 Renderer projection 恢复、Agent Host 已连接且受控 Operation 仍然可停止；
9. 活跃受控 Extension command、Agent Host utility process 和 child process 在关闭后退出，
   且 `session_shutdown(reason=quit)` 可观察。

单次 receipt 和无用户内容的应用截图分别写入：

```text
artifacts/certification/windows-native/scale-125/
artifacts/certification/windows-native/scale-150/
artifacts/certification/windows-native/scale-200/
```

集合 verifier 会重新读取当前 executable 的 byte length、SHA-256 和 Authenticode。只有三档 receipt
全部来自同一个 hashed host identity、匹配同一个 executable 和预期 Publisher、每档都有候选确认加
第二次 Enter exactly-once 的 trusted IME 证据、至少一档有有序 suspend/resume、截图 hash 一致且
进程关闭合同成立时生成：

```text
artifacts/certification/windows-native/summary.json
```

Signed Release 随后在独立 Ubuntu gate job 和 publish job 中再次读取 signed candidate identity、
actual installer、三档 receipt、截图和 summary，重算所有 SHA-256，并要求 source tag/commit、workflow
run ID/attempt、Publisher、installer bytes 和 installed executable bytes 全部属于同一 candidate。最终
receipt 为：

```text
artifacts/release/windows-native-release-gate.json
```

同一 Signed Release run 的 `provider_long_turn_certify` Job 直接下载 build Job 的 Windows artifact，
使用同一份 `windows-signed-candidate-identity.json` 和 `win-unpacked/Pi-67 Desktop.exe` 执行真实 Provider
Operation，不允许重新 build。Ubuntu gate 会严格校验 Provider summary 的 exact fields、accepted ACK、
至少 90 秒受控 Tool、`operation.completed`、Pi JSONL identity、privacy flags，以及 candidate identity
SHA-256/source/run/Publisher，生成：

```text
artifacts/release/provider-long-turn-release-gate.json
```

Provider 或 Windows native 任一 Job 失败、取消、跳过、证据漂移或使用不同 candidate，
`verify_release_gate` 都不会成功，publish 必须自然保持 skipped。

`publish.needs` 只能是 `verify_release_gate`。Provider/native job 失败、取消、跳过、runner 不可用或证据漂移时，
publish 必须自然保持 skipped，不允许 `always()`、`continue-on-error` 或人工 JSON 替代。
所有 baseline、candidate、native certification 和 verified bundle Actions artifact 名称必须同时带
`github.run_id` 与 `github.run_attempt`。失败后只能 `re-run all jobs` 或重新 dispatch；不得让新 attempt
复用旧 attempt 的签名 candidate。

为保证 30 天 Actions artifact retention 结束后仍可独立复核，正式 GitHub Release 还会以精确文件名
发布三档 receipt 和 screenshot：

```text
windows-native-scale-125-receipt.json
windows-native-scale-125-workspace.png
windows-native-scale-150-receipt.json
windows-native-scale-150-workspace.png
windows-native-scale-200-receipt.json
windows-native-scale-200-workspace.png
```

这些文件的 SHA-256 必须与 `windows-native-release-gate.json` 中的 evidence map 一致。截图只允许包含
认证 fixture 的固定内容，不得出现真实 Prompt、源码、凭据、用户路径或 Session 数据。

这些 receipt 证明指定 Windows OS build、显示配置、安装候选和人工步骤下的结果，不代表
所有 GPU、显示器、RDP、HDR、多屏 Per-Monitor DPI 切换或第三方 IME 都已认证。

unsigned native smoke package 不是 release artifact，不上传、不生成 release manifest，
也不能替代 Authenticode、Developer ID、Gatekeeper、notarization、跨版本升级或人工安装体验验证。

## Unsigned preview channel

Unsigned Preview 是普通 CI smoke 之外的显式人工发布通道，必须同时满足：

1. 用户明确授权发布 unsigned preview；
2. tag 必须严格等于 `v<package.json version>`，并指向 workflow checkout 的 commit；
3. tag checkout 必须通过 Built-in Extension Adapter npm/Git provenance gate；
4. 完整 `pnpm run check` 只在一个 macOS arm64 `quality-gates` job 中执行一次，并与 Windows
   x64、macOS arm64 的 unsigned native candidate build 并行；两个原生 build 都必须通过
   packaged Electron smoke；
5. Windows tag 候选在 packaged smoke 与 synthetic scale/composition smoke 通过后立即上传为
   绑定本次 run/attempt 的不可变 candidate；独立 `certify-windows-installer` job 只下载该精确
   candidate 并运行真实 NSIS silent install/reinstall/uninstall lifecycle smoke，不重新构建；
6. 只发布 Windows x64 NSIS、macOS arm64 DMG/ZIP 三个主产物；
7. 文件名必须带 `-unsigned-preview`，Release 必须是 GitHub prerelease；
8. 不发布 `latest.yml`、`latest-mac.yml` 或 blockmap，不进入稳定自动更新渠道；
9. `unsigned-preview-manifest.json` 必须声明 `channel=unsigned-preview`、`signed=false`，
   并和 `SHA256SUMS.txt`、三个真实文件逐一验证 size、target 和 SHA-256；
10. Release notes 必须明确说明 SmartScreen、Gatekeeper、未签名和手动升级边界。

Windows installer certification 是独立 retry boundary。认证脚本或生命周期失败时，应选择
GitHub Actions 的失败 job 重跑，复用 `build-windows` 已上传的精确 candidate；不得为了调试
认证问题重新执行完整 quality、native build 和 packaging。`publish` 同时依赖 provenance、
单次 quality gate、两个平台 candidate build 与 Windows certification，并只下载这些 build
job 输出中记录的 artifact name，因此认证通过的字节与最终生成 manifest/Release 的字节一致。

该通道不需要签名证书、Apple notarization credential 或真实付费 Provider Operation；
这些认证只阻断正式 Signed Stable Release，不阻断明确标记的 alpha Unsigned Preview。
macOS 用户只有在从本仓库下载并核对 Release SHA-256 后，才应在安装到
`/Applications` 后使用：

```bash
xattr -dr com.apple.quarantine "/Applications/Pi-67 Desktop.app"
```

Unsigned Preview workflow 也接受可选 `previous_tag`。提供时，只从当前 GitHub 仓库的
对应 prerelease 下载精确的 Windows `-unsigned-preview.exe`、
`unsigned-preview-manifest.json` 和 `SHA256SUMS.txt`。`release:preview:baseline:verify`
会在执行旧 installer 前验证：

```text
tag SemVer
manifest identity/channel/signed=false/runtime
唯一 Windows x64 artifact name
bounded file size
manifest bytes and SHA-256
SHA256SUMS exact entry
```

随后 lifecycle gate 再要求该版本严格早于当前候选，并执行真实覆盖升级。没有
`previous_tag` 时仍只证明当前候选的基础安装和 same-version reinstall。

该通道不改变 `Signed release` workflow 的 fail-closed 规则；一旦配置签名与
notarization credentials，正式发行仍应使用签名工作流。
