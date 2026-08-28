# Pi Runtime Restore Performance

Status: follow-on model-catalog implementation complete; local/macOS validation passed, prior performance validation partial
Owner: Codex primary session
Started: 2026-08-28
Last updated: 2026-08-28

## Goal

Adopt the latest stable Pi SDK family (`0.84.3`) and reduce conversation-restore latency that is currently presented as Provider configuration loading by making Task initialization stages truthful, removing Pi-67's redundant pre-trust ResourceLoader pass, and adding a benchmark that measures the authoritative `SessionManager.open()` path rather than only post-load projections.

The accepted follow-on extends that runtime boundary without changing the pinned SDK: keep all startup, credential, configuration, and Task runtime creation cache-only; refresh Pi's official remote model directory in an independent bounded Agent Host lifecycle; project the resulting Pi cache into idle Sessions and Settings without silently switching the active Turn model.

## Non-goals

- Do not replace Pi JSONL as Session truth or introduce a Desktop Session parser/runtime.
- Do not patch, fork, publish, or consume an unreleased Pi SDK.
- Do not expose the new SDK PowerShell Tool without a separate Desktop Tool identity and safety contract.
- Do not change the eight-Task product capacity, Package AUTO grant semantics, Provider fallback behavior, or Turn-stable model/protocol selection.
- Do not push, build/upload a Windows candidate, tag, release, or promote.
- Do not hard-code the newly published DeepSeek vision model or create a Desktop-owned catalog/cache authority.

## Acceptance criteria

- The exact Pi SDK direct dependency and workspace override family is `0.84.3`, with a frozen coherent lockfile and no accidental PowerShell Tool exposure.
- Every runtime initialization stage is accepted by the Desktop diagnostic forwarder and has a truthful user-visible label.
- A Task whose Workspace trust is already resolved performs one final-trust ResourceLoader reload; trusted/untrusted resource, Package, Extension, and capability authorization behavior remains covered.
- A repeatable performance suite reports `SessionManager.open`, projection bind, first-page projection, event-loop delay, and retained memory for bounded generated JSONL fixtures, with explicit macOS/Windows evidence limits.
- Targeted tests, typecheck, lint/architecture checks, build, and macOS unsigned packaged smoke pass. Windows performance remains `UNVERIFIED` until an exact candidate is measured on Windows x64.
- Agent Host startup launches one non-blocking, single-flight, 15-second model-directory refresh for configured dynamic Providers; `PI_OFFLINE`, unconfigured Providers, partial failure, and timeout retain Pi's cache and never block configuration or Task startup.
- A manual global Settings action forces the same Pi refresh path and reports current, partial, timeout, offline, and unconfigured outcomes truthfully while preserving unsaved Provider drafts.
- Active Turns retain their selected model; idle Sessions reload the updated Pi cache offline and emit the existing model-catalog projection event.

## Delivery boundary

- Local implementation: authorized in the canonical checkout.
- Commit: authorized by the user after local validation; one scoped local delivery commit only.
- Push: not authorized.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.
- Follow-on model-catalog implementation: local changes authorized; a new commit, push, candidate upload, tag, release, and promotion are not authorized in the current turn.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| VERIFIED | npm latest stable is `@earendil-works/pi-coding-agent@0.84.3`; the direct dependency and workspace override family now use exact `0.84.3` with a coherent frozen lockfile. | npm registry, package manifests, frozen lockfile, build | 2026-08-28 |
| OBSERVED | Published `0.84.3` and upstream `main` retain synchronous full-file `SessionManager.open()` and do not expose `openAsync()`. | official published tarball and upstream source | 2026-08-28 |
| OBSERVED | `0.84.3` switches Package resource globbing to Node's native glob but retains ResourceLoader's optional pre-trust pass. | published tarball diff and upstream source | 2026-08-28 |
| VERIFIED | Desktop accepts and labels `validate-packages`, `load-session-resources`, and `activate-session`, and exports bounded initialization receipts without Task identifiers. | protocol, Agent Host, Desktop diagnostic tests | 2026-08-28 |
| VERIFIED | The standard generated real-file suite measures authoritative JSONL open and reports 100 MiB p95: open `93.524ms`, event-loop delay `98.607ms`, projection bind `28.782ms`, first page `1.691ms`, and user-message page `6.060ms`. | `artifacts/performance/session-open-standard-darwin-arm64.json` | 2026-08-28 |
| VERIFIED | The same 100 MiB fixture measured projection bind at about `1367ms` in the pre-optimization single sample; final ten-sample p95 is `28.782ms` after page-wise user-message projection. The pre-change value is directional rather than a statistical baseline. | local before/after generated-fixture runs | 2026-08-28 |
| VERIFIED | Unsigned macOS arm64 packaging, packaged Electron smoke, cold Workspace/Provider restoration, Session Catalog rebuild, Agent Host roundtrip, and repository-artifact relaunch passed. | `preview:mac:unsigned` | 2026-08-28 |
| VERIFIED | The repaired production Renderer fixture passes its full ten-sample suite: 1,000-message first projection `406.1ms`, Composer input `8.6ms`, scroll dropped frames `0%`, streaming updates `19.777/s`, loaded non-head DOM `748`, and switched non-head DOM `696`. | `artifacts/performance/renderer-darwin-arm64.json` | 2026-08-28 |
| VERIFIED | Hidden Workspace search, file-editor, rename, archive, Changes, Messages, Subagents, and Runtime surfaces no longer load before their authoritative open or selected state. Plan Markdown dependencies are deferred until a plan or restored message needs them. | production Renderer build and packaged resource attribution | 2026-08-28 |
| VERIFIED | Locked capability preparation reuses a local source cache only when its exact `HEAD`, clean worktree, and canonical `origin` match the lock; a new full command invocation with the validated cache completed in `3.03s` without contacting the expired mirror. | capability source resolver integration test and `prepare:capabilities` | 2026-08-28 |
| VERIFIED | The exact current unsigned macOS arm64 artifact passed packaged smoke, cold Workspace/Provider restoration, real Agent Host roundtrip, Session Catalog rebuild, and repository-artifact relaunch. Its `app.asar` SHA-256 is `ea596629e231033f1b8d59cbf9347d2982dd5e0bae5cea998f7663af33857134`. | `preview:mac:unsigned` | 2026-08-28 |
| VERIFIED | The follow-on exact unsigned macOS arm64 artifact passed package, packaged Electron smoke, cold Workspace/Provider restoration, Agent Host roundtrip, and repository-artifact relaunch. Its `app.asar` is 197,297,323 bytes with SHA-256 `fb2279f92c7de989a06f76ff624dd2fb18c7db7373527592369486c61773289f`. | `preview:mac:unsigned` | 2026-08-28 |
| VERIFIED | The packaged Settings action refreshed Pi's official catalog and reported `Pi 模型目录已刷新`; the live DeepSeek detail then contained `deepseek-v4-flash-vision-exp` with image and reasoning capability. | packaged macOS arm64 UI via Computer Use | 2026-08-28 |
| VERIFIED | Flash, Pro, Vision Exp, and future Pi-catalog models under the official DeepSeek Provider and endpoint share the native Responses `web_search` route; a custom endpoint remains unavailable. The production Renderer E2E showed all three current catalog rows as `原生搜索 · 已声明`. | domain/runtime/Renderer regressions and production Renderer E2E | 2026-08-28 |
| VERIFIED | The native-search follow-on exact unsigned macOS arm64 artifact passed package, packaged Electron smoke, cold Workspace/Provider restoration, Agent Host roundtrip, and repository-artifact relaunch. Its `app.asar` is 197,300,757 bytes with SHA-256 `f796381cd16058ce271f9752c9f38a2adc3d202a5d89d352102764e1873789fd`. | `preview:mac:unsigned` | 2026-08-28 |
| UNVERIFIED | No paid live DeepSeek request was sent for Pro or Vision Exp in this follow-on, so `原生搜索 · 已声明` remains route/capability evidence rather than proof of a completed provider response. | explicit external-call boundary | 2026-08-28 |
| PARTIAL | The current ten-sample packaged suite passes launch, Runtime initialization, real 1,000-message Pi Session restore, command feedback/open, and Agent Host recovery timing budgets. Its overall verdict remains `FAIL` solely because Runtime-initialization Renderer assets are `0.466 MiB > 0.400 MiB` and Welcome assets are `0.669 MiB > 0.600 MiB`. | `artifacts/performance/electron-darwin-arm64.json` | 2026-08-28 |
| UNVERIFIED | The hosted Windows performance workflow already targets `windows-2025` x64, but the current uncommitted source cannot be checked out by Actions. The latest historical run failed on a stale Renderer fixture before target metrics and is not evidence for this change. | GitHub Actions read-only audit | 2026-08-28 |

## Affected boundaries

- Modules/processes: Pi dependency family, `packages/pi-runtime`, Agent Host initialization, Desktop diagnostics, performance harness.
- Follow-on modules/processes: Provider protocol, Pi configuration service, idle Session configuration reload, Agent Host App router, and global Provider Settings UI.
- Protocol or persisted state: diagnostics only; Pi JSONL format and authority are unchanged.
- Platform/artifact: local/macOS validation in this task; Windows x64 remains an explicit manual/candidate gate.
- Security/privacy: generated fixtures only; no user Session content, credentials, paths, or raw payloads in metrics.
- Existing WIP: preserve the task-related dirty scope from the preceding Provider/package preload optimization and build on its current diff without absorbing unrelated changes.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Upgrade to exact `0.84.3` before further local optimization. | It is the current stable SDK baseline and contains relevant correctness/resource fixes. | Compatibility gates reveal an unresolved regression in Pi-67's supported runtime path. |
| Seed the already-authoritative Workspace trust before ResourceLoader reload and omit `resolveProjectTrust`. | Pi-67's callback ignores the preloaded extension result, so the generic pre-trust pass has no decision role. | Security/resource precedence tests demonstrate non-equivalent behavior. |
| Benchmark the current synchronous SDK contract without implementing a second parser. | Pi JSONL and Pi Session semantics remain SDK-owned; the benchmark must measure the actual product path. | A released SDK provides an authoritative async open API before implementation completes. |
| Keep async Session opening as an upstream SDK delivery boundary. | The `SessionManager` constructor/preloaded-entry seam is private and an app-layer parser would duplicate Session truth. | Upstream publishes a supported equivalent API. |
| Preserve Desktop user model selection with `setModel(model, { persist: true })`, while Extension-triggered model switches remain Session-local. | SDK `0.84.3` changed default model mutation persistence; explicit intent prevents both lost user defaults and Extension pollution of global settings. | Pi publishes a new explicit model-selection persistence contract. |
| Store user-message entry positions and project only the requested page. | The UI requests bounded pages, while eagerly sanitizing every historical user body caused the dominant Desktop-side restore stall. | A future SDK page API replaces the local projection boundary. |
| Mount closed search and navigation dialogs only when their authoritative open state is true. | `React.lazy` still fetches a module when an always-mounted component internally returns `null`; the open-state boundary must stay outside the lazy component. | A future bundler proves equivalent conditional loading without outer state. |
| Keep optional plan Markdown and file surfaces behind measured production chunk boundaries. | Empty-session restore does not need Markdown URL policy code, the plan renderer, file dialogs, or file editor UI. | Product behavior requires one of those surfaces before conversation-first paint. |
| Reuse a locked capability source cache only after exact Git identity validation. | Unconditionally deleting the named cache forced a network clone on every capability preparation and made startup/build preparation depend on an expired external mirror certificate. | The lock/source format stops providing a canonical repository and immutable commit. |
| Exclude only the current document's `<head>` tree from the Renderer DOM-retention metric. | Split chunks add invariant module-preload/style metadata in `<head>`; counting it as Session DOM retention produced a false regression while still retaining detached/body nodes in the metric. | CDP exposes a direct retained-body/detached-node counter that preserves the same leak boundary. |
| Do not raise the Welcome/runtime asset budgets or add artificial render delays. | Both would hide unresolved dependency weight rather than improve the user's critical path. | Representative cross-platform baselines justify a documented budget change. |
| Keep `ModelRuntime.create()` and configuration validation at `allowModelNetwork: false`; call `refresh({ allowNetwork: true })` only from the dedicated directory-refresh coordinator. | Credential/configuration consistency and Task startup remain bounded and offline, while Pi remains the catalog/cache authority. | A released Pi SDK exposes a stronger cancellable background lifecycle with equivalent cache and event semantics. |
| Refresh only configured dynamic Providers, with automatic `force: false` and explicit manual `force: true`. | Pi remote catalogs require a configured Provider; startup should honor cache freshness while the user action should bypass it. | Pi changes its official remote-directory contract. |
| Re-project the shared Pi cache into active Sessions only when idle. | A Turn must keep its selected model/provider/protocol stable; the next idle boundary may adopt catalog metadata without a silent fallback. | Pi publishes an atomic Turn-scoped catalog snapshot API. |

## Checkpoints

- [x] 1. Upgrade the exact Pi SDK family to `0.84.3` and pass dependency/API compatibility gates.
- [x] 2. Complete truthful initialization diagnostics and retain bounded stage evidence where diagnostics need it.
- [x] 3. Convert the resolved-Trust ResourceLoader path to one final-state reload with security regressions.
- [x] 4. Add and run the authoritative Session-open performance suite.
- [x] 5. Repair the production Renderer performance fixture and defer closed/optional workspace surfaces.
- [x] 6. Run proportional source, test, build, and packaged macOS validation; record the upstream async-open boundary and Windows unknowns.
- [x] 7. Implement and validate the independent official model-directory refresh lifecycle, idle Session cache reload, and manual Settings action.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | scoped diff and dependency lock inspection | exact SDK family, no unrelated paths | PASS — exact `0.84.3`; `git diff --check` clean. Repository-wide `check:structure` passes after the Windows shortcut evidence and R2 cleanup-test responsibilities were split into bounded sibling files. |
| Tests | targeted Vitest suites, then repository test gates | stage forwarding, Trust parity, no PowerShell exposure, benchmark, model-catalog, native-search, and structure contracts | PASS — structure-targeted suites passed 72/72; full coverage passed 607 files with 3,166 passed and 3 skipped; protocol revision, typecheck, warning-free lint, architecture, dead-code, references, structure, production transport, PowerShell/workflow governance, and build checks passed. Production Renderer model-catalog E2E passed 3/3. |
| Runtime/host | generated Session-open benchmark and existing Catalog/projection suites | stage timings, event-loop delay, bounded artifacts | PASS on macOS arm64 generated fixtures; Windows and cold-storage behavior remain unverified. |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` plus packaged performance attribution | package, smoke, relaunch, resource boundaries | PARTIAL — exact current package/smoke/relaunch and locked capability preparation pass. Launch, restore, feedback, and recovery timings pass; only the existing Welcome and Runtime-initialization Renderer asset-size budgets remain above threshold. |
| Target OS/manual | exact Windows x64 candidate with Defender enabled | real restore stage timings | NOT COMPLETED — outside current delivery boundary |

## Rollback

- Revert only the scoped dependency/version, diagnostic, ResourceLoader, benchmark, design, product, and plan changes from this task.
- Restore `0.84.2` manifests and lockfile together if SDK compatibility fails; never leave a mixed Pi package family.
- Restore the existing `resolveProjectTrust` flow if any Trust/resource precedence regression appears.
- Benchmark artifacts are ignored generated files and may be discarded independently.

## Risks and unknowns

- The latest stable SDK improves CLI startup and resource globbing but does not fix synchronous Session opening.
- Nested Skill discovery and per-model thinking defaults can change observable catalogs after upgrade and require explicit compatibility coverage.
- Real Windows Defender, EDR, OneDrive, and redirected-profile latency is not reproducible on the current macOS host.
- The upstream async-open implementation and package publication are separate external-repository work and remain unimplemented in this task.
- Welcome still loads about `0.668 MiB` of production Renderer assets, dominated by the entry/application state and Agent connection graph. Safely moving that graph requires an independent event-ordering design and is not hidden by a budget increase in this task.
- A validated exact local capability source cache removes the network dependency on cache hits. Cache misses still depend on bounded external Git transports, and TLS verification remains enabled.

## Progress log

- 2026-08-28: Audited npm stable `0.84.3`, official release/source, published tarballs, current dirty scope, and existing synthetic performance reports. Began local implementation with the upstream async-open boundary preserved.
- 2026-08-28: Upgraded the exact SDK family, excluded the optional SDK PowerShell Tool, adapted explicit model persistence, applied final Workspace trust before one ResourceLoader reload, overlapped and deduplicated bounded Provider/Package preparation, and made initialization stages truthful.
- 2026-08-28: The new real-file benchmark exposed eager all-history user-message projection as the dominant app-owned stall. Replaced it with position indexing plus requested-page projection and retained Pi `SessionManager.open()` as Session truth.
- 2026-08-28: Full tests/build and packaged macOS smoke passed. One external source fetch failed transiently, then the exact locked canonical source recovered and the unchanged packaging command passed. Real Windows evidence remains not completed.
- 2026-08-28: Repaired the stale production Renderer performance fixture, moved closed Workspace search/dialog surfaces behind authoritative open state, split the lightweight active-plan action bar from plan Markdown, and deferred file surfaces when no file tabs exist.
- 2026-08-28: Found that capability source preparation deleted its own named cache before every run. Added exact clean-commit/canonical-origin reuse plus a local-Git integration test; a new full preparation invocation with the validated cache completed in `3.03s` without weakening TLS.
- 2026-08-28: Deferred inactive inspector panels and closed file-name dialogs, corrected the Renderer retention metric to exclude only invariant current-document head nodes, and retained all body/detached DOM coverage. The ten-sample Renderer suite now passes every budget.
- 2026-08-28: Exact current packaged attribution confirmed runtime-initialization assets fell from about `0.717 MiB` to `0.466 MiB`; Welcome is `0.669 MiB`. Timing, restore, recovery, package, smoke, and relaunch evidence pass, but both asset budgets remain open, so overall packaged performance validation is PARTIAL rather than PASS.
- 2026-08-28: Verified `0.84.3` lacks the new DeepSeek vision model in its static generated catalog while Pi's official remote directory already publishes it. Began the accepted follow-on with offline runtime creation preserved and a separate bounded refresh path.
- 2026-08-28: Completed the dedicated single-flight catalog coordinator, protocol/Host routing, idle Session cache reload, Settings action, truthful outcomes, draft preservation, and regressions. All runtime creation and Task startup remain cache-only; only the coordinator opts into Pi's official network refresh.
- 2026-08-28: Full source gates, Vitest, production Renderer E2E, build, unsigned macOS package/smoke/relaunch, and live packaged UI validation passed for the follow-on. The manual refresh reported success and the packaged DeepSeek catalog exposed `deepseek-v4-flash-vision-exp` as image- and reasoning-capable.
- 2026-08-28: Replaced the stale `deepseek-v4-flash` native-search allowlist with an official Provider/endpoint policy. Flash, Pro, Vision Exp, and future Pi-catalog DeepSeek models now share `api.deepseek.com/responses`; custom endpoints remain fail-closed.
- 2026-08-28: The native-search follow-on passed 21 targeted regressions, the full 607-file suite (`3166` passed, `3` skipped), three production Renderer E2E cases, source gates, build, unsigned macOS package/smoke/relaunch, and exact artifact attribution. Paid live DeepSeek Pro/Vision requests were not sent.
- 2026-08-28: Closed the repository structure gate by moving Windows shortcut resolution/evidence into `windows-shortcut-inspection.mjs` while preserving the existing `windows-installer-process.mjs` exports, and by separating R2 cleanup/CLI contract tests from publication tests. The resulting files are 377, 147, 403, and 98 lines; 72 targeted tests and the complete `check` contract pass. One unrelated Git-fixture test exceeded its 5-second bound on the first coverage run, then passed alone in 2.89 seconds and in the unchanged full rerun.

## Closeout

- Pre-delivery source base SHA: `8a6c82e02616bc3d165b3e9fd497db150cb0f87d`; the final scoped local delivery commit is recorded by Git.
- Changed files: use the final scoped Git status at handoff; ignored build, coverage, performance, and release artifacts remain outside Git.
- Validation completed: dependency/lock inspection, targeted regressions, full 607-file test suite with coverage, protocol revision, typecheck, lint, architecture, dead-code, external-reference governance, structure, workflow governance, production transport, production Renderer E2E, full capability preparation with a validated cache, package/app build, packaged smoke/relaunch, live packaged model-catalog refresh, generated Session/Renderer performance suites, and current packaged resource attribution.
- Validation not completed: all packaged asset budgets, real Windows x64 restore performance, Windows Defender/EDR/OneDrive behavior, power-cycle cold-storage measurements, and an upstream SDK async-open release.
- Remaining risks: Pi's authoritative full JSONL open stays synchronous; Welcome/Runtime Renderer dependency weight remains above the existing budgets; Windows filesystem/security-product overhead can only be characterized on an exact Windows candidate.
- Commit/push/release state: the earlier performance work remains in its local commit; the follow-on model-catalog, native-search, and structure work is included in the final scoped local commit recorded by Git. No push, candidate upload, tag, release, or promotion was authorized or performed.
