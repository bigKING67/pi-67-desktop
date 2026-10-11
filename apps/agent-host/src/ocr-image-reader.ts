import { prepareOcrData } from "./ocr-language-data.js";

const READ_TIMEOUT_MS = 60_000;
// One image read at a time in the Host: each loads its own tesseract engine and language data.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Reads the words in each image with the bundled offline tesseract (Simplified Chinese and
 * English), one engine for the whole batch. Never retried with a model or the network;
 * cancelled or past 60 seconds, the engine is stopped at once.
 */
export function readImageTexts(ocrDataRoot: string, images: readonly Buffer[], signal?: AbortSignal): Promise<string[]> {
  const run = queue.then(() => read(ocrDataRoot, images, signal));
  queue = run.catch(() => undefined);
  return run;
}

async function read(ocrDataRoot: string, images: readonly Buffer[], signal: AbortSignal | undefined): Promise<string[]> {
  signal?.throwIfAborted();
  if (!images.length) return [];
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["chi_sim", "eng"], undefined, { langPath: await prepareOcrData(ocrDataRoot), gzip: true, cacheMethod: "none" });
  let timer: NodeJS.Timeout | undefined, onAbort: (() => void) | undefined;
  try {
    const stopped = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Reading the text took too long")), READ_TIMEOUT_MS);
      onAbort = () => reject(new Error("Reading the text was cancelled"));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    const reading = (async () => {
      const texts: string[] = [];
      for (const image of images) texts.push((await worker.recognize(image)).data.text);
      return texts;
    })();
    return await Promise.race([reading, stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    await worker.terminate();
  }
}
