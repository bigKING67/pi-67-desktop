# Configuration projection read batching

Status: completed (local delivery)
Owner: Codex
Started: 2026-09-23

## Goal and evidence

Trace immediate-import background work and remove proven duplicate configuration IO. Packaged origin probe identifies initial `external` configuration baseline events, with all four file kinds initially unobserved, not an online catalog refresh. No trustworthy loaded-Session revision witness currently justifies skipping its first runtime reload. Projection currently reads the same three global files independently for global and every Workspace state.

## Scope, acceptance and rollback

Read three global files once per projection invocation; independently read trusted project contents and preserve untrusted metadata-only semantics. Fresh invocation rereads files; no persistent cache, new routing, event suppression, receipt/fsync change or schema change. Preserve single-state mutation reads, hashes and fail-closed errors/budgets. Tests cover IO counts, separate revisions, trust, refresh freshness and failure; targeted runtime tests, full source gate, rebuilt macOS smoke and bounded packaged timing. Claim deterministic IO reduction only unless timing supports more. Rollback only this batch helper/projection/test/doc delta if boundaries fail; preserve all prior dirty WIP. Local implementation/preview only; no commit/push/upload/release, Provider call or Windows claim.

## Checkpoints

- [x] Attribute initial refresh and verify duplicate reads.
- [x] Implement and test per-invocation batching.
- [x] Full gate, packaged verification and honest performance limits.

## Focused validation

Runtime typecheck passed. Four affected test files / 21 tests passed, including four new real-filesystem cases for shared global IO counts, unchanged per-Workspace revisions versus single reads, trust promotion, external edits on the next invocation, failed global reads and fresh retries, and zero IO for an empty projection. Single-state mutation reads still use the same bundle shape and revision framing.

## Validation anomaly

First full source run: 5,732 passed, 24 skipped, one failure in untouched `eng/capabilities/native-artifact-store.test.mjs` (replaced payload symlink retirement expected rejection, received successful creation). Targeted file rerun passed. Its ordering contract sorts by createdAt then path, while the test assumes the first creation is retired; timestamp tie is a hypothesis, not reproduced proof. Preserve the first full log; do not alter the unrelated test or claim it fixed. Full gate rerun passed: 881 files / 5,733 tests passed; 9 files / 24 tests skipped. Coverage and all source gates passed. The unrelated test itself remains unchanged; its original failure is not claimed fixed.

## Packaged outcome

Preview build/smoke/verification/open passed. Three isolated packaged runs observed 12 two-state projection batches: each had exactly 3 global path checks plus 2 independent project checks, with trust preserved. Import samples 186.1/135.9/155.1 ms (median 155.1) do not establish improvement over the earlier 152.9 ms median; no tail-latency claim. Retain the deterministic per-batch IO reduction, not a claim that initial-refresh overlap is solved.

ASAR SHA-256 `d377a3a770e91bd79cc81e7bdb158818731aee38be238deea02278a2e05962f0`, 212756284 bytes. Detailed local report: `artifacts/performance/config-read-batch-delivery.md`; machine evidence: `config-read-batch-summary.json`. No commit/push/publication or Windows claim.
