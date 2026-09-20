import { SessionManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { expect, it, vi } from "vitest";
import { initializePrivateMemoryProvenance, markSharedMemoryProvenance } from "./session-memory-provenance.js";
import { SessionSemanticTitleGenerator } from "./session-semantic-title.js";

function fixture(manager: SessionManager) {
  const completeSimple = vi.fn(async () => ({ content: [{ type: "text", text: "会话标题" }] }));
  const persistProjection = vi.fn(async () => undefined);
  const session = { sessionManager: manager, model: { provider: "fixture", id: "fixture", maxTokens: 128 },
    modelRuntime: { completeSimple } } as unknown as AgentSession;
  return { session, completeSimple, persistProjection,
    generator: new SessionSemanticTitleGenerator({ isCurrent: () => true, persistProjection }) };
}

it.each(["shared", "rewound-shared", "unknown", "malformed", "shared-tool"])(
  "never sends %s history for automatic or manual model titles", async (kind) => {
    const manager = SessionManager.inMemory("/workspace");
    if (kind !== "unknown") initializePrivateMemoryProvenance(manager);
    manager.appendMessage({ role: "user", content: "fixture context", timestamp: 1 });
    const leaf = manager.getLeafId()!;
    if (kind === "shared" || kind === "rewound-shared") markSharedMemoryProvenance(manager);
    if (kind === "rewound-shared") manager.branch(leaf);
    if (kind === "malformed") manager.appendCustomEntry("pi67.memory-provenance.v1", null);
    if (kind === "shared-tool") manager.appendMessage({ role: "toolResult", toolCallId: "fixture",
      toolName: "viking_shared_read", content: [{ type: "text", text: "shared" }], isError: false, timestamp: 2 });
    const { session, generator, completeSimple, persistProjection } = fixture(manager);
    const before = manager.getEntries();
    await expect(generator.generate(session, 1, "automatic")).resolves.toEqual({ kind: "skipped", reason: "unverified-memory" });
    await expect(generator.generate(session, 1, "manual")).rejects.toThrow("verified private");
    expect(completeSimple).not.toHaveBeenCalled();
    expect(persistProjection).not.toHaveBeenCalled();
    expect(manager.getEntries()).toEqual(before);
  }
);
