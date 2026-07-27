import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSdkRuntime } from "./pi-sdk-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

describe("PiSdkRuntime Snapshot hot paths", () => {
  it("does not rebuild a full projection after compact or abort", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-sdk-hot-path-"));
    temporaryDirectories.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await Promise.all([mkdir(cwd), mkdir(agentDir)]);

    const runtime = new PiSdkRuntime();
    try {
      await runtime.initialize({
        cwd,
        agentDir,
        trust: "unknown",
        approvalMode: "guided"
      });
      const session = activeSession(runtime);
      const compact = vi.spyOn(session, "compact").mockResolvedValue({
        summary: "summary",
        firstKeptEntryId: "entry-1",
        tokensBefore: 1
      });
      const abort = vi.spyOn(session, "abort").mockResolvedValue(undefined);
      const getSnapshot = vi.spyOn(runtime, "getSnapshot");

      await runtime.compact("Keep the current task summary.");
      await runtime.abort();

      expect(compact).toHaveBeenCalledWith("Keep the current task summary.");
      expect(abort).toHaveBeenCalledOnce();
      expect(getSnapshot).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  }, 15_000);
});

function activeSession(runtime: PiSdkRuntime): AgentSession {
  const internals = runtime as unknown as {
    sessionBindings: { requireSession(): AgentSession };
  };
  return internals.sessionBindings.requireSession();
}
