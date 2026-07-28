import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MACOS_ICON_CONTRACT } from "./macos-icon-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("π display branding contract", () => {
  it("uses the locked production icon assets", async () => {
    await expectHash("eng/packaging/pi.ico", "0339a5399508232063654eeeb5ff6e962d85187c8e0637ca288eb6fa9549f70a");
    await expectHash("eng/packaging/pi.icns", "c90bbe84fa921915d2ed85a9ec55cf80c382a8a07e04c90450e1914388f94a87");
    await expectHash("eng/packaging/icon.png", "86f591c968eba4b76922a94cfc88f0eed8734b71d527d8f7da877182f1a12c39");
    await expectHash("eng/packaging/icon.svg", "85188f762925ff7ab4e01ecdb88a886ff8d0e98eaeae8538161f4995ad802c04");
    await expectHash("eng/packaging/pi-icon-sources/png/pi_icon_16x16.png", "8267fbdc1a543c7f51f04097bf387a6d44501c992b0b8871666f7062ae10a9e0");
    await expectHash("eng/packaging/pi-icon-sources/png/pi_icon_32x32.png", "9015396150512e554fa0315e8b5b7b14822e88e1f0917f5271dc566cf9df3fbb");
    await expectHash("eng/packaging/pi-icon-sources/png/pi_icon_64x64.png", "87efbc706eae04f87be1f0ba3a99966082e4aa5a2b90619ca4f514606024d7a2");
    await expectHash("eng/packaging/pi-icon-sources/png/pi_icon_128x128.png", "cfe50b8544081108d4f29158e3c8a1d864a26b86408c971606b0d6a1583ee8db");
    await expectHash("eng/packaging/pi-icon-sources/png/pi_icon_256x256.png", "ea0a3d5db38eb76d4b64f97d20fed65a2004d71ddc2ae5d8d3d03aaec5bb1300");
    await expectHash("eng/packaging/pi-icon-sources/png/pi_icon_512x512.png", "9245b21a884c9d0f416bb441033c0a20c3bd3f7b91eb574cfe4ea8bc71b9d7f3");
    await expectHash("apps/renderer/src/assets/pi-icon-64.png", "87efbc706eae04f87be1f0ba3a99966082e4aa5a2b90619ca4f514606024d7a2");
    await expectHash("apps/renderer/src/assets/pi-glyph-white.svg", "f9bce42c191443e272537a7ea009630bbbc4bb9c6927d71fdcd63bbba3c67d10");
  });

  it("keeps the macOS artwork inside the platform visual safe area", () => {
    expect(MACOS_ICON_CONTRACT).toMatchObject({
      canvasSize: 1024,
      contentSize: 824,
      inset: 100
    });
    expect(MACOS_ICON_CONTRACT.representations).toHaveLength(10);
    expect(MACOS_ICON_CONTRACT.contentSize + (MACOS_ICON_CONTRACT.inset * 2))
      .toBe(MACOS_ICON_CONTRACT.canvasSize);
  });

  it("changes platform display metadata without breaking release identity", async () => {
    const config = await readFile(resolve(repositoryRoot, "electron-builder.yml"), "utf8");

    for (const requiredLine of [
      "appId: com.pi67.desktop",
      "productName: Pi-67 Desktop",
      "  - name: π",
      "      - pi67",
      "  icon: eng/packaging/pi.ico",
      "  icon: eng/packaging/pi.icns",
      "  executableName: Pi-67 Desktop",
      "  shortcutName: π",
      "  uninstallDisplayName: π ${version}",
      "    CFBundleDisplayName: π",
      "  artifactName: Pi-67-Desktop-${version}-win-x64.${ext}",
      "  artifactName: Pi-67-Desktop-${version}-mac-arm64.${ext}"
    ]) expect(config, requiredLine).toContain(requiredLine);
  });
});

async function expectHash(path, expected) {
  const content = await readFile(resolve(repositoryRoot, path));
  expect(createHash("sha256").update(content).digest("hex"), path).toBe(expected);
}
