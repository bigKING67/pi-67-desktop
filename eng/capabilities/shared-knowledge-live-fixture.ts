// Engineering fixture only: never part of Desktop production networking.
import assert from "node:assert/strict";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:https";
import { isAbsolute, join } from "node:path";

export function liveRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Invalid live fixture record");
  return value as Record<string, unknown>;
}
function text(value: unknown): string { assert.equal(typeof value, "string", "Invalid live fixture field"); return value as string; }
export function liveWebRemainingMs(createdAt: number, now = Date.now()): number {
  return Math.max(0, Math.min(600_000, Math.floor(createdAt + 600_000 - now)));
}
async function privateFile(path: string, limit: number) {
  const info = await lstat(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= limit
    && (process.platform === "win32" || (info.mode & 0o077) === 0 && info.uid === process.getuid?.()), "Unsafe live fixture file");
  return readFile(path);
}

// Test-only TLS termination. The real Rust router/DB remain the upstream. Trust
// is provided at process startup through NODE_EXTRA_CA_CERTS, never disabled.
export async function startLiveKnowledgeFixture(directory: string) {
  assert.ok(isAbsolute(directory), "Live fixture needs an absolute private directory");
  const root = await lstat(directory);
  assert.ok(root.isDirectory() && !root.isSymbolicLink() && (root.mode & 0o077) === 0, "Unsafe live directory");
  assert.equal(process.env.NODE_EXTRA_CA_CERTS, join(directory, "cert.pem"), "Require test-process certificate trust");
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0", "TLS verification must stay enabled");
  let config: Record<string, unknown>;
  try { config = liveRecord(JSON.parse((await privateFile(join(directory, "connection.json"), 16 * 1024)).toString()) as unknown); }
  catch { throw new Error("Invalid private live fixture handoff"); }
  // The explicit Web Server fixture owns one 600-second window from handoff. Web
  // stages share only its remaining budget, never a fresh per-stage extension.
  const handoffCreated = (await lstat(join(directory, "connection.json"))).mtimeMs;
  const webSignal = AbortSignal.timeout(liveWebRemainingMs(handoffCreated));
  assert.ok(config.schema === "newmoney.synthetic-live.v1", "Invalid private live fixture schema");
  let upstream: URL;
  try { upstream = new URL(text(config.endpoint)); } catch { throw new Error("Invalid live fixture upstream"); }
  assert.ok(upstream.protocol === "http:" && upstream.hostname === "127.0.0.1" && upstream.port
    && upstream.pathname === "/" && !upstream.username && !upstream.password && !upstream.search && !upstream.hash,
  "Only the explicit loopback test API may receive credentials");
  const key = await privateFile(join(directory, "key.pem"), 16 * 1024);
  const cert = await readFile(join(directory, "cert.pem"));
  const identity = { userId: text(config.userId), accountId: text(config.teamId), accessToken: text(config.accessToken),
    expiresAt: Date.parse(text(config.expiresAt)) };
  assert.ok(identity.expiresAt > Date.now(), "Live test session already expired");
  const scope = { teamId: identity.accountId, scopeKind: "project" as const, scopeId: text(config.projectId) };
  const candidateId = text(config.candidateId);
  const transport = { requests: 0, responses: 0, timeouts: 0, maxDurationMs: 0, authorizationOk: 0, authorizationFailed: 0, sessionRevocations: 0 };
  // Bounded timing metadata only: never retain URLs, IDs, headers or payloads.
  const timeline: Array<{ sequence: number; operation: string; elapsedMs: number; status: number; closed: boolean }> = [];
  const proxy = createServer({ key, cert }, (incoming, outgoing) => {
    const revokeSession = incoming.url === "/v1/auth/sessions/current" && incoming.method === "DELETE"
      && typeof config.accountAccessToken === "string";
    if (!revokeSession && (!incoming.url?.startsWith("/v1/agent/") || incoming.url.includes("://"))) { outgoing.writeHead(404).end(); return; }
    transport.requests++; const started = performance.now();
    const event = { sequence: transport.requests, operation: incoming.url?.endsWith("/authorization") ? "authorization"
      : incoming.url?.split("?")[0]?.endsWith("/sync") ? "sync" : "other", elapsedMs: 0, status: 0, closed: false };
    timeline.push(event); if (timeline.length > 128) timeline.shift();
    const forward = request({ hostname: "127.0.0.1", port: upstream.port, path: incoming.url,
      method: incoming.method, headers: { ...incoming.headers, host: upstream.host }, timeout: 35_000 }, response => {
      transport.responses++; transport.maxDurationMs = Math.max(transport.maxDurationMs, Math.round(performance.now() - started));
      event.elapsedMs = Math.round(performance.now() - started); event.status = response.statusCode ?? 502;
      if (revokeSession && response.statusCode === 204) transport.sessionRevocations++;
      if (incoming.url?.endsWith("/authorization")) {
        if (response.statusCode === 200) transport.authorizationOk++; else transport.authorizationFailed++;
      }
      outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
    });
    forward.on("timeout", () => { transport.timeouts++; forward.destroy(); });
    forward.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    incoming.on("aborted", () => forward.destroy());
    outgoing.on("close", () => { event.closed = true; event.elapsedMs = Math.round(performance.now() - started); forward.destroy(); });
    incoming.pipe(forward);
  });
  await new Promise<void>((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve); });
  const address = proxy.address(); assert.ok(address && typeof address !== "string");
  const endpoint = `https://127.0.0.1:${address.port}`;
  const credential = { endpoint, ...identity };
  let closing: Promise<void> | undefined;
  return { credential, scope, candidateId, webGovernance: config.webGovernance === true, webSignal,
    diagnostics: () => ({ ...transport, timeline: timeline.map(event => ({ ...event })) }),
    async approveDevice(userCode: string) {
      // Explicit opt-in fixture credential stays in Main; never bootstrap it into Host.
      const token = text(config.accountAccessToken);
      const response = await fetch(`${endpoint}/v1/agent/device-authorizations/approve`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, teamId: scope.teamId })
      });
      await response.body?.cancel(); assert.equal(response.status, 204);
    },
    async api(path: string, method = "GET", body?: unknown, headers?: Record<string, string>) {
      assert.ok(path.startsWith("/v1/agent/") && !path.includes("://"));
      // Operator setup writes cross the Mac/VPS DB tunnel many times. This
      // control budget does not change Gateway/Main's production 8-second limits.
      const started = performance.now();
      try {
        const response = await fetch(`${endpoint}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${credential.accessToken}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        console.info("Live fixture control", { method, status: response.status, elapsedMs: Math.round(performance.now() - started) });
        return response;
      } catch { throw new Error(`Live fixture control ${method} failed after ${Math.round(performance.now() - started)}ms`); }
    },
    async close(passed: boolean) {
      closing ??= (async () => {
        await new Promise<void>((resolve, reject) => { proxy.close(error => error ? reject(error) : resolve()); proxy.closeAllConnections(); });
        console.info("Live HTTPS transport", transport);
        await writeFile(join(directory, "complete.txt"), passed ? "passed\n" : "failed\n", { flag: "wx", mode: 0o600 });
      })();
      await closing;
    }
  };
}
