# Full-repository review follow-ups

Status: open (decisions required before implementation)
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

## Decisions required
1. **Renderer runtime import cycles (2).** `app-store -> connection-state -> {session-creation-recovery,
   projection-recovery -> task-selection -> workbench-controller} -> app-store`. They work only because
   every use is inside a function. Proposal: connection-state receives the store accessors it needs
   (`get`/`set` are already passed to its handlers) instead of the controllers importing `useAppStore`,
   or the controllers move behind an injected port registered by app-store at creation. Then remove the
   entries from `KNOWN_RUNTIME_CYCLES` in eng/quality/check-architecture.mjs. Architecture change.
2. **Approval refused-but-pending (protocol-domain-03, P3).** `ApprovalResolution` cannot express "decision
   refused, request still pending", so a refused path-grant/YOLO decision removes the dialog while the
   tool waits up to 300 s. Proposal: add a `refused` outcome to the approval.respond result carrying the
   still-pending request, and keep the dialog with an inline reason. Protocol change.
3. **Dead `approvalMode` wire field (protocol-domain-04).** Validated in four command payloads but never
   read; `guided`/`ask` only normalize to AUTO. Proposal: stop sending it and accept-and-ignore for one
   protocol revision, then remove. Protocol change; docs already corrected.
4. **Protocol revision coverage (protocol-domain-05).** Revision material omits the context-scope,
   event-context and replay-safe tables that gate envelope acceptance. Proposal: include them so a
   scope or replay-safety change moves PROTOCOL_REVISION.
5. **commerce-growth-os `sync_helper`.** packages/pi-workspace-resources/shared-skill-packs.json names
   `scripts/pi67-sync-commerce-skill-pack.sh`, which does not exist here; the pack comes from its own
   first-party repository. Decide: remove the field or point to the helper in that repository.
6. **Persisted-state IPC codecs.** Workbench layout, composer draft and workspace file state are validated
   by versioned codecs in apps/desktop (~800 lines). Moving them into packages/protocol would pull
   persistence migration into the runtime-neutral protocol package. Decide whether to keep Main
   ownership (current) or extract a shared persisted-state schema package.

## Needs real-device evidence
- macOS title bar fix (54ba0fa) in the packaged app while switching system appearance.
- Packaged team-session probe (a7d03f2): run `node eng/packaging/probe-packaged-team-session.mjs`
  with a live directory; the rewrite is source-verified only.
- Windows real-user probes: Provider failure now detected via `provider-configuration-error`.

## Deferred with reasons (valid, lower priority)
- test-02: packaged Python team worker tests (account/asset filtering) run in no script or workflow;
  needs a Python toolchain step in CI.
- protocol-domain-06: domain unions duplicated as protocol literal unions without a parity test.
- routing-01: `prompt.steer`/`prompt.followUp` commands have no producer and bypass admission/receipts;
  remove or route through operation admission.
- ui-bridge-01: extension UI `resolve()` does not check the answer against the pending request kind.
- attachments-01: 128 claimed attachment sets per Task are never released before Task disposal.
- ov-shared-07: shared-knowledge tool list in sync.ts misses viking_team_search/read.
- ov-dead-08: unused OpenViking write/read client surfaces, including removed Resource ingestion.
- renderer-core-08: FileEditor focus fix does not cover the language-load failure path.
- settings-04: react-aria focus restoration overrides "navigation starts at the page heading".
- settings-05: ProviderConfigurationFiles duplicates SettingsDetails force-open logic.
- settings-06: group-label search lives inline in SettingsWorkbench without tests.
- settings-07: layout spec tests 1440/1040/720; the 721-900px band is untested.
- e2e-01: electron-shell-provider writes auth/settings into the shared CI agent profile.
- ps-01: PowerShell syntax gate skips implicit-pwsh Windows steps.

## Rollback
Each landed fix is an independent commit; revert individually. Protocol revision regenerates from
source (`corepack pnpm --filter @pi67/protocol run generate:revision`).

## Progress
- 2026-09-28: plan recorded after landing the accepted fixes; decisions 1-6 pending.
