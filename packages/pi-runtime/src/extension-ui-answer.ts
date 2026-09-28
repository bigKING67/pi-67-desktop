import type { ExtensionUiRequestView } from "@pi67/domain";

/** What a pending extension dialog accepts: its kind and, for select, the offered options. */
export interface ExtensionUiDialogShape {
  kind: ExtensionUiRequestView["kind"];
  options?: readonly string[];
}

export function extensionUiDialogShape(details: Pick<ExtensionUiRequestView, "kind" | "options">): ExtensionUiDialogShape {
  return { kind: details.kind, ...(details.options ? { options: details.options } : {}) };
}

/** A confirm takes a boolean, a select one of its options, and input/editor text. */
export function isAnswerForDialog(dialog: ExtensionUiDialogShape, value: string | boolean | undefined): boolean {
  if (dialog.kind === "confirm") return typeof value === "boolean";
  if (typeof value !== "string") return false;
  return dialog.kind !== "select" || (dialog.options ?? []).includes(value);
}
