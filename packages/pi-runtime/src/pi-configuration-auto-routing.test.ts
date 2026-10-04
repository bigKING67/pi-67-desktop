import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPiConfigurationFixture as createFixture } from "./pi-configuration-service-test-fixture.js";

describe("PiConfigurationService Auto routing", () => {
  it("persists a complete global selection and retains the last saved selection for malformed external settings", async () => {
    const fixture = await createFixture();
    try {
      const initial = await fixture.service.getGlobal();
      const saved = await fixture.service.saveGlobalProvider(initial.revision, {
        id: "pi67-auto-test",
        name: "Pi 67 Auto Test",
        baseUrl: "https://example.invalid/v1",
        api: "openai-responses",
        models: [
          { id: "judge", input: ["text"], reasoning: false },
          { id: "standard", input: ["text"], reasoning: false },
          { id: "complex", input: ["text"], reasoning: false }
        ]
      });
      const credential = await fixture.service.storeGlobalCredential(
        saved.revision,
        "pi67-auto-test",
        "fixture-auto-routing-credential"
      );
      const selection = {
        judge: { provider: "pi67-auto-test", model: "judge" },
        standard: { provider: "pi67-auto-test", model: "standard" },
        complex: { provider: "pi67-auto-test", model: "complex" }
      };
      const configured = await fixture.service.setGlobalAutoRouting(credential.revision, selection);
      expect(configured.autoRouting).toEqual(selection);
      expect(JSON.parse(await readFile(fixture.service.globalSettingsPath, "utf8"))).toMatchObject({
        pi67Desktop: { autoRouting: selection }
      });
      await expect(fixture.service.setGlobalAutoRouting(configured.revision, {
        ...selection,
        complex: selection.standard
      })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });

      const unavailable = await fixture.service.removeGlobalProvider(configured.revision, "pi67-auto-test");
      expect(unavailable.syncState).toBe("current");
      expect(unavailable.autoRouting).toEqual(selection);

      await writeFile(fixture.service.globalSettingsPath, JSON.stringify({
        pi67Desktop: { autoRouting: { judge: selection.judge, standard: selection.standard } }
      }), "utf8");
      const invalid = await fixture.service.reloadGlobal();
      expect(invalid.syncState).toBe("invalid");
      expect(invalid.autoRouting).toEqual(selection);
      expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ file: "global-settings" }));
    } finally {
      await fixture.dispose();
    }
  }, 20_000);
});
