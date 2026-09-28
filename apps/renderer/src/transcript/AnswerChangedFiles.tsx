import { FileText } from "lucide-react";
import { useMemo } from "react";
import {
  selectTurnChangedFiles,
  type TurnChangedFile
} from "../changes/changes-projection.js";
import {
  selectCommittedWorkspaceChangesProjection,
  useWorkspaceChangesStore
} from "../changes/workspace-changes-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useShellStore } from "../shell/shell-store.js";
import { openWorkspaceFileByRelativePath } from "../workspace-files/workspace-file-controller.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import styles from "./AnswerChangedFiles.module.css";

const VISIBLE_FILE_LIMIT = 5;

/**
 * Files a settled answer's turn changed, read from the `会话修改` projection. Renders nothing
 * while the projection is loading, failed or has no completed fact for the turn; the Inspector
 * owns those states.
 */
export function AnswerChangedFiles({ turnId }: { turnId: string }) {
  const canonicalAuthority = useSessionProjectionStore((state) => state.authority);
  const items = useWorkspaceChangesStore((state) => (
    selectCommittedWorkspaceChangesProjection(state, canonicalAuthority).projection?.items
  ));
  const workspace = useWorkbenchStore((state) => {
    const workspaceId = selectedWorkbenchTask(state)?.workspaceId ?? state.currentWorkspaceId;
    return workspaceId ? state.workspaces[workspaceId] : undefined;
  });
  const workspaceRoot = workspace?.identity.canonicalPath;
  const turn = useMemo(
    () => selectTurnChangedFiles(items ?? [], turnId, workspaceRoot),
    [items, turnId, workspaceRoot]
  );
  const newest = turn.files[0];
  if (!newest) return null;

  const focusInspector = () => useShellStore.getState().focusSessionChange(newest.toolCallId);
  const hiddenCount = turn.files.length - VISIBLE_FILE_LIMIT;
  return (
    <section aria-label="本轮修改的文件" className={styles.changedFiles}>
      <header className={styles.heading}>
        <span>本轮修改的文件 · {turn.files.length}</span>
        <button className={styles.link} onClick={focusInspector} type="button">在检查器中查看</button>
      </header>
      <ul className={styles.list}>
        {turn.files.slice(0, VISIBLE_FILE_LIMIT).map((file) => (
          <li key={file.path}>
            <ChangedFileRow
              file={file}
              onOpen={workspace && file.relativePath
                ? () => void openWorkspaceFileByRelativePath(workspace, file.relativePath!)
                : undefined}
            />
          </li>
        ))}
      </ul>
      {hiddenCount > 0 || turn.unfinishedCount > 0 ? (
        <footer className={styles.footer}>
          {turn.unfinishedCount > 0 ? <span>{turn.unfinishedCount} 项未完成</span> : null}
          {hiddenCount > 0 ? (
            <button className={styles.link} onClick={focusInspector} type="button">
              查看全部 {turn.files.length} 个文件
            </button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

function ChangedFileRow({ file, onOpen }: { file: TurnChangedFile; onOpen: (() => void) | undefined }) {
  const shownPath = file.relativePath ?? file.path;
  const separator = shownPath.lastIndexOf("/");
  const name = separator >= 0 ? shownPath.slice(separator + 1) : shownPath;
  const directory = separator > 0 ? shownPath.slice(0, separator) : undefined;
  const content = (
    <>
      <FileText aria-hidden="true" className={styles.icon} size={15} />
      <span className={styles.name}>{name}</span>
      <span className={styles.directory} title={directory}>{directory}</span>
      <ChangedFileMetric file={file} />
    </>
  );
  if (!onOpen) {
    return <div className={styles.row} title={file.path}>{content}</div>;
  }
  return (
    <button
      aria-label={`打开 ${shownPath}`}
      className={`${styles.row} ${styles.openable}`}
      onClick={onOpen}
      title={shownPath}
      type="button"
    >
      {content}
    </button>
  );
}

function ChangedFileMetric({ file }: { file: TurnChangedFile }) {
  if (file.written) return <span className={styles.metric}>新建或覆盖</span>;
  if (file.additions === undefined && file.deletions === undefined) return null;
  return (
    <span className={`${styles.metric} ${styles.stats}`}>
      <b>+{file.additions ?? 0}</b>
      <i>−{file.deletions ?? 0}</i>
    </span>
  );
}
