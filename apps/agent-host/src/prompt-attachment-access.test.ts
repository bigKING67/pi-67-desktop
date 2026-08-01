import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPromptAttachmentAccessOwner,
  type PromptAttachmentAccessOwner
} from "./prompt-attachment-access.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Agent Host prompt attachment access", () => {
  it("atomically claims staged attachments and replays the same submission idempotently", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "notes.txt", "hello attachment", "text/plain", "document");

    const accessForTask = fixture.owner.forTask("task-a");
    const first = await accessForTask.claim("submission-a", [{ id: "draft_a" }]);
    const replay = await accessForTask.claim("submission-a", [{ id: "draft_a" }]);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      attachments: [{ id: "draft_a", name: "notes.txt", kind: "document" }]
    });
    await expect(access(join(fixture.root, "draft", "draft_a"))).rejects.toMatchObject({ code: "ENOENT" });
    const listing = await accessForTask.read({ setId: first!.id, operation: "list" });
    expect(JSON.parse(listing.text)).toEqual(first!.attachments);
  });

  it("rejects submission reuse with different refs and isolates opaque sets by Task", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "a", "text/plain", "document");
    await stageFixture(fixture.root, "draft_b", "b.txt", "b", "text/plain", "document");
    const taskA = fixture.owner.forTask("task-a");
    const taskB = fixture.owner.forTask("task-b");
    const set = await taskA.claim("submission-a", [{ id: "draft_a" }]);

    await expect(taskA.claim("submission-a", [{ id: "draft_b" }]))
      .rejects.toThrow("reused with different prompt attachments");
    await expect(taskB.read({ setId: set!.id, operation: "list" }))
      .rejects.toThrow("unavailable for this Task");
    await expect(access(join(fixture.root, "draft", "draft_b", "payload.bin"))).resolves.toBeUndefined();
  });

  it("revalidates hashes before claim and rolls earlier moves back on a later failure", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_good", "good.txt", "good", "text/plain", "document");
    await stageFixture(fixture.root, "draft_bad", "bad.txt", "before", "text/plain", "document");
    await writeFile(join(fixture.root, "draft", "draft_bad", "payload.bin"), "after!", "utf8");

    await expect(fixture.owner.forTask("task-a").claim("submission-a", [
      { id: "draft_good" },
      { id: "draft_bad" }
    ])).rejects.toThrow("integrity check failed");

    expect(await readFile(join(fixture.root, "draft", "draft_good", "payload.bin"), "utf8")).toBe("good");
    expect(await readFile(join(fixture.root, "draft", "draft_bad", "payload.bin"), "utf8")).toBe("after!");
  });

  it("rejects duplicate or malformed references before moving any draft", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "a", "text/plain", "document");
    const task = fixture.owner.forTask("task-a");

    await expect(task.claim("submission-a", [{ id: "draft_a" }, { id: "draft_a" }]))
      .rejects.toThrow("must be unique");
    await expect(task.claim("submission-a", [{ id: "../draft_a" }]))
      .rejects.toThrow("id is invalid");
    await expect(access(join(fixture.root, "draft", "draft_a", "payload.bin"))).resolves.toBeUndefined();
  });

  it("returns native Pi image content without exposing filesystem paths", async () => {
    const fixture = await createFixture();
    await stageFixture(
      fixture.root,
      "draft_image",
      "screen.png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      "image/png",
      "image"
    );
    const task = fixture.owner.forTask("task-a");
    const set = await task.claim("submission-image", [{ id: "draft_image" }]);

    await expect(task.readImages(set!.id)).resolves.toEqual([{
      type: "image",
      mimeType: "image/png",
      data: "iVBORw=="
    }]);
  });
});

async function createFixture(): Promise<{ root: string; owner: PromptAttachmentAccessOwner }> {
  const root = await mkdtemp(join(tmpdir(), "pi67-host-attachments-"));
  roots.push(root);
  await mkdir(join(root, "draft"), { recursive: true, mode: 0o700 });
  const owner = createPromptAttachmentAccessOwner(root);
  if (!owner) throw new Error("Expected prompt attachment owner.");
  return { root, owner };
}

async function stageFixture(
  root: string,
  id: string,
  name: string,
  content: string | Buffer,
  mimeType: string,
  kind: "image" | "document" | "archive" | "audio" | "video" | "file"
): Promise<void> {
  const directory = join(root, "draft", id);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "payload.bin"), bytes, { mode: 0o600 });
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify({
    version: 1,
    id,
    name,
    mimeType,
    byteLength: bytes.byteLength,
    kind,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    stagedAt: Date.now()
  })}\n`, { encoding: "utf8", mode: 0o600 });
}
