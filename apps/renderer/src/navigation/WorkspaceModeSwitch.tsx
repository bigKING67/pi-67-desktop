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
 * Work and Chat mode identity (PRODUCT.md): 牛马, deadpan animals at work. Both wear the same
 * half-lidded "fine, I'll do it" look: Work is a front-facing ox with a broad muzzle; Chat is the
 * Lucide Lab horse head with a side-eye, flat brow and a slight smirk. Original drawings.
 */
function OxIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round"
      strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24" width={size}>
      <path d="M7 8.5C7 5.6 9.2 4 12 4s5 1.6 5 4.5V13" />
      <path d="M7 8.5V13" />
      <path d="M7.2 16.4a4.8 3.4 0 1 0 9.6 0a4.8 3.4 0 1 0-9.6 0" />
      <path d="M8.3 5.4C6.8 5 6 3.6 6.3 2.1" />
      <path d="M15.7 5.4c1.5-.4 2.3-1.8 2-3.3" />
      <path d="M7 9.3 4.3 8.7l.9 1.8L7 11.2" />
      <path d="m17 9.3 2.7-.6-.9 1.8-1.8.7" />
      <path d="M8.9 10.4h2" />
      <path d="M13.1 10.4h2" />
      <path d="M9.9 11.2h.01" />
      <path d="M14.1 11.2h.01" />
      <path d="M10.4 15.6h.01" />
      <path d="M13.6 15.6h.01" />
      <path d="M10.2 17.8c1.2.5 2.6.5 3.8-.1" />
    </svg>
  );
}

// The Lab head's dot eye is replaced by a half-lidded side-eye, a flat brow and a smirk.
const DEADPAN_HORSE: IconNode = [
  ...horseHead.filter(([, attributes]) => attributes["d"] !== "M11.5 12H11"),
  ["path", { d: "M10.4 11.6h2.2", key: "eyelid" }],
  ["path", { d: "M11.8 12.3h.01", key: "pupil" }],
  ["path", { d: "M10 9.8l2.6-.4", key: "brow" }],
  ["path", { d: "M15.4 16.9c.9.3 1.8.1 2.5-.6", key: "smirk" }]
];

function HorseIcon({ size }: { size: number }) {
  return <Icon aria-hidden="true" iconNode={DEADPAN_HORSE} size={size} />;
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
      {option("work", copy.work, <OxIcon size={16} />)}
      {option("chat", copy.chat, <HorseIcon size={16} />,
        unread > 0 && mode !== "chat" ? copy.chatUnread(unread) : copy.chat)}
    </div>
  );
}
