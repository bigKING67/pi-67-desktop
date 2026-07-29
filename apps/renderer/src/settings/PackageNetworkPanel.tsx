import type {
  GitSourceMode,
  NpmSourceMode,
  PackageNetworkSettings,
  PackageNetworkSnapshot
} from "@pi67/domain";
import { RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import styles from "./PackageNetworkPanel.module.css";
import {
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock
} from "./SettingsPrimitives.js";

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
  const [phase, setPhase] = useState<"loading" | "saving" | "probing" | "idle">("loading");
  const [error, setError] = useState<string>();

  const load = async () => {
    setPhase("loading");
    setError(undefined);
    try {
      const next = await window.pi67.system.getPackageNetworkSnapshot();
      setSnapshot(next);
      setDraft(next.settings);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setPhase("idle");
    }
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    if (!draft) return;
    setPhase("saving");
    setError(undefined);
    try {
      const next = await window.pi67.system.savePackageNetworkSettings(draft);
      setSnapshot(next);
      setDraft(next.settings);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setPhase("idle");
    }
  };
  const probe = async () => {
    if (draft) {
      const saved = await window.pi67.system.savePackageNetworkSettings(draft).catch((saveError: unknown) => {
        setError(errorMessage(saveError));
        return undefined;
      });
      if (!saved) return;
    }
    setPhase("probing");
    setError(undefined);
    try {
      const next = await window.pi67.system.probePackageSources();
      setSnapshot(next);
      setDraft(next.settings);
    } catch (probeError) {
      setError(errorMessage(probeError));
    } finally {
      setPhase("idle");
    }
  };
  const reset = async () => {
    setPhase("saving");
    setError(undefined);
    try {
      const next = await window.pi67.system.resetPackageNetworkSettings();
      setSnapshot(next);
      setDraft(next.settings);
    } catch (resetError) {
      setError(errorMessage(resetError));
    } finally {
      setPhase("idle");
    }
  };
  const busy = phase !== "idle";

  return (
    <div className={styles.stack}>
      <SettingsSectionBlock
        actions={<span className={styles.readiness} data-ready={snapshot?.toolchain.ready ?? false}>
            {snapshot?.toolchain.ready ? "就绪" : "不可用"}
          </span>}
        title="私有工具链"
        description="Node、npm 与 Git 随 Desktop 提供，不依赖系统安装，也不会修改系统工具链。"
      >
        <SettingsRows>
          <SettingsRow title="Node" value={snapshot?.toolchain.nodeVersion ?? "-"} />
          <SettingsRow title="npm" value={snapshot?.toolchain.npmVersion ?? "-"} />
          <SettingsRow title="Git" value={snapshot?.toolchain.gitVersion ?? "-"} />
        </SettingsRows>
      </SettingsSectionBlock>

      <SettingsSectionBlock
        actions={<>
          <Button className="primary-button" isDisabled={!draft || busy} onPress={() => void save()}><Save aria-hidden="true" size={14} />{phase === "saving" ? "保存中…" : "保存"}</Button>
          <Button className="secondary-button" isDisabled={!draft || busy} onPress={() => void probe()}><RefreshCw aria-hidden="true" size={14} />{phase === "probing" ? "检测中…" : "检测全部源"}</Button>
        </>}
        title="下载源策略"
        description="镜像只改变传输路径；npm integrity、Git commit 与内容哈希仍决定可信身份。"
      >
        {error ? <SettingsNotice tone="danger" actions={<Button className="secondary-button" onPress={() => void reset()}>恢复默认下载源</Button>}>{error}</SettingsNotice> : null}
        {draft ? <div className={styles.form}>
          <label><span>npm</span><select disabled={busy} value={draft.npmMode} onChange={(event) => setDraft({ ...draft, npmMode: event.currentTarget.value as NpmSourceMode })}>
            {NPM_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
          </select></label>
          {draft.npmMode === "custom" ? <label><span>自定义 Registry</span><input disabled={busy} placeholder="https://registry.example.com" value={draft.npmCustomRegistry ?? ""} onChange={(event) => setDraft({ ...draft, npmCustomRegistry: event.currentTarget.value })} /></label> : null}
          <label><span>Git / GitHub</span><select disabled={busy} value={draft.gitMode} onChange={(event) => setDraft({ ...draft, gitMode: event.currentTarget.value as GitSourceMode })}>
            {GIT_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
          </select></label>
          {draft.gitMode === "automatic" || draft.gitMode === "mirror-only" ? <fieldset>
            <legend>公共 Git 镜像顺序</legend>
            {(["gitclone", "ghproxy"] as const).map((mirror) => <label className={styles.checkbox} key={mirror}>
              <input checked={draft.gitMirrors.includes(mirror)} disabled={busy} type="checkbox" onChange={(event) => setDraft({
                ...draft,
                gitMirrors: event.currentTarget.checked
                  ? [...draft.gitMirrors, mirror]
                  : draft.gitMirrors.filter((item) => item !== mirror)
              })} />
              <span>{mirror === "gitclone" ? "gitclone.com" : "ghproxy.net"}</span>
            </label>)}
          </fieldset> : null}
          {draft.gitMode === "automatic" || draft.gitMode === "mirror-only" ? <label><span>自定义 Git 镜像前缀（可选）</span><input disabled={busy} placeholder="https://mirror.example.com" value={draft.gitCustomMirrorPrefix ?? ""} onChange={(event) => {
            const value = event.currentTarget.value;
            if (value) setDraft({ ...draft, gitCustomMirrorPrefix: value });
            else {
              const withoutCustomMirror = { ...draft };
              delete withoutCustomMirror.gitCustomMirrorPrefix;
              setDraft(withoutCustomMirror);
            }
          }} /></label> : null}
        </div> : <SettingsNotice>正在读取下载源设置…</SettingsNotice>}
      </SettingsSectionBlock>

      <SettingsSectionBlock
        actions={snapshot?.checkedAt ? <time className={styles.checkedAt}>{new Date(snapshot.checkedAt).toLocaleString()}</time> : undefined}
        title="源可达性"
        description="检测使用公共 ping 或 bundled Git ls-remote，不发送工作区、会话、模型服务或凭据。"
      >
        <SettingsRows>
          {snapshot?.sources.map((source) => <SettingsRow
            key={source.id}
            leading={<span className={styles.sourceStatus} data-status={source.status} />}
            title={`${source.kind === "npm" ? "npm" : "Git"} · ${source.role}`}
            description={source.url}
            value={source.status === "reachable" ? `${source.latencyMs ?? 0} ms` : source.status === "unreachable" ? "不可达" : "尚未检查"}
          />)}
        </SettingsRows>
      </SettingsSectionBlock>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "下载源操作失败";
}
