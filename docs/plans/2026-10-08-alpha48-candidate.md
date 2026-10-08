# Alpha.48 internal candidate preparation

Status: Windows tested by the user; R2 publication deferred
Owner: Claude
Started: 2026-10-08

## Goal and acceptance

Prepare New Money 0.1.0-alpha.48 Windows x64 EXE and macOS arm64 DMG/ZIP from one
clean, pushed source SHA carrying the visual quality bar phase 6 residual audit
(label tracking, colored edges, radius roles, Provider sync status, marketplace end
slot, Auto select model-first detail, expanded Tool detail, context pressure from 50%,
tooltip lift, Team Chat borders), the Team Chat Agent management redesign (`新建 Agent`
and `Agent 设置`, no protocol change), the plain-text Agent prompt, and the team origin
layout guard. Require `check:candidate`, full CI, Windows candidate certification
against the Alpha.47 baseline (including the real-user provider-configuration lane),
macOS packaged smoke, and matching source/version/runtime byte identities.

## Delivery boundary

The user asked to prepare Alpha.48 on 2026-10-08 and to be asked separately before
push and R2 publication. Push was authorized later the same day; no Feishu upload, R2 upload/manifest, promotion, Tag,
GitHub Release, signing or notarization without separate current authorization.
Manual Windows/macOS acceptance cannot inherit Alpha.47 receipts.

## Decisions

- Bump only the root and nine application/domain package versions; dependency pins and
  the pnpm lockfile stay unchanged.
- Baseline: Alpha.47 published candidate (Windows run `37720999046`, attempt 1).
- The Windows real-user provider-configuration lane selectors (search field, 已配置 tab,
  OpenAI row, 更新 API Key, credential dialog) are untouched by this round; removing the
  `配置已同步` status and swapping refresh icons does not affect them.

## Progress

- [x] Local `check:candidate` on the version source passed first time (969 files / 6517
  tests; capability lock still fresh, no bump needed).
- [x] Source `e5aa8124` pushed (user authorized). CI `37772492277` passed on attempt 2:
  attempt 1 failed the known team-chat-search viewport flake and a Windows native smoke
  renderer checkpoint at 751ms against the 750ms budget (no desktop/shutdown change);
  only the failed jobs were rerun.
- [x] `check:candidate` re-run on `e5aa8124` (969 files / 6517 tests); dispatch preflight
  passed against the Alpha.47 baseline (run `37720999046` attempt 1, actions artifact).
- [x] Windows candidate `37786381569` attempt 1 passed provenance, build and full installer
  certification. Downloaded EXE and packaged executable match the candidate identity.
- [x] Exact-source macOS preview (`e5aa8124`, clean tree) packaged and smoke-tested;
  app.asar `1c6bd479…` matches the pre-commit build.
- [x] Readiness record `artifacts/validation/alpha48-candidate/readiness-e5aa8124.json`:
  Windows EXE `abda3902…` (252,249,856 bytes), DMG `ac946966…` (337,105,160),
  ZIP `f8e56104…` (343,620,766).
- [x] Manual Windows test: the user reported "测试通过" on 2026-10-08 for the candidate
  above (run `37786381569` attempt 1, EXE `abda3902…`); the machine count was not stated.
- [ ] R2 publication: deferred by the user ("暂时不发布R2更新"); needs separate authorization.

## Known risks

- Team Chat Agent management moved from one dialog to `新建 Agent` and `Agent 设置`;
  covered by Renderer E2E only, not by a packaged Windows lane.
- Known intermittent Windows timing failures (shutdown exit delay, session-surface wait):
  rerun failed jobs before debugging.
