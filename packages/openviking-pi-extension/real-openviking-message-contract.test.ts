import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OVClient } from "./client.js";
import type { OVConfig } from "./config.js";

const realLabEnabled = process.env.PI67_TEST_REAL_OPENVIKING === "1";

describe.skipIf(!realLabEnabled)("real OpenViking v0.4.16 message identity contract", () => {
  it("round-trips stable source identity without committing or extracting Memory", async () => {
    const path = process.env.OPENVIKING_CLI_CONFIG_FILE
      ?? join(homedir(), ".openviking", "ovcli.conf");
    const metadata = await stat(path);
    expect(metadata.mode & 0o077).toBe(0);
    const credentials = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    const endpoint = text(credentials.url).replace(/\/+$/u, "");
    const url = new URL(endpoint);
    expect(["127.0.0.1", "localhost", "::1", "[::1]"]).toContain(url.hostname);
    const apiKey = text(credentials.api_key);
    expect(apiKey.length).toBeGreaterThan(0);

    const client = new OVClient({
      enabled: true,
      endpoint,
      apiKey,
      account: text(credentials.account) || text(credentials.account_id),
      user: text(credentials.user) || text(credentials.user_id),
      peerId: text(credentials.actor_peer_id) || text(credentials.peer_id),
      userAgent: "openviking-memory-pi/real-contract",
      healthTimeoutMs: 2_000,
      commitKeepRecentCount: 10,
    } as OVConfig);
    const sessionId = `pi67-extension-contract-${randomUUID()}`;
    try {
      await expect(client.health()).resolves.toBe(true);
      await expect(client.createSession(sessionId)).resolves.toBe(true);
      await expect(client.addMessagePayload(sessionId, payload("user", "source-user", "user_query"))).resolves.toBe(true);
      await expect(client.addMessagePayload(sessionId, payload("assistant", "source-assistant", "assistant_step"))).resolves.toBe(true);

      const context = await client.getSessionContext(sessionId, 128_000);
      expect(context?.messages).toHaveLength(2);
      expect(context?.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ source_message_ids: ["pi67:source-user"] }),
        expect.objectContaining({ source_message_ids: ["pi67:source-assistant"] }),
      ]));
    } finally {
      await client.deleteSession(sessionId);
    }
    await expect(client.getSession(sessionId)).resolves.toBeNull();
  }, 30_000);
});

function payload(role: "user" | "assistant", source: string, kind: "user_query" | "assistant_step") {
  return {
    role,
    content: `synthetic ${role} message`,
    source_message_ids: [`pi67:${source}`],
    turn_id: "pi-turn-1",
    message_kind: kind,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
