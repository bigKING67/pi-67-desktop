import {
  parsePackageNetworkSettings,
  type BuiltInGitMirrorId,
  type GitSourceMode,
  type NpmSourceMode,
  type PackageNetworkSettings,
  type PackageNetworkSnapshot,
  type PackageSourceHealth
} from "@pi67/domain";
import { RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input } from "react-aria-components";
import styles from "./PackageNetworkPanel.module.css";
import { messages } from "../localization/message-catalog.js";
import {
  SettingsCheckbox,
  SettingsDetails,
  SettingsInfo,
  SettingsNotice,
  SettingsPageHeader,
  SettingsRow,
  SettingsRows,
  SettingsSaveBar,
  SettingsSectionBlock,
  SettingsSelect,
  SettingsStatus
} from "./SettingsPrimitives.js";
import { SettingsDestructiveActionDialog } from "./SettingsActionDialogs.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";

const SOURCE_ROLE_LABELS: Readonly<Record<PackageSourceHealth["role"], string>> = {
  "public-mirror": "公共镜像",
  official: "官方源",
  custom: "自定义源"
};

const NPM_MODES: Array<{ id: NpmSourceMode; label: string }> = [
  { id: "automatic", label: "自动：公共镜像优先，官方回退" },
  { id: "mirror-only", label: "仅公共镜像" },
  { id: "official-only", label: "仅 npm 官方源" },
  { id: "custom", label: "自定义 HTTPS Registry" },
  { id: "offline", label: "离线" }
];

const GIT_MODES: Array<{ id: GitSourceMode; label: string }> = [
  { id: "automatic", label: "自动：镜像优先，GitHub 回退" },
  { id: "mirror-only", label: "仅公共镜像" },
  { id: "official-only", label: "仅 GitHub 官方" },
  { id: "offline", label: "离线" }
];

export function PackageNetworkPanel() {
  const [snapshot, setSnapshot] = useState<PackageNetworkSnapshot>();
  const [draft, setDraft] = useState<PackageNetworkSettings>();
  const [probeSnapshot, setProbeSnapshot] = useState<PackageNetworkSnapshot>();
  const [phase, setPhase] = useState<"loading" | "saving" | "probing" | "resetting" | "idle">("loading");
  const [error, setError] = useState<string>();
  const [resetOpen, setResetOpen] = useState(false);
  const validDraft = draft ? parsePackageNetworkSettings(draft) : undefined;
  const dirty = Boolean(snapshot && draft && !settingsEqual(snapshot.settings, validDraft ?? draft));
  const probeCompatible = Boolean(validDraft && probeSnapshot && settingsEqual(validDraft, probeSnapshot.settings));
  const probeStale = Boolean(probeSnapshot && !probeCompatible);
  const displayedSnapshot = probeCompatible ? probeSnapshot : snapshot;

  useSettingsDraftRegistration({
    dirty,
    busy: phase !== "idle",
    subject: "下载源与网络",
    discard: () => {
      if (!snapshot) return;
      setDraft(structuredClone(snapshot.settings));
      setProbeSnapshot(undefined);
      setError(undefined);
    }
  });

  const load = async () => {
    setPhase("loading");
    setError(undefined);
    try {
      const next = await window.pi67.system.getPackageNetworkSnapshot();
      setSnapshot(next);
      setDraft(next.settings);
      setProbeSnapshot(undefined);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setPhase("idle");
    }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!validDraft || !dirty) return;
    setPhase("saving");
    setError(undefined);
    try {
      const next = await window.pi67.system.savePackageNetworkSettings(validDraft);
      setSnapshot(next);
      setDraft(next.settings);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setPhase("idle");
    }
  };
  const probe = async () => {
    if (!validDraft) return;
    setPhase("probing");
    setError(undefined);
    try {
      const next = await window.pi67.system.probePackageSources(validDraft);
      setProbeSnapshot(next);
    } catch (probeError) {
      setError(errorMessage(probeError));
    } finally {
      setPhase("idle");
    }
  };
  const reset = async () => {
    setPhase("resetting");
    setError(undefined);
    try {
      const next = await window.pi67.system.resetPackageNetworkSettings();
      setSnapshot(next);
      setDraft(next.settings);
      setProbeSnapshot(undefined);
      setResetOpen(false);
    } catch (resetError) {
      setError(errorMessage(resetError));
    } finally {
      setPhase("idle");
    }
  };
  const busy = phase !== "idle";
  const canSave = Boolean(validDraft && dirty && !busy);

  return (
    <>
    <div className={styles.page}>
      <SettingsPageHeader
        title={messages.settings.sections.network.label}
      />
    <div className={styles.stack}>
      <SettingsSectionBlock
        actions={<Button className={styles.quietButton!} isDisabled={busy} onPress={() => setResetOpen(true)}><RotateCcw aria-hidden="true" size={13} />恢复默认</Button>}
        title="下载源策略"
      >
        {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
        {draft && !validDraft ? <SettingsNotice tone="warning">当前下载源草稿无效。自定义源必须是有效的公开 HTTPS URL，修正后才能保存或检测。</SettingsNotice> : null}
        {draft ? <SettingsRows>
          <SettingsRow
            title={<>npm<SettingsInfo label="镜像与可信身份说明">镜像只改变传输路径；npm integrity、Git commit 与内容哈希仍决定可信身份。</SettingsInfo></>}
            actions={<SettingsSelect label="npm" value={draft.npmMode} options={NPM_MODES} isDisabled={busy}
              onChange={(npmMode) => setDraft({ ...draft, npmMode })} />}
          />
          {draft.npmMode === "custom" ? <SettingsRow title="自定义 Registry" actions={<Input aria-label="自定义 Registry" className={styles.textInput!}
            disabled={busy} placeholder="https://registry.example.com" value={draft.npmCustomRegistry ?? ""}
            onChange={(event) => setDraft({ ...draft, npmCustomRegistry: event.currentTarget.value })} />} /> : null}
          <SettingsRow
            title="Git / GitHub"
            actions={<SettingsSelect label="Git / GitHub" value={draft.gitMode} options={GIT_MODES} isDisabled={busy}
              onChange={(gitMode) => setDraft({ ...draft, gitMode })} />}
          />
          {draft.gitMode === "automatic" || draft.gitMode === "mirror-only" ? <SettingsRow
            title="公共 Git 镜像"
            description="按勾选顺序尝试"
            actions={<div className={styles.mirrors} role="group" aria-label="公共 Git 镜像顺序">
              {(["gitclone", "ghproxy"] as const).map((mirror) => <SettingsCheckbox
                key={mirror}
                isDisabled={busy}
                isSelected={draft.gitMirrors.includes(mirror)}
                onChange={(checked) => setDraft({
                  ...draft,
                  gitMirrors: checked ? [...draft.gitMirrors, mirror] : draft.gitMirrors.filter((item) => item !== mirror)
                })}
              >{mirror === "gitclone" ? "gitclone.com" : "ghproxy.net"}</SettingsCheckbox>)}
            </div>}
          /> : null}
          {draft.gitMode === "automatic" || draft.gitMode === "mirror-only" ? <SettingsRow
            title="自定义 Git 镜像前缀"
            description="可选"
            actions={<Input aria-label="自定义 Git 镜像前缀（可选）" className={styles.textInput!} disabled={busy}
              placeholder="https://mirror.example.com" value={draft.gitCustomMirrorPrefix ?? ""} onChange={(event) => {
                const value = event.currentTarget.value;
                if (value) setDraft({ ...draft, gitCustomMirrorPrefix: value });
                else {
                  const withoutCustomMirror = { ...draft };
                  delete withoutCustomMirror.gitCustomMirrorPrefix;
                  setDraft(withoutCustomMirror);
                }
              }} />}
          /> : null}
        </SettingsRows> : <SettingsNotice>正在读取下载源设置…</SettingsNotice>}
      </SettingsSectionBlock>

      <SettingsSectionBlock
        actions={<>
          {displayedSnapshot?.checkedAt ? <time className={styles.checkedAt}>{new Date(displayedSnapshot.checkedAt).toLocaleString()}</time> : null}
          <Button className="secondary-button" isDisabled={!validDraft || busy} onPress={() => void probe()}><RefreshCw aria-hidden="true" size={14} />{phase === "probing" ? "检测中…" : "检测全部源"}</Button>
        </>}
        info="检测使用公共 ping 或随应用提供的 Git ls-remote，不发送工作区、会话、模型服务或凭据。"
        title="源可达性"
      >
        {probeCompatible && dirty ? <SettingsNotice tone="warning">以下结果基于未保存配置；检测没有写入下载源设置。</SettingsNotice> : null}
        {probeStale ? <SettingsNotice>草稿已在上次检测后修改，当前结果需要重新检测。</SettingsNotice> : null}
        <SettingsRows>
          {displayedSnapshot?.sources.map((source) => <SettingsRow
            key={source.id}
            title={`${source.kind === "npm" ? "npm" : "Git"} · ${SOURCE_ROLE_LABELS[source.role]}`}
            description={source.url}
            value={<SettingsStatus tone={source.status === "reachable" ? "success" : source.status === "unreachable" ? "danger" : "neutral"}>
              {source.status === "reachable" ? `${source.latencyMs ?? 0} ms` : source.status === "unreachable" ? "不可达" : "尚未检查"}
            </SettingsStatus>}
          />)}
        </SettingsRows>
      </SettingsSectionBlock>
      <SettingsDetails title="内置工具链" summary={snapshot ? (snapshot.toolchain.ready ? "已就绪 · Node、npm、Git" : "工具链不可用") : "正在读取…"} requiredOpen={snapshot !== undefined && !snapshot.toolchain.ready}>
        <SettingsRows>
          <SettingsRow title="Node" value={snapshot?.toolchain.nodeVersion ?? "-"} />
          <SettingsRow title="npm" value={snapshot?.toolchain.npmVersion ?? "-"} />
          <SettingsRow title="Git" value={snapshot?.toolchain.gitVersion ?? "-"} />
        </SettingsRows>
        <p>工具随应用提供，不依赖系统安装，也不会修改系统工具链。</p>
      </SettingsDetails>
      <SettingsSaveBar
        canSave={canSave}
        dirty={dirty}
        saving={phase === "saving"}
        onDiscard={() => {
          if (!snapshot) return;
          setDraft(structuredClone(snapshot.settings));
          setProbeSnapshot(undefined);
          setError(undefined);
        }}
        onSave={() => void save()}
      />
    </div>
    </div>
    <SettingsDestructiveActionDialog
      busy={phase === "resetting"}
      confirmLabel="恢复默认下载源"
      description="这会覆盖当前保存的下载源设置，并丢弃本页尚未保存的草稿。"
      error={resetOpen ? error : undefined}
      facts={[
        { label: "npm", value: "自动：公共镜像优先，官方回退" },
        { label: "Git", value: "自动：镜像优先，GitHub 回退" },
        { label: "检测结果", value: "清除" }
      ]}
      open={resetOpen}
      pendingLabel="正在恢复…"
      title="恢复默认下载源？"
      onCancel={() => setResetOpen(false)}
      onConfirm={() => void reset()}
    />
    </>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "下载源操作失败";
}

function settingsEqual(left: PackageNetworkSettings, right: PackageNetworkSettings): boolean {
  return left.npmMode === right.npmMode
    && left.npmCustomRegistry === right.npmCustomRegistry
    && left.gitMode === right.gitMode
    && left.gitCustomMirrorPrefix === right.gitCustomMirrorPrefix
    && mirrorsEqual(left.gitMirrors, right.gitMirrors);
}

function mirrorsEqual(left: readonly BuiltInGitMirrorId[], right: readonly BuiltInGitMirrorId[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
