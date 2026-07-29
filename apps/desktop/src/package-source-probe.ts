import { spawn } from "node:child_process";
import {
  gitSourceCandidates,
  npmRegistryCandidates,
  type PackageNetworkSettings,
  type PackageNetworkSnapshot,
  type PackageSourceHealth
} from "@pi67/protocol";
import { publicToolchainStatus, type DesktopToolchain } from "./desktop-toolchain.js";

const SOURCE_PROBE_TIMEOUT_MS = 8_000;
const MAX_PROBE_OUTPUT_BYTES = 4_096;

export interface PackageSourceProbeOptions {
  toolchain: DesktopToolchain;
  settings: PackageNetworkSettings;
  fetcher: (input: string, init: RequestInit) => Promise<Response>;
  gitRunner?: (executable: string, url: string) => Promise<string>;
  now?: () => number;
}

export function unprobedPackageNetworkSnapshot(
  toolchain: DesktopToolchain,
  settings: PackageNetworkSettings
): PackageNetworkSnapshot {
  return {
    settings: structuredClone(settings),
    toolchain: publicToolchainStatus(toolchain),
    sources: [
      ...npmRegistryCandidates(settings).map((source): PackageSourceHealth => ({
        id: source.id,
        kind: "npm",
        role: source.role,
        url: source.url,
        status: "not-checked"
      })),
      ...gitSourceCandidates(settings).map((source): PackageSourceHealth => ({
        id: source.id,
        kind: "git",
        role: source.role,
        url: source.transportUrl,
        status: "not-checked"
      }))
    ]
  };
}

export async function probePackageSources(options: PackageSourceProbeOptions): Promise<PackageNetworkSnapshot> {
  const npm = npmRegistryCandidates(options.settings).map((source) => (
    probeNpmSource(source, options.fetcher)
  ));
  const git = gitSourceCandidates(options.settings).map((source) => (
    probeGitSource(
      source,
      options.toolchain,
      options.gitRunner ?? runGitProbe
    )
  ));
  return {
    settings: structuredClone(options.settings),
    toolchain: publicToolchainStatus(options.toolchain),
    sources: await Promise.all([...npm, ...git]),
    checkedAt: (options.now ?? Date.now)()
  };
}

async function probeNpmSource(
  source: ReturnType<typeof npmRegistryCandidates>[number],
  fetcher: PackageSourceProbeOptions["fetcher"]
): Promise<PackageSourceHealth> {
  const startedAt = performance.now();
  try {
    const response = await fetcher(`${source.url}/-/ping`, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(SOURCE_PROBE_TIMEOUT_MS),
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      id: source.id,
      kind: "npm",
      role: source.role,
      url: source.url,
      status: "reachable",
      latencyMs: elapsedMilliseconds(startedAt)
    };
  } catch (error) {
    return {
      id: source.id,
      kind: "npm",
      role: source.role,
      url: source.url,
      status: "unreachable",
      latencyMs: elapsedMilliseconds(startedAt),
      detail: boundedError(error)
    };
  }
}

async function probeGitSource(
  source: ReturnType<typeof gitSourceCandidates>[number],
  toolchain: DesktopToolchain,
  runner: NonNullable<PackageSourceProbeOptions["gitRunner"]>
): Promise<PackageSourceHealth> {
  if (!toolchain.ready || !toolchain.gitExecutable) {
    return {
      id: source.id,
      kind: "git",
      role: source.role,
      url: source.transportUrl,
      status: "not-checked",
      detail: "Desktop private Git is unavailable."
    };
  }
  const startedAt = performance.now();
  try {
    const revision = await runner(toolchain.gitExecutable, source.transportUrl);
    return {
      id: source.id,
      kind: "git",
      role: source.role,
      url: source.transportUrl,
      status: "reachable",
      latencyMs: elapsedMilliseconds(startedAt),
      ...(revision.length === 40 ? { resolvedRevision: revision } : {})
    };
  } catch (error) {
    return {
      id: source.id,
      kind: "git",
      role: source.role,
      url: source.transportUrl,
      status: "unreachable",
      latencyMs: elapsedMilliseconds(startedAt),
      detail: boundedError(error)
    };
  }
}

function runGitProbe(executable: string, url: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, ["ls-remote", "--exit-code", url, "HEAD"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never"
      }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Git source probe timed out."));
    }, SOURCE_PROBE_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_PROBE_OUTPUT_BYTES) stdout += String(chunk).slice(0, MAX_PROBE_OUTPUT_BYTES - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_PROBE_OUTPUT_BYTES) stderr += String(chunk).slice(0, MAX_PROBE_OUTPUT_BYTES - stderr.length);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Bundled Git exited with ${signal ?? code}: ${(stderr || stdout).trim()}`));
        return;
      }
      const revision = stdout.trim().split(/\s+/u)[0] ?? "";
      resolvePromise(/^[0-9a-f]{40}$/u.test(revision) ? revision : "");
    });
  });
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/gu, " ").slice(0, 500);
}
