# Dedicated OpenViking query planner for Recall expansion

Status: completed locally
Owner: Claude Code
Started: 2026-10-01
Last updated: 2026-10-01

## Goal

Let users choose an optional, fast Recall query-planner model so current-prompt
query expansion completes inside OpenViking's 5 s budget, following upstream's
documented `query_planner` + thinking-off configuration, and stop paying the
expansion wait when no suitable planner is configured.

## Non-goals

- Changing OpenViking's intent prompt, timeout default, or bundling Ollama for
  the upstream fine-tuned planner.
- A second model router or Runtime: the planner is a Pi Provider/model selection
  resolved through the existing local-memory model resolution path.
- Windows managed runtime (not shipped).

## Acceptance criteria

- Settings offer an optional "Recall query planner" Pi model next to extraction
  and embedding; unset keeps today's behaviour except as decided below. Saving
  applies on next start like the other memory models.
- `ov.conf` gains `query_planner` only when configured; its key reaches the
  child through its own environment variable, never the file.
- Thinking is disabled for the planner request using the provider-correct switch
  (`enable_thinking: false` for Qwen-style OpenAI-compatible endpoints,
  `thinking: {type: "disabled"}` for Ark), derived from Pi model metadata rather
  than free-form user input.
- Team index settings projection keeps working with the new optional field.
- On the recall baseline with the recommended default planner, follow-up
  Hit@1/Hit@3 improve over expansion-off, expansion succeeds for most follow-up
  prompts within 5 s, and no other slice regresses.
- PRODUCT/DESIGN state the planner fallback and latency trade-off explicitly.

## Delivery boundary

- Model comparison eval: authorized (user-paid, small).
- Implementation: requires confirmation of this plan.
- Commit after gates; push/candidate/release not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | With the planner falling back to the extraction model, expansion timed out for 0/8–2/8 follow-ups on five SiliconFlow models (5 s budget), adding ~5.4 s per prompt with history and no hit gain. | baseline runs `20261001T08*` | 2026-10-01 |
| OBSERVED | Qwen3.6-35B-A3B with `enable_thinking: false` expanded 21/24 follow-ups in time; follow-up Hit@1 2/6 → 5/6, Hit@3 3/6 → 5/6; overall Hit@3 82.6% → 85.5%; p50 4.0–5.4 s on prompts with history. | 3-repetition baseline | 2026-10-01 |
| OBSERVED | Upstream documents `query_planner` (falls back to `vlm`) with `thinking: false`; `extra_request_body` is supported for planner and VLM. | v0.4.22 `docs/zh/configuration/01-server.md` | 2026-10-01 |
| INFERRED | Extraction is a Pi `{provider, model}` selection resolved by the Host to `{endpoint, model, apiKey}`; settings, protocol, controller, preload, and renderer layers each need an optional planner field; team index broker forwards raw settings into a strict schema. | read-only research | 2026-10-01 |
| OBSERVED | Ark sweep via OpenViking (`provider: volcengine`, `thinking: false`, 5 s, 3 repetitions, 24 follow-up/task-switch expansions): doubao-seed-2-0-mini 24/24 expanded, follow-up Hit@1 12/18 Hit@3 15/18, p50 2.8 s, max 4.9 s; deepseek-v4-1-flash 23/24, 14/18, 15/18, p50 4.0 s; glm-5-3-flash 20/24, 9/18, 10/18; doubao-seed-2-1-lite 8/24 and doubao-seed-2-1-turbo 5/24 (5.5 s p50). Expansion-off: 6/18, 9/18. | baseline runs `20261001T09*` | 2026-10-01 |

## Affected boundaries

- `apps/desktop`: native process `ov.conf`/env, local-memory service/config
  loader, model settings store, settings controller, team index broker.
- `packages/protocol`: local-memory settings request/snapshot schemas.
- `packages/pi-runtime`: model resolution (reuse extraction resolver; derive the
  thinking-off switch from model metadata).
- `apps/renderer`: `LocalMemoryModelSettings.tsx` field (design-craft baseline).
- `packages/openviking-pi-extension`: expansion on/off decision per managed
  configuration.
- Docs: PRODUCT memory model section, DESIGN settings form.

## Decisions (to confirm)

| Decision | Proposal | Reversal condition |
| --- | --- | --- |
| Behaviour with no planner configured | Turn current-prompt expansion off (no silent fallback to the extraction model, no 5 s wait). | Measurements show common extraction models finish in time. |
| Default planner suggestion | doubao-seed-2-0-mini (thinking off): only model expanding 24/24 within 5 s and lowest latency; deepseek-v4-1-flash as the accuracy-leaning alternative. Shown as a recommendation, not auto-selected. | User prefers auto-selection, or a re-measure after 0.4.22 changes the ranking. |
| Thinking switch source | Derived from Pi model metadata/provider host; unknown providers send no switch. | Pi exposes an explicit reasoning-off capability. |
| Resolution order | Resolve planner after extraction (single-flight client). | Client supports parallel resolves. |

## Checkpoints

- [x] 1. Measure Ark and SiliconFlow candidates on the baseline; recommendation doubao-seed-2-0-mini.
- [x] 2. Protocol + settings store + controller + team broker projection with tests.
- [x] 3. Host resolution + thinking-off derivation (explicit `compat.thinkingFormat` only) with tests.
- [x] 4. Native process `ov.conf`/env; `retrieval.enable_intent` false without a planner; tests.
- [x] 5. Settings UI Provider/model field pair (design-craft L1-F), PRODUCT/DESIGN updates, packaged smoke extended.
- [x] 6. Aggregate gate, packaged macOS smoke (memory settings incl. planner fields), real-app save and live ov.conf verification.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Unit/contract | affected Vitest suites | schemas, env, projection | pending |
| Source | `corepack pnpm run check` | aggregate gate | pending |
| Eval | baseline with planner | follow-up gain, no regressions | pending |
| Packaged | `preview:mac:unsigned` + settings screenshot | real save/next-start | pending |

## Rollback

Revert the scoped commits. Stored settings without the optional field remain
valid; a stored planner field is ignored by older builds only if the schema
rollback also restores the exact-key validation, so revert schema and store
changes together.

## Risks and unknowns

- Even a fast planner adds ~4–5 s before the first token on prompts with
  history; users must see this trade-off.
- Provider-specific thinking switches may drift.
- OpenViking 0.4.22 changes planner resolution (#5323); re-verify during the
  upgrade plan.

## Progress log

- 2026-10-01: Expansion timeout root cause, model sweep, upstream guidance, and
  integration scope recorded; plan proposed.
- 2026-10-01: Ark sweep completed; doubao-seed-2-0-mini recommended, deepseek-v4-1-flash as alternative.
- 2026-10-01: Implemented in `bb2762ac` (Host resolver, protocol schemas and
  revision landed in `a3a40a65` via a concurrent session's broad commit). On
  0.4.22 the OpenAI-compatible path with `extra_request_body:
  {"thinking":{"type":"disabled"}}` expanded 8/8 follow-ups with
  doubao-seed-2-0-mini (p50 2.4 s, max 3.75 s; follow-up Hit@1 5/6). Gates:
  lint, architecture, references, structure, transport, workflows, coverage
  (913 files / 5,920 tests) PASS; knip fails only on another session's
  uncommitted `eng/release` files. Packaged smoke and settings screenshot are
  pending until that session's preview/release script changes settle.
- 2026-10-02: Concurrent sessions committed; main packaged (smoke PASS incl.
  isolated memory-settings save/readback and cold-process readback). Ark added
  as a custom Pi provider `volcengine-ark` (openai-completions, models
  doubao-seed-2-0-mini-260428 and deepseek-v4-1-flash-260910,
  `compat.thinkingFormat: "deepseek"`; key only in Pi auth.json); the Desktop
  resolver derives `{"thinking":{"type":"disabled"}}`. The user saved the planner
  in the real app (screenshot provided); after restart the live ov.conf has
  `retrieval.enable_intent: true` and `query_planner` for the Ark model with an
  environment-only key and the thinking-off body. Live follow-up latency/hit
  observation in real conversations is left to normal use.

