# Support diagnostics v6 and operator read path

Status: completed for the authorized local delivery boundary
Owner: Codex
Started: 2026-08-30
Last updated: 2026-08-30

## Goal

Make an explicitly uploaded Pi-67 support report self-contained enough to
reconstruct common first-party failure chains without prompts, source bodies,
paths, raw payloads, logs, or stack traces. Add a local, exact-key, read-only R2
operator command so routine diagnosis does not depend on the Cloudflare UI.

## Non-goals

- Do not add background telemetry, automatic upload, an outbox, raw stderr,
  stack traces, Provider bodies, Session JSONL bodies, Prompt text, source text,
  paths, credentials, or arbitrary user prose.
- Do not create a second Pi event loop, Session truth, crash reporter, logging
  platform, R2 browser, bucket inventory tool, or generic remote storage client.
- Do not deploy the Support Worker, publish an application Candidate, change the
  R2 update manifest, push, tag, or release in this delivery boundary.

## Acceptance criteria

- A bounded diagnostic can correlate a recent first-party action, Renderer
  connection transition, Agent Host response/event failure, Host lifecycle, and
  fixed protocol command identity through opaque launch-local sequence numbers.
- Host-side transport incidents survive MessagePort replacement inside the same
  Host epoch and are available to the next successful `diagnostics.collect`.
- Every event field is a strict enum, bounded number, fixed command name, or
  classified error; no raw error message, request ID, Task/Session/asset ID,
  path, payload, stdout/stderr, or stack crosses the support boundary.
- The v6 document remains below the existing 64 KiB submission boundary, keeps
  explicit one-shot upload and 30-day retention, and preserves v5 ingest during
  rolling compatibility.
- The operator command accepts an exact report ID plus UTC date/receipt locator,
  performs no default bucket listing, downloads at most one 64 KiB object,
  validates schema and hashes, and prints a bounded evidence-backed diagnosis.
- Operator credentials use a bucket-scoped Cloudflare R2 `Object Read only`
  token from a repository-external 0600 file; token values never enter Git,
  logs, diagnostics, tests, plans, or output.
- The Settings receipt exposes enough locator metadata for an exact object key
  without changing the compact support-row interaction family.

## Delivery boundary

- Local implementation: authorized.
- Repository-external read-only operator credential: authorized, bucket-scoped
  to `pi67-support-diagnostics`; never print or commit its values.
- Exact read of a user-supplied Support report: authorized after local reader
  validation; no listing, write, delete, lifecycle, or Worker operation.
- Scoped local commit together with the restored-image root-cause repair:
  authorized.
- Push: not authorized.
- Support Worker deployment: not authorized in this boundary.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Alpha.38 report `PI67-ED5F32C10DBC` proved one live Host with 192 Port handoffs and 191 Renderer `port-closed` teardowns, but did not include the Host's `response-post-failed`, `asset.read`, or `DataCloneError` cause. | exact private report identity and current v5 schema | 2026-08-30 |
| OBSERVED | `HostConnectionContext` already observes response type and safe error class, but sends them only to debug stderr and retires the Port. | `apps/agent-host/src/connection-context.ts` | 2026-08-30 |
| OBSERVED | v5 uploads a fixed Main-composed snapshot with aggregate Renderer counters; no recent-action or causal-event sequence exists. | support/protocol contracts | 2026-08-30 |
| OBSERVED | Support objects use `diagnostics/YYYY/MM/DD/PI67-*.json`; the upload receipt already contains `reportId`, `receivedAt`, size, and SHA-256, while the UI copies only the ID. | Support Worker and Settings source | 2026-08-30 |
| VERIFIED | Cloudflare R2 supports bucket-scoped S3 `Object Read only`; exact `GetObject` is Class B while `ListObjects` is Class A. | official Cloudflare R2 auth and pricing docs, checked 2026-08-30 | 2026-08-30 |

## Affected boundaries

- Modules/processes: Renderer first-party action/connection state; Agent Host
  connection and runtime diagnostics; Protocol/support contracts; Electron Main
  support composition; Support Worker compatibility; Settings receipt; `eng/`
  operator tooling; project governance and product/design contracts.
- Protocol or persisted state: `pi67-support-diagnostics.v6`; v5 remains accepted
  for already distributed clients. Recent evidence is launch-local, in-memory,
  bounded, and never becomes Pi JSONL or durable Desktop state.
- Platform/artifact: cross-platform source; macOS arm64 packaged verification is
  local evidence only; Windows x64 Candidate/manual acceptance remains separate.
- Security/privacy: strict allowlists, no raw bodies/messages/IDs/paths, maximum
  event count and byte size, one-shot upload, private bucket, read-only operator.
- Existing WIP: the uncommitted restored-image Port fix and its plan belong to
  the same incident chain and must remain intact; no unrelated user WIP observed.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Record bounded structured causal evidence, not raw logs. | The missing data is safe event identity and ordering, not user content. | A concrete failure cannot be distinguished without a separately reviewed field. |
| Keep at most 16 recent actions and 32 recent incidents per launch, with truncation counters. | Bounds memory/document size while retaining short causal chains and reconnect storms. | Measured real incidents require a smaller bound for 64 KiB or a larger bound within the same privacy/cost gate. |
| Use launch-local integer sequences for correlation. | IDs and paths are unnecessary; a monotonic number correlates layers without durable identity. | Cross-process evidence proves a different bounded opaque correlation is necessary. |
| Preserve Host transport incidents above the Port context. | The failing Port cannot report its own cause later; the next Port must retrieve it. | Main receives an equally private and more reliable out-of-band incident contract. |
| Accept v5 and v6 in the Worker source during rollout. | Alpha.38 remains deployed while Alpha.39 is tested. | Every v5 client is withdrawn after retention and compatibility evidence. |
| Require exact date/locator and `GetObject`; do not list by default. | One Class B read is cheaper, narrower, and more private than bucket enumeration. | An authenticated server-side exact report lookup is introduced with equivalent cost and scope. |
| Keep credentials outside Git and keep only names/commands in AGENTS. | Instructions are shareable; secrets are not. | A reviewed OS secret-store integration replaces the 0600 operator file. |

## Checkpoints

- [x] 1. Audit v5 composition, Host/Renderer evidence loss, Support object key,
  current dirty worktree, Cloudflare read permissions, and operation classes.
- [x] 2. Implement and test the general bounded causality model across Renderer,
  Agent Host, Protocol, Main composition, and v5/v6 Support validation.
- [x] 3. Implement and test exact-key read-only R2 retrieval, bounded analysis,
  repository-external credential loading, receipt locator UI, and AGENTS/docs.
- [x] 4. Run affected typechecks/tests, aggregate source gate, Renderer runtime,
  final macOS unsigned package/smoke, privacy/size checks, and Git scope audit.
- [x] 5. Record Worker deployment, Windows Candidate, R2 publication, and target
  Windows acceptance as not completed unless separately authorized and observed.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `git diff --check`; affected package typechecks | strict contracts and no overlap damage | PASS: clean diff check; affected typechecks passed; protocol revision generated as `1d24dfdbfe6ce5f89a25a787137f9d623edea3ec76682bf427301190e2192991` |
| Tests | targeted support/connection/operator tests, then `corepack pnpm run check` | privacy negatives, v5/v6 compatibility, bounded size, causal rule, exact GET/no LIST | PASS: focused suites passed; aggregate gate passed 617 files, 3212 passed, 3 skipped; architecture 861 modules/3222 imports/0 cycles |
| Renderer | support Settings E2E and local runtime | locator feedback, pending/error/repeat compatibility | PASS: Playwright support diagnostics plus responsive Settings, 5/5 |
| Runtime/host | simulated Host response failure followed by diagnostics on a replacement Port | prior incident remains correlated without raw values | PASS: `connection-context-diagnostics.test.ts` proves retained safe cause and excludes raw message/private IDs |
| Operator CLI | root command startup plus repository-external credential load without a locator | real Node package resolution, strict 0600/ownership/key validation, no R2 request | PASS: CLI reached its fail-closed usage boundary; credential loader accepted the exact three keys with lengths 32/32/64; directory 0700 and file 0600 |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | final Alpha.39 source packages, smokes, launches | PASS: darwin/arm64 package and smoke, projected image warm/cold Restore Task, real Host roundtrip, launched repository app; `app.asar` SHA-256 `65b456718c3223f9c67aa0dbbb8b992b304d88c866c2d99ee7406a0114833903` |
| Target OS/manual | exact Windows x64 Candidate and real incident upload/read | causal report and stable UI on Windows | NOT COMPLETED |

## Rollback

Revert v6 production selection to v5 while keeping the Worker source able to
validate both. Remove the bounded in-memory recorders and operator command
without touching Pi JSONL, Desktop persistence, existing v5 objects, R2
lifecycle, or update publication. Revoke the read-only token and delete only the
repository-external operator secret file; no product credential is affected.

## Risks and unknowns

- The 64 KiB cap must be tested against worst-case allowed v6 arrays, not only a
  typical fixture.
- Agent Host and Renderer clocks can differ slightly; ordering authority should
  be per-layer sequence plus bounded wall time, not timestamp alone.
- The original Alpha.38 report cannot gain fields retroactively; the new reader
  must still summarize v5 and label missing causal evidence.
- A local source test cannot prove the undeployed Worker accepts v6 or that a
  Windows package emits it; those remain explicit external/runtime gates.

## Progress log

- 2026-08-30: User explicitly authorized a general diagnostic improvement and
  local read-only operator path. Read-only audit found causal evidence loss at
  the Host Port boundary and no current local Support R2 credentials or reader.
- 2026-08-30: Added strict v6 causal evidence rings in Renderer and Agent Host,
  Host evidence retention across Port replacement, v5/v6 rolling validation,
  protocol revision binding, exact receipt locator copy, and a single-GetObject
  operator reader with bounded local analysis.
- 2026-08-30: Aggregate source gate and five Renderer E2E cases passed. The first
  packaged preview found a stale v5-only smoke assertion; the v6 report itself
  was valid. The assertion was updated to preserve truthful absent-Host evidence
  while disconnected, and both the targeted smoke and full unsigned preview then
  passed.
- 2026-08-30: Created one permanent `Object Read only` Cloudflare R2 credential
  scoped to `pi67-support-diagnostics`, saved its exact three values outside Git
  at `~/.config/pi67/support-r2-read.env`, and verified owner-only mode without
  printing values. No R2 object request, list, write, or delete ran.
- 2026-08-30: Root CLI testing exposed a missing workspace dependency that unit
  resolution had masked. Added the explicit root `@pi67/support-contract`
  workspace dependency and lock entry; frozen offline install and true CLI
  startup now pass without contacting R2.
- 2026-08-30: Upgraded all ten workspace manifests to Alpha.39. Final focused
  tests passed 14 files/70 tests; the aggregate gate passed 617 files, 3,212
  tests with 3 skipped; the final Alpha.39 macOS unsigned preview passed.

## Closeout

- Working-tree base SHA: `69ba79667d8c030be1c76af09ebe75c9d66cbe1b`;
  the scoped Alpha.39 commit is recorded by Git after this plan snapshot.
- Changed files: bounded evidence domain/support/protocol contracts; Agent Host
  and Renderer recorders; Main composition; Worker rolling source; Settings
  locator UI; exact R2 reader; tests, package smoke, product/design/governance.
- Validation completed: affected typechecks and focused suites, aggregate source
  gate, privacy/size/compatibility/operator tests, Renderer E2E, macOS arm64
  unsigned packaging/smoke/open, and final Git scope/diff audit.
- Validation not completed: real exact R2 report read with the new credential,
  Support Worker deployment/live v6 ingest, Windows x64 Candidate/manual
  acceptance, and R2 application publication.
- Remaining risks: live ingest must be separately deployed and verified before a
  v6 application Candidate is distributed; Windows behavior remains unverified;
  the credential and CLI are locally validated but live exact-object retrieval
  remains intentionally unexercised in this boundary.
- Push/deploy/release state: not authorized and not performed
