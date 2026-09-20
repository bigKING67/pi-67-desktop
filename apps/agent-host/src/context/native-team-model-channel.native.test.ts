import { spawn } from "node:child_process";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseContextController } from "./enterprise-context-controller.js";
import { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";

const python = process.env.PI67_TEAM_MODEL_TEST_PYTHON;
afterEach(() => { vi.unstubAllGlobals(); });
it.skipIf(!python || process.platform !== "darwin").each(["success", "deny", "cancel"] as const)(
  "connects the pinned Python OV backends to the Host guard: %s", async (mode) => {
    const lifetime = new AbortController();
    const purposes: string[] = [], authorizations: string[] = [];
    const model = { baseUrl: "https://model.invalid/v1", id: "fixture" };
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      authorizations.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      if (mode === "deny") return new Response("{}", { status: 403 });
      return new Response(JSON.stringify({ userId: "user", teamId: "team", role: "member", permissionRevision: "a".repeat(64),
        issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        modelPolicy: { teamId: "team", revision: "1", allowedModels: ["embedding", "extraction"].map((purpose) => ({
          purpose, endpoint: model.baseUrl, modelId: model.id })) } }));
    });
    vi.stubGlobal("fetch", fetcher);
    const broker = new EnterpriseCredentialBrokerClient({ postMessage() { throw new Error("Unexpected credential mutation"); } });
    broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential: {
      endpoint: "https://service.invalid", accessToken: "synthetic-token", userId: "user", accountId: "team", expiresAt: Date.now() + 600_000
    } });
    const controller = new EnterpriseContextController({ read: async () => ({ enterpriseGatewayEndpoint: "https://service.invalid" }) } as never,
      {} as never, { sendFor() {} } as never, broker);
    const child = spawn(python!, ["-I", "-B", fileURLToPath(new URL("../../../../eng/capabilities/openviking-runtime/team_model_channel_probe.py", import.meta.url)), mode],
      { stdio: ["ignore", "pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } });
    let stdout = "";
    child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > 4096) child.kill("SIGKILL"); });
    child.stderr!.resume(); // Never forward native exceptions or model payloads.
    const closed = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    const handle = controller.attachTeamModelChannel(child.stdio[3] as Duplex, {
      teamId: "team", projectId: null, models: { embedding: model, extraction: model }, signal: lifetime.signal,
      async invoke(purpose, selected, body, signal) {
        expect(selected).toEqual(model); expect(JSON.parse(new TextDecoder().decode(body))).toHaveProperty("model", "fixture");
        purposes.push(purpose);
        if (mode === "cancel") { controller.shutdown(); expect(signal.aborted).toBe(true); return new Promise<never>(() => undefined); }
        const response = purpose === "embedding"
          ? { data: [{ index: 0, embedding: [0.25, 0.75] }], model: "fixture", usage: { prompt_tokens: 1, total_tokens: 1 } }
          : { id: "fixture", object: "chat.completion", created: 0, model: "fixture", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "synthetic summary" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
        return { status: 200, body: new TextEncoder().encode(JSON.stringify(response)) };
      }
    });
    const timeout = setTimeout(() => { handle.stop(); child.kill("SIGKILL"); }, 20_000);
    try {
      expect(await closed).toBe(0);
      expect(stdout.trim()).toBe(`TEAM_CHANNEL_PASS:${mode}`);
      expect(purposes).toEqual(mode === "success" ? ["embedding", "embedding", "extraction", "extraction"] : mode === "cancel" ? ["embedding"] : []);
      expect(authorizations).toHaveLength(mode === "success" ? 4 : 1);
    } finally { clearTimeout(timeout); handle.stop(); controller.shutdown(); child.kill("SIGKILL"); }
  }, 25_000
);
