export const MACOS_ICON_CONTRACT = Object.freeze({
  canvasSize: 1024,
  contentSize: 824,
  inset: 100,
  representations: Object.freeze([
    Object.freeze({ fileName: "icon_16x16.png", size: 16 }),
    Object.freeze({ fileName: "icon_16x16@2x.png", size: 32 }),
    Object.freeze({ fileName: "icon_32x32.png", size: 32 }),
    Object.freeze({ fileName: "icon_32x32@2x.png", size: 64 }),
    Object.freeze({ fileName: "icon_128x128.png", size: 128 }),
    Object.freeze({ fileName: "icon_128x128@2x.png", size: 256 }),
    Object.freeze({ fileName: "icon_256x256.png", size: 256 }),
    Object.freeze({ fileName: "icon_256x256@2x.png", size: 512 }),
    Object.freeze({ fileName: "icon_512x512.png", size: 512 }),
    Object.freeze({ fileName: "icon_512x512@2x.png", size: 1024 })
  ])
});

if (MACOS_ICON_CONTRACT.contentSize + (MACOS_ICON_CONTRACT.inset * 2)
  !== MACOS_ICON_CONTRACT.canvasSize) {
  throw new Error("The macOS icon safe-area contract does not fill its canvas.");
}
