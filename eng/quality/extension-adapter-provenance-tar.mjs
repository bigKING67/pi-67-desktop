import { gunzipSync } from "node:zlib";

const TAR_BLOCK_BYTES = 512;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_BYTES = 8;

export function readNpmTarballFiles(compressed, limits) {
  if (!(compressed instanceof Uint8Array) || compressed.byteLength === 0) {
    throw new Error("npm tarball must be non-empty bytes");
  }
  if (compressed.byteLength > limits.compressedBytes) {
    throw new Error(`npm tarball exceeds ${limits.compressedBytes} compressed bytes`);
  }

  const archive = gunzipSync(compressed, { maxOutputLength: limits.archiveBytes });
  const files = new Map();
  let offset = 0;
  let pendingLongPath;
  let globalPax = {};
  let pendingPax = {};
  let entries = 0;

  while (offset + TAR_BLOCK_BYTES <= archive.byteLength) {
    const header = archive.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (isZeroBlock(header)) break;
    verifyHeaderChecksum(header);
    entries += 1;
    if (entries > limits.entries) throw new Error(`npm tarball exceeds ${limits.entries} entries`);

    const size = readTarNumber(header.subarray(124, 136));
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes) {
      throw new Error(`npm tarball entry has invalid or oversized size ${String(size)}`);
    }
    const dataStart = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.byteLength) throw new Error("npm tarball entry exceeds archive bounds");
    const data = archive.subarray(dataStart, dataEnd);
    const type = String.fromCharCode(header[156] ?? 0);
    const headerPath = joinTarPath(
      readTarString(header.subarray(345, 500)),
      readTarString(header.subarray(0, 100))
    );

    if (type === "g") {
      const metadata = readPax(data);
      if (Object.hasOwn(metadata, "path")) {
        throw new Error("npm tarball contains unsupported global PAX path metadata");
      }
      globalPax = { ...globalPax, ...metadata };
    } else if (type === "x") {
      pendingPax = { ...pendingPax, ...readPax(data) };
    } else if (type === "L") {
      pendingLongPath = readNullTerminatedUtf8(data).replace(/\n$/u, "");
    } else if (type === "0" || type === "\0") {
      const path = canonicalTarPath(pendingPax.path ?? pendingLongPath ?? headerPath);
      if (files.has(path)) throw new Error(`npm tarball contains duplicate file ${path}`);
      files.set(path, Buffer.from(data));
      pendingLongPath = undefined;
      pendingPax = {};
    } else if (type === "5") {
      pendingLongPath = undefined;
      pendingPax = {};
    } else if (type === "1" || type === "2") {
      throw new Error(`npm tarball contains unsupported link entry ${headerPath}`);
    } else {
      pendingLongPath = undefined;
      pendingPax = {};
    }

    offset = dataStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }

  if (!files.has("package/package.json")) {
    throw new Error("npm tarball is missing package/package.json");
  }
  return files;
}

function verifyHeaderChecksum(header) {
  const expected = readTarNumber(header.subarray(CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_BYTES));
  let actual = 0;
  for (let index = 0; index < header.byteLength; index += 1) {
    actual += index >= CHECKSUM_OFFSET && index < CHECKSUM_OFFSET + CHECKSUM_BYTES
      ? 32
      : header[index] ?? 0;
  }
  if (actual !== expected) throw new Error("npm tarball contains an invalid header checksum");
}

function readTarNumber(bytes) {
  if ((bytes[0] ?? 0) & 0x80) {
    let value = BigInt((bytes[0] ?? 0) & 0x7f);
    for (const byte of bytes.subarray(1)) value = (value << 8n) | BigInt(byte);
    return Number(value);
  }
  const text = readTarString(bytes).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/u.test(text)) return Number.NaN;
  return Number.parseInt(text, 8);
}

function readPax(bytes) {
  const fields = {};
  let offset = 0;
  while (offset < bytes.byteLength) {
    const space = bytes.indexOf(32, offset);
    if (space < 0) throw new Error("npm tarball contains malformed PAX metadata");
    const lengthText = Buffer.from(bytes.subarray(offset, space)).toString("ascii");
    const length = Number.parseInt(lengthText, 10);
    if (!/^[1-9][0-9]*$/u.test(lengthText)
      || !Number.isSafeInteger(length)
      || length <= 0
      || offset + length > bytes.byteLength
      || bytes[offset + length - 1] !== 10) {
      throw new Error("npm tarball contains malformed PAX length");
    }
    const record = bytes.subarray(space + 1, offset + length - 1);
    const equals = record.indexOf(61);
    if (equals > 0) {
      const key = new TextDecoder("utf-8", { fatal: true }).decode(record.subarray(0, equals));
      const value = new TextDecoder("utf-8", { fatal: true }).decode(record.subarray(equals + 1));
      fields[key] = value;
    }
    offset += length;
  }
  return fields;
}

function canonicalTarPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new Error("npm tarball contains an invalid path");
  }
  const normalized = value.replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (normalized.startsWith("/")
    || normalized.includes("\\")
    || containsControlCharacter(normalized)
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`npm tarball contains unsafe path ${value}`);
  }
  return normalized;
}

function joinTarPath(prefix, name) {
  return prefix ? `${prefix}/${name}` : name;
}

function readTarString(bytes) {
  return readNullTerminatedUtf8(bytes);
}

function readNullTerminatedUtf8(bytes) {
  const end = bytes.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function isZeroBlock(bytes) {
  return bytes.every((byte) => byte === 0);
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
