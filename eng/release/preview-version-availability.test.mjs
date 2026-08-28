import { describe, expect, it, vi } from "vitest";
import {
  assertAvailablePreviewVersion,
  verifyPreviewVersionAvailability
} from "./preview-version-availability.mjs";

const origin = "https://updates.example";

describe("preview version availability", () => {
  it("accepts the first public preview and a strictly newer prerelease", () => {
    expect(assertAvailablePreviewVersion("0.1.0-alpha.1", null)).toEqual({
      candidateVersion: "0.1.0-alpha.1",
      publicVersion: null
    });
    expect(assertAvailablePreviewVersion("0.1.0-alpha.37", manifest("0.1.0-alpha.36"))).toEqual({
      candidateVersion: "0.1.0-alpha.37",
      publicVersion: "0.1.0-alpha.36"
    });
  });

  it.each(["0.1.0-alpha.36", "0.1.0-alpha.35"])(
    "rejects candidate version %s when Alpha.36 is already public",
    (version) => {
      expect(() => assertAvailablePreviewVersion(version, manifest("0.1.0-alpha.36")))
        .toThrow("must be newer than public version");
    }
  );

  it("rejects stable candidates and malformed public identity", () => {
    expect(() => assertAvailablePreviewVersion("0.1.0", null)).toThrow("canonical prerelease");
    expect(() => assertAvailablePreviewVersion("0.1.0-alpha.37", {
      ...manifest("0.1.0-alpha.36"),
      signed: true
    })).toThrow("manifest identity is invalid");
  });

  it("fetches only the fixed public manifest without redirects", async () => {
    const fetchImpl = vi.fn(async () => response(manifest("0.1.0-alpha.36")));
    await expect(verifyPreviewVersionAvailability({
      candidateVersion: "0.1.0-alpha.37",
      fetchImpl,
      origin
    })).resolves.toEqual({
      candidateVersion: "0.1.0-alpha.37",
      publicVersion: "0.1.0-alpha.36"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${origin}/unsigned-preview-manifest.json`,
      expect.objectContaining({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) })
    );
  });

  it("rejects a manifest response redirected away from the fixed origin", async () => {
    const fetchImpl = vi.fn(async () => response(
      manifest("0.1.0-alpha.36"),
      "https://redirect.example/unsigned-preview-manifest.json"
    ));
    await expect(verifyPreviewVersionAvailability({
      candidateVersion: "0.1.0-alpha.37",
      fetchImpl,
      origin
    })).rejects.toThrow("redirected away from the fixed update origin");
  });
});

function manifest(version) {
  return {
    schemaVersion: 1,
    product: "Pi-67 Desktop",
    channel: "unsigned-preview",
    signed: false,
    version
  };
}

function response(value, url = `${origin}/unsigned-preview-manifest.json`) {
  return { status: 200, ok: true, url, json: async () => value };
}
