import { MessageSquareText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { requestConversationFind } from "../search/conversation-find-events.js";
import { runRuntimeDoctor, saveRuntimeDiagnostics } from "../doctor/runtime-diagnostics-controller.js";
import { isImeConfirmationKey } from "../input/ime-keyboard.js";
import { messages } from "../localization/message-catalog.js";
import { openKeyboardShortcutsDialog } from "../help/keyboard-shortcuts-dialog-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import { invokeRuntimeCommand } from "../operation/operation-controller.js";
import { executePiDesktopAction } from "../pi-actions/pi-desktop-actions.js";
import {
  beginRendererSessionIntent,
  openRendererSession
} from "../session/session-lifecycle-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionModels,
  selectSessionFileIdentity
} from "../session/session-projection-selectors.js";
import { useShellStore } from "../shell/shell-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { toggleRendererNavigation } from "../app/global-shortcuts.js";
import { useDesktopShortcutRevision } from "../app/desktop-shortcut-preferences.js";
import {
  buildPaletteActions,
  paletteAvailability
} from "./command-palette-actions.js";
import {
  buildPaletteProjection,
  MAX_EXTENSION_CANDIDATES,
  MAX_QUERY_LENGTH,
  MAX_SESSION_CANDIDATES,
  MAX_VISIBLE_SEARCH_RESULTS,
  type PaletteAction
} from "./command-palette-model.js";
import {
  getRecentPaletteActionIds,
  rememberPaletteAction
} from "./command-palette-recency.js";
import {
  boundaryPaletteSelection,
  movePaletteSelection,
  repairPaletteSelection
} from "./command-palette-selection.js";
import { CommandPaletteResults, paletteOptionId } from "./CommandPaletteResults.js";
import { usePaletteExtensionCommands } from "./use-palette-extension-commands.js";
import { usePaletteSessions } from "./use-palette-sessions.js";
import { usePaletteMessageSearch } from "./use-palette-message-search.js";
import { openWorkspaceMessageResult } from "./palette-message-result.js";
import { formatRelativeTime } from "../localization/date-time.js";
import styles from "./CommandPalette.module.css";

export function CommandPalette() {
  const shortcutRevision = useDesktopShortcutRevision();
  const open = useShellStore((state) => state.commandPaletteOpen);
  const setOpen = useShellStore((state) => state.setCommandPaletteOpen);
  const setCredentialDialogOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const setUpdateDialogOpen = useShellStore((state) => state.setUpdateDialogOpen);
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const operation = useAppStore((state) => state.operation);
  const workspace = useAppStore((state) => state.workspace);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const activeSessionFileIdentity = useSessionProjectionStore(selectSessionFileIdentity);
  const models = useSessionProjectionStore(selectSessionModels);
  const sessionReady = useSessionProjectionStore((state) => state.authority.phase === "active");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>();
  const [keyboardNavigationActive, setKeyboardNavigationActive] = useState(false);
  const sessionSearch = usePaletteSessions({ open, connected, query });
  const messageSearch = usePaletteMessageSearch({ open, query });
  const extensionCommands = usePaletteExtensionCommands({ open, connected, hostEpoch });

  const actions = useMemo(() => [
    ...buildPaletteActions({
    sessions: sessionSearch.sessions,
    extensionCommands: extensionCommands.commands,
    activeSessionFileIdentity,
    availability: paletteAvailability({
      connected,
      sessionReady,
      sessionTransitionPending,
      operation
    }),
    desktopActionContext: {
      connected,
      workspaceAvailable: Boolean(workspace),
      sessionReady,
      sessionTransitionPending,
      activeOperation: Boolean(operation && ["submitting", "accepted", "running", "waiting-input"].includes(operation.lifecycle)),
      configuredModels: models ?? []
    },
    handlers: {
      openSession: (session) => openRendererSession(session.path, session.fileIdentity),
      invokeCommand: (command) => void invokeRuntimeCommand(command),
      executeDesktopAction: async (descriptor) => {
        const result = await executePiDesktopAction(descriptor, "", {
          connected,
          workspaceAvailable: Boolean(workspace),
          sessionReady,
          sessionTransitionPending,
          activeOperation: Boolean(operation && ["submitting", "accepted", "running", "waiting-input"].includes(operation.lifecycle)),
          configuredModels: models ?? []
        });
        if (result.status === "blocked") {
          publishNotification({
            level: "warning",
            title: `无法执行 /${descriptor.name}`,
            message: result.message
          });
        }
      },
      openProvider: () => setCredentialDialogOpen(true),
      runDoctor: runRuntimeDoctor,
      openUpdate: () => setUpdateDialogOpen(true),
      saveDiagnostics: saveRuntimeDiagnostics
    },
    applicationHandlers: {
      settings: () => rendererWorkbenchStore.getState().openSettings(),
      "new-session": () => { beginRendererSessionIntent(); },
      "toggle-navigation": toggleRendererNavigation,
      "toggle-context": () => {
        const shell = useShellStore.getState();
        shell.setContextVisible(!shell.contextVisible);
      },
      "find-current-conversation": () => requestConversationFind("current"),
      "find-workspace-conversations": () => requestConversationFind("workspace"),
      "find-workspace-content": () => useShellStore.getState().setWorkspaceContentSearchDialogOpen(true),
      "keyboard-shortcuts": () => openKeyboardShortcutsDialog()
    }
    }),
    ...messageSearch.items.map((item): PaletteAction => ({
      id: `message:${item.sessionFileIdentity}:${item.messageId}`,
      group: "messages",
      label: item.sessionName,
      detail: `${item.role === "user" ? "用户" : "Pi"}${item.createdAt === undefined ? "" : ` · ${formatRelativeTime(item.createdAt)}`} · ${item.snippet}`,
      keywords: `${item.snippet} ${item.sessionName} ${item.role}`,
      icon: MessageSquareText,
      run: () => openWorkspaceMessageResult(item)
    }))
  ], [
    activeSessionFileIdentity,
    connected,
    extensionCommands.commands,
    operation,
    models,
    sessionReady,
    sessionSearch.sessions,
    messageSearch.items,
    sessionTransitionPending,
    setCredentialDialogOpen,
    setUpdateDialogOpen,
    workspace,
    shortcutRevision
  ]);

  const projection = useMemo(
    () => buildPaletteProjection(actions, query, getRecentPaletteActionIds()),
    [actions, open, query]
  );
  const visibleItems = useMemo(
    () => projection.groups.flatMap((group) => group.items),
    [projection.groups]
  );
  const selectedItem = visibleItems.find((item) => item.id === selectedKey && !item.disabled);
  const firstEnabledItem = visibleItems.find((item) => !item.disabled);

  useEffect(() => {
    setSelectedKey((current) => repairPaletteSelection(visibleItems, current));
  }, [visibleItems]);

  if (!open) return null;

  const execute = (item: PaletteAction | undefined) => {
    if (!item || item.disabled) return;
    rememberPaletteAction(item.id);
    setOpen(false);
    requestAnimationFrame(() => {
      void item.run();
    });
  };

  const status = paletteStatus({
    connected,
    sessionSearch,
    extensionStatus: extensionCommands.status,
    projection,
    query,
    sessionCount: sessionSearch.sessions.length,
    extensionCount: extensionCommands.commands.length,
    messageSearch
  });

  return (
    <ModalOverlay
      className={`modal-overlay ${styles.overlay}`}
      isOpen
      isDismissable
      onOpenChange={setOpen}
    >
      <Modal className={styles.palette!}>
        <Dialog aria-label={messages.commandPalette.title}>
          <h2 className="sr-only">{messages.commandPalette.title}</h2>
          <div className={styles.search}>
            <Search aria-hidden="true" size={17} />
            <input
              autoFocus
              aria-activedescendant={selectedItem ? paletteOptionId(selectedItem.id) : undefined}
              aria-autocomplete="list"
              aria-controls="command-palette-results"
              aria-expanded="true"
              aria-haspopup="listbox"
              aria-label={messages.commandPalette.searchLabel}
              placeholder={messages.commandPalette.searchPlaceholder}
              role="combobox"
              value={query}
              onChange={(event) => {
                setKeyboardNavigationActive(false);
                setSelectedKey(undefined);
                setQuery(event.target.value.slice(0, MAX_QUERY_LENGTH));
              }}
              onKeyDown={(event) => {
                if (isImeConfirmationKey(event.nativeEvent)) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  execute(selectedItem ?? firstEnabledItem);
                  return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setKeyboardNavigationActive(true);
                  setSelectedKey((current) => movePaletteSelection(
                    visibleItems,
                    current,
                    event.key === "ArrowDown" ? 1 : -1
                  ));
                  return;
                }
                if (keyboardNavigationActive && (event.key === "Home" || event.key === "End")) {
                  event.preventDefault();
                  setSelectedKey(boundaryPaletteSelection(
                    visibleItems,
                    event.key === "Home" ? "first" : "last"
                  ));
                }
              }}
            />
            <kbd className={styles.shortcut}>Esc</kbd>
          </div>

          <CommandPaletteResults
            groups={projection.groups}
            selectedKey={selectedKey}
            activeSessionFileIdentity={activeSessionFileIdentity}
            onSelect={(key) => {
              setKeyboardNavigationActive(true);
              setSelectedKey(key);
            }}
            onExecute={execute}
          />

          {visibleItems.length === 0 ? (
            <div className={styles.empty}>
              <Search aria-hidden="true" size={18} />
              <strong>{sessionSearch.status === "failed"
                ? messages.commandPalette.sessionCatalogUnavailable
                : messages.commandPalette.noMatches}</strong>
              <span>{sessionSearch.status === "failed"
                ? messages.commandPalette.sessionCatalogRecovery
                : messages.commandPalette.searchSuggestion}</span>
            </div>
          ) : null}

          <footer className={styles.footer}>
            <span className={styles.footerStatus} role="status" aria-live="polite">{status}</span>
            <span>
              <kbd>↑↓</kbd> {messages.commandPalette.keyboardHelp} <kbd>Enter</kbd>{" "}
              {messages.commandPalette.keyboardOpen} <kbd>Esc</kbd>{" "}
              {messages.commandPalette.keyboardClose}
            </span>
          </footer>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function paletteStatus(options: {
  connected: boolean;
  sessionSearch: ReturnType<typeof usePaletteSessions>;
  extensionStatus: ReturnType<typeof usePaletteExtensionCommands>["status"];
  projection: ReturnType<typeof buildPaletteProjection>;
  query: string;
  sessionCount: number;
  extensionCount: number;
  messageSearch: ReturnType<typeof usePaletteMessageSearch>;
}): string {
  if (options.messageSearch.status === "failed") return options.messageSearch.error ?? "对话正文搜索失败";
  if (
    options.messageSearch.status === "loading"
    || options.messageSearch.status === "refreshing"
  ) return "正在建立或查询对话内容索引…";
  if (options.messageSearch.incomplete) return "对话内容索引尚未完整覆盖当前工作区";
  if (options.sessionSearch.status === "failed") return options.sessionSearch.error;
  if (options.extensionStatus === "failed") return messages.commandPalette.extensionLoadFailedWithFallback;
  if (
    options.sessionSearch.status === "loading"
    || options.sessionSearch.status === "refreshing"
  ) return messages.commandPalette.searchingSessions;
  if (options.extensionStatus === "loading") return messages.commandPalette.loadingExtensions;
  if (!options.connected || options.extensionStatus === "unavailable") {
    return messages.commandPalette.hostUnavailable;
  }
  if (
    options.sessionCount >= MAX_SESSION_CANDIDATES
    || options.extensionCount >= MAX_EXTENSION_CANDIDATES
  ) {
    return messages.commandPalette.searchScope(
      MAX_SESSION_CANDIDATES,
      MAX_EXTENSION_CANDIDATES
    );
  }
  if (options.projection.truncated && options.query.trim()) {
    return messages.commandPalette.topResults(MAX_VISIBLE_SEARCH_RESULTS);
  }
  if (options.projection.truncated) return messages.commandPalette.searchForMore;
  return messages.commandPalette.currentSources;
}
