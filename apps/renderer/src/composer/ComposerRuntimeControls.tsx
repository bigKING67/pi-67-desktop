import { Brain, Sparkles } from "lucide-react";
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
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useShellStore } from "../shell/shell-store.js";
import styles from "./Composer.module.css";

const CONFIGURE_PROVIDER_VALUE = "__configure_provider__";

export function ComposerRuntimeControls({ submitting }: { submitting: boolean }) {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const models = useSessionProjectionStore(selectSessionModels);
  const selectedModel = useSessionProjectionStore(selectSelectedModel);
  const thinkingLevel = useSessionProjectionStore(selectThinkingLevel);
  const availableThinkingLevels = useSessionProjectionStore(selectAvailableThinkingLevels);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const setCredentialDialogOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const streaming = useCommittedConversationStreaming();
  if (!sessionId) return null;

  const selectedModelValue = selectedModel
    ? `${selectedModel.provider}/${selectedModel.id}`
    : "";
  const visibleModels = models?.filter((model) => (
    model.configured || `${model.provider}/${model.id}` === selectedModelValue
  )) ?? [];
  const disabled = submitting || streaming || sessionTransitionPending;

  return (
    <div className={styles.runtimeControls} aria-label={messages.composer.runtimeSettings}>
      <label className={styles.runtimeField} title={messages.composer.modelTitle}>
        <Sparkles aria-hidden="true" size={14} />
        <span className="sr-only">{messages.composer.modelLabel}</span>
        <select
          aria-label={messages.composer.modelLabel}
          disabled={disabled}
          value={selectedModelValue}
          onChange={(event) => {
            if (event.target.value === CONFIGURE_PROVIDER_VALUE) {
              setCredentialDialogOpen(true);
              return;
            }
            const [provider, ...modelParts] = event.target.value.split("/");
            if (provider) void selectSessionModel(provider, modelParts.join("/"));
          }}
        >
          <option value="">{visibleModels.length > 0
            ? messages.composer.selectModel
            : messages.composer.noAvailableModels}</option>
          {visibleModels.map((model) => (
            <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
              {model.label} · {model.provider}{model.configured ? "" : messages.composer.unauthenticatedModel}
            </option>
          ))}
          {visibleModels.length === 0 ? (
            <option value={CONFIGURE_PROVIDER_VALUE}>{messages.composer.configureProvider}</option>
          ) : null}
        </select>
      </label>
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
