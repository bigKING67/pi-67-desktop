import type { OperationView, SessionSummary } from "@pi67/domain";
import type { SlashCommandDescriptor } from "@pi67/protocol";
import {
  BookOpenText,
  Command,
  DownloadCloud,
  HeartPulse,
  KeyRound,
  PanelLeft,
  PanelRight,
  Search,
  Settings2,
  MessageSquareText,
  PackageOpen,
  SquarePlus
} from "lucide-react";
import {
  formatDesktopShortcut,
  type DesktopActionId
} from "../app/desktop-action-registry.js";
import { effectiveDesktopActions } from "../app/desktop-shortcut-preferences.js";
import { formatRelativeTime } from "../localization/date-time.js";
import { messages } from "../localization/message-catalog.js";
import {
  isPiTuiBuiltinName,
  PI_DESKTOP_ACTIONS,
  piDesktopActionUnavailableReason,
  type PiDesktopActionContext,
  type PiDesktopActionDescriptor
} from "../pi-actions/pi-desktop-actions.js";
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
  openSession: (session: SessionSummary) => Promise<void> | void;
  invokeCommand: (name: string) => Promise<void> | void;
  executeDesktopAction: (action: PiDesktopActionDescriptor) => Promise<void> | void;
  openProvider: () => void;
  runDoctor: () => Promise<void> | void;
  openUpdate: () => void;
  saveDiagnostics: () => Promise<void> | void;
}

interface BuildPaletteActionsOptions {
  sessions: readonly SessionSummary[];
  extensionCommands: readonly SlashCommandDescriptor[];
  activeSessionFileIdentity: string | undefined;
  availability: PaletteAvailability;
  desktopActionContext: PiDesktopActionContext;
  handlers: PaletteActionHandlers;
  applicationHandlers?: Partial<Record<DesktopActionId, () => Promise<void> | void>>;
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
    const current = session.fileIdentity === options.activeSessionFileIdentity;
    const disabledReason = current ? messages.commandPalette.currentSession : sessionMutationReason;
    return {
      id: `session:${session.fileIdentity}`,
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
      run: () => options.handlers.openSession(session)
    };
  });
  const extensionActions = options.extensionCommands
    .filter((command) => !isPiTuiBuiltinName(command.name))
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
  const desktopActions = PI_DESKTOP_ACTIONS.map((descriptor): PaletteAction => {
    const disabledReason = piDesktopActionUnavailableReason(descriptor, options.desktopActionContext);
    return mutationAction({
      id: `pi:${descriptor.name}`,
      label: `/${descriptor.name}`,
      detail: descriptor.description,
      keywords: `pi desktop builtin ${descriptor.name} ${descriptor.description}`,
      icon: descriptor.icon,
      ...(disabledReason ? { disabledReason } : {}),
      run: () => options.handlers.executeDesktopAction(descriptor)
    });
  });
  const applicationActions = options.applicationHandlers
    ? effectiveDesktopActions().filter((descriptor) => descriptor.id !== "command-palette").map((descriptor): PaletteAction => {
        const run = options.applicationHandlers?.[descriptor.id];
        const disabledReason = descriptor.requiresWorkspace && !options.desktopActionContext.workspaceAvailable
          ? "请先打开一个工作区"
          : run ? undefined : "当前界面不可用";
        return {
          id: `app:${descriptor.id}`,
          group: "actions",
          label: descriptor.label,
          detail: descriptor.detail,
          keywords: descriptor.keywords,
          icon: APPLICATION_ACTION_ICONS[descriptor.id],
          shortcut: formatDesktopShortcut(descriptor),
          ...(disabledReason ? { disabled: true, disabledReason } : {}),
          run: run ?? (() => undefined)
        };
      })
    : [];
  return [
    ...sessionActions,
    ...extensionActions,
    ...applicationActions,
    ...desktopActions,
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

const APPLICATION_ACTION_ICONS = {
  settings: Settings2,
  "command-palette": Command,
  "new-session": SquarePlus,
  "toggle-navigation": PanelLeft,
  "toggle-context": PanelRight,
  "find-current-conversation": Search,
  "find-workspace-conversations": Search,
  "keyboard-shortcuts": BookOpenText
} satisfies Record<DesktopActionId, typeof Command>;

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
