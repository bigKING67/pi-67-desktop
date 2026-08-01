import type { OperationView, SessionSummary } from "@pi67/domain";
import type { SlashCommandDescriptor } from "@pi67/protocol";
import {
  Command,
  DownloadCloud,
  HeartPulse,
  KeyRound,
  MessageSquareText,
  PackageOpen,
  RefreshCw,
  Scissors
} from "lucide-react";
import { formatRelativeTime } from "../localization/date-time.js";
import { messages } from "../localization/message-catalog.js";
import {
  MAX_EXTENSION_CANDIDATES,
  MAX_SESSION_CANDIDATES,
  type PaletteAction
} from "./command-palette-model.js";

export interface PaletteAvailability {
  connected: boolean;
  sessionReady: boolean;
  sessionTransitionPending: boolean;
  activeOperation: boolean;
}

export interface PaletteActionHandlers {
  openSession: (path: string) => Promise<void> | void;
  invokeCommand: (name: string) => Promise<void> | void;
  reloadResources: () => Promise<void> | void;
  compactSession: () => Promise<void> | void;
  openProvider: () => void;
  runDoctor: () => Promise<void> | void;
  openUpdate: () => void;
  saveDiagnostics: () => Promise<void> | void;
}

interface BuildPaletteActionsOptions {
  sessions: readonly SessionSummary[];
  extensionCommands: readonly SlashCommandDescriptor[];
  activeSessionPath: string | undefined;
  availability: PaletteAvailability;
  handlers: PaletteActionHandlers;
}

const ACTIVE_OPERATION_LIFECYCLES = new Set<OperationView["lifecycle"]>([
  "submitting",
  "accepted",
  "running",
  "waiting-input"
]);

export function paletteAvailability(options: {
  connected: boolean;
  sessionReady: boolean;
  sessionTransitionPending: boolean;
  operation: OperationView | undefined;
}): PaletteAvailability {
  return {
    connected: options.connected,
    sessionReady: options.sessionReady,
    sessionTransitionPending: options.sessionTransitionPending,
    activeOperation: Boolean(options.operation && ACTIVE_OPERATION_LIFECYCLES.has(options.operation.lifecycle))
  };
}

export function buildPaletteActions(options: BuildPaletteActionsOptions): PaletteAction[] {
  const sessionMutationReason = unavailableReason(options.availability, { session: true, idleOperation: true });
  const hostQueryReason = unavailableReason(options.availability, { connection: true });
  const sessionActions = options.sessions.slice(0, MAX_SESSION_CANDIDATES).map((session): PaletteAction => {
    const current = session.path === options.activeSessionPath;
    const disabledReason = current ? messages.commandPalette.currentSession : sessionMutationReason;
    return {
      id: `session:${session.path}`,
      group: "sessions",
      label: session.name,
      detail: current
        ? messages.commandPalette.currentSessionDetail(session.messageCount)
        : messages.commandPalette.sessionDetail(
            session.messageCount,
            formatPaletteRelative(session.modifiedAt)
          ),
      keywords: `${session.id} ${session.path} ${session.cwd}`,
      icon: MessageSquareText,
      ...(disabledReason ? { disabled: true, disabledReason } : {}),
      run: () => options.handlers.openSession(session.path)
    };
  });
  const extensionActions = options.extensionCommands
    .slice(0, MAX_EXTENSION_CANDIDATES)
    .map((command): PaletteAction => ({
      id: `extension:${command.name}`,
      group: "extensions",
      label: `/${command.name}`,
      detail: commandDetail(command),
      keywords: `extension slash command ${command.name} ${command.adapter?.package ?? ""} ${command.adapter?.label ?? ""}`,
      icon: Command,
      ...(sessionMutationReason ? { disabled: true, disabledReason: sessionMutationReason } : {}),
      run: () => options.handlers.invokeCommand(command.name)
    }));
  return [
    ...sessionActions,
    ...extensionActions,
    mutationAction({
      id: "action:reload",
      label: messages.commandPalette.reloadResources,
      detail: messages.commandPalette.reloadResourcesDetail,
      keywords: "reload refresh resources skills prompts extensions context",
      icon: RefreshCw,
      ...(sessionMutationReason ? { disabledReason: sessionMutationReason } : {}),
      run: options.handlers.reloadResources
    }),
    mutationAction({
      id: "action:compact",
      label: messages.commandPalette.compactSession,
      detail: messages.commandPalette.compactSessionDetail,
      keywords: "compact context token",
      icon: Scissors,
      ...(sessionMutationReason ? { disabledReason: sessionMutationReason } : {}),
      run: options.handlers.compactSession
    }),
    {
      id: "settings:provider",
      group: "settings",
      label: messages.commandPalette.credentials,
      detail: messages.commandPalette.credentialsDetail,
      keywords: "provider credentials api key model authentication",
      icon: KeyRound,
      run: options.handlers.openProvider
    },
    mutationAction({
      id: "settings:doctor",
      group: "settings",
      label: messages.doctor.title,
      detail: messages.doctor.menuDetail,
      keywords: "doctor diagnostics node sdk shell git environment",
      icon: HeartPulse,
      ...(hostQueryReason ? { disabledReason: hostQueryReason } : {}),
      run: options.handlers.runDoctor
    }),
    {
      id: "settings:update",
      group: "settings",
      label: messages.commandPalette.updates,
      detail: messages.commandPalette.updatesDetail,
      keywords: "update version release github",
      icon: DownloadCloud,
      run: options.handlers.openUpdate
    },
    mutationAction({
      id: "settings:diagnostics",
      group: "settings",
      label: messages.commandPalette.diagnostics,
      detail: messages.commandPalette.diagnosticsDetail,
      keywords: "export redacted diagnostics report",
      icon: PackageOpen,
      ...(hostQueryReason ? { disabledReason: hostQueryReason } : {}),
      run: options.handlers.saveDiagnostics
    })
  ];
}

function unavailableReason(
  availability: PaletteAvailability,
  requirements: { connection?: boolean; session?: boolean; idleOperation?: boolean }
): string | undefined {
  if ((requirements.connection || requirements.session) && !availability.connected) {
    return messages.commandPalette.hostNotConnected;
  }
  if (availability.sessionTransitionPending) return messages.commandPalette.sessionTransitionPending;
  if (requirements.session && !availability.sessionReady) return messages.commandPalette.sessionNotReady;
  if (requirements.idleOperation && availability.activeOperation) return messages.commandPalette.operationActive;
  return undefined;
}

function mutationAction(
  action: Omit<PaletteAction, "group" | "disabled"> & { group?: PaletteAction["group"]; disabledReason?: string }
): PaletteAction {
  return {
    ...action,
    group: action.group ?? "actions",
    ...(action.disabledReason ? { disabled: true } : {})
  };
}

function commandDetail(command: SlashCommandDescriptor): string {
  const description = command.description
    ?? command.adapter?.description
    ?? messages.commandPalette.extensionFallbackDescription;
  return command.adapter ? `${description} · ${command.adapter.label}` : description;
}

function formatPaletteRelative(timestamp: number): string {
  return formatRelativeTime(timestamp);
}
