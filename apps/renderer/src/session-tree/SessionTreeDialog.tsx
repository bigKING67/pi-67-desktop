import type { SessionTreeNodeView } from "@pi67/domain";
import { GitBranch, X } from "lucide-react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Virtuoso } from "react-virtuoso";
import { rollbackRendererSession } from "../session/session-lifecycle-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import { useCommittedSessionTreeProjection } from "./session-tree-store.js";

export function SessionTreeDialog() {
  const open = useShellStore((state) => state.sessionTreeDialogOpen);
  const setOpen = useShellStore((state) => state.setSessionTreeDialogOpen);
  const { tree, status } = useCommittedSessionTreeProjection();
  if (!open) return null;

  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={setOpen}>
      <Modal className="modal-surface session-tree-dialog">
        <Dialog aria-label="会话分支与回退" className="session-tree-dialog-content">
          <header className="session-tree-dialog-header">
            <div>
              <span className="dialog-eyebrow">PI SESSION</span>
              <Heading slot="title"><GitBranch size={18} />会话分支与回退</Heading>
            </div>
            <Button aria-label="关闭会话分支与回退" className="icon-button" onPress={() => setOpen(false)}><X size={16} /></Button>
          </header>
          <p className="dialog-message">选择一个节点，将当前活动分支回退到该位置。模型切换和思考等级等内部事件会以用户可读名称显示。</p>
          <div className="session-tree-dialog-summary">
            <span>{tree.truncated ? `显示 ${tree.nodes.length} / ${tree.total} 个节点` : `${tree.total} 个节点`}</span>
            {status === "loading" || status === "stale" ? <span>等待同步</span> : null}
          </div>
          <div className="session-tree-dialog-list" data-entry-count={tree.nodes.length}>
            {tree.nodes.length ? (
              <Virtuoso
                data={tree.nodes}
                itemContent={(_index, node) => (
                  <SessionTreeNode
                    node={node}
                    onSelect={(id) => {
                      setOpen(false);
                      void rollbackRendererSession(id);
                    }}
                  />
                )}
              />
            ) : <p className="context-empty">发送第一条消息后，会话节点会显示在这里。</p>}
          </div>
          <footer className="dialog-actions"><Button className="secondary-button" onPress={() => setOpen(false)}>关闭</Button></footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function SessionTreeNode({ node, onSelect }: { node: SessionTreeNodeView; onSelect: (id: string) => void }) {
  return (
    <div className="tree-node" style={{ paddingLeft: `${Math.min(node.depth, 8) * 10}px` }}>
      <button
        className={node.active ? "is-active" : ""}
        disabled={node.active}
        onClick={() => onSelect(node.id)}
        title={node.active ? "当前活动节点" : "将活动分支回退到此节点"}
        type="button"
      >
        <span className="tree-rail" aria-hidden="true" />
        <span><strong>{node.label ?? sessionNodeLabel(node.type)}</strong><small>{node.preview || "会话事件"}</small></span>
      </button>
    </div>
  );
}

function sessionNodeLabel(type: string): string {
  if (type === "model_change") return "切换模型";
  if (type === "thinking_level_change") return "调整思考等级";
  if (type === "compaction") return "压缩上下文";
  if (type === "branch_summary") return "分支摘要";
  if (type === "session_info") return "会话信息";
  if (type === "custom_message") return "扩展消息";
  if (type === "user_message") return "用户消息";
  if (type === "assistant_message") return "Pi 回复";
  if (type === "tool_result") return "工具结果";
  if (type === "message") return "会话消息";
  return "会话事件";
}
