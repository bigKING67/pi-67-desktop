# 图像引擎移植基线

类型：首方代码移植记录（craft67 → New Money）。日期：2026-10-08。

`packages/image-engine` 由 craft67 仓库 `packages/creative-craft/integrations/image-production`
（MIT，Copyright (c) 2026 bigKING67）及其依赖的 `integrations/local-production/content-store.mjs`
移植而来。craft67 与本仓库同属一个作者，这不是外部参考复用，因此不进入
`references.catalog.json` / `licenses/provenance.json` 的外部引用治理；本文记录精确基线，便于
后续按需手工吸收上游改进。决策见 `docs/adr/0010-image-workbench.md`。

## 基线

- 仓库：`~/Documents/sixseven/codeproject/craft67`（本地 Git，工作树干净）
- commit：`8e2a37f85a94a894e296713fddb3900a9c0eafec`
- 源 LICENSE SHA-256：`93336fa372fdcf1ec35195ecdb683bfd39da2f578c60fc6f31eba1a9745bd6a0`

## 文件映射

| 源文件（`integrations/`） | SHA-256 | 目标（`packages/image-engine/src/`） |
| --- | --- | --- |
| local-production/content-store.mjs | 35240723e6bc439a3742eba0bdd3c34d58b8a488a83962c3a68643daf0c14386 | content-store.ts |
| image-production/document.mjs | 104b218c739a08910e4d277f0656656ee7a305d09aacb4e4e452e3c307b489fb | document.ts |
| image-production/font.mjs | 1c13b92cf912b54f09396cd5eacb3da72125b0b6f4a595391dd74ccb1f5373f5 | font.ts、scripts/fetch-font.mjs |
| image-production/raster.mjs | 3bf79ef7ad1f4b88d4a8a0ccd57c46dcd3b932fac60d22e1278bf5ba78a8c1bd | raster.ts |
| image-production/composite.mjs | a306737ed0ccb80771574a4fe9d579dfeb2f354fbfb420667b81f06bd958df78 | composite.ts |
| image-production/project.mjs | 762f1a8becfe5ec9b2b249f5547af50866329d7bc1b4f27bd78cd52e91c498d5 | project.ts |
| image-production/render.mjs | f321e87e00b1f08ea3a8f9ff5522b3bb24d2683910c7a58f91070eedf94e3e5c | render.ts |
| image-production/render-worker.mjs | 35892b8735db817fb747466de93eaedd4c02a018e3b29b36e9b62db85e2cee20 | render-compose.ts、render-worker.ts |
| image-production/candidates.mjs | 80c6505e8f21d5f4d1b87e3b1cec997b7816a83bf5be3bd6be15b42e6f312cf2 | candidates.ts、candidate-compare.ts |
| image-production/candidate-store.mjs | 13002952757d1af8c001be2b4c2d0e6b055d3a64f621df6a465e6bc811a9c0ab | candidate-store.ts |
| image-production/photo-layout.mjs | 855e90140d1cd72d76b9c71eea0cfcf545070afcb84abd9aded63ffa631536ef | photo-layout.ts |
| image-production/photo-templates.mjs | de8ed4e14ca70015be797dff807c8090db4ad4e2997bbb3f43bacb201d83a8e7 | photo-templates.ts |
| image-production/photo-crop.mjs | b5f5b2226d5f9f2807ec678f8827b271eb59b2ad71a9fa447569c2962d10c5ee | photo-crop.ts |
| image-production/copy-variants.mjs | 470b53ec1bd127a97a3ced6be7f1ad7c5ad0f79c7625ca5608a038cee57e009e | copy-variants.ts |
| image-production/provider-store.mjs | 46a3fc126e75424cd9b0866ba37af0b85b51c127a153600104f32bc3bd3539c1 | provider-store.ts |
| image-production/provider-alpha.mjs | 0c62c6e93465c8d0ff03708c0ba6ea7ff8cb95eeaf4572e50d223f0744676dce | provider-alpha.ts |
| image-production/provider-normalize.mjs | 62441943977797a056ea1032f3142ff8c53863902f527e52a9299d53ca2b95b1 | provider-normalize.ts |
| image-production/provider.mjs | — | provider.ts、provider-prepare.ts、provider-endpoint.ts |
| image-production/provider-contracts.py + skills/creative-craft/scripts/creative_craft_contracts.py（Image Job v2 / Execution Receipt 部分）+ creative_craft_evaluation.py（`compile_image_markdown`） | — | contracts.ts、provider-profiles.ts |
| skills/creative-craft/schemas/{image-job-v2,execution-receipt,provider-profile,surface-profile}.schema.json、integrations/image-production/providers/surfaces/openai-image-api.json | — | schemas/、providers/surfaces/ |
| image-production/tests/provider.test.mjs | — | provider.test.ts、provider-transparency.test.ts |
| image-production/fixtures.mjs、candidate-fixtures.mjs | 37314d57b3f03268d3814c903d2f82470ac2415107f98938ce14d92dff4be052、ace7535e6d8209d9572617bf77a2fe74381369b433e70bc2f6fbddfcd2932df9 | test-support/fixtures.ts |
| image-production/alpha-smoke.mjs | 2679e4b6704a1ff12901d5f968e0284a70a1050d0b34561b0be6a3e2741e4527 | test-support/alpha-acceptance.ts |
| image-production/tests/*.test.mjs（provider.test.mjs 除外） | — | `*.test.ts`（vitest） |
| image-production/providers/*.json、fonts/manifest.json、fonts/OFL.txt | — | providers/、fonts/ |

## 移植时的改动

- JavaScript 改为 TypeScript strict；`node:test` 改为 vitest；文件均在仓库 460 行上限内。
- 渲染 worker 由子进程改为 `worker_threads`，超时与取消通过 `terminate()` 实现。
- 文档 schema 改为 `newmoney.image-project.v1`，候选为 `newmoney.image-candidate.v1`，渲染回执
  `newmoney.image-render.v1`；旧的 `creative-craft.local-image.v1` / `local-image-candidate.v1`
  只读接受，下一次发布修订时升级。
- `candidate-compare.ts` 从 candidates 拆出，消除 candidates ↔ render 的循环依赖。
- 操作名查表改为 `Map`，避免 `constructor` 等原型名命中继承成员。
- 依赖版本改为从各包入口文件定位 `package.json` 读取（`sharp` 以 `exports` 隐藏了 `package.json`）。
- Provider 适配器（P1 检查点 2，2026-10-09）：Python 合同桥换成 `contracts.ts` 的 Node 实现，
  错误文案与 Python 逐字一致；`test-support/contract-fixtures.json` 的 38 个黄金用例由原版
  Python 校验器/编译器生成，`contracts.test.ts` 逐条比对结论、错误、警告和编译后的提示词包。
  凭据不再读 `~/.codex/config.toml` / `auth.json`。回执 `host` 为 `newmoney.image-engine`。
- 2026-10-09 按 ADR 0010 第 9 条修订：引擎不再发 HTTP 请求，`executeProvider` 接收注入的
  `ImageGenerator`；原 `provider.mjs` 的 HTTP 部分（JSON/multipart、地址策略、响应大小、base64
  校验、请求 ID）移入 `packages/image-pi-extension/src/openai-images.ts`，作为 Pi 的 `openai-images`
  图像 API 实现，经 `modelRegistry.generateImages` 调用，由 Pi 解析凭据。「准备与预检之间人工编辑」
  的测试原本靠凭据解析阶段注入，重构后没有可确定注入的点，已删除；该分支暂无直接测试。
- 未移植：`cli.mjs`、`provider-config.mjs`、`provider-acceptance.mjs`、`provider-smoke.mjs`
  （craft67 操作员脚本，读写 `~/.codex`）及其测试 1 个、CLI 参数校验测试 3 个。真实网络验收
  改由 P1 检查点 8 的 Desktop 内真实 Pi 会话承担；Agent 通过 Pi 扩展工具调用引擎。

## 第三方依赖

Satori 0.35.0（MPL-2.0）、@resvg/resvg-js 2.6.2（MPL-2.0）、Sharp 0.35.5（Apache-2.0；libvips 及
原生依赖保留各自条款）、Noto Sans CJK SC Regular（OFL-1.1，`packages/image-engine/fonts/OFL.txt`，
二进制按 `fonts/manifest.json` 的 SHA-256 拉取与校验，不入库）。见 `THIRD_PARTY_NOTICES.md`。
