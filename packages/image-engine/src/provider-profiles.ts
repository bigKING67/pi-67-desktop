import { readdirSync, readFileSync } from "node:fs";
import { isRecord, type JsonRecord } from "./document.js";

// Provider profiles and execution surfaces are data shipped beside both `src/` and `dist/`.
// They are the single source of truth for which models the image adapter may call.
const providersUrl = new URL("../providers/", import.meta.url);
const surfacesUrl = new URL("../providers/surfaces/", import.meta.url);

function loadDirectory(url: URL, key: string, label: string): ReadonlyMap<string, JsonRecord> {
  const entries = new Map<string, JsonRecord>();
  for (const entry of readdirSync(url, { withFileTypes: true }).filter((item) => item.isFile() && item.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    const data: unknown = JSON.parse(readFileSync(new URL(entry.name, url), "utf8"));
    if (!isRecord(data)) continue;
    const id = data[key];
    if (typeof id !== "string") continue;
    if (entries.has(id)) throw new Error(`duplicate ${label}: ${id}`);
    entries.set(id, data);
  }
  return entries;
}

export const providerProfiles: ReadonlyMap<string, JsonRecord> = loadDirectory(providersUrl, "profile_id", "provider profile_id");
export const surfaceProfiles: ReadonlyMap<string, JsonRecord> = loadDirectory(surfacesUrl, "surface_id", "execution surface_id");

export const PROFILE_MODELS: ReadonlyMap<string, string> = new Map([...providerProfiles.values()]
  .filter((profile) => isRecord(profile.availability) && profile.availability.network_adapter_in_optional_module === true)
  .map((profile) => [String(profile.profile_id), String(profile.model)] as const)
  .sort(([a], [b]) => a.localeCompare(b)));
export const IMAGE_MODELS: readonly string[] = [...new Set(PROFILE_MODELS.values())];
