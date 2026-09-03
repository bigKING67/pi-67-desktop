import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextMemoryConfigurationStore } from "./context-memory-configuration.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ContextMemoryConfigurationStore", () => {
  it("defaults to private learning with bounded actor-only recall", async () => {
    const store = await createStore();

    await expect(store.read()).resolves.toMatchObject({
      enabled: true,
      endpoint: "http://127.0.0.1:1933",
      defaultPrivacyMode: "private-learning",
      captureToolResults: false,
      actorScopeOnly: true,
      privateExperienceLimit: 1,
      localResourceRecallLimit: 1,
      sharedExperienceLimit: 1,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
  });

  it("rejects credentials and plaintext remote endpoints", async () => {
    const store = await createStore();
    await writeFile(store.path, JSON.stringify({ endpoint: "https://user:secret@example.com" }), "utf8");
    await expect(store.read()).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await writeFile(store.path, JSON.stringify({ endpoint: "http://openviking.example.com" }), "utf8");
    await expect(store.read()).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

    await writeFile(store.path, JSON.stringify({
      enterpriseGatewayEndpoint: "https://datahub.example.com/?access_token=forbidden"
    }), "utf8");
    await expect(store.read()).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
  });

  it("persists only safe effective fields and protects external edits with a revision", async () => {
    const store = await createStore();
    const current = await store.read();
    const updated = await store.update({
      expectedRevision: current.revision,
      enabled: true,
      endpoint: "https://context.example.com/",
      enterpriseGatewayEndpoint: "https://datahub.example.com/",
      defaultPrivacyMode: "full-learning",
      recallTokenBudget: 3_200,
      scoreThreshold: 0.42,
      commitTokenThreshold: 24_000,
      captureAssistantTurns: true,
      privateExperienceLimit: 1,
      localResourceRecallLimit: 1,
      sharedExperienceLimit: 2,
      takeover: { enabled: true, tokenThreshold: 36_000, keepRecentTurns: 4 }
    });

    expect(updated).toMatchObject({
      endpoint: "https://context.example.com",
      defaultPrivacyMode: "full-learning",
      captureToolResults: false,
      actorScopeOnly: true,
      takeover: { tokenThreshold: 36_000, keepRecentTurns: 4 }
    });
    const persisted = JSON.parse(await readFile(store.path, "utf8")) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty("revision");
    expect(JSON.stringify(persisted)).not.toContain("secret");
    expect(persisted).toMatchObject({
      captureToolResults: false,
      recallPeerScope: "actor",
      localResourceRecallLimit: 1,
      sharedExperienceLimit: 2
    });

    await expect(store.update({
      expectedRevision: current.revision,
      enabled: true,
      endpoint: updated.endpoint,
      enterpriseGatewayEndpoint: updated.enterpriseGatewayEndpoint,
      defaultPrivacyMode: updated.defaultPrivacyMode,
      recallTokenBudget: updated.recallTokenBudget,
      scoreThreshold: updated.scoreThreshold,
      commitTokenThreshold: updated.commitTokenThreshold,
      captureAssistantTurns: updated.captureAssistantTurns,
      privateExperienceLimit: updated.privateExperienceLimit,
      localResourceRecallLimit: updated.localResourceRecallLimit,
      sharedExperienceLimit: updated.sharedExperienceLimit,
      takeover: updated.takeover
    })).rejects.toMatchObject({ code: "RESOURCE_CHANGED_EXTERNALLY" });
  });

  it("migrates the legacy shared limit while keeping local resources and enterprise Experiences independent", async () => {
    const store = await createStore();
    await writeFile(store.path, JSON.stringify({ sharedExperienceLimit: 3 }), "utf8");

    const legacy = await store.read();
    expect(legacy).toMatchObject({
      localResourceRecallLimit: 3,
      sharedExperienceLimit: 3
    });

    const updated = await store.update({
      expectedRevision: legacy.revision,
      enabled: legacy.enabled,
      endpoint: legacy.endpoint,
      enterpriseGatewayEndpoint: legacy.enterpriseGatewayEndpoint,
      defaultPrivacyMode: legacy.defaultPrivacyMode,
      recallTokenBudget: legacy.recallTokenBudget,
      scoreThreshold: legacy.scoreThreshold,
      commitTokenThreshold: legacy.commitTokenThreshold,
      captureAssistantTurns: legacy.captureAssistantTurns,
      privateExperienceLimit: legacy.privateExperienceLimit,
      localResourceRecallLimit: 1,
      sharedExperienceLimit: 2,
      takeover: legacy.takeover
    });
    expect(updated).toMatchObject({
      localResourceRecallLimit: 1,
      sharedExperienceLimit: 2
    });
  });
});

async function createStore(): Promise<ContextMemoryConfigurationStore> {
  const root = await mkdtemp(join(tmpdir(), "pi67-context-memory-config-"));
  roots.push(root);
  return new ContextMemoryConfigurationStore(root);
}
