# Desktop-owned extension precompilation

Status: complete (local delivery)
Owner: Codex
Started: 2026-09-23
Last updated: 2026-09-23

## Goal and delivery boundary

Integrate precompilation for the locked Desktop-owned rules loader and OpenViking package only if standalone dependency closure, canonical memory ownership, behavior parity and packaged performance pass. Local source/build/tests and unsigned macOS preview only; no commit/push/upload/release or Windows claim. Keep Pi ResourceLoader as the only loader and leave user/third-party extensions unchanged.

## Evidence and design

Prior diagnostic compiled arm used an unacceptable workspace typebox symlink. After Host validation fixes, three-sample import medians are source 153.9 ms / experimental compiled 162.0 ms. Cold extension-load benefit was measured separately; production closure still needs verification.

Compile locked source through exact tsdown 0.22.13 into prepared capability output, not tracked source. Emit index.js under type=module and explicitly declare it in prepared Pi manifests. Bundle TypeBox into OpenViking and retain its license; allow only Node built-in runtime imports. Preserve source provenance hash and bind generated JS/config/license through existing prepared tree hashes. Source tree hashes remain unchanged; catalogVersion advances to 2026.09.23.1 to invalidate old prepared output. Keep TS source for source auditing/TUI migration; exclude both TS and JS Desktop-owned projections to prevent duplicate owners.

## Acceptance and rollback

Tests: compile/import outside checkout with no node_modules; reject unsupported imports; compare actual Pi loader tool schemas/registrations, ready/off/failed owner behavior and bounded synthetic Tool outcomes. Verify source-lock/extension adapter gates, full source gate and packaged lifecycle. Measure current packaged initialization/import without entry-substitution before claiming benefit. If identity, parity or performance fails, revert only this integration and rebuild the prior preview; preserve prior Host validation fixes and all unrelated WIP.

## Checkpoints

- [x] Audit source/packaging paths, dependency closure and projection exclusions.
- [x] Implement compiler and prepared manifest wiring with focused regressions.
- [x] Prove offline loader/schema/owner parity and quality gates.
- [x] Package, smoke, measure and record exact identity/limits.

## Protected WIP

Prior Host/protocol validation optimizations and their tests/plan; AGENTS, DESIGN, PRODUCT, prompt-attachment-access test, provenance/design previews and earlier plans. No edits to user profiles, sessions, credentials or memory data. Source-only package roots stay unchanged; compiled assets remain ignored output.

## Source validation

`check:source`: 880 files / 5,729 tests passed, 9 files / 24 tests skipped; coverage gates passed. Actual Pi loader parity includes tool definitions/schemas after synthetic session start, handler registrations, ready/off/failed managed connection states, canonical owner identity and the disabled-memory Tool result. Network is mocked; no Provider or memory service request is made. Standalone Node import runs outside the checkout with no node_modules.

Source-lock verification, extension-adapter provenance and prepared-capability hash validation passed. Frozen offline install retains existing peer resolutions; lock diff is only the root tsdown importer entry. The initial new ownership assertion incorrectly expected file paths on package candidates (the existing contract uses package location); corrected without changing product behavior, and the full source gate passed afterward. OpenViking preparation was extracted into a dedicated build module to preserve the structure gate.

## Packaged acceptance and delivery

`preview:mac:unsigned` passed and opened the rebuilt repository app. Actual packaged Pi SDK parity passed ready/off/failed plus complete Tool definitions and bounded disabled-memory outcome. Three matched fresh-profile samples using actual compiled entries, no path substitution: extension-load median 301.1 -> 105.0 ms; workspace click to composer 1820.7 -> 1658.7 ms; first import click to correct transcript 153.9 -> 152.2 ms. One delivered import was 213.9 ms; sample count is too small for a tail-latency claim. Retain the integration, with no claim about Provider or Windows performance.

Final app.asar SHA-256 `bb7a2f5b1e762d3fa92f757bbd376a9f1816c1794d9697b0cc5165a3aa1bcbab`; capability manifest SHA-256 `00746667ca8dbf7f814ad3e902e2f481a89756fa82539b561ac6c41db384e1f7`. Full local evidence and limits: `artifacts/performance/owned-extension-precompile-delivery.md` and `owned-extension-summary.json`. HEAD plus dirty WIP remains a local preview, not a release candidate. No commit/push/upload/release or manual memory write.
