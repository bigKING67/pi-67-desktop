import type { LucideIcon } from "lucide-react";
import {
  GitBranch,
  History,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Scissors,
  Settings,
  Sparkles
} from "lucide-react";
import { messages } from "../localization/message-catalog.js";
import { compactRendererSession } from "../operation/operation-controller.js";
import { selectSessionModel, reloadSessionResources } from "../session/session-control-controller.js";
import { beginRendererSessionIntent } from "../session/session-lifecycle-controller.js";
import { useShellStore } from "../shell/shell-store.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import { conversationPrimaryTitle } from "../workbench/conversation-title.js";
import { selectConversationSessionSummary, useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { useConversationDialogStore } from "../navigation/conversation-dialog-store.js";
import { renameRendererConversation } from "../navigation/conversation-organization-controller.js";

type PiDesktopActionName =
  | "new"
  | "model"
  | "name"
  | "compact"
  | "resume"
  | "tree"
  | "reload"
  | "settings";

export interface PiDesktopActionDescriptor {
  name: PiDesktopActionName;
  source: "desktop-action";
  description: string;
  argumentHint?: string;
  icon: LucideIcon;
  requirements: {
    connection?: boolean;
    workspace?: boolean;
    session?: boolean;
    idle?: boolean;
    configuredModel?: boolean;
  };
}

export interface PiDesktopActionContext {
  connected: boolean;
  workspaceAvailable: boolean;
  sessionReady: boolean;
  sessionTransitionPending: boolean;
  activeOperation: boolean;
  configuredModels: ReadonlyArray<{ provider: string; id: string; configured: boolean }>;
}

export type PiDesktopActionExecutionResult =
  | { status: "handled" }
  | { status: "blocked"; message: string };

export const PI_DESKTOP_ACTIONS: readonly PiDesktopActionDescriptor[] = [
  action("new", messages.composer.piBuiltins.new, MessageSquarePlus, {
    workspace: true
  }),
  action("model", messages.composer.piBuiltins.model, Sparkles, {
    connection: true,
    session: true,
    idle: true
  }, "<provider/model>"),
  action("name", messages.composer.piBuiltins.name, Pencil, {
    connection: true,
    session: true
  }, "[title]"),
  action("compact", messages.composer.piBuiltins.compact, Scissors, {
    connection: true,
    session: true,
    idle: true
  }, "[instructions]"),
  action("resume", messages.composer.piBuiltins.resume, History, { workspace: true }),
  action("tree", messages.composer.piBuiltins.tree, GitBranch, { session: true }),
  action("reload", messages.composer.piBuiltins.reload, RefreshCw, {
    connection: true,
    session: true,
    idle: true
  }),
  action("settings", messages.composer.piBuiltins.settings, Settings, {})
];

const ACTION_BY_NAME = new Map(PI_DESKTOP_ACTIONS.map((descriptor) => [descriptor.name, descriptor]));

const PI_TUI_BUILTIN_NAMES = new Set([
  "settings", "model", "scoped-models", "export", "import", "share", "copy", "name", "session",
  "changelog", "hotkeys", "fork", "clone", "tree", "trust", "login", "logout", "new", "compact",
  "resume", "reload", "quit"
]);

export function piDesktopAction(name: string): PiDesktopActionDescriptor | undefined {
  return ACTION_BY_NAME.get(name.toLocaleLowerCase() as PiDesktopActionName);
}

export function isPiTuiBuiltinName(name: string): boolean {
  return PI_TUI_BUILTIN_NAMES.has(name.toLocaleLowerCase());
}

export function piDesktopActionUnavailableReason(
  descriptor: PiDesktopActionDescriptor,
  context: PiDesktopActionContext
): string | undefined {
  if (
    context.sessionTransitionPending
    && descriptor.name !== "resume"
    && descriptor.name !== "settings"
  ) return messages.composer.piActionUnavailable.transition;
  if (descriptor.requirements.connection && !context.connected) {
    return messages.composer.piActionUnavailable.disconnected;
  }
  if (descriptor.requirements.workspace && !context.workspaceAvailable) {
    return messages.composer.piActionUnavailable.workspace;
  }
  if (descriptor.requirements.session && !context.sessionReady) {
    return messages.composer.piActionUnavailable.session;
  }
  if (descriptor.requirements.idle && context.activeOperation) {
    return messages.composer.piActionUnavailable.running;
  }
  if (
    descriptor.requirements.configuredModel
    && !context.configuredModels.some((model) => model.configured)
  ) return messages.composer.piActionUnavailable.model;
  return undefined;
}

export async function executePiDesktopAction(
  descriptor: PiDesktopActionDescriptor,
  rawArguments: string,
  context: PiDesktopActionContext
): Promise<PiDesktopActionExecutionResult> {
  const unavailable = piDesktopActionUnavailableReason(descriptor, context);
  if (unavailable) return { status: "blocked", message: unavailable };
  const args = rawArguments.trim();
  if (!["model", "compact", "name"].includes(descriptor.name) && args) {
    return { status: "blocked", message: messages.composer.piActionUnexpectedArguments(`/${descriptor.name}`) };
  }
  switch (descriptor.name) {
    case "new":
      beginRendererSessionIntent();
      return { status: "handled" };
    case "model":
      return executeModelAction(args, context);
    case "name":
      return executeNameAction(args);
    case "compact":
      await compactRendererSession(args || undefined);
      return { status: "handled" };
    case "resume":
      rendererWorkbenchStore.getState().closeSettings();
      useShellStore.getState().openSessionCatalog();
      return { status: "handled" };
    case "tree": {
      rendererWorkbenchStore.getState().closeSettings();
      useShellStore.getState().setSessionTreeDialogOpen(true);
      return { status: "handled" };
    }
    case "reload":
      await reloadSessionResources();
      return { status: "handled" };
    case "settings":
      rendererWorkbenchStore.getState().openSettings("general");
      return { status: "handled" };
  }
}

async function executeNameAction(name: string): Promise<PiDesktopActionExecutionResult> {
  const workbench = rendererWorkbenchStore.getState();
  const task = selectedWorkbenchTask(workbench);
  const conversation = workbench.selectedSurface?.kind === "conversation"
    ? workbench.selectedSurface.conversation
    : undefined;
  if (conversation?.kind !== "session") {
    return { status: "blocked", message: messages.composer.piActionUnavailable.session };
  }
  const session = selectConversationSessionSummary(useSessionCatalogStore.getState(), conversation);
  if (name) {
    const renamed = await renameRendererConversation(conversation.workspaceId, {
      fileIdentity: conversation.sessionFileIdentity,
      path: conversation.sessionPath
    }, name);
    return renamed
      ? { status: "handled" }
      : { status: "blocked", message: "对话名称未能保存。" };
  }
  useConversationDialogStore.getState().openRename({
    workspaceId: conversation.workspaceId,
    fileIdentity: conversation.sessionFileIdentity,
    path: conversation.sessionPath,
    title: task ? conversationPrimaryTitle(task, session) : session?.name ?? "未命名对话",
    nameSource: task?.titleSource === "explicit" ? "explicit" : session?.nameSource ?? "fallback"
  });
  return { status: "handled" };
}

async function executeModelAction(
  target: string,
  context: PiDesktopActionContext
): Promise<PiDesktopActionExecutionResult> {
  if (!target) {
    rendererWorkbenchStore.getState().closeSettings();
    useShellStore.getState().requestModelPicker();
    return { status: "handled" };
  }
  const model = context.configuredModels.find((candidate) => (
    candidate.configured && `${candidate.provider}/${candidate.id}` === target
  ));
  if (!model) return { status: "blocked", message: messages.composer.piModelNotFound(target) };
  await selectSessionModel(model.provider, model.id);
  return { status: "handled" };
}

function action(
  name: PiDesktopActionName,
  description: string,
  icon: LucideIcon,
  requirements: PiDesktopActionDescriptor["requirements"],
  argumentHint?: string
): PiDesktopActionDescriptor {
  return {
    name,
    source: "desktop-action",
    description,
    icon,
    requirements,
    ...(argumentHint ? { argumentHint } : {})
  };
}
