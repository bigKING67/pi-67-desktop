import type { ExtensionCompatibility, ExtensionUiRequestView } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";

export const DEFAULT_APPLICATION_TITLE = messages.common.appName;

export interface ExtensionStatusItem {
  id: string;
  key: string;
  message: string;
  attribution: "unattributed";
}

export interface ExtensionWidgetItem extends ExtensionStatusItem {
  placement: "aboveEditor" | "belowEditor";
}

export interface ExtensionCompatibilityItem {
  id: string;
  label: string;
  status: ExtensionCompatibility;
  detail: string;
  attribution: "identified" | "unattributed";
}

export function extensionUiItemId(request: ExtensionUiRequestView): string | undefined {
  if (
    request.hostEpoch === undefined
    || request.sessionId === undefined
    || request.sessionGeneration === undefined
    || request.key === undefined
  ) return undefined;
  return JSON.stringify([request.hostEpoch, request.sessionId, request.sessionGeneration, request.key]);
}

export function extensionCompatibilityItem(input: {
  extensionId?: string;
  extensionPackage?: string;
  extensionPath?: string;
  status: ExtensionCompatibility;
  detail: string;
}): ExtensionCompatibilityItem {
  const identified = input.extensionId ?? input.extensionPackage ?? input.extensionPath;
  return {
    id: identified ?? "unattributed-extension-ui",
    label: identified ?? messages.extensionUi.unattributed,
    status: input.status,
    detail: input.detail,
    attribution: identified === undefined ? "unattributed" : "identified"
  };
}
