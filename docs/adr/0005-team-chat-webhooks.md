# ADR 0005: Incoming webhook bots in Team Chat

Status: accepted; P3c implemented in source (not deployed).
Date: 2026-10-02

## Context

Teams want CI results, monitoring alerts and scripts to post into channels without
depending on anyone's Desktop (ADR 0004 Agents need their owner online). The user
chose incoming webhooks for P3c on 2026-10-02, created by the channel owner or a
team owner/admin.

## Decision

1. **Identity.** A bot is a non-login principal: a `users` row with unusable
   credentials and a `team_members` row with role `bot`, bound by a
   `chat_webhooks` record to exactly one channel, where it is a member. Bots are
   never seats or listed members, cannot be messaged directly, cannot be added to
   other channels, cannot own channels or hold project access, cannot be removed
   from their channel except by revoking the webhook, and never wake Agents.
   Revocation is soft: the secret is cleared and the bot leaves every conversation,
   but its name stays on past messages. Removing a member from the team revokes the
   webhooks they created, since only they ever saw those URLs. Agent turns label bot
   text as external (`（Bot，外部集成）`).
2. **Secret URL.** Creation and rotation return
   `POST <origin>/v1/hooks/chat/<botUserId>/<secret>` once. New Money stores only
   the secret's SHA-256; an unknown id and a wrong secret answer the same 404.
   Desktop shows the URL in the creating dialog only and never stores or logs it;
   the web console never sees it.
3. **Delivery.** Body `{ text, clientKey? }`: plain text up to 4,000 characters,
   no mentions or cards. A repeated client key replays. 30 messages a minute per bot
   (in-process, single API replica) and 1,000 a day (database) answer 429; an
   archived channel 410; an inactive entitlement 403; any delivery to a revoked or
   unknown webhook, including one racing a revocation, the same 404. Messages push
   like any other. HTTP traces record route templates, never concrete paths.
4. **Management.** Channel owners and team owners/admins who may post (a read-only
   viewer cannot hand out a posting URL) list, create, rotate and delete a channel's
   webhooks in Desktop's channel settings; owners/admins review
   and revoke every webhook in the web console. Creation, rotation and revocation
   are audited without secrets.

## Consequences

- A leaked URL lets anyone post text into one channel until rotated; it grants no
  read access. The per-bot limits bound the damage. A creator who stays in the team
  but loses channel management still knows the URL; current managers rotate it.
- The per-minute limit lives in the API process, consistent with ADR 0003's single
  replica; a scaled deployment must move it to shared state.

## Rejected alternatives

- Outgoing webhooks (calling external URLs on mentions): needs server-side egress
  with SSRF controls; deferred.
- Tokens in a request header only: many CI and monitoring tools can only call a
  URL; the secret path segment keeps them usable.
