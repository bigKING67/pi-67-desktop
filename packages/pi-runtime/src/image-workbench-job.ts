// Builds the creative-craft Image Job v2 that `image_generate` runs from the few
// fields a model can reliably supply. The contract has ~20 required fields
// (brief and route ids, an eleven-part prompt, inspection, rights); asking the
// model to author them made every real run fail validation, so the tool owns
// them and the model states only the intent.

/** The engine's id rule (document.ts): a letter, then up to 63 letters, digits, `-` or `_`. */
export const IMAGE_ID_PATTERN = "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$";

export type ImageJobMode = "edit" | "generate";
export type ImageJobQuality = "low" | "medium" | "high";

export interface ImageJobIntent {
  instruction: string;
  mode: ImageJobMode;
  preserve?: readonly string[] | undefined;
  exclude?: readonly string[] | undefined;
  exactText?: readonly string[] | undefined;
  quality?: ImageJobQuality | undefined;
}

export interface ImageJobBinding {
  jobId: string;
  profile: string;
  surface: string;
  /** The size to request: the target's, or its exact ratio on the model's grid (resampled back by the engine). */
  width: number;
  height: number;
  /** The target asset, the edit's first and only reference. */
  targetAssetId: string;
}

/** A fresh candidate id; also the job id, so receipts and candidates line up. */
export function newCandidateId(now: number = Date.now(), random: () => number = Math.random): string {
  return `cand-${now.toString(36)}-${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

const list = (values: readonly string[] | undefined): string[] => (values ?? []).map((value) => value.trim()).filter(Boolean);

export function buildImageJob(intent: ImageJobIntent, binding: ImageJobBinding): Record<string, unknown> {
  const instruction = intent.instruction.trim();
  if (!instruction) throw new Error("instruction must describe the change or the image to make");
  const edit = intent.mode === "edit";
  const preserve = list(intent.preserve);
  return {
    schema_version: "creative-craft.image-job.v2",
    job_id: binding.jobId,
    brief_id: `brief-${binding.jobId}`,
    direction_id: `direction-${binding.jobId}`,
    selected_route_id: `route-${binding.jobId}`,
    declared_status: "ready",
    provider_profile: binding.profile,
    execution_surface: binding.surface,
    task_type: intent.mode,
    execution_mode: "single_turn",
    intended_use: instruction.slice(0, 200),
    asset_refs: edit ? [binding.targetAssetId] : [],
    canvas: { size: `${binding.width}x${binding.height}`, quality: intent.quality ?? "medium", format: "png", compression: null, background: "opaque", variants: 1 },
    prompt: {
      scene: instruction,
      subject: edit ? "The current image of this layer" : instruction,
      composition: edit ? "Keep the current framing and layout" : "Fill the frame for this layer",
      lighting: edit ? "Consistent with the requested change" : "As described",
      materials_style: edit ? "Match the current image unless the change says otherwise" : "As described",
      exact_text: list(intent.exactText),
      references: edit ? [{ asset_id: binding.targetAssetId, role: "the image being edited", preserve }] : [],
      change: [instruction],
      preserve,
      constraints: ["Output one image at exactly the target size."],
      exclude: list(intent.exclude)
    },
    inspection: ["Does the result follow the instruction?", ...(preserve.length ? ["Is everything in the preserve list unchanged?"] : [])],
    // The tool cannot vouch for rights on the user's behalf.
    rights: { status: "UNVERIFIED", notes: "Assembled by New Money from the user's project; rights not reviewed." }
  };
}
