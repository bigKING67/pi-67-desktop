# Alpha.46 internal candidate preparation

Status: in progress
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

- [x] Local `check:candidate` passed on the version source.
- [ ] Push; full CI.
- [ ] Windows candidate preflight and dispatch; certification.
- [ ] Exact-source macOS preview packaged smoke.
- [ ] Readiness record.
