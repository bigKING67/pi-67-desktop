# Managed private memory inspector repair

Status: complete (inspector repair and one bounded real-model private-memory acceptance; performance and Windows remain separate)
Owner: Codex
Started: 2026-09-19
Last updated: 2026-09-19

## Goal and acceptance

Route workbench health, private reads/search and session statistics to the admitted
Desktop-managed private owner. Never probe a legacy endpoint in managed mode,
start a sidecar merely to observe it, or infer OV lineage from a Pi Session ID.
Revoked/missing connections fail closed. Credentials remain Main/Host-only.

## Scope and delivery

Local implementation, targeted and aggregate checks, macOS unsigned preview and
bounded synthetic user acceptance only. No commit/push, remote deployment,
runtime installation, data migration, deletion or team publication. Preserve all
pre-existing dirty work, private data and the synthetic Qingning test conversation.

## Observed evidence

- Current macOS settings health passes; the workbench still probes configuration.endpoint.
- ContextMemoryCommandRouter.sessionStatus manufactures zero counts on legacy health failure.
- The admitted extension's SyncManager owns Pi-to-OV lineage; manual Commit already uses its SDK bus.
- Short-session Commit may retain all recent messages, so accepted is not extraction proof.

## Decisions

- Add a read-only existing-connection request to the private Main/Host broker.
- Use that connection for Host inspection clients, with no credential fallback,
  redirects or raw managed transport errors.
- Resolve session metadata through the existing admitted owner's Pi EventBus;
  retain identity/generation/provenance fences and reject missing/duplicate owners.
- Legacy manual diagnosis remains explicitly separate; no persisted endpoint rewrite.

## Checkpoints

- [x] Implement and test read-only connection lifecycle and failure boundaries.
- [x] Wire inspector transport and owner-resolved session statistics; regression tests.
- [x] Update authority, pass source gates and packaged macOS preview.
- [x] Verify real-profile status; distinguish extraction and recall acceptance.

## Validation

Targeted protocol/Main/Host/SDK/extension tests, typecheck, aggregate check:source,
packaged macOS smoke and real native inspection. Windows remains unverified.
Bind results to this dirty checkout and generated artifact identity, not HEAD alone.

2026-09-19 source evidence: `corepack pnpm run check` passed with 5,578 tests,
23 environment-gated skips; build and test typecheck passed. Source logs are
`/tmp/newmoney-inspector-check3.log` and `/tmp/newmoney-inspector-build.log`.
The first aggregate run exposed the expected source-lock hash drift and the old
disabled-session synthetic-zero contract; the lock and regression expectation
now reflect the actual source and explicit unavailable result.

Controlled prebuilt Chromium evidence: settings tests and renderer bootstrap
passed in `/tmp/newmoney-inspector-e2e.log`; the new inspector test passed after
completing its protocol fixture in `/tmp/newmoney-inspector-e2e3.log`. It checks
actual owner counts, Session replacement and unavailable/unknown states. Dark
and light captures under `artifacts/visual-review/managed-memory-inspector-*.png`
were visually inspected; no layout/token changes. These are fixture UI evidence,
not real memory extraction or packaged-platform evidence.

Packaged macOS evidence: `/tmp/newmoney-inspector-preview.log` records a passing
darwin/arm64 packaged smoke and opening the new preview (PID 87200). App ASAR:
200637775 bytes, SHA-256
`4011c7f28f27ac6857356c3e76e2c71f006c6a612160c3786a3167bcd087e159`.
The active shared-profile owner module matches the source file SHA-256
`8dbf51513bd628e76144d5c16ce02139caf8246cc4e3490a18e51649bdb24570`.

Native Computer Use reopened only the existing synthetic Qingning conversation;
the current memory tab reports running/healthy, Captured Turns 2, Pending Tokens 0,
Live Tail 3 and Takeover Active. This confirms the managed inspector and owner
metadata route on the real profile. It does NOT prove archival extraction or
cross-Session recall. No new prompt, explicit search, Commit retry or private
content inspection was performed during this post-fix native verification.
The displayed recall metrics contain only two samples (p95 15204 ms), exceeding
the displayed target; this is not performance acceptance or enough evidence to
attribute a cause. Performance and full extraction/recall remain open follow-ups.

Delivery boundary: no commit/push, VPS/database changes, new runtime installation,
team publication or credential changes. The preview's ordinary managed capability
refresh loaded the updated bundled owner; existing user data was retained.

## Rollback and risks

Revert only this scoped patch if needed, without resetting existing WIP. No private
data writes are required by implementation. Do not retry ambiguous user Commit.
Read-only metadata must not create a missing OV Session; late replies after session
replacement or consent loss must not be presented as success.

## Bounded real-model follow-up (2026-09-19)

The user continued the private-memory acceptance workflow. Exact synthetic-session
metadata first established commit_count=0, two captured messages, no extraction,
and a three-Turn retention window. Three short synthetic confirmation Turns were
then sent through the packaged UI, without Tools or file reads. Counts reached
eight captured messages and 221 pending tokens. One explicit GUI Commit archived
the oldest two messages, retaining the recent six under the unchanged policy.

The exact archive has a `.done` marker, two completed long-term message steps,
and a memory diff with two synthetic adds, zero updates and zero deletes. Session
metadata confirms commit_count=1 and memories_extracted.total=2. No ambiguous
Commit was retried. An accepted notification alone was not used as proof.

A new private Session was created through the ordinary new-conversation UI, not
forked or resumed. Its Pi JSONL has no parent Session, one user question containing
the synthetic project name but not the answer, one correct assistant response,
and zero Tool calls. Its OpenViking recall ledger includes both freshly created
synthetic memory URIs. Native AX also shows the correct answer in that new Session.
This passes one real-provider capture/archive/extraction/cross-Session recall case,
not broad production readiness, all memory categories or team acceptance.

The exact new-Session prompt recall took 4281 ms, above the 1500 ms product target.
Functional acceptance is PASS; latency acceptance remains PARTIAL. No latency
cause has been established and no timeout, retention or global policy was weakened.
Redacted local receipt: `artifacts/memory-ui/private-memory-acceptance-2026-09-19.json`.
The two synthetic conversations and two synthetic memory entries remain available
for inspection; no private-data cleanup was performed. No source implementation,
credential, deployment or database changes were needed in this follow-up.
