import { valid, validRange } from "semver";

import {
  EXTENSION_ADAPTER_LIMITS,
  EXTENSION_ADAPTER_SCHEMA_VERSION,
  type ExtensionAdapterCommandManifest,
  type ExtensionAdapterManifest,
  type ExtensionAdapterToolManifest,
  type ExtensionAdapterToolPresentation,
  type ExtensionAdapterValidationIssue,
  type ExtensionAdapterValidationIssueCode,
  type ExtensionAdapterValidationResult
} from "./manifest.js";

const ADAPTER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?\/)?[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?$/u;
const SURFACE_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]*[A-Za-z0-9])?$/u;
const TOOL_PRESENTATIONS = new Set<ExtensionAdapterToolPresentation>(["generic", "command", "read", "change"]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const EXECUTABLE_FIELDS = new Set([
  "html",
  "script",
  "javascript",
  "component",
  "react",
  "css",
  "module",
  "renderer",
  "code"
]);

type JsonRecord = Record<string, unknown>;

export class ExtensionAdapterManifestError extends Error {
  readonly issues: readonly ExtensionAdapterValidationIssue[];

  constructor(issues: readonly ExtensionAdapterValidationIssue[]) {
    super(`Invalid Extension Adapter manifest (${issues.length} issue${issues.length === 1 ? "" : "s"})`);
    this.name = "ExtensionAdapterManifestError";
    this.issues = Object.freeze([...issues]);
  }
}

export function validateExtensionAdapterManifest(input: unknown): ExtensionAdapterValidationResult {
  const collector = new IssueCollector();
  inspectJsonValue(input, "$", 0, new WeakSet<object>(), { nodes: 0 }, collector);
  if (!collector.hasIssues()) {
    const serialized = JSON.stringify(input);
    if (serialized === undefined) {
      collector.add("not_json", "$", "manifest must be JSON serializable");
    } else if (utf8ByteLength(serialized) > EXTENSION_ADAPTER_LIMITS.manifestBytes) {
      collector.add("too_large", "$", `manifest exceeds ${EXTENSION_ADAPTER_LIMITS.manifestBytes} UTF-8 bytes`);
    }
  }

  const manifest = collector.hasIssues() ? undefined : projectManifest(input, collector);
  if (collector.hasIssues() || !manifest) {
    return { success: false, issues: collector.finish() };
  }
  return { success: true, manifest };
}

export function parseExtensionAdapterManifest(input: unknown): ExtensionAdapterManifest {
  const result = validateExtensionAdapterManifest(input);
  if (!result.success) throw new ExtensionAdapterManifestError(result.issues);
  return result.manifest;
}

export function isValidExtensionPackageName(value: string): boolean {
  return value.length <= EXTENSION_ADAPTER_LIMITS.packageNameCharacters && PACKAGE_NAME_PATTERN.test(value);
}

export function isValidExtensionSurfaceName(value: string): boolean {
  return value.length <= EXTENSION_ADAPTER_LIMITS.surfaceNameCharacters && SURFACE_NAME_PATTERN.test(value);
}

export function isValidInstalledExtensionVersion(value: string): boolean {
  return valid(value) === value;
}

function projectManifest(input: unknown, issues: IssueCollector): ExtensionAdapterManifest | undefined {
  if (!isPlainRecord(input)) {
    issues.add("invalid_value", "$", "manifest must be a plain object");
    return undefined;
  }
  requireExactKeys(input, "$", ["schemaVersion", "id", "package", "versionRange", "commands", "tools"], issues);

  if (input.schemaVersion !== EXTENSION_ADAPTER_SCHEMA_VERSION) {
    issues.add("invalid_value", "$.schemaVersion", `schemaVersion must be ${EXTENSION_ADAPTER_SCHEMA_VERSION}`);
  }
  const id = readString(input.id, "$.id", 1, EXTENSION_ADAPTER_LIMITS.adapterIdCharacters, issues);
  if (id && !ADAPTER_ID_PATTERN.test(id)) {
    issues.add("invalid_value", "$.id", "id must use lowercase letters, numbers, dots, underscores, or hyphens");
  }
  const packageName = readString(
    input.package,
    "$.package",
    1,
    EXTENSION_ADAPTER_LIMITS.packageNameCharacters,
    issues
  );
  if (packageName && !isValidExtensionPackageName(packageName)) {
    issues.add("invalid_value", "$.package", "package must be a lowercase npm package name");
  }
  const versionRange = readString(
    input.versionRange,
    "$.versionRange",
    1,
    EXTENSION_ADAPTER_LIMITS.versionRangeCharacters,
    issues
  );
  if (versionRange && validRange(versionRange) === null) {
    issues.add("invalid_value", "$.versionRange", "versionRange must be a valid SemVer range");
  }

  const commands = projectCommands(input.commands, issues);
  const tools = projectTools(input.tools, issues);
  if (commands && tools && Object.keys(commands).length + Object.keys(tools).length === 0) {
    issues.add("empty_surface", "$", "manifest must declare at least one command or tool");
  }
  if (issues.hasIssues() || !id || !packageName || !versionRange || !commands || !tools) return undefined;

  return Object.freeze({
    schemaVersion: EXTENSION_ADAPTER_SCHEMA_VERSION,
    id,
    package: packageName,
    versionRange,
    commands: Object.freeze(commands),
    tools: Object.freeze(tools)
  });
}

function projectCommands(value: unknown, issues: IssueCollector): Record<string, ExtensionAdapterCommandManifest> | undefined {
  if (!isPlainRecord(value)) {
    issues.add("invalid_value", "$.commands", "commands must be a plain object");
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length > EXTENSION_ADAPTER_LIMITS.commands) {
    issues.add("too_many_entries", "$.commands", `commands cannot exceed ${EXTENSION_ADAPTER_LIMITS.commands} entries`);
    return undefined;
  }
  const output: Record<string, ExtensionAdapterCommandManifest> = Object.create(null) as Record<
    string,
    ExtensionAdapterCommandManifest
  >;
  for (const [name, definition] of entries) {
    const path = propertyPath("$.commands", name);
    if (!isValidExtensionSurfaceName(name)) {
      issues.add("invalid_value", path, "command name contains unsupported characters or is too long");
      continue;
    }
    if (!isPlainRecord(definition)) {
      issues.add("invalid_value", path, "command definition must be a plain object");
      continue;
    }
    requireExactKeys(definition, path, ["label", "description"], issues, ["label"]);
    const label = readString(definition.label, `${path}.label`, 1, EXTENSION_ADAPTER_LIMITS.labelCharacters, issues);
    const description = readOptionalString(
      definition.description,
      `${path}.description`,
      EXTENSION_ADAPTER_LIMITS.descriptionCharacters,
      issues
    );
    if (label && description !== null) {
      output[name] = Object.freeze(description === undefined ? { label } : { label, description });
    }
  }
  return output;
}

function projectTools(value: unknown, issues: IssueCollector): Record<string, ExtensionAdapterToolManifest> | undefined {
  if (!isPlainRecord(value)) {
    issues.add("invalid_value", "$.tools", "tools must be a plain object");
    return undefined;
  }
  const entries = Object.entries(value);
  if (entries.length > EXTENSION_ADAPTER_LIMITS.tools) {
    issues.add("too_many_entries", "$.tools", `tools cannot exceed ${EXTENSION_ADAPTER_LIMITS.tools} entries`);
    return undefined;
  }
  const output: Record<string, ExtensionAdapterToolManifest> = Object.create(null) as Record<
    string,
    ExtensionAdapterToolManifest
  >;
  for (const [name, definition] of entries) {
    const path = propertyPath("$.tools", name);
    if (!isValidExtensionSurfaceName(name)) {
      issues.add("invalid_value", path, "tool name contains unsupported characters or is too long");
      continue;
    }
    if (!isPlainRecord(definition)) {
      issues.add("invalid_value", path, "tool definition must be a plain object");
      continue;
    }
    requireExactKeys(definition, path, ["presentation", "label"], issues, ["presentation"]);
    const presentation = definition.presentation;
    if (typeof presentation !== "string" || !TOOL_PRESENTATIONS.has(presentation as ExtensionAdapterToolPresentation)) {
      issues.add("invalid_value", `${path}.presentation`, "presentation must be generic, command, read, or change");
      continue;
    }
    const label = readOptionalString(definition.label, `${path}.label`, EXTENSION_ADAPTER_LIMITS.labelCharacters, issues);
    if (label !== null) {
      const typedPresentation = presentation as ExtensionAdapterToolPresentation;
      output[name] = Object.freeze(label === undefined ? { presentation: typedPresentation } : {
        presentation: typedPresentation,
        label
      });
    }
  }
  return output;
}

function inspectJsonValue(
  value: unknown,
  path: string,
  depth: number,
  ancestors: WeakSet<object>,
  state: { nodes: number },
  issues: IssueCollector
): void {
  state.nodes += 1;
  if (state.nodes > EXTENSION_ADAPTER_LIMITS.jsonNodes) {
    issues.add("too_complex", "$", `manifest exceeds ${EXTENSION_ADAPTER_LIMITS.jsonNodes} JSON nodes`);
    return;
  }
  if (depth > EXTENSION_ADAPTER_LIMITS.jsonDepth) {
    issues.add("too_deep", path, `manifest exceeds JSON depth ${EXTENSION_ADAPTER_LIMITS.jsonDepth}`);
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.add("not_json", path, "numbers must be finite");
    return;
  }
  if (typeof value !== "object") {
    issues.add("not_json", path, "manifest values must be plain JSON data");
    return;
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    issues.add("not_json", path, "objects must use Object.prototype or a null prototype");
    return;
  }
  if (ancestors.has(value)) {
    issues.add("not_json", path, "cyclic references are not valid JSON");
    return;
  }
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      issues.add("not_json", path, "symbol keys are not valid JSON");
      continue;
    }
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      issues.add("not_json", propertyPath(path, key), "manifest properties must be enumerable data properties");
      continue;
    }
    if (DANGEROUS_KEYS.has(key)) {
      issues.add("dangerous_key", propertyPath(path, key), `property ${key} is forbidden`);
      continue;
    }
    inspectJsonValue(descriptor.value, propertyPath(path, key), depth + 1, ancestors, state, issues);
  }
  ancestors.delete(value);
}

function requireExactKeys(
  value: JsonRecord,
  path: string,
  allowed: readonly string[],
  issues: IssueCollector,
  required: readonly string[] = allowed
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (allowedSet.has(key)) continue;
    const code = EXECUTABLE_FIELDS.has(key.toLowerCase()) ? "executable_field" : "unknown_field";
    issues.add(code, propertyPath(path, key), `property ${key} is not allowed`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) issues.add("missing_field", propertyPath(path, key), `property ${key} is required`);
  }
}

function readString(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  issues: IssueCollector
): string | undefined {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    issues.add("invalid_value", path, `value must be a string between ${minimum} and ${maximum} characters`);
    return undefined;
  }
  return value;
}

function readOptionalString(
  value: unknown,
  path: string,
  maximum: number,
  issues: IssueCollector
): string | undefined | null {
  if (value === undefined) return undefined;
  return readString(value, path, 1, maximum, issues) ?? null;
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

class IssueCollector {
  readonly #issues: ExtensionAdapterValidationIssue[] = [];

  add(code: ExtensionAdapterValidationIssueCode, path: string, message: string): void {
    if (this.#issues.length >= EXTENSION_ADAPTER_LIMITS.validationIssues) return;
    this.#issues.push(Object.freeze({ code, path, message }));
  }

  hasIssues(): boolean {
    return this.#issues.length > 0;
  }

  finish(): readonly ExtensionAdapterValidationIssue[] {
    return Object.freeze([...this.#issues]);
  }
}
