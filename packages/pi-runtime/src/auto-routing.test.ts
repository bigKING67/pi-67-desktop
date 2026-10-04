import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { AUTO_MODEL_ID, AUTO_MODEL_PROVIDER, bindDesktopAutoRouting } from "./auto-routing.js";
import { createAutoRoutingFixture } from "./auto-routing.test-support.js";
import { markSharedMemoryProvenance } from "./session-memory-provenance.js";
import { projectSessionModels } from "./session-snapshot.js";
import { selection } from "./auto-routing.test-support.js";

describe("Desktop Auto routing contracts", () => {
  it("keeps the selected Auto identity visible but unavailable when a candidate disappears", async () => {
    const fixture = await createAutoRoutingFixture();
    try {
      expect(projectSessionModels(fixture.session).find((model) => model.provider === AUTO_MODEL_PROVIDER)?.configured).toBe(true);
      await writeFile(`${fixture.agentDir}/settings.json`, JSON.stringify({ pi67Desktop: { autoRouting: {
        ...selection(), complex: { provider: "fixture", model: "removed" }
      } } }), "utf8");
      await fixture.session.settingsManager.reload();
      expect(projectSessionModels(fixture.session).find((model) => model.provider === AUTO_MODEL_PROVIDER)?.configured).toBe(false);
      await fixture.session.prompt("Do work");
      expect(fixture.providerCalls).toEqual([]);
    } finally { await fixture.dispose(); }
  });
  it("does not register a fallback Auto model without global configuration", async () => {
    const fixture = await createAutoRoutingFixture({ autoRouting: false });
    try {
      expect(fixture.runtime.getModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID)).toBeUndefined();
      expect(fixture.providerCalls).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  it("adds Auto to the initial catalog without overriding Pi's saved physical default", async () => {
    const fixture = await createAutoRoutingFixture({ useSavedDefault: true });
    try {
      expect(fixture.runtime.getModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID)).toMatchObject({
        provider: AUTO_MODEL_PROVIDER, id: AUTO_MODEL_ID
      });
      expect(fixture.session.model).toMatchObject({ provider: "fixture", id: "standard" });
      expect(fixture.session.settingsManager.getDefaultProvider()).toBe("fixture");
      expect(fixture.session.settingsManager.getDefaultModel()).toBe("standard");
    } finally {
      await fixture.dispose();
    }
  });

  it("blocks an untrusted Workspace before invoking the judge or candidates", async () => {
    const untrusted = await createAutoRoutingFixture({ trusted: false });
    try {
      await untrusted.session.prompt("Do work");
      expect(untrusted.providerCalls).toEqual([]);
    } finally {
      await untrusted.dispose();
    }
  });

  it("blocks shared history before invoking the judge or candidates", async () => {
    const fixture = await createAutoRoutingFixture();
    try {
      markSharedMemoryProvenance(fixture.manager);
      await fixture.session.prompt("Do work");
      expect(fixture.session.agent.state.errorMessage).toContain("AUTO_SHARED_HISTORY_UNSUPPORTED");
      expect(fixture.providerCalls).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  it("rejects a direct Auto selection after configuration is disabled instead of falling back", async () => {
    const fixture = await createAutoRoutingFixture();
    try {
      const auto = fixture.runtime.getModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID);
      if (!auto) throw new Error("Expected Auto model.");
      await writeFile(`${fixture.agentDir}/settings.json`, "{}\n", "utf8");
      await fixture.session.settingsManager.reload();
      // A loaded catalog entry stays selectable; route must still fail closed when
      // the current global settings are no longer configured.
      await fixture.session.setModel(auto);
      await fixture.session.prompt("No fallback");
      expect(fixture.providerCalls).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  it("binds idempotently and exposes the native virtual catalog entry", async () => {
    const fixture = await createAutoRoutingFixture();
    try {
      const auto = fixture.runtime.getModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID);
      expect(auto).toMatchObject({ provider: AUTO_MODEL_PROVIDER, id: AUTO_MODEL_ID, input: ["text", "image"] });
      await bindDesktopAutoRouting(fixture.session);
      expect(fixture.runtime.getPhysicalModel(AUTO_MODEL_PROVIDER, AUTO_MODEL_ID)).toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  });
});
