import type { LocalMemoryRuntimePurpose, LocalMemoryRuntimeStatus } from "@pi67/protocol";
import { lstat, mkdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { installOpenVikingRuntime, OPENVIKING_INSTALLATION_NAME, OPENVIKING_TEAM_INSTALLATION_NAME, OPENVIKING_QUERY_INSTALLATION_NAME } from "./openviking-runtime-installer.js";

const installationNames: Record<LocalMemoryRuntimePurpose, string> = {
  private: OPENVIKING_INSTALLATION_NAME,
  "team-index-v1": OPENVIKING_TEAM_INSTALLATION_NAME,
  "team-query-v1": OPENVIKING_QUERY_INSTALLATION_NAME
};

/** Main-selected layout only; no paths, trust anchors or model keys from Renderer. */
export class LocalMemoryRuntimeController {
  #pending: Promise<void> | undefined;
  #abort: AbortController | undefined;
  #stopped = false;
  constructor(private readonly base: string, private readonly segments: readonly string[]) {
    if (!isAbsolute(base) || base.includes("\0") || segments.some((part) => !part || part === "." || part === ".." || part.includes("\0") || /[\\/]/u.test(part))) {
      throw new Error("Invalid runtime storage layout.");
    }
    this.segments = [...segments];
  }
  async getStatus(purpose: LocalMemoryRuntimePurpose = "private"): Promise<LocalMemoryRuntimeStatus> {
    if (!await this.#directories(false)) return "missing";
    try { await lstat(join(this.#parent(), installationNames[purpose])); return "present"; }
    catch (error) { if (missing(error)) return "missing"; throw error; }
  }
  async install(source: string, signal: AbortSignal, purpose: LocalMemoryRuntimePurpose = "private"): Promise<void> {
    if (this.#stopped || this.#pending) throw new Error("Runtime installer unavailable.");
    const abort = new AbortController(); this.#abort = abort;
    const combined = AbortSignal.any([signal, abort.signal]);
    const pending = (async () => {
      combined.throwIfAborted();
      await this.#directories(true);
      await installOpenVikingRuntime({ source, parent: this.#parent(), signal: combined, purpose });
    })();
    this.#pending = pending;
    try { await pending; } finally { this.#pending = undefined; this.#abort = undefined; }
  }
  async stop(): Promise<void> {
    this.#stopped = true; this.#abort?.abort();
    try { await this.#pending; } catch { /* The operation caller observes its failure. */ }
  }
  #parent() { return join(this.base, ...this.segments, "runtime"); }
  async #directories(create: boolean): Promise<boolean> {
    let path = this.base;
    for (const segment of ["", ...this.segments, "runtime"]) {
      if (segment) path = join(path, segment);
      let entry;
      try { entry = await lstat(path); }
      catch (error) {
        if (!missing(error)) throw error;
        if (!create) return false;
        // Never create an unknown base or recursively walk through unchecked links.
        if (!segment) throw new Error("Runtime base is missing.");
        try { await mkdir(path, { mode: 0o700 }); } catch (cause) { if (!exists(cause)) throw cause; }
        entry = await lstat(path);
      }
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== process.getuid?.() || (entry.mode & 0o022) !== 0) {
        throw new Error("Unsafe runtime storage directory.");
      }
    }
    return true;
  }
}
function missing(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
function exists(error: unknown) { return error instanceof Error && "code" in error && error.code === "EEXIST"; }
