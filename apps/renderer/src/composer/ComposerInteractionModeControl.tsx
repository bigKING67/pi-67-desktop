import { ListTodo, Play } from "lucide-react";
import styles from "./Composer.module.css";

export function ComposerInteractionModeControl({
  disabled,
  mode,
  onChange
}: {
  disabled: boolean;
  mode: "execute" | "plan";
  onChange: (mode: "execute" | "plan") => void;
}) {
  return (
    <div aria-label="任务交互模式" className={styles.interactionMode} data-mode={mode} role="group">
      <button
        aria-pressed={mode === "execute"}
        className={mode === "execute" ? styles.interactionModeActive : ""}
        disabled={disabled}
        title="允许 Pi 按审批策略执行任务"
        type="button"
        onClick={() => onChange("execute")}
      ><Play aria-hidden="true" size={12} />执行</button>
      <button
        aria-pressed={mode === "plan"}
        className={mode === "plan" ? styles.interactionModeActive : ""}
        disabled={disabled}
        title="只读检查并产出计划，不修改项目"
        type="button"
        onClick={() => onChange("plan")}
      ><ListTodo aria-hidden="true" size={12} />计划</button>
    </div>
  );
}
