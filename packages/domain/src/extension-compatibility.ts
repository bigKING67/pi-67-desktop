import type { ExtensionCompatibility } from "./runtime-state.js";

export type ExtensionCatalogCompatibility = ExtensionCompatibility | "unknown";

export type ExtensionSurface = "commands" | "tools" | "ui-primitives" | "tui-custom";

export type ExtensionSurfaceCompatibility =
  | "supported"
  | "partial"
  | "tui-only"
  | "unsupported"
  | "unknown"
  | "not-present";

export interface ExtensionSourceRef {
  path: string;
  source: string;
  scope: "user" | "project" | "temporary";
  origin: "package" | "top-level";
}

export interface ExtensionSurfaceAssessment {
  surface: ExtensionSurface;
  status: ExtensionSurfaceCompatibility;
  detail: string;
}

export interface ExtensionCompatibilityAssessment {
  overall: ExtensionCatalogCompatibility;
  detail: string;
  surfaces: ExtensionSurfaceAssessment[];
}

export type ExtensionAdapterSurface = "commands" | "tools";

export interface ExtensionAdapterMatchView {
  adapterId: string;
  schemaVersion: 1;
  package: string;
  installedVersion: string;
  versionRange: string;
  surfaces: ExtensionAdapterSurface[];
  commandCount: number;
  toolCount: number;
}

export interface ExtensionCommandAdapterView {
  adapterId: string;
  package: string;
  label: string;
  description?: string;
}

export interface ExtensionToolAdapterView {
  adapterId: string;
  package: string;
  presentation: "generic" | "command" | "read" | "change";
  label?: string;
}

export interface ExtensionCatalogItem {
  id: string;
  label: string;
  path?: string;
  loadState: "loaded" | "failed";
  source?: ExtensionSourceRef;
  adapter?: ExtensionAdapterMatchView;
  assessment: ExtensionCompatibilityAssessment;
  commandCount: number;
  toolCount: number;
}

export interface ExtensionCatalogResult {
  items: ExtensionCatalogItem[];
  total: number;
  truncated: boolean;
}
