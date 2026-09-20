import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { MessageChannel } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseContextController } from "../../agent-host/src/context/enterprise-context-controller.js";
import { EnterpriseCredentialBrokerClient } from "../../agent-host/src/context/enterprise-credential-broker-client.js";
import { startNativeTeamModelWorker } from "./native-team-model-worker.mjs";
import { relayNativeTeamModelWorker } from "./native-team-model-relay.js";
import { createTeamModelPortChannel } from "../../agent-host/src/context/team-model-port-channel.js";

const python = process.env.PI67_TEAM_MODEL_TEST_PYTHON;
const bootstrap = fileURLToPath(new URL("../../../eng/capabilities/openviking-runtime/native_team_worker_probe.py", import.meta.url));
afterEach(() => { vi.unstubAllGlobals(); });

it.skipIf(!python || process.platform !== "darwin" || process.arch !== "arm64").each(["success", "deny", "cancel", "descendant"] as const)(
  "owns an isolated native team process through physical exit: %s", async (mode) => {
    const lifetime = new AbortController();
    const model = { baseUrl: "https://model.invalid/v1", id: "fixture" };
    const fetcher = vi.fn<typeof fetch>(async () => mode === "deny" ? Response.json({}, { status: 403 }) : Response.json({
      userId: "user", teamId: "team", role: "member", permissionRevision: "a".repeat(64),
      issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      modelPolicy: { teamId: "team", revision: "1", allowedModels: [{ purpose: "embedding", endpoint: model.baseUrl, modelId: model.id }] }
    }));
    vi.stubGlobal("fetch", fetcher);
    const broker = new EnterpriseCredentialBrokerClient({ postMessage() { throw new Error("Unexpected synthetic credential write"); } });
    broker.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential: {
      endpoint: "https://service.invalid", accessToken: "synthetic-token", userId: "user", accountId: "team", expiresAt: Date.now() + 600_000
    } });
    const controller = new EnterpriseContextController({ read: async () => ({ enterpriseGatewayEndpoint: "https://service.invalid" }) } as never,
      {} as never, { sendFor() {} } as never, broker);
    let invoked = 0;
    const relayStop = vi.fn();
    const directory = await mkdtemp(join(tmpdir(), "new-money-team-worker-"));
    let cleanupConfirmed = false;
    const worker = await startNativeTeamModelWorker({ python: python!, bootstrap, cwd: directory,
      arguments: [mode === "descendant" ? "descendant" : "model"],
      attachModelChannel(channel) {
        const ports = new MessageChannel();
        const hostChannel = createTeamModelPortChannel(ports.port2);
        const relay = controller.attachTeamModelChannel(hostChannel, {
          teamId: "team", projectId: null, models: { embedding: model, extraction: model }, signal: lifetime.signal,
          async invoke(_purpose, _model, _body, signal) {
            invoked += 1;
            if (mode === "cancel") { lifetime.abort(); expect(signal.aborted).toBe(true); return new Promise<never>(() => undefined); }
            return { status: 200, body: Buffer.from(JSON.stringify({ data: [{ index: 0, embedding: [0.25, 0.75] }], model: "fixture" })) };
          }
        });
        const mainRelay = relayNativeTeamModelWorker(channel, ports.port1, lifetime.signal);
        return { stop() { relayStop(); mainRelay.stop(); relay.stop(); } };
      }
    }, lifetime.signal);
    const timeout = setTimeout(() => { lifetime.abort(); }, 18_000);
    try {
      const result = await worker.completion;
      cleanupConfirmed = true;
      if (mode === "success" || mode === "descendant") expect(result.code).toBe(0);
      expect(invoked).toBe(mode === "success" || mode === "cancel" ? 1 : 0);
      expect(fetcher).toHaveBeenCalledTimes(mode === "descendant" ? 0 : 1);
      expect(relayStop).toHaveBeenCalledOnce();
      expect(() => process.kill(-worker.pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      expect(worker.stop()).toBe(worker.stop()); await worker.stop();
    } catch (error) {
      const group = spawnSync("/bin/ps", ["-g", String(worker.pid), "-o", "pid=,ppid=,pgid=,stat=,comm="], { encoding: "utf8", timeout: 2_000, maxBuffer: 4096 });
      throw new Error(`Synthetic team group ${worker.pid}: ${group.stdout?.trim() || "not listed"}; ${error instanceof Error ? error.message : "unknown cleanup failure"}`);
    } finally {
      clearTimeout(timeout); await worker.stop().catch(() => undefined); controller.shutdown();
      if (cleanupConfirmed) await rm(directory, { recursive: true, force: true });
    }
  }, 25_000
);
