import { describe, expect, it } from "vitest";
import {
  resolveUnsignedNativeTarget,
  unsignedPackagingEnvironment
} from "./package-native-unsigned.mjs";

describe("unsigned native packaging policy", () => {
  it("accepts only the two supported native release targets", () => {
    expect(resolveUnsignedNativeTarget("win32", "x64")).toEqual({
      label: "windows-x64",
      arguments: ["--win", "nsis", "--x64", "--publish", "never"]
    });
    expect(resolveUnsignedNativeTarget("darwin", "arm64")).toEqual({
      label: "macos-arm64",
      arguments: ["--mac", "dmg", "zip", "--arm64", "-c.mac.notarize=false", "--publish", "never"]
    });
    expect(() => resolveUnsignedNativeTarget("win32", "arm64")).toThrow(/does not support win32\/arm64/u);
    expect(() => resolveUnsignedNativeTarget("darwin", "x64")).toThrow(/does not support darwin\/x64/u);
    expect(() => resolveUnsignedNativeTarget("linux", "x64")).toThrow(/does not support linux\/x64/u);
  });

  it("cannot consume release signing credentials", () => {
    const environment = unsignedPackagingEnvironment({
      PATH: "/usr/bin",
      CSC_LINK: "certificate",
      CSC_KEY_PASSWORD: "password",
      CSC_NAME: "identity",
      WIN_CSC_LINK: "windows-certificate",
      WIN_CSC_KEY_PASSWORD: "windows-password",
      APPLE_ID: "developer@example.test",
      APPLE_APP_SPECIFIC_PASSWORD: "app-password",
      APPLE_TEAM_ID: "team-id",
      APPLE_API_KEY: "key-path",
      APPLE_API_KEY_ID: "key-id",
      APPLE_API_ISSUER: "issuer"
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
    });
  });
});
