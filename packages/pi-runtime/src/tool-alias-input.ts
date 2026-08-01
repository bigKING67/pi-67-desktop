export function mapBashInput(input: unknown): Record<string, unknown> {
  const record = inputRecord(input);
  const timeoutMs = optionalNumber(record, "timeout");
  return {
    command: requiredString(record, "command"),
    ...(timeoutMs === undefined ? {} : { timeout: Math.max(1, Math.ceil(timeoutMs / 1_000)) })
  };
}

export function mapReadInput(input: unknown): Record<string, unknown> {
  const record = inputRecord(input);
  return {
    path: requiredStringFrom(record, ["path", "file_path"]),
    ...optionalNumberProperty(record, "offset"),
    ...optionalNumberProperty(record, "limit")
  };
}

export function mapEditInput(input: unknown): Record<string, unknown> {
  const record = inputRecord(input);
  const canonicalEdits = record.edits;
  if (Array.isArray(canonicalEdits)) {
    return { path: requiredStringFrom(record, ["path", "file_path"]), edits: canonicalEdits };
  }
  if (record.replace_all === true) {
    throw new Error("Desktop Edit compatibility does not guess replace_all semantics; use native Pi edit with explicit edits.");
  }
  return {
    path: requiredStringFrom(record, ["path", "file_path"]),
    edits: [{
      oldText: requiredStringFrom(record, ["oldText", "old_string"]),
      newText: requiredStringFrom(record, ["newText", "new_string"], true)
    }]
  };
}

export function mapWriteInput(input: unknown): Record<string, unknown> {
  const record = inputRecord(input);
  return {
    path: requiredStringFrom(record, ["path", "file_path"]),
    content: requiredString(record, "content", true)
  };
}

export function mapGrepInput(input: unknown): Record<string, unknown> {
  const record = inputRecord(input);
  return {
    pattern: requiredString(record, "pattern"),
    ...optionalStringProperty(record, "path"),
    ...optionalStringProperty(record, "glob"),
    ...(typeof record.ignoreCase === "boolean"
      ? { ignoreCase: record.ignoreCase }
      : typeof record["-i"] === "boolean" ? { ignoreCase: record["-i"] } : {}),
    ...optionalBooleanProperty(record, "literal"),
    ...optionalNumberProperty(record, "context"),
    ...(optionalNumber(record, "limit") === undefined && optionalNumber(record, "head_limit") !== undefined
      ? { limit: optionalNumber(record, "head_limit") }
      : optionalNumberProperty(record, "limit"))
  };
}

export function mapFindInput(input: unknown): Record<string, unknown> {
  const record = inputRecord(input);
  return {
    pattern: requiredString(record, "pattern"),
    ...optionalStringProperty(record, "path"),
    ...optionalNumberProperty(record, "limit")
  };
}

export function mapWebSearchInput(input: unknown): Record<string, unknown> {
  const record = inputRecord(input);
  const query = optionalString(record, "query");
  const queries = optionalStringArray(record, "queries");
  if (!query && !queries) throw new Error("WebSearch requires query or queries.");
  return {
    ...(query ? { query } : {}),
    ...(queries ? { queries } : {}),
    workflow: optionalString(record, "workflow") ?? "none"
  };
}

export function mapWebFetchInput(input: unknown): Record<string, unknown> {
  const record = inputRecord(input);
  const url = optionalString(record, "url");
  const urls = optionalStringArray(record, "urls");
  if (!url && !urls) throw new Error("WebFetch requires url or urls.");
  return {
    ...(url ? { url } : {}),
    ...(urls ? { urls } : {}),
    ...optionalStringProperty(record, "prompt")
  };
}

export function inputRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Desktop tool compatibility input must be an object.");
  }
  return value as Record<string, unknown>;
}

export function recordOrEmpty(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function requiredString(record: Record<string, unknown>, key: string, allowEmpty = false): string {
  return requiredStringFrom(record, [key], allowEmpty);
}

function requiredStringFrom(
  record: Record<string, unknown>,
  keys: readonly string[],
  allowEmpty = false
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && (allowEmpty || value.trim() !== "")) return value;
  }
  throw new Error(`Desktop tool compatibility requires ${keys.join(" or ")}.`);
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return items.length > 0 ? items : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalStringProperty(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = optionalString(record, key);
  return value === undefined ? {} : { [key]: value };
}

function optionalNumberProperty(record: Record<string, unknown>, key: string): Record<string, number> {
  const value = optionalNumber(record, key);
  return value === undefined ? {} : { [key]: value };
}

function optionalBooleanProperty(record: Record<string, unknown>, key: string): Record<string, boolean> {
  const value = record[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}
