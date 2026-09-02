import type { ResourceSummary, SkillPackEntry } from "@pi67/domain";
import { ChevronRight, Layers3, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, Modal, ModalOverlay } from "react-aria-components";
import { selectSessionResources } from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { SessionResourcePanel } from "./SessionResourcePanel.js";
import {
  checkSkillPackUpdates,
  installSkillPack,
  loadSkillPacks,
  restoreSkillPack,
  updateSkillPack
} from "./skill-pack-controller.js";
import { useSkillPackStore } from "./skill-pack-store.js";
import {
  SettingsBackAction,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";
import styles from "./SkillSettingsWorkspace.module.css";

export type SkillPackMutationAction = "install" | "update" | "restore";

export function ManagedGlobalSkillPanel({ selectedPackId, excludedSuiteIds, onSelectPack, onBack }: {
  selectedPackId?: string;
  excludedSuiteIds?: ReadonlySet<string>;
  onSelectPack: (id: string) => void;
  onBack: () => void;
}) {
  const settingsWorkspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId);
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const workspaceId = settingsWorkspaceId ?? currentWorkspaceId;
  const resources = useSessionProjectionStore(selectSessionResources) ?? [];
  const { items, phase, error, checkedAt, workspaceId: loadedWorkspaceId } = useSkillPackStore();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<{ action: SkillPackMutationAction; pack: SkillPackEntry }>();
  const allManagedPacks = useMemo(
    () => items.filter((entry) => entry.updateOwner === "managed-pack" && entry.installed),
    [items]
  );
  const managedPacks = useMemo(
    () => allManagedPacks.filter((entry) => !excludedSuiteIds?.has(entry.suiteId)),
    [allManagedPacks, excludedSuiteIds]
  );
  const selectedPack = managedPacks.find((entry) => entry.id === selectedPackId);
  const managedSkillIds = useMemo(
    () => new Set(allManagedPacks.flatMap((entry) => entry.skillIds)),
    [allManagedPacks]
  );
  const busy = phase === "loading"
    || phase === "checking"
    || phase === "installing"
    || phase === "updating"
    || phase === "restoring";
  const updateCount = managedPacks.filter(skillPackNeedsAction).length;

  useEffect(() => {
    if (!workspaceId) useSkillPackStore.getState().reset();
    else if (loadedWorkspaceId !== workspaceId) void loadSkillPacks(workspaceId);
  }, [loadedWorkspaceId, workspaceId]);

  if (selectedPack) {
    return (
      <>
        <ManagedSkillPackDetail
          busy={busy}
          pack={selectedPack}
          query={query}
          resources={resources}
          onBack={() => {
            setQuery("");
            onBack();
          }}
          onQueryChange={setQuery}
          onRestore={(pack) => setPending({ action: "restore", pack })}
          onInstall={(pack) => setPending({ action: "install", pack })}
          onUpdate={(pack) => setPending({ action: "update", pack })}
        />
        {pending ? (
          <SkillPackMutationDialog
            action={pending.action}
            busy={phase === "installing" || phase === "updating" || phase === "restoring"}
            error={phase === "failed" ? error : undefined}
            pack={pending.pack}
            onCancel={() => setPending(undefined)}
            onConfirm={async () => {
              const completed = pending.action === "install"
                ? await installSkillPack(pending.pack.id, workspaceId)
                : pending.action === "update"
                  ? await updateSkillPack(pending.pack.id, workspaceId)
                  : await restoreSkillPack(pending.pack.id, workspaceId);
              if (completed) setPending(undefined);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.managedGlobalSkills}>
      {managedPacks.length > 0 ? <SettingsSectionBlock
        actions={<span className={styles.detailActions}>
          {checkedAt === undefined ? null : <SkillPackCheckedAt checkedAt={checkedAt} />}
          <Button
            className="secondary-button"
            isDisabled={!workspaceId || busy}
            onPress={() => void checkSkillPackUpdates(workspaceId)}
          >
            <RefreshCw
              aria-hidden="true"
              className={phase === "checking" ? styles.spinning : undefined}
              size={14}
            />
            {phase === "checking" ? "检查中…" : updateCount > 0 ? `待处理 ${updateCount}` : "检查技能更新"}
          </Button>
        </span>}
        title="受管技能套件"
        description="由可信更新器维护并对所有项目可用；一个套件只检查和更新一次。"
      >
        {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
        <div aria-label="受管技能套件" className={styles.packCatalog} role="list">
          {managedPacks.map((pack) => (
            <ManagedSkillPackRow
              busy={busy}
              key={pack.id}
              pack={pack}
              onSelect={() => {
                setQuery("");
                onSelectPack(pack.id);
              }}
              onUpdate={() => setPending({ action: "update", pack })}
              onInstall={() => setPending({ action: "install", pack })}
            />
          ))}
        </div>
        <SettingsNotice className={styles.scopeNotice!}>
          扩展包携带的技能仍由“扩展包”管理；这里只更新明确记录了上游、兼容合同和更新器的全局套件。
        </SettingsNotice>
      </SettingsSectionBlock> : null}

      <SessionResourcePanel
        description="由用户在本机维护并适用于所有项目；没有受管上游的技能不会被 Desktop 自动覆盖。"
        empty={managedPacks.length > 0
          ? "其他全局技能均已归入受管技能套件。"
          : "尚未发现全局技能。可以将技能放入 ~/.agents/skills 或 ~/.pi/agent/skills。"}
        excludeIds={managedSkillIds}
        kind="skill"
        origin="top-level"
        resourceScope="user"
        scope="global"
        title="本地全局技能"
      />

      {pending ? (
        <SkillPackMutationDialog
          action={pending.action}
          busy={phase === "installing" || phase === "updating" || phase === "restoring"}
          error={phase === "failed" ? error : undefined}
          pack={pending.pack}
          onCancel={() => setPending(undefined)}
          onConfirm={async () => {
            const completed = pending.action === "install"
              ? await installSkillPack(pending.pack.id, workspaceId)
              : pending.action === "update"
                ? await updateSkillPack(pending.pack.id, workspaceId)
                : await restoreSkillPack(pending.pack.id, workspaceId);
            if (completed) setPending(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function ManagedSkillPackRow({ pack, busy, onSelect, onInstall, onUpdate }: {
  pack: SkillPackEntry;
  busy: boolean;
  onSelect: () => void;
  onInstall: () => void;
  onUpdate: () => void;
}) {
  const status = skillPackStatus(pack);
  return (
    <div className={styles.packRow} data-update={skillPackNeedsAction(pack) || undefined} role="listitem">
      <button className={styles.packIdentity} data-testid="managed-skill-pack-row" onClick={onSelect} type="button">
        <span className={styles.suiteIcon} data-status={status.tone}>
          <Layers3 aria-hidden="true" size={16} />
        </span>
        <span className={styles.packCopy}>
          <strong>{pack.displayName}</strong>
          <small>{pack.description}</small>
          <span>{skillPackMeta(pack)}</span>
        </span>
        <span className={styles.packStatus} data-status={status.tone}>{status.label}</span>
        <ChevronRight aria-hidden="true" size={15} />
      </button>
      {pack.updateStatus === "update-available" && pack.canUpdate ? (
        <Button
          className={styles.packUpdateButton!}
          data-testid="managed-skill-pack-update"
          isDisabled={busy}
          onPress={onUpdate}
        >
          更新
        </Button>
      ) : pack.updateStatus === "sync-pending" && pack.canInstall ? (
        <Button
          className={styles.packUpdateButton!}
          data-testid="managed-skill-pack-sync"
          isDisabled={busy}
          onPress={onInstall}
        >
          同步 Skills
        </Button>
      ) : null}
    </div>
  );
}

function ManagedSkillPackDetail({ pack, query, resources, busy, onBack, onQueryChange, onInstall, onRestore, onUpdate }: {
  pack: SkillPackEntry;
  query: string;
  resources: ResourceSummary[];
  busy: boolean;
  onBack: () => void;
  onQueryChange: (query: string) => void;
  onInstall: (pack: SkillPackEntry) => void;
  onRestore: (pack: SkillPackEntry) => void;
  onUpdate: (pack: SkillPackEntry) => void;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const resourceById = useMemo(() => new Map(resources
    .filter((resource) => resource.kind === "skill")
    .map((resource) => [resource.id, resource])), [resources]);
  const skills = useMemo(() => pack.skillIds.filter((skillId) => (
    !normalizedQuery || skillId.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
  )), [normalizedQuery, pack.skillIds]);
  const status = skillPackStatus(pack);
  return (
    <div className={styles.suiteDetail!} data-testid="managed-skill-pack-detail">
      <SettingsBackAction label="返回全局可用技能" onPress={onBack}>返回全局可用</SettingsBackAction>
      <SettingsSectionBlock
        actions={<span className={styles.detailActions}>
          <span className={styles.detailStatus} data-status={status.tone}>{status.label}</span>
          {pack.updateStatus === "update-available" && pack.canUpdate ? (
            <Button className="primary-button" isDisabled={busy} onPress={() => onUpdate(pack)}>更新套件</Button>
          ) : null}
          {pack.updateStatus === "sync-pending" && pack.canInstall ? (
            <Button className="primary-button" isDisabled={busy} onPress={() => onInstall(pack)}>同步官方 Skills</Button>
          ) : null}
          {pack.canRestore ? (
            <Button className="secondary-button" isDisabled={busy} onPress={() => onRestore(pack)}>恢复内置版本</Button>
          ) : null}
        </span>}
        title={pack.displayName}
        description={skillPackMeta(pack)}
      >
        <label className={styles.skillSearch!}>
          <Search aria-hidden="true" size={15} />
          <input
            aria-label={`搜索 ${pack.displayName} 技能`}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="搜索技能名称"
            type="search"
            value={query}
          />
        </label>
        {pack.detail ? (
          <SettingsNotice tone={[
            "modified",
            "sync-pending",
            "unavailable"
          ].includes(pack.updateStatus) ? "warning" : "info"}>
            {pack.detail}
          </SettingsNotice>
        ) : null}
        {skills.length > 0 ? <SettingsRows className={styles.skillRows!}>{skills.map((skillId) => {
          const resource = resourceById.get(skillId);
          return (
            <SettingsRow
              key={skillId}
              description={resource?.path ? "当前由全局受管套件提供" : "套件成员尚未被当前 Pi 资源投影解析"}
              title={resource?.label ?? skillId}
              value={resource ? "已加载" : "未加载"}
            >
              {resource?.path ? <code className={styles.skillPath} title={resource.path}>{resource.path}</code> : null}
            </SettingsRow>
          );
        })}</SettingsRows> : (
          <SettingsNotice className={styles.emptyResult!}>没有匹配的技能。</SettingsNotice>
        )}
        <SettingsNotice className={styles.scopeNotice!}>
          该套件对所有项目可用。更新以整个套件为单位，并在完成后重新加载 Pi 资源。
        </SettingsNotice>
      </SettingsSectionBlock>
    </div>
  );
}

export function SkillPackMutationDialog({ action, pack, busy, error, onCancel, onConfirm }: {
  action: SkillPackMutationAction;
  pack: SkillPackEntry;
  busy: boolean;
  error: string | undefined;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const syncingLarkSkills = action === "install" && pack.updateStatus === "sync-pending";
  return (
    <ModalOverlay className="modal-overlay" isDismissable={!busy} isOpen onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Modal className={`modal-surface ${styles.modal}`}>
        <Dialog
          aria-label={syncingLarkSkills ? "同步 Lark CLI 官方 Skills" : action === "install" ? "安装 Lark CLI" : action === "update" ? "更新技能套件" : "恢复内置技能套件"}
          className={styles.dialog!}
        >
          <h2>{syncingLarkSkills ? "同步官方 Skills？" : action === "install" ? "安装 Lark CLI？" : action === "update" ? "更新技能套件？" : "恢复内置版本？"}</h2>
          <p>{syncingLarkSkills
            ? <>当前 Lark CLI 已完成更新和验证。Desktop 只会重试把官方办公 Skills 同步到 <code>~/.agents/skills</code>，不会重新下载或回退 CLI，也不会覆盖非受管同名 Skill。</>
            : action === "install"
            ? <>Desktop 将验证并启用官方 @larksuite/cli，把办公 Skills 安装到 <code>~/.agents/skills</code>。这是当前用户全局安装，Pi TUI、Desktop 与其他兼容 Agent 都可复用；已有非受管同名 Skill 不会被覆盖。</>
            : action === "update"
              ? pack.manager === "lark-cli"
                ? "Desktop 将通过“下载源与网络”中可用的 npm 源下载并验证上方目标版本，拒绝降级后再原子更新当前用户共享副本与受管官方 Skills。重装 Desktop 以及现有 Scoop、npm 或其他外部安装都不会修改这份用户级副本。完成后会重新加载所有 Workspace 中的 Pi 资源。"
                : "更新会原子替换已验证归属于该套件的当前用户全局组件，并在完成后重新加载所有 Workspace 中的 Pi 资源。"
              : "恢复会移除受管 Overlay，重新启用随 Desktop 发布的不可变内置基线，并重新加载所有 Workspace 中的 Pi 资源。"}</p>
          <dl className={styles.updateSummary}>
            <div><dt>套件</dt><dd>{pack.displayName}</dd></div>
            <div><dt>来源</dt><dd>{pack.source ?? "受管来源"}</dd></div>
            <div><dt>当前版本</dt><dd>{action === "install" && !syncingLarkSkills ? "未安装" : pack.installedVersion ?? "未知"}</dd></div>
            <div><dt>目标版本</dt><dd>{syncingLarkSkills
              ? "当前 CLI 对应官方 Skills"
              : action === "install"
                ? "官方最新稳定版"
              : action === "update"
                ? pack.latestVersion ?? "最新稳定版"
                : pack.baselineVersion ?? "内置基线"}</dd></div>
            <div><dt>影响技能</dt><dd>{pack.skillIds.length} 个</dd></div>
            <div><dt>作用域</dt><dd>当前用户全局</dd></div>
            <div><dt>本地状态</dt><dd>{pack.localState === "clean" ? "未发现修改" : "需要检查"}</dd></div>
          </dl>
          {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
          <div className={styles.dialogActions}>
            <Button className="secondary-button" isDisabled={busy} onPress={onCancel}>取消</Button>
            <Button
              className="primary-button"
              isDisabled={busy || (action === "install" ? !pack.canInstall : action === "update" ? !pack.canUpdate : !pack.canRestore)}
              onPress={() => void onConfirm()}
            >
              {busy
                ? syncingLarkSkills ? "同步中…" : action === "install" ? "安装中…" : action === "update" ? "更新中…" : "恢复中…"
                : syncingLarkSkills ? "确认同步" : action === "install" ? "确认安装" : action === "update" ? "确认更新" : "确认恢复"}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function skillPackStatus(pack: SkillPackEntry): {
  tone: "ready" | "partial" | "unavailable";
  label: string;
} {
  if (pack.updateStatus === "not-installed") return { tone: "unavailable", label: "CLI 未安装" };
  if (pack.updateStatus === "sync-pending") return { tone: "partial", label: "CLI 已更新，Skills 待同步" };
  if (pack.updateStatus === "current") return { tone: "ready", label: "已是最新" };
  if (pack.updateStatus === "update-available") {
    return { tone: "partial", label: pack.canUpdate ? "可更新" : pack.canInstall ? "需完成安装" : "暂不可更新" };
  }
  if (pack.updateStatus === "modified") return { tone: "unavailable", label: "有本地修改" };
  if (pack.updateStatus === "unavailable") return { tone: "unavailable", label: "检查失败" };
  if (pack.updateStatus === "application-managed") return { tone: "ready", label: "随应用更新" };
  return { tone: "partial", label: "尚未检查" };
}

function skillPackNeedsAction(pack: SkillPackEntry): boolean {
  return pack.updateStatus === "update-available" || pack.updateStatus === "sync-pending";
}

function skillPackMeta(pack: SkillPackEntry): string {
  const installed = pack.managerStatus === "missing"
    ? "CLI 未安装"
    : pack.installedVersion
      ? `已安装 ${pack.installedVersion}`
      : `${pack.installedSkillCount} 个已安装`;
  const latest = pack.latestVersion && pack.latestVersion !== pack.installedVersion
    ? `最新 ${pack.latestVersion}`
    : undefined;
  return [
    `${pack.skillIds.length} 个技能`,
    installed,
    latest,
    pack.manager === "lark-cli"
      ? "由 Lark CLI 管理"
      : pack.effectiveSource === "managed"
        ? "旧版受管 Overlay"
        : "Desktop 内置基线"
  ].filter(Boolean).join(" · ");
}

function SkillPackCheckedAt({ checkedAt }: { checkedAt: number }) {
  const date = new Date(checkedAt);
  return (
    <time className={styles.checkedAt!} dateTime={date.toISOString()} title={date.toLocaleString()}>
      上次检查 {date.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
    </time>
  );
}
