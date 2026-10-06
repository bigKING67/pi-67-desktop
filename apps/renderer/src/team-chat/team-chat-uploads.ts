import {
  TEAM_CHAT_ATTACHMENT_LIMITS,
  teamChatAttachmentIsInlineImage,
  teamChatAttachmentRejection,
  type TeamChatAttachment,
  type TeamChatAttachmentRejection
} from "@pi67/domain";
import { createStore } from "zustand/vanilla";
import { teamChatErrorMessage, type TeamChatPort } from "./team-chat-controller.js";

/** A file in the composer tray, uploading until it is stored (ADR 0009). */
export interface TeamChatUpload {
  localId: string;
  conversationId: string;
  fileName: string;
  byteSize: number;
  /** A local Blob URL for images, so the tray and the sending message need no download. */
  previewUrl?: string;
  status: "uploading" | "ready" | "failed";
  sentBytes: number;
  attachment?: TeamChatAttachment;
  error?: string;
}

export interface TeamChatUploadRefusal {
  fileName: string;
  reason: TeamChatAttachmentRejection | "count";
}

interface UploadOptions {
  request: TeamChatPort["request"];
  /** Pixel size of an image, when it can be read. */
  measure?: (file: Blob) => Promise<{ width: number; height: number } | undefined>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  newId?: () => string;
}

/** Local previews kept for sent images until their message is confirmed and scrolled away. */
const MAX_SENT_PREVIEWS = 40;
const MAX_DIMENSION = 20_000;

/**
 * Composer uploads, one file at a time so Agent Host buffers at most one file's bytes.
 * The store holds only presentation state; files stay in a private map.
 */
export function createTeamChatUploads(options: UploadOptions) {
  const store = createStore<{ uploads: readonly TeamChatUpload[] }>(() => ({ uploads: [] }));
  const files = new Map<string, File>();
  const cancelled = new Set<string>();
  /** Previews of sent attachments, by attachment id, oldest first. */
  const sentPreviews = new Map<string, string>();
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const measure = options.measure ?? measureImage;
  const newId = options.newId ?? (() => crypto.randomUUID());
  let queue: Promise<void> = Promise.resolve();

  const patch = (localId: string, change: Partial<TeamChatUpload>) => store.setState((state) => ({
    uploads: state.uploads.map((item) => item.localId === localId ? { ...item, ...change } : item)
  }));
  const current = (localId: string) => store.getState().uploads.find((item) => item.localId === localId);

  const enqueue = (localId: string) => {
    queue = queue.then(() => upload(localId), () => upload(localId));
  };

  async function upload(localId: string): Promise<void> {
    const file = files.get(localId);
    const item = current(localId);
    if (!file || !item || cancelled.delete(localId)) return;
    let attachmentId: string | undefined;
    try {
      const size = item.previewUrl === undefined ? undefined : await measure(file);
      const { attachment } = await options.request("teamChat.attachment.begin", {
        conversationId: item.conversationId,
        fileName: item.fileName,
        byteSize: item.byteSize,
        ...(size === undefined ? {} : size)
      });
      attachmentId = attachment.id;
      let offset = 0;
      while (offset < item.byteSize) {
        if (cancelled.has(localId)) throw new Cancelled();
        const data = await file.slice(offset, offset + TEAM_CHAT_ATTACHMENT_LIMITS.chunk).arrayBuffer();
        offset = (await options.request("teamChat.attachment.chunk", { attachmentId, offset, data })).received;
        patch(localId, { sentBytes: offset });
      }
      if (cancelled.has(localId)) throw new Cancelled();
      const stored = await options.request("teamChat.attachment.finish", { attachmentId });
      patch(localId, { status: "ready", sentBytes: item.byteSize, attachment: stored.attachment });
    } catch (error) {
      if (attachmentId !== undefined) void options.request("teamChat.attachment.discard", { attachmentId }).catch(() => undefined);
      if (error instanceof Cancelled) cancelled.delete(localId);
      else patch(localId, { status: "failed", error: teamChatErrorMessage(error) });
    }
  }

  function forget(item: TeamChatUpload, keepPreview: boolean): void {
    files.delete(item.localId);
    // A queued or running upload stops at its next step.
    if (item.status === "uploading") cancelled.add(item.localId);
    if (item.previewUrl === undefined) return;
    if (keepPreview && item.attachment) {
      sentPreviews.set(item.attachment.id, item.previewUrl);
      for (const [id, url] of sentPreviews) {
        if (sentPreviews.size <= MAX_SENT_PREVIEWS) break;
        sentPreviews.delete(id);
        revokeObjectUrl(url);
      }
    } else {
      revokeObjectUrl(item.previewUrl);
    }
  }

  return {
    store,
    /** Adds what fits; returns what was refused and why. */
    add(conversationId: string, picked: readonly File[]): TeamChatUploadRefusal[] {
      const refused: TeamChatUploadRefusal[] = [];
      let count = store.getState().uploads.filter((item) => item.conversationId === conversationId).length;
      const added: TeamChatUpload[] = [];
      for (const file of picked) {
        const reason = teamChatAttachmentRejection({ name: file.name, size: file.size });
        if (reason !== undefined || count >= TEAM_CHAT_ATTACHMENT_LIMITS.perMessage) {
          refused.push({ fileName: file.name, reason: reason ?? "count" });
          continue;
        }
        count += 1;
        const localId = newId();
        files.set(localId, file);
        added.push({
          localId, conversationId, fileName: file.name.trim(), byteSize: file.size, status: "uploading", sentBytes: 0,
          ...(teamChatAttachmentIsInlineImage({ contentType: file.type }) ? { previewUrl: createObjectUrl(file) } : {})
        });
      }
      if (added.length > 0) {
        store.setState((state) => ({ uploads: [...state.uploads, ...added] }));
        for (const item of added) enqueue(item.localId);
      }
      return refused;
    },
    remove(localId: string): void {
      const item = current(localId);
      if (!item) return;
      forget(item, false);
      store.setState((state) => ({ uploads: state.uploads.filter((entry) => entry.localId !== localId) }));
    },
    retry(localId: string): void {
      const item = current(localId);
      if (item?.status !== "failed") return;
      store.setState((state) => ({
        uploads: state.uploads.map((entry) => {
          if (entry.localId !== localId) return entry;
          const { error: _error, ...rest } = entry;
          return { ...rest, status: "uploading" as const, sentBytes: 0 };
        })
      }));
      enqueue(localId);
    },
    /** Hands the stored files to a message and empties the tray; undefined while any is unfinished. */
    take(conversationId: string): TeamChatAttachment[] | undefined {
      const tray = store.getState().uploads.filter((item) => item.conversationId === conversationId);
      if (tray.some((item) => item.status !== "ready")) return undefined;
      for (const item of tray) forget(item, true);
      store.setState((state) => ({ uploads: state.uploads.filter((item) => item.conversationId !== conversationId) }));
      return tray.map((item) => item.attachment!);
    },
    /** A local image of a just-sent attachment, before any download. */
    sentPreview: (attachmentId: string): string | undefined => sentPreviews.get(attachmentId),
    /** Sign-out: forget every file and preview. */
    clear(): void {
      for (const item of store.getState().uploads) forget(item, false);
      for (const url of sentPreviews.values()) revokeObjectUrl(url);
      sentPreviews.clear();
      store.setState({ uploads: [] });
    }
  };
}

class Cancelled extends Error {}

async function measureImage(file: Blob): Promise<{ width: number; height: number } | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    const fits = (value: number) => value >= 1 && value <= MAX_DIMENSION;
    return fits(size.width) && fits(size.height) ? size : undefined;
  } catch {
    return undefined;
  }
}
