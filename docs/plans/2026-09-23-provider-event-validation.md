# Provider event validation acceleration

Status: completed
Owner: Codex
Started: 2026-09-23
Last updated: 2026-09-23

## Goal and acceptance

Reduce measured Host CPU spent validating Provider configuration events, preserving the canonical schema and all envelope/context/size checks. Verify interpreted/accelerated parity, protocol and Host tests, full source gate, packaged smoke, renderer compiler isolation, and real packaged import timing.

## Non-goals and delivery boundary

No extension-precompile promotion, provider calls, renderer JIT/CSP changes, dependency version upgrade, receipt changes or data migration. Local implementation and unsigned macOS preview only. No commit, push, upload, Windows claim or release.

## Evidence

Existing package 4f36bc24c16617a2a2559f6b8243feae315835445cdf42e7350bc0440e7dd279 retains one interpreted validation per outgoing event. Provider events cost approximately 18–27 ms each. A Host-only load-hook experiment compiles the same Provider payload schema once (~2 ms); measured envelope checks are ~6–10 ms. Experimental compiled-extension first imports: 151.8/186.1/158.0 ms. These are mechanism evidence, not final-product acceptance.

## Design

Share the existing envelope/context validation logic through an explicit schema-check factory. A separate protocol export consumed only by Host compiles the single canonical Provider-change payload schema lazily with the existing TypeBox version. All other schemas keep the existing interpreter. Cache one validator, never payloads; module lifetime, no TTL or invalidation needed for immutable application-owned schema. Compiler failure never accepts data. The default protocol barrel and Renderer retain the interpreted route.

## Boundaries and rollback

Affected: protocol validator/build export, Host event channel, tests and architecture contract. Wire schemas/revision and persisted state unchanged. Preserve prior duplicate-validation fix and unrelated dirty WIP (AGENTS, DESIGN, PRODUCT, prompt-attachment-access test, provenance/design previews/plans). If parity, packaging isolation or actual performance fails, revert only this plan's additions and retain diagnostic evidence; no user data rollback required.

## Checkpoints

- [x] Baseline and bounded load-hook experiment.
- [x] Canonical implementation and parity regressions.
- [x] Source gate and renderer compiler isolation.
- [x] Rebuilt macOS smoke and import measurements; record limits and final identity.

## Final evidence

Full source gate passed 879 files / 5,726 tests; 24 configured skips. Renderer audit found no compiler in 232 output chunks. macOS preview build/smoke/container verification/open passed. Final ASAR SHA-256: 309659ce91c6e0334bbe612b311d48fc2087f6d19f1665fd7f53e43c8d3f6210. Three-per-arm packaged import medians: source 153.9 ms, compiled experiment 162.0 ms (prior 155.0/223.7 ms). Source median effectively unchanged; no p95 claim or precompile promotion. Details: artifacts/performance/provider-event-validation-acceleration.md. No commit/push/release.
