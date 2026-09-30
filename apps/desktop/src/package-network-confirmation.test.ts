import type { PackageNetworkSettings } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showMessageBox: vi.fn() } }));
const { newlyEffectiveCustomSources } = await import("./package-network-confirmation.js");

const automatic: PackageNetworkSettings = { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone"] };

describe("newlyEffectiveCustomSources", () => {
  it("reports custom sources that start to take effect", () => {
    expect(newlyEffectiveCustomSources(automatic, {
      ...automatic, npmMode: "custom", npmCustomRegistry: "https://registry.example.test",
      gitCustomMirrorPrefix: "https://mirror.example.test"
    })).toEqual(["https://registry.example.test", "https://mirror.example.test/https://github.com/"]);
  });

  it("ignores unchanged, removed and inactive custom sources", () => {
    const custom = { ...automatic, npmMode: "custom" as const, npmCustomRegistry: "https://registry.example.test" };
    expect(newlyEffectiveCustomSources(custom, custom)).toEqual([]);
    expect(newlyEffectiveCustomSources(custom, automatic)).toEqual([]);
    expect(newlyEffectiveCustomSources(automatic, {
      ...automatic, gitMode: "official-only", gitCustomMirrorPrefix: "https://mirror.example.test"
    })).toEqual([]);
  });
});
