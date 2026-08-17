import { detect } from "chardet";

export const MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES = 64 * 1024;

export function appendBoundedProcessOutput(
  current: Buffer,
  chunk: Buffer,
  maximumBytes = MAX_SKILL_PACK_PROCESS_OUTPUT_BYTES
): Buffer {
  const remaining = maximumBytes - current.byteLength;
  if (remaining <= 0) return current;
  return Buffer.concat([current, chunk.subarray(0, remaining)]);
}

export function decodeSkillPackProcessOutput(
  value: Uint8Array,
  platform: NodeJS.Platform = process.platform
): string {
  const strictUtf8 = decodeUtf8WithoutTrailingPartialSequence(value);
  if (strictUtf8 !== undefined) return strictUtf8;
  if (platform === "win32") {
    const detected = normalizeEncoding(detect(Buffer.from(value)));
    for (const encoding of [detected, "gb18030"]) {
      if (!encoding || encoding === "utf-8") continue;
      try {
        return new TextDecoder(encoding, { fatal: false }).decode(value);
      } catch {
        // Try the deterministic Windows Chinese fallback before lossy UTF-8.
      }
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(value);
}

export function windowsCommandShellArguments(executable: string, arguments_: string[]): string[] {
  const command = [executable, ...arguments_].map(quoteWindowsCommandValue).join(" ");
  // cmd /s strips the first and last quote. The extra outer pair preserves the
  // executable and argument quotes, including paths that contain spaces.
  return ["/d", "/s", "/c", `"${command}"`];
}

function decodeUtf8WithoutTrailingPartialSequence(value: Uint8Array): string | undefined {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const minimumLength = Math.max(0, value.byteLength - 3);
  for (let end = value.byteLength; end >= minimumLength; end -= 1) {
    try {
      return decoder.decode(value.subarray(0, end));
    } catch {
      // A byte-bounded capture can end in the middle of one UTF-8 code point.
    }
  }
  return undefined;
}

function normalizeEncoding(value: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replaceAll("_", "-");
  if (normalized === "ascii" || normalized === "utf8") return "utf-8";
  return normalized;
}

function quoteWindowsCommandValue(value: string): string {
  if (value.includes("\0")) throw new Error("Windows command values cannot contain null bytes.");
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
