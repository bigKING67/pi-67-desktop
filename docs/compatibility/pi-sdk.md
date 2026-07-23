# Pi SDK compatibility

## Locked contract

当前唯一支持版本：

```text
@earendil-works/pi-coding-agent 0.81.1
@earendil-works/pi-agent-core   0.81.1
@earendil-works/pi-ai           0.81.1
@earendil-works/pi-tui          0.81.1 (transitive override)
```

根依赖和 `pnpm-workspace.yaml#overrides` 双重固定，避免上游内部 caret dependency 在重新
安装时漂移。不得使用 `^`、`~` 或 latest tag。

## Desktop coverage

已实现的 SDK seam：

- `createAgentSession`、`SessionManager.create/open/list/listAll`，以及基于相同
  JSONL contract 的 collision-safe managed import；
- send、steer、follow-up、abort；
- model list/select、thinking levels；
- session tree navigation、新文件 branch、rollback、compact、name；
- Skills、Prompts、Extensions、AGENTS/SYSTEM 上下文发现与 reload；
- 图片输入、stream events、token/cost/context snapshot；
- common extension UI bridge 和 Desktop safety inline extension。

## Explicit limitations

- 不支持 `ctx.ui.custom()` 或 TUI component widget/footer/header/editor；
- TUI autocomplete 不会替换 Desktop composer；
- SDK 当前未向 UI bridge 提供稳定的 calling extension identity，因此 common request 暂以
  `pi-extension` 标识；
- 不支持同一 JSONL session 的并发 Desktop/TUI writer；
- 不实现 system Pi/RPC session import adapter。当前 agent directory 内的已
  managed session 通过 `SessionManager.list/open` 原地恢复；文件选择器中的
  外部 Pi JSONL 会先以不覆盖同名文件的方式复制到当前 workspace session
  directory，再打开副本。源文件保持只读且不会成为 Desktop 的后续 writer。

## Upgrade procedure

1. 固定一个候选 Pi commit/package version，阅读 SDK、extension 和 session 变更；
2. 同时更新三个直接包和 `@earendil-works/pi-tui` override；
3. 运行 protocol/policy/runtime contract tests、typecheck、build 和真实模型 smoke；
4. 单独验证常用 extensions 的 common UI 与 TUI-only 失败行为；
5. 在 Windows x64 与 macOS arm64 复测 session 恢复、abort、process exit 和打包；
6. 证据通过后再更新本文件和 release notes。

TypeScript 7 对部分上游 declaration 的检查存在实验期兼容问题，因此本仓库启用
`skipLibCheck` 只跳过第三方 `.d.ts` 内部检查；所有仓库源码仍使用 strict、
`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`。
