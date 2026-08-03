import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

interface DesktopEnvironmentExtensionOptions {
  now?: () => Date;
  resolveTimeZone?: () => string | undefined;
}

export function createDesktopEnvironmentExtension(
  options: DesktopEnvironmentExtensionOptions = {}
): InlineExtension {
  const now = options.now ?? (() => new Date());
  const resolveTimeZone = options.resolveTimeZone ?? systemTimeZone;
  return {
    name: "pi67-desktop-environment",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.on("before_agent_start", (event) => {
        const context = createDesktopEnvironmentBlock(now(), safeTimeZone(resolveTimeZone));
        const separator = event.systemPrompt === "" ? "" : "\n\n";
        return { systemPrompt: `${event.systemPrompt}${separator}${context}` };
      });
    }
  };
}

export function createDesktopEnvironmentBlock(date: Date, timeZone: string | null): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Desktop environment date must be valid.");
  const environment = desktopLocalEnvironment(date, timeZone);
  return `<desktop_environment>
Current local date: ${environment.date}
Current local timezone: ${environment.timeZone}
Interpret relative calendar terms such as "today", "tomorrow", "this week", and "recent" using this local date and timezone.
For time-sensitive facts, verify them with available tools instead of inferring the current date from retrieved documents.
</desktop_environment>`;
}

function desktopLocalEnvironment(
  date: Date,
  requestedTimeZone: string | null
): { date: string; timeZone: string } {
  if (requestedTimeZone) {
    try {
      return {
        date: formatDateInTimeZone(date, requestedTimeZone),
        timeZone: `${requestedTimeZone} (${formatOffsetInTimeZone(date, requestedTimeZone)})`
      };
    } catch {
      // Invalid or unavailable IANA data falls back to the process-local clock.
    }
  }
  return {
    date: formatSystemLocalDate(date),
    timeZone: formatOffset(-date.getTimezoneOffset())
  };
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

function formatOffsetInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset"
  }).formatToParts(date);
  const value = part(parts, "timeZoneName");
  if (value === "GMT") return "UTC+00:00";
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/u.exec(value);
  if (!match) throw new Error(`Unsupported time-zone offset: ${value}`);
  return `UTC${match[1]}${match[2]!.padStart(2, "0")}:${match[3] ?? "00"}`;
}

function formatSystemLocalDate(date: Date): string {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0")
  ].join("-");
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  return `UTC${sign}${Math.floor(absolute / 60).toString().padStart(2, "0")}:${(absolute % 60).toString().padStart(2, "0")}`;
}

function part(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((candidate) => candidate.type === type)?.value;
  if (!value) throw new Error(`Missing ${type} in formatted local date.`);
  return value;
}

function safeTimeZone(resolveTimeZone: () => string | undefined): string | null {
  try {
    return resolveTimeZone()?.trim() || null;
  } catch {
    return null;
  }
}

function systemTimeZone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
