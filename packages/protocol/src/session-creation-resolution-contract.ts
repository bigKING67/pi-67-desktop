export const MAX_SESSION_CREATION_ID_CHARS = 128;

export type SessionCreationResolution =
  | {
      status: "materialized";
      creationId: string;
      sessionId: string;
      sessionFileIdentity: string;
      sessionPath: string;
    }
  | {
      status: "missing" | "ambiguous";
      creationId: string;
    }
  | {
      status: "unavailable";
      creationId: string;
      reason: "scan-limit" | "storage-error";
    };
