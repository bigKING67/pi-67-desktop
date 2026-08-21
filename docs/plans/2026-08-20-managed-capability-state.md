# Managed capability updates and verification receipts

Status: active
Owner: Codex root agent
Started: 2026-08-20
Last updated: 2026-08-21

## Goal

Make managed Lark CLI updates independently recoverable from official Skills
synchronization, and preserve truthful browser67 and skill-suite verification
results across Desktop upgrades without confusing historical verification with
the current process's live readiness.

## Non-goals

- Do not change Pi JSONL, Provider, session, or task runtime contracts.
- Do not relax browser67 live identity checks or claim a stale connection is ready.
- Do not commit, push, build a Windows candidate, upload, tag, or publish.
- Do not overwrite user-managed Scoop, npm, or other external Lark CLI installs.

## Acceptance criteria

- A verified Lark CLI update is activated even when official Skills synchronization
  fails; the failure remains visible and can be retried without downloading the CLI
  again.
- The update UI distinguishes CLI download/validation/activation from official
  Skills synchronization and reports partial success truthfully.
- A successful browser67 verification and skill-suite update check is retained in
  stable user state, keyed to the relevant installed/source identity rather than the
  Desktop application version.
- Restart or Desktop upgrade shows a prior valid receipt while a bounded live refresh
  runs; it does not regress to "尚未检查" solely because the renderer or app restarted.
- Relevant identity drift invalidates the receipt and fails closed.
- Targeted regression tests cover partial Lark success, receipt reuse, drift
  invalidation, and current-process browser readiness.

## Delivery boundary

- Local implementation: authorized
- Commit: not authorized
- Push: not authorized
- Candidate build/upload: not authorized
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Windows Alpha.29 waits and then reports that Lark CLI verified but official global Skills could not install; displayed CLI remains 1.0.57 | user screenshot and report | 2026-08-20 |
| OBSERVED | browser67 and other skill checks previously completed on Windows return to unverified/not-checked after Desktop update | user report | 2026-08-20 |
| OBSERVED | the managed Lark update currently performs global Skills installation before activating the staged CLI | `apps/agent-host/src/lark-cli-installation.ts` | 2026-08-20 |
| OBSERVED | browser67 persisted connection is intentionally downgraded to reload-required/degraded when the current process has not live-verified identity | `apps/desktop/src/desktop-capability-service.ts` | 2026-08-20 |

## Affected boundaries

- Modules/processes: Agent Host managed update, Desktop capability service, Domain
  status contracts, Renderer settings controllers and dialogs.
- Protocol or persisted state: managed skill update result and identity-bound
  verification receipts.
- Platform/artifact: Windows x64 is the reported failure; macOS arm64 regression must
  remain clean. No candidate artifact is authorized in this plan.
- Security/privacy: persist only timestamps, versions, identities, hashes, and status;
  never persist credentials, prompts, or raw tool payloads.
- Existing WIP: this work is part of the preserved dirty root checkout; no unrelated WIP was
  reverted or staged.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Activate a validated managed CLI before optional Skills synchronization | A secondary package sync must not roll back a valid primary runtime update | upstream Lark CLI proves activation without synchronized Skills is unsafe |
| Model partial success explicitly rather than swallowing it | users need a truthful recovery action and should not repeat downloads | protocol cannot carry a structured result without incompatible migration |
| Key receipts to effective capability/source identity, not Desktop version | unchanged installed content remains the same verification subject across app upgrades | security review requires every app build to invalidate a specific receipt class |
| Separate durable verification from current-process live readiness | historical integrity can persist, but a browser connection must be verified in the current process | no live identity boundary exists for the capability |

## Checkpoints

- [x] 1. Trace and reproduce the exact Lark Skills failure boundary and current status
  propagation from Agent Host to Renderer.
- [x] 2. Implement and test primary CLI activation with independently retryable Skills
  synchronization.
- [x] 3. Implement and test stable fingerprinted receipts for browser67 and skill-suite
  update checks with drift invalidation.
- [x] 4. Update visible status copy and design/product contracts for never-checked,
  refreshing, prior-verified, partial-success, and failed states.
- [x] 5. Pass the available source, test, build, and exact macOS packaged gates; retain real
  Windows x64 retest as an explicit external acceptance boundary.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | targeted TypeScript review and protocol schema checks | explicit state ownership and identity key | passed; version/source fingerprints and partial-success states are carried through Domain, Protocol, Agent Host, Desktop, and Renderer boundaries |
| Tests | targeted Vitest suites plus full repository coverage/E2E | new regression cases pass without weakening existing contracts | passed; changed managed-capability suites are included in Vitest coverage 581 files/2,998 passed plus 3 skipped, and the final Chromium E2E rerun passed 198/198 |
| Runtime/host | local managed-state and browser capability service reconstruction | persisted receipt survives service reconstruction; identity drift invalidates; live browser readiness remains current-process evidence | passed in service/controller regressions; no Windows installed-runtime inference |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` followed by exact-artifact smoke retry | exact local macOS arm64 package opens and smoke passes | passed after one transient launch timeout and a same-artifact retry; `app.asar` size 183,437,896 and SHA-256 `e6f748fc4e466fde09db1c594232fed334d614f475acfbee7d3e5ded22efdcfd` |
| Target OS/manual | real Windows x64 install/update | user verifies CLI/Skills update and browser67 state | pending; not locally available |

## Rollback

Revert the scoped protocol, persistence, host, desktop, and renderer files. Receipt
readers must treat absent or malformed new state as no receipt, so rollback does not
require destructive migration. Existing managed CLI and skill directories remain
untouched unless a separately validated activation succeeds.

## Risks and unknowns

- The official Skills installer may have a Windows-specific download or subprocess
  issue that hosted smoke did not exercise.
- A current-process browser bridge can be offline even when the installed extension
  identity is unchanged; UI must not conflate these states.
- Persisted update-check results need a bounded freshness policy so old network data is
  not presented as current indefinitely.
- The managed-capability refactors now pass the repository structure gate; this removes the
  previous source-structure blocker but does not replace real Windows acceptance evidence.

## Progress log

- 2026-08-20: Confirmed clean `main`, captured the two user-visible regressions, and
  established the split-update and fingerprinted-receipt direction.
- 2026-08-21: Reordered Lark activation so a staged, exact-version validated CLI becomes the
  managed current-user copy before official Skills synchronization. Skills failure is now a
  visible partial success with an independent retry path rather than a reason to discard or
  redownload the verified CLI.
- 2026-08-21: Added version/source-fingerprinted check receipts for managed skill suites and
  browser67. Receipts survive Desktop upgrades when installed identity is unchanged, drift
  invalidates them, and browser67 still requires current-process live identity convergence
  before reporting ready.
- 2026-08-21: Updated Renderer states and PRODUCT/DESIGN contracts for refreshing,
  prior-verified, partial-success, failed, and reload-required behavior. Completed full Vitest
  and Chromium E2E gates plus exact macOS packaged smoke; real Windows retest remains pending.
- 2026-08-21: Re-ran the complete source gate after the updater, receipt, and Task-reopen
  hardening. All checks passed, including the 1,772-file structure policy, 581 Vitest files with
  2,998 passing tests and 3 skipped, and an architecture scan of 796 modules with zero cycles.

## Closeout

- Base source SHA: `96d2078c4bc5ab6a7301f6733db43375e4afe061`; changes remain uncommitted
- Changed files: managed Lark activation/installation, managed skill receipts, Desktop capability
  persistence, Domain/Protocol contracts, Renderer settings/controllers, tests, PRODUCT/DESIGN,
  and this execution plan
- Validation completed: targeted regressions, full Vitest coverage, full Chromium E2E, typecheck,
  lint, build, architecture/transport/dependency/dead-code/protocol checks, and exact macOS packaged
  smoke retry
- Validation not completed: real Windows x64 manual retest
- Remaining risks: Windows-specific official Skills subprocess behavior, live browser extension
  convergence on the installed Windows candidate, and receipt freshness
- Commit/push/release state: not authorized
