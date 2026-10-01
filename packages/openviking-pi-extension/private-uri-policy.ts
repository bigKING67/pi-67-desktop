import type { OVConfig } from "./config.js";

export interface AuthorizedPrivateUri {
  ok: true;
  uri: string;
}

export interface RejectedPrivateUri {
  ok: false;
  reason: string;
}

export type PrivateUriDecision = AuthorizedPrivateUri | RejectedPrivateUri;

const MAX_URI_CHARS = 2_048;
const SAFE_IDENTITY_SEGMENT = /^[A-Za-z0-9_-]+$/u;

/** Reserved user-root children that OpenViking 0.4.17+ rejects without an explicit uid. */
const USER_RESERVED = new Set(["memories", "resources", "skills", "peers", "privacy", "sessions"]);

/** `viking://user/<uid>` when the identity is known, else the server-expanded `viking://~`. */
function userRoot(config: Pick<OVConfig, "user">): string {
  return safeIdentity(config.user) ? `viking://user/${config.user}` : "viking://~";
}

export function defaultPrivateMemoryScope(config: Pick<OVConfig, "user" | "peerId">): string {
  return config.peerId
    ? `${userRoot(config)}/peers/${config.peerId}/memories`
    : `${userRoot(config)}/memories`;
}

export function resolvePrivateMemoryScope(
  value: unknown,
  config: Pick<OVConfig, "user" | "peerId">,
): PrivateUriDecision {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw === "workspace") {
    return authorizePrivateMemoryUri(defaultPrivateMemoryScope(config), config);
  }
  if (raw === "user") return authorizePrivateMemoryUri(`${userRoot(config)}/memories`, config);
  return authorizePrivateMemoryUri(raw, config);
}

export function authorizePrivateMemoryUri(
  value: unknown,
  config: Pick<OVConfig, "user" | "peerId">,
): PrivateUriDecision {
  const raw = typeof value === "string" ? value.trim().replace(/\/+$/u, "") : "";
  const segments = canonicalUserSegments(safeVikingSegments(raw), config);
  if (!segments) return reject("A canonical viking:// private Memory URI is required.");

  const roots = authorizedRoots(config);
  const allowed = roots.some((root) => isWithin(segments, root));
  if (!allowed) {
    return reject("The URI is outside the current user/current Workspace private Memory boundary.");
  }
  return { ok: true, uri: `viking://${segments.join("/")}` };
}

export function isAuthorizedPrivateMemoryUri(
  value: unknown,
  config: Pick<OVConfig, "user" | "peerId">,
): boolean {
  return authorizePrivateMemoryUri(value, config).ok;
}

export function isPrivateMemoryRoot(
  value: unknown,
  config: Pick<OVConfig, "user" | "peerId">,
): boolean {
  const decision = authorizePrivateMemoryUri(value, config);
  if (!decision.ok) return false;
  const segments = safeVikingSegments(decision.uri);
  return Boolean(segments && authorizedRoots(config).some((root) => sameSegments(segments, root)));
}

function authorizedRoots(config: Pick<OVConfig, "user" | "peerId">): string[][] {
  const base = safeIdentity(config.user) ? ["user", config.user] : ["~"];
  const roots: string[][] = [[...base, "memories"]];
  if (safeIdentity(config.peerId)) roots.push([...base, "peers", config.peerId, "memories"]);
  return roots;
}

/**
 * Model- or legacy-supplied uid-less paths (`viking://user/memories/...`) are
 * rewritten to the current user's canonical root before authorization, so a
 * stale prompt still resolves inside the same boundary instead of a server 400.
 */
function canonicalUserSegments(segments: string[] | null, config: Pick<OVConfig, "user">): string[] | null {
  if (!segments || segments[0] !== "user" || !USER_RESERVED.has(segments[1] ?? "")) return segments;
  const base = safeIdentity(config.user) ? ["user", config.user] : ["~"];
  return [...base, ...segments.slice(1)];
}

function safeVikingSegments(uri: string): string[] | null {
  if (!uri.startsWith("viking://") || uri.length > MAX_URI_CHARS) return null;
  if (/[\\?#]/u.test(uri) || hasControlCharacter(uri)) return null;
  const path = uri.slice("viking://".length);
  if (!path || path.includes("//")) return null;
  const segments = path.split("/");
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      !decoded
      || decoded === "."
      || decoded === ".."
      || decoded.includes("\\")
      || decoded.includes("/")
      || hasControlCharacter(decoded)
    ) {
      return null;
    }
  }
  return segments;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function isWithin(value: readonly string[], root: readonly string[]): boolean {
  return value.length >= root.length && root.every((segment, index) => value[index] === segment);
}

function sameSegments(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function safeIdentity(value: string): boolean {
  return SAFE_IDENTITY_SEGMENT.test(value);
}

function reject(reason: string): RejectedPrivateUri {
  return { ok: false, reason };
}
