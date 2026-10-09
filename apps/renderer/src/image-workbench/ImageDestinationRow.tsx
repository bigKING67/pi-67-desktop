import { Image as ImageIcon } from "lucide-react";
import { Button } from "react-aria-components";
import { useImageWorkbench } from "./image-workbench-store.js";
import styles from "./ImageDestinationRow.module.css";

/** `图像`: a destination in Work mode, above `搜索对话` (product model §5.1). */
export function ImageDestinationRow() {
  const open = useImageWorkbench((state) => state.view !== undefined);
  return (
    <Button
      aria-current={open ? "page" : false}
      className={`${styles.row} ${open ? styles.selected : ""}`}
      data-testid="image-workbench-entry"
      onPress={() => useImageWorkbench.getState().openLibrary()}
    >
      <ImageIcon aria-hidden="true" className={styles.icon} size={15} />
      <span>图像</span>
    </Button>
  );
}
