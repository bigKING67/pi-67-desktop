import { describe, expect, it } from "vitest";
import {
  inspectPromptHeif,
  inspectPromptJpeg,
  promptJpegName,
  stripPromptJpegMetadata
} from "./prompt-image-inspection.js";
import { heifFixture, jpegFixture } from "./prompt-image-test-fixture.js";

describe("prompt image inspection", () => {
  it("content-identifies HEIC/HEIF brands and reads structured ispe dimensions", () => {
    expect(inspectPromptHeif(heifFixture(8_064, 6_048))).toEqual({
      brand: "heic",
      width: 8_064,
      height: 6_048
    });
    expect(inspectPromptHeif(heifFixture(4_032, 3_024, "mif1"))).toEqual({
      brand: "mif1",
      width: 4_032,
      height: 3_024
    });
    expect(inspectPromptHeif(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
  });

  it("rejects malformed, unsupported, and decompression-bomb dimensions before decode", () => {
    expect(() => inspectPromptHeif(heifFixture(10_000, 5_001))).toThrow("5,000 万像素");
    expect(() => inspectPromptHeif(heifFixture(20_000, 1))).toThrow("16,384");
    expect(() => inspectPromptHeif(heifFixture(100, 100, "heim"))).toThrow("不支持的编码品牌");

    const truncated = heifFixture(100, 100).subarray(0, 28);
    expect(() => inspectPromptHeif(truncated)).toThrow("元数据边界");
  });

  it("validates normalized JPEG dimensions and rejects retained metadata", () => {
    expect(inspectPromptJpeg(jpegFixture(4_032, 3_024))).toEqual({ width: 4_032, height: 3_024 });
    expect(() => inspectPromptJpeg(jpegFixture(320, 240, { metadata: true }))).toThrow("元数据");
    expect(inspectPromptJpeg(stripPromptJpegMetadata(
      jpegFixture(320, 240, { metadata: true })
    ))).toEqual({ width: 320, height: 240 });
    expect(() => inspectPromptJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow("尺寸");
  });

  it("replaces the source extension without exceeding the attachment name boundary", () => {
    expect(promptJpegName("IMG_0067.HEIC")).toBe("IMG_0067.jpg");
    expect(promptJpegName("camera-export")).toBe("camera-export.jpg");
    expect(promptJpegName(`${"a".repeat(512)}.heif`)).toHaveLength(512);
  });
});
