import type { ExtensionPackageEntry, ExtensionPackageScope } from "@pi67/domain";
import {
  Download,
  PackagePlus,
  Power,
  RefreshCw,
  RotateCcw,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  checkExtensionPackageUpdates,
  installExtensionPackage,
  loadExtensionPackages,
  restoreExtensionPackageInheritance,
  setExtensionPackageEnabled,
  uninstallExtensionPackage,
  updateExtensionPackage
} from "./extension-package-controller.js";
import { useExtensionPackageStore } from "./extension-package-store.js";
import styles from "./ExtensionPackageManager.module.css";

type ConfirmedAction =
  | { kind: "install"; source: string; scope: ExtensionPackageScope }
  | { kind: "update"; entry: ExtensionPackageEntry }
  | { kind: "uninstall"; entry: ExtensionPackageEntry };

export function ExtensionPackageManager() {
  const scope = useWorkbenchStore((state) => state.settingsScope);
  const workspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId ?? state.currentWorkspaceId);
  const workspace = useWorkbenchStore((state) => (
    workspaceId ? state.workspaces[workspaceId] : undefined
  ));
  const items = useExtensionPackageStore((state) => state.items);
  const updates = useExtensionPackageStore((state) => state.updates);
  const phase = useExtensionPackageStore((state) => state.phase);
  const error = useExtensionPackageStore((state) => state.error);
  const [source, setSource] = useState("");
  const [pending, setPending] = useState<ConfirmedAction | undefined>(undefined);
  const displayed = useMemo(() => packagesForScope(items, scope), [items, scope]);
  const busy = phase === "loading" || phase === "checking" || phase === "mutating";

  useEffect(() => {
    if (workspaceId) void loadExtensionPackages(workspaceId);
  }, [workspaceId]);

  const confirm = async () => {
    if (!pending || !workspaceId) return;
    const completed = pending.kind === "install"
      ? await installExtensionPackage(pending.source, pending.scope, workspaceId)
      : pending.kind === "update"
        ? await updateExtensionPackage(pending.entry.source, pending.entry.scope, workspaceId)
        : await uninstallExtensionPackage(pending.entry.source, pending.entry.scope, workspaceId);
    if (!completed) return;
    if (pending.kind === "install") setSource("");
    setPending(undefined);
  };

  return (
    <>
      <section className={styles.manager}>
        <header className={styles.header}>
          <div>
            <h4>已配置的 Extension 包</h4>
            <p>使用 Pi 官方 SettingsManager 与 DefaultPackageManager；本地 path 卸载只移除引用。</p>
          </div>
          <Button
            className="secondary-button"
            isDisabled={!workspaceId || busy}
            onPress={() => void checkExtensionPackageUpdates(workspaceId)}
          >
            <RefreshCw aria-hidden="true" size={14} />检查更新
          </Button>
        </header>

        <div className={styles.installRow}>
          <label>
            <span>npm、git 或本地 path</span>
            <input
              disabled={!workspaceId || busy}
              maxLength={4_096}
              onChange={(event) => setSource(event.currentTarget.value)}
              placeholder="npm:@scope/package、https://…git 或 /absolute/path"
              value={source}
            />
          </label>
          <Button
            className="primary-button"
            isDisabled={!workspaceId || busy || source.trim().length === 0}
            onPress={() => setPending({ kind: "install", source: source.trim(), scope })}
          >
            <PackagePlus aria-hidden="true" size={14} />安装到{scope === "global" ? "全局" : "项目"}
          </Button>
        </div>

        {phase === "loading" ? <p className={styles.empty}>正在读取 Pi Extension 配置…</p> : null}
        {error ? <p className={styles.error}>{error}</p> : null}
        {!workspace ? <p className={styles.empty}>添加或选择 Workspace 后可管理 Extensions。</p> : null}
        {workspace && phase !== "loading" && displayed.length === 0 ? (
          <p className={styles.empty}>当前作用域还没有配置 Extension 包。</p>
        ) : null}

        <div className={styles.packageList}>
          {displayed.map(({ entry, inherited }) => {
            const update = updates.find((candidate) => (
              candidate.source === entry.source && candidate.scope === entry.scope
            ));
            const mutationScope = inherited ? "project" : entry.scope;
            return (
              <article className={styles.packageRow} key={`${entry.scope}:${entry.source}:${inherited}`}>
                <span className={styles.status} data-enabled={entry.enabled} />
                <div className={styles.packageMeta}>
                  <strong>{entry.source}</strong>
                  <span>
                    {inherited ? "继承自全局" : entry.scope === "global" ? "全局" : "当前项目"}
                    {entry.filtered ? " · 已设置资源过滤" : ""}
                    {!entry.installed ? " · 安装内容缺失" : ""}
                  </span>
                </div>
                <div className={styles.packageActions}>
                  {update ? (
                    <Button
                      aria-label={`更新 ${entry.source}`}
                      isDisabled={busy}
                      onPress={() => setPending({ kind: "update", entry })}
                    ><Download aria-hidden="true" size={13} />更新</Button>
                  ) : null}
                  <Button
                    aria-label={`${entry.enabled ? "停用" : "启用"} ${entry.source}`}
                    isDisabled={busy}
                    onPress={() => void setExtensionPackageEnabled(
                      entry.source,
                      mutationScope,
                      !entry.enabled,
                      workspaceId
                    )}
                  ><Power aria-hidden="true" size={13} />{entry.enabled ? "停用" : "启用"}</Button>
                  {!inherited && entry.scope === "project" ? (
                    <Button
                      aria-label={`恢复继承 ${entry.source}`}
                      isDisabled={busy}
                      onPress={() => void restoreExtensionPackageInheritance(entry.source, workspaceId)}
                    ><RotateCcw aria-hidden="true" size={13} />恢复继承</Button>
                  ) : null}
                  {!inherited && entry.scope === scope ? (
                    <Button
                      aria-label={`卸载 ${entry.source}`}
                      className={styles.dangerButton!}
                      isDisabled={busy}
                      onPress={() => setPending({ kind: "uninstall", entry })}
                    ><Trash2 aria-hidden="true" size={13} />卸载</Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {pending ? (
        <PackageActionDialog
          action={pending}
          onCancel={() => setPending(undefined)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </>
  );
}

function PackageActionDialog({ action, onCancel, onConfirm }: {
  action: ConfirmedAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const source = action.kind === "install" ? action.source : action.entry.source;
  const scope = action.kind === "install" ? action.scope : action.entry.scope;
  const title = action.kind === "install"
    ? "安装 Extension 包？"
    : action.kind === "update" ? "更新 Extension 包？" : "卸载 Extension 包？";
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label={title} className={styles.dialog!}>
          <span className="dialog-eyebrow">Pi Extension 管理</span>
          <Heading slot="title">{title}</Heading>
          <dl>
            <div><dt>来源</dt><dd>{source}</dd></div>
            <div><dt>作用域</dt><dd>{scope === "global" ? "全局" : "当前项目"}</dd></div>
          </dl>
          <p>{action.kind === "uninstall"
            ? "npm/git 安装内容会由 Pi 移除；本地 path 只移除配置引用，不删除用户目录。"
            : "该操作可能访问网络并加载 Extension 代码。Extension 在 Pi 运行环境中拥有与 Agent 相同的运行权限。"}</p>
          <div className="dialog-actions">
            <Button autoFocus className="secondary-button" onPress={onCancel}>取消</Button>
            <Button
              className={action.kind === "uninstall" ? styles.confirmDanger! : "primary-button"}
              onPress={onConfirm}
            >{action.kind === "install" ? "确认安装" : action.kind === "update" ? "确认更新" : "确认卸载"}</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function packagesForScope(items: ExtensionPackageEntry[], scope: ExtensionPackageScope) {
  if (scope === "global") {
    return items.filter((entry) => entry.scope === "global").map((entry) => ({ entry, inherited: false }));
  }
  const projectSources = new Set(
    items.filter((entry) => entry.scope === "project").map((entry) => entry.source)
  );
  return [
    ...items.filter((entry) => entry.scope === "project").map((entry) => ({ entry, inherited: false })),
    ...items.filter((entry) => entry.scope === "global" && !projectSources.has(entry.source))
      .map((entry) => ({ entry, inherited: true }))
  ];
}
