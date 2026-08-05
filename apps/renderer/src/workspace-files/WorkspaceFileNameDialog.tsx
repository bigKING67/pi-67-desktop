import { FolderOpen } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  FieldError,
  Heading,
  Input,
  Label,
  Modal,
  ModalOverlay,
  TextField
} from "react-aria-components";
import {
  detectWorkspaceFileFormat,
  reconcileWorkspaceFileFormat,
  syncWorkspaceFileNameFormat,
  validateWorkspaceFileName,
  workspaceFileDialogDescribesFormat,
  workspaceFileDialogOwnsFormat,
  workspaceFileNameSelectionEnd,
  WORKSPACE_FILE_FORMAT_OPTIONS,
  type WorkspaceFileDialogMode,
  type WorkspaceFileFormat
} from "./workspace-file-name.js";

type SubmitResult = boolean | { ok: boolean; message?: string };

export function WorkspaceFileNameDialog({
  title,
  detail,
  mode,
  initialName = "",
  confirmLabel,
  busy = false,
  onConfirm,
  onDismiss
}: {
  title: string;
  detail: string;
  mode: WorkspaceFileDialogMode;
  initialName?: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (name: string) => Promise<SubmitResult> | SubmitResult;
  onDismiss: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [format, setFormat] = useState<WorkspaceFileFormat>("auto");
  const [interacted, setInteracted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const descriptionId = useId();
  const errorId = useId();
  const validationError = validateWorkspaceFileName(name);
  const visibleError = requestError ?? (interacted ? validationError : undefined);
  const pending = busy || submitting;
  const describesFormat = workspaceFileDialogDescribesFormat(mode);
  const detectedFormat = detectWorkspaceFileFormat(name);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(0, workspaceFileNameSelectionEnd(initialName, mode));
    });
    return () => cancelAnimationFrame(frame);
  }, [initialName, mode]);

  useEffect(() => {
    if (pending || requestError === undefined) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [pending, requestError]);

  return (
    <ModalOverlay
      className="modal-overlay"
      isDismissable={!pending}
      isOpen
      onOpenChange={(open) => { if (!open && !pending) onDismiss(); }}
    >
      <Modal className="modal-surface workspace-file-name-modal">
        <Dialog aria-label={title} className="workspace-file-name-dialog">
          <form onSubmit={(event) => void submit(event)}>
            <header className="workspace-file-dialog-header">
              <span className="dialog-eyebrow">工作区文件</span>
              <Heading slot="title">{title}</Heading>
              <div className="workspace-file-dialog-location" id={descriptionId}>
                <FolderOpen aria-hidden="true" size={14} />
                <span>{detail}</span>
              </div>
            </header>

            <TextField
              className="workspace-file-name-field"
              isInvalid={visibleError !== undefined}
              name="workspace-file-name"
              validationBehavior="aria"
            >
              <Label>{fieldLabel(mode)}</Label>
              <Input
                ref={inputRef}
                aria-describedby={`${descriptionId}${visibleError ? ` ${errorId}` : ""}`}
                autoComplete="off"
                disabled={pending}
                maxLength={255}
                placeholder={fieldPlaceholder(mode)}
                value={name}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setName(nextName);
                  setFormat((current) => reconcileWorkspaceFileFormat(current, nextName));
                  setInteracted(true);
                  setRequestError(undefined);
                }}
                onCompositionEnd={() => { composingRef.current = false; }}
                onCompositionStart={() => { composingRef.current = true; }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
                }}
              />
              <div className="workspace-file-field-support">
                <span>{fieldSupport(mode)}</span>
                {describesFormat ? (
                  <span className="workspace-file-detected-format">
                    {detectedFormat.label}{detectedFormat.extension ? ` · ${detectedFormat.extension}` : " · 请包含扩展名"}
                  </span>
                ) : null}
              </div>
              <FieldError className="workspace-file-field-error" id={errorId}>{visibleError}</FieldError>
            </TextField>

            {workspaceFileDialogOwnsFormat(mode) ? (
              <label className="workspace-file-format-field">
                <span>文件类型</span>
                <select
                  aria-label="文件类型"
                  disabled={pending}
                  value={format}
                  onChange={(event) => {
                    const nextFormat = event.target.value as WorkspaceFileFormat;
                    setFormat(nextFormat);
                    setName((current) => syncWorkspaceFileNameFormat(current, nextFormat));
                    setRequestError(undefined);
                  }}
                >
                  {WORKSPACE_FILE_FORMAT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}{option.extension ? ` (${option.extension})` : ""}
                    </option>
                  ))}
                </select>
                <small>类型选择只同步扩展名；编辑器仍按最终文件名识别格式。</small>
              </label>
            ) : null}

            <footer className="dialog-actions workspace-file-dialog-actions">
              <Button className="secondary-button" isDisabled={pending} onPress={onDismiss}>取消</Button>
              <Button className="primary-button" type="submit" isDisabled={pending || validationError !== undefined}>
                {pending ? "正在处理…" : confirmLabel}
              </Button>
            </footer>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || composingRef.current) return;
    const submittedName = workspaceFileDialogOwnsFormat(mode)
      ? syncWorkspaceFileNameFormat(name, format)
      : name;
    if (submittedName !== name) setName(submittedName);
    const error = validateWorkspaceFileName(submittedName);
    if (error) {
      setInteracted(true);
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setRequestError(undefined);
    try {
      const result = await onConfirm(submittedName);
      const succeeded = typeof result === "boolean" ? result : result.ok;
      if (succeeded) {
        onDismiss();
        return;
      }
      setRequestError(typeof result === "boolean" ? "操作未完成，请重试。" : result.message ?? "操作未完成，请重试。");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "操作未完成，请重试。");
    } finally {
      setSubmitting(false);
    }
  }
}

function fieldLabel(mode: WorkspaceFileDialogMode): string {
  if (mode === "create-directory" || mode === "rename-directory") return "文件夹名称";
  return mode === "save-as" ? "新文件名称" : "文件名称";
}

function fieldPlaceholder(mode: WorkspaceFileDialogMode): string {
  if (mode === "create-directory") return "new-folder";
  if (mode === "rename-directory" || mode === "rename-file") return "输入新名称";
  return mode === "save-as" ? "example-copy.ts" : "example.ts";
}

function fieldSupport(mode: WorkspaceFileDialogMode): string {
  if (mode === "create-directory" || mode === "rename-directory") return "名称中不能包含路径分隔符。";
  return "请包含扩展名，例如 .ts、.md 或 .json。";
}
