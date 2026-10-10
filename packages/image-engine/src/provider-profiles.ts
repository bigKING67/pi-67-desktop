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

/** The profile a source's model runs under on `surfaceId`: its exact profile, else the surface's generic one. */
export function profileForModel(surfaceId: string, model: string): string | undefined {
  const surface = surfaceProfiles.get(surfaceId);
  const listed = Array.isArray(surface?.provider_profiles) ? surface.provider_profiles.filter((id): id is string => typeof id === "string") : [];
  return listed.find((id) => PROFILE_MODELS.get(id) === model) ?? listed.find((id) => PROFILE_MODELS.get(id) === ANY_MODEL && profileAllowsModel(id, model));
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The size to request for a `width`×`height` target under `profileId`: the target
 * itself when the profile accepts it, else the exact-ratio size (edges on the
 * profile's multiple, inside its pixel range, below its experimental boundary
 * when possible) closest to the target's pixel count. The output is then
 * resampled full-frame to the target; undefined when no exact-ratio size fits,
 * because the engine never crops or stretches.
 */
export function requestSizeFor(profileId: string, width: number, height: number): { width: number; height: number } | undefined {
  const profile = providerProfiles.get(profileId);
  const capabilities = isRecord(profile?.capabilities) ? profile.capabilities : {};
  const size = isRecord(capabilities.size) ? capabilities.size : {};
  const cap = (key: string, fallback: number): number => typeof size[key] === "number" ? size[key] : fallback;
  const multiple = cap("edge_multiple_px", 1), maxEdge = cap("max_edge_px", Number.POSITIVE_INFINITY);
  const minPixels = cap("min_total_pixels", 0), maxPixels = cap("max_total_pixels", Number.POSITIVE_INFINITY);
  const comfortable = Math.min(maxPixels, cap("experimental_above_total_pixels", maxPixels));
  if (Math.max(width, height) / Math.min(width, height) > cap("max_aspect_ratio", Number.POSITIVE_INFINITY)) return undefined;
  const fits = (w: number, h: number, ceiling: number) => w % multiple === 0 && h % multiple === 0 && Math.max(w, h) <= maxEdge && w * h >= minPixels && w * h <= ceiling;
  if (fits(width, height, maxPixels)) return { width, height };
  const divisor = gcd(width, height), a = width / divisor, b = height / divisor;
  // The smallest exact-ratio step whose edges both land on the multiple.
  const stepA = multiple / gcd(multiple, a), stepB = multiple / gcd(multiple, b);
  const step = (stepA * stepB) / gcd(stepA, stepB);
  const target = width * height;
  for (const ceiling of [comfortable, maxPixels]) {
    let best: { width: number; height: number } | undefined;
    for (let k = step; a * k <= Math.min(maxEdge, 16384) && b * k <= Math.min(maxEdge, 16384) && a * k * b * k <= ceiling; k += step) {
      if (fits(a * k, b * k, ceiling) && (!best || Math.abs(a * k * b * k - target) < Math.abs(best.width * best.height - target))) best = { width: a * k, height: b * k };
    }
    if (best) return best;
  }
  return undefined;
}
