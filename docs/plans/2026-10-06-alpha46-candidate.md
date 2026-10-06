# Alpha.46 internal candidate preparation

Status: published to the internal R2 update channel (2026-10-06)
Owner: Claude
Started: 2026-10-06

## Goal and acceptance

Prepare New Money 0.1.0-alpha.46 Windows x64 EXE and macOS arm64 DMG/ZIP from one
clean, pushed source SHA that adds Team Chat attachments and images (ADR 0009; the
service side is live since 2026-10-06). Require candidate source gates, full CI,
Windows candidate certification against the Alpha.44 baseline, macOS packaged smoke
and matching source/version/runtime byte identities.

## Delivery boundary

The user authorized push and candidate builds on 2026-10-06. Alpha.45 was prepared
but never published and is superseded. No Feishu/R2 upload, promotion, Tag, GitHub
Release, signing or notarization; R2 publication needs separate authorization after
target-user acceptance. Manual Windows/macOS acceptance (including sending an image
and a PDF, saving a file and opening the image viewer on Windows) cannot inherit
Alpha.44/45 receipts.

## Decisions

- Bump only the root and nine application/domain package versions; dependency pins,
  capability versions and the lockfile stay unchanged.
- Upgrade baseline: retained Alpha.44 candidate (source
  `4f04a830b3ac847b505582adcada53ee564719e2`, Windows run `37283874495`, attempt 2).

## Progress

- [x] Local `check:candidate` passed on the version source and again on the fix.
- [x] Pushed `5670787` (version) and `d41922a` (fix). CI on `5670787` failed: the
  long-message search jump test (first ever failure; the new Virtuoso Footer was the
  only related change, so the 12px end gap moved onto the last row) and a Windows
  dependency download socket reset. CI `37427860532` on `d41922a`: attempt 1 failed
  only `renderer-context-pressure` (21/21 locally, untouched area); attempt 2 passed
  every selected lane.
- [x] Windows candidate `37430329046` (Alpha.44 baseline): attempt 1 failed after a
  verified task recovery because the test app's shutdown was slow (the known
  intermittent Windows exit delay); attempt 2 failed waiting 15 s for the welcome
  action on a slow runner (it had rendered); attempt 3 passed provenance, build and
  full installer certification. Each failing stage passed in the other attempts.
- [x] Exact-source macOS preview (`d41922a`) packaged, smoke-tested and opened.
- [x] Readiness record `artifacts/validation/alpha46-candidate/readiness-d41922a7.json`:
  Windows EXE `2a192ed4…d956` (251,404,004 bytes), DMG `b8ee24ff…c92d`,
  ZIP `84329a70…5acc`; identity, size and SHA-256 cross-checked.

## Publication

- The user confirmed acceptance and authorized publication on 2026-10-06. The Windows
  test receipt binds that confirmation to run `37430329046` attempt 3 and the exact
  EXE/executable hashes (candidate identity `f0c19d9f…ce40`).
- Before writing, Alpha.42 (the public version) Main manifest parsing and renderer
  update-state validation were replayed from `a7e0822d` sources against the new
  manifest: accepted for Windows and macOS in available/downloading/installing.
- `release:r2:publish` from tooling `0504fc49` (source `d41922a`): three artifacts
  uploaded and read back, manifest last, public manifest verified as Alpha.46;
  retention kept Alpha.46/42/41 and deleted the three Alpha.40 artifacts. Receipt:
  `artifacts/r2-release-receipts/2026-10-06T09-24-30.430Z-publish-0.1.0-alpha.46.json`.

## Remaining

- In-app `检查更新 -> 下载并安装 -> restart -> version` on Windows x64 and an
  installed macOS arm64 copy.
- The two Windows timing failures are not explained by this change; keep the
  receipts with the Alpha.45 observations.
