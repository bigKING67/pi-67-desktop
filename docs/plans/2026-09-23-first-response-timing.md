# First-response diagnostic timing

Status: completed
Owner: Codex
Started: 2026-09-23

## Goal and boundary

Add bounded content-free first-response timing to existing runtime diagnostics using public Pi Session events. Local implementation and validation authorized; no real paid Provider test, commit, push, upload or publication. Preserve existing dirty WIP.

## Evidence and decisions

- Installed Pi SDK 0.86.1 exposes Session subscribe events. prompt preflightResult is documented as an internal RPC hook: do not extend its use for timing.
- Public SDK call and content events are observable; actual network dispatch and physical/display commit are not established by these seams. Label scope runtime-to-stream-emission explicitly; do not report network TTFT or painted text.
- Collect submit entry, Session consistency check, configuration readiness, SDK prompt invocation, first nonempty thinking/text delta, and first corresponding Host stream-batch emission. Attachments/vision work lies between configuration readiness and SDK invocation.
- Keep at most eight receipts in each runtime memory. Numeric sequence/times, fixed stage/status enums only. No prompt, text, file path, model credentials, response bodies, upstream error messages or persistent Session entries.
- Ordinary submit only; steer/follow-up/commands, subagents and queued streaming submissions must not inherit another turn's timing. Cancellation/failure retain truthful incomplete milestones.

## Acceptance

Targeted privacy/schema/lifecycle regression, applicable protocol revision generation, full source gates, local macOS packaged build/smoke and controlled timing receipt. No claim about real Provider latency or Windows.

## Checkpoints

- [x] Confirm public measurement seams and evidence limits.
- [x] Implement typed receipt and bounded collection with existing diagnostic transport.
- [x] Verify order, empty deltas, queued exclusion, cancellation/failure, retention and privacy.
- [x] Full source and packaged controlled receipt; closeout.

## Rollback

Revert only new timing instrumentation/schema/docs; regenerate matching protocol revision. Preserve prior content-index, Markdown and capability optimizations and unrelated WIP. No persisted data migration.

## Progress

- Source integration uses ordinary Session subscriptions scoped to submit, an
  optional attachment-to-SDK invocation observer, and the existing runtime event bus
  emission boundary. Protocol revision regenerated as
  `2f6b4118cb65bbd2217ad0ecb13c486ad223e812d53f110f19d0f15d886c8e2a`.
- Deterministic schema/collector/prompt/attachment tests: 15 passed. Real SDK with
  offline thinking/text provider: 1 passed. Full gate initially found fixture typing,
  an unbound mock-method assertion and the runtime file's line limit; these were
  corrected without weakening gates. Full gate rerun passed: 878 files / 5719 tests; 9 files / 24 tests skipped.

## Closeout

- Source base: `9c2d1624438c3684b38a8dbdca9ea38e0aa874e5` plus dirty local changes;
  not a clean/exact-SHA release. Existing unrelated WIP preserved.
- Changed boundaries: optional RuntimeDiagnostics responseTiming schema/revision;
  Pi runtime event bus, prompt action and attachment invocation observation;
  bounded collector and privacy/lifecycle/real-SDK tests; offline performance fixture;
  architecture and performance contracts. No frontend implementation change.
- `check:source` passed (response-timing-source-validated.log).
- `preview:mac:unsigned` passed and opened the current preview.
- Real packaged Pi SDK thinking/text timing and Main local diagnostic export passed;
  exact receipt preserved in support-diagnostics.v6. ASAR SHA-256
  `61816b20af941c8627b50d0269b4d14e35d2137a5917ca5e47fc32b842a976ca`.
- Evidence: `artifacts/performance/response-timing-result.md`,
  `response-timing-packaged.json`, `response-timing-preview.log`.
- No real paid Provider, network TTFT, Renderer display time or Windows evidence.
  These are explicit measurement limits, not zero-duration stages.
- No commit, push, upload, release or memory persistence.
