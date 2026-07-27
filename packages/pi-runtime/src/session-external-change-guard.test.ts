import { appendFile, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionExternalChangeGuard } from "./session-external-change-guard.js";

const temporaryDirectories: string[] = [];
const guards: SessionExternalChangeGuard[] = [];

afterEach(async () => {
  for (const guard of guards.splice(0)) guard.detach();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SessionExternalChangeGuard", () => {
  it("emits a path-free conflict, aborts an active turn and blocks later writes", async () => {
    const { path, records } = await createSessionFile();
    const abort = vi.fn(async () => undefined);
    const session = createSession(path, records, abort, true);
    const events: AgentEvent[] = [];
    const guard = createGuard();
    await guard.bind(session, 1, (event) => events.push(event));

    await appendFile(path, `${JSON.stringify(entry("external-entry"))}\n`);
    await vi.waitFor(() => {
      expect(events).toEqual([{
        type: "session.externalChangeDetected",
        payload: { reason: "appended", recoverable: true }
      }]);
      expect(abort).toHaveBeenCalledTimes(1);
    }, { timeout: 1_000 });

    await expect(guard.assertUnchanged(session)).rejects.toMatchObject({
      code: "SESSION_CHANGED_EXTERNALLY",
      recoverable: true,
      details: { reason: "appended", retryable: true }
    });
    expect(JSON.stringify(events)).not.toContain(path);
  });

  it("marks malformed JSONL as non-recoverable without aborting an idle Session", async () => {
    const { path, records } = await createSessionFile();
    const abort = vi.fn(async () => undefined);
    const session = createSession(path, records, abort, false);
    const guard = createGuard();
    await guard.bind(session, 1, vi.fn());

    await appendFile(path, "{not-json}\n");

    await expect(guard.assertUnchanged(session)).rejects.toMatchObject({
      code: "SESSION_CHANGED_EXTERNALLY",
      recoverable: false,
      details: { reason: "invalid", retryable: false }
    });
    expect(abort).not.toHaveBeenCalled();
  });
});

function createGuard(): SessionExternalChangeGuard {
  const guard = new SessionExternalChangeGuard();
  guards.push(guard);
  return guard;
}

function createSession(
  path: string,
  records: Array<Record<string, unknown>>,
  abort: () => Promise<void>,
  isStreaming: boolean
): AgentSession {
  return {
    sessionFile: path,
    sessionManager: {
      getHeader: () => records[0],
      getEntries: () => records.slice(1)
    },
    isStreaming,
    abort
  } as unknown as AgentSession;
}

async function createSessionFile() {
  const created = await mkdtemp(join(tmpdir(), "pi67-external-guard-"));
  const root = await realpath(created);
  temporaryDirectories.push(root);
  const path = join(root, "session.jsonl");
  const records = [header()];
  await writeFile(path, `${JSON.stringify(records[0])}\n`);
  return { path, records };
}

function header(): Record<string, unknown> {
  return {
    type: "session",
    version: 3,
    id: "session-1",
    timestamp: "2026-07-25T00:00:00.000Z",
    cwd: "/workspace"
  };
}

function entry(id: string): Record<string, unknown> {
  return {
    type: "session_info",
    id,
    parentId: null,
    timestamp: "2026-07-25T00:00:01.000Z",
    name: "External writer"
  };
}
