# Third-Party Notices

本文件是人工可读摘要。精确直接/传递依赖和 integrity 由 `pnpm-lock.yaml` 管理；发布
SBOM 需要由 release workflow 从冻结 lockfile 生成，不能用本文件替代。

## Pi

Pi-67 Desktop 直接使用以下 `0.83.0` 包：

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-ai`
- 传递锁定的 `@earendil-works/pi-tui`

上游：<https://github.com/earendil-works/pi>，MIT License。应用不依赖系统安装的
`pi` 可执行文件，也不复制 Pi TUI UI。

## External reference provenance

Pi-67 对以下 MIT 项目做了固定 commit 的只读研究，并按自身 Product、Protocol、安全与
进程合同重新实现选定模式；它们不是依赖、Submodule 或 merge upstream，且没有复制上游
源码：

- `minghinmatthewlam/pi-gui` commit
  `eb9a7380705dffad36db3efa771ee825aafbef6f`，Copyright (c) 2026 Matthew Lam；
- `pingdotgg/t3code` commit
  `5661c6116c9d6e9e93e59cf067fc02dd3303ceef`，Copyright (c) 2026 T3 Tools Inc.

精确审阅路径、文件 hash、许可证 hash 与重实现映射见
`docs/provenance/pi-gui-reference.md`、`docs/provenance/t3code-reference.md` 和
`licenses/provenance.json`。

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

## Local attachment inspection

通用附件的离线、受限解析直接使用以下冻结包；版本以 `pnpm-lock.yaml` 为准：

- `officeparser` 7.5.1、`file-type` 22.0.1、`chardet` 2.2.0、
  `music-metadata` 11.14.0、`tar-stream` 3.2.0、`yauzl` 3.4.0：MIT License
- `mediainfo.js` 0.3.7：BSD 2-Clause License
- `tesseract.js` 7.0.0 与传递的 `tesseract.js-core` 7.0.0：Apache License 2.0
- `@tesseract.js-data/eng` 1.0.0 与 `@tesseract.js-data/chi_sim` 1.0.0：
  npm package metadata 为 MIT License，训练数据来源为
  <https://github.com/naptha/tessdata>

这些组件只在 Agent Host 的有界 worker 中处理用户明确附加的本地文件。英文和简体
中文 OCR 数据随应用离线打包；运行时不下载语言数据，也不把附件发送给网络 OCR
服务。完整版权、许可证文本和 NOTICE 仍随对应 npm package 保留在打包内容中。

## HEIC/HEIF attachment normalization

HEIC/HEIF 图片在 Electron Desktop 的有界 Node worker 中离线解码，再编码为不含源图片
元数据的 JPEG；Renderer 不加载解码器、不扩大 CSP，也不把图片发送给外部转换服务。直接
和传递依赖冻结为：

- `heic-decode` 2.1.0：npm package metadata 声明 ISC License；
- `libheif-js` 1.19.8：LGPL-3.0 License，使用其 `wasm-bundle` Node 入口；
- `@napi-rs/canvas` 1.0.3：MIT License，用于从解码后的 RGBA 像素生成 JPEG。

`pnpm-lock.yaml` 记录精确 tarball integrity。`libheif-js` 的完整 LGPL 文本随 npm package
保留在 `node_modules/libheif-js/LICENSE` 和其 `libheif` 子目录中；发布包继续保留对应
package 文件。`heic-decode` 2.1.0 的 npm tarball 没有独立 LICENSE 文件，因此对外发布前的
SBOM/license inventory 必须保留其 package metadata、来源 commit 和 ISC 声明，不能只依赖
本摘要。
