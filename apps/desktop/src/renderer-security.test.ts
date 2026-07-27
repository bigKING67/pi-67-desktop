import { describe, expect, it } from "vitest";
import {
  DEVELOPMENT_RENDERER_URL,
  isExpectedRendererLocation,
  isTrustedRendererOrigin,
  PACKAGED_RENDERER_URL,
  rendererOrigin,
  resolveRendererUrl
} from "./renderer-security.js";

describe("resolveRendererUrl", () => {
  it("ignores a configured development URL in packaged builds", () => {
    expect(resolveRendererUrl(true, "https://renderer.invalid/")).toBe(PACKAGED_RENDERER_URL);
  });

  it("accepts only the exact loopback Vite URL in development", () => {
    expect(resolveRendererUrl(false, "http://127.0.0.1:5173")).toBe(DEVELOPMENT_RENDERER_URL);
    expect(resolveRendererUrl(false, DEVELOPMENT_RENDERER_URL)).toBe(DEVELOPMENT_RENDERER_URL);

    for (const value of [
      "http://localhost:5173/",
      "http://127.0.0.1:5174/",
      "http://127.0.0.1:5173/index.html",
      "http://user@127.0.0.1:5173/",
      "http://127.0.0.1:5173/?mode=dev",
      "http://127.0.0.1:5173/#fixture",
      " https://127.0.0.1:5173/"
    ]) {
      expect(() => resolveRendererUrl(false, value)).toThrow(/must be exactly/u);
    }
  });

  it("uses packaged assets when no development server is configured", () => {
    expect(resolveRendererUrl(false, undefined)).toBe(PACKAGED_RENDERER_URL);
  });
});

describe("renderer location policy", () => {
  it("derives only the two trusted target origins", () => {
    expect(rendererOrigin(PACKAGED_RENDERER_URL)).toBe("app://pi67");
    expect(rendererOrigin(DEVELOPMENT_RENDERER_URL)).toBe("http://127.0.0.1:5173");
    expect(() => rendererOrigin("https://renderer.invalid/")).toThrow(/untrusted/u);
  });

  it("requires the exact renderer document before attaching a port", () => {
    expect(isExpectedRendererLocation("app://pi67/index.html", PACKAGED_RENDERER_URL)).toBe(true);
    expect(isExpectedRendererLocation("app://pi67/other.html", PACKAGED_RENDERER_URL)).toBe(false);
    expect(isExpectedRendererLocation("http://127.0.0.1:5173/", DEVELOPMENT_RENDERER_URL)).toBe(true);
    expect(isExpectedRendererLocation("http://127.0.0.1:5173/?redirected=1", DEVELOPMENT_RENDERER_URL)).toBe(false);
    expect(isExpectedRendererLocation("not a URL", PACKAGED_RENDERER_URL)).toBe(false);
  });

  it("recognizes only trusted renderer origins", () => {
    expect(isTrustedRendererOrigin("app://pi67")).toBe(true);
    expect(isTrustedRendererOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isTrustedRendererOrigin("https://renderer.invalid")).toBe(false);
  });
});
