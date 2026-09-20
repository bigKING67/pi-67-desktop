import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AgentHostServer } from "./host-server.js";
import { TeamIndexSettingsClient } from "./context/team-index-settings-client.js";
import { EnterpriseCredentialBrokerClient } from "./context/enterprise-credential-broker-client.js";
import type { SharedKnowledgeReceiptRequest } from "@pi67/protocol";

it("composes embedding and complete metadata search with settings, identity and cancellation without Pi extraction", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-host-query-")), agentDir = join(root, "agent"); await mkdir(agentDir);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir); vi.stubEnv("PI67_STORAGE_ROOT", root); vi.stubEnv("PI67_SESSION_CATALOG_DIR", join(root, "catalog"));
  const modelSettings = { extraction: { provider: "missing-provider", model: "not-resolved" },
    embedding: { protocol: "openai-compatible" as const, endpoint: "https://embed.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-embedding" } };
  const parent = { postMessage: vi.fn() }, settings = new TeamIndexSettingsClient(parent);
  parent.postMessage.mockImplementation(message => { if (message.type === "team-index-settings-read") settings.handleMessage({ type: "team-index-settings-result", requestId: message.requestId, ok: true, settings: modelSettings }); });
  const id = "00000000-0000-4000-8000-000000000001", snapshot = { epoch: id, cursor: "1" };
  const canonicalContent = JSON.stringify(["newmoney.knowledge.v1", "sop", "title", "summary", "body"]), contentRevision = createHash("sha256").update(canonicalContent).digest("hex");
  const receiptParent = { postMessage: vi.fn() }, credentials = new EnterpriseCredentialBrokerClient(receiptParent);
  const credential = { endpoint: "https://service.invalid", accessToken: "synthetic-service", userId: "user", accountId: id, expiresAt: Date.now() + 600_000 };
  let holdQuery = false, pendingQuery: SharedKnowledgeReceiptRequest | undefined;
  receiptParent.postMessage.mockImplementation((message: SharedKnowledgeReceiptRequest) => {
    const base = { type: `${message.type}-result`, requestId: message.requestId, ok: true };
    if (message.type === "shared-knowledge-receipt-open") credentials.handleReceiptResult({ ...base, handleId: id, userId: "user", endpoint: credential.endpoint, progress: { epoch: null, cursor: "0" } });
    if (message.type === "shared-knowledge-index-query-prepare") credentials.handleReceiptResult({ ...base, queryId: id, snapshot, model: { endpoint: "https://embed.invalid/v1", model: "embed", dimension: 4 } });
    if (message.type === "shared-knowledge-index-query") {
      if (holdQuery) pendingQuery = message;
      else credentials.handleReceiptResult({ ...base, snapshot, hits: [{ assetId: id, contentRevision: "a".repeat(64), score: 0.5 }] });
    }
    if (message.type === "shared-knowledge-receipt-close") credentials.handleReceiptResult(base);
    if (message.type === "shared-knowledge-index-read" || message.type === "shared-knowledge-index-read-current") credentials.handleReceiptResult({ ...base, snapshot, assetId: id, contentRevision, canonicalContent });
  });
  credentials.applyBootstrap({ type: "enterprise-credential-bootstrap", storage: "available", credential });
  const fetcher = vi.fn<typeof fetch>(async url => {
    const path = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    return path.endsWith("/authorization") ? Response.json({
    userId: "user", teamId: id, role: "member", permissionRevision: "a".repeat(64), issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...(path.includes("/projects/") ? { projectId: id } : {}),
    modelPolicy: { teamId: id, revision: "1", allowedModels: [{ purpose: "embedding", endpoint: "https://embed.invalid/v1", modelId: "embed" },
      { purpose: "agent", endpoint: "https://agent.invalid/v1", modelId: "agent" }] }
  }) : Response.json({ model: "embed", data: [{ index: 0, embedding: [1, 2, 3, 4] }] }); });
  vi.stubGlobal("fetch", fetcher);
  const runtime = vi.fn(async () => { throw new Error("Agent must not load"); }); let server: AgentHostServer | undefined;
  try {
    await writeFile(join(agentDir, "openviking.json"), JSON.stringify({ enterpriseGatewayEndpoint: credential.endpoint }));
    server = new AgentHostServer(runtime, { agentDir, enterpriseCredentialBroker: credentials, teamIndexSettings: settings });
    const input = { teamId: id, projectId: null, query: "synthetic-query", expectedModel: { endpoint: "https://embed.invalid/v1", model: "embed", dimension: 4 }, signal: new AbortController().signal };
    expect(await server.teamKnowledge.embed(input)).toEqual({ vector: [1, 2, 3, 4], model: input.expectedModel });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(runtime).not.toHaveBeenCalled();
    const search = { teamId: id, projectId: null, query: "synthetic-search", limit: 1, signal: input.signal };
    expect(await server.teamKnowledge.search(search)).toEqual({ snapshot, hits: [{ assetId: id, contentRevision: "a".repeat(64), score: 0.5 }] });
    expect(receiptParent.postMessage.mock.calls.map(([message]) => message.type)).toEqual(["shared-knowledge-receipt-open", "shared-knowledge-index-query-prepare", "shared-knowledge-index-query", "shared-knowledge-receipt-close"]);
    expect(fetcher).toHaveBeenCalledTimes(4); expect(runtime).not.toHaveBeenCalled();
    expect(await server.teamKnowledge.read({ teamId: id, projectId: null, signal: input.signal, snapshot, assetId: id, contentRevision }))
      .toEqual({ snapshot, assetId: id, contentRevision, content: { kind: "sop", title: "title", summary: "summary", body: "body" } });
    expect(fetcher).toHaveBeenCalledTimes(4); expect(parent.postMessage).toHaveBeenCalledTimes(2); expect(runtime).not.toHaveBeenCalled();
    let release!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const run = server.teamKnowledge.embed(input), rejected = expect(run).rejects.toThrow("unavailable");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
    settings.handleMessage({ type: "team-index-settings-invalidated" });
    expect(fetcher.mock.calls[4]![1]!.signal!.aborted).toBe(true);
    release(Response.json({}, { status: 403 })); await rejected;
    expect(parent.postMessage.mock.calls.map(([message]) => message.type)).toEqual(Array(3).fill("team-index-settings-read"));
    holdQuery = true;
    const searching = server.teamKnowledge.search(search), searchRejected = expect(searching).rejects.toThrow("unavailable");
    await vi.waitFor(() => expect(pendingQuery).toBeDefined()); settings.handleMessage({ type: "team-index-settings-invalidated" }); await searchRejected;
    expect(credentials.handleReceiptResult({ type: "shared-knowledge-index-query-result", requestId: pendingQuery!.requestId, ok: true, snapshot, hits: [] })).toBe(false);
    expect(runtime).not.toHaveBeenCalled();
    holdQuery = false;
    const session = { identity: { userId: "user", endpoint: "https://service.invalid/", teamId: id, projectId: id },
      model: { baseUrl: "https://agent.invalid/v1", id: "agent" }, scope: "team" as const, signal: input.signal };
    const beforeSearch = fetcher.mock.calls.length;
    expect(await server.teamKnowledge.session.search({ ...session, query: "synthetic-search", limit: 1 }))
      .toEqual({ snapshot, hits: [{ assetId: id, contentRevision: "a".repeat(64), score: 0.5 }] });
    expect(fetcher).toHaveBeenCalledTimes(beforeSearch + 3);
    const beforeRead = parent.postMessage.mock.calls.length;
    expect(await server.teamKnowledge.session.read({ ...session, scope: "project", snapshot, assetId: id, contentRevision }))
      .toMatchObject({ contentRevision, content: { body: "body" } });
    expect(fetcher).toHaveBeenCalledTimes(beforeSearch + 4);
    expect(parent.postMessage).toHaveBeenCalledTimes(beforeRead);
    expect(await server.teamKnowledge.forWorkspace("synthetic-workspace").read({ ...session, snapshot: "current", assetId: id, contentRevision }))
      .toMatchObject({ contentRevision, content: { body: "body" } });
    expect(receiptParent.postMessage.mock.calls.some(([message]) => message.type === "shared-knowledge-index-read-current")).toBe(true);
    const beforeDenied = receiptParent.postMessage.mock.calls.length;
    await expect(server.teamKnowledge.session.read({ ...session, model: { ...session.model, id: "denied" }, snapshot, assetId: id, contentRevision })).rejects.toThrow("unavailable");
    expect(receiptParent.postMessage).toHaveBeenCalledTimes(beforeDenied);
    const beforePending = fetcher.mock.calls.length;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const reading = server.teamKnowledge.session.read({ ...session, snapshot, assetId: id, contentRevision }), readRejected = expect(reading).rejects.toThrow("unavailable");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(beforePending + 1));
    settings.handleMessage({ type: "team-index-settings-invalidated" });
    expect(fetcher.mock.calls.at(-1)![1]!.signal!.aborted).toBe(true);
    release(Response.json({}, { status: 403 })); await readRejected;
    expect(receiptParent.postMessage).toHaveBeenCalledTimes(beforeDenied); expect(runtime).not.toHaveBeenCalled();
    await server.shutdown(); await expect(server.teamKnowledge.embed(input)).rejects.toThrow("unavailable"); await expect(server.teamKnowledge.search(search)).rejects.toThrow("unavailable");
    await expect(server.teamKnowledge.session.search({ ...session, query: "synthetic", limit: 1 })).rejects.toThrow("unavailable");
    await expect(server.teamKnowledge.session.read({ ...session, snapshot, assetId: id, contentRevision })).rejects.toThrow("unavailable");
  } finally {
    try { await server?.shutdown(); settings.shutdown(); credentials.shutdown(); }
    finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await rm(root, { recursive: true, force: true }); }
  }
}, 15_000);
