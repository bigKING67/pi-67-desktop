export function asNotification(value: unknown): { title: string; body: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || typeof record.body !== "string") return undefined;
  return { title: record.title.slice(0, 120), body: record.body.slice(0, 500) };
}

export function asExternalUrl(value: unknown): URL | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const target = new URL(value);
    return target.protocol === "http:" || target.protocol === "https:" ? target : undefined;
  } catch {
    return undefined;
  }
}
