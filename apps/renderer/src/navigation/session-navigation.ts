import type { OperationView, SessionSummary } from "@pi67/domain";
import { formatRelativeTime } from "../localization/date-time.js";
import { messages } from "../localization/message-catalog.js";

export type SessionNavigationStatus = "active" | "running" | "waiting";

export interface SessionNavigationItem {
  session: SessionSummary;
  active: boolean;
  status?: SessionNavigationStatus;
}

export type SessionNavigationRow =
  | { kind: "group"; id: "running" | "recent"; label: string; count: number }
  | { kind: "session"; key: string; item: SessionNavigationItem };

interface BuildSessionNavigationOptions {
  sessions: readonly SessionSummary[];
  activePath?: string;
  activeSessionId?: string;
  operation?: OperationView;
}

const ACTIVE_OPERATION_LIFECYCLES = new Set<OperationView["lifecycle"]>([
  "submitting",
  "accepted",
  "running",
  "waiting-input"
]);

export function buildSessionNavigationRows(options: BuildSessionNavigationOptions): SessionNavigationRow[] {
  const seen = new Set<string>();
  const items = options.sessions
    .filter((session) => {
      if (seen.has(session.path)) return false;
      seen.add(session.path);
      return true;
    })
    .map((session): SessionNavigationItem => {
      const active = session.path === options.activePath;
      const operationMatches = matchesActiveOperation(session, active, options);
      return {
        session,
        active,
        ...(operationMatches
          ? { status: options.operation?.lifecycle === "waiting-input" ? "waiting" : "running" }
          : active ? { status: "active" } : {})
      };
    });

  const running = items.filter((item) => item.status === "running" || item.status === "waiting");
  const recent = items.filter((item) => item.status !== "running" && item.status !== "waiting");
  const rows: SessionNavigationRow[] = [];
  appendGroup(rows, "running", messages.navigation.groupRunning, running);
  appendGroup(rows, "recent", messages.navigation.groupRecent, recent);
  return rows;
}

export function formatSessionRelativeTime(timestamp: number, now = Date.now()): string {
  return formatRelativeTime(timestamp, now);
}

function matchesActiveOperation(
  session: SessionSummary,
  active: boolean,
  options: BuildSessionNavigationOptions
): boolean {
  const operation = options.operation;
  if (!operation || operation.kind === "session-import" || !ACTIVE_OPERATION_LIFECYCLES.has(operation.lifecycle)) {
    return false;
  }
  return session.id === operation.sessionId
    || Boolean(active && options.activeSessionId && options.activeSessionId === operation.sessionId);
}

function appendGroup(
  rows: SessionNavigationRow[],
  id: "running" | "recent",
  label: string,
  items: readonly SessionNavigationItem[]
): void {
  if (items.length === 0) return;
  rows.push({ kind: "group", id, label, count: items.length });
  rows.push(...items.map((item) => ({ kind: "session" as const, key: item.session.path, item })));
}
