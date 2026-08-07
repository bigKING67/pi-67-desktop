import { lstat } from "node:fs/promises";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { createPrivateFileAtomically } from "./atomic-private-file.js";
import {
  inspectSessionCreationMarker,
  SESSION_CREATION_MARKER_SCHEMA_VERSION,
  SESSION_CREATION_MARKER_TYPE
} from "./session-creation-marker-inspection.js";

export { SESSION_CREATION_MARKER_TYPE };

export async function appendSessionCreationMarker(
  manager: Pick<
    SessionManager,
    | "appendCustomEntry"
    | "getCwd"
    | "getEntries"
    | "getHeader"
    | "getSessionId"
    | "getSessionFile"
    | "isPersisted"
    | "setSessionFile"
  >,
  creationId: string
): Promise<void> {
  manager.appendCustomEntry(SESSION_CREATION_MARKER_TYPE, {
    schemaVersion: SESSION_CREATION_MARKER_SCHEMA_VERSION,
    creationId
  });
  if (!manager.isPersisted()) return;

  const sessionPath = manager.getSessionFile();
  const header = manager.getHeader();
  if (!sessionPath || !header) {
    throw new Error("The created Pi Session cannot persist its creation marker.");
  }
  const existing = await lstat(sessionPath).catch((error: unknown) => (
    isNodeError(error, "ENOENT") ? undefined : Promise.reject(error)
  ));
  if (existing) {
    const inspection = await inspectSessionCreationMarker(
      sessionPath,
      creationId,
      manager.getCwd()
    );
    if (
      inspection.status !== "match"
      || inspection.identity.sessionId !== manager.getSessionId()
    ) {
      throw new Error("The existing Pi Session does not contain its exact creation marker.");
    }
    manager.setSessionFile(inspection.identity.sessionPath);
    return;
  }
  const serialized = [header, ...manager.getEntries()]
    .map((entry) => JSON.stringify(entry))
    .join("\n") + "\n";
  await createPrivateFileAtomically(sessionPath, serialized);

  // Pi normally defers the first JSONL write until an assistant message exists.
  // Reloading the exact file marks this manager as flushed so future entries append safely.
  const inspection = await inspectSessionCreationMarker(
    sessionPath,
    creationId,
    manager.getCwd()
  );
  if (
    inspection.status !== "match"
    || inspection.identity.sessionId !== manager.getSessionId()
  ) {
    throw new Error("The persisted Pi Session does not contain its exact creation marker.");
  }
  manager.setSessionFile(inspection.identity.sessionPath);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
