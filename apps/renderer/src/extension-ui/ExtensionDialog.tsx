import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Input, Modal, ModalOverlay, TextArea } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { respondToExtensionUi } from "./extension-response.js";
import { useExtensionUiStore } from "./extension-ui-store.js";
import {
  stopInteractiveRendererTask,
  taskIdForInteractiveStop
} from "../workbench/task-stop-controller.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";

export function ExtensionDialog() {
  const request = useExtensionUiStore((state) => state.requests[0]);
  useWorkbenchStore((state) => state.tasks);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stoppingTask, setStoppingTask] = useState(false);

  useEffect(() => {
    setValue(request?.message ?? "");
    setSubmitting(false);
    setStoppingTask(false);
  }, [request?.requestId, request?.message]);

  if (!request) return null;
  const isConfirm = request.kind === "confirm";
  const isSelect = request.kind === "select";
  const isEditor = request.kind === "editor";
  const extensionLabel = request.extensionPackage
    ?? request.extensionPath
    ?? request.extensionId
    ?? messages.extensionUi.defaultExtensionLabel;
  const stoppableTaskId = taskIdForInteractiveStop(request);
  const submitResponse = async (responseValue?: string | boolean, cancelled?: boolean) => {
    if (submitting || stoppingTask) return;
    setSubmitting(true);
    const resolved = await respondToExtensionUi(
      () => useAppStore.getState(),
      request.requestId,
      responseValue,
      cancelled
    );
    if (!resolved && useExtensionUiStore.getState().requests.some(
      (candidate) => candidate.requestId === request.requestId
    )) setSubmitting(false);
  };
  const stopTask = async () => {
    if (submitting || stoppingTask) return;
    setStoppingTask(true);
    if (await stopInteractiveRendererTask(request)) {
      useExtensionUiStore.getState().removeRequestIfCurrent(request);
      return;
    }
    if (useExtensionUiStore.getState().requests.includes(request)) setStoppingTask(false);
  };

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={false}>
      <Modal className="modal-surface">
        <Dialog aria-label={request.title ?? messages.extensionUi.requestDialogLabel}>
          <form onSubmit={(event) => {
            event.preventDefault();
            void submitResponse(isConfirm ? true : value);
          }}>
            <span className="dialog-eyebrow">{extensionLabel}</span>
            <Heading slot="title">{request.title ?? messages.extensionUi.defaultTitle}</Heading>
            {request.message && !isEditor ? <p className="dialog-message">{request.message}</p> : null}
            {isSelect ? (
              <div className="dialog-options">
                {request.options?.map((option) => <button className={value === option ? "is-selected" : ""} disabled={submitting || stoppingTask} type="button" key={option} onClick={() => setValue(option)}>{option}</button>)}
              </div>
            ) : null}
            {request.kind === "input" ? (
              <Input
                autoFocus
                aria-label={request.title ?? messages.extensionUi.inputLabel}
                disabled={submitting || stoppingTask}
                {...(request.placeholder === undefined ? {} : { placeholder: request.placeholder })}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : null}
            {isEditor ? <TextArea autoFocus aria-label={request.title ?? messages.extensionUi.editorLabel} disabled={submitting || stoppingTask} value={value} onChange={(event) => setValue(event.target.value)} /> : null}
            <div className="dialog-actions">
              <Button className="secondary-button" isDisabled={submitting || stoppingTask} onPress={() => void submitResponse(undefined, true)}>取消当前输入</Button>
              {stoppableTaskId ? (
                <Button className="danger-button" isDisabled={submitting || stoppingTask} onPress={() => void stopTask()}>
                  {stoppingTask ? "正在停止任务" : "停止整个任务"}
                </Button>
              ) : null}
              <Button className="primary-button" type="submit" isDisabled={submitting || stoppingTask || (!isConfirm && isSelect && !value)}>
                {submitting
                  ? messages.extensionUi.submitting
                  : isConfirm
                    ? messages.extensionUi.confirm
                    : messages.extensionUi.continue}
              </Button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
