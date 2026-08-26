# t3code mechanism absorption program

Status: completed
Owner: Codex
Started: 2026-08-26
Last updated: 2026-08-26

## Goal

Absorb the highest-value mechanisms from the fixed t3code reference into
Pi-67 Desktop through four independently verifiable batches: bounded
cross-process projections, a Pi-native read-query lifecycle, safe HEIC/HEIF
normalization, and Worktree integrity/recovery. Preserve Pi as the only agent
runtime and Pi JSONL as the conversation source of truth.

## Non-goals

- Do not import Effect, `effect/unstable/reactivity`, Effect RPC, a localhost
  server, a business WebSocket, SQLite Session truth, a multi-Provider agent
  runtime, or a second orchestration loop.
- Do not mirror the unreviewed upstream drift range or treat t3code as a Git
  upstream.
- Do not change the eight-live-Task product contract, Provider/model routing,
  approval policy, or Pi resource precedence.
- Do not replay mutations through a generic query retry mechanism.
- Do not silently fetch Submodules, prompt for credentials, prune Repository-wide
  Worktree state, or recreate a missing Worktree when a Turn starts.
- Do not mix the existing R2 update WIP into this program.
- Do not commit, push, build/upload a candidate, tag, publish, sign, notarize, or
  claim Windows evidence without separate current authorization.

## Acceptance criteria

- Every absorbed mechanism is bound to an immutable t3code commit, mapped to
  Pi-67 target files, classified as adapted or reimplemented, and recorded in
  the existing provenance system before closeout.
- Tool progress text is bounded while it is collected rather than after an
  unbounded aggregate allocation. A synthetic cumulative-update flood proves
  bounded projection size, bounded emission count, terminal-state delivery, and
  no raw payload persistence.
- Session resource projections have explicit item and string budgets plus a
  truthful truncation disposition; exact Pi ResourceLoader state remains
  internal and authoritative.
- A Pi-native read-query lifecycle provides keyed single-flight execution,
  cancellation, stale-result fencing, last-success retention, explicit
  refreshing/unavailable/error states, and one reconnect owner. It pilots only
  Palette and navigation read searches and never owns Session or Operation
  truth.
- HEIC/HEIF inputs are content-identified, decoded within explicit source and
  pixel budgets, normalized to validated JPEG bytes, stripped of metadata, and
  passed through the existing opaque staged-attachment path. Failure preserves
  the draft and remains explicitly retryable or removable.
- Worktree creation uses a measured, cancellable large-checkout budget and
  reports its current stage. Submodule presence and completeness are visible;
  local-only materialization may be automatic, while network/authentication is
  an explicit user action.
- Missing app-owned Worktrees gain a dedicated, preflighted recovery action.
  Manual, foreign, dirty, protected, orphaned, or ambiguous Worktrees remain
  fail-closed and are never repaired implicitly.
- Each batch passes its targeted tests and scope review before the next batch
  starts. User-visible batches pass relevant Renderer E2E and exact macOS arm64
  packaged preview; Windows claims remain pending real Windows x64 evidence.

## Delivery boundary

- Local implementation: authorized for the sequential checkpoints in this plan;
  stop after each batch for evidence review before starting the next batch.
- Commit: not authorized; if later authorized, prefer one scoped commit per
  completed batch rather than one program-wide commit.
- Push: not authorized.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Canonical checkout is `main` at `776615c2a26e`; twelve unrelated product, R2 update, installer, and packaging files are already modified. | live Git status | 2026-08-26 |
| OBSERVED | t3code remote HEAD is `b0a0281269156295e2202d31198829bd3b500bdf`; the reviewed lock remains `949feb61e4bfd96669ba0e8cf3dca7c6d7f885b3`, status is `drifted`, and the MIT license hash is unchanged. Batch B remains bound to fixed mechanism source `504177797676048bf70f64ce56c21949d0b8a018`. | `corepack pnpm run audit:references -- --id t3code --json`; fixed-commit source hashes | 2026-08-26 |
| OBSERVED | Pi-67 throttles Tool progress every 100 ms and projects at most 4,096 characters. | `packages/pi-runtime/src/tool-execution-projector.ts`; `packages/domain/src/tool-execution.ts` | 2026-08-26 |
| OBSERVED | The former `flatMap`/`join` projection reads all cumulative text blocks before the 4,096-character bound; a 10,000-block synthetic comparator read all 10,000 blocks and materialized 50,108,889 characters. | pre-change `packages/pi-runtime/src/tool-execution-projection.ts`; local synthetic comparator | 2026-08-26 |
| OBSERVED | Session resource projection carries metadata rather than Skill content, but its protocol array and metadata strings have no explicit item/string limits before the 2 MiB envelope boundary. | `packages/pi-runtime/src/session-snapshot.ts`; `packages/protocol/src/session-resource-schemas.ts` | 2026-08-26 |
| OBSERVED | Renderer search and inspection reads independently implement owner/revision, cancellation, debounce, fallback, and loading/error state. | Palette/navigation hooks and Repository/Session catalog stores under `apps/renderer/src` | 2026-08-26 |
| OBSERVED | HEIC/HEIF content is now normalized in a bounded Desktop Worker to a structurally validated, metadata-free JPEG before entering the existing opaque staged-attachment contract. The Renderer receives only a one-shot normalization receipt and persists the normalized attachment identity. | `apps/desktop/src/prompt-image-normalization-worker.ts`; `apps/desktop/src/prompt-heic-attachment-normalization.ts`; `apps/renderer/src/composer/composer-attachments.ts` | 2026-08-26 |
| OBSERVED | Three samples each of exact private-Git `worktree add` over synthetic 10k, 50k, and 100k tracked-file repositories took 688-716 ms, 3,486-3,598 ms, and 7,138-7,319 ms. A 375k-file linear projection is about 27 seconds, so the implemented 300-second checkout budget retains about 11x margin. | packaged private Git 2.53.0 synthetic fixture on macOS arm64 | 2026-08-26 |
| OBSERVED | Worktree creation now reports bounded preflight/queue/checkout/Submodule/verification/registration stages, accepts cancellation, and reports completion only after exact rollback is confirmed. Local-only Submodule initialization uses verified common-directory objects with every transport denied except `file`; the user-triggered network action denies `file` and admits only `http`, `https`, `ssh`, and `git`. | `apps/desktop/src/worktree-creation-service.ts`; `apps/desktop/src/worktree-git-runner.ts`; focused real-Git tests | 2026-08-26 |
| OBSERVED | Missing committed app-owned Worktrees expose a dedicated action that checks the exact persisted source, target, branch, Repository identity, and clean registration. It removes only an exact stale target registration, never runs Repository-wide prune, and fails closed for foreign, dirty, ambiguous, or branch-elsewhere state. | `apps/desktop/src/repository-worktree-action-service.ts`; focused recovery fixtures | 2026-08-26 |

### Batch A source binding

Batch A is conceptually adapted from t3code commit
`504177797676048bf70f64ce56c21949d0b8a018` without copying its Effect,
orchestration, persistence, RPC, or client runtime:

- Streaming Tool projection before durable/client fan-out:
  `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`
  (`efb4815aee0e584988755ded36d366ef61aca34b50898bac601ae5bd674d4bc5`),
  `apps/server/src/orchestration/ActivityPayloadProjection.ts`
  (`19aa53d6039519e0871bbec95ce8843d4155fbc60cee3d9bc8d6b37e00bc8bbd`),
  and
  `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.activity.test.ts`
  (`efb3b45a2bf946b1552c903d1a5976f67f36f793a0fbe629379540d1d284cc71`).
  Pi-67 reimplements the projection directly over Pi SDK events and hardens it
  further by bounding text-block collection before joining or sanitization.
- Bounded read before payload decoding/materialization:
  `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
  (`a926a3aad5e7f07acd353fcd8e9f1dc8e101b75a2dde88c22e62fcbc0f472bde`).
  Pi-67 adapts the invariant to metadata-only Pi ResourceLoader projections
  with item, aggregate-text, and per-field limits plus explicit disposition;
  the exact ResourceLoader state remains internal and untruncated.

The Repository reference lock remains at its previously reviewed commit. These
new paths are feature-bound evidence for this plan and do not claim that the
current upstream drift range has been comprehensively reviewed.

### Batch B source binding

Batch B is reimplemented from t3code commit
`504177797676048bf70f64ce56c21949d0b8a018` without copying its Effect, Atom,
RPC, persistence, multi-environment, or orchestration runtimes:

- `apps/web/src/state/query.ts`
  (`7e8091ea2708815bd323a2fcddc1ab55b8fc2f9c9fd5ced618072863005220c0`)
  informed retained-success and explicit pending/error query views.
- `apps/web/src/state/use-atom-query-runner.ts`
  (`94ba841ba9821939a63e4456fcc1f1a0f17cad8fe12066ffdb9786b1a3ea517b`)
  informed a shared subscription/observer runner; Pi-67 uses React
  `useSyncExternalStore` over the existing MessagePort connection.
- `apps/web/src/state/queries.ts`
  (`41801512ad2db04f53f6994539116c11cc222f2508798b930f3b42d69b24738e`)
  informed exact target/query keys, cancellation, and stale-result fencing.
- `apps/web/src/state/queries.test.ts`
  (`5b0884dcefc5d2a8550d18e0b9ead167fc3a7368382b999da0312c7f1760aa70`)
  was reviewed as behavioral test evidence but is not a copied target.

The Pi-67 kernel admits only `session.catalog.query` and
`session.catalog.contentSearch`, retains no authoritative Session state, and
never replays mutations. Connection replacement remains owned by
`connection-state.ts`: initial refresh follows existing Workspace registration,
while recovery refresh waits for its authoritative resync commit.

### Batch C source binding

Batch C is reimplemented from t3code commit
`504177797676048bf70f64ce56c21949d0b8a018` without copying its browser Blob
Worker, `heic-to/csp` bundle, CSP relaxation, or image-compression code:

- `apps/web/src/lib/imageCompression.ts`
  (`dc384032f3ebaa6fc2d7599ae775ba1d3fe186c9db4d6dd49df3ddd62de3f2dc`)
  informed content-first HEIF inspection, the 1 MiB metadata boundary, pixel
  budgeting, and JPEG normalization before attachment use.
- `apps/web/src/lib/imageCompression.test.ts`
  (`3d82a1f3159b5ec18f683230070dcdfb62a20b43ff347a3fe81ed2b4cd683eaa`)
  informed malformed-container, oversized-image, and output-shape fixtures.

Pi-67 instead uses exact `heic-decode@2.1.0` and
`@napi-rs/canvas@1.0.3` dependencies inside a Desktop Node Worker with a
45-second termination budget, 384 MiB old-generation cap, 32 MiB source cap,
50-megapixel/16,384-dimension caps, JPEG quality 90, and structural APP1/APP2/
APP13/COM removal. The production Renderer CSP remains unchanged; Pi, Session,
and attachment identity authority are not duplicated.

### Batch D source binding

Batch D is reimplemented from t3code commit
`504177797676048bf70f64ce56c21949d0b8a018` without copying its silent
best-effort network behavior or implicit turn-time repair:

- `apps/server/src/vcs/GitVcsDriverCore.ts`
  (`6e6faf75bef4bde73988ee40e4aa54a88d55dede190e3d84d5c321c491e731e7`)
  and its test
  (`5e674ba7daff3d7df617c989dc1c8a474583ddbd59f171aadb27fe95c8bd1614`)
  informed the 300-second Worktree add budget and post-checkout Submodule
  completeness stage. Pi-67 adds measured progress, cancellation, exact
  rollback, local-object-only initialization, and a separate explicit network
  action instead of silently attempting recursive network access.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`
  (`3f319cec4693f537655bedc699a5ef71ee1079d44a167c3948e5e482df643242`)
  and its test
  (`7e8478bce4a730502e6a2723f1e6664cdb8fa00906c52802b016584effe0349e`)
  informed the missing-Worktree recovery case. Pi-67 exposes a dedicated
  recovery action over only a committed app-owned receipt, performs exact
  targeted reconciliation, never runs Repository-wide `git worktree prune`,
  and never repairs a Worktree when a Turn starts.

All Batch D provenance entries are classified `reimplemented`. The t3code lock
remains unchanged; these fixed paths do not review or absorb later upstream
drift.

## Affected boundaries

- Modules/processes: Domain and Protocol projection contracts, Pi Runtime Tool
  and Resource projection, Renderer connection/query state and search hooks,
  Desktop attachment staging/decoding, Desktop private Git and Worktree recovery.
- Protocol or persisted state: bounded Resource projection fields may extend the
  protocol; query state remains disposable Renderer state; converted attachment
  bytes use the existing staged manifest; Workbench recovery receipts must remain
  backward-compatible and fail closed.
- Platform/artifact: macOS arm64 and Windows x64; HEIC requires exact packaged
  Electron validation, and Worktree/Submodule claims require packaged private Git
  plus real target-OS evidence.
- Security/privacy: never persist raw Tool payloads, source bodies, full Skill
  content, image metadata, Git output, credentials, or raw Workspace paths in
  diagnostics. Network/authentication and destructive Git actions stay explicit.
- Existing WIP: preserve without editing or staging
  `DESIGN.md`,
  `PRODUCT.md`,
  `apps/desktop/src/unsigned-update-installer.test.ts`,
  `apps/desktop/src/unsigned-update-installer.ts`,
  `docs/plans/2026-08-25-alpha32-r2-release.md`,
  `docs/release/internal-r2-update-distribution.md`,
  `eng/packaging/installer.nsh`,
  `eng/packaging/verify-windows-installer-lifecycle.test.mjs`,
  `eng/release/r2-update-cloudflare-client.mjs`,
  `eng/release/r2-update-cloudflare-client.test.mjs`,
  `eng/release/r2-update-release.mjs`, and
  `eng/release/r2-update-release.test.mjs`.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Use one program plan with four sequential batches and a stop gate after each batch. | The mechanisms share reference governance but have different owners, risks, and validation. | A batch proves independent enough to require its own long-running plan or overlaps conflicting live WIP. |
| Start with bounded projection hardening. | It reduces cross-process and memory risk without introducing product workflow or dependencies. | The synthetic probe disproves the allocation risk and Resource projection is already bounded by an earlier unseen owner. |
| Reimplement query lifecycle with existing TypeScript, Zustand, MessagePort, and `AgentConnectionController`. | Pi-67 needs consistent read-query behavior, not t3code's multi-environment Effect runtime. | Pi-67 independently adopts Effect as a reviewed whole-application substrate or adds multiple remote client environments. |
| Keep Session, Operation, Approval, Tool, Plan, and mutation authority outside the query kernel. | Cache freshness cannot replace Host epoch, physical Session identity, generation, projection revision, or Pi JSONL. | Pi exposes a new authoritative SDK query/runtime seam that subsumes these fences. |
| Normalize HEIC/HEIF to JPEG before the existing staged Prompt boundary. | Providers accept the normalized type while existing opaque attachment identity and limits remain intact. | Pi and every supported model gain a verified native HEIC contract with equivalent privacy and resource bounds. |
| Decode HEIC in a bounded Desktop Node Worker and keep the Renderer CSP unchanged. | The reviewed browser reference relies on a Blob Worker and a CSP-specific decoder bundle; Pi-67 can isolate synchronous decode work without granting `worker-src blob:` or exposing source bytes to the Renderer. | A reviewed decoder provides equivalent cancellation, memory, metadata, packaging, and platform guarantees with a smaller dependency/license surface. |
| Model Submodule checkout as explicit completeness, not hidden best-effort work. | Recursive update can require network, authentication, and long-running external effects. | Product policy explicitly grants bounded Submodule fetch as part of an exact Worktree-create action. |
| Add explicit missing-Worktree recovery and reject turn-time implicit repair. | This preserves the established visible-state and user-controlled recovery contract. | The user explicitly changes that product decision after a new security and data-loss review. |
| Do not refresh the t3code lock mid-batch. | A fixed source commit keeps review and provenance reproducible. | A blocking upstream correction is identified and separately reviewed before implementation continues. |

## Checkpoints

- [x] 0. Accept this plan, confirm the protected dirty scope, and bind each source
  mechanism to exact t3code paths/commits without modifying the reference lock.
- [x] 1. Batch A: reproduce or disprove cumulative Tool projection allocation;
  implement collection-time bounds, terminal flush guarantees, and synthetic
  flood tests without changing Tool Result authority.
- [x] 2. Batch A: add bounded Session Resource catalog projection, deterministic
  truncation metadata, protocol tests, resync/reload tests, and envelope-budget
  evidence. Stop for scope and regression review.
- [x] 3. Batch B: define the Pi-native read-query contract and implement a pilot
  for Palette Session search, Palette message search, and navigation message
  search. Prove last-success retention, cancellation, single-flight behavior,
  stale Host rejection, reconnect refresh, and zero mutation replay. Stop for
  runtime and UI review.
- [x] 4. Batch C: choose and review the HEIC decode boundary/dependency, record
  license/CSP/resource-budget evidence, normalize HEIC/HEIF to JPEG through the
  current staged attachment flow, and verify failure/retry/remove UX. Stop after
  exact macOS packaged validation.
- [x] 5. Batch D: measure large-checkout behavior and implement a cancellable
  Worktree-create stage budget/progress contract without weakening rollback.
- [x] 6. Batch D: add Submodule completeness inspection, local-only initialization,
  explicit network/auth action, and partial-state tests across private-Git fixtures.
- [x] 7. Batch D: add an explicit app-owned missing-Worktree recovery flow with
  exact identity preflight, targeted reconciliation, truthful unrecoverable-data
  copy, and no implicit turn-time repair. Stop for security and data-loss review.
- [x] 8. Update PRODUCT/DESIGN/architecture/provenance only for behavior actually
  implemented, run the final validation matrix, record exact remaining target-OS
  gaps, and close the plan without commit/push/release claims.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Reference | `corepack pnpm run audit:references -- --id t3code --json` plus fixed-commit source review | exact source SHA/path, license parity, adapted/reimplemented mapping | Batch A-D passed: fixed commit/path/SHA bound; 13 reimplemented mappings added; `check:references` reports 36 valid records; lock unchanged; live remote is newer and remains explicitly drifted |
| Source | scoped diff review, `corepack pnpm run typecheck`, `corepack pnpm run lint`, `corepack pnpm run build`, `git diff --check` | no unrelated R2 WIP, no second runtime/truth owner, all static gates pass | Batch A-D static gates passed: Protocol revision `07a21b24aa193ffe920036edc1cc03dbc2561bfe818e2e32cb4811ebaa85ebc2`, typecheck, lint, build/self-contained preload, architecture (835 modules, no cycles), dead-code, reference, structure, production-transport, workflow, and diff checks exit 0; no Effect/RPC/server/SQLite/session-truth dependency added |
| Batch A tests | targeted Tool projector/projection and Session Resource protocol/runtime suites plus a cumulative flood probe | bounded aggregate/emissions/envelope; terminal event and truncation truth preserved | passed: 58/58 final targeted; 589 files and 3,051 tests passed with 3 skipped before final fixture-only E2E edits; 10,000-block projection reads fewer than 10 blocks; 256 updates emit start plus terminal only; projected Resource fixture stays below 512 KiB |
| Batch B tests | targeted connection/query/store tests and Renderer production-preview E2E | reconnect refresh, cached success, cancellation, stale fencing, query-key isolation, no mutation replay | passed: final query/recovery target 8/8; final full Vitest 590 files, 3,057 passed and 3 skipped; production-preview Chromium 13/13, including shared key/single-flight, retained success during Host replacement, one reconnect refresh, and unchanged single Workspace registration owner |
| Batch C tests | image-sniff/decode/size/pixel/metadata/error fixtures, Composer tests, Electron host test | valid JPEG output and opaque staging; malformed/bomb/oversized inputs fail safely | passed: 48/48 targeted tests; final full Vitest 594 files, 3,071 passed and 3 skipped; production Renderer E2E proves success, retry, draft preservation, and removal; strict JPEG inspection caught and the staging boundary removed a 474-byte encoder APP2 ICC segment |
| Batch D tests | private-Git Worktree fixtures for large checkout, cancellation, Submodules, missing paths, protected/manual/dirty states | exact identity, bounded output/time, explicit effects, rollback/reconcile safety | passed: initial focused matrix 66/66; post-structure core regression 31/31; exact packaged private Git 2.53.0 plus packaged `GIT_EXEC_PATH` passed 26/26 for create/cancel/Submodule/recovery; final full serialized coverage passed 595 files, 3,086 tests with 3 skipped. Default highly parallel coverage showed unrelated pre-existing Git/process/temp-directory timing races, so the complete matrix was rerun with one file worker rather than weakening unrelated test budgets |
| Runtime/host | real Agent Host connection replacement and projection resync around Batch A/B; real attachment staging and private Git around C/D | live behavior matches source tests without stale commits or hidden external effects | Batch A/B passed for hosted Chromium connection replacement/resync and real Agent Host roundtrip; Batch C exact packaged staging passed; Batch D production-preview Chromium passed bootstrap plus 4 Worktree scenarios, including explicit Submodule network action. Packaged smoke verified private Git inspection and Worktree intent; synthetic real-mac private-Git service fixtures verified mutation/recovery. Real Provider Tool flood remains untested |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` after each completed user-visible batch; smoke the exact repository artifact | quit/package/smoke/open receipt and exact artifact identity | Batch A-D passed on macOS arm64. Batch D `app.asar`: modified 2026-08-26T06:59:47.149Z, size 190,221,915, SHA-256 `d8c1a525628c787eaffac6c7bfd7c60bdc63a7ea947052930290405bce70d3c5`; full packaged smoke passed and repository app PID 99062 opened that exact artifact |
| Target OS/manual | real macOS arm64 HEIC and Worktree lifecycle; real Windows x64 installed Worktree/Submodule lifecycle | platform-bound evidence recorded separately | macOS arm64 HEIC passed with a real 15,703-byte HEIC normalized to a 27,948-byte, 1,024 x 1,024 JPEG. Batch D passed synthetic real-filesystem Worktree/Submodule/recovery lifecycle with exact packaged private Git and exact packaged UI/inspection smoke; a manual user-Repository lifecycle and real Windows x64 remain unverified |

## Rollback

- Keep every batch independently revertible and do not depend on a later batch to
  restore correctness of an earlier one.
- Batch A rollback removes only projection limits/metadata and their tests; Pi
  Session JSONL and Tool receipts remain unchanged.
- Batch B keeps old query call sites until each pilot migration passes; rollback
  restores the previous hooks/stores without a persisted-state migration.
- Batch C rollback removes HEIC recognition/normalization while preserving the
  existing PNG/JPEG/WebP/GIF staged attachment path and drafts.
- Batch D rollback removes new progress/completeness/recovery actions. It must
  never delete or rewrite a user Worktree as part of software rollback.
- Never use destructive Git reset or revert unrelated WIP. If implementation
  conflicts with the protected R2 paths, stop and request a scope decision.

## Risks and unknowns

- The Tool allocation issue is source-level and not yet reproduced; the earliest
  checkpoint must measure it before broad refactoring.
- A generic query abstraction can erase important domain distinctions or create
  a second retry owner if its scope is not kept to idempotent Renderer reads.
- Resource truncation must remain visible and must not affect ResourceLoader
  precedence, loaded-resource read authorization, or exact internal paths.
- HEIC decoders may add WASM/bundle/CSP/license surface or permit decompression
  bombs; dependency selection is a security decision, not a UI-only choice.
- Submodule update can trigger network, authentication, large downloads, and
  platform-specific Git behavior. Local-only and explicit-effect states need
  separate tests.
- A missing directory may already have lost uncommitted or untracked data;
  recreating the branch cannot claim to recover that data.
- A Repository-wide `git worktree prune` can affect unrelated registrations;
  prefer exact, bounded reconciliation or require explicit disclosure.
- Real Windows x64 evidence is not locally available and cannot be inferred from
  macOS, hosted Chromium, source tests, or packaged private-Git fixtures.
- Upstream t3code continues to move quickly; later drift is not evidence that a
  fixed mechanism was reviewed or absorbed.

## Progress log

- 2026-08-26: Audited the live canonical checkout, recorded the unrelated R2
  dirty scope, refreshed bounded t3code drift evidence, consolidated seven
  candidates, and created this proposed plan. No feature implementation,
  reference-lock update, commit, push, build, upload, or release was performed.
- 2026-08-26: User accepted the proposed execution order. Activated the plan,
  expanded the protected dirty scope to the twelve files observed at Batch A
  start, and began Checkpoint 0 source binding. No unrelated WIP was edited or
  staged.
- 2026-08-26: Reproduced the pre-change cumulative Tool aggregation shape with
  10,000 blocks and a 50,108,889-character intermediate string. Reimplemented
  collection-time bounded Tool text projection, retained the existing 100 ms
  coalescing/terminal flush owner, and added getter-backed and 256-update flood
  regressions without changing Tool Result or Pi JSONL authority.
- 2026-08-26: Added a metadata-only Pi Resource catalog projection with a
  256-item cap, 48 KiB aggregate text budget, per-field bounds, stable truncated
  identities, and explicit item/field disposition. Propagated the disposition
  through Protocol, Agent Host, reload/resync, Renderer state, Context, and
  Settings; Pi ResourceLoader state remains complete and internal.
- 2026-08-26: Completed the Batch A stop gate. Final targeted tests passed
  58/58; the prior full run passed 589 files and 3,051 tests with 3 skips;
  typecheck, lint, build, Protocol revision, reference governance, and scoped
  diff checks passed. Production-preview Chromium passed the bootstrap plus
  bounded-projection UI scenario, and exact macOS arm64 unsigned packaged smoke
  passed before opening the repository artifact. Batch B has not started.
- 2026-08-26: Reimplemented a disposable Renderer read-query lifecycle for only
  Session catalog and content-search reads, then migrated Palette Session search,
  Palette message search, and Navigation message search. Exact keys share one
  flight, disconnect cancels in-flight work, Host generation fences stale
  results, and retained success remains visible while observed reads refresh.
  Mutations and Session/Operation/Approval/Tool/Plan authority remain outside.
- 2026-08-26: Production-preview diagnosis found that React Compiler did not
  preserve an external-store revision that was observed but semantically unused
  by the returned snapshot. Passing the observed revision into snapshot
  selection restored production updates. Unit, full Vitest, static/build,
  provenance, production-preview Chromium, and exact macOS arm64 packaged
  gates passed. Stopped at the Batch B gate; Batch C has not started.
- 2026-08-26: Final cache review found that trimming immediately after inserting
  an as-yet-unobserved key could evict that new key when the idle-retention bound
  was full. Moved trimming back to last-observer release and added a capacity
  regression. Re-ran the final full 3,060-test Vitest set, 13-test production
  Renderer E2E, static gates, and exact packaged preview successfully.
- 2026-08-26: Reimplemented fixed-source t3code HEIC mechanics as a Pi-67-owned
  Desktop Worker boundary using exact `heic-decode@2.1.0` and
  `@napi-rs/canvas@1.0.3`. Added content-first BMFF inspection, pre-decode pixel
  budgets, worker termination/resource caps, structural JPEG validation and
  metadata removal, one-shot protocol/preload normalization receipts, and
  Composer retry/remove behavior without relaxing the Renderer CSP.
- 2026-08-26: Completed the Batch C stop gate. Targeted tests passed 48/48;
  final full Vitest passed 594 files and 3,071 tests with 3 skips; Renderer E2E
  passed the production bootstrap plus HEIC and untrusted-resource scenarios;
  all static/reference/dependency/build/coverage gates passed. Exact macOS arm64 packaged
  smoke normalized a real 15,703-byte HEIC to a validated 27,948-byte JPEG and
  opened the exact repository artifact. Batch D has not started.
- 2026-08-26: Measured exact private-Git Worktree checkout at 10k, 50k, and
  100k tracked files, then replaced the former 60-second opaque mutation with
  bounded preflight/queue/checkout/Submodule/verification/registration stages,
  a 300-second checkout budget, supplemental Renderer progress, cancellation,
  and the existing exact rollback authority. Cancellation never projects
  success before rollback is confirmed; unconfirmed process cleanup fences the
  Repository.
- 2026-08-26: Added bounded Submodule completeness inspection. New Worktrees
  first attempt local-object-only initialization from the verified common Git
  directory with all transports denied except `file`; incomplete state stays
  visible and only a trusted, fresh, explicit action may use the allowlisted
  network transports. The action is serialized with Repository mutations and
  `file` remains denied.
- 2026-08-26: Added dedicated recovery for committed app-owned missing
  Worktrees. Recovery preserves the Workspace identity, requires the exact
  source/Repository/branch/profile receipt, reconciles only an exact target
  registration, fails closed for foreign/dirty/ambiguous state, and never runs
  Repository-wide prune or turn-time repair. A retry test covers Git restore
  succeeding before state persistence.
- 2026-08-26: Completed the Batch D implementation gate. Static/build/reference
  checks passed; serialized full coverage passed 595 files and 3,086 tests with
  3 skips; exact packaged private Git passed 26/26 Worktree/Submodule/recovery
  fixtures; production Renderer preview passed 5/5; exact unsigned macOS arm64
  packaged smoke passed and opened `app.asar`
  `d8c1a525628c787eaffac6c7bfd7c60bdc63a7ea947052930290405bce70d3c5`.
  The default highly parallel coverage runner exposed unrelated resource/timing
  races, so the complete coverage matrix was rerun serially without changing
  those product contracts. Stopped for the required security/data-loss review;
  no commit, push, upload, or release was performed.
- 2026-08-26: User continued past the Batch D evidence gate. Closed Checkpoint 8
  using the completed validation matrix and the already-updated architecture and
  provenance records. `PRODUCT.md` and `DESIGN.md` remain protected pre-existing
  WIP and were not edited or staged for this program; no safe scoped merge into
  those files was authorized. This closeout changed only the plan, so the prior
  exact test, build, private-Git, production-preview, and packaged-artifact
  evidence remains the final validation basis. No commit, push, upload, release,
  signing, or notarization was performed.

## Closeout

- Current Git HEAD: `776615c2a26e`; Batch A-D are uncommitted and therefore have
  no dedicated source SHA.
- Changed files: scoped Batch A-D implementation, test, provenance, plan, and
  E2E paths are mixed in the working tree with twelve protected pre-existing
  R2/installer/product WIP files. Nothing is staged and the protected files were
  not edited for this program.
- Validation completed: Batch A-D fixed-source binding, targeted and serialized
  full coverage suites, static/source/build gates, provenance governance,
  hosted Chromium resync/query/UI evidence, exact private-Git macOS fixtures,
  and exact macOS arm64 unsigned packaged smoke/open.
- Validation not completed: real Provider cumulative Tool flood, a manual
  user-Repository Worktree/Submodule lifecycle, and real Windows x64. The default
  highly parallel coverage invocation remains timing-sensitive even though its
  static phases and the complete serialized coverage matrix pass.
- Remaining risks: see above
- Commit/push/release state: not authorized; nothing staged or published
