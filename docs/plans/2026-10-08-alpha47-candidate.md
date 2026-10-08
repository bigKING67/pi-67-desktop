# Alpha.47 internal candidate preparation

Status: active
Owner: Claude
Started: 2026-10-08

## Goal and acceptance

Prepare New Money 0.1.0-alpha.47 Windows x64 EXE and macOS arm64 DMG/ZIP from one
clean, pushed source SHA carrying the Extension marketplace, the single-level 扩展 tabs
and the Settings convergence (visual quality bar phase 5), plus the workbench batches
landed in parallel (light code theme, overlays, Team Chat, mode-switch icons). Require
`check:candidate`, full CI, Windows candidate certification against the Alpha.46
baseline (including the real-user provider-configuration lane that exercises the
redesigned 模型 page), macOS packaged smoke, and matching source/version/runtime byte
identities.

## Delivery boundary

The user authorized push and a candidate build on 2026-10-08 ("打 Alpha.47 候选版本").
No Feishu upload, R2 upload/manifest, promotion, Tag, GitHub Release, signing or
notarization; each needs separate current authorization. Manual Windows/macOS
acceptance cannot inherit Alpha.46 receipts.

## Decisions

- Bump only the root and nine application/domain package versions; dependency pins and
  the pnpm lockfile stay unchanged. The capability lock moves to craft67 `8e2a37f`
  (required by the freshness contract), package versions unchanged.
- Baseline: Alpha.46 published candidate (Windows run `37430329046`, attempt 3), identity
  retained at `artifacts/verified-unsigned-preview/windows-preview-candidate-identity.json`.

## Progress

- [x] Local `check:candidate` on the version source: first run failed capability freshness
  (craft67 main 502266e -> 8e2a37f, 17 commits; versions unchanged). Lock moved to
  8e2a37f with catalog 2026.10.08.1, capabilities re-prepared, then `check:candidate`
  passed (969 files / 6514 tests).
- [ ] Push and CI on the version source.
- [ ] Windows preflight and `Windows candidate` dispatch.
- [ ] Exact-source macOS preview packaged and smoke-tested.
- [ ] Readiness record with the three product identities.

## Known risks

- Windows `certify-installer` drives `windows-real-user-provider-configuration.mjs`; batch D
  changed the Provider detail (credential row, header status). Selectors were checked
  locally (search box, 已配置 tab, OpenAI row, 更新 API Key, credential dialog) but only the
  Windows run can prove it.
- Known intermittent Windows timing failures (shutdown exit delay, welcome wait) from the
  Alpha.46 run: rerun failed jobs before debugging.
