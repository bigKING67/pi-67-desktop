# 打包版视觉审查

可见 UI 改动除了 Renderer E2E，还要在打包后的 macOS 应用里看过。本文说明维护者（或 Agent）如何
在不碰用户数据的前提下驱动打包版截图、测量，以及哪些视觉约定已经写成 CI 断言。

状态：2026-10-08 编写，对应 Desktop `0.1.0-alpha.48`。

## 隔离的打包版

1. `corepack pnpm run preview:mac:unsigned` 生成最新的未签名预览包。
2. `corepack pnpm run preview:mac:visual` 在临时目录启动一份隔离副本：独立的 `--user-data-dir`、
   独立的 `PI_CODING_AGENT_DIR`、`PI_OFFLINE=1`、模拟钥匙串，并在 `127.0.0.1:9222` 暴露 CDP。
   它不读写用户的 Electron 配置、Pi Profile 或凭据，和用户正在使用的那份应用互不影响。
3. 用 browser67 连接：`tmwd_mode: "remote_cdp"`、`cdp_endpoint: "http://127.0.0.1:9222"`、
   `target_url_contains: "app://pi67"`。截图、`browser_execute_js` 测量都走这条通道；不要改用
   Playwright 或 chrome-devtools 驱动用户的应用。
4. 用完执行 `corepack pnpm run preview:mac:visual -- --stop`。重新打包前也要先停掉，打包会覆盖应用。

隔离副本没有登录 New Money，也没有工作区：欢迎页、命令面板、快捷键帮助、通知中心和全部设置分类
可以在这里看；Team Chat 和对话页仍需要在用户自己的应用里确认。窗口在后台时计时器会被降频，
测量脚本应在点击后同步读取布局，不要依赖长时间等待。

## 本地截图基线

截图不提交进仓库（`CLAUDE.md` 硬红线）。需要对比时，把 browser67 截图复制到被忽略的
`artifacts/visual-baseline/<日期>/<界面>-<主题>.png`，并在计划文档里记录路径、尺寸和 sha256。
截图只是证据，不等于视觉通过；结论仍需对照 `DESIGN.md` 的 `Visual quality bar`。

## CI 中的视觉约定

`tests/e2e/renderer-visual-contract.spec.ts` 用数值和计算样式断言审查中发现过的问题，不依赖截图：

- 全部设置分类的标题位置、第一块内容的位置和宽度完全一致；
- 命令面板、快捷键帮助中的按键使用界面字体，不回落到浏览器的等宽字体；
- 对话框容器获得焦点时不绘制焦点框，焦点框只属于其中的控件。

新增一条约定时，先用变异检验确认它能抓到问题（临时撤掉修复，测试应失败），再提交。
