# Indexed unified Session search

Status: complete (local, uncommitted)
Owner: Codex
Started: 2026-08-24
Last updated: 2026-08-24

## Goal

Make the navigation search return both Session-name matches and conversation
content matches without scanning bounded recent JSONL files on every keystroke.
Build a private, disposable SQLite token index from active Pi JSONL branches,
return at most one verified content hit per Session, and keep the existing
message-locate flow as the navigation authority.

## Non-goals

- Do not make SQLite a Session or message truth source.
- Do not persist message bodies, snippets, prompts, Tool payloads, or system text.
- Do not index Tool, system, custom, image, or attachment payload content.
- Do not add a second search service, HTTP listener, worker runtime, or model call.
- Do not commit, push, publish, sign, notarize, upload, or claim Windows evidence.

## Acceptance criteria

- [x] A two-or-more-character normalized query can find Chinese and Latin
  substrings in user/assistant text across every indexed active Workspace Session.
- [x] Query-time candidate selection uses a salted opaque bigram index; SQLite
  contains no raw message body or snippet, and every result is re-read from the
  current Pi JSONL branch before a snippet is returned.
- [x] Index freshness is versioned by physical Session identity and current
  projection version; stale, malformed, oversized, or changed sources fail
  visibly incomplete rather than returning false authority.
- [x] Reconciliation and current-Session upserts incrementally prune/reindex with
  at most four readers, bounded file/message/token budgets, and request cancellation.
- [x] Navigation shows separate `会话` and `对话内容` result groups, with one best
  content match per Session; selecting a content hit opens the Session and locates
  the exact message.
- [x] Existing Command Palette and Workspace conversation search use the same
  indexed authority and accurately describe indexed coverage instead of a fresh scan.
- [x] Cold fallback remains functional and explicitly incomplete if the private
  SQLite index is unavailable.
- [x] Correctness, privacy, schema-recovery, cancellation, performance, Renderer,
  protocol, build, Electron, and exact macOS packaged gates pass.

## Delivery boundary

- Local implementation: authorized by the user on 2026-08-24.
- Commit/push/release/distribution: not authorized by the current request.

## Decisions

| Decision | Rationale | Reversal condition |
| --- | --- | --- |
| Extend the single Host-owned private Catalog SQLite database. | Preserves one storage owner and atomic projection lifecycle. | Independent index retention or migration needs diverge materially. |
| Store only per-database-salted HMAC bigrams plus message identity metadata. | Supports Chinese two-character substrings without plaintext content at rest. | Platform SQLite provides a verified tokenizer with equal privacy and language behavior. |
| Verify every candidate against current Pi JSONL before returning it. | SQLite is disposable and can never overrule Session truth. | Pi adds an authoritative full-text Session query API. |
| Return one best hit per Session in navigation. | Prevents one long conversation from flooding the rail. | A dedicated result browser needs per-message expansion. |
| Preserve bounded direct scan only as degraded fallback. | Search remains usable when SQLite is unavailable without pretending completeness. | Product chooses fail-closed search unavailability. |

## Checkpoints

- [x] 1. Add bounded normalization/tokenization/document extraction and privacy tests.
- [x] 2. Add disposable SQLite index schema, incremental replace/prune/query, and integrity recovery.
- [x] 3. Route cancellable indexed search through Catalog owner and Agent Host.
- [x] 4. Add grouped navigation content results and shared locate behavior.
- [x] 5. Pass performance/full gates and exact macOS packaged verification.

## Validation and evidence

- Targeted content-index and integrity slice: 25 tests passed.
- Full repository test: 585 files, 3,036 tests passed, 3 skipped.
- Renderer production-preview Playwright: 20 tests passed, including populated,
  cleared, grouped content-result, locate, and shell-focus states.
- Real-Host Electron Playwright: 4 tests passed.
- `performance:session-catalog`: pass. At 10,000 Sessions, warm first-page p95
  was 2.259 ms, title-hit p95 8.646 ms, title-miss p95 6.963 ms, and reopen p95
  68.624 ms. A separate 10,000-document content-index probe measured hit p95
  8.903 ms and miss p95 0.178 ms with complete coverage.
- `type-check`, `lint`, `build`, and `git diff --check`: passed.
- `preview:mac:unsigned`: passed end to end; exact packaged `app.asar` SHA-256
  `186f2a14728683858fc6c2cf1aa7905225ec5f99d7c71a879ff71255c86d3fb4` was
  opened as PID 66394.

## Closeout

- Source boundary: uncommitted working tree based on `6646c82`; no commit,
  push, release, signing, notarization, or distribution was performed.
- SQLite schema is v7 and remains disposable; Pi JSONL stays authoritative.
- Real Windows x64 evidence and live external-Provider title generation remain
  unverified and are not claimed by this local macOS delivery.

## Rollback

Revert only the content-index schema/runtime, navigation result projection, tests,
and this plan. Schema mismatch recovery recreates the disposable database; Pi
JSONL, explicit/automatic titles, organization metadata, and live Tasks remain
unchanged.

## Risks

- Bigram posting volume must be bounded to prevent pathological Session content
  from creating an oversized index.
- Candidate verification must not reopen the same JSONL repeatedly within one query.
- A request cancelled during indexing must leave either the previous complete
  Session version or one atomic replacement, never a partially indexed version.
- Reconcile must not erase unchanged content postings or retain removed identities.
