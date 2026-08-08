import type { ComposerWorkspaceFileRef } from "@pi67/domain";
import { FileText, X } from "lucide-react";
import { Button } from "react-aria-components";
import styles from "./Composer.module.css";

export function ComposerWorkspaceContextChips({
  disabled,
  references,
  onRemove
}: {
  disabled: boolean;
  references: readonly ComposerWorkspaceFileRef[];
  onRemove: (reference: ComposerWorkspaceFileRef) => void;
}) {
  if (references.length === 0) return null;
  return (
    <div className={styles.workspaceContextRow} aria-label="已添加的工作区文件上下文">
      <span className={styles.workspaceContextLabel}>上下文</span>
      {references.map((reference) => (
        <span className={styles.workspaceContextChip} key={reference.id} title={reference.relativePath}>
          <FileText aria-hidden="true" size={12} />
          <span>{fileName(reference.relativePath)}</span>
          <Button
            aria-label={`移除工作区文件上下文 ${reference.relativePath}`}
            className={styles.workspaceContextRemove!}
            isDisabled={disabled}
            onPress={() => onRemove(reference)}
          >
            <X aria-hidden="true" size={11} />
          </Button>
        </span>
      ))}
    </div>
  );
}

function fileName(relativePath: string): string {
  return relativePath.split(/[\\/]/u).filter(Boolean).at(-1) ?? relativePath;
}
