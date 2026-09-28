# Full-repository review follow-ups

Status: decisions 1-6 applied; approvalMode removal (stage 2) and device evidence open
Owner: main
Started: 2026-09-28
Last updated: 2026-09-28

## Goal and acceptance
Close the remaining validated findings from the 2026-09-27 read-only full-repository review
(baseline b125297; 8 module reviewers plus independent refute-by-default verifiers; 55 confirmed,
3 refuted). Each item below is either waiting for an owner decision, needs real-device evidence,
or is deferred with a reason. An item closes only with a targeted test or recorded device evidence.

## Already landed (for traceability)
52f0669..b4c7ad1: destructive Git/deletion recognition, macOS title bar crash, OpenViking Recall
scope, redirects, search escaping, privacy override and managed/standalone endpoint split, CI
docs-only scoping, AST architecture gate, transport scan scope, Vitest tsx collection, steer live
turn, memory draft on identity refresh, Settings leave guard for every exit, attach-port, update
state and system-bridge protocol ownership, packaged probe selectors, diagnostics key spellings,
manifest no-store, account poll error, authority document drift.

## Decisions (owner accepted the recommendations on 2026-09-28)
1. **Renderer runtime import cycles** — done. Workbench persistence suspension moved to the leaf
   `workbench-persistence-suspension.ts`; session creation recovery settles transitions through the
   `session-transition-settlement.ts` port bound by app-store at creation. The architecture gate now
   fails on any runtime cycle; the known-cycle allowlist was removed.
2. **Approval refused-but-pending** — done. `approval.respond` returns `refusedDecision`
   (`workspace-untrusted`, `hard-stop`, `path-grant-rejected`) and the renderer keeps the dialog open.
3. **`approvalMode` wire field** — stage 1 done: optional on the wire, Host defaults it, renderer no
   longer sends or stores it. Stage 2 (remove from schemas and runtime options) is due in the next
   protocol revision.
4. **Protocol revision coverage** — done. Context-scope, event-context and replay-safe tables are part
   of the revision material.
5. **commerce-growth-os `sync_helper`** — removed; the pack syncs through its own repository and the
   capability lock.
6. **Persisted-state IPC codecs** — keep Main ownership. Versioned persistence migration stays out of
   the runtime-neutral protocol package; revisit only if a second process needs these codecs.

## Needs real-device evidence
- macOS title bar fix (54ba0fa) in the packaged app while switching system appearance.
- Packaged team-session probe (a7d03f2): run `node eng/packaging/probe-packaged-team-session.mjs`
  with a live directory; the rewrite is source-verified only.
- Windows real-user probes: Provider failure now detected via `provider-configuration-error`.

## Deferred items
Done on 2026-09-28: test-02 (Python worker tests in the CI quality lane), protocol-domain-06
(typecheck-time union parity), routing-01 (dead steer/follow-up commands removed), ui-bridge-01
(extension UI answers validated), ov-shared-07, ov-dead-08 (addResource removed; other upstream
members kept per UPSTREAM.md), renderer-core-08 (source fix only; no automated test because the
language chunk is not addressable in preview builds), settings-04/05/06/07, e2e-01, ps-01.

Still open:
- attachments-01: the 128-set limit now raises RESOURCE_LIMIT_EXCEEDED with recovery guidance.
  Releasing only successfully completed sets is not done: PRODUCT.md retains settled sets for
  explicit retry and replay adopts existing sets, so release needs its own analysis.
- approvalMode stage 2 (see decision 3).

## Rollback
Each landed fix is an independent commit; revert individually. Protocol revision regenerates from
source (`corepack pnpm --filter @pi67/protocol run generate:revision`).

## Progress
- 2026-09-28: plan recorded after landing the accepted fixes; decisions 1-6 pending.
- 2026-09-28: decisions 1-6 applied (e543051..HEAD); approvalMode stage 2 remains.
- 2026-09-28: deferred items closed except attachments-01 release and approvalMode stage 2.
