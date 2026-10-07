# Extension marketplace

Status: active
Owner: Claude Code (main session)
Started: 2026-10-07
Last updated: 2026-10-07

## Goal

Turn Settings › 扩展 › 扩展包 › `发现扩展包` into `扩展市场`: users browse and search the
Pi package ecosystem (npm `keywords:pi-package`, the same population as pi.dev/packages)
and install what they need through the existing one-shot install confirmation. The
curated `recommendedExternal` catalog stays as the `桌面已适配` group on top.

Style authority: DESIGN.md `Visual quality bar` (2026-10-07 taste family Grok Bot, Manus,
Cursor, Linear, Vercel, Magpie — restrained, content-first, AI-native; exemplar Settings ›
模型) and `Settings visual system`; DESIGN.dark.md zinc-tinted neutral depth. This page
also counts toward phase 4 `Extension management` of
[visual-quality-upgrade](2026-10-07-visual-quality-upgrade.md).

## Non-goals

- No ratings or reviews (neither npm nor pi.dev exposes any); no GitHub star fetching.
- No remote README/HTML rendering, no remote images (author avatars, `pi.image` previews).
- No machine translation of package text.
- No change to install, update, admission (`待确认`), AUTO authorization, or the package
  worker; marketplace install prefills the existing `InstallExtensionDialog`.
- No new install-time block for manually entered sources (load-time filters remain the
  enforcement point); the marketplace only withholds its own install action.
- No package-type filter (extension/skill/theme/prompt) in v1: search results do not carry
  the `pi` manifest; type is shown in the detail only.

## Acceptance criteria

1. `扩展市场` lists `桌面已适配` (from `recommendedExternal`) and `社区扩展` groups on the
   document canvas, following the Visual quality bar and Settings visual system.
2. Sort: `热门` (monthly downloads, default), `最近更新`, `名称`; a non-empty query switches
   to `相关度` and restores the previous sort when cleared.
3. Every row: name, one-line description, `N/月 · X 前更新`, and exactly one trailing item —
   `安装`, `已安装`, or one `SettingsStatus` exception (native-replaced, conflicting memory
   owner, `长期未更新` after 12 months).
4. Native-replaced and retired memory-owner packages never offer `安装`.
5. Row selection opens a side detail: description, version, license, publisher username
   (never email), npm/repository links (opened externally), declared Pi resource types,
   install action.
6. Loading (skeleton rows), empty, error (inline retry), offline / `仅镜像` (cached index with
   its age, or an explanation that search needs the official registry) states exist.
7. Both themes pass the Visual quality bar in the packaged macOS app; cross-page metrics
   (left edge, width, first-block top) match sibling Settings catalogs.
8. Targeted unit tests, aggregate `check`, and the extension e2e spec pass.

## Delivery boundary

- Local implementation: yes, after this plan and the open decision are confirmed.
- Commit: only on explicit request.
- Push: no.
- Candidate build/upload: no; local `preview:mac:unsigned` for visual verification only.
- Tag/release/promotion: no.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | npmjs search `keywords:pi-package` returns 11,415 packages; first 250-result page covers every package above ~9.4k monthly downloads; order is popularity-like, not strictly sorted (99 inversions in 250) | `registry.npmjs.org/-/v1/search` | 2026-10-07 |
| OBSERVED | npmmirror `/-/v1/search` returns `total 0` for the same query | `registry.npmmirror.com` | 2026-10-07 |
| OBSERVED | Result object carries `downloads.{monthly,weekly}`, `updated`, `package.{name,version,description,date,publisher,links,license,keywords}`, `flags.insecure`; no `pi` manifest | npm search response | 2026-10-07 |
| OBSERVED | pi.dev has no public JSON API (`/api/packages` 501); gallery sorts are downloads / recently published / A–Z | pi.dev | 2026-10-07 |
| OBSERVED | `pi-web-access`, `pi-smart-fetch`, `pi-subagents`, `@narumitw/pi-plan-mode`, `pi-mcp-adapter` are native-replaced | `packages/domain/src/native-capability-replacements.ts:3` | 2026-10-07 |
| OBSERVED | Memory-owner retirement identifiers live in pi-runtime only | `packages/pi-runtime/src/desktop-memory-owner-preflight.ts:59` | 2026-10-07 |
| OBSERVED | Main `net.fetch` honours system proxy; Host Node `fetch` does not | `apps/desktop/src/system-bridge.ts:337`, `apps/agent-host/src/package-network-settings.ts:111` | 2026-10-07 |
| OBSERVED | Bounded JSON reader pattern (Content-Length check, streaming cap, `redirect:"error"`, timeout) | `apps/desktop/src/unsigned-preview-update.ts:55,173` | 2026-10-07 |
| OBSERVED | Discover view and prefilled install dialog | `apps/renderer/src/settings/ExtensionManagementWorkspace.tsx:154,369` | 2026-10-07 |

## Affected boundaries

- Modules/processes: `packages/domain` (marketplace entry model, classification, retired
  memory-owner identifiers moved here from pi-runtime), `apps/desktop` Main (marketplace
  service + preload IPC), `apps/renderer` (marketplace view + detail).
- Protocol or persisted state: new Main↔renderer IPC `pi67:package-market-browse`,
  `pi67:package-market-search`, `pi67:package-market-detail`, validated like
  `pi67:package-network-*`; disposable cache `package-manager/market-index.json` in userData.
  No Host protocol command; install keeps `extension.package.install`.
- Platform/artifact: network behaviour (proxy, mirror modes) needs real Windows evidence
  before any Windows claim.
- Security/privacy: all remote fields are untrusted plain text, length-capped and
  control-character-stripped; publisher email is dropped at parse time; links are limited
  to `https://www.npmjs.com/package/<name>` and an `https:` repository URL opened through the
  existing external-link path; nothing is logged beyond counts and status.
- Existing WIP: transcript Markdown files, `DESIGN.md` hunk and
  `docs/plans/2026-10-07-visual-quality-upgrade.md` belong to the visual-upgrade work and are
  not touched except for the DESIGN.md sections named below.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Main owns marketplace fetch via `net.fetch` | System proxy support; npmjs is the only working search source; matches the `pi67:package-network-probe` pattern; Host package worker stays install-only | Main must not do network for packages per a future ADR |
| Search always uses npmjs (or a custom registry that answers `/-/v1/search`); detail (`/<name>/latest`) follows the configured download sources | Mirror has no search; detail is a small packument the mirror serves | npmmirror adds search support |
| Browse index = top 500 by npm popularity (2 × 250 requests), cached 6 h, stale-while-revalidate; local sort over it | No global sort by date/downloads exists; 500 covers the long tail above ~4k monthly downloads at ~0.5 MB | Users need deeper browse; then add paging past 500 |
| `最近更新` and `名称` sort within the browse index, stated in the sort ⓘ | Honest about scope | Same as above |
| `offline` mode: cache only; `mirror-only`: cache plus a notice that search needs the official registry | Respect the user's network policy | — |
| `桌面已适配` = `recommendedExternal` only | Already curated, pinned and reviewed; renderer has it via capability snapshot; avoids exporting extension-compat to renderer | A second adapted package is curated |
| Retired memory-owner identifiers move to `packages/domain`; pi-runtime and renderer both consume them | Two real callers; renderer cannot import pi-runtime | — |
| Community rows show the author's original description (confirmed 2026-10-07) (one line, plain text, `lang="en"`, truncated); curated rows keep reviewed Chinese copy | Current DESIGN rule (Chinese fallback for unknown metadata) would make hundreds of rows identical and the market unusable | User rejects; then show Chinese fallback and rely on detail links |

## Checkpoints

- [x] 1. Authority docs: PRODUCT.md §Pi Package set (349–360) — curated + community, all
      user-initiated; DESIGN.md §Extension Packages (1385–1426, 1500–1507) — `扩展市场`
      view, row anatomy, states, description rule; processes-and-protocol.md — Main marketplace
      IPC and network policy. Evidence: diff reviewed by user.
- [x] 2. Domain: `PackageMarketEntry` type, `normalizePackageMarketResult` (caps, email drop,
      link allowlist), `classifyPackageMarketEntry` (installed / native-replaced /
      memory-conflict / stale / installable), retired memory-owner identifiers. Evidence:
      unit tests incl. hostile payloads (oversize, control chars, `javascript:` links).
- [x] 3. Main: marketplace service (browse/search/detail), bounded reader (2 MiB per page,
      10 s timeout, `redirect:"error"`), cache with age, network-mode handling; preload IPC
      with validated results. Evidence: unit tests with fake fetcher (success, timeout,
      oversize, offline, mirror-only, stale cache).
- [x] 4. Renderer: `扩展市场` tab, search + sort command band, grouped flat list with
      `显示更多` (50 per step), side detail, all states; prefilled install. Evidence: model
      and component tests; e2e spec extended with mocked IPC.
- [x] 5. Gates: `typecheck`, `lint`, targeted tests, `check`, `test:e2e` extension spec.
- [ ] 6. Packaged macOS verification via `preview:mac:unsigned`: both themes, cross-page
      metrics against 模型 / 技能 catalogs, screenshots with path/size/sha256 (not committed).
      Windows network behaviour recorded as unverified.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Unit | domain/protocol/desktop/renderer marketplace tests | pass | pass (2026-10-07) |
| Aggregate | `corepack pnpm run check` | pass | pass: 968 files, 6513 tests (2026-10-07) |
| E2E | `corepack pnpm run test:e2e` full suite | pass | marketplace specs pass; 4 unrelated specs failed under full-suite load and passed on isolated rerun |
| Packaged | `preview:mac:unsigned`, manual + screenshot in both themes | artifacts + metrics | package + smoke pass; marketplace screenshots and cross-page metrics pending user review |
| Windows | real Windows run of browse/search behind proxy | evidence | unverified |

## Rollback

Renderer tab, Main IPC and cache are additive; reverting the change restores the
`发现扩展包` view. The cache file is disposable. The domain move of memory-owner identifiers
is behaviour-preserving and covered by existing preflight tests.
