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
