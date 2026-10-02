import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { TEAM_CHAT_SEARCH_QUERY_MAX, type TeamChatDirectory } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { activityWhere } from "./team-chat-activity-presentation.js";
import { teamChat } from "./team-chat-instance.js";
import { subscribeTeamChatSearch } from "./team-chat-search-events.js";
import styles from "./TeamChat.module.css";

/**
 * Chat rail search (ADR 0007). Enter searches; a conversation scope comes from the
 * "find in current conversation" shortcut and shows as a removable chip.
 */
export function TeamChatSearchField({ directory }: { directory: TeamChatDirectory }) {
  const copy = messages.teamChat;
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<string>();

  useEffect(() => subscribeTeamChatSearch((requested) => {
    const state = teamChat.store.getState();
    const current = requested === "current" && state.panel === undefined ? state.selectedConversationId : undefined;
    setScope(current);
    // After the rail (possibly just opened) has rendered.
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }), []);

  const submit = () => {
    const query = text.trim();
    if (!query) return;
    void teamChat.search({ query, ...(scope === undefined ? {} : { conversationId: scope }) });
  };

  return (
    <div className={styles.railSearch} role="search">
      <Search aria-hidden="true" className={styles.railSearchIcon} size={14} />
      <input
        aria-label={copy.searchField}
        data-testid="team-chat-search-field"
        maxLength={TEAM_CHAT_SEARCH_QUERY_MAX}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape" && (text || scope)) {
            event.preventDefault();
            setText("");
            setScope(undefined);
          }
        }}
        placeholder={copy.searchPlaceholder}
        ref={input}
        type="search"
        value={text}
      />
      {scope ? (
        <span className={styles.railSearchScope}>
          <span>{copy.searchScopedTo(activityWhere(directory, scope))}</span>
          <Button aria-label={copy.searchClearScope} className={styles.railSearchClear!} onPress={() => setScope(undefined)}>
            <X aria-hidden="true" size={12} />
          </Button>
        </span>
      ) : null}
    </div>
  );
}
