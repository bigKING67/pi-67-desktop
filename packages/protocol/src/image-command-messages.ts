import type {
  ImageCandidateListStatus,
  ImageCandidateMode,
  ImageCanvas,
  ImageChangeAuthor,
  ImageDocument,
  ImageEditOperation,
  ImageJobKind,
  ImageJobState
} from "@pi67/domain";

// Image workbench commands (ADR 0010). All are Workspace-scoped: the envelope's
// workspaceId plus `projectId` locate the project; renderers never send paths.
// The Host records every renderer-originated change with author `human`.
export interface ImageCommandPayloads {
  "image.project.list": Record<string, never>;
  /** A new project from one staged image attachment (the renderer never sends its path). */
  "image.project.createFromPhoto": { projectId: string; attachmentId: string; headline: string; title?: string };
  "image.project.read": { projectId: string; revision?: number };
  "image.project.edit": { projectId: string; baseRevision: number; summary: string; operations: ImageEditOperation[]; dryRun?: boolean };
  "image.project.render": { projectId: string; revision?: number; candidateId?: string; previewMax?: number };
  "image.candidate.list": { projectId: string };
  "image.candidate.accept": { projectId: string; candidateId: string; baseRevision: number; summary: string };
  "image.candidate.discard": { projectId: string; candidateId: string; summary: string };
}

export interface ImageProjectSummary {
  projectId: string;
  title: string;
  revision: number;
  canvas: ImageCanvas;
  updatedAt: number;
  readyCandidates: number;
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
}

export interface ImageRevisionResult { projectId: string; revision: number; sha256: string; dryRun: boolean }

/** A rendered PNG the renderer reads through Main's `app://` image route by digest. */
export interface ImageRenderResult { projectId: string; revision: number; candidateId?: string; pngSha256: string; width: number; height: number }

export interface ImageCommandResults {
  "image.project.list": { projects: ImageProjectSummary[] };
  "image.project.createFromPhoto": ImageRevisionResult;
  "image.project.read": { projectId: string; revision: number; latestRevision: number; sha256: string; document: ImageDocument };
  "image.project.edit": ImageRevisionResult;
  "image.project.render": ImageRenderResult;
  "image.candidate.list": { projectId: string; candidates: ImageCandidateSummary[] };
  "image.candidate.accept": ImageRevisionResult;
  "image.candidate.discard": { projectId: string; candidateId: string; status: "discarded" };
}

export interface ImageEventPayloads {
  /** A revision was published by any writer; the renderer re-reads before its next edit. */
  "image.project.changed": { projectId: string; revision: number; sha256: string; author: ImageChangeAuthor };
  "image.candidate.changed": { projectId: string; candidateId: string; status: ImageCandidateListStatus };
  "image.job.changed": { projectId: string; jobId: string; kind: ImageJobKind; state: ImageJobState; progress?: number };
}
