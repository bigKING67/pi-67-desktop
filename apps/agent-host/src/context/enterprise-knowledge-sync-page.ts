import { createHash } from "node:crypto";
import { decodeKnowledgeSyncPage as decodePage, KnowledgeSyncValidationError, type KnowledgeSyncExpectation, type KnowledgeSyncPage } from "@pi67/protocol";
import { invalidResponse } from "./enterprise-context-gateway-validation.js";

export type { KnowledgeSyncExpectation, KnowledgeSyncPage } from "@pi67/protocol";

export function decodeKnowledgeSyncPage(bytes: Uint8Array, expected: KnowledgeSyncExpectation): KnowledgeSyncPage {
  try { return decodePage(bytes, expected, (text) => createHash("sha256").update(text, "utf8").digest("hex")); }
  catch (error) {
    if (error instanceof KnowledgeSyncValidationError) throw invalidResponse(error.field);
    throw error;
  }
}
