import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { locateTeamQueryBootstrap, locateTeamWorkerBootstrap } from "./team-worker-bootstrap.js";

const roots: string[] = [];
it.skipIf(process.platform === "win32").each(["valid", "empty", "oversized", "symlink", "writable", "linked-parent"])("admits query bootstrap only at its fixed safe path: %s", async mode => {
  const { root } = await fixture(), signal = new AbortController().signal;
  await expect(locateTeamQueryBootstrap(root, signal)).rejects.toThrow();
  const directory = join(root, "newmoney-team/query/v1");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "team_query_worker.py");
  await writeFile(path, mode === "empty" ? "" : mode === "oversized" ? "x".repeat(65537) : "synthetic-source", { mode: 0o600 });
  if (mode === "symlink") { await rm(path); await symlink("../../v1/team_index_worker.py", path); }
  if (mode === "writable") await chmod(path, 0o666);
  if (mode === "linked-parent") {
    await rm(join(root, "newmoney-team/query"), { recursive: true });
    await symlink(".", join(root, "newmoney-team/query"));
  }
  if (mode === "valid") expect(await locateTeamQueryBootstrap(root, signal)).toBe(await realpath(path));
  else await expect(locateTeamQueryBootstrap(root, signal)).rejects.toThrow();
});
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "new-money-bootstrap-location-")); roots.push(root);
  const directory = join(root, "newmoney-team/v1");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of ["team_index_worker.py", "team_model_transport.py", "team_model_channel.py"]) {
    await writeFile(join(directory, name), "synthetic-source", { mode: 0o600 });
  }
  return { root, directory };
}

it.skipIf(process.platform === "win32")("selects only the fixed versioned bootstrap and requires every companion", async () => {
  const { root, directory } = await fixture();
  expect(await locateTeamWorkerBootstrap(root, new AbortController().signal)).toBe(await realpath(join(directory, "team_index_worker.py")));
  await rm(join(directory, "team_model_channel.py"));
  await expect(locateTeamWorkerBootstrap(root, new AbortController().signal)).rejects.toThrow();
});
it.skipIf(process.platform === "win32").each(["empty", "oversized", "symlink", "writable"])("rejects %s companion files after signed-tree admission", async (mode) => {
  const { root, directory } = await fixture();
  const path = join(directory, "team_model_transport.py");
  if (mode === "empty" || mode === "oversized") await writeFile(path, mode === "empty" ? "" : "x".repeat(65537));
  if (mode === "symlink") { await rm(path); await symlink("team_index_worker.py", path); }
  if (mode === "writable") await chmod(path, 0o666);
  await expect(locateTeamWorkerBootstrap(root, new AbortController().signal)).rejects.toThrow(/Invalid/u);
});
it("rejects cancellation before locating a bootstrap", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(locateTeamWorkerBootstrap("/does-not-exist", controller.signal)).rejects.toThrow();
});
