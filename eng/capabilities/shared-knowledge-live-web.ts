import assert from "node:assert/strict";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Test-only operator rendezvous. Markers trigger independent HTTP/native checks;
 * they are never publication/revocation proof or production authorization. */
export async function awaitWebAction(
  directory: string,
  phase: "publish" | "revoke" | "logout",
  identity: { teamId: string; projectId: string; candidateId: string },
  signal: AbortSignal
) {
  assert.ok(isAbsolute(directory));
  const root = await lstat(directory);
  assert.ok(root.isDirectory() && !root.isSymbolicLink() && (root.mode & 0o077) === 0 && root.uid === process.getuid?.(), "Unsafe Web control directory");
  const complete = join(directory, `web-${phase}-done.txt`);
  let existing = false;
  try { await lstat(complete); existing = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  assert.ok(!existing, "Web action cannot reuse a completion marker");
  signal.throwIfAborted();
  await writeFile(join(directory, `web-${phase}-ready.json`), JSON.stringify({ phase, ...identity }), { flag: "wx", mode: 0o600 });
  while (true) {
    signal.throwIfAborted();
    try {
      const info = await lstat(complete);
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.size === 5 && (info.mode & 0o077) === 0 && info.uid === process.getuid?.(), "Unsafe Web completion marker");
      assert.equal(await readFile(complete, "utf8"), "done\n", "Web action failed");
      signal.throwIfAborted();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await delay(100, undefined, { signal });
  }
}
