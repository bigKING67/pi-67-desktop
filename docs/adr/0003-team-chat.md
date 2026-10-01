# ADR 0003: Team Chat beside Work

Status: accepted; P1, P2 and P2.5 implemented in source (not deployed); target-OS validation pending.
Date: 2026-10-01

## Context

New Money has a mature local Work surface (Workspaces, Pi Sessions, Worktrees) and a
hosted account/team service, but no way for teammates or Agents to talk, hand work
to each other, or turn a discussion into Work. PRODUCT.md already reserved a future
Chat mode (bull = Work, horse = Chat). Raft (`botiverse/raft-source`, FSL-1.1-ALv2,
source-available, not open source) is a design reference only; no code is copied.

ADR 0001 forbade a "business WebSocket". That rule was written to keep the renderer on
MessagePort instead of a local HTTP/WS server; no hosted team service existed then.
Real-time team messaging needs a push channel from the hosted service.

## Decision

1. **Two modes, one shell.** A segmented `工作 | 聊天` control at the top of the
   navigation rail switches the rail and main pane between Work and Chat. Work is
   unchanged. Mode is renderer layout state; it never changes Session, Workspace or
   team authority.
2. **Hosted truth.** new-money-server owns chat conversations, membership, messages,
   read cursors and (later) Work Cards in PostgreSQL, scoped to one team. Desktop
   keeps no durable chat store; any cache is disposable. Chat is unavailable without
   New Money sign-in; Work stays fully local.
3. **Transport.** Agent Host owns the chat client, consistent with ADR 0002's
   "Host retains business networking". REST carries every mutation and history read
   (idempotent `clientKey` on send). One outbound authenticated `wss://` connection
   per signed-in Host carries server-to-client push only. It authenticates with a
   single-use, short-lived ticket obtained over REST, closes no later than the access
   token expiry, and reconnects with backoff. After every (re)connect the client
   reconciles per-conversation `lastSeq` over REST, so push loss never loses messages.
4. **Red line narrowed, not removed.** Still forbidden: any local listener, internal
   HTTP server, renderer network access (CSP `connect-src 'self'` stays), and any
   WebSocket between local processes. Allowed: exactly this Host-owned outbound WSS
   to the configured New Money origin, with redirects refused.
5. **Ordering and unread.** Each conversation has a strictly increasing `seq` assigned
   in the insert transaction. Read state is a per-member `lastReadSeq`. Unread is
   `lastSeq - lastReadSeq` bounded by the member's own messages.
6. **Membership.** Every active team member can see teammates, open DMs, create
   channels and post. Public channels are joinable by any member; private channels
   require an existing member to add you. Removing a team member revokes chat access
   on the next request and disconnects their sockets.
7. **Work handoff (P2).** A Work task is handed off as a Work Card: title, goal,
   acceptance criteria, repository/branch/PR references and a sender-reviewed
   summary. Pi JSONL transcripts, prompts, source bodies and private memory are never
   uploaded. Accepting a card starts a new team-scoped Work Session on the receiver's
   Desktop; status receipts (`todo → in_progress → in_review → done`) update the card.
   Claim and assign are separate; card updates use optimistic `revision`.
8. **Chat to Work (P2).** "在工作中处理" on a message or thread previews the excerpt,
   then creates a team-scoped Work Session with it as starting context. Team chat
   content is team content: it is never automatically captured into private memory.
9. **Agents as members (P3).** An Agent is bound to one member's Desktop and runs on
   that member's local Pi with their configured, user-paid models. Mentions and DMs
   wake a Pi turn only after the current team model authorization passes; replies
   post under the Agent identity. Risky actions are drafted by the Agent and committed
   by a human. An Agent is offline when its owner's Desktop is offline; the service
   never hosts an agent loop.

## Consequences

- Desktop gains a long-lived network connection and reconnect state machine in Host.
  It must be cancellable, bounded and observable without logging message bodies.
- new-money-server gains WebSocket support and an in-process per-team broadcast hub.
  It assumes a single API instance; adding instances requires a Postgres
  `LISTEN/NOTIFY` (or equivalent) fan-out before scaling.
- Chat message bodies are hosted team content. They are never logged by either side.

## Evolution triggers (decided 2026-10-01)

Language is not the scaling lever at New Money's team scale; the service stays one
Rust (Axum/tokio) codebase. A second service language (for example Go for business
APIs) is reconsidered only at the last stage below. Thresholds are estimates to be
replaced by measurements from the `chat hub stats` log.

| Stage | Trigger | Change |
| --- | --- | --- |
| Now | Up to a few thousand concurrent sockets on one VPS | One API replica (Compose `scale: 1`); watch sockets, connects, `dropped_full_queue`, `evicted_over_cap`, `send_p95_ms` |
| 2 | Need for more than one replica (HA or rolling deploys) or ~10k concurrent sockets | Shared fan-out (Postgres `LISTEN/NOTIFY` or Redis pub/sub); split the socket gateway and REST API into separate Rust processes |
| 3 | Sustained message writes of hundreds per second, or hot channels contending on the per-conversation row lock | Dedicated sequence allocation or partitioned conversations; partitioned message storage; a queue between write and push |
| 4 | Hundreds of thousands to millions of concurrent sockets | Dedicated gateway cluster, sharded storage, multi-region; evaluate a second language only here |

Independently of stage, denormalize conversation list unread/preview columns once a
member's list reaches hundreds of conversations or the list query shows up in p95.

## Phases

- P0: this ADR, execution plan, protocol and migration design, authority updates.
- P1: mode switch, teammates, channels, DMs, text messages, unread, real-time push.
- P2: Work Cards and both handoff directions with status receipts.
- P2.5: channel governance (owner, rename, members, transfer, leave, archive),
  `@mentions`, and a team chat policy (channel creation, viewer posting, message
  retention with Work Cards kept) managed in the web console, which shows channel
  metadata only and never message content.
- P3: Agents as conversation members.
- P4: attachments, search, Activity inbox, native notifications, Windows evidence.

## Rejected alternatives

- Long polling or SSE only: weaker latency/efficiency and still a long-lived channel;
  WSS with REST reconciliation is the stronger long-term contract.
- Renderer-owned WebSocket: breaks the sandbox/CSP boundary.
- Uploading Pi Sessions for handoff: violates prompt/source/private-memory rules.
- Server-hosted Agents: would create a second agent runtime.
