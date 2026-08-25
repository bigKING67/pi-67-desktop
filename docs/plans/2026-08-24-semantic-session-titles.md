# Stable semantic Session titles

Status: complete (local and uncommitted)
Owner: Codex
Started: 2026-08-24
Last updated: 2026-08-24

## Goal

Replace drifting latest-user automatic titles with a stable two-stage title:
an immediate deterministic seed from the first meaningful user request, then
one bounded semantic title generated after the first successful assistant Turn.
Persist Desktop-generated title metadata in Pi JSONL through a typed custom
entry so the Catalog remains a disposable projection rather than a second truth.

## Non-goals

- Do not replace Pi's explicit `session_info` naming or lower its precedence.
- Do not continuously retitle after every Turn or silently switch Provider/model.
- Do not send Tool payloads, system context, images, or unbounded transcripts to
  title generation.
- Do not implement the separate full-conversation search index in this plan.
- Do not commit, push, publish, sign, notarize, or distribute.

## Acceptance criteria

- [x] Effective precedence is `explicit -> generated -> seed -> fallback` in
  SQLite, fallback, active Task rows, and cold Session rows.
- [x] Seed title uses the first meaningful current-branch user request and no
  longer drifts when later user messages arrive.
- [x] After the first successful assistant Turn, one asynchronous, abortable
  `completeSimple` call uses the Turn's selected model with no Tool exposure and
  no fallback; it never blocks or changes the main Turn result.
- [x] The bounded generation context contains only current-branch user/assistant
  text, prioritizes the first user request and first assistant resolution, and
  excludes system/Tool/raw payload content.
- [x] A typed Pi JSONL custom entry records generated/failure state without raw
  transcript content; generation fences Session identity/generation/model and
  explicit-name changes before persistence.
- [x] Explicit rename remains stable; restoring automatic title reveals the
  generated title when present. Manual regeneration is available for a live Task
  and does not override an explicit title until the user restores automatic mode.
- [x] Activating a historical Session as a live Task schedules one bounded
  automatic generation when the current branch has completed User/Assistant
  context and no explicit/generated/failed title state; cold Catalog browsing
  never bulk-backfills.
- [x] Task transition feedback resolves the current effective Catalog/Task title
  and never exposes an internal unnamed placeholder.
- [x] Protocol, Pi runtime, Catalog schema/recovery, Renderer state, title races,
  type-check, lint, build, and exact macOS packaged gates pass.

## Delivery boundary

- Local implementation: authorized by the user on 2026-08-24.
- Commit: not authorized by the current request.
- Push: not authorized.
- Candidate build/upload: not authorized.
- Tag/release/promotion: not authorized.

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | Current automatic title reader walks backward to the latest non-trivial user message. | `packages/pi-runtime/src/session-automatic-title.ts` | 2026-08-24 |
| OBSERVED | Pi exposes `SessionManager.appendCustomEntry` and the selected Session model/runtime `completeSimple` seam. | installed Pi SDK 0.84.2 types/runtime | 2026-08-24 |
| OBSERVED | Active Renderer rows currently prefer `recentUserMessagePreview`, so a Catalog semantic title alone would not stop visible drift. | Renderer workbench/navigation source | 2026-08-24 |
| OBSERVED | t3code's fixed reference generates a semantic first-turn title and offers bounded manual regeneration rather than continuous retitling. | fixed commit `949feb61e4bfd96669ba0e8cf3dca7c6d7f885b3` | 2026-08-24 |

## Affected boundaries

- Modules/processes: domain title policy, protocol, Pi runtime Session lifecycle,
  Session Catalog projection, Agent Host dispatch, Renderer workbench/navigation.
- Protocol or persisted state: new Task-scoped regeneration command; typed Pi
  JSONL custom metadata; disposable SQLite schema revision.
- Platform/artifact: shared TypeScript behavior; exact packaged evidence on
  macOS arm64 only.
- Security/privacy: bounded user/assistant text is sent only to the already
  selected Provider for title generation; no prompts or response bodies are
  copied into SQLite/logs/diagnostics.
- Existing WIP: preserve completed automatic-title search and shell-focus changes.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Use the first meaningful current-branch user request as seed. | Immediate, offline, stable, and deterministic. | Product chooses a different deterministic seed policy. |
| Generate once after the first successful assistant Turn. | Improves semantics without navigation churn or recurring cost. | User research proves controlled retitling is preferable. |
| Follow the Turn's selected model and fail without cross-model fallback. | Preserves explicit Provider/model authority. | A separately exposed title-model setting is approved. |
| Persist typed custom metadata in Pi JSONL. | Keeps title provenance branch-aware and rebuildable without making SQLite truth. | Pi adds a first-class automatic-title metadata API. |
| Keep explicit Pi `session_info` names authoritative. | Manual user intent must always win. | Product explicitly changes naming precedence. |
| Expose regeneration only for a live Task. | A cold Session has no selected-model runtime; silently loading one would violate lifecycle and Provider contracts. | A user-visible cold-session generation workflow is designed and approved. |
| Lazily generate historical titles only after live activation. | This closes the upgrade gap without bulk Provider cost, cold-session loading, or startup privacy drift. | Product explicitly approves a bounded bulk-backfill workflow. |

## Checkpoints

- [x] 1. Define title metadata, parsing, seed, sanitization, prompt, and generation fences with unit tests.
- [x] 2. Integrate automatic generation and manual regeneration through Pi/runtime/protocol without blocking Turns.
- [x] 3. Project source precedence through Catalog/SQLite/Renderer and remove visible latest-user drift.
- [x] 4. Pass targeted/full gates and exact macOS packaged verification.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Domain/runtime | targeted Vitest suites | seed stability, prompt bounds, no tools/fallback, once-only, abort/stale/explicit races | passed in 96-test semantic slice |
| Protocol/host | protocol and dispatcher tests | validated Task command, persistence/acknowledgement | passed; protocol revision `7b99fb90c89ec73a025ab3fd64fe61098b83569578a72ba73a897bc526849cbb` |
| Catalog | SQLite/fallback/recovery tests | generated/seed precedence, schema integrity, cold rebuild parity | passed in targeted slice |
| Renderer | unit + Playwright Electron/Renderer | active row stability, manual action semantics, no focus regression | 20 Renderer production-preview tests and 4 real-Host Electron tests passed; follow-up Catalog/search slice passed 18/18 |
| Quality | full test, type-check, lint, build, `git diff --check` | all exit 0 | full test: 3,044 passed, 3 skipped; all other gates passed |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | exact repository artifact smoked/opened and title flow inspected | passed; `app.asar` SHA-256 `d5adbc1d4f7f208397ecb476de9b0a7efe852340f8254dfd37feb0180bc7fbb7`, opened as PID 921 |
| Historical live title | Activate the existing 42-message seed-only Session without sending a new prompt | selected Provider generates once; top bar, row, Catalog, and Pi JSONL converge without unnamed copy | passed; `你是谁` became `杭州天气查询与出行建议`; Catalog source is `generated`; Pi JSONL records `deepseek/deepseek-v4-flash` |
| Target OS/manual | real Windows x64 | separately authorized native evidence | not authorized |

## Rollback

Revert only the scoped semantic-title, protocol, Catalog schema, Renderer title
policy, and tests. Pi JSONL custom entries are inert to Pi context and ignored by
older Pi-67 builds; SQLite is disposable and rebuilds under the prior schema.
Explicit `session_info` titles and conversation content remain untouched.

## Risks and unknowns

- Direct custom-entry append must be followed by a synchronized Catalog upsert so
  current Task and cold Catalog views converge without treating a stale callback
  as current.
- Provider failure must not fail the user Turn or create repeated automatic cost.
- Branch rollback/fork must select only title metadata on the active branch.
- Existing Session files may exceed the bounded automatic-title reader window;
  those records must stay visibly incomplete rather than return false authority.

## Progress log

- 2026-08-24: Confirmed Pi SDK seams, current Renderer drift path, and fixed t3code
  reference behavior; opened implementation after user authorization.
- 2026-08-24: Implemented semantic metadata/generation, stable seed precedence,
  live-Task regeneration, Catalog schema projection, and active-row stability.
  The 96-test semantic slice plus repository type-check/lint/diff check passed;
  final protocol revision/build/packaged evidence is intentionally shared with
  the immediately following unified-search delivery.
- 2026-08-24: Completed the integrated search/title gates, updated packaged
  smoke assertions to verify prompt projection in conversation content rather
  than the retired latest-user title behavior, and passed the exact unsigned
  macOS arm64 preview command.
- 2026-08-24: Live Catalog evidence showed upgraded historical Sessions remained
  `seed`-only and Task transition feedback captured the pre-Catalog unnamed
  placeholder. Added live-activation lazy generation and effective-title
  transition copy.
- 2026-08-24: Passed the 79-test focused regression slice, full 3,044-test
  repository gate, type-check, lint, diff check, and 18-test Renderer
  Catalog/search E2E slice. Rebuilt and opened the exact unsigned macOS artifact,
  then activated the historical Session without a new prompt. The selected
  DeepSeek V4 Flash model generated `杭州天气查询与出行建议`; the live Renderer,
  disposable Catalog projection, and typed Pi JSONL metadata converged.

## Closeout

- Source boundary: uncommitted working tree based on `6646c82`; no final source
  SHA exists until a separately authorized commit.
- Changed files: scoped domain/protocol/Pi runtime/Agent Host/Renderer behavior,
  tests, smoke contracts, design authority, and execution plans.
- Validation completed: targeted and full tests, type-check, lint, build,
  Renderer production preview, real-Host Electron, performance, packaged smoke,
  and exact unsigned macOS arm64 preview/open.
- Validation not completed: real Windows x64; it is not authorized or required
  for this local macOS closeout.
- Remaining risks: Provider-dependent title quality still needs normal product
  usage observation across more conversations; deterministic seed and explicit
  rename remain safe fallbacks.
- Commit/push/release state: not authorized and not performed.
