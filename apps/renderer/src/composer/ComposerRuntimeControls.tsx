import { Brain, ChevronDown, Sparkles } from "lucide-react";
import { useEffect } from "react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select
} from "react-aria-components";
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

  return (
    <div className={styles.runtimeControls} aria-label={messages.composer.runtimeSettings}>
      <div className={styles.modelRuntimeControl}>
        <Select
          aria-label={messages.composer.modelLabel}
          isDisabled={disabled || modelSelection.status === "pending"}
          selectedKey={modelValue || null}
          onSelectionChange={(key) => {
            if (key === null) return;
            const value = String(key);
            if (value === CONFIGURE_PROVIDER_VALUE) {
              setCredentialDialogOpen(true);
              return;
            }
            const model = visibleModels.find((candidate) => `${candidate.provider}/${candidate.id}` === value);
            if (model) void selectSessionModel(model.provider, model.id);
          }}
        >
          <AriaButton className={`${styles.runtimeField} ${styles.modelSelectButton}`}>
            <Sparkles aria-hidden="true" size={14} />
            <span className={styles.modelSelectValue}>{modelLabel}</span>
            <ChevronDown aria-hidden="true" size={13} />
          </AriaButton>
          <Popover className={styles.modelSelectPopover!} placement="bottom end">
            <ListBox className={styles.modelSelectList!}>
              {visibleModels.map((model) => (
                <ListBoxItem
                  className={styles.modelSelectOption!}
                  id={`${model.provider}/${model.id}`}
                  key={`${model.provider}/${model.id}`}
                  textValue={model.label}
                >
                  <span>
                    <strong>{model.label}</strong>
                    <small>
                      {model.provider} · {model.provider}/{model.id}
                      {model.configured ? "" : ` ${messages.composer.unauthenticatedModel}`}
                    </small>
                  </span>
                </ListBoxItem>
              ))}
              {visibleModels.length === 0 ? (
                <ListBoxItem
                  className={styles.modelSelectOption!}
                  id={CONFIGURE_PROVIDER_VALUE}
                  textValue={messages.composer.configureProvider}
                >
                  <span>
                    <strong>{messages.composer.noAvailableModels}</strong>
                    <small>{messages.composer.configureProvider}</small>
                  </span>
                </ListBoxItem>
              ) : null}
            </ListBox>
          </Popover>
        </Select>
        {modelStatus ? (
          <span
            className={styles.modelSelectionStatus}
            data-status={modelSelection.status}
            role={modelSelection.status === "failed" ? "alert" : "status"}
            title={modelStatus}
          >{modelStatus}</span>
        ) : null}
      </div>
      <label className={`${styles.runtimeField} ${styles.thinkingField}`} title={messages.composer.thinkingTitle}>
        <Brain aria-hidden="true" size={14} />
        <span className="sr-only">{messages.composer.thinkingLabel}</span>
        <select
          aria-label={messages.composer.thinkingLabel}
          disabled={disabled}
          value={thinkingLevel}
          onChange={(event) => void setSessionThinkingLevel(event.target.value)}
        >
          {availableThinkingLevels?.map((level) => (
            <option key={level} value={level}>{thinkingLevelLabel(level)}</option>
          ))}
        </select>
      </label>
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

const THINKING_LEVEL_LABELS: Readonly<Record<string, string>> = {
  off: messages.composer.thinking.off,
  minimal: messages.composer.thinking.minimal,
  low: messages.composer.thinking.low,
  medium: messages.composer.thinking.medium,
  high: messages.composer.thinking.high,
  xhigh: messages.composer.thinking.xhigh,
  max: messages.composer.thinking.max
};

function thinkingLevelLabel(level: string): string {
  return THINKING_LEVEL_LABELS[level] ?? messages.composer.thinking.fallback(level);
}
