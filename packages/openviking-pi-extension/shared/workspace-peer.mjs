// Adapted from examples/memory-plugin-shared/lib for Pi-67 workspace isolation.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export function deriveWorkspacePeerId(cwd) {
  const input = String(cwd || "").trim();
  if (!input) return "";
  let canonical = resolve(input);
  try {
    canonical = realpathSync.native(canonical);
  } catch {
    // The fingerprint remains deterministic for a workspace not created yet.
  }
  if (process.platform === "win32") canonical = canonical.toLowerCase();
  return createHash("sha256").update(canonical).digest("hex");
}

export function resolveEffectivePeerId({ cfg = {}, cwd = "" } = {}) {
  const explicit = String(cfg.peerId || "").trim();
  if (explicit) return { peerId: explicit, source: "explicit" };

  if (cfg.workspacePeer !== false) {
    const peerId = deriveWorkspacePeerId(cwd);
    if (peerId) return { peerId, source: "workspace" };
  }

  return { peerId: "", source: "none" };
}
