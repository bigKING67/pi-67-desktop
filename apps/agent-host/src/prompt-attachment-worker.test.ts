import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import { pack as createTarPack } from "tar-stream";
import { afterEach, describe, expect, it } from "vitest";
import type { PromptAttachmentWorkerTask } from "./prompt-attachment-worker-contract.js";
import { executePromptAttachmentTask } from "./prompt-attachment-worker.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("prompt attachment extraction worker", () => {
  it("reads, searches, truncates, and inspects bounded text or binary content", async () => {
    const fixture = await createFixture();
    const textPath = join(fixture.root, "notes.txt");
    await writeFile(textPath, "first line\nneedle line\nlast line", "utf8");

    await expect(executePromptAttachmentTask(task(fixture, textPath, "notes.txt", "text/plain", "document", "read_text")))
      .resolves.toEqual({ text: "first line\nneedle line\nlast line", truncated: false });
    await expect(executePromptAttachmentTask({
      ...task(fixture, textPath, "notes.txt", "text/plain", "document", "search"),
      query: "needle"
    })).resolves.toEqual({ text: "2: needle line", truncated: false });

    const binaryPath = join(fixture.root, "binary.bin");
    await writeFile(binaryPath, Buffer.from("\0hidden\0VISIBLE-STRING\0", "latin1"));
    const strings = await executePromptAttachmentTask(task(
      fixture,
      binaryPath,
      "binary.bin",
      "application/octet-stream",
      "file",
      "strings"
    ));
    expect(strings.text).toContain("VISIBLE-STRING");
    const bytes = await executePromptAttachmentTask({
      ...task(fixture, binaryPath, "binary.bin", "application/octet-stream", "file", "read_bytes"),
      offset: 1,
      length: 6
    });
    expect(bytes.text).toContain("hex=68696464656e");

    const largePath = join(fixture.root, "large.txt");
    await writeFile(largePath, "中".repeat(20_000), "utf8");
    const large = await executePromptAttachmentTask(task(
      fixture,
      largePath,
      "large.txt",
      "text/plain",
      "document",
      "read_text"
    ));
    expect(large.truncated).toBe(true);
    expect(Buffer.byteLength(large.text, "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(large.text).toContain("Attachment tool output truncated");
  });

  it("lists and reads bounded ZIP, TAR, and GZIP entries while rejecting traversal", async () => {
    const fixture = await createFixture();
    const zipPath = join(fixture.root, "archive.zip");
    await writeFile(zipPath, storedZip([{ name: "docs/readme.txt", data: Buffer.from("zip text") }]));
    const zipTask = task(fixture, zipPath, "archive.zip", "application/zip", "archive", "list_archive");
    const zipList = await executePromptAttachmentTask(zipTask);
    expect(zipList.text).toContain("docs/readme.txt");
    const zipEntry = await executePromptAttachmentTask({
      ...zipTask,
      operation: "read_archive_entry",
      entry: "docs/readme.txt"
    });
    expect(zipEntry).toEqual({ text: "zip text", truncated: false });

    const largeZipPath = join(fixture.root, "large-entry.zip");
    await writeFile(largeZipPath, storedZip([{
      name: "large.txt",
      data: Buffer.from("z".repeat(64 * 1024))
    }]));
    const largeZipEntry = await executePromptAttachmentTask({
      ...task(fixture, largeZipPath, "large-entry.zip", "application/zip", "archive", "read_archive_entry"),
      entry: "large.txt"
    });
    expect(largeZipEntry.truncated).toBe(true);
    expect(largeZipEntry.text).toContain("zzzz");
    expect(largeZipEntry.text).toContain("Attachment tool output truncated");

    const tarBytes = await tarArchive("docs/guide.txt", "tar text");
    const tarPath = join(fixture.root, "archive.tar");
    await writeFile(tarPath, tarBytes);
    const tarTask = task(fixture, tarPath, "archive.tar", "application/x-tar", "archive", "list_archive");
    expect((await executePromptAttachmentTask(tarTask)).text).toContain("docs/guide.txt");
    expect(await executePromptAttachmentTask({
      ...tarTask,
      operation: "read_archive_entry",
      entry: "docs/guide.txt"
    })).toEqual({ text: "tar text", truncated: false });

    const largeTarPath = join(fixture.root, "large-entry.tar");
    await writeFile(largeTarPath, await tarArchive("large.txt", "t".repeat(64 * 1024)));
    const largeTarEntry = await executePromptAttachmentTask({
      ...task(fixture, largeTarPath, "large-entry.tar", "application/x-tar", "archive", "read_archive_entry"),
      entry: "large.txt"
    });
    expect(largeTarEntry.truncated).toBe(true);
    expect(largeTarEntry.text).toContain("tttt");
    expect(largeTarEntry.text).toContain("Attachment tool output truncated");

    const gzipPath = join(fixture.root, "archive.tgz");
    await writeFile(gzipPath, gzipSync(tarBytes));
    const gzipTask = task(fixture, gzipPath, "archive.tgz", "application/gzip", "archive", "list_archive");
    expect((await executePromptAttachmentTask(gzipTask)).text).toContain("docs/guide.txt");

    const unsafePath = join(fixture.root, "unsafe.zip");
    await writeFile(unsafePath, storedZip([{ name: "../escape.txt", data: Buffer.from("unsafe") }]));
    await expect(executePromptAttachmentTask(task(
      fixture,
      unsafePath,
      "unsafe.zip",
      "application/zip",
      "archive",
      "list_archive"
    ))).rejects.toThrow(/unsafe entry path|invalid relative path/u);

    const unsafeSuffixPath = join(fixture.root, "unsafe-suffix.zip");
    await writeFile(unsafeSuffixPath, storedZip([
      { name: "safe.txt", data: Buffer.from("safe") },
      { name: "../suffix.txt", data: Buffer.from("unsafe") }
    ]));
    await expect(executePromptAttachmentTask({
      ...task(fixture, unsafeSuffixPath, "unsafe-suffix.zip", "application/zip", "archive", "read_archive_entry"),
      entry: "safe.txt"
    })).rejects.toThrow(/unsafe entry path|invalid relative path/u);

    const maximumZipPath = join(fixture.root, "maximum.zip");
    const maximumEntries = Array.from({ length: 512 }, (_, index) => ({
      name: `items/${index}.txt`,
      data: index === 511 ? Buffer.from("last allowed entry") : Buffer.alloc(0)
    }));
    await writeFile(maximumZipPath, storedZip(maximumEntries));
    await expect(executePromptAttachmentTask({
      ...task(fixture, maximumZipPath, "maximum.zip", "application/zip", "archive", "read_archive_entry"),
      entry: "items/511.txt"
    })).resolves.toEqual({ text: "last allowed entry", truncated: false });

    const overflowZipPath = join(fixture.root, "overflow.zip");
    await writeFile(overflowZipPath, storedZip([
      ...maximumEntries,
      { name: "items/512.txt", data: Buffer.from("overflow") }
    ]));
    await expect(executePromptAttachmentTask({
      ...task(fixture, overflowZipPath, "overflow.zip", "application/zip", "archive", "read_archive_entry"),
      entry: "items/512.txt"
    })).rejects.toThrow("bounded entry limit");

    const deepZipPath = join(fixture.root, "deep.zip");
    await writeFile(deepZipPath, storedZip([{
      name: `${Array.from({ length: 33 }, () => "nested").join("/")}/file.txt`,
      data: Buffer.from("deep")
    }]));
    await expect(executePromptAttachmentTask(task(
      fixture,
      deepZipPath,
      "deep.zip",
      "application/zip",
      "archive",
      "list_archive"
    ))).rejects.toThrow("unsafe entry path");
  });

  it("extracts Office text and audio metadata from local files", async () => {
    const fixture = await createFixture();
    const docxPath = join(fixture.root, "brief.docx");
    await writeFile(docxPath, storedZip([
      {
        name: "[Content_Types].xml",
        data: Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
      },
      {
        name: "_rels/.rels",
        data: Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
      },
      {
        name: "word/document.xml",
        data: Buffer.from('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Office attachment</w:t></w:r></w:p></w:body></w:document>')
      }
    ]));
    const office = await executePromptAttachmentTask(task(
      fixture,
      docxPath,
      "brief.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "document",
      "read_text"
    ));
    expect(office.text).toContain("Hello Office attachment");

    const wavPath = join(fixture.root, "silence.wav");
    await writeFile(wavPath, wavSilence());
    const metadata = await executePromptAttachmentTask(task(
      fixture,
      wavPath,
      "silence.wav",
      "audio/wav",
      "audio",
      "metadata"
    ));
    expect(JSON.parse(metadata.text)).toMatchObject({
      detectedMimeType: "audio/wav",
      media: { format: "WAVE", channels: 1, sampleRate: 8_000 }
    });
  });

  it("runs standalone image OCR with repository-packaged language data and no network fallback", async () => {
    const fixture = await createFixture();
    const imagePath = join(fixture.root, "pixel.png");
    await writeFile(imagePath, solidPng(32, 16));

    const result = await executePromptAttachmentTask(task(
      fixture,
      imagePath,
      "pixel.png",
      "image/png",
      "image",
      "read_text"
    ));

    expect(result.truncated).toBe(false);
    expect(typeof result.text).toBe("string");
  }, 120_000);
});

async function createFixture(): Promise<{ root: string; ocrDataRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "pi67-attachment-worker-"));
  roots.push(root);
  return { root, ocrDataRoot: join(root, "ocr-data") };
}

function task(
  fixture: { ocrDataRoot: string },
  path: string,
  name: string,
  mimeType: string,
  kind: PromptAttachmentWorkerTask["attachment"]["kind"],
  operation: PromptAttachmentWorkerTask["operation"]
): PromptAttachmentWorkerTask {
  const bytes = readFileSync(path);
  return {
    id: `task_${name.replace(/[^A-Za-z0-9]/gu, "_")}_${operation}`,
    bytes: toArrayBuffer(bytes),
    attachment: {
      id: "attachment_a",
      name,
      mimeType,
      byteLength: bytes.byteLength,
      kind
    },
    operation,
    ocrDataRoot: fixture.ocrDataRoot
  };
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.byteLength);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.byteLength, 18);
    local.writeUInt32LE(entry.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    name.copy(local, 30);
    localParts.push(local, entry.data);

    const central = Buffer.alloc(46 + name.byteLength);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.byteLength, 20);
    central.writeUInt32LE(entry.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.byteLength + entry.data.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function tarArchive(name: string, text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = createTarPack();
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.once("end", () => resolve(Buffer.concat(chunks)));
    archive.once("error", reject);
    archive.entry({ name }, text, (error) => {
      if (error) reject(error);
      else archive.finalize();
    });
  });
}

function wavSilence(): Buffer {
  const sampleRate = 8_000;
  const dataLength = sampleRate;
  const wav = Buffer.alloc(44 + dataLength);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataLength, 40);
  wav.fill(128, 44);
  return wav;
}

function solidPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height, 0xff);
  for (let row = 0; row < height; row += 1) rows[row * (width * 4 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.byteLength);
  return chunk;
}
