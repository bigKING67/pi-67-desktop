# Searchable automatic Session titles

Status: completed
Owner: Codex
Started: 2026-08-24
Last updated: 2026-08-24

## Goal

Persist and boundedly rebuild automatic latest-user titles in the disposable
Session Catalog index so visible and whole-catalog title search stays
authoritative across SQLite and fallback.

## Non-goals

- Do not search full conversation bodies from the navigation field.
- Do not persist generated names into Pi JSONL or change Pi SDK naming semantics.
- Do not add fuzzy search, change ranking/page size, or create a Renderer-owned
  Session index.
- Do not mix the independent shell focus/border polish into this runtime fix.
- Do not commit, push, release, promote, or distribute without separate approval.

## Acceptance criteria

- [x] A real temporary JSONL with latest-user title
  `小红书笔记需要怎么写呀` is returned for search `小红书` on ready SQLite
  and injected `sdk-fallback` paths after automatic-title indexing settles.
- [x] SQLite persists and validates `automatic_name`, derives `search_name`
  using display-name precedence, replaces the disposable schema safely, and
  preserves derived titles only for unchanged physical Session versions.
- [x] Fresh-Catalog indexing covers more than one page with at most four active
  title reads; concurrent searches share the same flight and stale generations
  cannot write or publish.
- [x] A nonempty search waits for pending automatic-title work or reports genuine
  incompleteness instead of returning an authoritative empty page too early.
- [x] Applied title batches advance Catalog revision before publication and
  invalidate cursors created before the searchable set changed.
- [x] Explicit-name/path/ID search, escaped LIKE input, active/archived views,
  organization state, recovery, ordering, and request-race behavior stay green.
- [x] Targeted pi-runtime, Protocol, Renderer, type-check, lint, build, diff, and
  Session Catalog performance gates pass.
- [x] After the complete user-visible change set passes its gates, rebuild,
  smoke, and open the exact unsigned macOS arm64 repository artifact.

## Delivery boundary

- Local implementation: existing WIP preserved; no additional product scope was
  authorized by the workflow-scaffold removal.
- Commit: not authorized
- Push: not authorized
- Candidate build/upload: not authorized
- Tag/release/promotion: not authorized

## Current evidence

| State | Evidence | Source | Verified at |
| --- | --- | --- | --- |
| OBSERVED | A visible latest-user title containing `小红书` was not returned for the same normalized substring. | user-supplied runtime evidence | 2026-08-24 |
| OBSERVED | SQLite filters `search_name` before the runtime overlays the asynchronous latest-user title. | current pi-runtime source trace | 2026-08-24 |
| OBSERVED | The working tree already contains the schema, scheduler, runtime, and regression-test implementation WIP. | live Git diff | 2026-08-24 |
| OBSERVED | Targeted and full Pi runtime tests, Renderer/Electron E2E, type-check, lint, build, diff, and Catalog performance gates passed. | live commands and exact packaged smoke | 2026-08-24 |
| OBSERVED | The exact unsigned macOS repository artifact returned the `小红书笔记需要怎么写呀` row for `小红书`; clearing the query restored the ordinary list. | packaged Electron accessibility inspection | 2026-08-24 |

## Affected boundaries

- Modules/processes: `packages/pi-runtime`, Agent Host-owned Session Catalog
  projection, existing Renderer query transport.
- Protocol or persisted state: disposable SQLite schema and Catalog revision;
  Pi JSONL remains unchanged.
- Platform/artifact: shared runtime behavior; exact packaged verification is
  macOS arm64 only unless real Windows evidence is separately obtained.
- Security/privacy: automatic names remain inside the private disposable Catalog
  projection and are not logged or written back to Session truth.
- Existing WIP: preserve the independent Renderer shell-polish diff and tests.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Store nullable `automatic_name` in the existing disposable projection. | Search must index the same title the Catalog displays without creating another Session truth. | Pi SDK provides a supported authoritative indexed title field. |
| Use `explicit_name -> automatic_name -> fallback_name` for display and normalized search. | SQLite and fallback must expose identical semantics. | Product explicitly changes title precedence. |
| Share one generation-scoped, four-reader title-index flight. | Whole-catalog indexing must remain bounded, cancellable, and deduplicated. | A measured alternative proves equal bounds and simpler correctness. |
| Apply resolved titles in batches of at most 16 and advance revision before publication. | Avoid per-record revision churn while keeping cursor invalidation truthful. | Performance evidence requires a different bounded batch contract. |
| Await current title work only for nonempty searches. | Prevent false empty results without blocking ordinary catalog pages. | A typed incremental-search result contract replaces settlement waiting. |

## Projection and lifecycle contract

The searchable Session record includes physical identity, Session ID/path,
optional explicit and automatic names, modification metadata, and message count.
SQLite stores nullable `explicit_name` and `automatic_name` plus normalized
`search_name` derived from the effective name.

- Agent Host owns whole-catalog search; Renderer never filters only materialized
  rows as an authoritative substitute.
- A nonempty search waits for current reconcile, automatic-title reads, pending
  records, and scheduled title-write batches before reading its page.
- A title callback verifies source generation, physical identity, ID, path,
  `modifiedAt`, and `messageCount` before applying.
- Source replacement or disposal detaches old work. Stale callbacks write and
  publish nothing.
- `session-created`, `session-updated`, and `session-imported` unnamed records
  enter the same current-generation flight without forcing full reconciliation.
- A failed current read marks the Catalog truthfully incomplete; a valid no-title
  result keeps the fallback name without manufacturing an error.
- Automatic names survive reconcile/reopen only while the complete physical
  Session version remains unchanged.
- SQLite write failure demotes truthfully through the existing bounded fallback
  and reconcile path; it never reports partial success as authoritative.

## Checkpoints

- [x] 1. Trace the missing-search root cause and reject Renderer-only filtering.
- [x] 2. Define SQLite/fallback projection, batching, cancellation, and cursor
  contracts before implementation.
- [x] 3. Review the existing WIP against the complete contract and close any gaps.
- [x] 4. Pass targeted regression, schema, race, type, lint, build, and performance
  checks without weakening existing tests.
- [x] 5. Complete risk-selected review and exact macOS packaged verification.

## Validation matrix

| Layer | Command or procedure | Required evidence | Result |
| --- | --- | --- | --- |
| Source | focused diff review and `git diff --check` | one projection authority, bounded generation checks, no unrelated WIP | passed |
| Tests | targeted pi-runtime/SQLite/Renderer tests | Chinese search parity, schema/reopen, batching, stale callback/cursor, races | passed; Pi runtime 528 passed + 1 skipped, Renderer E2E 16 passed, Electron E2E 4 passed |
| Quality | type-check, lint, build, architecture and full relevant gates | exit 0 without disabled coverage | passed |
| Performance | `corepack pnpm run performance:session-catalog` | bounds remain inside the declared gate | passed; 10k warm first-page p95 1.947 ms, miss-search p95 6.582 ms, rebuild first-page p95 1.963 ms |
| Packaged artifact | `corepack pnpm run preview:mac:unsigned` | exact repository artifact packaged, smoked, and opened | passed; app.asar SHA-256 `24253e701b1a6d4e87f5812c5292897883152e0e15877306a2bc2d9d58068d38` |
| Target OS/manual | real Windows x64 candidate | separately authorized native evidence | not authorized |

## Rollback

Revert only the scoped Session Catalog source and tests. The SQLite database is
disposable: schema mismatch recovery rebuilds the prior projection, while Pi
JSONL remains untouched. Preserve the independent Renderer shell-polish WIP.

## Risks and unknowns

- Concurrent replacement generations may expose a stale callback unless every
  apply path verifies the full physical version.
- Waiting semantics must include queued write batches, not only active reads.
- Incomplete/skipped state must distinguish read failure from a valid no-title
  result and must not be cleared by a stale generation.
- Current code changes are substantial and have not been revalidated as part of
  the workflow-scaffold removal.

## Progress log

- 2026-08-24: Reproduced/traced the authoritative-search mismatch and wrote the
  projection and bounded-index design.
- 2026-08-24: Preserved the active Trellis task as this ordinary execution plan
  before removing the repository-wide workflow scaffold.
- 2026-08-24: Closed the source, race, performance, Renderer/Electron, and exact
  macOS packaged gates. The later semantic-title and content-index work is kept
  outside this completed scope.

## Closeout

- Final source SHA: uncommitted working tree based on `6646c82c021e76758a75a3daa70ececbbc81d2ec`
- Changed files: Session Catalog projection/schema/runtime tests plus the independent
  Renderer shell-focus polish listed by live Git status
- Validation completed: source/diff, targeted and full runtime tests, type-check,
  lint, build, Catalog performance, Renderer/Electron E2E, exact macOS packaged smoke
- Validation not completed: real Windows x64 evidence
- Remaining risks: Windows behavior remains unverified; semantic title generation
  and full-body indexing are separate future scopes
- Commit/push/release state: not authorized
