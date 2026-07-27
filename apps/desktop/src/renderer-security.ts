export const PACKAGED_RENDERER_URL = "app://pi67/index.html";
export const DEVELOPMENT_RENDERER_URL = "http://127.0.0.1:5173/";

const PACKAGED_RENDERER_ORIGIN = "app://pi67";
const DEVELOPMENT_RENDERER_ORIGIN = "http://127.0.0.1:5173";

export function resolveRendererUrl(isPackaged: boolean, configuredUrl: string | undefined): string {
  if (isPackaged) return PACKAGED_RENDERER_URL;
  if (configuredUrl === undefined) return PACKAGED_RENDERER_URL;
  if (configuredUrl === DEVELOPMENT_RENDERER_URL || configuredUrl === DEVELOPMENT_RENDERER_URL.slice(0, -1)) {
    return DEVELOPMENT_RENDERER_URL;
  }
  throw new Error(`PI67_RENDERER_DEV_URL must be exactly ${DEVELOPMENT_RENDERER_URL}`);
}

export function rendererOrigin(rendererUrl: string): string {
  if (rendererUrl === PACKAGED_RENDERER_URL) return PACKAGED_RENDERER_ORIGIN;
  if (rendererUrl === DEVELOPMENT_RENDERER_URL) return DEVELOPMENT_RENDERER_ORIGIN;
  throw new Error("Cannot derive an origin from an untrusted renderer URL.");
}

export function isExpectedRendererLocation(location: string, rendererUrl: string): boolean {
  try {
    return new URL(location).href === rendererUrl;
  } catch {
    return false;
  }
}

export function isTrustedRendererOrigin(origin: string): boolean {
  return origin === PACKAGED_RENDERER_ORIGIN || origin === DEVELOPMENT_RENDERER_ORIGIN;
}
