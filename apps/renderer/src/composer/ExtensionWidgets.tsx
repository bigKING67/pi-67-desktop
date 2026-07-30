import type { ExtensionWidgetItem } from "../extension-ui/extension-ui-state.js";
import styles from "./Composer.module.css";

export function ExtensionWidgets({
  items,
  placement
}: {
  items: ExtensionWidgetItem[];
  placement: ExtensionWidgetItem["placement"];
}) {
  return items.filter((item) => item.placement === placement).map((item) => (
    <div className={styles.extensionWidget} key={item.id}>
      <strong>{item.key}</strong>
      <span>{item.message}</span>
    </div>
  ));
}
