import { describe, expect, it } from "vitest";
import {
  DEFAULT_PACKAGE_NETWORK_SETTINGS,
  defaultPackageNetworkSettings,
  gitSourceCandidates,
  npmRegistryCandidates,
  parsePackageNetworkSettings
} from "./package-network.js";

describe("Package network source policy", () => {
  it("prefers the public npm mirror while retaining the official fallback", () => {
    expect(npmRegistryCandidates(DEFAULT_PACKAGE_NETWORK_SETTINGS)).toEqual([
      { id: "npm-public-mirror", role: "public-mirror", url: "https://registry.npmmirror.com" },
      { id: "npm-official", role: "official", url: "https://registry.npmjs.org" }
    ]);
  });

  it("maps canonical GitHub URLs without changing their package identity", () => {
    expect(gitSourceCandidates(DEFAULT_PACKAGE_NETWORK_SETTINGS, "https://github.com/arpagon/pi-rewind.git"))
      .toEqual([
        {
          id: "git-gitclone",
          role: "public-mirror",
          transportUrl: "https://gitclone.com/github.com/arpagon/pi-rewind.git",
          insteadOfPrefix: "https://gitclone.com/github.com/"
        },
        {
          id: "git-ghproxy",
          role: "public-mirror",
          transportUrl: "https://ghproxy.net/https://github.com/arpagon/pi-rewind.git",
          insteadOfPrefix: "https://ghproxy.net/https://github.com/"
        },
        {
          id: "git-official",
          role: "official",
          transportUrl: "https://github.com/arpagon/pi-rewind.git"
        }
      ]);
  });

  it("turns every network source off in offline mode", () => {
    const settings = { ...DEFAULT_PACKAGE_NETWORK_SETTINGS, npmMode: "offline" as const, gitMode: "offline" as const };
    expect(npmRegistryCandidates(settings)).toEqual([]);
    expect(gitSourceCandidates(settings)).toEqual([]);
  });

  it("accepts only bounded public HTTPS source settings without credentials", () => {
    expect(parsePackageNetworkSettings({
      npmMode: "automatic",
      npmCustomRegistry: "https://registry.example.test/npm/",
      gitMode: "mirror-only",
      gitMirrors: ["ghproxy"],
      gitCustomMirrorPrefix: "https://mirror.example.test/proxy/"
    })).toEqual({
      npmMode: "automatic",
      npmCustomRegistry: "https://registry.example.test/npm",
      gitMode: "mirror-only",
      gitMirrors: ["ghproxy"],
      gitCustomMirrorPrefix: "https://mirror.example.test/proxy"
    });
    expect(parsePackageNetworkSettings({
      npmMode: "custom",
      npmCustomRegistry: "https://user:secret@example.test",
      gitMode: "automatic",
      gitMirrors: []
    })).toBeUndefined();
    expect(parsePackageNetworkSettings({
      npmMode: "automatic",
      gitMode: "automatic",
      gitMirrors: ["gitclone", "gitclone"]
    })).toBeUndefined();
    expect(defaultPackageNetworkSettings()).not.toBe(DEFAULT_PACKAGE_NETWORK_SETTINGS);
  });
});
