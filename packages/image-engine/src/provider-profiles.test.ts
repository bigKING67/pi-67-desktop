import { describe, expect, it } from "vitest";
import { executeProvider, type ProviderReceipt } from "./provider.js";
import { canonicalContracts } from "./contracts.js";
import { ANY_MODEL, PROFILE_MODELS, profileAllowsModel, profileSurface, resolveProfileModel } from "./provider-profiles.js";
import { providerFixture } from "./test-support/provider-fixture.js";

const GENERIC_OPENAI = "newmoney.openai-images.generic";
const SEEDREAM_PRO = "volcengine.seedream-5.0-pro.260628";

describe("image source profiles", { timeout: 120_000 }, () => {
  it("binds every adapter profile to exactly one surface and resolves models", () => {
    for (const profileId of PROFILE_MODELS.keys()) expect(profileSurface(profileId), profileId).toBeDefined();
    expect(profileSurface(SEEDREAM_PRO)).toBe("volcengine.ark_image_api");
    expect(profileSurface(GENERIC_OPENAI)).toBe("openai.image_api");
    expect(PROFILE_MODELS.get(GENERIC_OPENAI)).toBe(ANY_MODEL);
    expect(resolveProfileModel("openai.gpt-image-2.5.2026-10-09")).toBe("gpt-image-2.5");
    expect(resolveProfileModel("openai.gpt-image-2.5.2026-10-09", "gpt-image-2.5")).toBe("gpt-image-2.5");
    expect(resolveProfileModel("openai.gpt-image-2.5.2026-10-09", "gpt-image-2.5-flare")).toBeUndefined();
    expect(resolveProfileModel(GENERIC_OPENAI)).toBeUndefined();
    expect(resolveProfileModel(GENERIC_OPENAI, "gpt-image-2")).toBe("gpt-image-2");
    for (const bad of ["", "-x", "a b", "x".repeat(129), 7]) expect(profileAllowsModel(GENERIC_OPENAI, bad), String(bad)).toBe(false);
    expect(resolveProfileModel("unknown.profile", "gpt-image-2")).toBeUndefined();
  });

  it("runs any model the source names on a generic profile and records it in a valid receipt", async () => {
    const f = await providerFixture();
    f.job.provider_profile = GENERIC_OPENAI; await f.saveJob();
    await expect(executeProvider(f.root, f.spec, { generator: f.generator })).rejects.toThrow(/does not match the job's provider profile/);
    const result = await executeProvider(f.root, { ...f.spec, model: "gpt-image-2" }, { generator: f.generator });
    if (result.status !== "candidate") throw new Error("expected a candidate");
    expect(f.calls[0]?.parameters.model).toBe("gpt-image-2");
    expect(result.receipt.model).toBe("gpt-image-2");
    expect(canonicalContracts.validateReceipt(result.receipt).valid).toBe(true);
    expect(canonicalContracts.validateReceipt({ ...result.receipt, model: "bad model" } as ProviderReceipt).valid).toBe(false);
  });

  it("runs Seedream jobs on the Ark surface and refuses a model that differs from an exact profile", async () => {
    const f = await providerFixture();
    Object.assign(f.job, { provider_profile: SEEDREAM_PRO, execution_surface: "volcengine.ark_image_api" }); await f.saveJob();
    await expect(executeProvider(f.root, { ...f.spec, model: "doubao-seedream-5-0-flash-260915" }, { generator: f.generator })).rejects.toThrow(/does not match/);
    const result = await executeProvider(f.root, f.spec, { generator: f.generator });
    if (result.status !== "candidate") throw new Error("expected a candidate");
    expect(result.receipt.model).toBe("doubao-seedream-5-0-pro-260628");
    Object.assign(f.job, { job_id: "mismatched", execution_surface: "openai.image_api" }); await f.saveJob();
    await expect(executeProvider(f.root, { ...f.spec, candidate_id: "other" }, { generator: f.generator })).rejects.toThrow(/execution_surface does not support provider_profile/);
  });
});
