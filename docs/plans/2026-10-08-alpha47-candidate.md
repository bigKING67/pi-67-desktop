# Alpha.47 internal candidate preparation

Status: published to the internal R2 update channel (2026-10-08)
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
- [x] Pushed `90e93cab` (capability lock) and `0d2c6c39` (version). CI `37720961544` attempt 1
  passed every lane, including Windows native smoke and installer lifecycle.
- [x] Preflight passed (Alpha.46 actions-artifact baseline). Windows candidate `37720999046`
  attempt 1 passed provenance, build and full installer certification (real-user provider
  configuration lane included) on the first try.
- [x] Exact-source macOS preview (`0d2c6c39`) packaged, smoke-tested and opened.
- [x] Readiness record `artifacts/validation/alpha47-candidate/readiness-0d2c6c39.json`:
  Windows EXE `7579ab8f…742a` (252,265,706 bytes), DMG `8f25cc74…2e07` (337,107,620),
  ZIP `fc7b93f4…af13` (343,617,104); repository, source, version and Pi runtime match.

## Publication

- The user reported "Windows 测过了，没问题" and authorized R2 publication of Alpha.47 on
  2026-10-08. The machine count was not stated. The Windows test receipt (actor
  `bigKING67`) binds that confirmation to run `37720999046` attempt 1 and the exact
  EXE/executable hashes (candidate identity `27121cd2…d2a0`).
- Before writing, Alpha.46 (the public version) Main manifest parsing and renderer
  update-state validation were replayed from `d41922a` sources against the new manifest:
  accepted for Windows and macOS in available/downloading/installing.
- Read-only plan, then `release:r2:publish` from tooling `4ba53368` (source `0d2c6c39`):
  three artifacts uploaded and read back, manifest last, public manifest verified as
  Alpha.47; retention kept Alpha.47/46/42 and deleted the three Alpha.41 artifacts.
  Receipt: `artifacts/r2-release-receipts/2026-10-08T03-56-02.267Z-local-retention-0.1.0-alpha.47.json`.

## Remaining

- In-app `检查更新 -> 下载并安装 -> restart -> version` on Windows x64 and an installed
  macOS arm64 copy (from Alpha.46).
- Feishu mirror was not used for this round.

## Known risks

- Windows `certify-installer` drives `windows-real-user-provider-configuration.mjs`; batch D
  changed the Provider detail (credential row, header status). Selectors were checked
  locally (search box, 已配置 tab, OpenAI row, 更新 API Key, credential dialog) but only the
  Windows run can prove it.
- Known intermittent Windows timing failures (shutdown exit delay, welcome wait) from the
  Alpha.46 run: rerun failed jobs before debugging.
