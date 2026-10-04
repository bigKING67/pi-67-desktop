import { execFile } from "node:child_process";
import { createHash, type KeyObject } from "node:crypto";
import { lstat, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { lt, valid } from "semver";
import type { LocalMemoryRuntimePurpose } from "@pi67/protocol";
import { loadOpenVikingRuntimeInstallation, readOpenVikingMetadata } from "./openviking-runtime-installation.js";
import { verifyOpenVikingManifest } from "./openviking-runtime-manifest.mjs";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";
import { admitOpenVikingRuntime } from "./openviking-runtime-admission.js";
import { openVikingRuntimeTrustedKey } from "./openviking-runtime-trust.js";
import { OPENVIKING_INSTALLATION_NAME, OPENVIKING_TEAM_INSTALLATION_NAME, OPENVIKING_QUERY_INSTALLATION_NAME } from "./openviking-runtime-installer.js";

const names = { private: OPENVIKING_INSTALLATION_NAME, "team-index-v1": OPENVIKING_TEAM_INSTALLATION_NAME,
  "team-query-v1": OPENVIKING_QUERY_INSTALLATION_NAME };
const pattern = /^openviking-(\d+\.\d+\.\d+)-python-3\.12\.10-sdk-0\.1\.10-darwin-arm64(-team-index-v1|-team-query-v1)?$/u;
const exec = promisify(execFile);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
interface Receipt { schema: "new-money.runtime-retirement.v1"; state: "pending";
  replacement: string; replacementTree: string; manifestHash: string; dev: number; ino: number }

/** Main-owned single-instance maintenance. Only actual success callers invoke this;
 * preparation/admission is not success. Failures are observable but never fail a query.
 * Old metadata is retained so interrupted recursive payload removal is resumable. */
export class OpenVikingRuntimeRetirement {
  #queue = Promise.resolve();
  #done = new Set<LocalMemoryRuntimePurpose>();
  #scheduled = new Set<LocalMemoryRuntimePurpose>();
  #stopped = false;
  #abort = new AbortController();
  constructor(private readonly parent: string, private readonly options: {
    trustedKey?: KeyObject;
    inUse?(this: void, path: string): Promise<boolean>;
    removePayload?(this: void, path: string): Promise<void>;
    report?(purpose: LocalMemoryRuntimePurpose, status: "completed" | "deferred"): void;
  } = {}) {}

  verified(purpose: LocalMemoryRuntimePurpose, tree: string): void {
    if (this.#stopped || this.#done.has(purpose) || this.#scheduled.has(purpose)) return;
    this.#scheduled.add(purpose);
    this.#queue = this.#queue.then(async () => {
      if (this.#stopped || this.#done.has(purpose)) return;
      let status: "completed" | "deferred" = "deferred";
      try {
        if (await this.#retire(purpose, tree)) { this.#done.add(purpose); status = "completed"; }
      } catch { /* Report fixed status only; never emit paths, credentials or raw errors. */ }
      try {
        if (this.options.report) this.options.report(purpose, status);
        else console.info("[openviking-retirement]", purpose, status);
      } catch { /* Diagnostic observers cannot reject business operations. */ }
    }).finally(() => { this.#scheduled.delete(purpose); });
  }
  async stop(): Promise<void> { this.#stopped = true; this.#abort.abort(); await this.#queue; }
  async settled(): Promise<void> { await this.#queue; }

  async #retire(purpose: LocalMemoryRuntimePurpose, expectedTree: string): Promise<boolean> {
    if (process.platform !== "darwin" || process.arch !== "arm64") return false;
    const signal = AbortSignal.any([this.#abort.signal, AbortSignal.timeout(60_000)]), key = this.options.trustedKey ?? openVikingRuntimeTrustedKey();
    await ownedDirectory(this.parent);
    const currentName = names[purpose], current = join(this.parent, currentName);
    const admitted = await admitOpenVikingRuntime(await loadOpenVikingRuntimeInstallation(current, signal), key, signal);
    if (admitted.tree.sha256 !== expectedTree) throw new Error("Replacement changed.");
    const currentMatch = pattern.exec(currentName)!;
    let complete = true;
    for (const name of await readdir(this.parent)) {
      const match = pattern.exec(name);
      if (!match || (match[2] ?? "") !== (currentMatch[2] ?? "") || !valid(match[1]) || !lt(match[1]!, currentMatch[1]!)) continue;
      if (this.#stopped) return false;
      signal.throwIfAborted();
      const directory = join(this.parent, name);
      try {
        const identity = await ownedDirectory(directory);
        const children = await readdir(directory);
        if (children.some(child => !["runtime", "manifest.json", "manifest.sig", "retirement.json"].includes(child))) throw new Error("Unknown installation members.");
        const manifest = await metadata(join(directory, "manifest.json"), 8192);
        const signature = await metadata(join(directory, "manifest.sig"), 64);
        const parsed = JSON.parse(manifest.toString("utf8")) as { treeSha256: string };
        verifyOpenVikingManifest(manifest, signature, key, { platform: "darwin", arch: "arm64", pythonVersion: "3.12.10",
          sdkVersion: "0.1.10", openvikingVersion: match[1]!, treeSha256: parsed.treeSha256 });
        if (!children.includes("runtime") && children.includes("retirement.json")) continue;
        const receiptPath = join(directory, "retirement.json");
        let receipt: Receipt | undefined;
        try { receipt = JSON.parse((await metadata(receiptPath, 4096)).toString("utf8")) as Receipt; }
        catch (error) { if (!missing(error)) throw error; }
        if (receipt) {
          if (receipt.schema !== "new-money.runtime-retirement.v1" || receipt.state !== "pending"
              || receipt.replacement !== currentName || receipt.replacementTree !== expectedTree
              || receipt.manifestHash !== hash(manifest) || receipt.dev !== identity.dev || receipt.ino !== identity.ino) throw new Error("Retirement identity mismatch.");
        } else {
          const tree = await runtimeTreeIdentity(join(directory, "runtime"), signal);
          if (tree.sha256 !== parsed.treeSha256) throw new Error("Old runtime drifted.");
        }
        if (await (this.options.inUse ?? runtimeInUse)(directory)) { complete = false; continue; }
        const check = await ownedDirectory(directory);
        if (check.dev !== identity.dev || check.ino !== identity.ino
            || hash(await metadata(join(directory, "manifest.json"), 8192)) !== hash(manifest)) throw new Error("Installation changed.");
        // Receipt is durable before deletion. A torn update fails closed, retaining metadata.
        if (!receipt) {
          receipt = { schema: "new-money.runtime-retirement.v1", state: "pending", replacement: currentName,
            replacementTree: expectedTree, manifestHash: hash(manifest), dev: identity.dev, ino: identity.ino };
          await writeFile(receiptPath, JSON.stringify(receipt), { flag: "wx", mode: 0o600, flush: true });
        }
        const payload = join(directory, "runtime");
        const payloadIdentity = await ownedDirectory(payload);
        const replacement = await admitOpenVikingRuntime(await loadOpenVikingRuntimeInstallation(current, signal), key, signal);
        if (replacement.tree.sha256 !== expectedTree) throw new Error("Replacement changed before retirement.");
        if (await (this.options.inUse ?? runtimeInUse)(directory)) { complete = false; continue; }
        const finalDirectory = await ownedDirectory(directory), finalPayload = await ownedDirectory(payload);
        if (finalDirectory.ino !== identity.ino || finalDirectory.dev !== identity.dev
            || finalPayload.ino !== payloadIdentity.ino || finalPayload.dev !== payloadIdentity.dev) throw new Error("Retirement target changed.");
        signal.throwIfAborted();
        await (this.options.removePayload ?? (path => rm(path, { recursive: true, force: true })))(payload);
        // Keep the pending receipt immutable: a separate marker is unnecessary; missing
        // payload plus this receipt is already a completed, resumable retirement.
      } catch { complete = false; }
    }
    return complete;
  }
}
async function ownedDirectory(path: string) {
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path
      || entry.uid !== process.getuid?.() || (entry.mode & 0o022) !== 0) throw new Error("Unsafe runtime directory.");
  return entry;
}
function metadata(path: string, limit: number) {
  return readOpenVikingMetadata(path, limit, AbortSignal.timeout(5_000));
}
function missing(error: unknown) { return error instanceof Error && "code" in error && error.code === "ENOENT"; }
async function runtimeInUse(path: string): Promise<boolean> {
  try {
    await exec("/usr/sbin/lsof", ["-nP", "+D", path], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 1
        && "stdout" in error && error.stdout === "" && "stderr" in error && error.stderr === "") return false;
    throw new Error("Runtime occupancy unknown.");
  }
}
