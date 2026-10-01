import { ChessKnight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "react-aria-components";
import { teamChatUnreadTotal } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { useShellStore, type WorkspaceMode } from "../shell/shell-store.js";
import { useTeamChat } from "../team-chat/team-chat-instance.js";
import styles from "./NavigationRail.module.css";

/** Work and Chat mode identity (PRODUCT.md): a bull for Work, a horse for Chat. */
function BullIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round"
      strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24" width={size}>
      <path d="M7 9C4.5 9 3 7.2 3 4.5" />
      <path d="M17 9c2.5 0 4-1.8 4-4.5" />
      <path d="M7 9h10l-1.3 7.6A3 3 0 0 1 12.75 19h-1.5a3 3 0 0 1-2.95-2.4Z" />
      <path d="M7.4 11.5 5 12" />
      <path d="m16.6 11.5 2.4.5" />
      <path d="M10.5 15.5h.01" />
      <path d="M13.5 15.5h.01" />
    </svg>
  );
}

export function WorkspaceModeSwitch() {
  const mode = useShellStore((state) => state.workspaceMode);
  const setMode = useShellStore((state) => state.setWorkspaceMode);
  const unread = useTeamChat((state) => (state.directory ? teamChatUnreadTotal(state.directory.conversations) : 0));
  const copy = messages.teamChat;
  const option = (value: WorkspaceMode, label: string, icon: ReactNode, accessibleLabel = label) => (
    <Button
      aria-label={accessibleLabel}
      aria-pressed={mode === value}
      className={`${styles.modeOption} ${mode === value ? styles.modeSelected : ""}`}
      data-testid={`workspace-mode-${value}`}
      onPress={() => setMode(value)}
    >
      {icon}
      <span>{label}</span>
      {value === "chat" && unread > 0 && mode !== "chat" ? (
        <span aria-hidden="true" className={styles.modeBadge}>{unread > 99 ? "99+" : unread}</span>
      ) : null}
    </Button>
  );
  return (
    <div aria-label={copy.modeSwitch} className={styles.modeSwitch} role="group">
      {option("work", copy.work, <BullIcon size={15} />)}
      {option("chat", copy.chat, <ChessKnight aria-hidden="true" size={15} />,
        unread > 0 && mode !== "chat" ? copy.chatUnread(unread) : copy.chat)}
    </div>
  );
}
