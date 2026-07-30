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
const messageDateTimeTitle = new Intl.DateTimeFormat(appLocale, {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "longOffset",
  hour12: false
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

export function formatMessageDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return messages.dateTime.unknown;
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatMessageDateTimeTitle(timestamp: number): string {
  return Number.isFinite(new Date(timestamp).getTime())
    ? messageDateTimeTitle.format(timestamp)
    : messages.dateTime.unknown;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
