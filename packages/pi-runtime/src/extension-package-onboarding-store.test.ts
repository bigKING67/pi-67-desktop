import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExtensionPackageOnboardingStore } from "./extension-package-onboarding-store.js";

const roots: string[] = [];
const SOURCE = "npm:pi-observational-memory";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ExtensionPackageOnboardingStore", () => {
  it("prompts only a fresh profile once and persists decline", async () => {
    const root = await storageRoot();
    const fresh = new ExtensionPackageOnboardingStore({
      storageRoot: root,
      freshProfile: true,
      now: () => 1_786_000_000_000
    });
    await expect(fresh.status(SOURCE, "global", false)).resolves.toMatchObject({ state: "unseen" });
    await expect(fresh.decline(SOURCE, "global")).resolves.toMatchObject({ state: "declined" });

    const restarted = new ExtensionPackageOnboardingStore({
      storageRoot: root,
      freshProfile: false,
      now: () => 1_786_000_000_001
    });
    await expect(restarted.status(SOURCE, "global", false)).resolves.toMatchObject({ state: "declined" });
  });

  it("suppresses existing profiles and exposes failed installs for explicit retry", async () => {
    const existing = new ExtensionPackageOnboardingStore({ freshProfile: false });
    await expect(existing.status(SOURCE, "global", false)).resolves.toMatchObject({
      state: "suppressed-existing"
    });

    const fresh = new ExtensionPackageOnboardingStore({ freshProfile: true });
    await fresh.status(SOURCE, "global", false);
    await fresh.markInstalling(SOURCE, "global");
    await fresh.markInstallFailed(SOURCE, "global");
    await expect(fresh.status(SOURCE, "global", false)).resolves.toMatchObject({ state: "install-failed" });
    await fresh.markInstalling(SOURCE, "global");
    await fresh.markInstalled(SOURCE, "global");
    await expect(fresh.status(SOURCE, "global", true)).resolves.toMatchObject({ state: "installed" });
  });
});

async function storageRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-onboarding-"));
  roots.push(root);
  return root;
}
