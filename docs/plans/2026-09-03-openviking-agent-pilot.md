# OpenViking task-level Agent pilot

Status: complete
Owner: Codex
Started: 2026-09-03
Last updated: 2026-09-03

## Goal

Measure task success, Pi Tool choice, latency, provider usage, and unnecessary
recall for three OpenViking strategies through the real `PiSdkRuntime` agent
loop: no memory, official-style current-prompt context recall, and Pi-67 stable
startup context plus find-only on-demand search and bounded deep read.

## Non-goals

- Do not change the production OpenViking policy from pilot evidence alone.
- Do not add a second Agent loop, model router, prompt composer, or Memory owner.
- Do not read or mutate existing private OpenViking, Pi JSONL, or Desktop state.
- Do not touch DataHub, VPS, production, Windows, release, or deployment state.
- Do not commit, push, tag, publish, or upload artifacts in this phase.

## Acceptance criteria

- One runner compares all three profiles with the same fixed model, synthetic
  corpus, scenario order, OpenViking Server, and isolated runtime boundary.
- Preflight is non-billable. A three-run paid smoke must pass provider, Tool,
  scoring, credential, Account-cleanup, and failure-budget checks before the
  guarded 54-run pilot is allowed.
- The full matrix is six scenarios by three profiles by three repetitions: 54
  Agent runs. Multi-turn scenarios report their additional Provider requests.
- The candidate profile uses product `RecallManager`, `OVClient`, and
  `registerTools`; only the evaluation wrapper removes session expansion from
  `viking_search`, yielding the observed find-only candidate.
- Provider credentials are loaded only from a repository-external mode-0600
  configuration and installed into Pi's in-memory credential override. No key,
  prompt, raw response, Tool payload, or private content enters evidence.
- Each run has a fixed Turn count, output-token cap, request cap, timeout, and
  failure budget. Any overrun aborts before further paid requests.
- Every live run uses a disposable synthetic OpenViking Account and isolated
  Agent Directory, HOME, state root, Workspace, Session JSONL, and Desktop
  storage. Cleanup verifies exact Account absence and zero credential literals
  before deleting the isolated runtime root.
- Receipts bind source SHA, Git HEAD, model identity, corpus SHA, server version,
  profile configuration, aggregate outcomes, request counts, Token/cost
  projection, cleanup, and artifact hashes.

## Delivery boundary

- Local implementation and preflight: authorized.
- Paid smoke and guarded 54-run local Agent pilot: authorized by the user's
  continuation after the explicit cost boundary was presented.
- Production policy change, Desktop package comparison, commit, push, DataHub,
  VPS, production, candidate, release, and promotion: not authorized.

## Design

| Profile | Startup | Later Turns | Deep read |
| --- | --- | --- | --- |
| `no-memory` | none | none | none |
| `official-context` | current prompt `/search` | every prompt `/search` | server-rendered context only |
| `pi67-find-only` | one stable product Recall snapshot | Pi model may call product `viking_search`, fixed to `/find` | Pi model may call product `viking_read` |

The evaluator is a configured test Package loaded by Pi's normal ResourceLoader.
It does not call the model or Tools itself. The real Pi loop remains responsible
for model requests, Tool selection, Tool execution, and continuation.

## Checkpoints

- [x] 1. Add frozen scenarios, test Package, isolated runtime runner, metrics,
  receipts, safety guards, and offline tests.
- [x] 2. Pass focused source tests, package builds, non-billable preflight, and
  exact secret-literal scan.
- [x] 3. Run the three-profile paid smoke and review task/Tool/request/Token
  gates before further requests.
- [x] 4. If smoke passes, run the guarded 54-run matrix and preserve its receipt.
- [x] 5. Verify cleanup, run affected and aggregate source gates, and document
  findings without changing production policy.

## Validation matrix

| Layer | Required evidence |
| --- | --- |
| Offline | scenario validation, aggregate metrics, failure/request guards, redaction, receipt invariants |
| Pi runtime | actual `PiSdkRuntime`, selected fixed Provider/model, Pi JSONL, Tool projections, usage |
| OpenViking | disposable Account, synthetic Resources, real search/read requests, exact deletion |
| Provider | real OpenAI-compatible calls through Pi, bounded requests/output, no persisted key |
| Source | focused tests, typecheck/lint/structure, aggregate `check` when implementation settles |
| Packaged/Windows/production | explicitly not claimed |

## Rollback

Remove only `eng/evals/openviking-agent-pilot`, the related package scripts,
and this plan. Delete only an exact pilot evidence directory if authorized.
Never use rollback to modify private OpenViking namespaces, canonical Pi JSONL,
DataHub, or production configuration.

## Risks and stopping rules

- One Agent Turn may require multiple billable Provider calls because Tool use
  returns to the model. Receipts therefore report both Agent runs and Provider
  requests; the request cap is authoritative.
- Model or server nondeterminism may create variance. Three repetitions support
  comparison but do not establish production superiority.
- If the smoke cannot call the expected Tool, exceeds request/timeout budgets,
  leaks a credential literal, fails Account cleanup, or cannot produce a valid
  Pi usage projection, the full matrix is not started.
- Monetary cost may remain zero when the custom model catalog has no verified
  price table. Token counts and request counts remain the primary cost evidence;
  no current Ark price is inferred.

## Progress log

- 2026-09-03: Retrieval pilot justified a task-level comparison: find-only
  matched official-style retrieval accuracy with lower request count and
  latency, while task switching and Pi Tool choice remained unmeasured.
- 2026-09-03: User authorized continuing into the paid Agent pilot. The rollout
  remains gated by a three-run smoke before the full 54-run matrix.
- 2026-09-03: The first smoke stopped before any Provider request because a
  transient Settings override was discarded by Pi's normal reload lifecycle.
  The synthetic Account and isolated runtime were removed. Package persistence
  and a zero-request runtime-assembly preflight are required before retrying.
- 2026-09-03: The second smoke stopped before any Agent run because the twelfth
  synchronous Resource compilation exceeded OpenViking's 90-second server
  deadline. Cleanup passed and Provider requests remained zero. Agent ingestion
  now queues six scenario Resources plus two intentional distractors and gates
  execution on real find-readiness for every queued document.
- 2026-09-03: The first real three-profile Agent smoke was an invalid comparison:
  every first Turn exhausted the 384-token output cap in non-text model output.
  Both memory profiles still solved the material task-switch Turn, and the
  candidate used `viking_search` as designed. The fixed cap is now 1024, with
  content-free assistant part diagnostics added before one bounded smoke retry.
- 2026-09-03: The corrected smoke passed all gates: no-memory 0/2, official
  2/2, and candidate 2/2. The candidate solved the material task switch by
  invoking `viking_search`; all three isolated runtimes and the synthetic
  Account were removed with zero credential-literal matches.
- 2026-09-03: The guarded full run completed 54/54 Agent runs with no runtime
  failure. Official and candidate both solved 21/21 memory-required Turns and
  3/3 controls; no-memory solved 0/21 memory Turns and 3/3 controls. On this
  short-task corpus, official used 24 Provider requests, 124,059 Tokens, and
  60 OpenViking requests with 9.5s/20.1s p50/p95. Candidate used 34 Provider
  requests, 200,850 Tokens, and 78 OpenViking requests with 11.6s/27.4s
  p50/p95; six searches and four deep reads account for the ten extra Provider
  continuations. No production policy was changed.
- 2026-09-03: Full evidence is under
  `artifacts/evidence/openviking-agent-pilot/full-20260903T094504711Z-bc3feccc-7191-4cc1-a427-9a32997b8a1d`.
  SHA-256: receipt `cc94f48dfe00c60ea2570af7e5a2912d9a62947ac809c48a0c7243e965dbc04e`,
  results `6fe0c87ba2befbc11f21eb1e15b614075b0c18c54fed87c9a0406b3ad90e1a4c`,
  report `cbba03e83de268d7e8a3541fb0d6e72e916f029ae1ec1d309a2adedc84581477`.
  The live run binds runner SHA
  `f7dc25e4d58e3fafb3e69d259b18f09798c14df6be70361969223d8f6db00cfd`.
  A post-run type-aware lint correction only bound `fetch` explicitly and the
  source-identity list was then extended to cover the shared Lab client; the
  live run was not relabeled as evidence for that subsequent source snapshot.
- 2026-09-03: Exact Account-ID scanning found no residue under the OpenViking
  data root after cleanup, and the v0.4.16 Lab remained healthy. Aggregate
  source gate passed: 941 modules, 3,507 imports, zero cycles; 659 test files
  passed and one skipped; 3,369 tests passed and four skipped; coverage was
  82.11% statements, 76.15% branches, 86.18% functions, and 85.99% lines.
- 2026-09-04: The product decision adopted the official-style current-prompt
  lifecycle because it matched the candidate's correctness while using fewer
  Provider requests, OpenViking requests, Tokens, and less wall-clock latency.
  The run and its profile names remain historical evidence bound to the recorded
  runner/source hashes; they are not relabeled as evidence for later product
  source. Re-running a paid matrix after product changes requires a new receipt
  and separate cost authorization.
