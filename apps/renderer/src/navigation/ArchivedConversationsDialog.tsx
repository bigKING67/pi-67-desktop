import type { SessionCatalogCursor, SessionSummary, WorkspaceDescriptor } from "@pi67/domain";
import { ArchiveRestore, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, Heading, Input, Modal, ModalOverlay } from "react-aria-components";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { restoreRendererConversation } from "./conversation-organization-controller.js";
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import { querySessionCatalogPage } from "./session-catalog-controller.js";
import { formatSessionRelativeTime } from "./session-navigation.js";
import styles from "./ConversationDialogs.module.css";

export function ArchivedConversationsDialog({ workspace }: { workspace: WorkspaceDescriptor }) {
  const close = useConversationDialogStore((state) => state.closeArchived);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SessionSummary[]>([]);
  const [cursor, setCursor] = useState<SessionCatalogCursor>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [restoringIdentity, setRestoringIdentity] = useState<string>();
  const loadRevision = useRef(0);

  const load = useCallback(async (revision: number, nextCursor?: SessionCatalogCursor) => {
    setLoading(true);
    setError(undefined);
    try {
      const page = await querySessionCatalogPage({
        workspaceId: workspace.id,
        view: "archived",
        query,
        ...(nextCursor ? { cursor: nextCursor } : {})
      });
      if (revision !== loadRevision.current) return;
      setItems((current) => nextCursor ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (loadError) {
      if (revision !== loadRevision.current) return;
      setError(loadError instanceof Error ? loadError.message : "无法加载已归档对话");
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [query, workspace.id]);

  useEffect(() => {
    const revision = loadRevision.current + 1;
    loadRevision.current = revision;
    const timer = window.setTimeout(() => void load(revision), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const restore = async (session: SessionSummary, open: boolean) => {
    if (restoringIdentity) return;
    setRestoringIdentity(session.fileIdentity);
    try {
      if (!await restoreRendererConversation(workspace.id, session)) return;
      setItems((current) => current.filter((item) => item.fileIdentity !== session.fileIdentity));
      if (open) {
        close();
        await openRendererWorkspaceDescriptor(workspace, session.path, session.fileIdentity);
      }
    } finally {
      setRestoringIdentity(undefined);
    }
  };

  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) close(); }}>
      <Modal className={`modal-surface ${styles.archiveModal}`}>
        <Dialog aria-label={`已归档对话：${workspace.displayName}`} className={styles.archiveDialog!}>
          <header className={styles.archiveHeader}>
            <div><span className="dialog-eyebrow">{workspace.displayName}</span><Heading slot="title">已归档对话</Heading></div>
            <Button aria-label="关闭已归档对话" className={styles.iconButton!} onPress={close}><X size={16} /></Button>
          </header>
          <label className={styles.searchField}>
            <Search aria-hidden="true" size={14} />
            <Input aria-label="搜索已归档对话" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索标题或 Session" value={query} />
          </label>
          <div className={styles.archiveList}>
            {items.map((session) => (
              <article className={styles.archiveRow} key={session.fileIdentity}>
                <ArchiveRestore aria-hidden="true" size={15} />
                <span><strong>{session.name}</strong><small>{session.messageCount} 条消息 · 归档于 {formatDate(session.archivedAt)} · 最后修改 {formatSessionRelativeTime(session.modifiedAt)}</small></span>
                <div>
                  <Button className={styles.rowButton!} isDisabled={restoringIdentity !== undefined} onPress={() => void restore(session, false)}>
                    {restoringIdentity === session.fileIdentity ? "正在恢复…" : "恢复"}
                  </Button>
                  <Button className={styles.rowPrimaryButton!} isDisabled={restoringIdentity !== undefined} onPress={() => void restore(session, true)}>恢复并打开</Button>
                </div>
              </article>
            ))}
            {!loading && !error && items.length === 0 ? <p className={styles.empty}>没有匹配的已归档对话。</p> : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {loading ? <p className={styles.empty} role="status">正在加载…</p> : null}
          </div>
          {hasMore && cursor ? (
            <Button className={styles.loadMore!} isDisabled={loading || restoringIdentity !== undefined} onPress={() => void load(loadRevision.current, cursor)}>加载更多</Button>
          ) : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function formatDate(timestamp: number | undefined): string {
  if (timestamp === undefined) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}
