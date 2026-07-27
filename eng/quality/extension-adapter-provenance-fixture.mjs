import { gzipSync } from "node:zlib";

const BLOCK_BYTES = 512;

export function createTarball(entries) {
  return gzipSync(createTarArchive(entries));
}

export function createTarArchive(entries) {
  const blocks = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "", "utf8");
    const header = createHeader(entry.path, data.byteLength, entry.type ?? "0", entry.linkName);
    blocks.push(header, data);
    const padding = Math.ceil(data.byteLength / BLOCK_BYTES) * BLOCK_BYTES - data.byteLength;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(BLOCK_BYTES * 2));
  return Buffer.concat(blocks);
}

export function createPaxPathRecord(path) {
  const body = `path=${path}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (true) {
    const record = `${length} ${body}`;
    const bytes = Buffer.from(record, "utf8");
    if (bytes.byteLength === length) return bytes;
    length = bytes.byteLength;
  }
}

function createHeader(path, size, type, linkName = "") {
  if (Buffer.byteLength(path) > 100) throw new Error(`fixture tar path is too long: ${path}`);
  const header = Buffer.alloc(BLOCK_BYTES);
  writeString(header, path, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(32, 148, 156);
  header[156] = type.charCodeAt(0);
  writeString(header, linkName, 157, 100);
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, "pi67", 265, 32);
  writeString(header, "pi67", 297, 32);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeChecksum(header, checksum);
  return header;
}

function writeString(target, value, offset, length) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > length) throw new Error(`fixture tar field exceeds ${length} bytes`);
  bytes.copy(target, offset);
}

function writeOctal(target, value, offset, length) {
  const text = value.toString(8).padStart(length - 1, "0");
  writeString(target, `${text}\0`, offset, length);
}

function writeChecksum(target, value) {
  const text = value.toString(8).padStart(6, "0");
  writeString(target, `${text}\0 `, 148, 8);
}
