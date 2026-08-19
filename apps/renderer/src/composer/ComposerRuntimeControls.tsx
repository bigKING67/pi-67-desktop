import { Brain, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { useCommittedConversationStreaming } from "../conversation/conversation-store.js";
import { messages } from "../localization/message-catalog.js";
import {
  selectSessionModel,
  setSessionThinkingLevel
} from "../session/session-control-controller.js";
import {
  selectAvailableThinkingLevels,
  selectSelectedModel,
  selectSessionId,
  selectSessionModels,
  selectThinkingLevel
} from "../session/session-projection-selectors.js";
import {
  modelSelectionTargetKey,
  resetModelSelection,
  useModelSelectionStore
} from "../session/model-selection-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useShellStore } from "../shell/shell-store.js";
import {
  ComposerRuntimeSelect,
  type ComposerRuntimeSelectOption
} from "./ComposerRuntimeSelect.js";
import styles from "./Composer.module.css";

const CONFIGURE_PROVIDER_VALUE = "__configure_provider__";
const MODEL_CONFIRMATION_VISIBLE_MS = 4_000;

export function ComposerRuntimeControls({ submitting }: { submitting: boolean }) {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const models = useSessionProjectionStore(selectSessionModels);
  const selectedModel = useSessionProjectionStore(selectSelectedModel);
  const thinkingLevel = useSessionProjectionStore(selectThinkingLevel);
  const availableThinkingLevels = useSessionProjectionStore(selectAvailableThinkingLevels);
  const modelSelection = useModelSelectionStore();
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const setCredentialDialogOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const modelPickerRequestRevision = useShellStore((state) => state.modelPickerRequestRevision);
  const modelPickerHandledRevision = useShellStore((state) => state.modelPickerHandledRevision);
  const acknowledgeModelPickerRequest = useShellStore((state) => state.acknowledgeModelPickerRequest);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false);
  const streaming = useCommittedConversationStreaming();
  useEffect(() => {
    if (modelSelection.status !== "confirmed") return;
    const revision = modelSelection.revision;
    const timeout = window.setTimeout(() => {
      const current = useModelSelectionStore.getState();
      if (current.status === "confirmed" && current.revision === revision) resetModelSelection();
    }, MODEL_CONFIRMATION_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [modelSelection.revision, modelSelection.status]);
  useEffect(() => {
    if (modelPickerRequestRevision <= modelPickerHandledRevision) return;
    setModelPickerOpen(true);
    acknowledgeModelPickerRequest(modelPickerRequestRevision);
  }, [acknowledgeModelPickerRequest, modelPickerHandledRevision, modelPickerRequestRevision]);
  useEffect(() => {
    if (modelSelection.status === "pending") setThinkingPickerOpen(false);
  }, [modelSelection.status]);
  if (!sessionId) return null;

  const selectedModelValue = selectedModel
    ? `${selectedModel.provider}/${selectedModel.id}`
    : "";
  const visibleModels = models?.filter((model) => (
    model.configured || `${model.provider}/${model.id}` === selectedModelValue
  )) ?? [];
  const disabled = submitting || streaming || sessionTransitionPending;
  const modelValue = modelSelection.status === "pending"
    ? modelSelectionTargetKey(modelSelection.target) ?? selectedModelValue
    : selectedModelValue;
  const modelStatus = modelSelectionStatusText(modelSelection);
  const modelLabel = modelSelection.status === "pending" && modelSelection.target
    ? modelSelection.target.label
    : visibleModels.find((model) => `${model.provider}/${model.id}` === selectedModelValue)?.label
      ?? messages.composer.selectModel;
  const modelOptions: ComposerRuntimeSelectOption[] = visibleModels.length > 0
    ? visibleModels.map((model) => ({
        id: `${model.provider}/${model.id}`,
        label: model.label,
        detail: `${model.provider}/${model.id}${model.configured ? "" : ` ${messages.composer.unauthenticatedModel}`}`
      }))
    : [{
        id: CONFIGURE_PROVIDER_VALUE,
        label: messages.composer.noAvailableModels,
        detail: messages.composer.configureProvider
      }];
  const thinkingOptions: ComposerRuntimeSelectOption[] = (availableThinkingLevels ?? []).map((level) => ({
    id: level,
    label: level
  }));
  const modelSelectionPending = modelSelection.status === "pending";

  return (
    <div className={styles.runtimeControls} aria-label={messages.composer.runtimeSettings}>
      <div className={styles.modelRuntimeControl}>
        <ComposerRuntimeSelect
          ariaLabel={messages.composer.modelLabel}
          disabled={disabled || modelSelectionPending}
          icon={<Sparkles aria-hidden="true" size={14} />}
          isOpen={modelPickerOpen}
          onOpenChange={setModelPickerOpen}
          onSelectionChange={(value) => {
            if (value === CONFIGURE_PROVIDER_VALUE) {
              setCredentialDialogOpen(true);
              return;
            }
            const model = visibleModels.find((candidate) => `${candidate.provider}/${candidate.id}` === value);
            if (model) void selectSessionModel(model.provider, model.id);
          }}
          options={modelOptions}
          selectedKey={modelValue || null}
          valueText={modelLabel}
          variant="model"
        />
        {modelStatus ? (
          <span
            className={styles.modelSelectionStatus}
            data-status={modelSelection.status}
            role={modelSelection.status === "failed" ? "alert" : "status"}
            title={modelStatus}
          >{modelStatus}</span>
        ) : null}
      </div>
      <ComposerRuntimeSelect
        ariaLabel={messages.composer.thinkingLabel}
        disabled={disabled || modelSelectionPending || thinkingOptions.length === 0}
        footer={messages.composer.thinkingAvailabilityHint(
          modelLabel,
          thinkingOptions.map((option) => option.label)
        )}
        icon={<Brain aria-hidden="true" size={14} />}
        isOpen={thinkingPickerOpen}
        onOpenChange={setThinkingPickerOpen}
        onSelectionChange={(level) => void setSessionThinkingLevel(level)}
        options={thinkingOptions}
        selectedKey={thinkingLevel ?? null}
        valueText={messages.composer.thinkingValue(thinkingLevel ?? "-")}
        variant="thinking"
      />
    </div>
  );
}

function modelSelectionStatusText(
  selection: ReturnType<typeof useModelSelectionStore.getState>
): string | undefined {
  if (!selection.target) return undefined;
  if (selection.status === "pending") return messages.composer.modelSwitching(selection.target.label);
  if (selection.status === "confirmed") return messages.composer.modelSwitched(selection.target.label);
  if (selection.status === "failed") {
    return messages.composer.modelSwitchFailed(selection.target.label, selection.error ?? "未知错误");
  }
  return undefined;
}
