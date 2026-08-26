import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import type { ImageData as CanvasImageData } from "@napi-rs/canvas";
import type decodeHeic from "heic-decode";
import {
  assertPromptImageDimensions,
  MAX_PROMPT_HEIC_SOURCE_BYTES,
  PROMPT_HEIC_JPEG_QUALITY
} from "./prompt-image-inspection.js";
import type {
  PromptImageNormalizationFailureCode,
  PromptImageNormalizationWorkerResponse,
  PromptImageNormalizationWorkerTask
} from "./prompt-image-normalization-worker-contract.js";

interface PromptImageNormalizationDependencies {
  decode: typeof decodeHeic;
  canvas: Pick<typeof import("@napi-rs/canvas"), "createCanvas" | "ImageData">;
}

class NormalizationFailure extends Error {
  constructor(readonly code: PromptImageNormalizationFailureCode) {
    super(code);
  }
}

export async function executePromptImageNormalization(
  task: PromptImageNormalizationWorkerTask,
  dependencies?: PromptImageNormalizationDependencies
): Promise<{ bytes: ArrayBuffer; width: number; height: number }> {
  const source = await readSource(task);
  const loaded = dependencies ?? await loadDependencies();
  let images: Awaited<ReturnType<typeof loaded.decode.all>> | undefined;
  try {
    images = await loaded.decode.all({ buffer: source });
  } catch {
    throw new NormalizationFailure("invalid_heic");
  }
  try {
    const image = images[0];
    if (!image) throw new NormalizationFailure("invalid_heic");
    assertDimensions(image.width, image.height);
    let decoded: Awaited<ReturnType<typeof image.decode>>;
    try {
      decoded = await image.decode();
    } catch {
      throw new NormalizationFailure("decode_failed");
    }
    assertDimensions(decoded.width, decoded.height);
    const expectedBytes = decoded.width * decoded.height * 4;
    if (!(decoded.data instanceof Uint8ClampedArray) || decoded.data.byteLength !== expectedBytes) {
      throw new NormalizationFailure("decode_failed");
    }
    let output: Buffer;
    try {
      const canvas = loaded.canvas.createCanvas(decoded.width, decoded.height);
      const context = canvas.getContext("2d", { alpha: false });
      const imageData = new loaded.canvas.ImageData(
        decoded.data,
        decoded.width,
        decoded.height
      ) as CanvasImageData;
      context.putImageData(imageData, 0, 0);
      output = await canvas.encode("jpeg", PROMPT_HEIC_JPEG_QUALITY);
    } catch {
      throw new NormalizationFailure("encode_failed");
    }
    if (output.byteLength === 0 || output.byteLength > MAX_PROMPT_HEIC_SOURCE_BYTES) {
      throw new NormalizationFailure("output_budget");
    }
    const exactBytes = Uint8Array.from(output);
    return {
      bytes: exactBytes.buffer,
      width: decoded.width,
      height: decoded.height
    };
  } finally {
    images.dispose();
  }
}

async function readSource(task: PromptImageNormalizationWorkerTask): Promise<Uint8Array> {
  if (!Number.isSafeInteger(task.sourceByteLength) || task.sourceByteLength <= 0
    || task.sourceByteLength > MAX_PROMPT_HEIC_SOURCE_BYTES) {
    throw new NormalizationFailure("source_changed");
  }
  const handle = await open(task.sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    .catch(() => {
      throw new NormalizationFailure("source_changed");
    });
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== task.sourceByteLength) {
      throw new NormalizationFailure("source_changed");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== task.sourceByteLength) {
      throw new NormalizationFailure("source_changed");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function loadDependencies(): Promise<PromptImageNormalizationDependencies> {
  process.env.DISABLE_SYSTEM_FONTS_LOAD = "1";
  const [decoderModule, canvas] = await Promise.all([
    import("heic-decode"),
    import("@napi-rs/canvas")
  ]);
  return {
    decode: decoderModule.default,
    canvas
  };
}

function assertDimensions(width: number, height: number): void {
  try {
    assertPromptImageDimensions(width, height);
  } catch {
    throw new NormalizationFailure("pixel_budget");
  }
}

if (parentPort) {
  const port = parentPort;
  port.on("message", (task: PromptImageNormalizationWorkerTask) => {
    void executePromptImageNormalization(task).then(
      (result) => {
        const response: PromptImageNormalizationWorkerResponse = {
          id: task.id,
          ok: true,
          ...result
        };
        port.postMessage(response, [response.bytes]);
      },
      (error: unknown) => {
        const response: PromptImageNormalizationWorkerResponse = {
          id: task.id,
          ok: false,
          code: error instanceof NormalizationFailure ? error.code : "decode_failed"
        };
        port.postMessage(response);
      }
    );
  });
}
