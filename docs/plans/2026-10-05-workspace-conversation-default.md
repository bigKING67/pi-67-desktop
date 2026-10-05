# Workspace conversation defaults

Status: completed
Owner: Codex
Started: 2026-10-05
Last updated: 2026-10-05

## Goal
Remember an explicit per-Workspace conversation default and inherit it for new drafts. Replace the large scope section with a compact disclosure near the Workspace title.

## Non-goals
No automatic sharing, knowledge indexing, account changes, historical conversation migration or distribution.

## Acceptance criteria
- Main persists bounded Workspace defaults; missing legacy values remain unset.
- Private and team defaults are explicit; team defaults retain account/service identity.
- New drafts inherit; existing drafts/history do not retarget. Content-bearing drafts remain intact when changing scope.
- A temporary private/team selection does not overwrite the default.
- Existing knowledge bindings are candidates requiring one explicit confirmation.
- Permission/account failures preserve drafts and never silently fall back to private.
- Relevant tests, source gate, UI evidence and macOS preview are recorded separately.

## Delivery boundary
Local implementation and validation including repository macOS preview. On 2026-10-05,
the user additionally authorized a scoped commit for this change, a separate model
confirmation/startup retry commit, one push to origin/main and exact-SHA CI follow-up.
Upload and release remain outside this delivery.

## Current evidence
Clean canonical checkout at start. SessionScopePicker requires explicit selection; DESIGN currently prohibits inferred defaults. Main owns workbench persistence. Host retains team authorization.

## Affected boundaries
Domain and preload layout contract, Main validation/persistence, Renderer draft creation and UI, encrypted draft recovery.

## Decisions
Persist preference in existing Main workbench state, with optional backwards-compatible field. Never infer consent from knowledge binding. Keep existing Host authorization.

## Checkpoints
- [x] Persistence and draft inheritance
- [x] Compact picker and explicit default/temporary actions
- [x] Authority updates and regression checks
- [x] Source gates and runtime/packaged validation

## Rollback
Revert scoped source changes; do not edit user data. Optional defaults are not Session truth. No history is rewritten. An older binary with the former strict V5 parser may reject the added optional fields; do not downgrade against updated live state without retaining its backups and a compatible reader.

## Risks and unknowns
Live multi-team authorization and Windows evidence require separate acceptance. Preference is not authorization.

## Validation
- `corepack pnpm run check:source`: PASS, 954 test files / 6,363 tests passed; 9 files / 24 native/live tests skipped. Final log: `/tmp/pi67-scope-source-final.log`.
- Targeted Playwright: 11 passed including workbench regression and default inheritance; final scope-only rerun: bootstrap + scope test passed. Logs: `/tmp/pi67-scope-e2e.log`, `/tmp/pi67-scope-e2e-final.log`.
- Real rendered light/dark screenshots inspected under `test-results/renderer-conversation-defa-279c5-isting-text-remain-isolated-renderer-chromium/`. Compact disclosure and expanded existing Select family pass local visual review; live service and Windows remain separate evidence.
- Initial full run exposed the expected layout fixture missing the new preference field; strict assertion updated and retested. First owner-mismatch regression needed connection recovery isolation in its test fixture; no product timeout increased.
- `corepack pnpm run preview:mac:unsigned`: PASS; rebuilt DMG/ZIP, packaged smoke, archive verification and repository app launch. Log `/tmp/pi67-scope-mac-preview.log`; identity `artifacts/release/macos-preview-candidate-identity.json`; receipt `artifacts/release/macos-preview-packaged-smoke.json`.
- Native Computer Use verified `app://pi67/index.html`, compact disclosure, expanded radio/Select/actions and real existing Workspace binding prefill. No default was saved and no message/model request was sent in the user profile. Preview left open with the disclosure collapsed.
- Packaged app.asar SHA-256: `ebfdc4afb5b51e05ad0e2a5089521bcf2006fdaab77aa3c1c34f3fa5246d3112` (195192218 bytes). Unsigned macOS arm64 local preview, not release/Windows certification.
- Lightweight design consistency: PASS for touched compact utility/disclosure and existing Settings Select family, light/dark, keyboard activation, loading/disabled rendering; simulated failures in unit tests. Real account/service switching and Windows remain unverified.
- Source base: `886bcbc3` on `main`, plus this uncommitted scoped diff. No commit/push/upload.
