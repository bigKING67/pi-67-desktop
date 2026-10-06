import { FolderOpen, HardDrive, History, MessagesSquare } from "lucide-react";
import piIconUrl from "../assets/pi-icon-64.png";
import { messages } from "../localization/message-catalog.js";
import { useShellStore } from "../shell/shell-store.js";
import { openRendererWorkspace } from "./workspace-open-controller.js";
import styles from "./Welcome.module.css";

export function Welcome() {
  return (
    <main className={styles.screen}>
      <section className={styles.copy}>
        <div className={styles.identity}>
          <img alt="" aria-hidden="true" className={styles.mark} src={piIconUrl} />
          <div>
            <span className={styles.productName}>{messages.workspace.eyebrow}</span>
            <h1>{messages.workspace.heading}</h1>
          </div>
        </div>
        <p>{messages.workspace.description}</p>
        <div className={styles.actions}>
          <button
            className={`primary-button ${styles.action}`}
            data-testid="workspace-open-action"
            onClick={() => void openRendererWorkspace()}
            type="button"
          >
            <FolderOpen size={17} />
            {messages.workspace.openAction}
          </button>
          <button
            className={`secondary-button ${styles.action}`}
            data-testid="team-chat-open-action"
            onClick={() => useShellStore.getState().setWorkspaceMode("chat")}
            type="button"
          >
            <MessagesSquare size={17} />
            {messages.teamChat.openChat}
          </button>
        </div>
        <div className={styles.facts}>
          <div><History size={17} /><span><strong>{messages.workspace.existingConfiguration}</strong><small>{messages.workspace.existingConfigurationDetail}</small></span></div>
          <div><HardDrive size={17} /><span><strong>{messages.workspace.localData}</strong><small>{messages.workspace.localDataDetail}</small></span></div>
        </div>
      </section>
    </main>
  );
}
