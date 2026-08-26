import type { WorkspaceMessageSearchItem } from "@pi67/domain";
import { MessageSquareText } from "lucide-react";
import { openWorkspaceMessageResult } from "../command-palette/palette-message-result.js";
import styles from "./NavigationRail.module.css";

export function ConversationContentResult({
  disabled,
  item
}: {
  disabled: boolean;
  item: WorkspaceMessageSearchItem;
}) {
  return (
    <button
      className={styles.contentSearchResult}
      disabled={disabled}
      onClick={() => void openWorkspaceMessageResult(item)}
      type="button"
    >
      <MessageSquareText aria-hidden="true" size={13} />
      <span>
        <strong>{item.sessionName}</strong>
        <small>{item.role === "user" ? "用户" : "Pi"} · {item.snippet}</small>
      </span>
    </button>
  );
}
