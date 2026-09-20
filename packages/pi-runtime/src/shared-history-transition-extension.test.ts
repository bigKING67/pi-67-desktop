import { SessionManager, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createDesktopSessionServices } from "./session-services.js";
import { initializePrivateMemoryProvenance, markSharedMemoryProvenance } from "./session-memory-provenance.js";

it("the installed Pi runner returns explicit cancellation for manual and automatic compaction of rewound shared history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-shared-transition-"));
  const manager = SessionManager.inMemory(root);
  initializePrivateMemoryProvenance(manager);
  const privateLeaf = manager.getLeafId()!;
  const services = await createDesktopSessionServices({ cwd: root, agentDir: join(root, "agent"),
    getSafety: () => ({ cwd: root, trust: "unknown", approvalMode: "guided", taskToolMode: "ask" }),
    requestApproval: async () => ({ status: "denied" }) });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: manager });
  try {
    await session.bindExtensions({ mode: "rpc" });
    const event = { type: "session_before_compact", reason: "manual", preparation: {}, branchEntries: [],
      willRetry: false, signal: new AbortController().signal } as const;
    expect(await session.extensionRunner.emit(event as never)).toBeUndefined();
    markSharedMemoryProvenance(manager);
    manager.branch(privateLeaf);
    for (const reason of ["manual", "threshold", "overflow"]) {
      expect(await session.extensionRunner.emit({ ...event, reason } as never)).toEqual({ cancel: true });
    }
  } finally { session.dispose(); await rm(root, { recursive: true, force: true }); }
});
