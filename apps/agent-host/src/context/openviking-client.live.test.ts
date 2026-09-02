import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { deriveWorkspacePeerId } from "./context-memory-support.js";
import { OpenVikingClient } from "./openviking-client.js";

const liveEnabled = process.env.PI67_OPENVIKING_LIVE === "1";

describe.runIf(liveEnabled)("OpenVikingClient live contract", () => {
  it("authenticates the data plane and reads a real Session without exposing credentials", async () => {
    const endpoint = requiredEnvironment("PI67_OPENVIKING_LIVE_ENDPOINT");
    const workspace = requiredEnvironment("PI67_OPENVIKING_LIVE_WORKSPACE");
    const sessionId = requiredEnvironment("PI67_OPENVIKING_LIVE_SESSION_ID");
    const configuration = {
      ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION,
      revision: "live-contract",
      endpoint,
      healthTimeoutMs: 3_000,
      recallTimeoutMs: 3_000
    };
    const actorPeerId = deriveWorkspacePeerId(workspace);
    const client = new OpenVikingClient(configuration, actorPeerId);

    await expect(client.health()).resolves.toMatchObject({
      version: expect.stringMatching(/^v?0\.4\.16$/),
      latencyMs: expect.any(Number)
    });
    await expect(client.getSession(sessionId)).resolves.toMatchObject({
      session_id: sessionId,
      total_message_count: expect.any(Number)
    });
    expect(actorPeerId).toMatch(/^[a-f0-9]{64}$/);

    if (process.env.PI67_OPENVIKING_LIVE_COMMIT === "1") {
      await expect(client.commitSession(sessionId)).resolves.toMatchObject({
        status: "accepted",
        archived: true,
        task_id: expect.any(String),
        archive_uri: expect.stringContaining("/history/archive_")
      });
    }

    const query = process.env.PI67_OPENVIKING_LIVE_QUERY?.trim();
    if (query) {
      const targetUri = process.env.PI67_OPENVIKING_LIVE_TARGET_URI?.trim()
        || `viking://user/peers/${actorPeerId}/memories`;
      const expectedUriFragment = process.env.PI67_OPENVIKING_LIVE_EXPECTED_URI_FRAGMENT?.trim()
        || `/peers/${actorPeerId}/memories/`;
      const memories = await client.search(query, {
        limit: 5,
        scope: targetUri === "viking://user/memories" ? "user" : "workspace",
        targetUri
      });
      expect(memories).toEqual(expect.arrayContaining([
        expect.objectContaining({
          uri: expect.stringContaining(expectedUriFragment),
          score: expect.any(Number)
        })
      ]));
      await expect(client.read(memories[0]!.uri)).resolves.toEqual(expect.any(String));

      const forgetUris = parseForgetUris(process.env.PI67_OPENVIKING_LIVE_FORGET_URIS);
      if (forgetUris.length > 0) {
        const expectedContent = requiredEnvironment("PI67_OPENVIKING_LIVE_EXPECTED_CONTENT");
        const matchingBeforeForget: string[] = [];
        for (const memory of memories) {
          const content = await client.read(memory.uri);
          if (content.includes(expectedContent)) matchingBeforeForget.push(memory.uri);
        }
        expect(new Set(matchingBeforeForget)).toEqual(new Set(forgetUris));
        for (const uri of forgetUris) await client.forget(uri);
        for (const uri of forgetUris) await expect(client.read(uri)).rejects.toMatchObject({
          code: "RUNTIME_NOT_READY"
        });
        const afterForget = await client.search(query, {
          limit: 5,
          scope: targetUri === "viking://user/memories" ? "user" : "workspace",
          targetUri
        });
        const remainingContent = afterForget.map((memory) => memory.abstract);
        expect(remainingContent.some((content) => content.includes(expectedContent))).toBe(false);
      }
    }
  }, 30_000);
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live OpenViking contract.`);
  return value;
}

function parseForgetUris(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const values = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (values.some((uri) => !uri.startsWith("viking://user/") || !uri.includes("/memories/"))) {
    throw new Error("PI67_OPENVIKING_LIVE_FORGET_URIS accepts private Memory URIs only.");
  }
  return [...new Set(values)];
}
