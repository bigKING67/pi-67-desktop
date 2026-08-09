export const EXTENSION_ADAPTER_SCHEMA_VERSION = 1 as const;

export const EXTENSION_ADAPTER_LIMITS = Object.freeze({
  manifestBytes: 32 * 1024,
  adapterIdCharacters: 80,
  packageNameCharacters: 214,
  versionRangeCharacters: 120,
  surfaceNameCharacters: 128,
  labelCharacters: 120,
  descriptionCharacters: 512,
  manifests: 512,
  commands: 128,
  tools: 128,
  jsonDepth: 8,
  jsonNodes: 2_048,
  validationIssues: 32
});

export type ExtensionAdapterToolPresentation = "generic" | "command" | "read" | "change" | "delegated";

export interface ExtensionAdapterCommandManifest {
  readonly label: string;
  readonly description?: string;
}

export interface ExtensionAdapterToolManifest {
  readonly presentation: ExtensionAdapterToolPresentation;
  readonly label?: string;
}

export interface ExtensionAdapterManifest {
  readonly schemaVersion: typeof EXTENSION_ADAPTER_SCHEMA_VERSION;
  readonly id: string;
  readonly package: string;
  readonly versionRange: string;
  readonly commands: Readonly<Record<string, ExtensionAdapterCommandManifest>>;
  readonly tools: Readonly<Record<string, ExtensionAdapterToolManifest>>;
}

export type ExtensionAdapterValidationIssueCode =
  | "dangerous_key"
  | "empty_surface"
  | "executable_field"
  | "invalid_value"
  | "missing_field"
  | "not_json"
  | "too_complex"
  | "too_deep"
  | "too_large"
  | "too_many_entries"
  | "unknown_field";

export interface ExtensionAdapterValidationIssue {
  readonly code: ExtensionAdapterValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export type ExtensionAdapterValidationResult =
  | { readonly success: true; readonly manifest: ExtensionAdapterManifest }
  | { readonly success: false; readonly issues: readonly ExtensionAdapterValidationIssue[] };
