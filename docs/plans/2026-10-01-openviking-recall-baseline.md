# OpenViking recall retrieval baseline

Status: completed locally
Owner: Claude Code
Started: 2026-10-01
Last updated: 2026-10-01

## Goal

Rebuild a retrieval-layer evaluation for the current product Recall path so it
can discriminate between configurations, then measure an honest baseline before
any tuning. The evaluation must follow the eval-design checklist adopted for this
work: representative tasks, a ceiling clearly below 100%, a fixed train/test
split for later hill-climbing, and measured run-to-run variance.

## Non-goals

- Do not change product Recall configuration, Extension code, protocol, or UI in
  this phase. Tuning is a later phase gated on this baseline.
- Do not run paid Agent/Pi-model evaluation. Query expansion, which calls the
  OpenViking VLM, is an optional, explicitly enabled arm only.
- Do not read, enumerate, or modify private OpenViking data, Pi JSONL, Desktop
  state, or Desktop-stored credentials.
- Do not commit, push, build candidates, or publish.

## Acceptance criteria

- One runner starts a disposable OpenViking 0.4.16 native server (dev mode,
  loopback, temporary data root), seeds synthetic memories through
  `content/write` without any VLM call, and deletes the data root on every exit
  path.
- Requests are built by the product `shared/recall-core.mjs`
  (`fetchAssembledContext`) with the product `config.json`, so the evaluation
  tracks product drift instead of a re-implemented policy.
- The corpus covers direct, paraphrase, cross-lingual, distractor, superseded,
  follow-up, multi-target, cross-peer, and negative cases. Splits are a pure
  function of a seed and the memory group, so related cases never straddle
  train and test.
- Reports give Hit@1/Hit@3/MRR, full multi-target recall, stale/distractor
  intrusion, other-peer leakage, negative false injection, injected tokens, and
  p50/p95 latency per arm, split, and case type, plus per-metric spread across
  repetitions.
- Offline tests cover corpus validation, split determinism and leakage, scoring,
  aggregation, and credential redaction without a server.
- Credentials come only from a repository-external mode-0600 file, reach the
  server only through its environment, and never appear in evidence.

## Delivery boundary

- Local implementation and live retrieval-only runs: authorized (2026-10-01).
- Embedding calls to the configured embedding provider: implied by live runs.
- Query-expansion (VLM) arm: not run unless separately confirmed.
- Product default threshold change: authorized 2026-10-01 (defaults only; saved values kept).
- Commit, push, candidate, release: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Product Recall is the upstream current-prompt context face: `mode=context`, `purpose=coding`, actor peer scope, query expansion `auto`, dedup 5 turns, 1,200-token budget, threshold 0.35, one experience and one resource slot. | `packages/openviking-pi-extension/config.json`, `recall.ts`, `shared/recall-core.mjs` | 2026-10-01 |
| OBSERVED | Previous retrieval pilot saturated (Hit@3 98.3%) and the Agent pilot solved 21/21 memory Turns; both used well-formed standalone queries and Resource documents. | `2026-09-03-openviking-ab-retrieval-pilot.md`, `2026-09-03-openviking-agent-pilot.md` | 2026-10-01 |
| OBSERVED | `eng/evals/openviking-ab` and the Golden Set evaluate the retired adaptive `/find`→`/search` router; Resource ingestion was later removed from the local adapter. | `policy.mjs`, commit `3c55d9d` | 2026-10-01 |
| OBSERVED | OpenViking 0.4.16 memory writes via `content/write` re-render overviews from templates and enqueue embeddings with no VLM call; query expansion runs only with a materialized session and `query_expansion != off`. | server source review of the prepared native runtime | 2026-10-01 |
| OBSERVED | The previous Docker Lab is gone; a prepared native runtime exists under ignored `artifacts/openviking-native/`. | live process/port check | 2026-10-01 |

## Affected boundaries

- Modules/processes: new `eng/evals/openviking-recall-baseline/`, package scripts,
  this plan. Imports product `shared/recall-core.mjs` read-only.
- Protocol or persisted state: none. Evidence goes to ignored `artifacts/evidence`.
- Platform/artifact: macOS arm64 developer host only; no packaged claim.
- Security/privacy: synthetic content only; external credential file; exact
  secret-literal scan of every artifact.
- Existing WIP: checkout clean at `fd5fbf5`.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| New evaluation directory instead of extending `openviking-ab`. | The old runner encodes the retired adaptive policy and Resource corpus; keeping it intact preserves its receipts' meaning. | The old pilot is retired and removed in a separate change. |
| Seed memories, not Resources. | The product context face serves user/peer memories; local Resource ingestion is removed. | Resource quotas become a product recall source again. |
| Primary arm forces `query_expansion: off`. | Deterministic and VLM-free; expansion is measured as a separate optional arm. | The user authorizes VLM spend for the expansion arm. |
| Fresh OpenViking Session per case. | The dedup ledger is keyed by session message count and would otherwise suppress repeated URIs across cases. | Dedup behavior itself becomes the object under test. |
| Group-level seeded split, 60/40. | Prevents paraphrases of the same memory leaking between train and test. | Corpus grows enough for k-fold evaluation. |

## Checkpoints

- [x] 1. Corpus, split, scoring, report, server lifecycle, runner, offline tests.
- [x] 2. Offline gates: focused tests, lint, typecheck, structure; dry run.
- [x] 3. Live baseline (3 repetitions) with exact cleanup and secret scan.
- [x] 4. Record findings and candidate tuning levers; decide next phase.
- [x] 5. Train-split hill-climbing over shipped config fields (rounds 1–2).
- [x] 6. Real-store privacy-safe check (counts only): store too sparse to calibrate; see Real-store check.
- [x] 7. Product default 0.35 → 0.45 (confirmed: defaults only, saved values kept), tests, lock, provenance note.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Offline unit | `corepack pnpm run eval:openviking-baseline` | corpus/split/scoring/redaction invariants | PASS: 7 tests |
| Source | oxlint (type-aware), knip, structure, architecture | no regression | PASS |
| Live retrieval | `eval:openviking-baseline:live -- --credentials <file>` | receipt, results, report, cleanup | PASS: run `20261001T044954Z-8ea782a2`, 0 failures, cleanup verified |
| Expansion arm | `--with-expansion` | separate confirmation | not authorized |

## Rollback

Remove `eng/evals/openviking-recall-baseline/`, its package scripts, and this
plan. Delete only exact evidence run directories. No product state is touched.

## Risks and unknowns

- bge-m3 scores and server ranking are model-dependent; the baseline binds the
  embedding model identity and must be re-run after an embedding change.
- Synthetic memories approximate, but do not equal, extracted real memories.
- Without expansion, elliptical follow-ups are expected to fail; that headroom is
  intentional and is what the expansion arm will test.

## Baseline findings

Accepted run `20261001T044954Z-8ea782a2` (source `fd5fbf5` + this uncommitted
evaluation, runner `3f4b8b0ac756`, corpus `e2fe1efa1439`, bge-m3 1024d,
OpenViking 0.4.16). Three repetitions were identical (σ = 0): with expansion off
the path is deterministic, so later tuning iterations need one repetition.

| Arm | Hit@1 | Hit@3 | MRR | Multi full recall | Stale intrusion | Negative false injection | Entries / irrelevant | Tokens | p50/p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| product (expansion off) | 73.9% | 82.6% | 0.786 | 0.0% | 57.1% | 81.8% | 6.5 / 5.8 | 613 | 385/931 ms |
| find-ceiling (diagnostic) | 76.8% | 94.2% | 0.859 | 50.0% | 57.1% | 100% | 10 / 9.1 | – | 146/370 ms |

Train/test product Hit@3 79.5% / 88.0%; the evaluation has headroom on both.

Observed causes, each a candidate lever for the tuning phase:

1. Single-slot quotas drop correct memories. Product quotas give preferences,
   events, and experiences one slot each. When an older memory outranks the
   newer one in the same category (Heroku 0.758 vs Fly.io 0.701; Yarn 0.806 vs
   pnpm 0.716), the newer one is never injected: superseded Hit@3 is 28.6% in
   product versus 85.7% in raw ranking, and multi-target full recall is 0%.
2. The 0.35 threshold does not separate unrelated prompts. Negative/cross-peer
   top scores are 0.32–0.52 while expected hits have p10 0.513 and median 0.641;
   9 of 11 unrelated prompts inject 6–7 entries.
3. Each Recall carries about six irrelevant entries (~600 tokens), including the
   empty `viking://user/<user>/skills` and `/resources` directory entries in
   ~85% of queries.
4. Without expansion, elliptical follow-ups reach Hit@3 50%; this is the headroom
   the optional expansion arm would measure.
5. Actor scope held: zero other-peer leaks across 240 product retrievals.

Validity limits: synthetic memories keep superseded pairs side by side, whereas
real extraction may update the existing file in place, so finding 1's
superseded share may be overstated; empty skills/resources directories may be
richer in real stores. Both need a privacy-safe real-store check (counts and
score statistics only) before any product default changes.

## Tuning rounds

Rules: variants may override only shipped `config.json` fields (`scoreThreshold`,
`recallLimit`, `experienceRecallLimit`, `sharedExperienceLimit`,
`recallTokenBudget`); one repetition (σ = 0 established); select on train, accept
only when test does not regress.

Round 1 (`20261001T050649Z-3d260962`) and round 2 (`20261001T051427Z-aca6056a`):

| Variant | Train Hit@3 / MRR | Train false inj. | Test Hit@3 / MRR | Test false inj. | Test multi full | Tokens (test) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| product (0.35) | 79.5% / 0.767 | 85.7% | 88.0% / 0.820 | 75.0% | 0% | 611 |
| threshold 0.45 | 79.5% / 0.767 | 71.4% | 88.0% / 0.820 | 50.0% | 0% | 393 |
| threshold 0.48 | 79.5% / 0.767 | 28.6% | 88.0% / 0.820 | 25.0% | 0% | 288 |
| threshold 0.50 | 77.3% / 0.756 | 14.3% | 88.0% / 0.820 | 25.0% | 0% | 245 |
| 0.48 + limit 20 + experiences 2 | 88.6% / 0.817 | 28.6% | 88.0% / 0.813 | 25.0% | 50% | 421 |

Decisions:

- Threshold: 0.45 and 0.48 lose no hit on either split while cutting noise and
  tokens; 0.50 loses a follow-up hit scored 0.497. The positive/negative score
  gap is thin (lowest kept positive 0.497; unrelated prompts up to 0.515), so
  0.45 is the robust candidate and 0.48 the aggressive one. Real-store score
  statistics decide between them.
- Quotas (`recallLimit` 20, `experienceRecallLimit` 2): every train gain comes
  from the five superseded cases, all in train; test Hit@3 is flat and MRR dips
  (multi-3 rank 2→3). Per the overfitting rule this is not accepted; it depends
  on whether superseded pairs coexist in real stores (validity limit above).
- `sharedExperienceLimit` 0 removes one empty-directory entry with no accuracy
  change, but the resources slot may carry team knowledge in real use; deferred.

## Real-store check

Read-only counts of the user's New Money local store (no bodies read, no names
or identifiers recorded): 0 user-level memories in any category, 2 peer
memories (1 entity, 1 preference), no skills or resources files, and 16
OpenViking sessions of 1–8 messages. The store cannot calibrate the threshold or
show whether superseded pairs coexist. Decision: prefer the robust 0.45
threshold over 0.48, keep quotas unchanged, and re-run this check once the store
holds a meaningful number of memories. Low memory volume relative to session
count is noted as a separate extraction question, not investigated here.

## Progress log

- 2026-10-01: Confirmed old evaluations are saturated and stale, located the
  native runtime, verified VLM-free memory seeding and expansion conditions from
  server source, and selected a retrieval-only baseline.
- 2026-10-01: Implemented corpus (30 memories, 80 cases, 51 train / 29 test),
  scoring, report, disposable server, and runner; offline tests and static gates
  pass. Dry run confirms the product template: context mode, quotas events 1 /
  entities 2 / preferences 1 / experiences 1 / resources 1 / skills 2, 1,200
  tokens, threshold 0.35. A dummy-key lifecycle smoke started 0.4.16 in dev mode
  in ~17 s, created a session, and verified process exit plus data-root removal.
  Live run awaits a user-created external credential file.
- 2026-10-01: Live baseline completed with exact cleanup; findings recorded.
  Next phase (not yet authorized): train-split hill-climbing over threshold,
  per-category quotas, and token budget, accepting only test-confirmed gains.
- 2026-10-01: Added `--variant`/`--skip-ceiling` to the runner and ran two
  tuning rounds. Threshold is the only test-confirmed gain; quota gains are
  train-only and deferred. Product unchanged pending confirmation.
- 2026-10-01: Real-store count check found 2 memories; threshold 0.45 recommended, quotas deferred.
- 2026-10-01: Changed the default threshold to 0.45 in domain, Extension
  `config.ts` and `config.json`; saved user values are not migrated. Added
  default/saved-value tests, refreshed the Extension tree hash in the capability
  source lock, and noted the divergence in `UPSTREAM.md`. Re-run
  `20261001T054318Z-25a6e6b3` reproduces the 0.45 variant exactly.

## Closeout

- Base SHA: `fd5fbf5` plus the uncommitted scoped diff.
- Changed files: `eng/evals/openviking-recall-baseline/*`, `package.json`,
  `packages/domain/src/context-memory.ts`,
  `packages/openviking-pi-extension/{config.ts,config.json,config.test.ts,UPSTREAM.md}`,
  `apps/agent-host/src/context/context-memory-configuration.test.ts`,
  `eng/capabilities/capability-sources.lock.json`, this plan.
- Validation completed: offline evaluation tests, affected package suites,
  aggregate `check` static gates, `test:coverage` (897 files / 5,845 tests;
  one unrelated crash-recovery timing failure under load passed 5/5 in
  isolation and in the full coverage rerun), live baseline, two tuning rounds,
  and post-change re-run.
- Validation not completed: expansion (VLM) arm, Agent-level task evaluation,
  Windows, real-store calibration (store too sparse).
- Remaining risks: thin score margin between relevant and unrelated memories;
  thresholds are bge-m3 specific; quota changes deferred until real memories
  accumulate.
- Commit/push/release state: none authorized.
