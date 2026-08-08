import { createHash } from "node:crypto";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
  ProviderEnv
} from "@earendil-works/pi-ai";
import {
  withConfigurationFileLock,
  writePrivateFileAtomically
} from "./atomic-private-file.js";
import { withPiConfigurationBudget } from "./pi-configuration-service-options.js";

type CredentialData = Record<string, Credential>;

export interface PiAuthCredentialMutationResult {
  previousContent?: string;
  writtenContent: string;
}

export type StoredApiKeyReveal =
  | { status: "revealed"; apiKey: string }
  | { status: "not-found" | "not-api-key" | "indirect" };

/** Pi auth.json-compatible CredentialStore with explicit external reload support. */
export class PiAuthCredentialStore implements CredentialStore {
  private data: CredentialData = {};
  private readonly readWaitMs: number;

  constructor(readonly path: string, options: { readWaitMs?: number } = {}) {
    this.readWaitMs = options.readWaitMs ?? 2_000;
  }

  async reload(): Promise<string | undefined> {
    try {
      this.data = parseCredentialData(await readOptionalFile(this.path, this.readWaitMs));
      return undefined;
    } catch (error) {
      return errorMessage(error);
    }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const credential = this.data[providerId];
    if (credential?.type !== "api_key" || credential.key === undefined) return credential;
    const key = await resolveConfigValue(credential.key, credential.env);
    if (key === undefined) {
      return {
        type: "api_key",
        ...(credential.env === undefined ? {} : { env: credential.env })
      };
    }
    return { ...credential, key };
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.data).map(([providerId, credential]) => ({
      providerId,
      type: credential.type
    }));
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    return withConfigurationFileLock(this.path, async () => {
      const content = await readOptionalFile(this.path, this.readWaitMs);
      const current = parseCredentialData(content);
      const nextCredential = await update(current[providerId]);
      if (nextCredential === undefined) {
        this.data = current;
        return current[providerId];
      }
      const next = { ...current, [providerId]: structuredClone(nextCredential) };
      await writePrivateFileAtomically(this.path, `${JSON.stringify(next, null, 2)}\n`);
      this.data = next;
      return nextCredential;
    });
  }

  async delete(providerId: string): Promise<void> {
    await withConfigurationFileLock(this.path, async () => {
      const content = await readOptionalFile(this.path, this.readWaitMs);
      const next = parseCredentialData(content);
      delete next[providerId];
      await writePrivateFileAtomically(this.path, `${JSON.stringify(next, null, 2)}\n`);
      this.data = next;
    });
  }

  replaceExpected(
    providerId: string,
    credential: Credential,
    expectedRevision: string
  ): Promise<PiAuthCredentialMutationResult> {
    return this.mutateExpected(providerId, credential, expectedRevision);
  }

  deleteExpected(
    providerId: string,
    expectedRevision: string
  ): Promise<PiAuthCredentialMutationResult> {
    return this.mutateExpected(providerId, undefined, expectedRevision);
  }

  private mutateExpected(
    providerId: string,
    credential: Credential | undefined,
    expectedRevision: string
  ): Promise<PiAuthCredentialMutationResult> {
    return withConfigurationFileLock(this.path, async () => {
      const previousContent = await readOptionalFile(this.path, this.readWaitMs);
      if (contentRevision(previousContent) !== expectedRevision) {
        throw new PiAuthContentChangedError();
      }
      const next = parseCredentialData(previousContent);
      if (credential === undefined) delete next[providerId];
      else next[providerId] = structuredClone(credential);
      const writtenContent = `${JSON.stringify(next, null, 2)}\n`;
      await writePrivateFileAtomically(this.path, writtenContent);
      this.data = next;
      return {
        ...(previousContent === undefined ? {} : { previousContent }),
        writtenContent
      };
    });
  }
}

export class PiAuthContentChangedError extends Error {
  constructor() {
    super("Pi auth.json changed before the credential mutation could be applied.");
    this.name = "PiAuthContentChangedError";
  }
}

export function authContentRevision(content: string | undefined): string {
  return contentRevision(content);
}

export function revealStoredApiKey(
  content: string | undefined,
  providerId: string
): StoredApiKeyReveal {
  const credential = parseCredentialData(content)[providerId];
  if (credential === undefined) return { status: "not-found" };
  if (credential.type !== "api_key") return { status: "not-api-key" };
  if (typeof credential.key !== "string" || credential.key.length === 0) {
    return { status: "not-found" };
  }
  const apiKey = revealLiteralConfigValue(credential.key);
  return apiKey === undefined ? { status: "indirect" } : { status: "revealed", apiKey };
}

function parseCredentialData(content: string | undefined): CredentialData {
  if (content === undefined || content.trim() === "") return {};
  const parsed: unknown = JSON.parse(content);
  if (!isPlainObject(parsed)) throw new Error("Pi auth.json must contain a JSON object.");
  const result: CredentialData = {};
  for (const [providerId, value] of Object.entries(parsed)) {
    if (!isPlainObject(value) || (value.type !== "api_key" && value.type !== "oauth")) {
      throw new Error(`Pi auth.json contains an invalid credential entry for ${providerId}.`);
    }
    result[providerId] = value as Credential;
  }
  return result;
}

async function readOptionalFile(path: string, waitMs: number): Promise<string | undefined> {
  return withPiConfigurationBudget(
    readFile(path, "utf8"),
    waitMs,
    "configuration-file-access"
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

function contentRevision(content: string | undefined): string {
  return createHash("sha256")
    .update(content === undefined ? "missing\0" : `present\0${content}`, "utf8")
    .digest("hex");
}

async function resolveConfigValue(value: string, env?: ProviderEnv): Promise<string | undefined> {
  if (value.startsWith("!")) return executeCredentialCommand(value.slice(1));
  let resolved = "";
  for (let index = 0; index < value.length;) {
    const character = value[index];
    if (character !== "$") {
      resolved += character;
      index += 1;
      continue;
    }
    const next = value[index + 1];
    if (next === "$" || next === "!") {
      resolved += next;
      index += 2;
      continue;
    }
    const braced = next === "{";
    const suffix = braced ? value.slice(index + 2) : value.slice(index + 1);
    const match = braced
      ? suffix.match(/^([A-Za-z_][A-Za-z0-9_]*)\}/u)
      : suffix.match(/^([A-Za-z_][A-Za-z0-9_]*)/u);
    if (!match?.[1]) {
      resolved += "$";
      index += 1;
      continue;
    }
    const replacement = env?.[match[1]] ?? process.env[match[1]];
    if (replacement === undefined) return undefined;
    resolved += replacement;
    index += (braced ? 3 : 1) + match[1].length;
  }
  return resolved;
}

function revealLiteralConfigValue(value: string): string | undefined {
  if (value.startsWith("!")) return undefined;
  let revealed = "";
  for (let index = 0; index < value.length;) {
    const character = value[index];
    if (character !== "$") {
      revealed += character;
      index += 1;
      continue;
    }
    const next = value[index + 1];
    if (next === "$" || next === "!") {
      revealed += next;
      index += 2;
      continue;
    }
    const braced = next === "{";
    const suffix = braced ? value.slice(index + 2) : value.slice(index + 1);
    const match = braced
      ? suffix.match(/^([A-Za-z_][A-Za-z0-9_]*)\}/u)
      : suffix.match(/^([A-Za-z_][A-Za-z0-9_]*)/u);
    if (match?.[1]) return undefined;
    revealed += "$";
    index += 1;
  }
  return revealed;
}

function executeCredentialCommand(command: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    exec(command, {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        resolve(undefined);
        return;
      }
      resolve(stdout.trim() || undefined);
    });
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
