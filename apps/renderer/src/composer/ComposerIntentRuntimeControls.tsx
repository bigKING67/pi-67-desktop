import type {
  PiModelConfigurationView,
  PiProviderConfigurationSnapshot,
  PiProviderConfigurationView
} from "@pi67/protocol";
import { SlidersHorizontal, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { messages } from "../localization/message-catalog.js";
import { useShellStore } from "../shell/shell-store.js";
import {
  forgetSessionRuntimePreference,
  recentSessionRuntimePreference
} from "../session/recent-session-runtime-preferences.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { visibleModelChoices } from "../session/model-choice-visibility.js";
import {
  ComposerRuntimeSelect,
  type ComposerRuntimeSelectOptionGroup
} from "./ComposerRuntimeSelect.js";
import styles from "./Composer.module.css";
import { loadNewSessionRuntimeConfiguration } from "./new-session-runtime-controller.js";

const CONFIGURE_PROVIDER_VALUE = "__configure_provider__";
const RETRY_CONFIGURATION_VALUE = "__retry_configuration__";
const DEFAULT_THINKING_VALUE = "__default_thinking__";

interface RuntimeModelOption {
  provider: PiProviderConfigurationView;
  model: PiModelConfigurationView;
  key: string;
}

export function ComposerIntentRuntimeControls({
  taskId,
  workspaceId,
  submitting
}: {
  taskId: string;
  workspaceId: string | undefined;
  submitting: boolean;
}) {
  const draftModel = useTaskDraftStore((state) => state.drafts[taskId]?.startupModel);
  const draftThinking = useTaskDraftStore((state) => state.drafts[taskId]?.startupThinkingLevel);
  const pending = useTaskDraftStore((state) => state.drafts[taskId]?.startupConfigurationPending);
  const credentialDialogOpen = useShellStore((state) => state.credentialDialogOpen);
  const setCredentialDialogOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const [snapshot, setSnapshot] = useState<PiProviderConfigurationSnapshot>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false);
  const recentPreference = useMemo(
    () => workspaceId ? recentSessionRuntimePreference(workspaceId) : undefined,
    [taskId, workspaceId]
  );

  useEffect(() => {
    if (!recentPreference) return;
    const drafts = useTaskDraftStore.getState();
    const current = drafts.drafts[taskId];
    if (current?.startupConfigurationPending || current?.startupModel || current?.startupThinkingLevel) return;
    drafts.setStartupModel(taskId, recentPreference.model);
    drafts.setStartupThinkingLevel(taskId, recentPreference.thinkingLevel);
  }, [recentPreference, taskId]);

  useEffect(() => {
    if (credentialDialogOpen) return;
    let current = true;
    setError(undefined);
    void loadNewSessionRuntimeConfiguration(workspaceId).then((next) => {
      if (current) setSnapshot(next);
    }).catch((cause: unknown) => {
      if (!current) return;
      setSnapshot(undefined);
      setError(cause instanceof Error ? cause.message : "无法读取 Pi 模型配置。");
    });
    return () => { current = false; };
  }, [credentialDialogOpen, revision, taskId, workspaceId]);

  const providers = useMemo(() => runtimeProviders(snapshot), [snapshot]);
  const models = useMemo(() => runtimeModels(providers), [providers]);
  const effectiveModel = draftModel ?? snapshot?.defaults.effective;
  const selected = effectiveModel
    ? models.find((candidate) => (
        candidate.provider.id === effectiveModel.provider
        && candidate.model.id === effectiveModel.model
      ))
    : undefined;
  const unavailableAuto = !selected && draftModel?.provider === "pi67-auto" && draftModel.model === "auto";
  const unavailablePendingModel = pending && draftModel && !selected;
  const modelGroups: ComposerRuntimeSelectOptionGroup[] = providers
    .filter((provider) => provider.configured && provider.models.length > 0)
    .map((provider) => ({
      id: provider.id,
      label: provider.name ?? provider.id,
      options: visibleModelChoices(
        provider.id,
        provider.models,
        effectiveModel?.provider === provider.id ? effectiveModel.model : undefined
      ).map((model) => ({
        id: `${provider.id}/${model.id}`,
        label: model.name ?? model.id,
        detail: `${provider.id}/${model.id}${provider.configured ? "" : ` ${messages.composer.unauthenticatedModel}`}`
      }))
    }));
  const modelOptions = error
    ? [{ id: RETRY_CONFIGURATION_VALUE, label: "重新读取模型配置", detail: error }]
    : models.length === 0 && snapshot
      ? [{
          id: CONFIGURE_PROVIDER_VALUE,
          label: messages.composer.noAvailableModels,
          detail: messages.composer.configureProvider
        }]
      : [];
  const thinkingLevels = selected?.model.thinkingLevels ?? [];
  const thinkingOptions = [
    { id: DEFAULT_THINKING_VALUE, label: "默认" },
    ...thinkingLevels.map((level) => ({ id: level, label: level }))
  ];
  const loading = !snapshot && !error;
  const usingRecentPreference = Boolean(
    recentPreference
    && draftModel?.provider === recentPreference.model.provider
    && draftModel.model === recentPreference.model.model
    && draftThinking === recentPreference.thinkingLevel
  );

  useEffect(() => {
    if (!snapshot || !draftModel || pending) return;
    const selectedModel = runtimeModels(runtimeProviders(snapshot)).find((candidate) => (
      candidate.provider.id === draftModel.provider
      && candidate.model.id === draftModel.model
    ));
    if (!selectedModel) {
      // An explicit Auto choice must fail visibly if configuration disappears.
      if (draftModel.provider === "pi67-auto" && draftModel.model === "auto") return;
      const drafts = useTaskDraftStore.getState();
      drafts.setStartupModel(taskId, undefined);
      drafts.setStartupThinkingLevel(taskId, undefined);
      if (
        workspaceId
        && recentPreference?.model.provider === draftModel.provider
        && recentPreference.model.model === draftModel.model
      ) forgetSessionRuntimePreference(workspaceId);
      return;
    }
    if (draftThinking && !selectedModel.model.thinkingLevels?.includes(draftThinking)) {
      useTaskDraftStore.getState().setStartupThinkingLevel(taskId, undefined);
      if (workspaceId && usingRecentPreference) forgetSessionRuntimePreference(workspaceId);
    }
  }, [draftModel, draftThinking, pending, recentPreference, snapshot, taskId, usingRecentPreference, workspaceId]);

  return (
    <div className={styles.runtimeControls} aria-label={messages.composer.runtimeSettings}>
      <div className={styles.modelRuntimeControl}>
        <ComposerRuntimeSelect
          ariaLabel={messages.composer.modelLabel}
          disabled={submitting || loading}
          footer={unavailableAuto ? "Auto 配置不可用。请更新配置或明确选择其他模型。"
            : unavailablePendingModel ? "所选模型配置不可用。请更新配置或明确选择其他模型。" : pending
            ? "首条消息尚未发送；下次发送前会重新确认这些设置。" : usingRecentPreference
            ? "沿用当前工作区最近一次成功配置。"
            : draftModel
              ? "将在创建会话后、发送首条消息前应用。"
              : "使用当前项目的默认模型。"}
          icon={error
            ? <RefreshCw aria-hidden="true" size={14} />
            : <Sparkles aria-hidden="true" size={14} />}
          isOpen={modelPickerOpen}
          onOpenChange={setModelPickerOpen}
          onSelectionChange={(value) => {
            if (value === CONFIGURE_PROVIDER_VALUE) {
              setCredentialDialogOpen(true);
              return;
            }
            if (value === RETRY_CONFIGURATION_VALUE) {
              setRevision((current) => current + 1);
              return;
            }
            const next = models.find((candidate) => candidate.key === value);
            if (!next) return;
            const drafts = useTaskDraftStore.getState();
            drafts.setStartupModel(taskId, { provider: next.provider.id, model: next.model.id });
            if (
              draftThinking
              && !next.model.thinkingLevels?.includes(draftThinking)
            ) drafts.setStartupThinkingLevel(taskId, undefined);
          }}
          optionGroups={modelGroups}
          options={modelOptions}
          selectedKey={selected?.key ?? null}
          valueText={loading ? "正在读取模型…" : unavailableAuto ? "Auto · 配置不可用" : unavailablePendingModel ? `${draftModel.model} · 配置不可用` : selected?.model.name ?? selected?.model.id ?? messages.composer.selectModel}
          variant="model"
        />
      </div>
      <ComposerRuntimeSelect
        ariaLabel={messages.composer.thinkingLabel}
        disabled={submitting || loading || !selected}
        footer={selected
          ? messages.composer.thinkingAvailabilityHint(
              selected.model.name ?? selected.model.id,
              thinkingLevels
            )
          : "先选择模型，再设置思考级别。"}
        icon={<SlidersHorizontal aria-hidden="true" size={14} />}
        isOpen={thinkingPickerOpen}
        onOpenChange={setThinkingPickerOpen}
        onSelectionChange={(value) => {
          useTaskDraftStore.getState().setStartupThinkingLevel(
            taskId,
            value === DEFAULT_THINKING_VALUE ? undefined : value
          );
        }}
        options={thinkingOptions}
        selectedKey={draftThinking ?? DEFAULT_THINKING_VALUE}
        valueText={messages.composer.thinkingValue(draftThinking ?? "默认")}
        variant="thinking"
      />
    </div>
  );
}

function runtimeModels(providers: PiProviderConfigurationView[]): RuntimeModelOption[] {
  return providers.filter((provider) => provider.configured).flatMap((provider) => (
    provider.models.map((model) => ({
      provider,
      model,
      key: `${provider.id}/${model.id}`
    }))
  ));
}

function runtimeProviders(snapshot: PiProviderConfigurationSnapshot | undefined): PiProviderConfigurationView[] {
  const providers = snapshot?.providers ?? [];
  const config = snapshot?.autoRouting;
  if (!config || snapshot.syncState !== "current" || !Object.values(config).every((selection) => (
    providers.some((provider) => provider.id === selection.provider && provider.configured
      && provider.models.some((model) => model.id === selection.model && model.api !== "pi-virtual" && model.input.includes("text")))
  ))) return providers;
  return [{ id: "pi67-auto", name: "Auto", origin: "builtin", configured: true,
    modelsJsonApiKeyConfigured: false, headerNames: [], modelCount: 1, advancedJson: "{}",
    models: [{ id: "auto", name: "Auto · 自动选择", api: "pi-virtual", input: ["text", "image"], reasoning: true,
      thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh"], headerNames: [], advancedJson: "{}" }] }, ...providers];
}
