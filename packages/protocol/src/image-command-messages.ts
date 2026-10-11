import type {
  ImageBrandKit,
  ImageBrandOperation,
  ImageCandidateListStatus,
  ImageCandidateMode,
  ImageCanvas,
  ImageChangeAuthor,
  ImageDocument,
  ImageEditOperation,
  ImageJobKind,
  ImageJobState,
  ImageSizePreset
} from "@pi67/domain";

// Image workbench commands (ADR 0010). All are Workspace-scoped: the envelope's
// workspaceId plus `projectId` locate the project; renderers never send paths.
// The Host records every renderer-originated change with author `human`.
export interface ImageCommandPayloads {
  "image.project.list": Record<string, never>;
  /** A new project from one staged image attachment (the renderer never sends its path). */
  "image.project.createFromPhoto": { projectId: string; attachmentId: string; headline: string; title?: string };
  "image.project.read": { projectId: string; revision?: number };
  "image.project.history": { projectId: string };
  "image.project.edit": { projectId: string; baseRevision: number; summary: string; operations: ImageEditOperation[]; dryRun?: boolean };
  "image.project.render": { projectId: string; revision?: number; candidateId?: string; previewMax?: number };
  "image.candidate.list": { projectId: string };
  "image.candidate.accept": { projectId: string; candidateId: string; baseRevision: number; summary: string };
  "image.candidate.discard": { projectId: string; candidateId: string; summary: string };
  /** Records which Pi conversation belongs to the project (the image page's dock). */
  "image.project.conversation.set": { projectId: string; conversation: ImageProjectConversation };
  /** Binds a font file the person chose (staged by Main) to the project; never sent by the Agent. */
  "image.project.addFont": { projectId: string; baseRevision: number; attachmentId: string };
  /** Adds an image the person chose (staged by Main) to the project's assets, e.g. as a mask; never sent by the Agent. */
  "image.project.addAsset": { projectId: string; baseRevision: number; attachmentId: string };
  "image.project.checkText": { projectId: string; revision?: number; candidateId?: string };
  /** Derived projects for size presets, each re-laid out from one revision of the source. */
  "image.project.derive": { projectId: string; revision: number; presets: ImageSizePreset[] };
  /** Each row becomes a project beside this one: the revision with the row's words in its text layers (P5). */
  "image.batch.create": { projectId: string; revision: number; rows: { row: number; texts: { layer: string; text: string }[] }[] };
  /** Removes every project of the batch; the source project is never part of it. */
  "image.batch.remove": { batchId: string };
  /** The creative library's brand kit (P5); revision 0 before its first edit. */
  "image.brand.read": Record<string, never>;
  /** Colours and specs set or removed, fonts and logos removed, on the version the page read. */
  "image.brand.edit": { baseRevision: number; operations: ImageBrandOperation[] };
  /** A staged TTF/OTF added to the kit. */
  "image.brand.addFont": { baseRevision: number; attachmentId: string };
  /** A staged PNG/JPEG/WebP added to the kit as a logo. */
  "image.brand.addLogo": { baseRevision: number; name: string; attachmentId: string };
  /** Copies the revision as a template beside it, every text and image layer a slot (P5). */
  "image.template.create": { projectId: string; revision: number };
  /** A new plain project from a template: slot words, and per image slot a staged picture. */
  "image.template.instantiate": { templateId: string; projectId: string; title: string;
    texts: { layer: string; text: string }[]; images: { layer: string; attachmentId: string }[] };
}

/** One preset's outcome: a new project beside the source, or the reason the layout does not fit. */
export type ImageDeriveOutcome =
  | { preset: ImageSizePreset; status: "derived"; projectId: string; title: string; canvas: ImageCanvas; shrunkText: number }
  | { preset: ImageSizePreset; status: "refused"; reason: string };

/** One table row of a batch, numbered from 1 in table order. */
export type ImageBatchRowOutcome =
  | { row: number; status: "created"; projectId: string; title: string; shrunkText: number }
  | { row: number; status: "refused"; reason: string };

/** One published revision as the 历史 tab lists it (newest last). */
export interface ImageRevisionEntry { revision: number; author: ImageChangeAuthor; summary: string; operationCount: number; candidateId?: string; writtenAt: number }

export interface ImageProjectConversation { sessionPath: string; sessionFileIdentity: string }

export interface ImageProjectSummary {
  projectId: string;
  title: string;
  revision: number;
  canvas: ImageCanvas;
  updatedAt: number;
  readyCandidates: number;
  /** For a size derived from another project: which project, revision and preset it came from. */
  derivedFrom?: { projectId: string; revision: number; preset: ImageSizePreset };
  /** Set on a template (its document marks slots). */
  template?: true;
  /** For a project made from a template: which template and revision. */
  fromTemplate?: { projectId: string; revision: number };
  /** For a batch row: the batch, its row and the project and revision it came from. */
  batch?: { batchId: string; row: number; projectId: string; revision: number };
}

export interface ImageCandidateSummary {
  candidateId: string;
  status: ImageCandidateListStatus;
  /** Present for readable candidates. */
  targetId?: string;
  mode?: ImageCandidateMode;
  baseRevision?: number;
  summary?: string;
  outputSha256?: string;
  generated?: boolean;
  protectedChangedPixels?: number;
  /** What the generation receipt records; absent for local composites. Visual quality stays unverified. */
  receipt?: ImageCandidateReceipt;
}

export interface ImageCandidateReceipt { model: string; quality?: string; size?: string; durationMs?: number }

export interface ImageRevisionResult { projectId: string; revision: number; sha256: string; dryRun: boolean }

/** A rendered PNG the renderer reads through Main's `app://` image route by digest. */
export interface ImageRenderResult { projectId: string; revision: number; candidateId?: string; pngSha256: string; width: number; height: number }

export interface ImageCommandResults {
  "image.project.list": { projects: ImageProjectSummary[] };
  "image.project.createFromPhoto": ImageRevisionResult;
  "image.project.read": { projectId: string; revision: number; latestRevision: number; sha256: string; document: ImageDocument; conversation?: ImageProjectConversation };
  "image.project.history": { projectId: string; revisions: ImageRevisionEntry[] };
  "image.project.edit": ImageRevisionResult;
  "image.project.render": ImageRenderResult;
  "image.candidate.list": { projectId: string; candidates: ImageCandidateSummary[] };
  "image.candidate.accept": ImageRevisionResult;
  "image.candidate.discard": { projectId: string; candidateId: string; status: "discarded" };
  "image.project.conversation.set": { projectId: string };
  "image.project.derive": { projectId: string; revision: number; results: ImageDeriveOutcome[] };
  "image.batch.create": { projectId: string; revision: number; batchId: string; results: ImageBatchRowOutcome[] };
  "image.batch.remove": { batchId: string; removed: string[] };
  "image.template.create": { projectId: string; title: string; slots: string[] };
  "image.brand.read": ImageBrandKit;
  "image.brand.edit": ImageBrandKit;
  "image.brand.addFont": ImageBrandKit;
  "image.brand.addLogo": ImageBrandKit;
  "image.template.instantiate": { status: "created"; projectId: string } | { status: "refused"; reason: string };
  "image.project.addFont": ImageRevisionResult & { fontId: string; family: string };
  "image.project.addAsset": ImageRevisionResult & { assetId: string };
  /** Each shown text read back from the full-size render by offline OCR (P4 checkpoint 8). */
  "image.project.checkText": { projectId: string; revision: number; candidateId?: string; texts: ImageTextCheck[] };
}

export interface ImageEventPayloads {
  /** A revision was published by any writer; the renderer re-reads before its next edit. */
  "image.project.changed": { projectId: string; revision: number; sha256: string; author: ImageChangeAuthor };
  "image.candidate.changed": { projectId: string; candidateId: string; status: ImageCandidateListStatus };
  "image.job.changed": { projectId: string; jobId: string; kind: ImageJobKind; state: ImageJobState; progress?: number };
}

/**
 * One text object as read back: `passed` when 90% of its letters and digits and exactly its digits
 * were read; `lowContrast` when its strokes fall below WCAG's minimum for their size (3:1 large, 4.5:1).
 */
export interface ImageTextCheck { objectId: string; text: string; read: string; passed: boolean; contrast?: number; lowContrast: boolean }
