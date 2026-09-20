import { mkdtemp, readFile, rm, writeFile, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import { awaitWebAction } from "./shared-knowledge-live-web.js";
import { liveWebRemainingMs } from "./shared-knowledge-live-fixture.js";

const roots = [];
// The live runner is macOS-only; these tests exercise POSIX ownership/mode bits.
const posixIt = it.skipIf(process.platform === "win32");
const identity = { teamId: "team", projectId: "project", candidateId: "candidate" };
async function directory() { const root = await mkdtemp(join(tmpdir(), "newmoney-web-gate-")); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it("uses only the remaining Server window, never a per-phase renewal", () => {
  expect(liveWebRemainingMs(1000, 201000)).toBe(400000);
  expect(liveWebRemainingMs(1000, 601000)).toBe(0);
  expect(liveWebRemainingMs(1000, 701000)).toBe(0);
  expect(liveWebRemainingMs(2000, 1000)).toBe(600000);
});

posixIt("emits only non-sensitive identity and requires fresh exact completion", async () => {
  const root = await directory();
  const pending = awaitWebAction(root, "publish", identity, AbortSignal.timeout(2000));
  let ready;
  for (let i = 0; i < 30 && !ready; i++) {
    try { ready = await readFile(join(root, "web-publish-ready.json"), "utf8"); } catch { await delay(10); }
  }
  expect(JSON.parse(ready)).toEqual({ phase: "publish", ...identity });
  await writeFile(join(root, "web-publish-done.txt"), "done\n", { mode: 0o600 });
  await expect(pending).resolves.toBeUndefined();
  await expect(awaitWebAction(root, "publish", identity, AbortSignal.timeout(1000))).rejects.toThrow("reuse");
});

posixIt("refuses non-private directories and symlinked completion", async () => {
  const root = await directory();
  await chmod(root, 0o755);
  await expect(awaitWebAction(root, "revoke", identity, AbortSignal.timeout(1000))).rejects.toThrow("Unsafe");
  await chmod(root, 0o700);
  await symlink(join(root, "missing"), join(root, "web-revoke-done.txt"));
  await expect(awaitWebAction(root, "revoke", identity, AbortSignal.timeout(1000))).rejects.toThrow("reuse");
});

posixIt("fails boundedly without a browser completion", async () => {
  const root = await directory();
  await expect(awaitWebAction(root, "logout", identity, AbortSignal.timeout(30))).rejects.toThrow();
});
