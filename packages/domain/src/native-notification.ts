export type NativeNotificationKind = "completed" | "failed" | "attention";

export interface NativeNotificationRequest {
  notificationId: string;
  kind: NativeNotificationKind;
  workspaceId: string;
  sessionFileIdentity: string;
}

export type NativeNotificationActivation = NativeNotificationRequest;
