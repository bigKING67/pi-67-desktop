import { ClipboardCheck, Paperclip, Search, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "react-aria-components";
import type { TeamChatDirectory, TeamChatSearchHit } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { SettingsSelect } from "../settings/SettingsPrimitives.js";
import { activityWhere } from "./team-chat-activity-presentation.js";
import { conversationTitle, memberById, type TeamChatSearchState } from "./team-chat-model.js";
import { teamChat, useTeamChat } from "./team-chat-instance.js";
import { formatTeamChatMoment } from "./team-chat-presentation.js";
import { teamChatSearchSegments } from "./team-chat-search-presentation.js";
import { TeamChatAvatar } from "./TeamChatParts.js";
import chat from "./TeamChat.module.css";
import styles from "./TeamChatPanel.module.css";

/** Search results (ADR 0007): filters by conversation and sender, excerpts with the match marked. */
export function TeamChatSearch({ directory }: { directory: TeamChatDirectory }) {
  const copy = messages.teamChat;
  const search = useTeamChat((state) => state.search);
  const conversations = useMemo(() => directory.conversations
    .filter((item) => item.joined || (item.kind === "channel" && item.visibility === "public"))
    .map((item) => ({ id: item.id, label: item.kind === "channel" ? `#${item.name ?? ""}` : conversationTitle(directory, item, copy.unknownTeammate) })),
  [directory, copy.unknownTeammate]);
  const senders = useMemo(() => [
    ...directory.members.map((member) => ({ id: member.userId, label: member.userId === directory.selfUserId ? copy.you : member.displayName })),
    ...directory.agents.map((agent) => ({ id: agent.userId, label: copy.activityAgentName(agent.name) })),
    ...directory.bots.map((bot) => ({ id: bot.userId, label: bot.name }))
  ], [directory, copy]);
  if (!search) return null;

  const refine = (change: { conversationId?: string; senderUserId?: string }) => {
    const next = { conversationId: search.conversationId, senderUserId: search.senderUserId, ...change };
    void teamChat.search({
      query: search.query,
      ...(next.conversationId ? { conversationId: next.conversationId } : {}),
      ...(next.senderUserId ? { senderUserId: next.senderUserId } : {})
    });
  };

  return (
    <div className={styles.panel} data-testid="team-chat-search">
      <div className={styles.column}>
        <header className={styles.header}>
          <span className={styles.heading}>
            <Search aria-hidden="true" size={16} />
            <h2>{copy.searchResultsFor(search.query)}</h2>
            <Button aria-label={copy.searchClose} className={styles.headingClose!} onPress={() => teamChat.closeSearch()}>
              <X aria-hidden="true" size={15} />
            </Button>
          </span>
          <p>{copy.searchHint}</p>
          <div className={styles.toolbar}>
            <div className={`${chat.field} ${styles.filter}`}>
              <span>{copy.searchConversationFilter}</span>
              <SettingsSelect className={chat.fieldSelect!} label={copy.searchConversationFilter}
                onChange={(conversationId) => refine({ conversationId })} value={search.conversationId ?? ""}
                options={[{ id: "", label: copy.searchAllConversations }, ...conversations.map((item) => ({ id: item.id, label: item.label }))]} />
            </div>
            <div className={`${chat.field} ${styles.filter}`}>
              <span>{copy.searchSenderFilter}</span>
              <SettingsSelect className={chat.fieldSelect!} label={copy.searchSenderFilter}
                onChange={(senderUserId) => refine({ senderUserId })} value={search.senderUserId ?? ""}
                options={[{ id: "", label: copy.searchAllSenders }, ...senders.map((item) => ({ id: item.id, label: item.label }))]} />
            </div>
          </div>
        </header>
        <Results directory={directory} search={search} />
      </div>
    </div>
  );
}

function Results({ directory, search }: { directory: TeamChatDirectory; search: TeamChatSearchState }) {
  const copy = messages.teamChat;
  if (search.status === "loading") return <p className={styles.status} role="status">{copy.searchLoading}</p>;
  if (search.status === "error") {
    return (
      <div className={styles.status} role="alert">
        <span>{copy.searchFailed}</span>
        <Button className="secondary-button" onPress={() => void teamChat.search(search)}>{copy.retry}</Button>
      </div>
    );
  }
  if (search.results.length === 0) {
    const filtered = search.conversationId !== undefined || search.senderUserId !== undefined;
    return (
      <div className={styles.status} role="status">
        <span>{filtered ? copy.searchEmptyFiltered(search.query) : copy.searchEmpty(search.query)}</span>
        {filtered ? <Button className="secondary-button" onPress={() => void teamChat.search({ query: search.query })}>{copy.searchClearFilters}</Button> : null}
      </div>
    );
  }
  return (
    <>
      <ul className={styles.list} data-testid="team-chat-search-results">
        {search.results.map((hit) => <ResultRow directory={directory} hit={hit} key={hit.messageId} query={search.query} />)}
      </ul>
      {search.nextCursor ? (
        <Button className={`secondary-button ${styles.more}`} isDisabled={search.loadingMore} onPress={() => void teamChat.loadMoreSearch()}>
          {copy.searchMore}
        </Button>
      ) : null}
    </>
  );
}

function ResultRow({ directory, hit, query }: { directory: TeamChatDirectory; hit: TeamChatSearchHit; query: string }) {
  const copy = messages.teamChat;
  const sender = memberById(directory, hit.senderUserId);
  const name = hit.senderUserId === directory.selfUserId ? copy.you : sender?.displayName ?? copy.unknownTeammate;
  const where = activityWhere(directory, hit.conversationId);
  const time = formatTeamChatMoment(hit.createdAt, Date.now());
  const card = copy.searchCardField[hit.field];
  return (
    <li className={styles.row}>
      <Button aria-label={[name, where, time, card, hit.cardTitle, hit.snippet].filter(Boolean).join("，")}
        className={styles.rowMain!} data-testid="team-chat-search-result"
        onPress={() => void teamChat.openMessage(hit.conversationId, hit.seq)}>
        {hit.field === "message"
          ? <TeamChatAvatar name={name} />
          : <span aria-hidden="true" className={styles.rowIcon}>{hit.field === "attachment" ? <Paperclip size={14} /> : <ClipboardCheck size={14} />}</span>}
        <span className={styles.rowText}>
          <strong>{name}</strong>
          {card ? <span className={styles.rowDetail}>{`${card}${hit.field === "title" || hit.field === "attachment" ? "" : ` · ${hit.cardTitle ?? ""}`}`}</span> : null}
          <span className={styles.snippet}>
            {teamChatSearchSegments(hit.snippet, query).map((segment, index) => segment.match
              ? <mark key={index}>{segment.text}</mark>
              : <span key={index}>{segment.text}</span>)}
          </span>
        </span>
        <span className={styles.rowMeta}>
          <time dateTime={new Date(hit.createdAt).toISOString()}>{time}</time>
          <span>{where}</span>
        </span>
      </Button>
    </li>
  );
}
