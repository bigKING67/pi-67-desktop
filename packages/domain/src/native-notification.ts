export type NativeNotificationKind = "completed" | "failed" | "attention";

/** A background Pi task finished, failed or waits for the user; Main owns the wording. */
export interface TaskNativeNotificationRequest {
  notificationId: string;
  kind: NativeNotificationKind;
  workspaceId: string;
  sessionFileIdentity: string;
}

/**
 * A Team Chat activity item (ADR 0006). The renderer composes the wording: who and
 * where by default, a message preview only when the user turned previews on.
 */
export interface ChatNativeNotificationRequest {
  notificationId: string;
  kind: "chat";
  title: string;
  body: string;
  /** Absent for a summary of several conversations, which opens the activity inbox. */
  conversationId?: string;
  messageSeq?: number;
}

export const NATIVE_NOTIFICATION_TEXT_LIMITS = { title: 120, body: 240 } as const;

export type NativeNotificationRequest = TaskNativeNotificationRequest | ChatNativeNotificationRequest;

export type NativeNotificationActivation = NativeNotificationRequest;
