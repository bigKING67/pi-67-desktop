# OpenViking 0.4.16 → 0.4.22 upgrade

Status: active
Owner: Claude Code
Started: 2026-10-01
Last updated: 2026-10-01

## Goal

Run the managed local OpenViking on 0.4.22 behind the existing Pi-67 Extension
fork with Recall, private Tools, Commit/extraction, and team index at parity or
better, and pick up upstream fixes (archive lock contention, query-embedding
cache, extraction reliability, honest extraction failure).

## Non-goals

- Adopting upstream pi extension 0.4.0's MCP tool surface (`openviking_*`); it
  adds write/edit/watch tools that conflict with private-by-default URI scope and
  privacy write gating.
- Account-level runtime configuration, ACL, Compile, Bot, or other new server
  surfaces.
- Windows managed runtime (not shipped yet); only the prepared Windows lock and
  wheels are kept consistent.

## Acceptance criteria

- No uid-less `viking://user/{memories,resources,skills,peers,...}` URI is sent
  by Extension, Agent Host, or team workers; tests pin the canonical form.
- Recall baseline on 0.4.22 reaches at least the 0.4.16 Hit@1/Hit@3/MRR on both
  splits with no higher false injection or token use, after threshold
  recalibration for the cosine score change.
- A forced unparseable extraction surfaces as a failed Commit in the Desktop
  outcome path; normal Commit extracts memories with the chosen output format.
- An existing 0.4.16 data root opens under 0.4.22 after a pre-upgrade snapshot;
  rollback restores the snapshot.
- Packaged macOS arm64 smoke plus native probes pass; Recall, Commit, and team
  query work in the packaged app.

## Delivery boundary

- Local implementation: requires confirmation of this plan.
- Commit: per checkpoint after gates pass.
- Push / candidate / R2 / release: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Upstream latest is v0.4.22 (2026-09-28); six releases after the pinned 0.4.16. | `gh release list`, PyPI | 2026-10-01 |
| OBSERVED | v0.4.22 maps local cosine scores to `(cos+1)/2`; thresholds are not adjusted; ranking unchanged; no rebuild. | v0.4.22 notes item 6 (#5358) | 2026-10-01 |
| OBSERVED | v0.4.17 rejects uid-less current-user URIs with HTTP 400. | v0.4.17 notes | 2026-10-01 |
| OBSERVED | v0.4.20 changes extraction default output to a Python DSL; v0.4.22 fails Commit on unparseable extraction. | v0.4.20 migration table, v0.4.22 item 2 | 2026-10-01 |
| OBSERVED | `recall_intent_timeout_s` stays 5 s and the default intent prompt is unchanged in 0.4.22. | source at tag | 2026-10-01 |
| INFERRED | Uid-less URIs appear in `private-uri-policy.ts:20-21,32,70-77`, `context-memory-command-router.ts:290-291`, `experience-candidate-assembler.ts:70`; `recall-core.mjs` and `profile-inject.mjs` resolve them client-side. | read-only research | 2026-10-01 |
| INFERRED | tree-sitter pins conflict with both requirements locks; litellm and query patches are sha-pinned to 0.4.16 source; version string appears in installer, admission, prepare/sign/cleanup scripts, team workers, and packaged smoke. | read-only research | 2026-10-01 |
| INFERRED | A 0.4.16 root opens forward without manual migration; a root written by 0.4.22 is likely unreadable by 0.4.16. | upstream PRs #4700, #4819, #5091, #4832 | 2026-10-01 |

## Affected boundaries

- Modules/processes: `packages/openviking-pi-extension` (URI policy, tools,
  takeover), `apps/agent-host/src/context`, `apps/desktop` (installer,
  admission, native process `ov.conf`), `eng/capabilities` (requirements locks,
  runtime/query patches, team workers, prepare/sign/cleanup), `eng/packaging`
  smoke and probes, `eng/evals/openviking-recall-baseline` version pin.
- Persisted state: user data root (forward-only); saved `scoreThreshold` values
  in `openviking.json`; team index publications.
- Platform/artifact: rebuilt and re-signed macOS arm64 runtime; Windows lock
  kept consistent.
- Security/privacy: actor scope and private URI policy must stay fail-closed
  under the new URI rules.

## Decisions (to confirm)

| Decision | Proposal | Reversal condition |
| --- | --- | --- |
| Canonical URI form | Explicit `viking://user/<uid>/…` (already resolved client-side) rather than `viking://~/…`. | `~` is required by an endpoint we use. |
| Extraction output format | Pin `memory.extraction_output_format: "json"` first; evaluate `python` separately. | DSL proves more reliable on the user's models. |
| Threshold after cosine change | Keep settings and saved values in raw cosine; clients read `/health` and send `(t+1)/2` to 0.4.22+, unknown versions treated as normalized (stricter). No persisted migration; downgrade needs no reverse conversion. | Server exposes a scale-independent threshold. |
| Delete safety gate `score > 0.8` (`tools.ts`) | Recalibrate to the equivalent normalized value. | — |
| Query-embedding patch | Retire if the coalescing probe passes on 0.4.22's native cache. | Probe regresses. |
| litellm runtime patch | Re-derive against 0.4.22 or drop if upstream fixed it. | — |
| Team index cross-version | Gate publication/reads by server version until all members upgrade. | Upstream guarantees compatibility. |

## Checkpoints

- [x] 1. URI canonicalization in Extension/Agent Host with tests, verified against 0.4.16 (team workers had no uid-less URIs).
- [x] 2. Recompile macOS and Windows requirements locks for 0.4.22; verify wheels.
- [x] 3. Rebase runtime patch, keep the unshipped query patch 0.4.16-only; move every version pin together.
- [x] 4. `ov.conf`: JSON extraction output and `vlm.max_tokens` 8192; Commit observation already maps failed/cancelled.
- [x] 5. Recalibrate on 0.4.22: settings stay raw cosine and convert per server version (no saved-value migration); defaults 0.48 + recallLimit 15.
- [ ] 6. DEFERRED to a separate change: upstream shared libs drifted by hundreds of lines (recall-core 357, credentials 319, profile-inject 263) against our privacy-gate edits; not required for 0.4.22 compatibility.
- [x] 7. Team workers on 0.4.22: broker shim supports `DefaultHttpxClient` placeholders; worker tests 22/22. Team index is a local per-member projection, so no cross-member version gate is needed.
- [ ] 8. Data-root snapshot/rollback procedure; packaged macOS smoke and native probes; Windows lock/wheel evidence.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Unit | affected Vitest suites, Python worker tests | URI, Commit outcome, config | pending |
| Contract | real-message contract test against a 0.4.22 server | Recall/Commit/Tools | pending |
| Eval | `eval:openviking-baseline:live` on 0.4.22 | parity after recalibration | pending |
| Native | query-embedding and team-index probes | no regression | pending |
| Packaged | `preview:mac:unsigned` smoke | packaged Recall/Commit/team query | pending |
| Windows | lock and wheel resolution | evidence only | pending |

## Rollback

Snapshot the managed data root before the first 0.4.22 start. Rolling back means
restoring that snapshot with the 0.4.16 runtime, not re-pinning 0.4.16 on a root
already written by 0.4.22.

## Risks and unknowns

- Score drift silently floods context if any threshold is missed.
- User-selected extraction models may handle the Python DSL poorly (hence JSON
  first).
- Downgrade incompatibility of the data root.
- Unknown `ov.conf` fields only warn in 0.4.22, so typos become silent.
- The meaning of "explicitly resolved query planner" (#5323) must be confirmed
  with the planner eval.

## Progress log

- 2026-10-01: Upgrade-impact research completed; plan proposed for confirmation.
- 2026-10-01: Confirmed; status active. Checkpoint 1: Extension policy and Agent
  Host emit `viking://user/<uid>/…` (or `viking://~/…` without identity) and
  rewrite legacy uid-less input. On 0.4.16 with a user key, `~`, explicit, and
  uid-less forms all resolve and results are explicit; under ROOT/dev mode `~`
  returns 400 INVALID_URI and uid-less returns 404/empty, so managed Desktop
  (always has a user) uses the explicit form. Pre-existing gap kept: a standalone
  config without a user filters explicit result URIs. Aggregate gate passed.
- 2026-10-01: Work moved to temporary worktree `../pi-67-desktop-ov022` (branch
  `openviking-0.4.22`, user-authorized) because a concurrent team-chat session
  edits the root checkout; root was restored to 0.4.16 behaviour. Backup patch at
  `~/.config/pi67-eval/upgrade-wip-20261001-1815/`.
- 2026-10-01: Checkpoints 2/3/5. Locks recompiled (macOS with
  `MACOSX_DEPLOYMENT_TARGET=14.0`): Office parsers → firecrawl-anydoc, rapidfuzz
  added, tree-sitter pins lowered to upstream. Two of three lazy-LiteLLM targets
  are byte-identical in 0.4.22; only `embedding_config.py` sha moved. Prepared
  `preparation-znBwdm` (private-lazy-litellm-v1) with native probe PASS (13
  checks). Baseline on 0.4.22: 0.725 reproduces 0.4.16@0.45 exactly; 0.4.22 now
  indexes memory directory overviews, which took the single preferences slot for
  `commit-2` (file list only, content lost). Product defaults 0.48 raw (0.74
  normalized) + recallLimit 15 on 0.4.22: train Hit@3 81.8% MRR 0.783, test
  Hit@1 72% Hit@3 88% MRR 0.800, false injection 29%/25%, ~385 tokens, versus
  shipped 0.4.16@0.45: 79.5%/0.767, 76%/88%/0.820, 71%/50%, ~393. Test Hit@1/MRR
  regress by the one directory-overview case (upstream behaviour, no API filter).
- 2026-10-01: Checkpoints 4/7. Team-index and team-query runtimes prepared on
  0.4.22 (native probes PASS). `team_model_transport_test` caught a real break:
  0.4.22 SDK backends build `openai.DefaultHttpxClient` first; the broker facade
  now returns an inert placeholder and rejects any real HTTP client. Team search
  only ranks scores, so the cosine normalization does not affect it. Automatic
  ended/long-session Commits do not observe extraction outcome; a failed archive
  is not re-extracted automatically (unchanged behaviour, now visible as failed
  in explicit Commits).

