export function isEnvelopeWithinByteLimit(value: unknown, maxBytes: number): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return false;
  const ancestors = new WeakSet<object>();
  let bytes = 0;
  const add = (amount: number): boolean => {
    bytes += amount;
    return bytes <= maxBytes;
  };

  const visit = (candidate: unknown): boolean => {
    if (candidate === null) return add(4);
    if (typeof candidate === "string") return add(jsonStringByteLength(candidate));
    if (typeof candidate === "number") return add(Number.isFinite(candidate) ? String(candidate).length : 4);
    if (typeof candidate === "boolean") return add(candidate ? 4 : 5);
    if (candidate instanceof ArrayBuffer) return add(2);
    if (typeof candidate !== "object" || ancestors.has(candidate)) return false;
    ancestors.add(candidate);

    if (Array.isArray(candidate)) {
      if (!add(2 + Math.max(0, candidate.length - 1))) {
        ancestors.delete(candidate);
        return false;
      }
      for (const item of candidate) {
        if (!visit(item)) {
          ancestors.delete(candidate);
          return false;
        }
      }
      ancestors.delete(candidate);
      return true;
    }

    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(candidate);
    } catch {
      ancestors.delete(candidate);
      return false;
    }
    if (!add(2 + Math.max(0, entries.length - 1))) {
      ancestors.delete(candidate);
      return false;
    }
    for (const [key, child] of entries) {
      if (!add(jsonStringByteLength(key) + 1) || !visit(child)) {
        ancestors.delete(candidate);
        return false;
      }
    }
    ancestors.delete(candidate);
    return true;
  };

  return visit(value);
}

function jsonStringByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
