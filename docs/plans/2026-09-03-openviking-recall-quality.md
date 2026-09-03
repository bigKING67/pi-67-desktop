# OpenViking recall quality, latency, and feedback

Status: completed locally
Owner: Codex
Started: 2026-09-03
Last updated: 2026-09-03

## Goal

Complete the four accepted recall improvements across the Pi-owned local
OpenViking path and the DataHub-governed enterprise path: oversample before the
active-asset allowlist, use cheap retrieval before session-aware expansion,
deterministically rerank Experience and SOP candidates by applicability and
quality, and add privacy-safe feedback, p95 telemetry, and a repeatable Golden
Set evaluation.

## Non-goals

- Do not add a second prompt composer, task classifier, agent loop, model router,
  or automatic Tool orchestrator; Pi still decides whether to call a recall Tool.
- Do not merge private OpenViking content with DataHub enterprise governance or
  expose one user's private Memory to another user.
- Do not persist prompt text, search text, recalled bodies, Tool payloads,
  credentials, or user identities in telemetry or feedback.
- Do not auto-execute recalled SOP steps or grant Tool authority.
- Do not tune thresholds from intuition alone, deploy to VPS/production, apply a
  production migration, commit, push, tag, or release in this boundary.

## Acceptance criteria

- Shared Experience and SOP retrieval oversample a bounded OpenViking candidate
  set, intersect it with the current Account/Project active allowlist, rerank the
  eligible records, and only then enforce the requested result limit.
- `viking_search` performs bounded actor-scoped `/find` first and upgrades to the
  session-aware `/search` path only when the cheap result is empty or ambiguous;
  strong cheap hits return without query expansion.
- Enterprise reranking is deterministic, bounded, and covers semantic score,
  task/query overlap, positive and negative applicability, confidence, evidence,
  freshness, expiry, and SOP semantic version without trusting resource text.
- Recall feedback supports `helpful`, `irrelevant`, `outdated`,
  `wrong-scope`, and `incorrect`; it is scoped to the current Workspace/Session,
  records only opaque identifiers and bounded metadata, and visibly settles in
  the Memory Inspector.
- Recall telemetry records route, outcome, duration, candidate/eligible/selected
  counts, token/detail metadata, and query hash only. A bounded summary reports
  sample counts and p50/p95 without recording source text.
- A repository-local, synthetic, non-sensitive Golden Set and deterministic evaluator
  cover strong-hit, ambiguous-upgrade, active-allowlist, applicability,
  freshness, Experience, and SOP cases and fail against explicit quality and
  latency-budget contracts.
- Focused Desktop/DataHub tests, typechecks, protocol revision, source-quality
  gates, and the required native Desktop validation pass. Performance claims remain
  source/evaluator claims unless a real runtime measurement is captured.

## Delivery boundary

- Local implementation: authorized in the canonical Desktop and DataHub
  checkouts.
- Commit: not authorized.
- Push: not authorized.
- Candidate build/upload: not authorized.
- VPS/database deployment: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Startup recall is one stable per-Session snapshot with a 1,200-token budget, actor scope, query expansion off, and a 1,000 ms client timeout. | current `packages/openviking-pi-extension` source and effective local config | 2026-09-03 |
| OBSERVED | General on-demand `viking_search` immediately uses session-aware search with query expansion and a 15-second timeout; only explicitly scoped queries take the cheap `/find` path. | current Extension source | 2026-09-03 |
| OBSERVED | Shared Experience asks OpenViking only for the final limit before active-asset filtering; SOP oversamples 50. Both primarily inherit vector order and use a fixed 0.35 candidate threshold. | current DataHub Rust source | 2026-09-03 |
| OBSERVED | Recall diagnostics expose individual durations but no persisted bounded summary; DataHub search audit contains query hash and count but no duration. | current Desktop/DataHub source | 2026-09-03 |
| OBSERVED | The Memory Inspector lists recalls but has no feedback action. `context.recall.list` currently returns an empty implementation. | current Protocol, Host, and Renderer source | 2026-09-03 |

## Affected boundaries

- Modules/processes: OpenViking Pi Extension, Pi Runtime Tool metadata, Desktop
  Domain/Protocol/Agent Host/Renderer, DataHub Agent runtime/repository/routes.
- Protocol or persisted state: Protocol recall feedback and metrics contracts;
  bounded local recall observation/feedback store; DataHub audit metadata only.
- Platform/artifact: source and native Desktop validation in this slice; packaged macOS
  and Windows evidence remain separate unless product-runtime files require it.
- Security/privacy: hashes and opaque recall identifiers only; untrusted content,
  Account/User/Workspace/Project isolation, and Tool authority remain unchanged.
- Existing WIP: preserve all current Desktop Experience/SOP WIP and unrelated
  DataHub DataOps/WeChat/marketing files; do not stage or normalize them.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Keep the stable one-shot startup snapshot. | It preserves prompt-prefix stability and normal continuations pay no retrieval cost. | Measured task continuity or quality evidence proves a different bounded trigger is better. |
| Use `/find` as the cheap Tool fast path and `/search` only for empty or ambiguous candidates. | A model-selected Tool query is already self-contained; query expansion should be paid only when it can change the result. | Real evaluation shows direct context search is both faster and materially more accurate. |
| Oversample before allowlist with a bounded factor, then return at most the configured final count. | Directory summaries or revoked resources must not create false zeroes, while external result volume stays bounded. | OpenViking supports an authoritative active-asset filter in the same retrieval request. |
| Rerank only trusted governance metadata plus OpenViking score. | Recalled text is untrusted; eligibility and quality signals belong to DataHub. | A reviewed server-side rank contract proves equivalent isolation and explainability. |
| Store feedback locally first and make remote learning a separate future contract. | The accepted request is to improve retrieval without introducing a new enterprise write/migration or hidden cross-user signal. | A separately approved, audited, tenant-safe aggregate-feedback API is available. |
| Treat Golden Set latency as a deterministic budget contract, not real network p95. | Unit evaluation cannot prove host/network performance. | A repeatable real runtime benchmark supplies stronger evidence. |

## Checkpoints

- [x] 1. Add bounded cheap-first local search, ambiguity policy, cache boundaries,
  and focused Extension tests.
- [x] 2. Add bounded Experience/SOP oversampling, deterministic governance
  reranking, and DataHub repository/HTTP/real-Lab regression coverage.
- [x] 3. Add Protocol/Domain recall observation, feedback, and p50/p95 summary
  contracts with a privacy-safe bounded Agent Host store.
- [x] 4. Add Memory Inspector feedback and metrics UI using the existing React
  Aria/design-system family and visible success/error settlement.
- [x] 5. Add the synthetic Golden Set, evaluator, command, thresholds, and
  regression tests covering all four improvements.
- [x] 6. Update PRODUCT/DESIGN/DataHub task authority and effective configuration
  naming without weakening compatibility or private/shared boundaries.
- [x] 7. Run focused then aggregate source gates, native Desktop validation, and any
  packaging gate required by the final touched runtime surface.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Extension | focused Vitest plus TypeScript | cheap-first, ambiguity upgrade, bounded result/cache/failure semantics | PASS: focused Extension/Host/Protocol/Renderer suite passed; aggregate typecheck passed |
| DataHub Rust | fmt/check/clippy/test plus disposable Agent contracts | oversample-before-filter, deterministic rank, tenant/active lifecycle | PASS: fmt/check/strict Clippy/size/migrations; 217 regular tests; five disposable PostgreSQL/HTTP contracts |
| Domain/Protocol/Host | focused Vitest, typecheck, protocol revision | strict feedback/metrics schema and bounded privacy-safe storage | PASS: strict schemas/store tests and revision `4608a415...33e4` |
| Renderer | focused Vitest, typecheck, lint | accessible feedback action and truthful pending/error state | PASS: focused component contract and aggregate lint/typecheck |
| Golden Set | repository command and verifier tests | explicit quality and synthetic latency-budget result | PASS: Desktop recall evaluator and DataHub rank fixtures |
| Aggregate | Desktop `corepack pnpm run check`; DataHub affected gates | no source regression | PASS: Desktop 657 files/3,357 tests plus static gates; DataHub affected backend gates pass |
| Native UI | latest unsigned macOS arm64 app via Computer Use | visible metrics/privacy state without reading private memory bodies | PASS: zero-sample state truthfully displayed; feedback state remains source/component-test evidence |
| Packaged/OS | unsigned macOS arm64 build and packaged smoke | exact artifact/host evidence | PASS: app.asar SHA-256 `53fe85fb...1dde5`; packaged smoke passed |

## Rollback

Revert only the cheap-search policy, rank module, recall observation/feedback
contracts/store/UI, Golden Set command, and accompanying Product/Design/task
documents. Restore the existing direct context-search Tool behavior and final
limit calls together. Do not change Pi JSONL, private OpenViking resources,
published enterprise Experience/SOP assets, credentials, prior commits, or
unrelated dirty files.

## Risks and unknowns

- OpenViking similarity scores are model-dependent; candidate thresholds stay
  conservative until the Golden Set and real usage feedback justify tuning.
- A local feedback store improves user control but does not yet train the remote
  enterprise ranker; that requires a separately governed aggregate contract.
- Cheap-first can add one request before an expanded query on ambiguous cases;
  bounded ambiguity and cache policy must prevent worse tail latency.
- Current source events do not prove production p95; runtime SLO evidence remains
  separate from deterministic evaluator budgets.

## Progress log

- 2026-09-03: Audited the live one-shot startup recall, Tool search, DataHub
  allowlist, diagnostics, and Inspector paths. Confirmed the four accepted gaps,
  recorded the existing dirty boundaries, selected `design-craft`, and routed the
  visible work as L1-F/main-serial; Computer Use is the runtime authority for
  this native Electron surface, so browser validation is not applicable.
- 2026-09-03: Implemented cheap-first `/find` with bounded session-aware upgrade,
  positive/empty caches, and stable startup recall. Preserved the raw Pi Session
  identity for telemetry while using the derived OpenViking Session identity for
  network calls.
- 2026-09-03: Implemented DataHub oversample-before-allowlist, deterministic
  Experience/SOP reranking, bounded audit metadata, local opaque feedback, p50/p95
  summaries, the Memory Inspector controls, and both synthetic Golden Sets.
- 2026-09-03: Desktop aggregate gate passed after adding real branch coverage
  rather than lowering its threshold: 657 passed/1 skipped files and 3,357
  passed/4 skipped tests; Statements 82.11%, Branches 76.14%, Functions 86.18%,
  Lines 85.99%. DataHub fmt/check/strict Clippy/size/migrations, 217-test ordinary
  suite, and five disposable Agent contracts passed.
- 2026-09-03: Built and opened the latest unsigned macOS arm64 product. Packaged
  smoke passed and Computer Use verified the visible recall-quality metrics and
  privacy copy. No synthetic record was written into the user's real Memory store
  merely to populate the feedback row.

## Closeout

- Final source base SHA: `5e7919a01676f4213e161b5a8fede6187802fab3c` plus the preserved uncommitted scoped diff
- Changed files: OpenViking Extension, Domain/Protocol/Agent Host/Renderer,
  capability provenance, evaluator, PRODUCT/DESIGN, this plan, and the DataHub
  Agent retrieval/rank/task-contract slice
- Validation completed: focused tests, protocol revision, full Desktop source
  gate, DataHub backend/source/disposable contracts, Golden Sets, unsigned macOS
  arm64 package, packaged smoke, and native metrics/privacy UI inspection
- Validation not completed: real production p95/quality A/B, Windows x64,
  VPS/production deployment, production migration/TLS/tenant isolation, and a
  native feedback click against a real recalled item
- Remaining risks: model-dependent similarity and the need for representative
  real-workload telemetry remain; unit latency budgets are not network SLO proof
- Commit/push/release state: no commit, push, deploy, tag, or release authorized
