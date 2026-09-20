import type { ExtensionAPI } from "@pi67/pi-runtime/pi-sdk-types";
import initializeOpenViking from "./index.js";
import { snapshotManagedMemoryConnection, type ManagedMemoryConnection } from "./managed-connection.js";

/** Explicit Pi ExtensionFactory seam; the default package remains external compatibility. */
export function createManagedOpenVikingExtension(connection: ManagedMemoryConnection) {
  const snapshot = snapshotManagedMemoryConnection(connection);
  return (pi: ExtensionAPI) => initializeOpenViking(pi, snapshot);
}
