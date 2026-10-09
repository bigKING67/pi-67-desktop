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

/** A generic profile's `model`: it runs whichever model the user's image source names. */
export const ANY_MODEL = "*";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

/** Whether `model` may run under `profileId`: the profile's own model, or any well-formed id on a generic profile. */
export function profileAllowsModel(profileId: unknown, model: unknown): model is string {
  const own = typeof profileId === "string" ? PROFILE_MODELS.get(profileId) : undefined;
  return typeof model === "string" && own !== undefined && (own === ANY_MODEL ? MODEL_ID.test(model) : own === model);
}

/** The model a job runs: the profile's own, or the requested one on a generic profile. */
export function resolveProfileModel(profileId: unknown, requested?: unknown): string | undefined {
  const own = typeof profileId === "string" ? PROFILE_MODELS.get(profileId) : undefined;
  if (own === undefined) return undefined;
  const model = requested ?? own;
  return profileAllowsModel(profileId, model) ? model : undefined;
}

/** The execution surface that lists `profileId` (each profile belongs to one image API). */
export function profileSurface(profileId: string): string | undefined {
  return [...surfaceProfiles.values()].find((surface) => Array.isArray(surface.provider_profiles) && surface.provider_profiles.includes(profileId))?.surface_id as string | undefined;
}
