# OpenViking 0.4.16 → 0.4.22 upgrade

Status: proposed
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
| Threshold after cosine change | Recalibrate with the baseline; expected near 0.72 for the current 0.45. Migrate saved values equal to an old default (0.35 or 0.45) only; keep other custom values with a visible note. | Calibration shows a different mapping. |
| Delete safety gate `score > 0.8` (`tools.ts`) | Recalibrate to the equivalent normalized value. | — |
| Query-embedding patch | Retire if the coalescing probe passes on 0.4.22's native cache. | Probe regresses. |
| litellm runtime patch | Re-derive against 0.4.22 or drop if upstream fixed it. | — |
| Team index cross-version | Gate publication/reads by server version until all members upgrade. | Upstream guarantees compatibility. |

## Checkpoints

- [ ] 1. URI canonicalization in Extension/Agent Host/team workers with tests, verified against 0.4.16 first.
- [ ] 2. Recompile macOS and Windows requirements locks for 0.4.22; verify wheels.
- [ ] 3. Rebase or retire runtime and query patches; move every version/sha pin together.
- [ ] 4. `ov.conf` decisions (extraction format, output token cap) and Commit-failure handling test.
- [ ] 5. Recalibrate Recall threshold and delete gate on 0.4.22 with the baseline; migrate default-equal saved values.
- [ ] 6. Port selected upstream pi fixes (archive-safe takeover #5321, camelCase toolResult #4940, non-blocking session_start #4506, batched replay #4692).
- [ ] 7. Team worker compatibility and cross-version gating.
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
