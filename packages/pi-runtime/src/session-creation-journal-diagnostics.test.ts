import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SessionCreationJournal,
  SESSION_CREATION_JOURNAL_VERSION,
  type SessionCreationJournalEntry,
  type SessionCreationJournalState
} from "./session-creation-journal.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Session creation journal diagnostics", () => {
  it("counts in-memory states without exposing entry content", async () => {
    const journal = new SessionCreationJournal({ cwd: "/workspace/a", agentDir: "/agent" });
    await journal.writeUnlocked(entry(journal, "creation-one", "materializing"));
    await journal.writeUnlocked(entry(journal, "creation-two", "ambiguous"));

    const diagnostics = await journal.diagnostics();
    expect(diagnostics).toMatchObject({
      entryCount: 2,
      stateCounts: { materializing: 1, ambiguous: 1 },
      invalidEntryCount: 0,
      truncated: false
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/creation-one|workspace/u);
  });

  it("ignores other Workspace journals and observes invalid files without moving them", async () => {
    const root = await temporaryRoot();
    const first = new SessionCreationJournal({ cwd: join(root, "workspace-a"), agentDir: join(root, "agent"), storageRoot: root });
    const second = new SessionCreationJournal({ cwd: join(root, "workspace-b"), agentDir: join(root, "agent"), storageRoot: root });
    await first.writeUnlocked(entry(first, "creation-local", "published"));
    await second.writeUnlocked(entry(second, "creation-foreign", "acknowledged"));
    const directory = join(root, "session-creation-journal-v1");
    await writeFile(join(directory, "invalid.json"), "{not-json}\n", "utf8");
    const before = (await readdir(directory)).sort();

    await expect(first.diagnostics()).resolves.toMatchObject({
      entryCount: 1,
      stateCounts: { published: 1, acknowledged: 0 },
      invalidEntryCount: 1,
      truncated: false
    });
    expect((await readdir(directory)).sort()).toEqual(before);
  });

  it("bounds a diagnostic pass and leaves excess entries untouched", async () => {
    const root = await temporaryRoot();
    const journal = new SessionCreationJournal({ cwd: join(root, "workspace"), agentDir: join(root, "agent"), storageRoot: root });
    await journal.writeUnlocked(entry(journal, "creation-valid", "reserved"));
    const directory = join(root, "session-creation-journal-v1");
    await mkdir(directory, { recursive: true });
    const names = Array.from({ length: 2_049 }, (_, index) => `invalid-${String(index).padStart(4, "0")}.json`);
    for (let offset = 0; offset < names.length; offset += 128) {
      await Promise.all(names.slice(offset, offset + 128).map((name) => (
        writeFile(join(directory, name), "invalid\n", "utf8")
      )));
    }
    const before = await readdir(directory);

    const diagnostics = await journal.diagnostics();
    expect(diagnostics.truncated).toBe(true);
    expect(diagnostics.entryCount + diagnostics.invalidEntryCount).toBeLessThanOrEqual(2_048);
    expect(await readdir(directory)).toHaveLength(before.length);
  });
});

function entry(
  journal: SessionCreationJournal,
  creationId: string,
  state: SessionCreationJournalState
): SessionCreationJournalEntry {
  return {
    version: SESSION_CREATION_JOURNAL_VERSION,
    creationId,
    workspaceKey: journal.workspaceKey,
    state,
    createdAt: 1,
    updatedAt: 1
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-journal-diagnostics-"));
  roots.push(root);
  return root;
}
