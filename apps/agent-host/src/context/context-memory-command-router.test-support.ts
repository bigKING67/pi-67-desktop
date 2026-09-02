import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnterpriseAccessCredential } from "@pi67/protocol";
import { vi } from "vitest";
import type { HostEventChannel } from "../host-event-channel.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import { ContextMemoryCommandRouter } from "./context-memory-command-router.js";
import { deriveWorkspacePeerId } from "./context-memory-support.js";
import type { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";

const roots: string[] = [];

export const workspaceContext = { scope: "workspace" as const, workspaceId: "workspace-1" };
export const workspaceMemoryUri = `viking://user/local-owner/peers/${deriveWorkspacePeerId("/private/local/workspace")}/memories/events/host-recovery.md`;

export async function cleanupRouterFixtures(): Promise<void> {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function createRouter(
  overrides: Record<string, unknown> = {},
  options: {
    secureStorage?: "available" | "unavailable";
    credential?: EnterpriseAccessCredential;
    workspaceTrusted?: boolean;
  } = {}
) {
  const root = await mkdtemp(join(tmpdir(), "pi67-context-router-"));
  roots.push(root);
  if (Object.keys(overrides).length > 0) {
    await writeFile(join(root, "openviking.json"), JSON.stringify(overrides), "utf8");
  }
  const events: Array<{ type: string }> = [];
  const sessionPath = join(root, "session-one.jsonl");
  await writeFile(sessionPath, `${JSON.stringify({ type: "session", id: "session/one", cwd: "/private/local/workspace" })}\n`, "utf8");
  const eventChannel = {
    sendFor(event: { type: string }) {
      events.push(event);
      return true;
    }
  } as unknown as HostEventChannel;
  const workspaces = {
    require: () => ({
      cwd: "/private/local/workspace",
      initialization: { trust: options.workspaceTrusted ? "trusted" : "untrusted" }
    }),
    queryCatalog: async () => ({
      items: [{
        fileIdentity: "session-file-one",
        id: "session/one",
        path: sessionPath,
        cwd: "/private/local/workspace",
        name: "Session one",
        nameSource: "fallback" as const,
        modifiedAt: Date.now(),
        messageCount: 1
      }],
      total: 1,
      hasMore: false,
      revision: 1,
      itemCount: 1,
      source: "sqlite" as const,
      state: "ready" as const,
      rebuilding: false,
      incomplete: false,
      skippedCount: 0
    })
  } as unknown as WorkspaceContextRegistry;
  let credential = options.credential;
  const secureStorage = options.secureStorage;
  const enterpriseCredentials = secureStorage === undefined
    ? undefined
    : {
        snapshot: () => ({
          storage: secureStorage,
          ...(credential === undefined ? {} : { credential: { ...credential } })
        }),
        store: async (next: EnterpriseAccessCredential) => { credential = { ...next }; },
        clear: async () => { credential = undefined; },
        shutdown: () => undefined
      } as unknown as EnterpriseCredentialBrokerClient;
  return {
    root,
    sessionPath,
    events,
    credentialSnapshot: () => enterpriseCredentials?.snapshot(),
    router: new ContextMemoryCommandRouter(root, workspaces, eventChannel, enterpriseCredentials)
  };
}

export function candidateFlowFetch(expiresAt: number) {
  const experienceUri = "viking://user/local/memories/experiences/host-recovery.md";
  const archiveUri = "viking://user/local/sessions/session%2Fone/history/archive_001";
  const memoryDiffUri = `${archiveUri}/memory_diff.json`;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes("/workspace-bindings/current")) {
      return jsonResponse({
        state: "bound",
        workspaceId: "binding-1",
        enterpriseProjectId: "project-1",
        enterpriseProjectName: "Desktop",
        accountId: "account-1",
        boundAt: "2026-08-31T00:00:00Z"
      });
    }
    if (url.endsWith("/sessions/session%2Fone/commit")) {
      return jsonResponse({ status: "ok", result: {
        status: "accepted",
        archived: true,
        task_id: "task-candidate-1",
        archive_uri: archiveUri
      } });
    }
    if (url.endsWith("/tasks/task-candidate-1")) {
      return jsonResponse({ status: "ok", result: {
        task_id: "task-candidate-1",
        task_type: "session_commit",
        status: "completed",
        result: {
          session_id: "session/one",
          archive_uri: archiveUri,
          memory_diff_uri: memoryDiffUri,
          memories_extracted: { experiences: 1 }
        }
      } });
    }
    if (url.includes("/content/read") && url.includes("memory_diff")) {
      return jsonResponse({ status: "ok", result: JSON.stringify({
        archive_uri: archiveUri,
        operations: {
          adds: [{
            uri: experienceUri,
            memory_type: "experiences",
            after: "# Host epoch recovery\n\n## Situation\nOld Host events remain visible.\n\n## Approach\nDiscard stale epochs.\n\n## Reflect\nRun recovery tests."
          }],
          updates: [],
          deletes: []
        }
      }) });
    }
    if (url.includes("/fs/ls")) {
      const target = new URL(url).searchParams.get("uri");
      return jsonResponse({ status: "ok", result: target === "viking://user/memories"
        ? ["viking://user/local/memories/experiences"]
        : [experienceUri] });
    }
    if (url.includes("/content/read")) {
      return jsonResponse({ status: "ok", result: "Situation: Old Host events remain visible\nApproach: Discard stale epochs" });
    }
    if (url.endsWith("/candidates") && init?.method === "POST") {
      if (new Headers(init.headers).get("Authorization") !== "Bearer agent-access-token") {
        throw new Error("Expected authenticated candidate submission");
      }
      return jsonResponse({
        id: "candidate-remote-1",
        status: "candidate",
        createdAt: new Date(expiresAt - 1_000).toISOString(),
        updatedAt: new Date(expiresAt - 1_000).toISOString()
      });
    }
    throw new Error(`Unexpected candidate-flow request: ${url}`);
  });
}

export function healthyFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.endsWith("/health")) return jsonResponse({ status: "ok", result: { version: "0.4.16" } });
    if (url.endsWith("/commit")) {
      return jsonResponse({ status: "ok", result: { status: "accepted", archived: true, task_id: "task-1" } });
    }
    if (url.includes("/sessions/") && !url.endsWith("/commit")) {
      return jsonResponse({ status: "ok", result: {
        session_id: "session/one",
        message_count: 4,
        total_message_count: 8,
        pending_tokens: 1_200,
        last_commit_at: "2026-08-31T00:00:00Z"
      } });
    }
    if (url.endsWith("/search/find")) {
      return jsonResponse({ status: "ok", result: { memories: [
        { uri: workspaceMemoryUri, score: 0.9, abstract: "Host recovery memory" },
        { uri: "viking://resources/not-private", score: 0.8, abstract: "Not private" }
      ] } });
    }
    if (url.includes("/fs/ls")) return jsonResponse({ status: "ok", result: [] });
    if (url.includes("/content/read")) return jsonResponse({ status: "ok", result: "Host recovery memory" });
    if (!(init?.signal instanceof AbortSignal)) throw new Error("Expected bounded request signal");
    return jsonResponse({ status: "ok", result: {} });
  });
}

export function enterpriseFetch(expiresAt: number) {
  let exchangeCount = 0;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.endsWith("/device-authorizations")) {
      return jsonResponse({
        authorizationId: "device-1",
        deviceSecret: "a".repeat(64),
        verificationUri: "https://datahub.example.test/agent?section=device-authorization",
        userCode: "A1B2C3D4",
        expiresAt: new Date(expiresAt).toISOString(),
        intervalSeconds: 1
      });
    }
    if (url.endsWith("/device-authorizations/device-1/exchange")) {
      exchangeCount += 1;
      return jsonResponse(exchangeCount === 1 ? { state: "pending" } : {
        state: "signed-in",
        accessToken: "agent-access-token",
        accountId: "account-1",
        userId: "user-1",
        displayName: "Employee 67",
        expiresAt: new Date(expiresAt).toISOString()
      });
    }
    if (url.endsWith("/projects") && init?.method === "GET") {
      return jsonResponse({
        items: [{
          id: "project-1",
          accountId: "account-1",
          name: "Desktop",
          slug: "desktop",
          status: "active",
          bindingCount: 0,
          candidateCount: 0,
          sharedAssetCount: 0,
          updatedAt: "2026-08-31T00:00:00Z"
        }],
        total: 1
      });
    }
    if (url.includes("/workspace-bindings/current")) return jsonResponse({ state: "unbound" });
    if (url.endsWith("/projects/project-1/bindings")) {
      if (typeof init?.body !== "string") throw new Error("Expected JSON binding body");
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (body.idempotencyKey !== "bind-1" || !/^[a-f0-9]{64}$/u.test(String(body.workspaceFingerprint))) {
        throw new Error("Expected idempotent fingerprint-bound request");
      }
      return jsonResponse({
        state: "bound",
        workspaceId: "binding-1",
        enterpriseProjectId: "project-1",
        enterpriseProjectName: "Desktop",
        accountId: "account-1",
        boundAt: "2026-08-31T00:00:00Z"
      });
    }
    if (url.endsWith("/shared-experiences/search")) {
      return jsonResponse({
        items: [{
          id: "shared-1",
          projectId: "project-1",
          title: "Host recovery",
          taskType: "electron-recovery",
          summary: "Discard stale Host epochs.",
          score: 0.91,
          applicableWhen: ["Host epoch changes"],
          notApplicableWhen: ["Ordinary render"],
          externalRevision: "e".repeat(64),
          publishedAt: "2026-08-31T00:00:00Z"
        }],
        total: 1
      });
    }
    if (url.includes("/shared-experiences/shared-1?")) {
      return jsonResponse({
        id: "shared-1",
        projectId: "project-1",
        title: "Host recovery",
        taskType: "electron-recovery",
        problem: "Old events remain visible",
        strategy: "Discard stale epochs",
        result: "success",
        confidence: 0.9,
        sensitivity: "team",
        applicableWhen: ["Host epoch changes"],
        notApplicableWhen: ["Ordinary render"],
        evidence: [{
          kind: "test",
          label: "42 tests passed",
          hash: "d".repeat(64),
          verifiedAt: "2026-08-31T00:00:00Z"
        }],
        externalRevision: "e".repeat(64),
        publishedAt: "2026-08-31T00:00:00Z"
      });
    }
    throw new Error(`Unexpected enterprise request: ${url}`);
  });
}

export function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
