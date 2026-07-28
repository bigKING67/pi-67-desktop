import type { WorkspaceDescriptor } from "@pi67/domain";
import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { publishNotification } from "../notifications/notification-store.js";
import { removeRendererWorkspace } from "../workbench/workspace-registration-controller.js";
import styles from "./WorkspaceRemovalDialog.module.css";

export function WorkspaceRemovalDialog({
  workspace,
  onDismiss
}: {
  workspace: WorkspaceDescriptor;
  onDismiss: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    setRemoving(true);
    try {
      const disposition = await removeRendererWorkspace(workspace.id);
      if (disposition === "allowed") {
        onDismiss();
        return;
      }
      publishNotification({
        level: "warning",
        title: "无法移除工作区",
        message: removalBlocker(disposition)
      });
    } catch {
      publishNotification({
        level: "error",
        title: "无法移除工作区",
        message: "工作区仍保留在工作台中，请重试。"
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!removing}
      isOpen
      onOpenChange={(open) => { if (!open && !removing) onDismiss(); }}
    >
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label={`移除工作区：${workspace.displayName}`} className={styles.dialog!}>
          <span className="dialog-eyebrow">工作区</span>
          <Heading slot="title">从工作台移除“{workspace.displayName}”？</Heading>
          <p>这只会移除工作台登记，不会删除目录、Pi Session 或项目文件。</p>
          <code title={workspace.identity.canonicalPath}>{workspace.identity.canonicalPath}</code>
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" isDisabled={removing} onPress={onDismiss}>取消</Button>
            <Button className={styles.removeButton!} isDisabled={removing} onPress={() => void remove()}>
              {removing ? "正在移除…" : "仅从工作台移除"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function removalBlocker(disposition: "workspace-missing" | "tasks-open" | "workspace-active" | "host-busy"): string {
  if (disposition === "tasks-open") return "请先处理这个工作区仍在运行、等待或包含草稿的会话。";
  if (disposition === "workspace-active") return "请先切换到另一个工作区，再移除这个工作区。";
  if (disposition === "host-busy") return "Pi 运行服务仍有这个工作区的活动任务。工作区登记已保留，请停止任务后重试。";
  return "这个工作区已不在工作台中。";
}
