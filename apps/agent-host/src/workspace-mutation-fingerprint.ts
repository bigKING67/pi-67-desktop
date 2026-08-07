import { createHash } from "node:crypto";
import { HostCommandError } from "./protocol-error.js";

interface WorkspaceMutationFingerprintInput {
  readonly type: string;
  readonly payload: unknown;
}

interface HashWriter {
  update(data: string, inputEncoding?: BufferEncoding): HashWriter;
}

export function mutationFingerprint(command: WorkspaceMutationFingerprintInput): string {
  const hash = createHash("sha256");
  hash.update(command.type, "utf8").update("\0");
  writeCanonicalValue(hash, command.payload);
  return hash.digest("hex");
}

function writeCanonicalValue(hash: HashWriter, value: unknown): void {
  if (value === null) {
    hash.update("null");
    return;
  }
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) {
    hash.update(JSON.stringify(value));
    return;
  }
  if (typeof value === "boolean") {
    hash.update(value ? "true" : "false");
    return;
  }
  if (Array.isArray(value)) {
    hash.update("[");
    value.forEach((item, index) => {
      if (index > 0) hash.update(",");
      writeCanonicalValue(hash, item);
    });
    hash.update("]");
    return;
  }
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    hash.update("{");
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    entries.forEach(([key, item], index) => {
      if (index > 0) hash.update(",");
      hash.update(JSON.stringify(key)).update(":");
      writeCanonicalValue(hash, item);
    });
    hash.update("}");
    return;
  }
  throw new HostCommandError(
    "INVALID_PAYLOAD",
    "The Workspace mutation payload cannot be fingerprinted.",
    false
  );
}
