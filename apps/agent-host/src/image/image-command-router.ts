import type { AgentCommand, CommandResults, ImageCommandPayloads } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";

export type ImageCommandType = keyof ImageCommandPayloads;

const IMAGE_COMMANDS: ReadonlySet<string> = new Set<ImageCommandType>([
  "image.project.list",
  "image.project.read",
  "image.project.edit",
  "image.project.render",
  "image.candidate.list",
  "image.candidate.accept",
  "image.candidate.discard"
]);

export function isImageCommand(type: string): type is ImageCommandType {
  return IMAGE_COMMANDS.has(type);
}

export interface ImageCommandExecutor {
  execute<T extends ImageCommandType>(workspaceId: string, command: AgentCommand<T>, signal?: AbortSignal): Promise<CommandResults[T]>;
}

/**
 * Used when no engine host is wired (tests, or a Host built without one): every
 * command fails closed with a typed, recoverable refusal so a renderer can never
 * mistake an unavailable engine for an empty library.
 */
export class UnavailableImageCommands implements ImageCommandExecutor {
  execute<T extends ImageCommandType>(_workspaceId: string, command: AgentCommand<T>): Promise<CommandResults[T]> {
    return Promise.reject(new HostCommandError("UNSUPPORTED", "图像引擎尚未在此版本启用。", true, { imageReason: "engine_unavailable", command: command.type }));
  }
}
