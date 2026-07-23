import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Input, Modal, ModalOverlay, TextArea } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";

export function ExtensionDialog() {
  const request = useAppStore((state) => state.extensionRequests[0]);
  const resolveExtension = useAppStore((state) => state.resolveExtension);
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(request?.message ?? "");
  }, [request?.requestId, request?.message]);

  if (!request) return null;
  const isConfirm = request.kind === "confirm";
  const isSelect = request.kind === "select";
  const isEditor = request.kind === "editor";

  return (
    <ModalOverlay className="modal-overlay" isOpen isDismissable={false}>
      <Modal className="modal-surface">
        <Dialog aria-label={request.title ?? "Pi extension request"}>
          <form onSubmit={(event) => {
            event.preventDefault();
            void resolveExtension(request.requestId, isConfirm ? true : value);
          }}>
            <span className="dialog-eyebrow">{request.extensionId}</span>
            <Heading slot="title">{request.title ?? "Pi extension 需要输入"}</Heading>
            {request.message && !isEditor ? <p className="dialog-message">{request.message}</p> : null}
            {isSelect ? (
              <div className="dialog-options">
                {request.options?.map((option) => <button className={value === option ? "is-selected" : ""} type="button" key={option} onClick={() => setValue(option)}>{option}</button>)}
              </div>
            ) : null}
            {request.kind === "input" ? (
              <Input
                autoFocus
                aria-label={request.title ?? "Pi extension input"}
                {...(request.placeholder === undefined ? {} : { placeholder: request.placeholder })}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : null}
            {isEditor ? <TextArea autoFocus aria-label={request.title ?? "Pi extension editor"} value={value} onChange={(event) => setValue(event.target.value)} /> : null}
            <div className="dialog-actions">
              <Button className="secondary-button" onPress={() => void resolveExtension(request.requestId, undefined, true)}>取消</Button>
              <Button className="primary-button" type="submit" isDisabled={!isConfirm && isSelect && !value}>
                {isConfirm ? "允许本次操作" : "继续"}
              </Button>
            </div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
