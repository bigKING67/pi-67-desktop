# Settings experience V2

Status: complete (including initial-load recovery follow-up)
Owner: main
Started: 2026-09-25
Last updated: 2026-09-25

## Goal and acceptance
Complete the accepted 16-page Settings V2 plan: five navigation groups, guarded subpage links, clear independent save units, progressive disclosure, light/dark and narrow layout verification.

## Delivery boundary and non-goals
Local implementation, checks and unsigned macOS preview only. No commit, push, publication, new protocol, configuration migration or paid model/account operation. Existing primitives retained.

## Current evidence and WIP
Baseline 5f27299. Account endpoint occupies the main form; Settings children bypass the draft guard for cross-page links; memory tabs default to privacy. Dirty AGENTS.md, PRODUCT.md, agent-host attachment test, provenance files, prototype directories and preexisting DESIGN.md reference-guide paragraph are unrelated and preserved.

## Decisions
Preserve existing save transactions and continue-editing/discard dialog. Add only Renderer transient subpage routing. Technical details collapse except when dirty or erroneous. Keep 880/1120px content measures and existing theme tokens.

## Checkpoints
- [x] Core: navigation, shared primitives, account/model/memory and protected links.
- [x] Resources/integrations: vision, extensions, skills, prompts, rules, Lark/browser.
- [x] General/system pages and full consistency closeout.

## Validation matrix
Source: targeted typecheck/lint/tests each batch; aggregate check at closeout.
UI: all 16 entry pages light/dark and 1440/720; core pages additionally 1040; state/guard regressions.
Native: unsigned macOS package/smoke per completed visible batch. Windows and real accounts/models unverified.
Coverage evidence recorded below as execution proceeds; no pending result counts as pass.

## Rollback
Revert only this task's exact changes; preserve unrelated WIP and existing configuration. No migration rollback needed.

## Risks
Independent memory saves must remain separate; hidden errors and stale navigation targets must not evade guards. Screenshots are evaluated separately from test outcomes.

## Progress
- 2026-09-25: source baseline and existing draft contracts inspected; implementation started.

## Coverage and evidence
All 16 entry pages passed H1 uniqueness, shared width/alignment and no page overflow at 1440/1040/720 in light and dark (96 captures in `artifacts/visual-review/settings-v2/`). Representative captures from every page were visually inspected across both themes; account/network disclosure spacing was corrected and recaptured. The existing React Aria and native controls are retained. This is fixture-backed browser evidence, not live account/model verification.

| Page | Applied decision | Interaction evidence |
| --- | --- | --- |
| 外观 | Keep theme and shortcut controls; shared heading semantics | Responsive theme/keyboard tests |
| 账户与数据 | Status/team first; endpoint advanced; protected team link | Login fixture, refresh/error, dirty/cancel/discard/focus/target reset |
| 模型 | Compact sync status; revision in file details; invalid stays expanded | Provider catalog, edit/save/conflict/draft regressions |
| 视觉辅助 | Keep effective/unavailable model distinction; block navigation during save | Global/project/preset and unavailable model tests |
| 上下文与记忆 | Activation/runtime before mode/models; independent save controls | Privacy keyboard/draft tabs, account deep link |
| 扩展 | Keep installed/discovery/list-detail and package boundaries | Resource and responsive tests |
| 技能 | Keep suite/local/project split; local paths disclosed | Suite updates and resource scope tests |
| 提示词模板 | Keep manual invocation and scope; paths disclosed | Resource reload readiness and bounded projection tests |
| 工作规则 | Keep list/detail, advanced and conflict recovery | Preview/edit/create/conflict and narrow keyboard tests |
| 飞书 | Keep personal authorization vs application split; protected skills link | Synthetic login/setup/CLI install tests |
| 浏览器集成 | Connection states first; source provenance disclosed | Install/repair/initialization fixture tests |
| 运行服务 | Occupancy/recovery first; invariant mechanisms disclosed | Shared layout and responsive tests |
| 用量分析 | Explicit recorded tokens vs billing | Loading/reconnect/window tests |
| 下载源与网络 | Source policy first; toolchain disclosed, failed expands | Save failure/retry, draft guard and source detection tests |
| 更新与诊断 | Shorter automatic-check copy; preserve explicit actions | Unready update disabled and update dialog tests |
| 关于 | Product/version/platform first; technology disclosed | Shared layout and responsive tests |

Validation: aggregate `corepack pnpm run check` PASS (882 test files, 5740 tests; 9 files/24 tests intentionally skipped); subsequent test-only edits passed test typecheck and scoped lint. Core/layout round 19 passed; secondary round initially exposed 3 obsolete presentation expectations (collapsed toolchain/source and renamed group), updated to assert the new disclosure behavior. Final affected UI round 23 passed; other 18 secondary tests passed. Earlier core memory/state round passed 16 with one obsolete model label corrected in the passing provider round. No changed product behavior is excused by a failing assertion.

The batches form one local change set; one consolidated macOS preview follows the passed source/browser gates. No paid model, real authentication, external upload or Windows execution is performed. Browser fixtures are torn down by Playwright. Performance was not benchmarked: changes reorder/collapse existing DOM and add no dependencies or data fetching.

Route: app / visual-refine / multi-page, L2 frontend and design; authority evolves DESIGN.md and DESIGN.dark.md, actual skill design-craft. Full consistency review covers shared headings, navigation, tabs, disclosures, forms and catalog siblings; no primitive migration. Native first attempt stopped on the old always-visible toolchain assertion; the scenario now explicitly opens toolchain details and keeps all version checks. Scoped smoke-script lint passed.

## Final closeout
- PASS: consolidated `preview:mac:unsigned` rebuilt, passed complete packaged Electron smoke and DMG/ZIP verification, and opened repository preview (PID 70731 at completion). Current `app.asar` SHA-256: `5929962389599ff6cac15588c30ecc6b70d3e8a2f225c30fda5e2a139ba1164d`.
- Receipt: `artifacts/release/macos-preview-packaged-smoke.json`; source is explicitly dirty, based on 5f27299. This is a local preview, not an exact committed release candidate. Existing unrelated WIP remains preserved.
- Packaged tests additionally passed memory draft/save/reveal and cold readback, activation, runtime installation UI, workbench draft/file journey and cold session restoration. Inspected current packaged dark runtime capture `artifacts/memory-ui/runtime-egi1e8/dark.png`.
- Visual/system sign-off: PASS for the bounded Settings changes in inspected fixture screenshots plus packaged checks. All 96 final entry-page captures retained. No claim of exhaustive live-account or every-state-per-page visual certification.
- Computer Use follow-up could not start its native pipe; no extra manual CUA walkthrough is claimed. Packaged Electron checks and actual preview launch are separately verified. Windows, real authorization, live model calls and performance benchmarks remain unverified.
- Final diff whitespace check PASS. No commit/push/upload/release. Memory: no write.

## Follow-up: initial-load recovery
User asked to continue. Computer Use native pipe still cannot start. Live source inspection found that Account configuration failure required reopening the page and Memory initial failure had no retry. Added bounded inline read-only retry to both existing pages; no configuration, authentication, remote probe or model-call semantics change. Added light/dark keyboard retry regressions that verify one reload and no write/login command. Targeted verification and refreshed packaged preview pending.

Follow-up verification: Renderer and test typechecks, scoped lint, build and whitespace checks PASS. Four new light/dark initial-failure keyboard retries passed with exactly one configuration read and no write/login command. The existing Memory draft test still expected its Account link to be disabled; it now exercises the accepted guarded-link behavior, cancel focus and preserved privacy selection. Its targeted rerun passed (2 including bootstrap); all other tests in the 13-case round passed. Inspected retry screenshots for dark Account and light Memory in `artifacts/visual-review/settings-v2/retry-*.png`. Native preview refresh running.

Follow-up closeout: macOS `preview:mac:unsigned` PASS, complete packaged smoke and container verification passed and new preview opened (PID 74236 at completion). Current app.asar SHA-256 `b195aed26bdb3391ca8300a3d68124d6c8d184a1ed30ce37a99d6f53160a5f47` supersedes the earlier local preview hash. Computer Use manual walkthrough remains blocked by native pipe startup; no Windows/live login/model claim. No commit, push or publication.

## Follow-up: expanded details acceptance
Expanded Account, Network, Runtime and About at 1440/1040/720 in both themes. All 24 disclosure states passed document/disclosure overflow checks and Enter/Space open-close-focus checks; Account also used a long unsaved service address, verified the save action remained reachable, restored the original value and closed without saving. Retained 24 additional `expanded-*.png` captures under `artifacts/visual-review/settings-v2/`. Entire layout suite passed (7 tests including bootstrap); test typecheck, scoped lint and whitespace check passed. No product-source changes were needed, so the already verified macOS preview remains current and was not rebuilt. Native manual control remains unavailable as previously recorded.
