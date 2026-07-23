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

## Credentials

签名证书、密码、Apple API key 和 notarization credential 只能存在于 CI secret store，
不得写入 repo、artifact、日志、`.env` 或诊断。Release workflow 应 fail closed；缺少 secret
时在安装依赖和打包前终止，不生成“unsigned release”。

常用 electron-builder secrets：

- Windows：`CSC_LINK`、`CSC_KEY_PASSWORD`；
- macOS：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_API_KEY`、
  `APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。

## Release gate

1. 更新版本并生成冻结 `pnpm-lock.yaml`；
2. 两平台运行完整 `pnpm run check` 和 `pnpm run build`；
3. 在原生 runner 打包、启动 packaged Electron，并验证目标 arch、`app://`、
   preload sandbox 和 Agent Host 连接；
4. 验证 Windows Authenticode、macOS codesign、Gatekeeper 和 notarization ticket；
5. 三种目标产物全部存在后才生成 `release-manifest.json`，再逐文件流式验证
   identity、target、size 和 SHA-256；
6. 真实安装、首次启动、升级、卸载、session 恢复和残留进程测试；
7. 明确授权后才创建 GitHub Release 和 updater metadata。

`eng/release/generate-manifest.mjs` 与 `verify-artifacts.mjs` 只证明文件身份和 checksum，
不证明签名、notarization、安装或运行质量。

## Native package smoke

普通 CI 会在 Windows x64 与 macOS arm64 原生 runner 上执行
`package:native:unsigned`，随后运行 `package:smoke`。该路径会显式移除签名和
notarization credential，只用于提前发现 electron-builder、平台可选原生依赖、
`app://pi67`、preload sandbox、主题持久化和按需 Agent Host 回归。

unsigned native smoke package 不是 release artifact，不上传、不生成 release manifest，
也不能替代 Authenticode、Developer ID、Gatekeeper、notarization 或真实安装/升级/卸载验证。

## Unsigned preview channel

Unsigned Preview 是普通 CI smoke 之外的显式人工发布通道，必须同时满足：

1. 用户明确授权发布 unsigned preview；
2. tag 必须严格等于 `v<package.json version>`，并指向 workflow checkout 的 commit；
3. Windows x64 与 macOS arm64 都在原生 runner 运行完整 `pnpm run check`、unsigned
   native package 和 packaged Electron smoke；
4. 只发布 Windows x64 NSIS、macOS arm64 DMG/ZIP 三个主产物；
5. 文件名必须带 `-unsigned-preview`，Release 必须是 GitHub prerelease；
6. 不发布 `latest.yml`、`latest-mac.yml` 或 blockmap，不进入稳定自动更新渠道；
7. `unsigned-preview-manifest.json` 必须声明 `channel=unsigned-preview`、`signed=false`，
   并和 `SHA256SUMS.txt`、三个真实文件逐一验证 size、target 和 SHA-256；
8. Release notes 必须明确说明 SmartScreen、Gatekeeper、未签名和手动升级边界。

该通道不改变 `Signed release` workflow 的 fail-closed 规则；一旦配置签名与
notarization credentials，正式发行仍应使用签名工作流。
