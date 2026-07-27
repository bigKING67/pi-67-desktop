const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface BoundedUtf8 {
  value: string;
  truncated: boolean;
}

export function boundUtf8(value: string, maxBytes: number): BoundedUtf8 {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("maxBytes must be a non-negative safe integer.");
  }
  const output = new Uint8Array(maxBytes);
  const { read, written } = encoder.encodeInto(value, output);
  if (read === value.length) return { value, truncated: false };
  return { value: decoder.decode(output.subarray(0, written)), truncated: true };
}
