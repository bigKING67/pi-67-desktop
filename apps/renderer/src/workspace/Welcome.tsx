import { FolderOpen, Image as ImageIcon, MessagesSquare } from "lucide-react";
import { useImageWorkbench } from "../image-workbench/image-workbench-store.js";
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
          <button
            className={`secondary-button ${styles.action}`}
            data-testid="image-workbench-open-action"
            onClick={() => useImageWorkbench.getState().openLibrary()}
            type="button"
          >
            <ImageIcon size={17} />
            打开图像
          </button>
        </div>
        {/* Reuse and local-only data stay as one quiet assurance, not a feature list. */}
        <p className={styles.assurance}>{messages.workspace.assurance}</p>
      </section>
    </main>
  );
}
