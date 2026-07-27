import { appLocale, messages } from "./message-catalog.js";

const shortDate = new Intl.DateTimeFormat(appLocale, {
  month: "short",
  day: "numeric"
});
const notificationDateTime = new Intl.DateTimeFormat(appLocale, {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp)) return messages.dateTime.unknown;
  const diffMinutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (diffMinutes < 1) return messages.dateTime.justNow;
  if (diffMinutes < 60) return messages.dateTime.minutesAgo(diffMinutes);
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return messages.dateTime.hoursAgo(hours);
  return shortDate.format(timestamp);
}

export function formatNotificationDateTime(timestamp: number): string {
  return notificationDateTime.format(timestamp);
}
