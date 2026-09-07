import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";
import { RuntimeProjectionController } from "./runtime-projection-controller.js";
import { RuntimeSessionTransitions } from "./runtime-session-transitions.js";
import { stageSessionImport } from "./session-import.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Session import data integrity", () => {
  it("migrates a legacy managed copy without changing the selected external source", async () => {
    const { root, cwd, source } = await fixture();
    const original = `${JSON.stringify(header(cwd, 2))}\n${JSON.stringify({
      type: "message", id: "legacy", parentId: null, timestamp: timestamp,
      message: { role: "hookMessage", content: "legacy content" }
    })}\n`;
    await writeFile(source, original);

    const imported = await stageSessionImport(source, join(root, "managed"), cwd);

    expect(imported.copied).toBe(true);
    expect(await readFile(source, "utf8")).toBe(original);
    const copied = await readFile(imported.path, "utf8");
    expect(JSON.parse(copied.split("\n")[0]!).version).toBe(3);
    expect(copied).toContain('"role":"custom"');
  });

  it("initializes an empty managed copy while preserving the empty external file", async () => {
    const { root, cwd, source } = await fixture();
    await writeFile(source, "");
    const imported = await stageSessionImport(source, join(root, "managed"), cwd);
    expect(await readFile(source, "utf8")).toBe("");
    expect((await stat(imported.path)).size).toBeGreaterThan(0);
  });

  it("discards an invalid copy without overwriting a preexisting managed file", async () => {
    const { root, cwd, source } = await fixture();
    const managed = join(root, "managed");
    await mkdir(managed);
    await writeFile(join(managed, "external.jsonl"), "existing managed bytes");
    await writeFile(source, "not a Pi session\n");
    await expect(stageSessionImport(source, managed, cwd)).rejects.toThrow();
    expect(await readFile(source, "utf8")).toBe("not a Pi session\n");
    expect(await readdir(managed)).toEqual(["external.jsonl"]);
    expect(await readFile(join(managed, "external.jsonl"), "utf8")).toBe("existing managed bytes");
  });

  it("preserves the final imported message through SDK writes and reopening when LF is missing", async () => {
    const { cwd, agentDir, source } = await fixture();
    const original = `${JSON.stringify(header(cwd))}\n${JSON.stringify({
      type: "message", id: "last-user", parentId: null, timestamp,
      message: { role: "user", content: "final original message", timestamp: 1 }
    })}`;
    await writeFile(source, original);
    const runtime = new PiSdkRuntime();
    try {
      await runtime.initialize({ cwd, agentDir, trust: "unknown", approvalMode: "guided" });
      const imported = await runtime.importSession(source);
      await runtime.setSessionName("Renamed import");
      const persisted = await readFile(imported.sessionPath!, "utf8");
      for (const line of persisted.trimEnd().split("\n")) expect(() => JSON.parse(line)).not.toThrow();
      const reopened = SessionManager.open(imported.sessionPath!, undefined, cwd);
      expect(reopened.getEntries()).toContainEqual(expect.objectContaining({ id: "last-user" }));
      expect(reopened.getEntries()).toContainEqual(expect.objectContaining({
        type: "session_info", name: "Renamed import"
      }));
      expect(await readFile(source, "utf8")).toBe(original);
    } finally {
      await runtime.dispose();
    }
  });

  it("retains the SDK-adopted file if post-switch projection binding fails", async () => {
    const { cwd, agentDir, source } = await fixture();
    const runtime = new PiSdkRuntime();
    try {
      await runtime.initialize({ cwd, agentDir, trust: "unknown", approvalMode: "guided" });
      const outgoing = runtime.getIdentity().sessionPath;
      vi.spyOn(RuntimeProjectionController.prototype, "bind")
        .mockRejectedValueOnce(new Error("post-switch binding failed"));
      await expect(runtime.importSession(source)).rejects.toThrow("post-switch binding failed");
      const adopted = runtime.getIdentity().sessionPath;
      expect(adopted).toBeTruthy();
      expect(adopted).not.toBe(outgoing);
      expect(adopted).not.toBe(source);
      expect((await stat(adopted!)).isFile()).toBe(true);
      expect(SessionManager.open(adopted!, undefined, cwd).getSessionId()).toBe("import-fixture");
      expect(await readFile(source, "utf8")).toBe(`${JSON.stringify(header(cwd))}\n`);
    } finally {
      await runtime.dispose();
    }
  });

  it("still discards an orphaned copy when switching is cancelled before adoption", async () => {
    const { root, cwd, agentDir, source } = await fixture();
    const managed = join(root, "managed");
    const commit = vi.fn();
    const transitions = new RuntimeSessionTransitions({
      getCwd: () => cwd,
      getAgentDir: () => agentDir,
      getSessionDirectory: () => managed,
      getActiveSessionPath: () => undefined,
      prepare: async () => undefined,
      switchSession: async () => ({ cancelled: true }),
      commit
    });
    await expect(transitions.import(source)).rejects.toThrow("cancelled");
    expect(await readdir(managed)).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
    expect((await stat(source)).isFile()).toBe(true);
  });
});

const timestamp = "2026-09-07T00:00:00.000Z";
function header(cwd: string, version = 3) {
  return { type: "session", version, id: "import-fixture", timestamp, cwd };
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pi67-sdk-import-integrity-")));
  roots.push(root);
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  const source = join(root, "external.jsonl");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  await writeFile(source, `${JSON.stringify(header(cwd))}\n`);
  return { root, cwd, agentDir, source };
}
