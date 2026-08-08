import { ArrowUp, ListPlus } from "lucide-react";
import { messages } from "../localization/message-catalog.js";
import styles from "./Composer.module.css";

export function ComposerStreamModeControl({
  disabled,
  mode,
  onChange
}: {
  disabled: boolean;
  mode: "steer" | "followUp";
  onChange: (mode: "steer" | "followUp") => void;
}) {
  return (
    <div className={styles.streamMode} aria-label={messages.composer.streamingDelivery}>
      <button
        aria-pressed={mode === "steer"}
        className={mode === "steer" ? styles.streamModeActive : ""}
        disabled={disabled}
        title={messages.composer.steerDetail}
        type="button"
        onClick={() => onChange("steer")}
      ><ArrowUp size={13} />{messages.composer.steer}</button>
      <button
        aria-pressed={mode === "followUp"}
        className={mode === "followUp" ? styles.streamModeActive : ""}
        disabled={disabled}
        title={messages.composer.followUpDetail}
        type="button"
        onClick={() => onChange("followUp")}
      ><ListPlus size={13} />{messages.composer.followUp}</button>
    </div>
  );
}
