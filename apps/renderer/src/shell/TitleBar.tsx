import type { OperationView, RuntimeStatus } from "@pi67/domain";
import {
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Command,
  DownloadCloud,
  Ellipsis,
  FileDown,
  KeyRound,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Stethoscope,
  Sun,
  TriangleAlert,
  Wrench
} from "lucide-react";
import { useState } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { saveRuntimeDiagnostics } from "../doctor/runtime-diagnostics-controller.js";
import { messages } from "../localization/message-catalog.js";
import { NotificationCenter } from "../notifications/NotificationCenter.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionId, selectSessionName } from "../session/session-projection-selectors.js";
import {
  setThemePreference,
  type ThemePreference,
  useThemeSnapshot
} from "../theme/theme-controller.js";
import { useShellStore } from "./shell-store.js";
import styles from "./TitleBar.module.css";

interface TitleBarProps {
  navigationAvailable: boolean;
  navigationVisible: boolean;
  onToggleNavigation: () => void;
}

export function TitleBar({ navigationAvailable, navigationVisible, onToggleNavigation }: TitleBarProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const runtime = useAppStore((state) => state.runtime);
  const workspace = useAppStore((state) => state.workspace);
  const sessionName = useSessionProjectionStore(selectSessionName);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const operation = useAppStore((state) => state.operation);
  const operationDetail = useAppStore((state) => state.operationDetail);
  const contextVisible = useShellStore((state) => state.contextVisible);
  const setContextVisible = useShellStore((state) => state.setContextVisible);
  const setCommandPaletteOpen = useShellStore((state) => state.setCommandPaletteOpen);
  const setCredentialDialogOpen = useShellStore((state) => state.setCredentialDialogOpen);
  const setUpdateDialogOpen = useShellStore((state) => state.setUpdateDialogOpen);
  const setDoctorDialogOpen = useShellStore((state) => state.setDoctorDialogOpen);
  const theme = useThemeSnapshot();
  const status = statusPresentation(runtime, operation, operationDetail);
  const workspaceName = basename(workspace ?? "");
  const activeSessionName = sessionName?.trim()
    || (sessionId ? messages.shell.sessionFallback(sessionId.slice(0, 8)) : undefined);

  return (
    <header className={`title-bar ${styles.header}`}>
      <div className={styles.identity}>
        {navigationAvailable ? (
          <Button
            className={`icon-button navigation-toggle ${styles.iconButton}`}
            aria-controls="session-navigation"
            aria-describedby="navigation-toggle-tooltip"
            aria-expanded={navigationVisible}
            aria-keyshortcuts="Control+B Meta+B"
            aria-label={navigationVisible ? messages.shell.hideNavigation : messages.shell.showNavigation}
            onPress={onToggleNavigation}
          >
            {navigationVisible ? <PanelLeftClose aria-hidden="true" size={16} /> : <PanelLeftOpen aria-hidden="true" size={16} />}
            <ControlTooltip id="navigation-toggle-tooltip">{navigationVisible
              ? messages.shell.hideNavigation
              : messages.shell.showNavigation}</ControlTooltip>
          </Button>
        ) : null}
        <div className={`brand-lockup ${styles.brand}`} title={workspace ?? messages.common.appName}>
          <span className={`brand-mark ${styles.brandMark}`} aria-hidden="true">π</span>
          <span className={styles.location}>
            <strong>{workspaceName || messages.common.appName}</strong>
            {activeSessionName ? (
              <>
                <span className={styles.locationSeparator} aria-hidden="true">/</span>
                <span className={styles.sessionName}>{activeSessionName}</span>
              </>
            ) : null}
          </span>
        </div>
      </div>

      <div className={`title-actions ${styles.actions}`}>
        <div
          className={`${styles.status} ${styles[status.tone]!}`}
          aria-label={messages.shell.currentStatus(status.label)}
          data-runtime-phase={runtime.phase}
          title={status.label}
        >
          <StatusIcon kind={status.icon} {...(status.spinning === undefined ? {} : { spinning: status.spinning })} />
          <span>{status.label}</span>
        </div>
        <NotificationCenter />
        <Button
          className={`icon-button ${styles.iconButton}`}
          aria-describedby="command-palette-tooltip"
          aria-keyshortcuts="Control+K Meta+K"
          aria-label={messages.shell.openCommandPalette}
          onPress={() => setCommandPaletteOpen(true)}
        >
          <Command aria-hidden="true" size={16} />
          <ControlTooltip id="command-palette-tooltip">{messages.shell.commandPalette}</ControlTooltip>
        </Button>
        {workspace ? (
          <Button
            className={`icon-button context-toggle ${styles.iconButton}`}
            aria-controls="session-context"
            aria-describedby="context-toggle-tooltip"
            aria-expanded={contextVisible}
            aria-keyshortcuts="Control+Shift+B Meta+Shift+B"
            aria-label={contextVisible ? messages.shell.hideContext : messages.shell.showContext}
            onPress={() => setContextVisible(!contextVisible)}
          >
            {contextVisible ? <PanelRightClose aria-hidden="true" size={16} /> : <PanelRightOpen aria-hidden="true" size={16} />}
            <ControlTooltip id="context-toggle-tooltip">{contextVisible
              ? messages.shell.hideContextPanel
              : messages.shell.showContextPanel}</ControlTooltip>
          </Button>
        ) : null}
        <MenuTrigger isOpen={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
          <Button
            className={`icon-button ${styles.iconButton}`}
            aria-describedby="more-actions-tooltip"
            aria-expanded={moreMenuOpen}
            aria-label={messages.shell.openMoreMenu}
          >
            <Ellipsis aria-hidden="true" size={17} />
            <ControlTooltip id="more-actions-tooltip">{messages.shell.more}</ControlTooltip>
          </Button>
          <Popover className={styles.morePopover!} placement="bottom end" offset={6}>
            <Menu className={styles.moreMenu!} aria-label={messages.shell.moreApplicationActions}>
              <MenuItem
                className={styles.menuItem!}
                id="credentials"
                onAction={() => setCredentialDialogOpen(true)}
                textValue={messages.shell.credentials}
              >
                <KeyRound aria-hidden="true" size={15} />
                <MenuItemCopy label={messages.shell.credentials} detail={messages.shell.credentialsDetail} />
              </MenuItem>
              <MenuItem
                className={styles.menuItem!}
                id="updates"
                onAction={() => setUpdateDialogOpen(true)}
                textValue={messages.shell.updates}
              >
                <DownloadCloud aria-hidden="true" size={15} />
                <MenuItemCopy label={messages.shell.updates} detail={messages.shell.updatesDetail} />
              </MenuItem>
              <MenuItem
                className={styles.menuItem!}
                id="doctor"
                onAction={() => setDoctorDialogOpen(true)}
                textValue={messages.doctor.title}
              >
                <Stethoscope aria-hidden="true" size={15} />
                <MenuItemCopy label={messages.doctor.title} detail={messages.doctor.menuDetail} />
              </MenuItem>
              <MenuItem
                className={styles.menuItem!}
                id="diagnostics"
                isDisabled={!workspace}
                onAction={() => void saveRuntimeDiagnostics()}
                textValue={messages.shell.diagnostics}
              >
                <FileDown aria-hidden="true" size={15} />
                <MenuItemCopy label={messages.shell.diagnostics} detail={messages.shell.diagnosticsDetail} />
              </MenuItem>
              {THEME_OPTIONS.map((option, index) => (
                <MenuItem
                  className={`${styles.menuItem} ${index === 0 ? styles.themeStart : ""}`}
                  id={`theme-${option.id}`}
                  key={option.id}
                  aria-label={messages.shell.selectedAppearance(
                    option.label,
                    theme.preference === option.id
                  )}
                  onAction={() => setThemePreference(option.id)}
                  textValue={messages.shell.appearance(option.label)}
                >
                  <ThemeIcon preference={option.id} />
                  <MenuItemCopy label={option.label} detail={messages.shell.appearanceDetail} />
                  <Check
                    aria-hidden="true"
                    className={`${styles.selection} ${theme.preference === option.id ? styles.selectionVisible : ""}`}
                    size={14}
                  />
                </MenuItem>
              ))}
            </Menu>
            {theme.persistence === "memory" ? (
              <p className={styles.themePersistenceNote} role="status">{messages.shell.themePersistenceUnavailable}</p>
            ) : null}
          </Popover>
        </MenuTrigger>
      </div>
    </header>
  );
}

function ControlTooltip({ id, children }: { id: string; children: React.ReactNode }) {
  return <span className={styles.tooltip} id={id} role="tooltip">{children}</span>;
}

function MenuItemCopy({ label, detail }: { label: string; detail: string }) {
  return <span className={styles.menuItemCopy}><strong>{label}</strong><small>{detail}</small></span>;
}

type StatusIconKind = "idle" | "ready" | "active" | "tool" | "warning" | "error" | "recovering";

interface StatusPresentation {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "accent";
  icon: StatusIconKind;
  spinning?: boolean;
}

function statusPresentation(
  runtime: RuntimeStatus,
  operation: OperationView | undefined,
  operationDetail: string | undefined
): StatusPresentation {
  if (runtime.phase === "recovering") {
    return { label: runtime.detail, tone: "warning", icon: "recovering", spinning: true };
  }
  if (operation) {
    if (operation.lifecycle === "failed") return { label: operationDetail || messages.operation.failed, tone: "danger", icon: "error" };
    if (operation.lifecycle === "lost") return { label: operationDetail || messages.operation.lost, tone: "warning", icon: "warning" };
    if (operation.lifecycle === "cancelled") return { label: messages.operation.cancelled, tone: "neutral", icon: "idle" };
    if (operation.lifecycle === "completed") return { label: messages.operation.completed, tone: "success", icon: "ready" };
    if (operation.activity?.kind === "approval") return { label: messages.operation.needsApproval, tone: "warning", icon: "warning" };
    if (operation.activity?.kind === "extension-input") return { label: messages.operation.waitingInput, tone: "warning", icon: "warning" };
    if (operation.activity?.kind === "tool") return { label: messages.operation.usingTool, tone: "accent", icon: "tool" };
    if (operation.activity?.kind === "compaction") return { label: messages.operation.compacting, tone: "accent", icon: "recovering", spinning: true };
    if (operation.activity?.kind === "responding") return { label: messages.operation.responding, tone: "accent", icon: "active", spinning: true };
    if (operation.activity?.kind === "thinking") return { label: messages.operation.thinking, tone: "accent", icon: "active", spinning: true };
    if (operation.kind === "session-import") return { label: messages.operation.importingSession, tone: "accent", icon: "active", spinning: true };
    if (operation.kind === "compaction") return { label: messages.operation.compacting, tone: "accent", icon: "recovering", spinning: true };
    if (operation.lifecycle === "accepted") return { label: messages.operation.accepted, tone: "accent", icon: "active" };
    return { label: operationDetail || messages.operation.running, tone: "accent", icon: "active", spinning: true };
  }
  if (runtime.phase === "failed") return { label: runtime.detail, tone: "danger", icon: "error" };
  if (runtime.phase === "starting" || runtime.phase === "busy") {
    return { label: runtime.detail, tone: "accent", icon: "active", spinning: true };
  }
  if (runtime.phase === "ready") return { label: runtime.detail, tone: "success", icon: "ready" };
  return { label: runtime.detail, tone: "neutral", icon: "idle" };
}

function StatusIcon({ kind, spinning }: { kind: StatusIconKind; spinning?: boolean }) {
  const className = spinning ? styles.spinning : undefined;
  if (kind === "ready") return <CircleCheck aria-hidden="true" size={14} />;
  if (kind === "active") return <CircleDashed aria-hidden="true" className={className} size={14} />;
  if (kind === "tool") return <Wrench aria-hidden="true" size={14} />;
  if (kind === "warning") return <CircleAlert aria-hidden="true" size={14} />;
  if (kind === "error") return <TriangleAlert aria-hidden="true" size={14} />;
  if (kind === "recovering") return <RefreshCw aria-hidden="true" className={className} size={14} />;
  return <Circle aria-hidden="true" size={12} />;
}

const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; label: string }> = [
  { id: "system", label: messages.shell.themeSystem },
  { id: "light", label: messages.shell.themeLight },
  { id: "dark", label: messages.shell.themeDark }
];

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "system") return <Monitor aria-hidden="true" size={15} />;
  if (preference === "dark") return <Moon aria-hidden="true" size={15} />;
  return <Sun aria-hidden="true" size={15} />;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
