import type { TaskToolMode } from "@pi67/domain";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogTrigger,
  Popover
} from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { setTaskToolMode } from "../approval/task-tool-mode-controller.js";
import { messages } from "../localization/message-catalog.js";
import {
  selectedWorkbenchTask,
  useWorkbenchStore
} from "../workbench/workbench-store.js";
import styles from "./Composer.module.css";

const MODES: TaskToolMode[] = ["ask", "auto", "yolo"];

export function ToolModeSelector() {
  const connected = useAppStore((state) => state.connected);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const task = useWorkbenchStore(selectedWorkbenchTask);
  const workspaceTrust = useWorkbenchStore((state) => {
    const selected = selectedWorkbenchTask(state);
    return selected ? state.workspaces[selected.workspaceId]?.trust : undefined;
  });
  const [open, setOpen] = useState(false);
  const [confirmingYolo, setConfirmingYolo] = useState(false);
  const [pendingMode, setPendingMode] = useState<TaskToolMode>();

  useEffect(() => {
    setOpen(false);
    setConfirmingYolo(false);
    setPendingMode(undefined);
  }, [task?.id, task?.taskGeneration]);

  if (!task) return null;
  const disabled = !connected
    || sessionTransitionPending
    || task.sessionGeneration === undefined
    || pendingMode !== undefined;
  const label = messages.composer.toolModes[task.toolMode].label;

  const applyMode = async (mode: TaskToolMode) => {
    if (disabled || mode === task.toolMode) {
      setOpen(false);
      return;
    }
    setPendingMode(mode);
    const changed = await setTaskToolMode(task.id, mode);
    setPendingMode(undefined);
    if (changed) {
      setConfirmingYolo(false);
      setOpen(false);
    }
  };

  return (
    <DialogTrigger
      isOpen={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setConfirmingYolo(false);
      }}
    >
      <Button
        aria-label={messages.composer.toolModeControl(label)}
        className={styles.toolModeButton!}
        data-mode={task.toolMode}
        isDisabled={disabled}
      >
        <ShieldCheck aria-hidden="true" size={14} />
        <span>{pendingMode ? messages.composer.toolModeChanging : label}</span>
        <ChevronDown aria-hidden="true" size={12} />
      </Button>
      <Popover
        className={styles.toolModePopover!}
        placement="top start"
        shouldFlip
      >
        <Dialog aria-label={messages.composer.toolModeMenu} className={styles.toolModeDialog!}>
          {confirmingYolo ? (
            <div className={styles.toolModeConfirmation}>
              <header>
                <strong>{messages.composer.yoloConfirmationTitle}</strong>
                <p>{messages.composer.yoloConfirmationDescription}</p>
              </header>
              <div>
                <Button
                  className={styles.toolModeCancelButton!}
                  isDisabled={pendingMode !== undefined}
                  onPress={() => setConfirmingYolo(false)}
                >{messages.common.cancel}</Button>
                <Button
                  className={styles.toolModeConfirmButton!}
                  isDisabled={pendingMode !== undefined}
                  onPress={() => void applyMode("yolo")}
                >{messages.composer.enableYolo}</Button>
              </div>
            </div>
          ) : (
            <div aria-label={messages.composer.toolModeMenu} className={styles.toolModeOptions} role="radiogroup">
              {MODES.map((mode) => {
                const option = messages.composer.toolModes[mode];
                const selected = task.toolMode === mode;
                const unavailable = mode === "yolo" && workspaceTrust !== "trusted";
                return (
                  <button
                    aria-checked={selected}
                    className={styles.toolModeOption}
                    data-mode={mode}
                    disabled={unavailable}
                    key={mode}
                    role="radio"
                    type="button"
                    onClick={() => {
                      if (mode === "yolo" && !selected) {
                        setConfirmingYolo(true);
                        return;
                      }
                      void applyMode(mode);
                    }}
                  >
                    <span>
                      <strong>{option.label}</strong>
                      <small>{unavailable
                        ? messages.composer.yoloRequiresTrustedWorkspace
                        : option.description}</small>
                    </span>
                    {selected ? <Check aria-hidden="true" size={14} /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
