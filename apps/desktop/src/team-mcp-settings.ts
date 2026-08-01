import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DEFAULT_TEAM_MCP_SERVER,
  TEAM_MCP_SERVER_NAME,
  TEAM_MCP_TOKEN_ENV,
  TEAM_MCP_TOKEN_FILE
} from "./team-mcp.js";

const TEAM_MCP_SETTINGS_DIRECTORY = "team-mcp";
const MAX_TOKEN_BYTES = 4 * 1_024;

export interface TeamMcpStatus {
  serverName: string;
  url: string;
  tokenEnv: string;
  configured: boolean;
  /** Safe prefix only, e.g. mcp_ea63244d757b… — never the secret half. */
  tokenPrefix?: string;
  tokenPath: string;
}

export type TeamMcpRevealResult =
  | { status: "revealed"; token: string }
  | { status: "missing" };

export interface TeamMcpSettingsStoreOptions {
  createToken?: () => string;
}

export class TeamMcpSettingsStore {
  readonly tokenPath: string;
  readonly #userData: string;
  readonly #createToken: () => string;
  #pending: Promise<void> = Promise.resolve();

  constructor(userData: string, options: TeamMcpSettingsStoreOptions = {}) {
    if (typeof userData !== "string" || userData.length === 0 || userData.includes("\0")) {
      throw new Error("Electron userData path is invalid.");
    }
    this.#userData = resolve(userData);
    this.tokenPath = join(this.#userData, TEAM_MCP_SETTINGS_DIRECTORY, TEAM_MCP_TOKEN_FILE);
    this.#createToken = options.createToken ?? randomUUID;
  }

  status(): Promise<TeamMcpStatus> {
    return this.#enqueue(async () => this.#statusUnlocked());
  }

  saveToken(value: unknown): Promise<TeamMcpStatus> {
    return this.#enqueue(async () => {
      const token = normalizeClientToken(value);
      if (!token) throw new Error("Client Token 格式无效。需要完整的 mcp_<prefix>.<secret>。");
      await this.#writeTokenUnlocked(token);
      return this.#statusUnlocked();
    });
  }

  clearToken(): Promise<TeamMcpStatus> {
    return this.#enqueue(async () => {
      await this.#removeTokenUnlocked();
      return this.#statusUnlocked();
    });
  }

  /**
   * One-shot reveal for the Settings eye control.
   * Default status projection still returns only a safe prefix.
   */
  revealToken(): Promise<TeamMcpRevealResult> {
    return this.#enqueue(async () => {
      const token = await this.#readTokenUnlocked();
      if (!token) return { status: "missing" };
      return { status: "revealed", token };
    });
  }

  /**
   * Read the full token for Agent Host env injection only.
   * Callers must never log or project this value outside trusted Main paths.
   */
  readTokenForRuntime(): Promise<string | undefined> {
    return this.#enqueue(async () => this.#readTokenUnlocked());
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(operation, operation);
    this.#pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async #statusUnlocked(): Promise<TeamMcpStatus> {
    const token = await this.#readTokenUnlocked();
    return {
      serverName: TEAM_MCP_SERVER_NAME,
      url: DEFAULT_TEAM_MCP_SERVER.url,
      tokenEnv: TEAM_MCP_TOKEN_ENV,
      configured: Boolean(token),
      ...(token ? { tokenPrefix: safeTokenPrefix(token) } : {}),
      tokenPath: this.tokenPath
    };
  }

  async #readTokenUnlocked(): Promise<string | undefined> {
    if (!existsSync(this.tokenPath)) return undefined;
    try {
      const metadata = await lstat(this.tokenPath);
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_TOKEN_BYTES) {
        return undefined;
      }
      const raw = await readFile(this.tokenPath, "utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_TOKEN_BYTES) return undefined;
      return normalizeClientToken(raw) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async #writeTokenUnlocked(token: string): Promise<void> {
    const directory = join(this.#userData, TEAM_MCP_SETTINGS_DIRECTORY);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const temporary = join(
      directory,
      `.${TEAM_MCP_TOKEN_FILE}.${process.pid}.${this.#createToken()}.tmp`
    );
    await writeFile(temporary, `${token}\n`, { mode: 0o600 });
    await rename(temporary, this.tokenPath);
    if (process.platform !== "win32") await chmod(this.tokenPath, 0o600);
  }

  async #removeTokenUnlocked(): Promise<void> {
    try {
      await rm(this.tokenPath, { force: true });
    } catch {
      // ignore
    }
  }
}

export function normalizeClientToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const token = value.replace(/^\uFEFF/, "").trim();
  if (!token.startsWith("mcp_") || !token.includes(".")) return undefined;
  if (token.length < 20 || token.length > 512) return undefined;
  if (/\s/.test(token)) return undefined;
  return token;
}

export function safeTokenPrefix(token: string): string {
  const prefix = token.split(".")[0] ?? "mcp_";
  return prefix.length > 20 ? `${prefix.slice(0, 20)}…` : `${prefix}…`;
}
