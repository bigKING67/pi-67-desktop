import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  prepareWindowsRealUserProfile,
  resolveWindowsRealUserProfilePaths,
  WINDOWS_REAL_USER_CONFIGURED_PROVIDER
} from "./windows-real-user-profile.mjs";

describe("Windows installed real-user Pi profile", () => {
  it("prepares a configured profile in a localized path and keeps the drift target empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi67-windows-profile-"));
    try {
      const profile = resolveWindowsRealUserProfilePaths(root);
      await prepareWindowsRealUserProfile(profile);

      expect(profile.agentDir).toContain("Pi 配置 含空格");
      expect(profile.environmentDriftAgentDir).toContain("错误 Pi 配置 空目录");
      expect(profile.lifecycleUserDataDirectory).toContain("生命周期用户数据 含空格");
      expect(await readdir(profile.environmentDriftAgentDir)).toEqual([]);
      expect(JSON.parse(await readFile(join(profile.agentDir, "auth.json"), "utf8")))
        .toMatchObject({ openai: { type: "api_key" } });
      expect(JSON.parse(await readFile(join(profile.agentDir, "settings.json"), "utf8")))
        .toEqual({ defaultProvider: "openai", defaultModel: "gpt-5" });
      expect(WINDOWS_REAL_USER_CONFIGURED_PROVIDER).toBe("openai");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
