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
      subject={fileName ?? "当前工作规则文件"}
      onCancel={onCancel}
      onDiscard={onDiscard}
    />
  );
}
