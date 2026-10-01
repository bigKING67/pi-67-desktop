import { ArrowUp } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "react-aria-components";
import {
  TEAM_CHAT_MESSAGE_MAX_CHARS,
  teamChatCanPost,
  teamChatRetainedMentions,
  type TeamChatConversation,
  type TeamChatDirectory
} from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { canSendTo, memberById } from "./team-chat-model.js";
import { teamChat } from "./team-chat-instance.js";
import {
  teamChatMentionCandidates,
  teamChatMentionQuery,
  teamChatRemainingCharacters,
  type TeamChatMentionCandidate
} from "./team-chat-presentation.js";
import { TeamChatAvatar } from "./TeamChatParts.js";
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
      return member ? [{ userId, displayName: member.displayName }] : [];
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
  const listId = useId();
  const noticeId = useId();
  const mentionable = useMentionableMembers(conversation, directory, query !== undefined);
  const candidates = useMemo(() => query ? teamChatMentionCandidates(query.query, mentionable.members) : [],
    [query, mentionable.members]);
  const policyAllows = teamChatCanPost(directory);
  const writable = canSendTo(directory, conversation) && policyAllows;
  const remaining = teamChatRemainingCharacters(draft, TEAM_CHAT_MESSAGE_MAX_CHARS);
  const sendable = writable && draft.trim().length > 0 && (remaining === undefined || remaining >= 0);
  const pickerOpen = query !== undefined && writable;

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
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
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  };

  const send = () => {
    if (!sendable) return;
    const body = draft;
    const mentions = teamChatRetainedMentions(body, picks, directory.selfUserId);
    setDraft("");
    setPicks([]);
    setQuery(undefined);
    onSent();
    void teamChat.send(conversation.id, body, mentions);
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const notice = !policyAllows ? copy.viewerReadOnly : !writable ? copy.peerLeft : undefined;
  return (
    <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); send(); }}>
      {notice ? <p className={styles.composerNotice} id={noticeId} role="status">{notice}</p> : null}
      <div className={`${styles.composerField} ${governance.composerAnchor}`}>
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
                    <TeamChatAvatar name={candidate.displayName} />
                    <span>{candidate.displayName}</span>
                  </li>
                ))}
              </ul>
            ) : <p role="status">{mentionable.loading ? copy.mentionLoading : copy.mentionNoMatch}</p>}
          </div>
        ) : null}
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
          placeholder={writable ? copy.composerPlaceholder(target) : ""}
          ref={input}
          rows={1}
          value={draft}
        />
        <Button aria-label={copy.send} className={styles.sendButton!} isDisabled={!sendable} type="submit">
          <ArrowUp aria-hidden="true" size={16} />
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
