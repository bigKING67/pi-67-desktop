# Third-Party Notices

本文件是人工可读摘要。精确直接/传递依赖和 integrity 由 `pnpm-lock.yaml` 管理；发布
SBOM 需要由 release workflow 从冻结 lockfile 生成，不能用本文件替代。

## Pi

Pi-67 Desktop 直接使用以下 `0.81.1` 包：

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- 传递锁定的 `@earendil-works/pi-tui`

上游：<https://github.com/earendil-works/pi>，MIT License。应用不依赖系统安装的
`pi` 可执行文件，也不复制 Pi TUI UI。

## Maple Mono

代码字体来自 `subframe7536/maple-font` v7.9 的 `MapleMono-Woff2.zip`：

```text
SHA-256 5e38e83b007e7157c253c3f57c0a6f80415378f4859d43eb3cf4b1d858001681
```

只嵌入 Regular、Italic、Bold、BoldItalic 四个非 Nerd Font、非 CN WOFF2 文件。
Copyright 2022 The Maple Mono Project Authors。许可证为 SIL Open Font License
1.1，完整文本位于 `licenses/MapleMono-OFL-1.1.txt`。Reserved Font Name 为
`Maple Mono`。

## Electron and web runtime

- Electron：MIT License
- React / React DOM：MIT License
- Vite：MIT License
- React Aria Components：Apache License 2.0
- react-markdown / remark-gfm：MIT License
- Shiki：MIT License
- Lucide：ISC License
- Zustand：MIT License

各组件的完整版权和许可证随其 npm package 保留；打包前应从冻结 lockfile 生成 SBOM
和 license inventory。

## Peak Code reference

产品信息架构参考 PeakCode-AI/PeakCode commit：

```text
5aee9cfcbb29283f9320a132693d4a250033fb9e
```

Peak Code 使用 MIT License。本仓库没有 merge Peak Code，也不复制其品牌、资产、多
Provider 架构或巨型组件；来源边界见 `docs/provenance/peak-code-reference.md`。
