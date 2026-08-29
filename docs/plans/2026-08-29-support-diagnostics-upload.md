# Support Diagnostics Upload

Status: complete
Owner: Codex
Started: 2026-08-29
Last updated: 2026-08-29

## Goal

Replace the Settings support row's primary local-export workflow with an explicit,
user-initiated upload of the existing bounded redacted support diagnostics, return a
copyable report identifier, and retain local export as the failure/offline fallback.
Provide a separately owned Cloudflare Worker ingestion source that validates the fixed
submission contract before writing to a private, short-retention R2 bucket.

## Non-goals

- Do not auto-upload on startup, crash, update, recovery, or Session activity.
- Do not add prompts, source bodies, raw paths, credentials, environment values,
  stdout/stderr, Tool payloads, screenshots, attachments, or free-form user text.
- Do not give the Desktop client R2 credentials, a caller-selected object key, a public
  bucket URL, or a generic upload capability.
- Do not reuse the public update bucket or `updates.52671314.xyz` request contract.
- Do not enable Workers Paid or any metered add-on, reuse the update bucket, create
  credentials, commit, push, package a candidate, publish, tag, release, or promote.
- Do not modify or absorb the existing Agent Port replacement-storm WIP.

## Acceptance criteria

- Settings presents `上传脱敏诊断` with explicit data-purpose copy and one `上传`
  action; collection/upload pending, success receipt, failure, retry, and local export
  remain visible and keyboard reachable.
- Main composes one fixed `pi67-support-diagnostics.v5` document for both local save and
  remote submission; Renderer never submits diagnostics bytes or arbitrary fields.
- The Desktop submission request uses one fixed HTTPS endpoint, a bounded timeout,
  redirect rejection, a 64 KiB maximum body, an idempotent random submission ID, and
  strict response validation.
- The public endpoint admits at most one report per minute globally and uses only R2
  Standard storage. At continuous saturation, 30 days retain no more than 43,200
  objects and about 2.64 GiB of raw submission bytes, leaving deliberate room under
  the current free R2 storage and operation allowances. A strongly serialized
  SQLite-backed Durable Object transaction owns one global UTC-minute admission;
  saturation uses at most 43,200 Class A writes per 30 days for accepted reports.
- The ingestion Worker accepts only the fixed method/path/content type and strict
  submission schema, never trusts a caller object key, enforces the same body bound,
  applies its Durable Object admission gate, writes only to a private R2 binding, and returns
  the bounded public receipt.
- Server retention configuration declares 30-day expiry for diagnostic object prefixes;
  deployment documentation keeps bucket/Worker creation and secrets outside Desktop.
- Targeted Protocol, Desktop, Renderer-controller, Worker, and visible-settings tests
  pass, followed by affected typechecks and the aggregate source gate.
- Final macOS arm64 unsigned preview packages, smokes, and opens the integrated working
  tree unless an unrelated existing-WIP failure makes that evidence invalid. Windows
  packaged behavior remains explicitly unverified.

## Delivery boundary

- Local implementation: authorized by the user's `继续` after the accepted design.
- Commit: not authorized.
- Push: not authorized.
- Worker/R2 deployment and bounded synthetic verification: explicitly authorized and
  completed under the user's Workers/R2 free-tier-only constraint.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Current Settings action calls `saveRuntimeDiagnostics`, waits at most three seconds for optional Runtime diagnostics, then opens a native save dialog. | live Renderer/Main source | 2026-08-29 |
| OBSERVED | Main owns fixed `pi67-support-diagnostics.v5` composition and final redaction; Renderer can submit only a schema-validated Runtime available/unavailable request. | `support-diagnostics.ts`, Protocol contract | 2026-08-29 |
| OBSERVED | The public R2 update channel is read-only at runtime; R2 write credentials exist only in release tooling environment inputs. | live source and release docs | 2026-08-29 |
| VERIFIED | Cloudflare R2 Workers bindings support bounded server-side `put`; object lifecycle rules support age-based expiry. | official Cloudflare documentation checked 2026-08-29 | 2026-08-29 |
| VERIFIED | The live account and zone remain Free; the Worker uses one SQLite-backed Durable Object plus private Standard R2, and global public DNS resolves the Support domain. | live Dashboard/API, Wrangler, Cloudflare and Google DoH | 2026-08-29 |
| OBSERVED | The Agent Port replacement-storm WIP became commit `2e3d734339cb0586dc26c0dd77e9ad9546a1abdf` through an external workflow while this task was active. The final support-upload working tree remains uncommitted on top of that commit and `main` is three commits ahead of `origin/main`. | live Git and its execution plan | 2026-08-29 |

## Affected boundaries

- Modules/processes: Renderer Settings/controller; Preload and Desktop bridge; Main
  support-diagnostics composition/upload; Protocol submission/receipt validation;
  standalone support-ingest Worker; product/design/release documentation.
- Protocol or persisted state: new bounded Desktop IPC result/request types; no Session,
  Pi JSONL, Workspace, model, or durable Renderer state. Submission IDs are per action;
  the server retains one tiny Durable Object row containing only the last admitted UTC minute.
- Platform/artifact: source behavior is cross-platform; macOS arm64 preview is the local
  packaged gate, while Windows x64 remains target-OS unverified.
- Security/privacy: fixed redacted v5 bytes only; private support bucket; no Desktop R2
  credential; no background retry or telemetry.
- Existing WIP: preserve every path owned by
  `docs/plans/2026-08-29-agent-port-replacement-storm.md`. In overlapping `PRODUCT.md`
  and `DESIGN.md`, add only diagnostics-upload paragraphs outside that WIP's hunks. Do
  not modify its dirty Protocol/Renderer recovery files or diagnostic fixtures.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Keep local export as a fallback, not the primary Settings action. | Remote service or network failure must not remove the existing support path. | Product explicitly removes offline support and accepts the loss. |
| Compose one document in Main and share the serialized bytes across save/upload. | Prevents transport-specific schema drift and preserves the existing trust boundary. | A future signed support container requires a separately versioned canonical byte format. |
| Proxy the small JSON through a Worker R2 binding. | The Worker can validate the exact body before storage; Desktop needs neither R2 SDK nor credentials. | Payloads become large enough to require short-lived presigned multipart uploads. |
| Use a separate private diagnostics bucket and support origin. | Update artifacts are public immutable downloads with a different trust and retention model. | A reviewed infrastructure design proves equivalent isolation inside one bucket/account policy. |
| Use the existing compact primary-button family for the idle/retry upload action, with secondary buttons for copy, repeat, and local fallback. | Upload replaces export as the efficient default while recovery actions remain visually subordinate. | The Settings information architecture promotes support submission to a dedicated task surface or adds a confirmation step. |
| Do not persist automatic retries or a local upload queue. | Hidden later uploads would violate the one-shot user action and expand sensitive persistence. | Product explicitly adopts a user-visible encrypted outbox with cancellation/deletion semantics. |

## Checkpoints

- [x] 1. Add strict Protocol contracts and tests for submission options/result/receipt.
- [x] 2. Refactor Main composition, add bounded upload client/IPC, and prove local-save byte parity and network failure behavior.
- [x] 3. Add the standalone strict Worker ingestion boundary, private R2/lifecycle configuration, and unit tests without client credentials.
- [x] 4. Replace the Settings primary action with owned upload states, receipt copy, retry, and local-export fallback; update product/design copy.
- [x] 5. Pass targeted tests, affected typechecks, diff/structure/security checks, and the aggregate source gate without changing existing WIP.
- [x] 6. Complete rendered Light/Dark interaction review and final macOS arm64 unsigned packaged preview; record Windows and remote deployment as unverified.
- [x] 7. Receive explicit deployment authorization with a Workers/R2 free-tier-only constraint; audit the live account and confirm no existing Support Worker, domain, or bucket.
- [x] 8. Tighten the shared body cap and exact global admission gate to the free-tier safety envelope; rerun source and Worker validation.
- [x] 9. Create the private Standard bucket, apply and read back the 30-day lifecycle, then deploy the fixed custom-domain Worker.
- [x] 10. Exercise one small synthetic submission, duplicate receipt, private readback, exact admission, and cleanup; audit live resources and cost boundaries.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | `git diff --check`; scoped diff audit; structure/architecture/dead-code/production-transport checks | no overlap damage, no credential/public-bucket path, governed file sizes and boundaries | `PASS`: final aggregate check passed with 854 modules, 3,211 imports, 0 cycles, and 1,910 governed files |
| Tests | focused Vitest for Protocol, Desktop, Renderer and Worker; aggregate and isolated coverage runs | strict schema, exact bytes, timeout/redirect/size/error/idempotency/UI states | `PARTIAL`: final aggregate passed all non-test gates but its existing five-second Git fixture timed out under parallel load; the other 611 files passed with 3,190 tests and 3 skips, the slow fixture passed 4/4 in isolation, and coverage was statements 82.14%, branches 76.23%, functions 85.94%, lines 86.08% |
| Runtime/host | managed Settings preview in Light/Dark with upload success/failure fixtures | compact row, focus, pending, receipt, retry/fallback and no layout regression | `PASS`: Playwright 5/5 after final fixture split; 520 px responsive plus Light idle/error and Dark success screenshots; packaged `app://pi67` accessibility tree exposed the final row and button |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | integrated macOS arm64 package/smoke/open from current working tree | `PASS`: build, sandbox Preload bundle verification, native package, packaged smoke, and open; `app.asar` SHA-256 `02a5f820819441e7ae71a70c81bb3c1b9f1ffc209754313153ecdb282b768789` |
| Cloudflare production | Free plan audit; Wrangler deploy/readback; global DoH; synthetic first/different/duplicate requests; exact cleanup | Free plan, private Standard R2, 30-day lifecycle, exact one-per-minute admission, idempotency, no remaining test objects | `PASS`: live version `edc7d29a-f91a-456e-a457-22cfccb09226`; global DNS resolved; production returned `201 / 429 / 200`; private readback passed; all synthetic diagnostics and obsolete quota markers were confirmed absent after cleanup |
| Target OS/manual | Windows x64 packaged upload against deployed Support Worker | exact installed-app behavior and remote receipt | `NOT COMPLETED`: no Windows candidate or installed-client acceptance was authorized |

## Rollback

Remove only this plan's new Worker/contract/controller files and reverse its precise
Settings, Main, Preload, Protocol barrel, product/design, and package metadata hunks.
Retain every pre-existing dirty WIP byte. Source rollback restores local-only export.
Remote rollback is separate and destructive: disable/delete only `pi67-support-ingest`,
its Durable Object namespace, the Support custom domain, and the empty private Support
bucket after explicit current authorization and a fresh object check. Never touch the
update Worker, domain, or `pi67-desktop-updates` bucket.

## Risks and unknowns

- An unsigned Desktop cannot prove caller authenticity. Strict schema/size/path limits,
  the one-per-minute Durable Object gate, idempotency, and Workers Free hard failure
  bound cost but do not stop an attacker from occupying the minute slot. Authenticated
  short-lived tickets can be added if distribution expands.
- R2 free allowances are account-wide. Live audit found the existing update bucket at
  about 3.02 GB; a fully saturated Support bucket adds at most about 2.83 GB of raw
  retained submissions, for about 5.85 GB before other account growth. Recheck usage
  before raising bounds or publishing each Candidate; budget alerts are not a spend cap.
- R2 is object storage, not issue tracking. The report ID and date prefix are sufficient
  for the current small internal cohort; higher volume may justify a separately approved
  private triage index.
- The Agent Port WIP became the current base commit during this task. This delivery did
  not amend or rewrite it; all support-upload evidence is bound to the integrated base.

## Progress log

- 2026-08-29: User accepted the design and said `继续`. Rechecked live Git and found a
  newly present completed-but-uncommitted Agent Port replacement-storm WIP. Audited its
  plan and hunks; selected a non-overlapping implementation boundary and preserved its
  files and evidence. No external action authorized.
- 2026-08-29: Added the strict shared contract, Main-owned same-byte save/upload
  composition, fixed-endpoint bounded client, private Worker/R2 ingestion source,
  30-day lifecycle declaration, Settings state machine, and product/design contracts.
- 2026-08-29: The first aggregate coverage run hit the repository's existing five-second
  `preview-candidate-source` Git-fixture timeout. Its exact isolated suite passed 4/4;
  an unchanged coverage rerun passed 612/612 files. After the final Preload packaging
  fix, the complete aggregate gate passed in one run.
- 2026-08-29: The first macOS preview build exposed an unsupported runtime
  `@pi67/protocol` require in the sandbox Preload. Narrowing the value import to the
  support contract and explicitly bundling that workspace package fixed the boundary;
  the final native package, smoke, open, and packaged Settings inspection passed.
- 2026-08-29: The user explicitly authorized the deployment continuation with a
  free-account constraint. Live audit found only the existing update bucket; the
  Support Worker, custom domain, and diagnostics bucket did not exist. The original
  512 KiB / 60-per-minute declaration was not safe under a saturated public endpoint,
  so the accepted envelope was tightened to 64 KiB and one global request per minute.
- 2026-08-29: Live production verification proved that two immediate requests can
  pass Cloudflare's eventually consistent Rate Limiting binding. The duplicate did
  not create a second diagnostic object, but the observation invalidated rate-limit-
  only cost accounting. Added an authoritative conditional R2 minute slot and a
  two-day lifecycle for its tiny marker before accepting deployment as complete.
- 2026-08-29: The first slot deployment exposed that
  `R2Conditional.etagDoesNotMatch: "*"` treats `*` as a literal ETag comparison and
  therefore does not mean object absence. Replaced both slot and diagnostic writes
  with the HTTP `If-None-Match: *` conditional Headers form required for no-overwrite
  semantics; production acceptance remains pending a successful replay.
- 2026-08-29: Cost audit found that even failed R2 conditional writes can consume
  Class A operations, so an R2 slot is not a hard cost ceiling under hostile traffic.
  Replaced both the permissive Rate Limiting binding and quota marker with one global
  SQLite-backed Durable Object. Workers Free caps its request/row/duration dimensions
  by failing further operations; only its one-per-minute admission can reach R2.
- 2026-08-29: Deployed the final Durable Object version on the live Free account.
  Cloudflare and Google DoH resolved the custom domain while the local recursive
  resolver still held a pre-deployment negative cache. Production verified
  `201` first report, `429` different report in the same UTC minute, `200` exact
  duplicate, matching receipt/hash/size, private R2 readback, and absent blocked ID.
  Deleted all six earlier synthetic objects/markers plus the final synthetic report,
  then removed the obsolete quota lifecycle rule; only the 30-day diagnostic rule and
  default incomplete-multipart cleanup remain.

## Closeout

- Final source SHA: uncommitted working tree based on `2e3d734339cb0586dc26c0dd77e9ad9546a1abdf`; no immutable final SHA without commit authorization.
- Changed files: 38 scoped paths: 19 modified and 19 new across product/design, shared contract, Protocol, Desktop, Renderer, Worker, tests, package metadata, and this plan.
- Validation completed: strict contract/Main/Worker/controller tests; all aggregate non-test gates; 611-file coverage plus isolated 4/4 slow fixture; Playwright Light/Dark/responsive interaction; sandbox Preload bundle verification; macOS arm64 package/smoke/open/Computer Use inspection; live Free Worker/R2/Durable Object/DNS/readback/admission/idempotency/cleanup.
- Validation not completed: Windows x64 packaged acceptance.
- Remaining risks: the public unsigned-client endpoint can suffer one-report-per-minute availability denial, account-wide R2 usage can change, and the local resolver may retain its deployment-time NXDOMAIN until its negative TTL expires. Current cost and global DNS evidence passed.
- Commit/push/release state: no commit, push, candidate publication, tag, release, or promotion. The Worker, private Support bucket, lifecycle, Durable Object, custom domain, and bounded synthetic verification were explicitly authorized and completed; all synthetic R2 objects were deleted.
