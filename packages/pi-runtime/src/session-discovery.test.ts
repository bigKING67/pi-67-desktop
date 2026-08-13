import { link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionCatalog } from "./session-catalog.js";
import {
  createSessionCatalogContext,
  createSessionCatalogSourceKey
} from "./session-discovery.js";
import { SESSION_CATALOG_DATABASE_FILENAME } from "./sqlite-session-catalog.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Pi SDK Session Catalog discovery contract", () => {
  it("prefers explicit names and derives fallback titles outside the query hot path", async () => {
    const fixture = await createFixture();
    const unnamed = SessionManager.create(fixture.cwd, fixture.sessionDirectory);
    unnamed.appendMessage({
      role: "user",
      content: "PRIVATE_PROMPT_MUST_NOT_BECOME_A_SESSION_NAME",
      timestamp: Date.now()
    });
    unnamed.appendMessage(assistantMessage("unnamed reply", Date.now() + 1));
    const named = SessionManager.create(fixture.cwd, fixture.sessionDirectory);
    named.appendSessionInfo("Explicit catalog name");
    named.appendMessage({ role: "user", content: "another private prompt", timestamp: Date.now() + 2 });
    named.appendMessage(assistantMessage("named reply", Date.now() + 3));
    const whitespaceNamed = SessionManager.create(fixture.cwd, fixture.sessionDirectory);
    whitespaceNamed.appendSessionInfo("   ");
    whitespaceNamed.appendMessage({ role: "user", content: "private unnamed prompt", timestamp: Date.now() + 4 });
    whitespaceNamed.appendMessage(assistantMessage("whitespace reply", Date.now() + 5));

    const context = createSessionCatalogContext({
      agentDir: fixture.agentDir,
      configuredSessionDir: fixture.sessionDirectory,
      workspaceCwd: fixture.cwd
    });
    const onChanged = vi.fn();
    const catalog = createSessionCatalog({ onChanged });
    await catalog.reconcile(context);
    onChanged.mockClear();
    const [unnamedPath, namedPath, whitespaceNamedPath] = await Promise.all([
      requirePersistedPath(unnamed),
      requirePersistedPath(named),
      requirePersistedPath(whitespaceNamed)
    ].map((path) => realpath(path)));
    const firstPage = await catalog.query({ scope: "workspace" }, context);
    expect(firstPage.items.find((item) => item.path === unnamedPath)).toMatchObject({
      name: "未命名对话",
      nameSource: "fallback"
    });
    expect(firstPage.items.find((item) => item.path === namedPath)?.name).toBe("Explicit catalog name");
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({
      reason: "automatic-title"
    })));

    const page = await catalog.query({ scope: "workspace" }, context);
    expect(page.items.find((item) => item.path === unnamedPath)?.name).toBe(
      "PRIVATE_PROMPT_MUST_NOT_BECOME_A_SESSION_NAME"
    );
    expect(page.items.find((item) => item.path === namedPath)?.name).toBe("Explicit catalog name");
    expect(page.items.find((item) => item.path === whitespaceNamedPath)?.name).toBe("private unnamed prompt");
    await catalog.dispose();
  });

  it("persists metadata without prompt, assistant, thinking, tool, source, patch or image markers", async () => {
    const fixture = await createFixture();
    const session = SessionManager.create(fixture.cwd, fixture.sessionDirectory);
    session.appendSessionInfo("Safe explicit name");
    session.appendMessage({
      role: "user",
      content: "BANNED_PROMPT_MARKER BANNED_SOURCE_MARKER BANNED_PATCH_MARKER BANNED_IMAGE_MARKER",
      timestamp: Date.now()
    });
    session.appendMessage({
      role: "toolResult",
      toolCallId: "private-tool-call",
      toolName: "private-tool",
      content: [{ type: "text", text: "BANNED_TOOL_MARKER" }],
      isError: false,
      timestamp: Date.now() + 1
    });
    session.appendMessage({
      role: "assistant",
      content: [{ type: "thinking", thinking: "BANNED_THINKING_MARKER" }, { type: "text", text: "BANNED_ASSISTANT_MARKER" }],
      api: "openai-responses",
      provider: "pi67-test",
      model: "fixture",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "stop",
      timestamp: Date.now() + 2
    });
    const context = createSessionCatalogContext({
      agentDir: fixture.agentDir,
      configuredSessionDir: fixture.sessionDirectory,
      workspaceCwd: fixture.cwd
    });
    const catalogDirectory = join(fixture.root, "catalog");
    const catalog = createSessionCatalog({ directory: catalogDirectory });
    await catalog.reconcile(context);
    await catalog.dispose();

    const raw = await readFile(join(catalogDirectory, SESSION_CATALOG_DATABASE_FILENAME));
    const serialized = raw.toString("utf8");
    expect(serialized).toContain("Safe explicit name");
    for (const marker of [
      "BANNED_PROMPT_MARKER",
      "BANNED_ASSISTANT_MARKER",
      "BANNED_THINKING_MARKER",
      "BANNED_TOOL_MARKER",
      "BANNED_SOURCE_MARKER",
      "BANNED_PATCH_MARKER",
      "BANNED_IMAGE_MARKER"
    ]) expect(serialized).not.toContain(marker);
  });

  it("changes the internal source key only when an authoritative source path changes", async () => {
    const fixture = await createFixture();
    const base = {
      agentDir: fixture.agentDir,
      configuredSessionDir: fixture.sessionDirectory,
      workspaceCwd: fixture.cwd
    };
    expect(createSessionCatalogSourceKey(base)).toBe(createSessionCatalogSourceKey({
      ...base,
      workspaceCwd: join(fixture.root, "other-workspace")
    }));
    expect(createSessionCatalogSourceKey(base)).not.toBe(createSessionCatalogSourceKey({
      ...base,
      configuredSessionDir: join(fixture.root, "other-sessions")
    }));
    expect(createSessionCatalogSourceKey({
      ...base,
      agentDir: join(fixture.root, "A")
    })).not.toBe(createSessionCatalogSourceKey({
      ...base,
      agentDir: join(fixture.root, "Ａ")
    }));
    expect(createSessionCatalogSourceKey({
      ...base,
      agentDir: join(fixture.root, "caf\u00e9")
    })).not.toBe(createSessionCatalogSourceKey({
      ...base,
      agentDir: join(fixture.root, "cafe\u0301")
    }));
  });

  it("reports malformed SDK session files as an incomplete projection", async () => {
    const fixture = await createFixture();
    const valid = SessionManager.create(fixture.cwd, fixture.sessionDirectory);
    valid.appendMessage({ role: "user", content: "valid prompt", timestamp: Date.now() });
    valid.appendMessage(assistantMessage("valid reply", Date.now() + 1));
    await writeFile(join(fixture.sessionDirectory, "malformed.jsonl"), "{not-json}\n", "utf8");

    const discovered = await createSessionCatalogContext({
      agentDir: fixture.agentDir,
      configuredSessionDir: fixture.sessionDirectory,
      workspaceCwd: fixture.cwd
    }).discover();
    expect(discovered).toMatchObject({ incomplete: true, skippedCount: 1 });
    expect(discovered.records).toHaveLength(1);
  });

  it("projects one Catalog row for hard-linked aliases of the same JSONL", async () => {
    const fixture = await createFixture();
    const session = SessionManager.create(fixture.cwd, fixture.sessionDirectory);
    session.appendMessage({ role: "user", content: "hard link", timestamp: Date.now() });
    session.appendMessage(assistantMessage("reply", Date.now() + 1));
    await link(requirePersistedPath(session), join(fixture.sessionDirectory, "hard-link-alias.jsonl"));

    const discovered = await createSessionCatalogContext({
      agentDir: fixture.agentDir,
      configuredSessionDir: fixture.sessionDirectory,
      workspaceCwd: fixture.cwd
    }).discover();

    expect(discovered).toMatchObject({ incomplete: false, skippedCount: 0 });
    expect(discovered.records).toHaveLength(1);
    expect(discovered.records[0]?.id).toBe(session.getSessionId());
    expect([
      "session-file-v1\0",
      "session-file-path-v1\0"
    ].some((prefix) => discovered.records[0]?.fileIdentity.startsWith(prefix))).toBe(true);
  });

  it("reopens and refreshes a Windows Workspace whose path casing changed", async () => {
    const fixture = await createFixture();
    const session = SessionManager.create(fixture.cwd, fixture.sessionDirectory);
    session.appendMessage({ role: "user", content: "restart fixture", timestamp: Date.now() });
    session.appendMessage(assistantMessage("restart reply", Date.now() + 1));
    const sessionPath = await realpath(requirePersistedPath(session));
    const catalogDirectory = join(fixture.root, "restart-catalog");
    const windowsPlatform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    try {
      const initialContext = createSessionCatalogContext({
        agentDir: fixture.agentDir,
        configuredSessionDir: fixture.sessionDirectory,
        workspaceCwd: fixture.cwd
      });
      const initialCatalog = createSessionCatalog({ directory: catalogDirectory });
      await initialCatalog.reconcile(initialContext);
      expect((await initialCatalog.query({ scope: "workspace" }, initialContext)).items)
        .toEqual([expect.objectContaining({ id: session.getSessionId(), path: sessionPath })]);
      await initialCatalog.dispose();

      const restartedCwd = fixture.cwd.toUpperCase();
      expect(restartedCwd).not.toBe(fixture.cwd);
      const restartedContext = createSessionCatalogContext({
        agentDir: fixture.agentDir,
        configuredSessionDir: fixture.sessionDirectory,
        workspaceCwd: restartedCwd
      });
      const restartedCatalog = createSessionCatalog({ directory: catalogDirectory });
      await restartedCatalog.reconcile(restartedContext);

      expect(await restartedCatalog.query({ scope: "workspace" }, restartedContext)).toMatchObject({
        source: "sqlite",
        state: "ready",
        total: 1,
        items: [expect.objectContaining({ id: session.getSessionId(), path: sessionPath })]
      });
      await restartedCatalog.dispose();
    } finally {
      windowsPlatform.mockRestore();
    }
  });

  it("matches Windows namespace and Unicode spellings after restart", async () => {
    const fixture = await createFixture();
    const sessionPath = join(fixture.sessionDirectory, "windows-namespace.jsonl");
    const sessionId = "windows-namespace-session";
    await writeFile(sessionPath, `${JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: "2026-08-13T00:00:00.000Z",
      cwd: "\\\\?\\C:\\Workspace\\Caf\u00e9"
    })}\n`, "utf8");
    const catalogDirectory = join(fixture.root, "namespace-catalog");
    const windowsPlatform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const context = createSessionCatalogContext({
      agentDir: fixture.agentDir,
      configuredSessionDir: fixture.sessionDirectory,
      workspaceCwd: "c:\\workspace\\cafe\u0301"
    });
    const catalog = createSessionCatalog({ directory: catalogDirectory });

    try {
      await catalog.reconcile(context);
      expect(await catalog.query({ scope: "workspace" }, context)).toMatchObject({
        source: "sqlite",
        state: "ready",
        total: 1,
        items: [expect.objectContaining({ id: sessionId, path: await realpath(sessionPath) })]
      });
    } finally {
      await catalog.dispose();
      windowsPlatform.mockRestore();
    }
  });
});

async function createFixture(): Promise<{
  root: string;
  cwd: string;
  agentDir: string;
  sessionDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-discovery-"));
  temporaryRoots.push(root);
  const cwd = join(root, "workspace 中文");
  const agentDir = join(root, "agent");
  const sessionDirectory = join(agentDir, "sessions", "fixture");
  await Promise.all([mkdir(cwd), mkdir(sessionDirectory, { recursive: true })]);
  return { root, cwd, agentDir, sessionDirectory };
}

function assistantMessage(text: string, timestamp: number) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "pi67-test",
    model: "fixture",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop" as const,
    timestamp
  };
}

function requirePersistedPath(session: SessionManager): string {
  const path = session.getSessionFile();
  if (!path) throw new Error("The discovery fixture Session must be persisted.");
  return path;
}
