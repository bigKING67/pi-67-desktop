export interface PromptImageNormalizationWorkerTask {
  id: string;
  sourcePath: string;
  sourceByteLength: number;
}

export type PromptImageNormalizationFailureCode =
  | "source_changed"
  | "invalid_heic"
  | "pixel_budget"
  | "decode_failed"
  | "encode_failed"
  | "output_budget";

export type PromptImageNormalizationWorkerResponse =
  | {
      id: string;
      ok: true;
      bytes: ArrayBuffer;
      width: number;
      height: number;
    }
  | {
      id: string;
      ok: false;
      code: PromptImageNormalizationFailureCode;
    };
