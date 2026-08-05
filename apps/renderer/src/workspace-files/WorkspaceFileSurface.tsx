import type { ReactNode } from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import type { WorkspaceDescriptor, WorkspaceFileEntry } from "@pi67/domain";
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  LoaderCircle,
  RotateCcw,
  Save,
  X
} from "lucide-react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import {
  activateWorkspaceFileTab,
  executeWorkspaceEntryAction,
  reloadWorkspaceFile,
  saveWorkspaceDraftAs,
  saveWorkspaceFile,
  showWorkspaceEntryMenu
} from "./workspace-file-controller.js";
import {
  useWorkspaceFileStore,
  workspaceFileStore,
  type WorkspaceFileTab
} from "./workspace-file-store.js";
import { WorkspaceFileNameDialog } from "./WorkspaceFileNameDialog.js";

const FileEditor = lazy(() => import("./FileEditor.js").then((module) => ({ default: module.FileEditor })));

export function WorkspaceFileSurface({
  workspace,
  children
}: {
  workspace: WorkspaceDescriptor;
  children: ReactNode;
}) {
  const fileWorkspace = useWorkspaceFileStore((state) => state.workspaces[workspace.id]);
  const draftPersistence = useWorkspaceFileStore((state) => state.draftPersistence);
  const persistenceError = useWorkspaceFileStore((state) => state.persistenceError);
  const [closeCandidate, setCloseCandidate] = useState<string>();
  const [reloadCandidate, setReloadCandidate] = useState<string>();
  const [saveAsCandidate, setSaveAsCandidate] = useState<string>();
  const tabs = fileWorkspace?.tabs ?? [];
  const activeRelativePath = fileWorkspace?.activeRelativePath;
  const activeTab = activeRelativePath ? fileWorkspace?.byPath[activeRelativePath] : undefined;

  useEffect(() => {
    if (activeTab?.phase === "restoring") {
      void activateWorkspaceFileTab(workspace, activeTab.relativePath);
    }
  }, [activeTab?.phase, activeTab?.relativePath, workspace]);

  if (tabs.length === 0) return children;

  return (
    <section aria-label="工作区文件与对话" className="workspace-file-surface">
      <div className="workspace-file-tabs" role="tablist" aria-label="对话和文件">
        <button
          aria-selected={!activeRelativePath}
          className="workspace-file-tab is-conversation"
          role="tab"
          type="button"
          onClick={() => workspaceFileStore.getState().activateConversation(workspace.id)}
        >对话</button>
        <div className="workspace-file-tab-scroll">
          {tabs.map((relativePath) => {
            const tab = fileWorkspace?.byPath[relativePath];
            if (!tab) return null;
            return (
              <div
                className={`workspace-file-tab-shell ${activeRelativePath === relativePath ? "is-active" : ""}`}
                key={relativePath}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void showFileEntryMenu(workspace, tabEntry(tab));
                }}
              >
                <button
                  aria-selected={activeRelativePath === relativePath}
                  className="workspace-file-tab"
                  role="tab"
                  title={relativePath}
                  type="button"
                  onClick={() => void activateWorkspaceFileTab(workspace, relativePath)}
                >
                  {tab.dirty ? <span aria-label="未保存" className="workspace-file-dirty-dot" /> : <FileText aria-hidden="true" size={12} />}
                  <span>{tab.name}</span>
                </button>
                <button
                  aria-label={`关闭 ${tab.name}`}
                  className="workspace-file-tab-close"
                  type="button"
                  onClick={() => requestClose(workspace.id, tab, setCloseCandidate)}
                ><X size={12} /></button>
              </div>
            );
          })}
        </div>
        {tabs.length > 5 ? (
          <select
            aria-label="所有文件标签"
            className="workspace-file-tab-overflow"
            value={activeRelativePath ?? ""}
            onChange={(event) => {
              const relativePath = event.target.value;
              if (relativePath) void activateWorkspaceFileTab(workspace, relativePath);
              else workspaceFileStore.getState().activateConversation(workspace.id);
            }}
          >
            <option value="">对话</option>
            {tabs.map((relativePath) => (
              <option key={relativePath} value={relativePath}>{fileWorkspace?.byPath[relativePath]?.name ?? relativePath}</option>
            ))}
          </select>
        ) : null}
      </div>

      <div className="workspace-file-surface-body">
        {activeTab ? (
          <FileDocumentSurface
            draftPersistence={draftPersistence}
            persistenceError={persistenceError}
            tab={activeTab}
            workspace={workspace}
            onReload={() => activeTab.dirty
              ? setReloadCandidate(activeTab.relativePath)
              : void reloadWorkspaceFile(workspace, activeTab.relativePath)}
            onSaveAs={() => setSaveAsCandidate(activeTab.relativePath)}
          />
        ) : children}
      </div>

      {closeCandidate ? (
        <DirtyFileCloseDialog
          relativePath={closeCandidate}
          workspace={workspace}
          onDismiss={() => setCloseCandidate(undefined)}
        />
      ) : null}
      {reloadCandidate ? (
        <DirtyFileReloadDialog
          relativePath={reloadCandidate}
          workspace={workspace}
          onDismiss={() => setReloadCandidate(undefined)}
        />
      ) : null}
      {saveAsCandidate ? (
        <WorkspaceFileNameDialog
          confirmLabel="另存草稿"
          detail={`位置：${parentRelativePath(saveAsCandidate) || "工作区根目录"}`}
          initialName={suggestCopyName(saveAsCandidate)}
          mode="save-as"
          title="将草稿另存为"
          onDismiss={() => setSaveAsCandidate(undefined)}
          onConfirm={(name) => saveWorkspaceDraftAs(workspace, saveAsCandidate, name)}
        />
      ) : null}
    </section>
  );
}

function FileDocumentSurface({
  workspace,
  tab,
  draftPersistence,
  persistenceError,
  onReload,
  onSaveAs
}: {
  workspace: WorkspaceDescriptor;
  tab: WorkspaceFileTab;
  draftPersistence: "available" | "unavailable";
  persistenceError?: string | undefined;
  onReload: () => void;
  onSaveAs: () => void;
}) {
  const save = () => void saveWorkspaceFile(workspace, tab.relativePath);
  return (
    <section aria-label={tab.relativePath} className="workspace-file-document">
      <header className="workspace-file-document-header">
        <div>
          <strong>{tab.name}</strong>
          <code title={tab.relativePath}>{tab.relativePath}</code>
        </div>
        <div className="workspace-file-document-actions">
          {tab.dirty ? (
            <button disabled={tab.conflict} type="button" onClick={save}><Save size={13} />保存</button>
          ) : null}
          <button type="button" onClick={onReload}>
            <RotateCcw size={13} />重新读取
          </button>
          <button type="button" onClick={() => void showFileEntryMenu(workspace, tabEntry(tab))}>
            <ExternalLink size={13} />更多
          </button>
        </div>
      </header>

      {tab.conflict ? (
        <div className="workspace-file-conflict" role="alert">
          <AlertTriangle size={15} />
          <span>{tab.reason ?? "磁盘文件已变化，草稿不会覆盖它。"}</span>
          <button type="button" onClick={onReload}>放弃草稿并重新读取</button>
          <button type="button" onClick={onSaveAs}>将草稿另存为</button>
        </div>
      ) : null}
      {draftPersistence === "unavailable" && tab.dirty ? (
        <div className="workspace-file-persistence-warning" role="status">
          当前系统无法加密保存草稿；退出前请保存或放弃修改。
        </div>
      ) : persistenceError ? (
        <div className="workspace-file-persistence-warning" role="status">{persistenceError}</div>
      ) : null}

      {tab.phase === "loading" || tab.phase === "restoring" ? (
        <div className="workspace-file-state" role="status"><LoaderCircle className="spin" size={18} />正在打开文件</div>
      ) : tab.phase === "missing" ? (
        <div className="workspace-file-state"><AlertTriangle size={20} /><strong>文件已不存在</strong><p>{tab.reason}</p>{tab.dirty ? <button onClick={onSaveAs} type="button">将草稿另存为</button> : null}</div>
      ) : tab.phase === "unavailable" ? (
        <div className="workspace-file-state"><FileText size={20} /><strong>无法在 Pi-67 中编辑</strong><p>{tab.reason}</p><button type="button" onClick={() => void showFileEntryMenu(workspace, tabEntry(tab))}>选择系统打开方式</button></div>
      ) : tab.content !== undefined ? (
        <Suspense fallback={<div className="workspace-file-state" role="status"><LoaderCircle className="spin" size={18} />正在加载编辑器</div>}>
          <FileEditor
            content={tab.content}
            fileName={tab.name}
            key={`${tab.relativePath}:${tab.documentVersion}`}
            onChange={(content) => workspaceFileStore.getState().updateContent(workspace.id, tab.relativePath, content)}
            onSave={save}
          />
        </Suspense>
      ) : null}
    </section>
  );
}

function DirtyFileCloseDialog({
  workspace,
  relativePath,
  onDismiss
}: {
  workspace: WorkspaceDescriptor;
  relativePath: string;
  onDismiss: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const tab = useWorkspaceFileStore((state) => state.workspaces[workspace.id]?.byPath[relativePath]);
  if (!tab) return null;
  const saveAndClose = async () => {
    setSaving(true);
    try {
      if (!await saveWorkspaceFile(workspace, relativePath)) return;
      workspaceFileStore.getState().closeTab(workspace.id, relativePath);
      onDismiss();
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalOverlay className="modal-overlay" isDismissable={!saving} isOpen onOpenChange={(open) => { if (!open && !saving) onDismiss(); }}>
      <Modal className="modal-surface workspace-file-close-modal">
        <Dialog aria-label={`关闭 ${tab.name}`} className="workspace-file-close-dialog">
          <span className="dialog-eyebrow">未保存文件</span>
          <Heading slot="title">保存“{tab.name}”的修改？</Heading>
          <p>放弃后，本次草稿无法从 Pi-67 恢复。</p>
          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={saving} onPress={onDismiss}>取消</Button>
            <Button className="workspace-file-discard-button" isDisabled={saving} onPress={() => {
              workspaceFileStore.getState().closeTab(workspace.id, relativePath);
              onDismiss();
            }}>放弃修改</Button>
            <Button className="primary-button" isDisabled={saving || tab.conflict} onPress={() => void saveAndClose()}>
              {saving ? "正在保存…" : "保存并关闭"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function DirtyFileReloadDialog({
  workspace,
  relativePath,
  onDismiss
}: {
  workspace: WorkspaceDescriptor;
  relativePath: string;
  onDismiss: () => void;
}) {
  const [reloading, setReloading] = useState(false);
  const tab = useWorkspaceFileStore((state) => state.workspaces[workspace.id]?.byPath[relativePath]);
  if (!tab) return null;
  const discardAndReload = async () => {
    setReloading(true);
    try {
      if (await reloadWorkspaceFile(workspace, relativePath)) onDismiss();
    } finally {
      setReloading(false);
    }
  };
  return (
    <ModalOverlay className="modal-overlay" isDismissable={!reloading} isOpen onOpenChange={(open) => {
      if (!open && !reloading) onDismiss();
    }}>
      <Modal className="modal-surface workspace-file-close-modal">
        <Dialog aria-label={`重新读取 ${tab.name}`} className="workspace-file-close-dialog">
          <span className="dialog-eyebrow">未保存文件</span>
          <Heading slot="title">放弃“{tab.name}”的修改？</Heading>
          <p>重新读取会用磁盘中的最新内容替换当前草稿，此操作无法在 Pi-67 中撤销。</p>
          <div className="dialog-actions">
            <Button className="secondary-button" isDisabled={reloading} onPress={onDismiss}>取消</Button>
            <Button className="workspace-file-discard-button" isDisabled={reloading} onPress={() => void discardAndReload()}>
              {reloading ? "正在重新读取…" : "放弃修改并重新读取"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function requestClose(
  workspaceId: string,
  tab: WorkspaceFileTab,
  setCloseCandidate: (path: string) => void
): void {
  if (tab.dirty) setCloseCandidate(tab.relativePath);
  else workspaceFileStore.getState().closeTab(workspaceId, tab.relativePath);
}

async function showFileEntryMenu(workspace: WorkspaceDescriptor, entry: WorkspaceFileEntry): Promise<void> {
  const action = await showWorkspaceEntryMenu(workspace, entry);
  if (action && action !== "rename" && action !== "trash") {
    await executeWorkspaceEntryAction(workspace, entry, action);
  }
}

function tabEntry(tab: WorkspaceFileTab): WorkspaceFileEntry {
  return {
    id: tab.id ?? "",
    name: tab.name,
    relativePath: tab.relativePath,
    kind: "file",
    revision: tab.revision ?? "unresolved"
  };
}

function suggestCopyName(relativePath: string): string {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}-copy${name.slice(dot)}` : `${name}-copy`;
}

function parentRelativePath(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index < 0 ? "" : relativePath.slice(0, index);
}
