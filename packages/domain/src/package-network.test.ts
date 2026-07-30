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

  it.each([
    undefined,
    null,
    [],
    { npmMode: "automatic", gitMode: "automatic", gitMirrors: [], extra: true },
    { npmMode: "invalid", gitMode: "automatic", gitMirrors: [] },
    { npmMode: "automatic", gitMode: "invalid", gitMirrors: [] },
    { npmMode: "automatic", gitMode: "automatic", gitMirrors: "gitclone" },
    { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["invalid"] },
    { npmMode: "automatic", gitMode: "automatic", gitMirrors: ["gitclone", "ghproxy", "gitclone"] },
    { npmMode: "custom", gitMode: "automatic", gitMirrors: [] },
    { npmMode: "automatic", npmCustomRegistry: "http://registry.example.test", gitMode: "automatic", gitMirrors: [] },
    { npmMode: "automatic", npmCustomRegistry: "https://example.test?q=1", gitMode: "automatic", gitMirrors: [] },
    { npmMode: "automatic", gitMode: "automatic", gitMirrors: [], gitCustomMirrorPrefix: "not a URL" }
  ])("rejects an invalid package source document: %j", (value) => {
    expect(parsePackageNetworkSettings(value)).toBeUndefined();
  });

  it("projects every explicit npm and Git source mode", () => {
    expect(npmRegistryCandidates({
      npmMode: "custom",
      npmCustomRegistry: "https://registry.example.test/",
      gitMode: "offline",
      gitMirrors: []
    })).toEqual([{ id: "npm-custom", role: "custom", url: "https://registry.example.test" }]);
    expect(npmRegistryCandidates({
      npmMode: "mirror-only",
      gitMode: "offline",
      gitMirrors: []
    })).toHaveLength(1);
    expect(npmRegistryCandidates({
      npmMode: "official-only",
      gitMode: "offline",
      gitMirrors: []
    })[0]?.id).toBe("npm-official");

    const customGit = gitSourceCandidates({
      npmMode: "offline",
      gitMode: "mirror-only",
      gitMirrors: [],
      gitCustomMirrorPrefix: "https://mirror.example.test/"
    });
    expect(customGit).toEqual([{
      id: "git-custom",
      role: "custom",
      transportUrl: "https://mirror.example.test/https://github.com/arpagon/pi-rewind.git",
      insteadOfPrefix: "https://mirror.example.test/https://github.com/"
    }]);
    expect(gitSourceCandidates({
      npmMode: "offline",
      gitMode: "official-only",
      gitMirrors: ["gitclone"]
    })).toEqual([{
      id: "git-official",
      role: "official",
      transportUrl: "https://github.com/arpagon/pi-rewind.git"
    }]);
    expect(gitSourceCandidates(DEFAULT_PACKAGE_NETWORK_SETTINGS, "https://example.test/not-github"))
      .toEqual(expect.not.arrayContaining([expect.objectContaining({ id: "git-gitclone" })]));
    expect(gitSourceCandidates(DEFAULT_PACKAGE_NETWORK_SETTINGS, "invalid URL"))
      .toEqual(expect.not.arrayContaining([expect.objectContaining({ id: "git-gitclone" })]));
  });
});
