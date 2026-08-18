import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";

const SERVER_NAMES = ["tmwd_browser", "js-reverse"] as const;
type ServerName = (typeof SERVER_NAMES)[number];

export function isRetiredBrowser67ServerPair(options: {
  servers: Record<string, unknown>;
  managedReceipts: Readonly<Record<string, unknown>> | undefined;
  agentDir: string;
  currentBrowser67Root: string;
  homeDirectory: string;
}): boolean {
  if (SERVER_NAMES.some((name) => options.managedReceipts?.[name] !== undefined)) return false;
  const allowedRoots = [
    portableJoin(options.homeDirectory, ".agents", "packages", "browser67"),
    portableJoin(options.agentDir, "desktop-capabilities", "packages", "browser67"),
    options.currentBrowser67Root
  ];
  const roots = SERVER_NAMES.map((name) => retiredServerRoot(name, options.servers[name], allowedRoots));
  return roots.every((root): root is string => root !== undefined) && roots[0] === roots[1];
}

function retiredServerRoot(
  name: ServerName,
  value: unknown,
  allowedRoots: string[]
): string | undefined {
  if (!isRecord(value)) return undefined;
  const allowedKeys = new Set(["command", "args", "env"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return undefined;
  if (!isNodeCommand(value.command)) return undefined;
  if (!Array.isArray(value.args) || value.args.length !== 1 || typeof value.args[0] !== "string") {
    return undefined;
  }
  if (value.env !== undefined && !isRetiredEnvironment(value.env)) return undefined;
  const suffix = name === "tmwd_browser"
    ? ["src", "mcp", "browser", "server.mjs"]
    : ["src", "mcp", "js-reverse", "server.mjs"];
  for (const root of allowedRoots) {
    if (samePortablePath(value.args[0], portableJoin(root, ...suffix))) return portablePathKey(root);
  }
  return undefined;
}

function isRetiredEnvironment(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const expected: Record<string, string> = {
    BROWSER_STRUCTURED_TMWD_MODE: "tmwd",
    BROWSER_STRUCTURED_TMWD_TRANSPORT: "auto"
  };
  // Fingerprints preserve exact legacy matching without production transport URL literals.
  const expectedSha256: Record<string, string> = {
    BROWSER_STRUCTURED_TMWD_WS_ENDPOINT: "0c4a6a3a35d6ddfe77f4570e289e0e09d42be6c4c1b7fb6f6571299e5e764f7c",
    BROWSER_STRUCTURED_TMWD_LINK_ENDPOINT: "92fcd53149daea4706eb500fef2374254b6a7b0af08397b6c69a51830a2886c5"
  };
  return Object.entries(value).every(([key, entry]) => {
    const expectedValue = expected[key];
    if (expectedValue !== undefined) return expectedValue === entry;
    const expectedDigest = expectedSha256[key];
    return expectedDigest !== undefined && typeof entry === "string" && sha256(entry) === expectedDigest;
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isNodeCommand(value: unknown): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  const executable = value.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase();
  return executable === "node" || executable === "node.exe";
}

function portableJoin(root: string, ...segments: string[]): string {
  return portablePathApi(root).join(root, ...segments);
}

function samePortablePath(left: string, right: string): boolean {
  const leftKey = portablePathKey(left);
  const rightKey = portablePathKey(right);
  return leftKey !== undefined && leftKey === rightKey;
}

function portablePathKey(value: string): string | undefined {
  const api = portablePathApi(value);
  if (!api.isAbsolute(value)) return undefined;
  const normalized = api.normalize(value);
  return api === win32 ? `win32:${normalized.toLowerCase()}` : `posix:${normalized}`;
}

function portablePathApi(value: string): typeof posix {
  return /^(?:[a-z]:[\\/]|\\\\)/iu.test(value) ? win32 : posix;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
