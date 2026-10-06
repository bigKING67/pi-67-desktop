import { ArrowUp, Check, Paperclip } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Button } from "react-aria-components";
import { useStore } from "zustand";
import {
  TEAM_CHAT_MESSAGE_MAX_CHARS,
  teamChatCanPost,
  teamChatRetainedMentions,
  type TeamChatConversation,
  type TeamChatDirectory
} from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { teamChatUploads } from "./team-chat-attachment-files.js";
import { teamChatErrorMessage } from "./team-chat-controller.js";
import { canSendTo, memberById } from "./team-chat-model.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import {
  teamChatMentionCandidates,
  teamChatMentionQuery,
  teamChatRemainingCharacters,
  type TeamChatMentionCandidate
} from "./team-chat-presentation.js";
import { addTeamChatFiles, TeamChatAttachmentTray } from "./TeamChatAttachmentTray.js";
import { TeamChatAgentAvatar, TeamChatAgentBadge, TeamChatAvatar } from "./TeamChatParts.js";
import files from "./TeamChatAttachments.module.css";
import styles from "./TeamChat.module.css";
import governance from "./TeamChatGovernance.module.css";

/**
 * Members who can be mentioned here: the peer of a direct message, or the channel
 * roster, read on the first `@` so opening a channel costs no extra request.
 */
function useMentionableMembers(conversation: TeamChatConversation, directory: TeamChatDirectory, wanted: boolean) {
  const [roster, setRoster] = useState<readonly string[]>();
  const [loading, setLoading] = useState(false);
  // The member count the roster was requested for; a change re-reads it on the next `@`.
  const requested = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!wanted || conversation.kind !== "channel" || requested.current === conversation.memberCount) return;
    const count = conversation.memberCount;
    requested.current = count;
    setLoading(true);
    void teamChat.channelRoster(conversation.id).then(
      (result) => result.members.map((member) => member.userId),
      () => undefined
    ).then((ids) => {
      if (!mounted.current || requested.current !== count) return;
      if (ids === undefined) requested.current = undefined;
      setRoster(ids);
      setLoading(false);
    });
  }, [wanted, conversation.id, conversation.kind, conversation.memberCount]);
  return useMemo(() => {
    const ids = conversation.kind === "dm" ? conversation.memberUserIds : roster ?? [];
    const members = ids.flatMap((userId) => {
      const member = userId === directory.selfUserId ? undefined : memberById(directory, userId);
      return member ? [{ userId, displayName: member.displayName, ...(member.agent ? { agent: true } : {}) }] : [];
    });
    return { members, loading };
  }, [conversation.kind, conversation.memberUserIds, roster, loading, directory]);
}

export function TeamChatComposer({ conversation, directory, target, onSent }: {
  conversation: TeamChatConversation;
  directory: TeamChatDirectory;
  target: string;
  onSent: () => void;
}) {
  const copy = messages.teamChat;
  const [draft, setDraft] = useState("");
  const [picks, setPicks] = useState<TeamChatMentionCandidate[]>([]);
  const [query, setQuery] = useState<{ start: number; query: string }>();
  const [active, setActive] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  /** Caret to restore right after a picked mention is committed, before the next keystroke. */
  const pendingCaret = useRef<number | undefined>(undefined);
  const listId = useId();
  const noticeId = useId();
  const mentionable = useMentionableMembers(conversation, directory, query !== undefined);
  const candidates = useMemo(() => query ? teamChatMentionCandidates(query.query, mentionable.members) : [],
    [query, mentionable.members]);
  const policyAllows = teamChatCanPost(directory);
  const writable = canSendTo(directory, conversation) && policyAllows;
  const remaining = teamChatRemainingCharacters(draft, TEAM_CHAT_MESSAGE_MAX_CHARS);
  const allUploads = useStore(teamChatUploads.store, (state) => state.uploads);
  const uploads = useMemo(() => allUploads.filter((item) => item.conversationId === conversation.id), [allUploads, conversation.id]);
  const uploadsUnfinished = uploads.some((item) => item.status !== "ready");
  const picker = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const pickerOpen = query !== undefined && writable;
  const editing = useTeamChat((state) => state.editing?.conversationId === conversation.id ? state.editing : undefined);
  // Files go with new messages only; an edit changes text alone (ADR 0008).
  const hasContent = draft.trim().length > 0 || (!editing && uploads.length > 0);
  const sendable = writable && hasContent && (remaining === undefined || remaining >= 0) && (editing !== undefined || !uploadsUnfinished);
  const thread = useTeamChat((state) => state.threads[conversation.id]);
  const edited = editing ? thread?.messages.find((item) => item.id === editing.messageId) : undefined;
  const [saving, setSaving] = useState(false);
  /** The unsent draft set aside while a message is edited, restored afterwards. */
  const stash = useRef<{ draft: string; picks: TeamChatMentionCandidate[] } | undefined>(undefined);

  useEffect(() => {
    if (!editing) {
      if (!stash.current) return;
      setDraft(stash.current.draft);
      setPicks(stash.current.picks);
      stash.current = undefined;
      return;
    }
    if (!edited) return;
    stash.current ??= { draft, picks };
    setDraft(edited.body);
    setPicks((edited.mentionUserIds ?? []).flatMap((userId) => {
      const member = memberById(directory, userId);
      return member ? [{ userId, displayName: member.displayName, ...(member.agent ? { agent: true } : {}) }] : [];
    }));
    setQuery(undefined);
    pendingCaret.current = edited.body.length;
    // Only a new edit target or its end resets the field; typing must not.
  }, [editing?.messageId, edited !== undefined]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
    if (pendingCaret.current !== undefined) {
      element.focus();
      element.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = undefined;
    }
  }, [draft]);

  const track = (element: HTMLTextAreaElement) => {
    setQuery(teamChatMentionQuery(element.value, element.selectionStart));
    setActive(0);
  };

  const choose = (candidate: TeamChatMentionCandidate) => {
    if (!query) return;
    const before = draft.slice(0, query.start);
    const inserted = `@${candidate.displayName} `;
    setDraft(`${before}${inserted}${draft.slice(query.start + 1 + query.query.length)}`);
    setPicks((current) => [...current.filter((item) => item.userId !== candidate.userId), candidate]);
    setQuery(undefined);
    pendingCaret.current = before.length + inserted.length;
  };

  const save = () => {
    if (!editing || !edited || saving) return;
    const mentions = teamChatRetainedMentions(draft, picks, directory.selfUserId);
    if (draft === edited.body && mentions.join() === (edited.mentionUserIds ?? []).join()) {
      teamChat.stopEditing();
      return;
    }
    setSaving(true);
    void teamChat.editMessage(conversation.id, editing.messageId, draft, mentions)
      .catch((error: unknown) => publishNotification({ level: "warning", title: copy.editFailed, message: teamChatErrorMessage(error) }))
      .finally(() => setSaving(false));
  };

  /** ↑ in an empty composer edits the reader's newest editable message here. */
  const editLast = () => {
    const last = [...thread?.messages ?? []].reverse().find((item) => item.senderUserId === directory.selfUserId
      && item.workCard === undefined && item.recalledAt === undefined);
    if (!last) return false;
    teamChat.startEditing(conversation.id, last.id);
    return true;
  };

  const send = () => {
    if (!sendable) return;
    if (editing) {
      save();
      return;
    }
    const attachments = teamChatUploads.take(conversation.id);
    if (!attachments) return;
    const body = draft;
    const mentions = teamChatRetainedMentions(body, picks, directory.selfUserId);
    setDraft("");
    setPicks([]);
    setQuery(undefined);
    onSent();
    void teamChat.send(conversation.id, body, mentions, attachments);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (pickerOpen && candidates.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + step + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(candidates[active] ?? candidates[0]!);
        return;
      }
    }
    if (pickerOpen && event.key === "Escape") {
      event.preventDefault();
      setQuery(undefined);
      return;
    }
    if (editing && event.key === "Escape") {
      event.preventDefault();
      teamChat.stopEditing();
      return;
    }
    if (!editing && event.key === "ArrowUp" && draft === "" && editLast()) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const notice = !policyAllows ? copy.viewerReadOnly : !writable ? copy.peerLeft
    : !editing && uploadsUnfinished && hasContent ? copy.attachmentsUnfinished : undefined;
  const attachable = writable && !editing;
  const isFileDrag = (event: DragEvent) => attachable && event.dataTransfer.types.includes("Files");
  // Edits never ask Agents again (ADR 0008), so the disclosure is for new messages only.
  const askedAgents = editing ? [] : picks.filter((pick) => pick.agent && draft.includes(`@${pick.displayName}`));
  return (
    <form className={styles.composer}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
      onDragOver={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDropping(false);
        addTeamChatFiles(conversation.id, [...event.dataTransfer.files]);
      }}
      onSubmit={(event) => { event.preventDefault(); send(); }}>
      {notice ? <p className={styles.composerNotice} id={noticeId} role="status">{notice}</p> : null}
      {editing ? (
        <div className={styles.composerEditing} data-testid="team-chat-editing" role="status">
          <span>{copy.editingMessage}</span>
          <Button className={styles.textAction!} onPress={() => teamChat.stopEditing()}>{copy.cancelEdit}</Button>
        </div>
      ) : null}
      {askedAgents.length > 0 ? (
        <p className={styles.composerNotice} data-testid="team-chat-agent-disclosure">
          {copy.agentMentionDisclosure(askedAgents.map((pick) => `@${pick.displayName}`).join("、"))}
        </p>
      ) : null}
      <div className={`${styles.composerField} ${governance.composerAnchor} ${dropping ? files.dropTarget : ""}`}
        data-drop-hint={dropping ? copy.attachmentDrop : undefined}>
        {editing ? null : <TeamChatAttachmentTray uploads={uploads} />}
        {pickerOpen ? (
          <div className={governance.mentionPicker}>
            {candidates.length > 0 ? (
              <ul aria-label={copy.mentionList} id={listId} role="listbox">
                {candidates.map((candidate, index) => (
                  <li
                    aria-selected={index === active}
                    className={index === active ? governance.mentionActive : undefined}
                    id={`${listId}-${index}`}
                    key={candidate.userId}
                    onMouseDown={(event) => { event.preventDefault(); choose(candidate); }}
                    onMouseEnter={() => setActive(index)}
                    role="option"
                  >
                    {candidate.agent ? <TeamChatAgentAvatar /> : <TeamChatAvatar name={candidate.displayName} />}
                    <span>{candidate.displayName}{candidate.agent ? <> <TeamChatAgentBadge /></> : null}</span>
                  </li>
                ))}
              </ul>
            ) : <p role="status">{mentionable.loading ? copy.mentionLoading : copy.mentionNoMatch}</p>}
          </div>
        ) : null}
        <Button aria-label={copy.attach} className={files.attachButton!} isDisabled={!attachable}
          onPress={() => picker.current?.click()}>
          <Paperclip aria-hidden="true" size={16} />
        </Button>
        <input hidden multiple onChange={(event) => {
          addTeamChatFiles(conversation.id, [...event.currentTarget.files ?? []]);
          event.currentTarget.value = "";
        }} ref={picker} tabIndex={-1} type="file" />
        <textarea
          aria-activedescendant={pickerOpen && candidates.length > 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-controls={pickerOpen && candidates.length > 0 ? listId : undefined}
          aria-describedby={notice ? noticeId : undefined}
          aria-expanded={pickerOpen && candidates.length > 0}
          aria-label={copy.composerLabel(target)}
          disabled={!writable}
          onBlur={() => setQuery(undefined)}
          onChange={(event) => { setDraft(event.currentTarget.value); track(event.currentTarget); }}
          onClick={(event) => track(event.currentTarget)}
          onKeyDown={onKeyDown}
          onKeyUp={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") track(event.currentTarget); }}
          onPaste={(event) => {
            const pasted = [...event.clipboardData.files];
            if (pasted.length === 0 || !attachable) return;
            event.preventDefault();
            addTeamChatFiles(conversation.id, pasted);
          }}
          placeholder={writable ? copy.composerPlaceholder(target) : ""}
          ref={input}
          rows={1}
          value={draft}
        />
        <Button aria-label={editing ? copy.saveEdit : copy.send} className={styles.sendButton!}
          isDisabled={!sendable || saving || (editing !== undefined && edited === undefined)} type="submit">
          {editing ? <Check aria-hidden="true" size={16} /> : <ArrowUp aria-hidden="true" size={16} />}
        </Button>
      </div>
      {remaining !== undefined ? (
        <small className={remaining < 0 ? styles.overLimit : undefined} role="status">
          {remaining < 0 ? copy.overLimit(-remaining) : copy.charactersLeft(remaining)}
        </small>
      ) : null}
    </form>
  );
}
