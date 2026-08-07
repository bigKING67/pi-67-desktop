import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PROMPT_ATTACHMENT_BYTES,
  MAX_PROMPT_ATTACHMENT_COUNT,
  MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES,
  MAX_PROMPT_ATTACHMENT_TOTAL_BYTES,
  MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES
} from "@pi67/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupStalePromptAttachmentRuns,
  PromptAttachmentStagingService
} from "./prompt-attachment-staging.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("PromptAttachmentStagingService", () => {
  it("reports bounded draft, claimed, invalid, and truncated staging counts", async () => {
    const fixture = await createFixture();
    await Promise.all([
      mkdir(join(fixture.service.draftRoot, "draft-valid"), { recursive: true }),
      mkdir(join(fixture.service.claimedRoot, "claimed-valid"), { recursive: true })
    ]);
    await writeFile(join(fixture.service.draftRoot, "invalid-file"), "invalid", "utf8");

    await expect(fixture.service.diagnostics()).resolves.toEqual({
      draftCount: 1,
      claimedCount: 1,
      invalidEntryCount: 1,
      truncated: false
    });

    await Promise.all(Array.from({ length: 257 }, (_, index) => (
      mkdir(join(fixture.service.claimedRoot, `claimed-${String(index).padStart(3, "0")}`))
    )));
    const truncated = await fixture.service.diagnostics();
    expect(truncated.truncated).toBe(true);
    expect(truncated.claimedCount).toBeLessThanOrEqual(256);
  });

  it("streams a regular path into a private draft with detected metadata and integrity", async () => {
    const fixture = await createFixture();
    const source = join(fixture.parent, "input.txt");
    await writeFile(source, "attachment body", "utf8");
    const selected = await stat(source);

    const [attachment] = await fixture.service.stage([candidate({
      name: "input.txt",
      mimeType: "",
      byteLength: 15,
      lastModified: selected.mtimeMs,
      path: source
    })]);

    expect(attachment).toMatchObject({
      name: "input.txt",
      mimeType: "text/plain",
      byteLength: 15,
      kind: "document"
    });
    if (!attachment) throw new Error("Expected one staged attachment.");
    const directory = join(fixture.service.draftRoot, attachment.id);
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.sha256).toBe("baebb75e3b75608ff9c4483c5c93ae00b989a63378a9d0831fecc26f8c75f90e");
    expect(await readFile(join(directory, "payload.bin"), "utf8")).toBe("attachment body");
    if (process.platform !== "win32") {
      expect((await stat(fixture.service.root)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, "payload.bin"))).mode & 0o777).toBe(0o600);
    }
  });

  it("supports bounded pathless clipboard bytes and releases only draft-owned ids", async () => {
    const fixture = await createFixture();
    const [attachment] = await fixture.service.stage([candidate({
      name: "clipboard.png",
      mimeType: "application/octet-stream",
      byteLength: 8,
      data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).buffer
    })]);
    if (!attachment) throw new Error("Expected one staged attachment.");

    expect(attachment).toMatchObject({ mimeType: "image/png", kind: "image" });
    await fixture.service.release([attachment.id]);
    await expect(access(join(fixture.service.draftRoot, attachment.id))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fixture.service.release(["../outside"])).rejects.toThrow("Prompt attachment id is invalid.");
  });

  it("rejects links, non-regular inputs, changed sizes, and pathless overflows", async () => {
    const fixture = await createFixture();
    const source = join(fixture.parent, "source.txt");
    const link = join(fixture.parent, "source-link.txt");
    await writeFile(source, "safe", "utf8");
    await symlink(source, link);

    await expect(fixture.service.stage([candidate({
      name: "source-link.txt",
      byteLength: 4,
      path: link
    })])).rejects.toThrow("regular file");
    await expect(fixture.service.stage([candidate({
      name: "source.txt",
      byteLength: 3,
      path: source
    })])).rejects.toThrow("changed after it was selected");
    await expect(fixture.service.stage([candidate({
      name: "clipboard.bin",
      byteLength: MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES + 1,
      data: new ArrayBuffer(MAX_PROMPT_PATHLESS_ATTACHMENT_BYTES + 1)
    })])).rejects.toThrow("16 MiB clipboard attachment limit");
  });

  it("rejects a same-size path replacement after the picker metadata was captured", async () => {
    const fixture = await createFixture();
    const source = join(fixture.parent, "selected.txt");
    await writeFile(source, "first", "utf8");
    const selected = await stat(source);
    await writeFile(source, "later", "utf8");
    await utimes(source, new Date(selected.atimeMs), new Date(selected.mtimeMs + 5_000));

    await expect(fixture.service.stage([candidate({
      name: "selected.txt",
      byteLength: 5,
      lastModified: selected.mtimeMs,
      path: source
    })])).rejects.toThrow("changed after it was selected");
    expect(await draftDirectories(fixture.service.draftRoot)).toEqual([]);
  });

  it("bounds native inline image bytes independently from ordinary attachment storage", async () => {
    const fixture = await createFixture();
    const first = pngBuffer(MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES / 2);
    const second = pngBuffer(MAX_PROMPT_INLINE_IMAGE_TOTAL_BYTES / 2);
    const overflow = pngBuffer(4);

    await expect(fixture.service.stage([
      candidate({ name: "first.png", byteLength: first.byteLength, data: first }),
      candidate({ name: "second.png", byteLength: second.byteLength, data: second }),
      candidate({ name: "overflow.png", byteLength: overflow.byteLength, data: overflow })
    ])).rejects.toThrow("32 MiB per-draft limit");
    expect(await draftDirectories(fixture.service.draftRoot)).toEqual([]);
  });

  it("enforces count, per-file, and aggregate limits before writing drafts", async () => {
    const fixture = await createFixture();
    const source = join(fixture.parent, "small.bin");
    await writeFile(source, "x", "utf8");

    await expect(fixture.service.stage(Array.from(
      { length: MAX_PROMPT_ATTACHMENT_COUNT + 1 },
      (_, index) => candidate({ name: `${index}.bin`, byteLength: 1, path: source })
    ))).rejects.toThrow(`1 to ${MAX_PROMPT_ATTACHMENT_COUNT} attachments`);
    await expect(fixture.service.stage([candidate({
      name: "large.bin",
      byteLength: MAX_PROMPT_ATTACHMENT_BYTES + 1,
      path: source
    })])).rejects.toThrow("100 MiB per-file limit");
    await expect(fixture.service.stage([
      candidate({ name: "a.bin", byteLength: MAX_PROMPT_ATTACHMENT_BYTES, path: source }),
      candidate({ name: "b.bin", byteLength: MAX_PROMPT_ATTACHMENT_BYTES, path: source }),
      candidate({
        name: "c.bin",
        byteLength: MAX_PROMPT_ATTACHMENT_TOTAL_BYTES - 2 * MAX_PROMPT_ATTACHMENT_BYTES + 1,
        path: source
      })
    ])).rejects.toThrow("250 MiB per-draft limit");
    expect(await draftDirectories(fixture.service.draftRoot)).toEqual([]);
  });

  it("validates transfer sources and normalizes untrusted optional metadata", async () => {
    const fixture = await createFixture();
    const source = join(fixture.parent, "source.txt");
    await writeFile(source, "x", "utf8");

    await expect(fixture.service.release({})).rejects.toThrow("Invalid prompt attachment release request.");
    await expect(fixture.service.release(Array.from(
      { length: MAX_PROMPT_ATTACHMENT_COUNT + 1 },
      () => "attachment_id"
    ))).rejects.toThrow("Invalid prompt attachment release request.");
    await expect(fixture.service.stage([null] as never)).rejects.toThrow("Attachment file name is invalid.");
    await expect(fixture.service.stage([candidate({
      name: "nested/file.txt",
      byteLength: 1,
      data: new ArrayBuffer(1)
    })])).rejects.toThrow("must not contain a path");
    await expect(fixture.service.stage([candidate({
      name: "missing-source.bin",
      byteLength: 1
    })])).rejects.toThrow("exactly one attachment transfer source");
    await expect(fixture.service.stage([candidate({
      name: "duplicate-source.bin",
      byteLength: 1,
      path: source,
      data: new ArrayBuffer(1)
    })])).rejects.toThrow("exactly one attachment transfer source");
    await expect(fixture.service.stage([candidate({
      name: "relative-path.bin",
      byteLength: 1,
      path: "relative-path.bin"
    })])).rejects.toThrow("valid native file path");
    await expect(fixture.service.stage([candidate({
      name: "inconsistent.bin",
      byteLength: 2,
      data: new ArrayBuffer(1)
    })])).rejects.toThrow("inconsistent clipboard attachment bytes");

    const [normalized] = await fixture.service.stage([{
      name: "metadata.bin",
      mimeType: "x".repeat(129),
      byteLength: 1,
      lastModified: Number.NaN,
      data: new ArrayBuffer(1)
    }]);
    expect(normalized).toMatchObject({
      name: "metadata.bin",
      mimeType: "application/octet-stream",
      kind: "file"
    });
  });

  it("classifies supported attachment formats from magic bytes and bounded metadata", async () => {
    const fixture = await createFixture();
    const attachments = await fixture.service.stage([
      bufferCandidate("photo.bin", [0xff, 0xd8, 0xff]),
      bufferCandidate("animation.bin", [0x47, 0x49, 0x46, 0x38]),
      bufferCandidate("image.bin", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      bufferCandidate("document.bin", [0x25, 0x50, 0x44, 0x46, 0x2d]),
      bufferCandidate("document.docx", [0x50, 0x4b, 0x03, 0x04]),
      bufferCandidate("sheet.xlsx", [0x50, 0x4b, 0x03, 0x04]),
      bufferCandidate("slides.pptx", [0x50, 0x4b, 0x03, 0x04]),
      bufferCandidate("book.epub", [0x50, 0x4b, 0x03, 0x04]),
      bufferCandidate("archive.zip", [0x50, 0x4b, 0x03, 0x04]),
      bufferCandidate("archive.gz", [0x1f, 0x8b]),
      bufferCandidate("track.bin", [0], "audio/wav"),
      bufferCandidate("movie.bin", [0], "video/mp4"),
      bufferCandidate("vector.svg", [0], "image/svg+xml"),
      bufferCandidate("document.rtf", [0]),
      bufferCandidate("archive.tar", [0]),
      bufferCandidate("note.txt", [0]),
      bufferCandidate("unknown.bin", [0])
    ]);

    expect(attachments.map(({ mimeType, kind }) => ({ mimeType, kind }))).toEqual([
      { mimeType: "image/jpeg", kind: "image" },
      { mimeType: "image/gif", kind: "image" },
      { mimeType: "image/webp", kind: "image" },
      { mimeType: "application/pdf", kind: "document" },
      { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" },
      { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "document" },
      { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document" },
      { mimeType: "application/epub+zip", kind: "archive" },
      { mimeType: "application/zip", kind: "archive" },
      { mimeType: "application/gzip", kind: "archive" },
      { mimeType: "audio/wav", kind: "audio" },
      { mimeType: "video/mp4", kind: "video" },
      { mimeType: "image/svg+xml", kind: "file" },
      { mimeType: "application/rtf", kind: "document" },
      { mimeType: "application/x-tar", kind: "archive" },
      { mimeType: "text/plain", kind: "document" },
      { mimeType: "application/octet-stream", kind: "file" }
    ]);
  });

  it("removes the entire run-private root during application cleanup", async () => {
    const fixture = await createFixture();
    await fixture.service.stage([candidate({
      name: "cleanup.txt",
      byteLength: 4,
      data: new TextEncoder().encode("test").buffer
    })]);

    await fixture.service.cleanup();

    await expect(lstat(fixture.service.root)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("quarantines and removes only stale UUID run directories", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pi67-attachment-cleanup-"));
    roots.push(parent);
    const runs = join(parent, "runs");
    const current = "00000000-0000-4000-8000-000000000001";
    const stale = "00000000-0000-4000-8000-000000000002";
    const fresh = "00000000-0000-4000-8000-000000000003";
    await Promise.all([
      mkdir(join(runs, current), { recursive: true }),
      mkdir(join(runs, stale), { recursive: true }),
      mkdir(join(runs, fresh), { recursive: true })
    ]);
    const now = Date.now();
    await Promise.all([
      utimes(join(runs, current), new Date(now - 48 * 60 * 60 * 1_000), new Date(now - 48 * 60 * 60 * 1_000)),
      utimes(join(runs, stale), new Date(now - 48 * 60 * 60 * 1_000), new Date(now - 48 * 60 * 60 * 1_000)),
      utimes(join(runs, fresh), new Date(now), new Date(now))
    ]);

    await expect(cleanupStalePromptAttachmentRuns(runs, current, {
      now,
      createQuarantineId: () => "00000000-0000-4000-8000-000000000004"
    })).resolves.toMatchObject({ removedRunCount: 1, errorCount: 0 });

    await expect(lstat(join(runs, stale))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(runs, current))).resolves.toMatchObject({});
    await expect(lstat(join(runs, fresh))).resolves.toMatchObject({});
  });

  it("refuses links, non-directories, and non-UUID entries during stale cleanup", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pi67-attachment-cleanup-safety-"));
    roots.push(parent);
    const runs = join(parent, "runs");
    const outside = join(parent, "outside");
    const linked = "00000000-0000-4000-8000-000000000010";
    const file = "00000000-0000-4000-8000-000000000011";
    await Promise.all([mkdir(runs), mkdir(outside)]);
    await symlink(outside, join(runs, linked), process.platform === "win32" ? "junction" : "dir");
    await writeFile(join(runs, file), "not a run directory");
    await mkdir(join(runs, "not-a-uuid"));

    await expect(cleanupStalePromptAttachmentRuns(
      runs,
      "00000000-0000-4000-8000-000000000012",
      { staleAfterMs: 0 }
    )).resolves.toMatchObject({ removedRunCount: 0, errorCount: 0 });

    await expect(lstat(outside)).resolves.toMatchObject({});
    await expect(lstat(join(runs, linked))).resolves.toMatchObject({});
    await expect(lstat(join(runs, file))).resolves.toMatchObject({});
  });

  it("bounds each stale-run cleanup pass to sixteen directories", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pi67-attachment-cleanup-bound-"));
    roots.push(parent);
    const runs = join(parent, "runs");
    await mkdir(runs);
    const now = Date.now();
    const runIds = Array.from({ length: 18 }, (_, index) => (
      `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`
    ));
    await Promise.all(runIds.map(async (runId) => {
      const path = join(runs, runId);
      await mkdir(path);
      await utimes(path, new Date(now - 48 * 60 * 60 * 1_000), new Date(now - 48 * 60 * 60 * 1_000));
    }));

    const result = await cleanupStalePromptAttachmentRuns(
      runs,
      "00000000-0000-4000-8000-000000000099",
      { now }
    );

    expect(result).toMatchObject({ removedRunCount: 16, errorCount: 0 });
    expect(await readdir(runs)).toHaveLength(2);
  });
});

function candidate(overrides: {
  name: string;
  byteLength: number;
  path?: string;
  data?: ArrayBuffer;
  mimeType?: string;
  lastModified?: number;
}) {
  return {
    name: overrides.name,
    mimeType: overrides.mimeType ?? "application/octet-stream",
    byteLength: overrides.byteLength,
    lastModified: overrides.lastModified ?? 0,
    ...(overrides.path === undefined ? {} : { path: overrides.path }),
    ...(overrides.data === undefined ? {} : { data: overrides.data })
  };
}

function pngBuffer(byteLength: number): ArrayBuffer {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47]);
  return bytes.buffer;
}

function bufferCandidate(name: string, bytes: number[], mimeType = "") {
  const data = Uint8Array.from(bytes).buffer;
  return candidate({ name, mimeType, byteLength: data.byteLength, data });
}

async function createFixture(): Promise<{
  parent: string;
  service: PromptAttachmentStagingService;
}> {
  const parent = await mkdtemp(join(tmpdir(), "pi67-attachment-staging-"));
  roots.push(parent);
  return {
    parent,
    service: new PromptAttachmentStagingService(join(parent, "run"))
  };
}

async function draftDirectories(root: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
