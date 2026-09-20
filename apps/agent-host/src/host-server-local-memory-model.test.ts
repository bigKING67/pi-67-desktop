import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";

it("resolves a parent-only model through the Host's real Pi configuration without loading an Agent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-host-memory-model-"));
  const agentDir = join(root, "agent"); await mkdir(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("PI67_STORAGE_ROOT", root);
  vi.stubEnv("PI67_SESSION_CATALOG_DIR", join(root, "catalog"));
  let server: AgentHostServer | undefined;
  try {
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "memory-fixture": {
      api: "openai-completions", baseUrl: "https://example.invalid/v1", models: [{ id: "extract", input: ["text"], reasoning: false }]
    } } }));
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "memory-fixture": { type: "api_key", key: "synthetic-private-key" } }));
    const runtimeLoader = vi.fn(async () => { throw new Error("Agent Runtime must not load."); });
    server = new AgentHostServer(runtimeLoader, { agentDir });
    const reply = vi.fn();
    const request = { type: "local-memory-extraction-resolve", requestId: "parent-one", selection: { provider: "memory-fixture", model: "extract" } };
    expect(server.localMemoryModels.handleMessage(request, reply)).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ type: "local-memory-extraction-result", requestId: "parent-one", ok: true,
      model: { protocol: "openai-compatible", endpoint: "https://example.invalid/v1", model: "extract", apiKey: "synthetic-private-key" }
    }), { timeout: 5_000 });
    expect(runtimeLoader).not.toHaveBeenCalled();
    await server.shutdown();
    server.localMemoryModels.handleMessage({ ...request, requestId: "after-shutdown" }, reply);
    expect(reply).toHaveBeenCalledTimes(1);
  } finally {
    try { await server?.shutdown(); } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
  }
}, 15_000);
