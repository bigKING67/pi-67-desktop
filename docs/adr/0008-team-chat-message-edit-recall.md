# ADR 0008: Team Chat message edit and recall

Status: accepted; implemented in source (not deployed); target-OS validation pending.
Date: 2026-10-02

## Context

Team Chat messages were permanent once sent: a typo needed a correction message and
a secret pasted into a channel stayed until retention removed it. The user confirmed
four choices on 2026-10-02: senders recall their own messages at any time, leaving a
placeholder; senders edit at any time, marked as edited, without keeping earlier
text; channel owners and team owners/admins may remove others' messages; mentions
added by an edit notify.

## Decision

1. **Edit.** The sender replaces the text and mentions of their own plain message
   at any time (the viewer posting policy applies). New Money keeps only the current
   text and `editedAt`. Mentions added by the edit become activity and notifications
   even for members who had already read past the message (`late_mention_user_ids`:
   their item dates from the edit and stays unread until handled or marked read);
   removed ones leave activity. Agents are never invoked again by an edit.
2. **Recall.** The sender recalls their own message at any time. New Money erases the
   text and mentions (`body` becomes empty) and keeps a placeholder row with
   `recalledAt` and `recalledBy`, so sequence numbers and the surrounding replies keep
   their context. Open Agent requests the message made are cancelled, a turn already
   running on the owner's Desktop is aborted, and the cancellation is not reported as
   activity. Recalled text leaves search, activity and future Agent context.
3. **Removal by managers.** In channels the channel owner or a team owner/admin may
   remove anyone's message the same way; it is audited (`chat.message.removed`, with
   conversation and sender, never content) and the placeholder says a manager removed
   it. In direct messages only the sender recalls.
4. **Limits.** Work Card messages change through their card; recalled messages and
   archived channels cannot change. Agents and bots never edit; their messages can be
   removed by managers.
5. **Push.** `message.updated` replaces the message by id for the conversation's
   members; activity is re-read by everyone whose mentions changed and, in a direct
   message, by the other member.
6. **Desktop.** Hover actions on a message offer `编辑` and `撤回` (own) or `移除`
   (manager), with removal and recall armed on the first press. Editing reuses the
   composer: it shows `正在编辑消息`, keeps the mention picker, saves on Enter, cancels
   on Esc, and restores the unsent draft afterwards; ↑ in an empty composer edits the
   newest own message. Edited messages show `（已编辑）`; recalled ones a one-line
   placeholder.

## Consequences

- Readers may have seen text that is later edited or recalled; recall is not a
  guarantee that nobody read it. Desktops re-read their loaded history after every
  reconnect, so an edit or recall made while one was offline still replaces the text.
- An Agent turn that already read the message keeps it in the Session saved in the
  owner's Workspace (ADR 0004); recall cannot reach into that local file.
- Placeholders keep conversations coherent but show that something was removed.

## Rejected alternatives

- Keeping edit history: retains text users meant to change and needs a history view.
- Time-limited recall: a secret noticed late could not be removed by its sender.
- Deleting the row: breaks sequence continuity and leaves replies without context.
