import type {
  ExtensionPackageEntry,
  ExtensionPackageScope,
  PackageResourceType
} from "@pi67/domain";
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
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";

type ConfirmedAction =
  | { kind: "install"; source: string; scope: ExtensionPackageScope }
  | { kind: "update"; entry: ExtensionPackageEntry }
  | { kind: "uninstall"; entry: ExtensionPackageEntry };

export function ExtensionPackageManager({ resourceType = "extension" }: {
  resourceType?: Exclude<PackageResourceType, "theme">;
}) {
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
  const displayed = useMemo(() => (
    packagesForScope(items, scope)
      .filter(({ entry }) => packageSupportsResource(entry, resourceType))
      .sort((left, right) => Number(isBundled(right.entry)) - Number(isBundled(left.entry)))
  ), [items, resourceType, scope]);
  const busy = phase === "loading" || phase === "checking" || phase === "mutating";
  const copy = resourceCopy(resourceType);

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
      <SettingsSectionBlock
        actions={<Button
            className="secondary-button"
            isDisabled={!workspaceId || busy}
            onPress={() => void checkExtensionPackageUpdates(workspaceId)}
          >
            <RefreshCw aria-hidden="true" size={14} />检查更新
          </Button>}
        title={`已配置的 ${copy.plural}`}
        description="内置与外部来源分开标记；启停只修改当前资源类型，不会扁平化 Pi Package 过滤器。"
      >

        <SettingsRows>
          <SettingsRow
            title={`安装 ${copy.singular} 包`}
            description="支持 npm package、Git URL 或本地绝对路径。"
            actions={<Button
              className="primary-button"
              isDisabled={!workspaceId || busy || source.trim().length === 0}
              onPress={() => setPending({ kind: "install", source: source.trim(), scope })}
            >
              <PackagePlus aria-hidden="true" size={14} />安装到{scope === "global" ? "全局" : "项目"}
            </Button>}
          >
            <input
              aria-label={`安装 ${copy.singular} 来源`}
              className={styles.sourceInput}
              disabled={!workspaceId || busy}
              maxLength={4_096}
              onChange={(event) => setSource(event.currentTarget.value)}
              placeholder="npm:@scope/package、https://…git 或 /absolute/path"
              value={source}
            />
          </SettingsRow>
        </SettingsRows>

        {phase === "loading" ? <SettingsNotice>正在读取 Pi {copy.plural} 配置…</SettingsNotice> : null}
        {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
        {!workspace ? <SettingsNotice>添加或选择 Workspace 后可管理 {copy.plural}。</SettingsNotice> : null}
        {workspace && phase !== "loading" && displayed.length === 0 ? (
          <SettingsNotice>当前作用域还没有配置 {copy.plural}。</SettingsNotice>
        ) : null}

        {displayed.length > 0 ? <SettingsRows>
          {displayed.map(({ entry, inherited }) => {
            const update = updates.find((candidate) => (
              candidate.source === entry.source && candidate.scope === entry.scope
            ));
            const mutationScope = inherited ? "project" : entry.scope;
            const enabled = packageResourceEnabled(entry, resourceType);
            const bundled = entry.sourceKind === "bundled" || entry.origin === "first-party";
            return (
              <SettingsRow
                className={styles.packageRow!}
                key={`${entry.scope}:${entry.source}:${inherited}`}
                leading={<span className={styles.status} data-enabled={enabled} />}
                title={packageDisplayName(entry)}
                description={<>
                    {bundled ? "内置" : "外部"}
                    {entry.sourceKind ? ` · ${sourceKindLabel(entry.sourceKind)}` : ""}
                    {" · "}
                    {inherited ? "继承自全局" : entry.scope === "global" ? "全局" : "当前项目"}
                    {entry.filtered ? " · 已设置资源过滤" : ""}
                    {!entry.installed ? " · 安装内容缺失" : ""}
                  </>}
                actions={<>
                  {update && !bundled ? (
                    <Button
                      aria-label={`更新 ${entry.source}`}
                      className={styles.packageAction!}
                      isDisabled={busy}
                      onPress={() => setPending({ kind: "update", entry })}
                    ><Download aria-hidden="true" size={13} />更新</Button>
                  ) : null}
                  <Button
                    aria-label={`${enabled ? "停用" : "启用"} ${packageDisplayName(entry)}${resourceType === "extension" ? "" : ` ${copy.singular}`}`}
                    className={styles.packageAction!}
                    isDisabled={busy}
                    onPress={() => void setExtensionPackageEnabled(
                      entry.source,
                      mutationScope,
                      !enabled,
                      workspaceId,
                      resourceType
                    )}
                  ><Power aria-hidden="true" size={13} />{enabled ? "停用" : "启用"}</Button>
                  {!inherited && entry.scope === "project" ? (
                    <Button
                      aria-label={`恢复继承 ${entry.source}`}
                      className={styles.packageAction!}
                      isDisabled={busy}
                      onPress={() => void restoreExtensionPackageInheritance(entry.source, workspaceId)}
                    ><RotateCcw aria-hidden="true" size={13} />恢复继承</Button>
                  ) : null}
                  {!bundled && !inherited && entry.scope === scope ? (
                    <Button
                      aria-label={`卸载 ${entry.source}`}
                      className={`${styles.packageAction} ${styles.dangerButton}`}
                      isDisabled={busy}
                      onPress={() => setPending({ kind: "uninstall", entry })}
                    ><Trash2 aria-hidden="true" size={13} />卸载</Button>
                  ) : null}
                </>}
              />
            );
          })}
        </SettingsRows> : null}
      </SettingsSectionBlock>
      {pending ? (
        <PackageActionDialog
          action={pending}
          resourceLabel={copy.singular}
          onCancel={() => setPending(undefined)}
          onConfirm={() => void confirm()}
        />
      ) : null}
    </>
  );
}

function PackageActionDialog({ action, resourceLabel, onCancel, onConfirm }: {
  action: ConfirmedAction;
  resourceLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const source = action.kind === "install" ? action.source : action.entry.source;
  const scope = action.kind === "install" ? action.scope : action.entry.scope;
  const title = action.kind === "install"
    ? `安装 ${resourceLabel} 包？`
    : action.kind === "update" ? `更新 ${resourceLabel} 包？` : `卸载 ${resourceLabel} 包？`;
  return (
    <ModalOverlay className="modal-overlay" isDismissable isOpen onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog aria-label={title} className={styles.dialog!}>
          <span className="dialog-eyebrow">Pi {resourceLabel} 管理</span>
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

function packageSupportsResource(entry: ExtensionPackageEntry, resourceType: PackageResourceType): boolean {
  if (!entry.resourceTypes) return resourceType === "extension";
  return entry.resourceTypes.includes(resourceType);
}

function packageResourceEnabled(entry: ExtensionPackageEntry, resourceType: PackageResourceType): boolean {
  return entry.resourceStates?.find((state) => state.type === resourceType)?.enabled
    ?? (resourceType === "extension" ? entry.enabled : true);
}

function isBundled(entry: ExtensionPackageEntry): boolean {
  return entry.sourceKind === "bundled" || entry.origin === "first-party";
}

function packageDisplayName(entry: ExtensionPackageEntry): string {
  if (!isBundled(entry)) return entry.source;
  const normalized = entry.source.replaceAll("\\", "/").replace(/\/+$/u, "");
  return `Pi-67 内置 · ${normalized.split("/").at(-1) ?? "capability"}`;
}

function sourceKindLabel(kind: NonNullable<ExtensionPackageEntry["sourceKind"]>): string {
  if (kind === "bundled") return "随应用提供";
  if (kind === "npm") return "npm";
  if (kind === "git") return "Git";
  return "本地 path";
}

function resourceCopy(resourceType: Exclude<PackageResourceType, "theme">) {
  if (resourceType === "skill") return { singular: "Skill", plural: "Skills" };
  if (resourceType === "prompt") return { singular: "Prompt", plural: "Prompts" };
  return { singular: "Extension", plural: "Extensions" };
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
