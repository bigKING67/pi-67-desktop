import type {
  PiProviderConfigurationInput,
  PiProviderConfigurationSnapshot
} from "@pi67/protocol";
import { Eye, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "react-aria-components";
import {
  setGlobalVisionAssistantConfiguration,
  setProjectVisionAssistantConfiguration
} from "./provider-configuration-controller.js";
import styles from "./ProviderVisionAssistantEditor.module.css";

const DISABLED_KEY = "disabled";
const INHERIT_KEY = "inherit";

const VISION_PROVIDER_PRESETS: ReadonlyArray<{
  id: "qwen" | "doubao";
  title: string;
  detail: string;
  provider: PiProviderConfigurationInput;
}> = [
  {
    id: "qwen",
    title: "Qwen3.7 Flash",
    detail: "阿里云百炼 · OpenAI compatible",
    provider: {
      id: "bailian",
      name: "阿里云百炼",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      api: "openai-completions",
      models: [{
        id: "qwen3.7-flash",
        name: "Qwen3.7 Flash",
        input: ["text", "image"],
        reasoning: true,
        contextWindow: 1_000_000,
        maxTokens: 65_536,
        advancedJson: "{}"
      }],
      advancedJson: "{}"
    }
  },
  {
    id: "doubao",
    title: "Doubao Seed 2.0 Mini",
    detail: "火山方舟 · OpenAI Responses",
    provider: {
      id: "volcengine-ark",
      name: "火山方舟",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      api: "openai-responses",
      models: [{
        id: "doubao-seed-2-0-mini-260428",
        name: "Doubao Seed 2.0 Mini",
        input: ["text", "image"],
        reasoning: true,
        advancedJson: "{}"
      }],
      advancedJson: "{}"
    }
  }
];

export function ProviderVisionAssistantEditor({
  snapshot,
  scope,
  workspaceId,
  onUsePreset
}: {
  snapshot: PiProviderConfigurationSnapshot;
  scope: "global" | "project";
  workspaceId?: string;
  onUsePreset?: (preset: PiProviderConfigurationInput) => void;
}) {
  const [saving, setSaving] = useState(false);
  const imageModels = useMemo(() => snapshot.providers
    .filter((provider) => provider.configured)
    .flatMap((provider) => (
      provider.models
        .filter((model) => model.input.includes("image"))
        .map((model) => ({
          key: modelKey(provider.id, model.id),
          provider: provider.id,
          model: model.id,
          label: `${provider.name ?? provider.id} / ${model.name ?? model.id}`
        }))
    )), [snapshot.providers]);
  const selected = scope === "global"
    ? snapshot.vision.global
      ? modelKey(snapshot.vision.global.provider, snapshot.vision.global.model)
      : DISABLED_KEY
    : snapshot.vision.project?.mode === "model"
      ? modelKey(snapshot.vision.project.provider, snapshot.vision.project.model)
      : snapshot.vision.project?.mode ?? INHERIT_KEY;
  const selectedUnavailable = selected !== DISABLED_KEY
    && selected !== INHERIT_KEY
    && !imageModels.some((model) => model.key === selected);
  const selectedUnavailableLabel = selectedUnavailable
    ? selectionLabel(
      snapshot,
      scope === "global" ? snapshot.vision.global : snapshot.vision.project?.mode === "model"
        ? snapshot.vision.project
        : undefined
    )
    : undefined;
  const effectiveSelection = snapshot.vision.effective;
  const effectiveUnavailable = effectiveSelection !== undefined
    && !imageModels.some((model) => (
      model.provider === effectiveSelection.provider
      && model.model === effectiveSelection.model
    ));
  const effective = effectiveSelection
    ? `${effectiveSelection.provider} / ${effectiveSelection.model}`
    : "未启用";

  const update = async (value: string) => {
    setSaving(true);
    try {
      if (scope === "global") {
        const model = imageModels.find((candidate) => candidate.key === value);
        await setGlobalVisionAssistantConfiguration(model
          ? { provider: model.provider, model: model.model }
          : undefined);
        return;
      }
      if (!workspaceId) return;
      if (value === INHERIT_KEY || value === DISABLED_KEY) {
        await setProjectVisionAssistantConfiguration(workspaceId, { mode: value });
        return;
      }
      const model = imageModels.find((candidate) => candidate.key === value);
      if (model) {
        await setProjectVisionAssistantConfiguration(workspaceId, {
          mode: "model",
          provider: model.provider,
          model: model.model
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.section} data-testid={`vision-assistant-${scope}`}>
      <div className={styles.heading}>
        <span className={styles.icon}><Eye aria-hidden="true" size={16} /></span>
        <span>
          <strong>{scope === "global" ? "视觉辅助" : "项目视觉辅助覆盖"}</strong>
          <small>{scope === "global"
            ? "文本模型遇到静态图片时，先由这里选定的视觉模型生成可回放描述；原生视觉模型仍直接处理图片。"
            : "仅影响当前可信 Workspace。可继承全局、明确关闭，或指定另一视觉模型。"}</small>
        </span>
      </div>
      <div className={styles.controlRow}>
        <label>
          <span>{scope === "global" ? "辅助模型" : "项目策略"}</span>
          <select
            aria-label={scope === "global" ? "全局视觉辅助模型" : "项目视觉辅助策略"}
            disabled={saving}
            onChange={(event) => void update(event.target.value)}
            value={selected}
          >
            {scope === "project" ? <option value={INHERIT_KEY}>继承全局设置</option> : null}
            <option value={DISABLED_KEY}>{scope === "project" ? "当前项目关闭" : "关闭视觉辅助"}</option>
            {selectedUnavailable ? (
              <option disabled value={selected}>当前配置不可用 · {selectedUnavailableLabel}</option>
            ) : null}
            {imageModels.map((model) => <option key={model.key} value={model.key}>{model.label}</option>)}
          </select>
          {imageModels.length === 0 ? (
            <small className={styles.noModels} role="status">
              {scope === "global"
                ? "暂无已配置的视觉模型。请使用下方预设完成模型服务和 API Key 配置。"
                : "暂无可用于项目覆盖的已配置视觉模型；可以继续继承全局设置。"}
            </small>
          ) : null}
        </label>
        <span
          aria-label={`${effectiveUnavailable ? "配置不可用" : "当前生效"}：${effective}`}
          className={`${styles.effective} ${effectiveUnavailable ? styles.effectiveWarning : ""}`}
        >
          {effectiveUnavailable
            ? <ShieldAlert aria-hidden="true" size={14} />
            : <ShieldCheck aria-hidden="true" size={14} />}
          {effectiveUnavailable ? "配置不可用" : "当前生效"} <strong>{effective}</strong>
        </span>
      </div>
      {scope === "global" && onUsePreset ? (
        <div className={styles.presets} aria-label="推荐视觉模型预设">
          {VISION_PROVIDER_PRESETS.map((preset, index) => (
            <article key={preset.id}>
              <span><em>{index + 1}</em><strong>{preset.title}</strong><small>{preset.detail}</small></span>
              <Button className="secondary-button" onPress={() => onUsePreset(clonePreset(preset.provider))}>
                <Plus aria-hidden="true" size={13} />使用预设
              </Button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function modelKey(provider: string, model: string): string {
  return `${encodeURIComponent(provider)}::${encodeURIComponent(model)}`;
}

function selectionLabel(
  snapshot: PiProviderConfigurationSnapshot,
  selection: { provider: string; model: string } | undefined
): string {
  if (!selection) return "未知模型";
  const provider = snapshot.providers.find((candidate) => candidate.id === selection.provider);
  const model = provider?.models.find((candidate) => candidate.id === selection.model);
  return `${provider?.name ?? selection.provider} / ${model?.name ?? selection.model}`;
}

function clonePreset(preset: PiProviderConfigurationInput): PiProviderConfigurationInput {
  return {
    ...preset,
    models: preset.models.map((model) => ({
      ...model,
      ...(model.input === undefined ? {} : { input: [...model.input] })
    }))
  };
}
