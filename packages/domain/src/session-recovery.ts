/** A bounded projection of unfinished work in the current native Pi branch. */
export type SessionRecoveryView =
  | { status: "none" }
  | { status: "available"; anchor: string }
  | { status: "blocked"; reason: "unconfirmed-tools" | "auto-selection-missing" | "history-limit"; pendingToolCount: number };
