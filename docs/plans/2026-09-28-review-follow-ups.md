# Full-repository review follow-ups

Status: decisions 1-6 applied, approvalMode stage 2 done; device evidence open
Owner: main
Started: 2026-09-28
Last updated: 2026-09-30

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
3. **`approvalMode` wire field** — done. Stage 1 made it optional and stopped the renderer sending it;
   stage 2 (2026-09-30) removed it from the four command payloads and schemas (strict schemas now reject
   it), from `AgentRuntime.initialize` and `setWorkspacePolicy`, and regenerated the protocol revision.
   The runtime safety policy still carries `approvalMode`, fixed to the Host default; the projected
   `WorkspaceState.approvalMode` field is left for a separate cleanup.
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
- ~~Windows real-user probes~~ — closed 2026-09-30. Windows candidate run 36671645797 (source
  fa120a1, alpha.41) ran the full installed real-user lifecycle on hosted Windows x64, including the
  Provider configuration stage, and passed. The `provider-configuration-error` failure branch is
  covered by `windows-real-user-health.test.mjs`; the failing path itself has no device run.
  Closing this surfaced a stale selector: e7a46fe removed the per-row 已配置 badge, fixed in fa120a1.

## Deferred items
Done on 2026-09-28: test-02 (Python worker tests in the CI quality lane), protocol-domain-06
(typecheck-time union parity), routing-01 (dead steer/follow-up commands removed), ui-bridge-01
(extension UI answers validated), ov-shared-07, ov-dead-08 (addResource removed; other upstream
members kept per UPSTREAM.md), renderer-core-08 (source fix only; no automated test because the
language chunk is not addressable in preview builds), settings-04/05/06/07, e2e-01, ps-01.

Still open:
- attachments-01 — closed as by design. The limit now raises RESOURCE_LIMIT_EXCEEDED with recovery
  guidance. Releasing completed sets was analysed and rejected: PRODUCT.md ("Operation acknowledgement
  alone does not delete claimed bytes because the active Task may still use `read_attachment` in a
  later turn") and the attachment read tool resolve old set ids for the rest of the Task. Evicting
  sets would change that product contract, so it needs a product decision, not a fix.

## Rollback
Each landed fix is an independent commit; revert individually. Protocol revision regenerates from
source (`corepack pnpm --filter @pi67/protocol run generate:revision`).

## Progress
- 2026-09-28: plan recorded after landing the accepted fixes; decisions 1-6 pending.
- 2026-09-28: decisions 1-6 applied (e543051..HEAD); approvalMode stage 2 remains.
- 2026-09-28: deferred items closed except attachments-01 release and approvalMode stage 2.
- 2026-09-30: Windows real-user probes closed with candidate run 36671645797; macOS title bar and
  packaged team-session device evidence plus approvalMode stage 2 remain.
- 2026-09-30: approvalMode stage 2 landed; only attachments-01 (product decision) and device
  evidence remain.
