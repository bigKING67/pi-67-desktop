# Alpha.48 internal candidate preparation

Status: local preparation (not pushed)
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
push and R2 publication. No push, Feishu upload, R2 upload/manifest, promotion, Tag,
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
- [ ] Push (needs authorization), CI, Windows candidate certification.
- [ ] Exact-source macOS preview and readiness record.

## Known risks

- Team Chat Agent management moved from one dialog to `新建 Agent` and `Agent 设置`;
  covered by Renderer E2E only, not by a packaged Windows lane.
- Known intermittent Windows timing failures (shutdown exit delay, session-surface wait):
  rerun failed jobs before debugging.
