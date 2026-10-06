import type { TeamChatAttachment } from "@pi67/domain";
import { ConversationAssetController } from "../conversation/conversation-asset-controller.js";
import { teamChat, teamChatRequest } from "./team-chat-instance.js";
import { createTeamChatUploads } from "./team-chat-uploads.js";

/** The composer's uploads (ADR 0009). */
export const teamChatUploads = createTeamChatUploads({ request: teamChatRequest });

/**
 * Inline images: the conversation asset cache (bounded bytes, Blob URLs released
 * after leaving view), fed by chunked attachment reads through Agent Host.
 */
export const teamChatAttachmentImages = new ConversationAssetController({
  request: async (reference, offset, length) => {
    const read = await teamChatRequest("teamChat.attachment.read", { attachmentId: reference.id, offset, length });
    return {
      assetId: read.attachmentId,
      mimeType: read.contentType,
      byteLength: read.byteLength,
      offset: read.offset,
      data: read.data,
      done: read.done
    };
  }
});

export function teamChatImageReference(attachment: TeamChatAttachment) {
  return { id: attachment.id, byteLength: attachment.byteSize, sessionGeneration: 0 };
}

/** Reads the whole file and asks Main where to save it; false when the user cancels. */
export async function saveTeamChatAttachment(attachment: TeamChatAttachment): Promise<boolean> {
  const bytes = new Uint8Array(attachment.byteSize);
  let offset = 0;
  for (;;) {
    const read = await teamChatRequest("teamChat.attachment.read", { attachmentId: attachment.id, offset });
    if (read.offset !== offset || read.byteLength !== attachment.byteSize) throw new Error("Attachment read out of order.");
    bytes.set(new Uint8Array(read.data), offset);
    offset += read.data.byteLength;
    if (read.done) break;
  }
  return window.pi67.system.saveTeamChatAttachment({ fileName: attachment.fileName, data: bytes.buffer });
}

/** Whose files the tray and image cache hold: another account or team never sees them. */
let owner: string | undefined;
teamChat.store.subscribe((state, previous) => {
  const signedOut = state.connection?.status === "signed-out" && previous.connection?.status !== "signed-out";
  const next = state.directory ? `${state.directory.teamId}\n${state.directory.selfUserId}` : owner;
  if (signedOut || (owner !== undefined && next !== owner)) {
    teamChatUploads.clear();
    teamChatAttachmentImages.clear();
  }
  owner = signedOut ? undefined : next;
});
