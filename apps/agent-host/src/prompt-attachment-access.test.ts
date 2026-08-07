import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES } from "@pi67/protocol";
import {
  createPromptAttachmentAccessOwner,
  type PromptAttachmentAccessOwner
} from "./prompt-attachment-access.js";
import { MAX_CLAIMED_SETS_PER_TASK } from "./prompt-attachment-claimed-storage.js";

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

  it("revalidates hashes before claim and keeps every draft on a later pre-commit failure", async () => {
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

  it("rejects duplicate or malformed references before creating any claim copy", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "a", "text/plain", "document");
    const task = fixture.owner.forTask("task-a");

    await expect(task.claim("submission-a", [{ id: "draft_a" }, { id: "draft_a" }]))
      .rejects.toThrow("must be unique");
    await expect(task.claim("submission-a", [{ id: "../draft_a" }]))
      .rejects.toThrow("id is invalid");
    await expect(access(join(fixture.root, "draft", "draft_a", "payload.bin"))).resolves.toBeUndefined();
  });

  it("removes a crashed temporary claim before publishing a new stable set", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "a", "text/plain", "document");
    const taskKey = createHash("sha256").update("task-a").digest("hex");
    const submissionKey = createHash("sha256").update("interrupted").digest("hex");
    const temporary = join(
      fixture.root,
      "claimed",
      taskKey,
      `.claim-${submissionKey}-${randomUUID()}`
    );
    await mkdir(join(temporary, "items"), { recursive: true });
    await writeFile(join(temporary, "partial.bin"), "partial", "utf8");

    await expect(fixture.owner.forTask("task-a").claim("submission-a", [{ id: "draft_a" }]))
      .resolves.toBeDefined();

    await expect(access(temporary)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds temporary claim cleanup and preserves the draft until a later retry", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "a", "text/plain", "document");
    const taskDirectory = join(
      fixture.root,
      "claimed",
      createHash("sha256").update("task-a").digest("hex")
    );
    const submissionKey = createHash("sha256").update("interrupted").digest("hex");
    await Promise.all(Array.from({ length: 33 }, async () => {
      await mkdir(join(taskDirectory, `.claim-${submissionKey}-${randomUUID()}`), { recursive: true });
    }));
    const task = fixture.owner.forTask("task-a");

    await expect(task.claim("submission-a", [{ id: "draft_a" }]))
      .rejects.toThrow("cleanup exceeds the bounded limit");
    await expect(access(join(fixture.root, "draft", "draft_a", "payload.bin")))
      .resolves.toBeUndefined();

    await expect(task.claim("submission-a", [{ id: "draft_a" }])).resolves.toBeDefined();
  });

  it("rejects staged manifests with extra fields", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "safe", "text/plain", "document");
    const manifestPath = join(fixture.root, "draft", "draft_a", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.unexpected = "must fail closed";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    await expect(fixture.owner.forTask("task-a").claim("submission-a", [{ id: "draft_a" }]))
      .rejects.toThrow("manifest is invalid");
    await expect(access(join(fixture.root, "draft", "draft_a", "payload.bin")))
      .resolves.toBeUndefined();
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

  it("rejects the full inline-image budget before publishing or removing draft items", async () => {
    const fixture = await createFixture();
    await stageFixture(
      fixture.root,
      "draft_image_large",
      "large.png",
      Buffer.alloc(MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES, 0x89),
      "image/png",
      "image"
    );
    await stageFixture(
      fixture.root,
      "draft_image_overflow",
      "overflow.png",
      Buffer.from([0x89]),
      "image/png",
      "image"
    );

    await expect(fixture.owner.forTask("task-a").claim("submission-image", [
      { id: "draft_image_large" },
      { id: "draft_image_overflow" }
    ])).rejects.toThrow("32 MiB per-prompt limit");

    await expect(access(join(fixture.root, "draft", "draft_image_large", "payload.bin")))
      .resolves.toBeUndefined();
    await expect(access(join(fixture.root, "draft", "draft_image_overflow", "payload.bin")))
      .resolves.toBeUndefined();
  });

  it("revalidates a claimed image immediately before returning its bytes", async () => {
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
    const claimed = await task.claim("submission-image", [{ id: "draft_image" }]);
    if (!claimed) throw new Error("Expected claimed attachment set.");
    const claimedPayload = join(
      fixture.root,
      "claimed",
      createHash("sha256").update("task-a").digest("hex"),
      createHash("sha256").update("submission-image").digest("hex"),
      "items",
      "draft_image",
      "payload.bin"
    );
    await writeFile(claimedPayload, Buffer.from([0x89, 0x50, 0x4e, 0x48]));

    await expect(task.readImages(claimed.id)).rejects.toThrow("integrity check failed");
  });

  it("recovers a claimed attachment set for the same Task after Host replacement", async () => {
    const fixture = await createFixture();
    await stageFixture(
      fixture.root,
      "draft_image",
      "screen.png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      "image/png",
      "image"
    );
    const claimed = await fixture.owner.forTask("task-a")
      .claim("submission-image", [{ id: "draft_image" }]);
    await fixture.owner.dispose();

    const replacement = createPromptAttachmentAccessOwner(fixture.root);
    if (!replacement || !claimed) throw new Error("Expected replacement attachment access.");
    await expect(replacement.forTask("task-a").readImages(claimed.id)).resolves.toEqual([{
      type: "image",
      mimeType: "image/png",
      data: "iVBORw=="
    }]);
    await expect(replacement.forTask("task-b").read({ setId: claimed.id, operation: "list" }))
      .rejects.toThrow("unavailable for this Task");
    await replacement.dispose();
  });

  it("fails closed when a claimed payload changes before Host recovery", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "safe", "text/plain", "document");
    const claimed = await fixture.owner.forTask("task-a")
      .claim("submission-a", [{ id: "draft_a" }]);
    await fixture.owner.dispose();
    if (!claimed) throw new Error("Expected claimed attachment set.");
    const claimedPayload = join(
      fixture.root,
      "claimed",
      createHash("sha256").update("task-a").digest("hex"),
      createHash("sha256").update("submission-a").digest("hex"),
      "items",
      "draft_a",
      "payload.bin"
    );
    await writeFile(claimedPayload, "evil", "utf8");

    const replacement = createPromptAttachmentAccessOwner(fixture.root);
    if (!replacement) throw new Error("Expected replacement attachment access.");
    await expect(replacement.forTask("task-a").read({ setId: claimed.id, operation: "list" }))
      .rejects.toThrow("integrity check failed");
    await replacement.dispose();
  });

  it("rejects claimed manifests and directories with unexpected metadata", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "safe", "text/plain", "document");
    await fixture.owner.forTask("task-a").claim("submission-a", [{ id: "draft_a" }]);
    await fixture.owner.dispose();
    const claimedDirectory = join(
      fixture.root,
      "claimed",
      createHash("sha256").update("task-a").digest("hex"),
      createHash("sha256").update("submission-a").digest("hex")
    );
    const manifestPath = join(claimedDirectory, "set.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.unexpected = "must fail closed";
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

    const replacement = createPromptAttachmentAccessOwner(fixture.root);
    if (!replacement) throw new Error("Expected replacement attachment access.");
    await expect(replacement.forTask("task-a").claim("submission-a", [{ id: "draft_a" }]))
      .rejects.toThrow("manifest is invalid");

    delete manifest.unexpected;
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
    await writeFile(join(claimedDirectory, "unexpected.txt"), "unexpected", "utf8");
    await expect(replacement.forTask("task-a").claim("submission-a", [{ id: "draft_a" }]))
      .rejects.toThrow("directory contents are invalid");
    await replacement.dispose();
  });

  it("removes claimed payloads when their Task is released", async () => {
    const fixture = await createFixture();
    await stageFixture(fixture.root, "draft_a", "a.txt", "safe", "text/plain", "document");
    const task = fixture.owner.forTask("task-a");
    const claimed = await task.claim("submission-a", [{ id: "draft_a" }]);
    if (!claimed) throw new Error("Expected claimed attachment set.");

    await fixture.owner.releaseTask("task-a");

    await expect(task.read({ setId: claimed.id, operation: "list" }))
      .rejects.toThrow("unavailable for this Task");
    await expect(access(join(
      fixture.root,
      "claimed",
      createHash("sha256").update("task-a").digest("hex")
    ))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a new claimed set at the recovery scan limit while replay remains idempotent", async () => {
    const fixture = await createFixture();
    const task = fixture.owner.forTask("task-a");
    let firstSetId: string | undefined;
    for (let index = 0; index < MAX_CLAIMED_SETS_PER_TASK; index += 1) {
      const id = `draft_${index}`;
      const submissionId = `submission_${index}`;
      await stageFixture(fixture.root, id, `${index}.txt`, "x", "text/plain", "document");
      const claimed = await task.claim(submissionId, [{ id }]);
      firstSetId ??= claimed?.id;
    }
    const replay = await task.claim("submission_0", [{ id: "draft_0" }]);
    expect(replay?.id).toBe(firstSetId);

    await stageFixture(fixture.root, "draft_overflow", "overflow.txt", "x", "text/plain", "document");
    await expect(task.claim("submission_overflow", [{ id: "draft_overflow" }]))
      .rejects.toThrow("bounded set limit");
    await expect(access(join(fixture.root, "draft", "draft_overflow", "payload.bin")))
      .resolves.toBeUndefined();

    await fixture.owner.dispose();
    const replacement = createPromptAttachmentAccessOwner(fixture.root);
    if (!replacement || !firstSetId) throw new Error("Expected replacement attachment access.");
    await expect(replacement.forTask("task-a").read({
      setId: firstSetId,
      operation: "list"
    })).resolves.toMatchObject({ details: { setId: firstSetId } });
    await replacement.dispose();
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
