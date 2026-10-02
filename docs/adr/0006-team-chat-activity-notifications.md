# ADR 0006: Team Chat activity and system notifications

Status: accepted; implemented in source (not deployed); target-OS validation pending.
Date: 2026-10-02

## Context

Team Chat (ADR 0003) only showed unread counts, and only while Chat was open: the
realtime connection started on first use, so a mention, a direct message, an Agent
reply or a Work Card waiting for review went unnoticed until the user switched to
Chat. The user confirmed three choices on 2026-10-02: system notifications say only
who is looking for you and where, with message previews as an opt-in setting; by
default they cover mentions, direct messages, Agent replies to your requests and
Work Cards that need you, each switchable; and an `动态` inbox lists these items, each
of which can be marked handled, with "mark all read".

Constraints carried over: chat bodies are hosted team content and are never logged
or persisted on Desktop; the admin console never sees message content; Main already
shows content-free notifications for background Pi tasks.

## Decision

1. **Derived activity.** New Money derives each member's activity on read, for the
   last 30 days and only in conversations they still belong to (archived channels
   excluded), newest first, at most 200 items. Kinds: `mention` (channel messages
   that mention the reader), `dm` (the newest incoming message per direct message),
   `agent_reply` (an Agent's reply to the reader's request; it outranks the mention it
   carries), `agent_failed` (the reader's request failed or expired, with the reason),
   `card_assigned`, `card_review` (submitted for the creator's review) and
   `card_changes_requested` (returned to whoever had claimed it at that moment). A message carrying a Work Card
   is covered by the card items. Each item is keyed by its source row (`m:`, `i:`,
   `e:` plus a UUID). Message items carry the same 140-character preview conversation
   lists already carry; nothing is copied into new storage.
2. **Stored state is the member's own.** `chat_activity_done` records items the member
   marked handled (pruned after 31 days), `chat_activity_state.read_at` records "mark
   all read", and `chat_members.muted_at` records a muted conversation. A message item
   is unread until the conversation read cursor passes it; every item is read after
   "mark all read" or once handled. Mute only silences notifications: unread counts
   remain, and the Chat switch badge counts a muted conversation's mentions only.
3. **Push.** Every change that creates an item, and every handled/read change, pushes
   `activity.changed` to the affected member only; clients re-read the list. Mute
   pushes `conversation.changed` to the member.
4. **No new process start.** Team Chat already connects whenever Agent Host runs: the
   renderer asks for the connection state on every Host connection, and a Desktop
   hosting Agents connects at Host startup (ADR 0004). Notifications reuse that
   connection and never start Agent Host themselves, so the Welcome screen alone stays
   Host-free; notifications begin once a Workspace or Chat is opened.
5. **Notifications.** The renderer treats the first activity read as the baseline.
   Afterwards each new, unread, unhandled item whose topic is on raises a system
   notification unless its conversation is muted or the focused window is showing
   that conversation. The default wording names who and where (`李雷 在 #设计 提到了你`,
   `李雷 给你发了私信`); the message preview or card title appears only with
   `显示消息预览` on. An Agent failure names its reason, which is not content. Items in
   one conversation within two minutes merge into one notification; more than three
   conversations at once become one summary. An item older than the newest one already
   seen (for example mentions that reappear after rejoining a channel) never notifies,
   and notification ids carry a per-renderer nonce because Main dedupes ids for the
   app's lifetime. Clicking focuses the window, leaves
   Settings when its draft guard allows, switches to Chat and opens the message
   (paging back if needed, then centring and briefly highlighting it) or, for the
   summary, the inbox. Opening the conversation dismisses its notification.
6. **Main stays a presenter.** Main accepts a second request shape, kind `chat`, with
   a bounded title (120) and body (240) the renderer composed, plus the conversation
   and message to open. It never logs them. Task notifications keep Main-owned copy.
7. **Preferences are per device.** On/off, the four topics and previews live in the
   renderer's local storage; muting is per member on the service so it follows the
   user across devices.

## Consequences

- Notifications depend on Agent Host running; a user who stays on the Welcome screen
  without opening a Workspace or Chat gets none until they do.
- Notification text can show teammate and channel names on a locked or shared
  screen; previews, which can show content, stay off unless chosen.
- The service runs one activity query per `activity.changed`; indexes on mentions,
  invokers and Work Card event times keep it bounded for team-sized data.
- Activity that arrives while Desktop is offline appears in the inbox and, on
  reconnect, in at most one notification per conversation (or one summary).

## Rejected alternatives

- Storing an activity row per event: duplicates message references and needs its own
  retention; deriving on read keeps one source of truth.
- Server-side notification preferences: notifications are a device concern, and the
  per-device setting keeps preview opt-in local to the screen it shows on.
- Notifying while the window is focused on the same conversation, or for every
  message in a direct message burst: noisy without telling the user anything new.
