export function hasPiWebAccessReadContract(
  toolName: string,
  record: Record<string, unknown>
): boolean {
  if (toolName === "web_search") {
    return stringField(record, "query") !== undefined
      || nonEmptyStringArray(record.queries) !== undefined;
  }
  if (toolName === "source_check") {
    return stringField(record, "claim") !== undefined
      && optionalStringArrayIsValid(record.queries)
      && optionalStringArrayIsValid(record.domainFilter);
  }
  if (toolName === "get_search_content") {
    return stringField(record, "responseId") !== undefined
      && optionalStringIsValid(record, "query")
      && optionalStringIsValid(record, "url")
      && optionalNonNegativeIntegerIsValid(record, "queryIndex")
      && optionalNonNegativeIntegerIsValid(record, "urlIndex")
      && optionalNonNegativeIntegerIsValid(record, "offset")
      && optionalPositiveIntegerIsValid(record, "limit");
  }
  if (toolName === "fetch_content") {
    const singleUrl = stringField(record, "url");
    const urls = [
      ...(singleUrl === undefined ? [] : [singleUrl]),
      ...(nonEmptyStringArray(record.urls) ?? [])
    ];
    return urls.length > 0 && urls.every(isExternalWebUrl);
  }
  return false;
}

export function networkReadTarget(
  record: Record<string, unknown>,
  fallback: string
): string {
  for (const key of ["query", "claim", "url", "responseId"] as const) {
    const value = stringField(record, key);
    if (value) return value;
  }
  for (const key of ["queries", "urls"] as const) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const items = value.filter((item): item is string => (
      typeof item === "string" && item.trim() !== ""
    ));
    if (items.length > 0) return items.join("\n");
  }
  return fallback;
}

export function hasBuiltinInputContract(
  toolName: string,
  record: Record<string, unknown>
): boolean {
  const path = stringField(record, "path");
  if (toolName === "read") return path !== undefined;
  if (toolName === "write") return path !== undefined && typeof record.content === "string";
  if (toolName === "edit") {
    return path !== undefined
      && Array.isArray(record.edits)
      && record.edits.length > 0
      && record.edits.every(isEditReplacement);
  }
  if (toolName === "grep" || toolName === "find") {
    return stringField(record, "pattern") !== undefined && optionalPathIsValid(record);
  }
  return toolName === "ls" && optionalPathIsValid(record);
}

export function hasPiFffInputContract(
  toolName: "grep" | "find",
  record: Record<string, unknown>
): boolean {
  if (stringField(record, "pattern") === undefined) return false;
  if (!optionalPathIsValid(record)) return false;
  if (!optionalStringOrStringArrayIsValid(record.exclude)) return false;
  if (!optionalPositiveIntegerIsValid(record, "limit")) return false;
  if (!optionalStringIsValid(record, "cursor")) return false;
  if (toolName === "find") return true;
  return (record.caseSensitive === undefined || typeof record.caseSensitive === "boolean")
    && optionalFiniteNonNegativeNumberIsValid(record, "context");
}

export function asToolInputRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function stringField(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalStringArrayIsValid(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value)
    && value.every((item) => typeof item === "string" && item.trim() !== "")
  );
}

function optionalStringIsValid(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || stringField(record, key) !== undefined;
}

function optionalNonNegativeIntegerIsValid(
  record: Record<string, unknown>,
  key: string
): boolean {
  const value = record[key];
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function optionalPositiveIntegerIsValid(
  record: Record<string, unknown>,
  key: string
): boolean {
  const value = record[key];
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function nonEmptyStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => (
    typeof item === "string" && item.trim() !== ""
  ));
  return items.length > 0 ? items : undefined;
}

function isExternalWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

function optionalStringOrStringArrayIsValid(value: unknown): boolean {
  return value === undefined
    || (typeof value === "string" && value.trim() !== "")
    || (
      Array.isArray(value)
      && value.length > 0
      && value.every((item) => typeof item === "string" && item.trim() !== "")
    );
}

function optionalFiniteNonNegativeNumberIsValid(
  record: Record<string, unknown>,
  key: string
): boolean {
  const value = record[key];
  return value === undefined
    || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isEditReplacement(value: unknown): boolean {
  const record = asToolInputRecord(value);
  return typeof record.oldText === "string" && typeof record.newText === "string";
}

function optionalPathIsValid(record: Record<string, unknown>): boolean {
  return record.path === undefined || stringField(record, "path") !== undefined;
}
