# OpenViking recall A/B/C retrieval pilot

Status: completed locally
Owner: Codex
Started: 2026-09-03
Last updated: 2026-09-03

## Goal

Build and run a reproducible local retrieval pilot that compares no-memory,
official-style current-prompt context recall, and Pi-67's stable-startup plus
cheap-first adaptive recall without creating two product builds or touching
private user context.

## Non-goals

- Do not run the paid 108-run Agent pilot or make a production recall-policy
  decision from retrieval-only evidence.
- Do not read, enumerate, modify, or delete existing private OpenViking Memory,
  Session, Experience, or Pi JSONL data.
- Do not modify DataHub, deploy to VPS/production, apply a production migration,
  publish a candidate, or create a release.
- Do not add a second Agent loop, model router, prompt composer, or production
  recall owner.

## Acceptance criteria

- One test-only runner executes three profiles against the same frozen corpus:
  no-memory, official-style context search, and Pi-67 adaptive cheap-first
  search.
- The live pilot uses a dedicated synthetic OpenViking Account and deletes it
  after the run, including failure paths.
- The runner never accepts a root key value on the command line and never emits
  credentials, response headers, raw private data, or existing tenant content.
- The live run stops after three retrieval failures and still executes exact
  synthetic-Account cleanup, bounding cost when the Lab API is incompatible.
- Every query has an expected synthetic URI and route contract. Results report
  Hit@1, Hit@3, MRR, request counts, fast/expanded proportions, and real p50/p95
  latency separately for each profile.
- The receipt binds the Desktop source SHA, OpenViking server version, official
  upstream exact SHA, corpus SHA-256, configuration, and cleanup result.
- Tests cover policy decisions, metric aggregation, credential redaction, and
  cleanup settlement without requiring the live server.

## Delivery boundary

- Local implementation: authorized in the canonical Desktop checkout.
- Live retrieval pilot: authorized against the existing loopback OpenViking Lab
  using only a disposable synthetic Account.
- Paid Agent pilot: not included; requires a separate run after the retrieval
  report and explicit budget decision.
- Commit: not authorized.
- Push: not authorized.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Local OpenViking Lab is healthy on `127.0.0.1:1933`, reports v0.4.16, and uses `api_key` auth. | live `/health` plus exact container observation | 2026-09-03 |
| OBSERVED | Existing Golden evaluation has six synthetic route decisions with estimated latency; it does not make real OpenViking, embedding, query-expansion, Pi-model, token, or task-success calls. | `eng/evals/openviking-recall-golden*` | 2026-09-03 |
| OBSERVED | Current Pi-67 policy performs one stable startup snapshot, then a bounded `/find` and only expands weak, empty, or ambiguous results through session-aware `/search`. | current extension source | 2026-09-03 |
| OBSERVED | OpenViking upstream `main` resolves to `63ba98cadb1d6816bfa8617627f192fcc86cd726` at experiment planning time. | live `git ls-remote` | 2026-09-03 |

## Affected boundaries

- Modules/processes: `eng/evals/openviking-ab`, package scripts, execution plan.
- Protocol or persisted state: no production protocol or durable product state;
  generated evidence stays under ignored `artifacts/evidence`.
- Platform/artifact: local macOS arm64 runner and loopback OpenViking only; no
  packaged app claim in this phase.
- Security/privacy: external root-key file, in-memory synthetic user key,
  synthetic Account only, bounded result metadata, exact cleanup.
- Existing WIP: Desktop was clean at `30d7fae809f9d4fa26072d161fde988940300710`;
  DataHub's unrelated dirty WIP remains untouched.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Use one runner with three isolated profiles, not two App builds. | Keeps source, server, corpus, model-independent retrieval inputs, and host constant. | Product-runtime evidence later requires a packaged comparison of the winning policy. |
| Run a controlled-policy comparison before an out-of-box default comparison. | Prevents larger official budgets or broader scope from masquerading as a better algorithm. | The product decision explicitly changes from policy quality to installer-default comparison. |
| Use shared synthetic Resources inside one disposable Account for this first pilot. | Gives deterministic, non-private URI ground truth without invoking private Memory extraction. | A later private-memory pilot is separately authorized with an equally isolated corpus. |
| Treat official-style as a policy arm pinned to an upstream SHA, not a maintained second Extension. | Avoids adding another production owner or permanent fork. | Exact official plugin integration becomes the object under test rather than recall policy. |
| Keep the existing v0.4.16 Server constant for all arms. | Avoids conflating client policy with a server-version change. | A separate upstream compatibility experiment intentionally compares server versions. |

## Checkpoints

- [x] 1. Add frozen synthetic corpus, policy runner, metrics, receipt, and offline tests.
- [x] 2. Verify source gates and dry-run safety without a live server.
- [x] 3. Run the live disposable-Account Retrieval Pilot and retain the receipt.
- [x] 4. Verify cleanup, summarize results and limitations, and decide whether
  the paid Agent pilot is justified.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Offline unit | focused Vitest | strategy, metrics, redaction, receipt invariants | PASS: 2 files / 7 tests |
| Source | aggregate `corepack pnpm run check`, diff check | no product/runtime regression | PASS: 658 files / 3363 tests; all static gates and coverage thresholds passed |
| Live OpenViking | test runner with external root config | real retrieval, latency, Account cleanup | PASS: 60/60, 0 failures, exact Account cleanup |
| Packaged artifact | none in retrieval phase | explicitly not claimed | not applicable |
| Agent task outcome | 108-run pilot | separate paid phase | not authorized |

## Rollback

Remove only the new A/B evaluation directory, package script, and this plan.
Generated receipts remain ignored and may be removed by exact run directory.
Never modify OpenViking private namespaces, Pi JSONL, product configuration, or
DataHub to roll back this test-only work.

## Risks and unknowns

- Resource ingestion may produce model-dependent abstracts and similarity
  scores; URI ground truth and repeated queries reduce but do not eliminate that
  variance.
- Official-style context search may use query expansion and therefore cost more
  and take longer than the adaptive fast path. This is part of the measurement,
  but the root/provider credentials must never appear in artifacts.
- Retrieval-only evidence cannot measure whether Pi notices a task change and
  calls `viking_search`; that belongs to the later Agent pilot.
- OpenViking background indexing may require bounded readiness polling before a
  corpus is searchable.

## Retrieval findings

The accepted live run is
`20260903T074305Z-0e2fd44f-4aec-4e7a-baca-9f93d88c42a2`. It used OpenViking
v0.4.16, 12 synthetic Resources, and 60 frozen bilingual queries. All live
retrievals completed and the disposable Account was deleted and verified
absent.

Evidence artifacts:

- `receipt.json`: SHA-256
  `5f5cfb304bff882abf29143944ba290cd8e229916fb13da48ad60a8c8d6bad3e`
- `results.ndjson`: SHA-256
  `bfb22843e718dbc3eaaa171e8f11ffde226f111fe011e0974c3191e0910036c4`
- `report.md`: SHA-256
  `1a25c85b5de64d6d61d436c53bb8b6a17c012aec5b81cd0588d93641f75a24e3`

| Profile | Hit@1 | Hit@3 | MRR | p50 | p95 | Retrieval requests |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| no-memory | 0.0% | 0.0% | 0.000 | 0 ms | 0 ms | 0 |
| official-style context every prompt | 93.3% | 98.3% | 0.958 | 278 ms | 589 ms | 60 |
| current Pi-67 adaptive `0.72/0.10` | 93.3% | 98.3% | 0.958 | 534 ms | 873 ms | 120 |
| observed find-only candidate | 93.3% | 98.3% | 0.958 | 226 ms | 415 ms | 60 |

The current adaptive score floor never selected the fast route: all 60 cases
paid for `/find` plus `/search`. The `/find` result alone matched the aggregate
accuracy of context search. Context expansion changed the returned list in 8
cases but changed the expected document's rank in none of them. Lower-threshold
replays reduce expansion, but even the best replay still uses 79 requests and
has a 673 ms p95, so it remains dominated by the observed find-only candidate
on this corpus.

This does not prove that context expansion has no value. The corpus contains
well-formed standalone retrieval queries and cannot measure ambiguous follow-up
Turns where Session context may disambiguate intent. Therefore the production
policy remains unchanged. The next paid task-level pilot should compare
no-memory, official-style context recall, and stable-startup plus find-only
search with on-demand deep read; it must include follow-up and task-switch
cases before any production policy decision.

## Progress log

- 2026-09-03: Confirmed a clean Desktop checkout, preserved DataHub WIP, verified
  the live loopback Lab, pinned the official upstream reference, and selected a
  single-runner controlled-policy design.
- 2026-09-03: First live run completed 60 queries but recorded one adaptive
  `/find` timeout; cleanup passed. Kept the failed receipt as an independent
  reliability sample instead of relabeling it.
- 2026-09-03: Added stage-level find/context telemetry and lower-threshold
  counterfactual replay, then completed the accepted live run with 0 failures.
  The evidence supports a find-only candidate for task-level A/B, not an
  immediate production threshold change.
- 2026-09-03: Final aggregate gate passed with 658 test files and 3363 tests;
  final evaluation-source hash matches the accepted live receipt. A post-run
  admin inventory check confirmed both synthetic Accounts remain absent, and
  the exact external Root Credential had zero matches in scoped source and
  evidence.

## Closeout

- Base Git SHA: `30d7fae809f9d4fa26072d161fde988940300710`.
- Final uncommitted evaluation sources: bound by `source.runnerSha256` in the
  accepted receipt and verified equal after all source-quality fixes.
- Changed files: this plan, `package.json`, and `eng/evals/openviking-ab/*` only.
- Validation completed: focused tests, dry-run, typecheck, lint, structure,
  diff check, two live disposable-Account runs, and exact cleanup verification.
- Validation not completed: paid Agent pilot, packaged comparison, Windows,
  VPS/production
- Remaining risks: retrieval-only synthetic evidence does not measure Pi Tool
  choice, end-task success, follow-up ambiguity, task switching, token savings,
  or real user-corpus relevance.
- Commit/push/release state: none authorized
