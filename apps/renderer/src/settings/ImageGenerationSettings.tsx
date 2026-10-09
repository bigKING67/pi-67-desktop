import { imageSourceProviderId } from "@pi67/domain";
import type { PiImageGenerationSourceView } from "@pi67/protocol";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { ProviderBrandIcon } from "../provider-brand/ProviderBrandIcon.js";
import {
  draftFromSource,
  IMAGE_API_LABELS,
  newSourceDraft,
  nextSources,
  sourceIdFor,
  toSource,
  withoutSource,
  type ImageSourceDraft
} from "./image-generation-source-draft.js";
import styles from "./ImageGenerationSettings.module.css";
import { ImageGenerationSourceEditor } from "./ImageGenerationSourceEditor.js";
import {
  loadProviderConfiguration,
  reloadProviderConfiguration,
  removePersistentCredential,
  setImageGenerationSources,
  storePersistentCredential,
  GLOBAL_PROVIDER_CONFIGURATION_KEY
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import { ProviderConfigurationEmpty, ProviderConfigurationStatusBar } from "./ProviderConfigurationStatus.js";
import { SettingsDestructiveActionDialog } from "./SettingsActionDialogs.js";
import {
  SettingsEmpty,
  SettingsIconAction,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock,
  SettingsStatus
} from "./SettingsPrimitives.js";

type Editing = { source?: PiImageGenerationSourceView; draft: ImageSourceDraft } | undefined;

/** Settings → 图像生成: where the image workbench generates images (ADR 0010 decision 14). Global only. */
export function ImageGenerationSettings() {
  const snapshot = useProviderConfigurationStore((state) => state.snapshot);
  const phase = useProviderConfigurationStore((state) => state.phase);
  const error = useProviderConfigurationStore((state) => state.error);
  const storeKey = useProviderConfigurationStore((state) => state.workspaceId);
  const [editing, setEditing] = useState<Editing>();
  const [removing, setRemoving] = useState<PiImageGenerationSourceView>();
  const [saving, setSaving] = useState(false);

  useEffect(() => { void loadProviderConfiguration(); }, []);

  if (phase === "loading" && (!snapshot || storeKey !== GLOBAL_PROVIDER_CONFIGURATION_KEY)) {
    return <ProviderConfigurationEmpty title="正在读取图像来源" detail="从 Pi Provider 与 settings.json 建立安全投影。" />;
  }
  if (!snapshot || storeKey !== GLOBAL_PROVIDER_CONFIGURATION_KEY) {
    return <ProviderConfigurationEmpty title="图像来源尚不可用" detail={error ?? "请确认 Agent Host 已连接，然后重新加载。"}
      action={<Button className="secondary-button" onPress={() => void loadProviderConfiguration()}>重试</Button>} />;
  }
  const sources = snapshot.imageGeneration.sources;

  const save = async (draft: ImageSourceDraft) => {
    setSaving(true);
    try {
      const id = sourceIdFor(draft, new Set(sources.map((source) => source.id)));
      const saved = await setImageGenerationSources(nextSources(sources, toSource(draft, id)), draft.existingId ? "图像来源已更新" : "图像来源已添加");
      // The source's Pi Provider exists only once the source is saved, so its key follows.
      const keyStored = !saved || draft.mode === "reuse" || !draft.apiKey.trim() || await storePersistentCredential(GLOBAL_PROVIDER_CONFIGURATION_KEY, imageSourceProviderId(id), draft.apiKey.trim());
      if (saved && keyStored) setEditing(undefined);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (source: PiImageGenerationSourceView) => {
    setSaving(true);
    try {
      if (!await setImageGenerationSources(withoutSource(sources, source.id), "图像来源已移除")) return;
      if (source.credential === "stored") await removePersistentCredential(GLOBAL_PROVIDER_CONFIGURATION_KEY, source.piProvider);
      setRemoving(undefined);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return <ImageGenerationSourceEditor initial={editing.draft} saving={saving} snapshot={snapshot} {...(editing.source ? { source: editing.source } : {})}
      onClose={() => setEditing(undefined)} onSave={(draft) => void save(draft)} />;
  }

  const add = <Button className="secondary-button" isDisabled={saving} onPress={() => setEditing({ draft: newSourceDraft(snapshot) })}>
    <Plus aria-hidden="true" size={13} />添加来源
  </Button>;
  return (
    <div className={styles.settings} data-testid="image-generation-settings">
      <SettingsSectionBlock
        title="图像来源"
        info="编辑文字、排版、撤销和导出不需要图像来源；只有生成或修改图片内容时才会调用这里的模型，每次调用都会先征得同意。"
        actions={<>
          <ProviderConfigurationStatusBar inline busy={phase === "saving"} snapshot={snapshot} onReload={() => void reloadProviderConfiguration()} />
          {sources.length ? add : null}
        </>}
      >
        {sources.length === 0 ? (
          <SettingsEmpty>
            <span className={styles.emptyText}>还没有图像来源。添加一个后，Agent 才能在图像工作台里生成图片。</span>
            {add}
          </SettingsEmpty>
        ) : (
          <SettingsRows>
            {sources.map((source) => (
              <SettingsRow
                key={source.id}
                title={<>
                  <ProviderBrandIcon hints={[...source.models, source.provider, source.endpoint]} label={source.name} size="inline" />
                  <span>{source.name}</span>
                </>}
                description={[IMAGE_API_LABELS[source.api], source.provider ? `沿用 ${source.provider}` : hostOf(source.endpoint), `${source.models.length} 个模型`].filter(Boolean).join(" · ")}
                value={<SourceStatus source={source} />}
                actions={<>
                  <SettingsIconAction icon={<Pencil aria-hidden="true" size={14} />} isDisabled={saving} label={`编辑 ${source.name}`}
                    onPress={() => setEditing({ source, draft: draftFromSource(source) })} />
                  <SettingsIconAction icon={<Trash2 aria-hidden="true" size={14} />} isDisabled={saving} label={`移除 ${source.name}`} onPress={() => setRemoving(source)} />
                </>}
              />
            ))}
          </SettingsRows>
        )}
      </SettingsSectionBlock>
      {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
      <SettingsDestructiveActionDialog
        busy={saving}
        confirmLabel="移除来源"
        description={removing?.credential === "stored"
          ? <>移除后 Agent 不能再用它生成图片；它单独保存的 API Key 会从 Pi 的 <code>auth.json</code> 删除。已生成的图片不受影响。</>
          : <>移除后 Agent 不能再用它生成图片；沿用的模型服务和它的 API Key 保持不变。已生成的图片不受影响。</>}
        facts={removing ? [{ label: "图像来源", value: removing.name }, { label: "模型", value: `${removing.models.length} 个` }] : []}
        open={removing !== undefined}
        pendingLabel="正在移除…"
        title="移除图像来源？"
        onCancel={() => setRemoving(undefined)}
        onConfirm={() => { if (removing) void remove(removing); }}
      />
    </div>
  );
}

function SourceStatus({ source }: { source: PiImageGenerationSourceView }) {
  if (!source.endpoint) return <SettingsStatus tone="warning">缺少地址</SettingsStatus>;
  if (source.credential === "missing") return <SettingsStatus tone="warning">{source.provider ? "模型服务缺少 API Key" : "缺少 API Key"}</SettingsStatus>;
  return <SettingsStatus tone="success">可用</SettingsStatus>;
}

function hostOf(endpoint: string | undefined): string {
  try { return endpoint ? new URL(endpoint).host : ""; } catch { return endpoint ?? ""; }
}
