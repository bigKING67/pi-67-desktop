import type { ImageSourceApi } from "@pi67/domain";
import type { PiImageGenerationSourceView, PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "react-aria-components";
import {
  draftProblem,
  guessImageApi,
  IMAGE_API_LABELS,
  isLikelyImageModel,
  reusableProviders,
  type ImageSourceDraft
} from "./image-generation-source-draft.js";
import styles from "./ImageGenerationSettings.module.css";
import { inspectProviderModelDiscovery } from "./provider-configuration-controller.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";
import {
  SettingsBackAction,
  SettingsCheckbox,
  SettingsDetailHeader,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSaveBar,
  SettingsSectionBlock,
  SettingsSelect
} from "./SettingsPrimitives.js";

type Discovery = { phase: "idle" } | { phase: "loading" } | { phase: "done"; models: string[] } | { phase: "failed"; message: string };

export function ImageGenerationSourceEditor({ snapshot, source, initial, saving, onSave, onClose }: {
  snapshot: PiProviderConfigurationSnapshot;
  /** The saved source being edited; absent while creating one. */
  source?: PiImageGenerationSourceView;
  initial: ImageSourceDraft;
  saving: boolean;
  onSave: (draft: ImageSourceDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [discovery, setDiscovery] = useState<Discovery>({ phase: "idle" });
  const [manual, setManual] = useState("");
  const request = useRef(0);
  const providers = useMemo(() => reusableProviders(snapshot), [snapshot]);
  const hasStoredKey = source?.credential === "stored";
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const problem = draftProblem(draft, hasStoredKey);
  useSettingsDraftRegistration({ dirty, busy: saving, subject: "图像来源", discard: () => setDraft(initial) });
  useEffect(() => () => { request.current += 1; }, []);

  const update = (patch: Partial<ImageSourceDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const endpoint = draft.mode === "reuse" ? providers.find((provider) => provider.id === draft.provider)?.endpoint : draft.baseUrl.trim();
  const listed = discovery.phase === "done" ? discovery.models : [];
  const models = [...draft.models, ...listed.filter((model) => !draft.models.includes(model))];
  const toggle = (model: string, selected: boolean) => update({ models: selected ? [...draft.models, model] : draft.models.filter((item) => item !== model) });

  const discover = () => {
    if (!endpoint) return;
    const current = ++request.current;
    setDiscovery({ phase: "loading" });
    const provider = draft.mode === "reuse" ? draft.provider : source?.piProvider ?? "newmoney-images-draft";
    void inspectProviderModelDiscovery({ provider, baseUrl: endpoint, protocols: ["openai"], openAiApi: "openai-completions", authHeader: true,
      ...(draft.mode === "own" && draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}) }).then((result) => {
      if (request.current !== current) return;
      const ids = result.models.map((model) => model.id);
      const images = ids.filter(isLikelyImageModel);
      setDiscovery({ phase: "done", models: ids });
      setDraft((latest) => ({ ...latest, models: [...latest.models, ...images.filter((id) => !latest.models.includes(id))],
        ...(latest.existingId ? {} : { api: guessImageApi(endpoint, images) }) }));
    }, (reason: unknown) => {
      if (request.current !== current) return;
      setDiscovery({ phase: "failed", message: reason instanceof Error ? reason.message : "读取失败" });
    });
  };

  const addManual = () => {
    const id = manual.trim();
    if (!id || draft.models.includes(id)) return;
    update({ models: [...draft.models, id] });
    setManual("");
  };

  return (
    <div className={styles.editor} data-testid="image-source-editor">
      <SettingsDetailHeader
        back={<SettingsBackAction label="返回图像来源" onPress={onClose}>图像来源</SettingsBackAction>}
        title={source ? source.name : "添加图像来源"}
        {...(endpoint ? { detail: endpoint } : {})}
      />
      <SettingsSectionBlock title="连接">
        <SettingsRows>
          <FieldRow title="名称">
            <Input aria-label="图像来源名称" className={styles.input!} maxLength={64} value={draft.name} onChange={(event) => update({ name: event.target.value })} />
          </FieldRow>
          <SettingsRow
            title="接入方式"
            description={draft.mode === "reuse" ? "地址与 API Key 跟随该模型服务，修改后自动生效。" : "地址与 Key 只用于图像生成，Key 保存在 Pi 的 auth.json。"}
            actions={<SettingsSelect
              className={styles.select!}
              isDisabled={source !== undefined}
              label="接入方式"
              options={[{ id: "reuse", label: "沿用已配置的模型服务", disabled: providers.length === 0 }, { id: "own", label: "单独填写地址" }]}
              value={draft.mode}
              onChange={(mode) => update({ mode, ...(mode === "reuse" ? { provider: draft.provider || providers[0]?.id || "" } : {}) })}
            />}
          />
          {draft.mode === "reuse" ? (
            <SettingsRow
              title="模型服务"
              {...(providers.length === 0 ? { description: "还没有带 API Key 的模型服务；可以改为单独填写地址。" } : {})}
              actions={<SettingsSelect
                className={styles.select!}
                label="沿用的模型服务"
                options={[...(draft.provider && !providers.some((item) => item.id === draft.provider)
                  ? [{ id: draft.provider, label: `${draft.provider} · 已不可用`, disabled: true }] : []),
                  ...providers.map((provider) => ({ id: provider.id, label: provider.label }))]}
                value={draft.provider}
                onChange={(provider) => update({ provider, ...(draft.existingId ? {} : { api: guessImageApi(providers.find((item) => item.id === provider)?.endpoint) }) })}
              />}
            />
          ) : (<>
            <FieldRow title="地址">
              <Input aria-label="图像接口地址" className={styles.input!} placeholder="https://api.example.com/v1" value={draft.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} />
            </FieldRow>
            <FieldRow title="API Key" description={hasStoredKey ? "已保存。留空则保持不变。" : undefined}>
              <Input aria-label="图像接口 API Key" autoComplete="off" className={styles.input!} placeholder={hasStoredKey ? "已保存" : "sk-…"} type="password"
                value={draft.apiKey} onChange={(event) => update({ apiKey: event.target.value })} />
            </FieldRow>
          </>)}
          <SettingsRow
            title="接口类型"
            description="火山方舟使用 Seedream 接口，其余服务使用 OpenAI 兼容的图像接口。"
            actions={<SettingsSelect
              className={styles.select!}
              label="接口类型"
              options={(Object.keys(IMAGE_API_LABELS) as ImageSourceApi[]).map((api) => ({ id: api, label: IMAGE_API_LABELS[api] }))}
              value={draft.api}
              onChange={(api) => update({ api })}
            />}
          />
        </SettingsRows>
      </SettingsSectionBlock>
      <SettingsSectionBlock
        title="模型"
        description="勾选 Agent 可以使用的模型。读取列表后会自动勾选看起来是图像模型的条目。"
        actions={<Button className="secondary-button" isDisabled={!endpoint || discovery.phase === "loading"} onPress={discover}>
          <RefreshCw aria-hidden="true" size={13} />{discovery.phase === "loading" ? "正在读取…" : "读取模型列表"}
        </Button>}
      >
        <SettingsRows>
          {models.map((model) => (
            <SettingsRow key={model} title={<SettingsCheckbox isSelected={draft.models.includes(model)} onChange={(selected) => toggle(model, selected)}>
              <span className={styles.modelId}>{model}</span>
            </SettingsCheckbox>} />
          ))}
          {discovery.phase === "done" && listed.length === 0 ? <SettingsRow title="该服务没有返回模型列表" description="请在下方手动添加模型 ID。" /> : null}
          <FieldRow title="手动添加" description={models.length === 0 ? "例如 gpt-image-2.5-sunburst 或 doubao-seedream-5-0-260128。" : undefined}
            actions={<Button className="secondary-button" isDisabled={!manual.trim()} onPress={addManual}><Plus aria-hidden="true" size={13} />添加</Button>}>
            <Input aria-label="手动添加模型 ID" className={styles.input!} placeholder="模型 ID" value={manual}
              onChange={(event) => setManual(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addManual(); }} />
          </FieldRow>
        </SettingsRows>
      </SettingsSectionBlock>
      {discovery.phase === "failed" ? <SettingsNotice tone="warning">没能读取模型列表：{discovery.message}。可以手动添加模型 ID。</SettingsNotice> : null}
      {dirty && problem ? <SettingsNotice tone="info">{problem}</SettingsNotice> : null}
      <SettingsSaveBar
        canSave={problem === undefined}
        dirty={dirty || source === undefined}
        saveLabel={source ? "保存更改" : "添加来源"}
        saving={saving}
        onDiscard={onClose}
        onSave={() => onSave(draft)}
      />
    </div>
  );
}

function FieldRow({ title, description, actions, children }: { title: string; description?: string | undefined; actions?: ReactNode; children: ReactNode }) {
  return <SettingsRow title={title} {...(description ? { description } : {})} actions={<span className={styles.field}>{children}{actions}</span>} />;
}
