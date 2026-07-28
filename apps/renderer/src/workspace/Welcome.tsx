import { FolderOpen, HardDrive, History } from "lucide-react";
import { Button } from "react-aria-components";
import piIconUrl from "../assets/pi-icon-64.png";
import { messages } from "../localization/message-catalog.js";
import { openRendererWorkspace } from "./workspace-open-controller.js";
import styles from "./Welcome.module.css";

export function Welcome() {
  return (
    <main className={styles.screen}>
      <section className={styles.copy}>
        <div className={styles.identity}>
          <img alt="" aria-hidden="true" className={styles.mark} src={piIconUrl} />
          <div>
            <span className={styles.eyebrow}>{messages.workspace.eyebrow}</span>
            <h1>{messages.workspace.heading}</h1>
          </div>
        </div>
        <p>{messages.workspace.description}</p>
        <Button
          className={`primary-button ${styles.action}`}
          data-testid="workspace-open-action"
          onPress={() => void openRendererWorkspace()}
        >
          <FolderOpen size={17} />
          {messages.workspace.openAction}
        </Button>
        <div className={styles.facts}>
          <div><History size={17} /><span><strong>{messages.workspace.existingConfiguration}</strong><small>{messages.workspace.existingConfigurationDetail}</small></span></div>
          <div><HardDrive size={17} /><span><strong>{messages.workspace.localData}</strong><small>{messages.workspace.localDataDetail}</small></span></div>
        </div>
      </section>
    </main>
  );
}
