import { SettingsDiscardDialog } from "./SettingsActionDialogs.js";

export function ContextFileDiscardDialog({ open, busy, fileName, onCancel, onDiscard }: {
  open: boolean;
  busy: boolean;
  fileName: string | undefined;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  return (
    <SettingsDiscardDialog
      busy={busy}
      open={open}
      subject={fileName ?? "当前规则与上下文文件"}
      onCancel={onCancel}
      onDiscard={onDiscard}
    />
  );
}
