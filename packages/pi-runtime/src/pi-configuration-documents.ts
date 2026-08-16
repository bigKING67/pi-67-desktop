import {
  applyEdits,
  modify,
  parse,
  printParseErrorCode,
  type FormattingOptions,
  type ParseError
} from "jsonc-parser";
import type { ProviderSummary } from "@pi67/domain";
import type {
  PiConfigurationHeaderMutation,
  PiDefaultModelSelection,
  PiModelConfigurationInput,
  PiModelConfigurationView,
  PiProviderConfigurationInput,
  PiProviderConfigurationView,
  PiVisionAssistantOverride
} from "@pi67/protocol";

type JsonObject = Record<string, unknown>;

export interface ParsedModelsDocument {
  root: JsonObject;
  providers: JsonObject;
}

export interface ParsedSettingsDocument {
  root: JsonObject;
  selection?: PiDefaultModelSelection;
  visionAssistant?: PiVisionAssistantOverride;
}

export interface RuntimeModelConfigurationProjection {
  provider: string;
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  input: readonly ("text" | "image")[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  headers?: Readonly<Record<string, unknown>>;
}

export function parseModelsDocument(content: string | undefined): ParsedModelsDocument {
  const errors: ParseError[] = [];
  const parsed: unknown = content === undefined || content.trim() === ""
    ? {}
    : parse(content, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    throw new Error(`models.json is invalid JSONC (${printParseErrorCode(errors[0]!.error)}).`);
  }
  if (!isPlainObject(parsed)) throw new Error("models.json must contain an object.");
  const rawProviders = parsed.providers;
  if (rawProviders !== undefined && !isPlainObject(rawProviders)) {
    throw new Error("models.json providers must contain an object.");
  }
  return { root: parsed, providers: rawProviders ?? {} };
}

export function parseSettingsDocument(content: string | undefined): ParsedSettingsDocument {
  const errors: ParseError[] = [];
  const parsed: unknown = content === undefined || content.trim() === ""
    ? {}
    : parse(content, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    throw new Error(`settings.json is invalid JSONC (${printParseErrorCode(errors[0]!.error)}).`);
  }
  if (!isPlainObject(parsed)) throw new Error("settings.json must contain an object.");
  const provider = optionalString(parsed.defaultProvider);
  const model = optionalString(parsed.defaultModel);
  const pi67Desktop = isPlainObject(parsed.pi67Desktop) ? parsed.pi67Desktop : undefined;
  const visionAssistant = parseVisionAssistant(pi67Desktop?.visionAssistant);
  return {
    root: parsed,
    ...(provider && model ? { selection: { provider, model } } : {}),
    ...(visionAssistant ? { visionAssistant } : {})
  };
}

export function projectProviderConfigurations(
  document: ParsedModelsDocument,
  runtimeProviders: readonly ProviderSummary[],
  runtimeModels: readonly RuntimeModelConfigurationProjection[]
): PiProviderConfigurationView[] {
  const runtimeById = new Map(runtimeProviders.map((provider) => [provider.id, provider]));
  const runtimeModelsByProvider = new Map<string, RuntimeModelConfigurationProjection[]>();
  for (const model of runtimeModels) {
    const models = runtimeModelsByProvider.get(model.provider) ?? [];
    models.push(model);
    runtimeModelsByProvider.set(model.provider, models);
  }
  const providerIds = new Set([...Object.keys(document.providers), ...runtimeById.keys()]);
  return [...providerIds]
    .sort((left, right) => left.localeCompare(right))
    .map((providerId) => projectProvider(
      providerId,
      isPlainObject(document.providers[providerId]) ? document.providers[providerId] : {},
      Object.hasOwn(document.providers, providerId),
      runtimeById.get(providerId),
      runtimeModelsByProvider.get(providerId) ?? []
    ));
}

export function saveProviderDocument(
  content: string | undefined,
  input: PiProviderConfigurationInput
): string {
  const source = content ?? "{}\n";
  const document = parseModelsDocument(source);
  assertUniqueModelIds(input.models);
  const existingValue = document.providers[input.id];
  const existing = isPlainObject(existingValue) ? existingValue : undefined;
  if (!existing) {
    const provider = buildProviderObject({}, input);
    return editJsonc(source, ["providers", input.id], provider);
  }

  let next = source;
  next = setOptional(next, ["providers", input.id, "name"], normalizedOptional(input.name));
  next = setOptional(next, ["providers", input.id, "baseUrl"], normalizedOptional(input.baseUrl));
  next = setOptional(next, ["providers", input.id, "api"], normalizedOptional(input.api));
  next = setOptional(next, ["providers", input.id, "oauth"], input.oauth);
  next = setOptional(next, ["providers", input.id, "authHeader"], input.authHeader);

  const nextHeaders = applyHeaderMutations(existing.headers, input.headers);
  if (nextHeaders !== undefined) next = editJsonc(next, ["providers", input.id, "headers"], nextHeaders);

  if (input.advancedJson !== undefined) {
    const advanced = parseAdvancedJson(input.advancedJson, ["compat", "modelOverrides"]);
    next = setOptional(next, ["providers", input.id, "compat"], advanced.compat);
    next = setOptional(
      next,
      ["providers", input.id, "modelOverrides"],
      mergeModelOverrideHeaders(existing.modelOverrides, advanced.modelOverrides)
    );
  }

  const existingModels = Array.isArray(existing.models) ? existing.models : [];
  const models = input.models.map((model) => buildModelObject(
    existingModels.find((candidate) => isPlainObject(candidate) && candidate.id === model.id),
    model
  ));
  return editJsonc(next, ["providers", input.id, "models"], models);
}

export function removeProviderDocument(content: string | undefined, providerId: string): string {
  const source = content ?? "{}\n";
  parseModelsDocument(source);
  return editJsonc(source, ["providers", providerId], undefined);
}

export function setDefaultModelDocument(
  content: string | undefined,
  selection: PiDefaultModelSelection | undefined
): string {
  const source = content ?? "{}\n";
  parseSettingsDocument(source);
  let next = setOptional(source, ["defaultProvider"], selection?.provider);
  next = setOptional(next, ["defaultModel"], selection?.model);
  return next;
}

export function setVisionAssistantDocument(
  content: string | undefined,
  value: PiVisionAssistantOverride | undefined
): string {
  const source = content ?? "{}\n";
  parseSettingsDocument(source);
  return editJsonc(source, ["pi67Desktop", "visionAssistant"], value);
}

function projectProvider(
  providerId: string,
  provider: JsonObject,
  definedInModelsJson: boolean,
  runtime: ProviderSummary | undefined,
  runtimeModels: readonly RuntimeModelConfigurationProjection[]
): PiProviderConfigurationView {
  const rawModels = Array.isArray(provider.models) ? provider.models : [];
  const configuredModels = rawModels
    .filter(isPlainObject)
    .map(projectModel)
    .filter((model): model is PiModelConfigurationView => model !== undefined);
  const models = configuredModels.length > 0
    ? configuredModels
    : runtimeModels.map(projectRuntimeModel);
  const advanced = pickAdvanced(provider, ["compat", "modelOverrides"]);
  const displayName = optionalString(provider.name) ?? runtime?.label;
  return {
    id: providerId,
    ...(displayName ? { name: displayName } : {}),
    ...(optionalString(provider.baseUrl) ? { baseUrl: optionalString(provider.baseUrl)! } : {}),
    ...(optionalString(provider.api) ? { api: optionalString(provider.api)! } : {}),
    ...(provider.oauth === "radius" ? { oauth: "radius" as const } : {}),
    ...(typeof provider.authHeader === "boolean" ? { authHeader: provider.authHeader } : {}),
    origin: definedInModelsJson ? "models.json" : "builtin",
    configured: runtime?.configured ?? false,
    ...(runtime?.credentialSource ? { credentialSource: runtime.credentialSource } : {}),
    ...(runtime?.credentialLabel ? { credentialLabel: runtime.credentialLabel } : {}),
    modelsJsonApiKeyConfigured: typeof provider.apiKey === "string" && provider.apiKey.length > 0,
    headerNames: headerNames(provider.headers),
    models,
    modelCount: runtime?.modelCount ?? models.length,
    advancedJson: JSON.stringify(advanced, null, 2)
  };
}

function projectRuntimeModel(model: RuntimeModelConfigurationProjection): PiModelConfigurationView {
  const input = [...new Set(model.input)];
  return {
    id: model.id,
    ...(model.name.trim() ? { name: model.name } : {}),
    ...(model.api.trim() ? { api: model.api } : {}),
    ...(model.baseUrl.trim() ? { baseUrl: model.baseUrl } : {}),
    input: input.length > 0 ? input : ["text"],
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headerNames: headerNames(model.headers),
    advancedJson: "{}"
  };
}

function projectModel(model: JsonObject): PiModelConfigurationView | undefined {
  const id = optionalString(model.id);
  if (!id) return undefined;
  const input = Array.isArray(model.input)
    ? model.input.filter((value): value is "text" | "image" => value === "text" || value === "image")
    : ["text" as const];
  return {
    id,
    ...(optionalString(model.name) ? { name: optionalString(model.name)! } : {}),
    ...(optionalString(model.api) ? { api: optionalString(model.api)! } : {}),
    ...(optionalString(model.baseUrl) ? { baseUrl: optionalString(model.baseUrl)! } : {}),
    input: input.length > 0 ? [...new Set(input)] : ["text"],
    reasoning: model.reasoning === true,
    ...(positiveNumber(model.contextWindow) ? { contextWindow: positiveNumber(model.contextWindow)! } : {}),
    ...(positiveNumber(model.maxTokens) ? { maxTokens: positiveNumber(model.maxTokens)! } : {}),
    headerNames: headerNames(model.headers),
    advancedJson: JSON.stringify(pickAdvanced(model, ["thinkingLevelMap", "cost", "compat"]), null, 2)
  };
}

function buildProviderObject(existing: JsonObject, input: PiProviderConfigurationInput): JsonObject {
  const next = structuredClone(existing);
  assignOptional(next, "name", normalizedOptional(input.name));
  assignOptional(next, "baseUrl", normalizedOptional(input.baseUrl));
  assignOptional(next, "api", normalizedOptional(input.api));
  assignOptional(next, "oauth", input.oauth);
  assignOptional(next, "authHeader", input.authHeader);
  const headers = applyHeaderMutations(existing.headers, input.headers);
  if (headers !== undefined) next.headers = headers;
  if (input.advancedJson !== undefined) {
    const advanced = parseAdvancedJson(input.advancedJson, ["compat", "modelOverrides"]);
    assignOptional(next, "compat", advanced.compat);
    assignOptional(next, "modelOverrides", mergeModelOverrideHeaders(existing.modelOverrides, advanced.modelOverrides));
  }
  const existingModels = Array.isArray(existing.models) ? existing.models : [];
  next.models = input.models.map((model) => buildModelObject(
    existingModels.find((candidate) => isPlainObject(candidate) && candidate.id === model.id),
    model
  ));
  return next;
}

function buildModelObject(existingValue: unknown, input: PiModelConfigurationInput): JsonObject {
  const existing = isPlainObject(existingValue) ? existingValue : {};
  const next = structuredClone(existing);
  next.id = input.id;
  assignOptional(next, "name", normalizedOptional(input.name));
  assignOptional(next, "api", normalizedOptional(input.api));
  assignOptional(next, "baseUrl", normalizedOptional(input.baseUrl));
  assignOptional(next, "input", input.input && input.input.length > 0 ? [...new Set(input.input)] : undefined);
  assignOptional(next, "reasoning", input.reasoning);
  assignOptional(next, "contextWindow", input.contextWindow);
  assignOptional(next, "maxTokens", input.maxTokens);
  const headers = applyHeaderMutations(existing.headers, input.headers);
  if (headers !== undefined) next.headers = headers;
  if (input.advancedJson !== undefined) {
    const advanced = parseAdvancedJson(input.advancedJson, ["thinkingLevelMap", "cost", "compat"]);
    assignOptional(next, "thinkingLevelMap", advanced.thinkingLevelMap);
    assignOptional(next, "cost", advanced.cost);
    assignOptional(next, "compat", advanced.compat);
  }
  return next;
}

function applyHeaderMutations(
  existingValue: unknown,
  mutations: PiConfigurationHeaderMutation[] | undefined
): JsonObject | undefined {
  if (mutations === undefined) return undefined;
  const next = isPlainObject(existingValue) ? structuredClone(existingValue) : {};
  const seen = new Set<string>();
  for (const mutation of mutations) {
    const name = mutation.name.trim();
    const canonical = name.toLocaleLowerCase("en-US");
    if (!name || seen.has(canonical)) throw new Error("Header mutations must use unique, non-empty names.");
    seen.add(canonical);
    const existingName = Object.keys(next).find((candidate) => candidate.toLocaleLowerCase("en-US") === canonical);
    if (mutation.remove === true) {
      if (existingName) delete next[existingName];
      continue;
    }
    if (mutation.value === undefined) continue;
    if (existingName && existingName !== name) delete next[existingName];
    next[name] = mutation.value;
  }
  return next;
}

function parseAdvancedJson(content: string, allowedKeys: readonly string[]): JsonObject {
  const parsed: unknown = content.trim() === "" ? {} : JSON.parse(content);
  if (!isPlainObject(parsed)) throw new Error("Advanced configuration must contain a JSON object.");
  const unexpected = Object.keys(parsed).find((key) => !allowedKeys.includes(key));
  if (unexpected) throw new Error(`Advanced configuration does not support the field: ${unexpected}.`);
  assertNoSecretFields(parsed);
  return parsed;
}

function assertNoSecretFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoSecretFields);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key.toLocaleLowerCase("en-US") === "apikey" || key.toLocaleLowerCase("en-US") === "headers") {
      throw new Error("Advanced configuration cannot read or write credential and header values.");
    }
    assertNoSecretFields(child);
  }
}

function mergeModelOverrideHeaders(existingValue: unknown, nextValue: unknown): unknown {
  if (!isPlainObject(nextValue)) return nextValue;
  const existing = isPlainObject(existingValue) ? existingValue : {};
  const next = structuredClone(nextValue);
  for (const [modelId, override] of Object.entries(next)) {
    if (!isPlainObject(override)) continue;
    const existingOverride = isPlainObject(existing[modelId]) ? existing[modelId] : undefined;
    if (isPlainObject(existingOverride?.headers)) override.headers = structuredClone(existingOverride.headers);
  }
  return next;
}

function pickAdvanced(source: JsonObject, keys: readonly string[]): JsonObject {
  const result: JsonObject = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = redactSecretFields(source[key]);
  }
  return result;
}

function redactSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecretFields);
  if (!isPlainObject(value)) return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (key.toLocaleLowerCase("en-US") === "apikey" || key.toLocaleLowerCase("en-US") === "headers") continue;
    result[key] = redactSecretFields(child);
  }
  return result;
}

function headerNames(value: unknown): string[] {
  return isPlainObject(value) ? Object.keys(value) : [];
}

function assertUniqueModelIds(models: readonly PiModelConfigurationInput[]): void {
  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) throw new Error(`Provider model ids must be unique: ${model.id}.`);
    ids.add(model.id);
  }
}

function editJsonc(content: string, path: Array<string | number>, value: unknown): string {
  return applyEdits(content, modify(content, path, value, { formattingOptions: formatting(content) }));
}

function setOptional(content: string, path: Array<string | number>, value: unknown): string {
  return editJsonc(content, path, value);
}

function formatting(content: string): FormattingOptions {
  const line = content.split(/\r?\n/u).find((candidate) => /^\s+\S/u.test(candidate));
  const indentation = line?.match(/^\s+/u)?.[0] ?? "  ";
  return {
    insertSpaces: !indentation.includes("\t"),
    tabSize: indentation.includes("\t") ? 1 : Math.max(1, indentation.length),
    eol: content.includes("\r\n") ? "\r\n" : "\n"
  };
}

function assignOptional(target: JsonObject, key: string, value: unknown): void {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function normalizedOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function parseVisionAssistant(value: unknown): PiVisionAssistantOverride | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) throw new Error("settings.json pi67Desktop.visionAssistant must contain an object.");
  if (value.mode === "disabled") return { mode: "disabled" };
  const provider = optionalString(value.provider);
  const model = optionalString(value.model);
  if (value.mode === "model" && provider && model) return { mode: "model", provider, model };
  throw new Error("settings.json pi67Desktop.visionAssistant must select a Provider/model or be disabled.");
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
