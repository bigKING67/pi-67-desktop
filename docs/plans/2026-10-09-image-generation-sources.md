# Image generation sources in Settings

Status: active
Owner: Claude
Started: 2026-10-09
Last updated: 2026-10-09

## Goal

Let users choose where images are generated from the Models settings instead of
editing `models.json`: reuse a configured Provider (the default) or add a
separate endpoint, pick any image models, and run them through the image
workbench. Cover OpenAI-compatible image APIs (local gateway, micuapi) and
Volcengine Ark Seedream 5.0. Decision: ADR 0010 decision 14.

## Non-goals

- Gemini image models (the gateway's API for them is unknown).
- Per-Workspace image sources (global only, like Provider configuration).
- Price display or budgets beyond the existing task budget.

## Acceptance criteria

| Criterion | Target |
| --- | --- |
| No JSON editing | a source is created, changed and removed from Settings; `models.json` needs no image entry |
| Reuse | a source reusing a Provider sends that Provider's current key; the key is never written to `settings.json`, logs or receipts |
| Separate endpoint | key stored through the existing credential flow in `auth.json` |
| Any model | a model without a dedicated profile runs on its API's generic profile |
| Seedream | `ark-images` requests send `watermark: false`, PNG, explicit `WxH`; references as data URIs |
| URL results | URL-only responses download with the endpoint policy and no key; non-images refused |
| Real request | checkpoint 8 of the P1 plan runs on the local gateway (`gpt-image-2.5-sunburst` generate + edit) and one Seedream generation |

## Checkpoints

- [x] 1. Engine: profiles for `gpt-image-2.5`, Seedream 5.0 (pro, flash, lite ids), generic `openai-images` and `ark-images` profiles and the Ark surface; `model: "*"` accepted by contracts; model→profile resolution; provenance.
- [x] 2. pi-runtime: shared image HTTP rules (URL results, rejected parameter) and the `ark-images` Pi image API.
- [x] 3. Settings storage and protocol: `pi67Desktop.imageGeneration` parse/write, snapshot field, App-scope replay-safe command, Host routing, protocol revision.
- [x] 4. Registration: one Pi Provider per source with reuse key resolution; refresh on change; `image_generate` takes a `model` and fills the job's profile and surface.
- [x] 5. Renderer: Settings section 图像生成 (design-craft, browser67, packaged preview); DESIGN/PRODUCT authority.
- [ ] 6. Real request (P1 checkpoint 8).

## Progress log

- 2026-10-09: plan created after the user approved the full scope and chose the
  local gateway for the real request. Research: Pi `generateImages` honours a
  caller `apiKey`; registered Providers survive `refresh()` and re-registering
  merges (unregister first); Seedream's watermark defaults to on, it has no mask
  API, and image URLs expire after 24 h.
- 2026-10-09: checkpoints 3-4 complete. Found while wiring: a settings-only save
  reuses the validated runtime (models/auth unchanged), which was built before the
  new sources, so saving now re-syncs the image source Providers on it. A reused
  Provider's key is passed literally (`$$` / `$!` escapes), because Pi would
  otherwise run a key starting with `!` as a command. Real-SDK test: a reused
  source is available at once; an own endpoint gets Pi's API-key login and its
  key in `auth.json`. `check` passed. Next: checkpoint 5 (Settings UI).
- 2026-10-09: checkpoint 5 complete (`140c1b7c`, `fix` follow-up). Settings →
  图像生成 verified in the packaged app through an isolated offline preview
  (browser67 `remote_cdp`, 1440x874 at DPR 2): empty state, add flow reusing a
  fixture Provider (saved `settings.json` has the source and no key), external
  `settings.json` edits reflected live with `可用` / `缺少 API Key`, light and
  dark themes, and the 模型 Provider Catalog without image source Providers.
  Visual review fixed the empty-state spacing and showed the reused Provider's
  name instead of its id. Next: checkpoint 6, which needs the user to add the
  local gateway source in their own Desktop and approve each paid request.

