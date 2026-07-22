const DEFAULT_MAXIMUM_FRAME_BYTES = 4 * 1024 * 1024;

export class LfJsonDecoder {
  #buffer = Buffer.alloc(0);
  #maximumFrameBytes;

  constructor(maximumFrameBytes = DEFAULT_MAXIMUM_FRAME_BYTES) {
    if (!Number.isSafeInteger(maximumFrameBytes) || maximumFrameBytes <= 0) {
      throw new RangeError("maximumFrameBytes must be a positive integer");
    }
    this.#maximumFrameBytes = maximumFrameBytes;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError("Bridge input chunks must be buffers");
    }

    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const values = [];
    for (;;) {
      const lineFeed = this.#buffer.indexOf(0x0a);
      if (lineFeed < 0) break;
      if (lineFeed > this.#maximumFrameBytes) {
        throw new Error(`Bridge frame exceeded ${this.#maximumFrameBytes} bytes`);
      }

      let frame = this.#buffer.subarray(0, lineFeed);
      this.#buffer = this.#buffer.subarray(lineFeed + 1);
      if (frame.at(-1) === 0x0d) frame = frame.subarray(0, -1);
      if (frame.length === 0) continue;
      values.push(JSON.parse(frame.toString("utf8")));
    }

    if (this.#buffer.length > this.#maximumFrameBytes) {
      throw new Error(`Bridge frame exceeded ${this.#maximumFrameBytes} bytes`);
    }
    return values;
  }

  finish() {
    if (this.#buffer.length !== 0) {
      throw new Error(`Bridge input ended with a truncated ${this.#buffer.length} byte frame`);
    }
  }
}

export function validateRequest(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeError("bridge.invalid_request", "Request must be a JSON object");
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw bridgeError("bridge.invalid_request", "Request id must be a non-empty string");
  }
  if (typeof value.action !== "string" || value.action.trim() === "") {
    throw bridgeError("bridge.invalid_request", "Request action must be a non-empty string");
  }
  if (value.params !== undefined && (value.params === null || typeof value.params !== "object" || Array.isArray(value.params))) {
    throw bridgeError("bridge.invalid_request", "Request params must be an object");
  }
  return { id: value.id, action: value.action, params: value.params ?? {} };
}

export function bridgeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function publicError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "bridge.operation_failed",
    message: error instanceof Error ? error.message : "Unknown bridge failure",
  };
}
