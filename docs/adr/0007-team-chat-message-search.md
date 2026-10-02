# ADR 0007: Team Chat message search

Status: accepted; implemented in source (not deployed); target-OS validation pending.
Date: 2026-10-02

## Context

Team Chat keeps messages forever by default (ADR 0003), so finding an earlier
decision by scrolling stops working quickly. The user confirmed four choices on
2026-10-02: search covers every conversation the reader may read (joined ones and
public channels); the entry is a search field at the top of the Chat rail; Work
Cards match on title, goal, acceptance criteria and summary; the first version
filters by conversation and sender.

Facts that shaped the design: PostgreSQL's built-in text search does not segment
Chinese, so word-based full-text search misses most queries; production runs
PostgreSQL 17 with `pg_trgm` available but not installed, and the migration role
cannot install extensions.

## Decision

1. **Substring matching.** New Money matches the trimmed query (1–100 printable
   characters) as a case-insensitive substring; `%`, `_` and `\` match themselves.
   Results are newest first, 50 per page with an opaque cursor, in conversations the
   reader may read that are not archived. A conversation filter must itself be
   readable (404 otherwise); a sender filter narrows by author.
2. **Work Cards.** A card's message also matches on goal, acceptance and summary; the
   result names the matching section and carries the card title.
3. **Excerpts, not bodies.** Each result carries one line from up to 30 characters
   before the first match to up to 90 after it, with ellipses when cut. Desktop marks
   every occurrence of the query in it.
4. **Indexes.** The query unions two branches (message bodies, then card sections),
   so each can use its own trigram index, and checks readability on the hits.
   Migration 016 adds team/time and conversation/time indexes and, only when
   `pg_trgm` is installed, trigram GIN indexes on message bodies and card text. The
   database owner installs `pg_trgm` before migrating; without it search still works
   by scanning the reader's conversations. Queries shorter than three characters
   (common in Chinese) do not use trigram indexes.
5. **Privacy.** Queries are never logged (request traces record the route template
   only), never stored on Desktop, and the admin console has no search.
6. **Desktop.** `teamChat.search` is an `app` scope command. The rail field searches
   on Enter; results replace the center like the activity inbox, with conversation
   and sender filters, highlighted excerpts, `加载更多结果`, and a close action that
   returns to the conversation. Opening a result centres and highlights the message:
   a nearby one by paging back up to three pages, a far one by loading a window of
   history around it. A window skips live messages; scrolling down loads newer pages
   in order, and `跳到最新消息` returns to the newest page.
   In Chat, the find shortcuts search Team Chat: ⌘⇧F all conversations, ⌘F the
   conversation in view (shown as a removable scope chip). In Work they keep their
   Pi meanings.

## Consequences

- Short queries scan every message the reader can read; acceptable at team scale,
  revisited if latency is observed (for example with a bigram index).
- A deployment installs `pg_trgm` once as the database owner before migration 016.

## Rejected alternatives

- PostgreSQL full-text search with the default parser: no Chinese segmentation.
- A Chinese parser extension (zhparser) or bigram extension (pg_bigm): not available
  in the production image; adding one means a custom database image.
- Searching on Desktop over loaded history: incomplete by construction, and would
  require downloading conversations the reader never opened.
