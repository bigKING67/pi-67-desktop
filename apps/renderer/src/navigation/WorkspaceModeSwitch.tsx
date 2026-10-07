import { horseHead } from "@lucide/lab";
import { Icon, type IconNode } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "react-aria-components";
import { teamChatUnreadTotal } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { useShellStore, type WorkspaceMode } from "../shell/shell-store.js";
import { useTeamChat } from "../team-chat/team-chat-instance.js";
import styles from "./NavigationRail.module.css";

/**
 * Work and Chat mode identity (PRODUCT.md): 牛马, animals at work. Work is a plough ox with
 * long working horns and a nose ring; Chat is the Lucide Lab horse head wearing a bridle.
 */
function OxIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round"
      strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24" width={size}>
      <path d="M8.5 9.5C5 9.5 3 8 2.5 5" />
      <path d="M15.5 9.5c3.5 0 5.5-1.5 6-4.5" />
      <path d="M8.5 9.5h7l-.7 5.6a2.4 2.4 0 0 1-2.4 2.1h-.8a2.4 2.4 0 0 1-2.4-2.1Z" />
      <path d="M8.6 11.2 6.5 11.8" />
      <path d="m15.4 11.2 2.1.6" />
      <path d="M10.5 12.6h.01" />
      <path d="M13.5 12.6h.01" />
      <path d="M10.3 19.4a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0" />
    </svg>
  );
}

const BRIDLED_HORSE: IconNode = [
  ...horseHead,
  ["path", { d: "M17.6 13.6 16.4 19.2", key: "noseband" }],
  ["path", { d: "M17 16.2 11.6 9.6", key: "cheekpiece" }]
];

function HorseIcon({ size }: { size: number }) {
  return <Icon aria-hidden="true" iconNode={BRIDLED_HORSE} size={size} />;
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
      {option("work", copy.work, <OxIcon size={15} />)}
      {option("chat", copy.chat, <HorseIcon size={15} />,
        unread > 0 && mode !== "chat" ? copy.chatUnread(unread) : copy.chat)}
    </div>
  );
}
