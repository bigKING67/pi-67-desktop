import type {
  PiModelConfigurationView,
  PiProviderConfigurationSnapshot,
  PiProviderConfigurationView
} from "@pi67/protocol";
import { Brain, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { messages } from "../localization/message-catalog.js";
import { useShellStore } from "../shell/shell-store.js";
import {
  forgetSessionRuntimePreference,
  recentSessionRuntimePreference
} from "../session/recent-session-runtime-preferences.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
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
    if (current?.startupModel || current?.startupThinkingLevel) return;
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

  const models = useMemo(() => runtimeModels(snapshot), [snapshot]);
  const effectiveModel = draftModel ?? snapshot?.defaults.effective;
  const selected = effectiveModel
    ? models.find((candidate) => (
        candidate.provider.id === effectiveModel.provider
        && candidate.model.id === effectiveModel.model
      ))
    : undefined;
  const modelGroups: ComposerRuntimeSelectOptionGroup[] = (snapshot?.providers ?? [])
    .filter((provider) => provider.configured && provider.models.length > 0)
    .map((provider) => ({
      id: provider.id,
      label: provider.name ?? provider.id,
      options: provider.models.map((model) => ({
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
    if (!snapshot || !draftModel) return;
    const selectedModel = runtimeModels(snapshot).find((candidate) => (
      candidate.provider.id === draftModel.provider
      && candidate.model.id === draftModel.model
    ));
    if (!selectedModel) {
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
  }, [draftModel, draftThinking, recentPreference, snapshot, taskId, usingRecentPreference, workspaceId]);

  return (
    <div className={styles.runtimeControls} aria-label={messages.composer.runtimeSettings}>
      <div className={styles.modelRuntimeControl}>
        <ComposerRuntimeSelect
          ariaLabel={messages.composer.modelLabel}
          disabled={submitting || loading}
          footer={usingRecentPreference
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
          valueText={loading ? "正在读取模型…" : selected?.model.name ?? selected?.model.id ?? messages.composer.selectModel}
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
        icon={<Brain aria-hidden="true" size={14} />}
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

function runtimeModels(snapshot: PiProviderConfigurationSnapshot | undefined): RuntimeModelOption[] {
  return (snapshot?.providers ?? []).filter((provider) => provider.configured).flatMap((provider) => (
    provider.models.map((model) => ({
      provider,
      model,
      key: `${provider.id}/${model.id}`
    }))
  ));
}
