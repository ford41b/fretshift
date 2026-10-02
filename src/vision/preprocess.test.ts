import { describe, expect, it } from "vitest";
import {
  fitVisionDimensions,
  preprocessImage,
  preprocessImages,
} from "./preprocess";

describe("vision preprocessing", () => {
  it("fits the longest edge to 1600 without enlarging", () => {
    expect(fitVisionDimensions(4000, 3000)).toEqual({
      width: 1600,
      height: 1200,
    });
    expect(fitVisionDimensions(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("re-encodes pixels as JPEG so source EXIF bytes are not forwarded", async () => {
    const file = new File(["Exif private-camera-metadata"], "photo.jpg", {
      type: "image/jpeg",
    });
    const result = await preprocessImage(
      file,
      { rotation: 90, crop: 0.1 },
      {
        decode: async () => ({ width: 2400, height: 1200 }),
        encode: async (_source, rect, size, rotation) => {
          expect(rect).toEqual([240, 120, 1920, 960]);
          expect(size).toEqual([1600, 800]);
          expect(rotation).toBe(90);
          return new Blob(["clean-pixels"], { type: "image/jpeg" });
        },
      },
    );
    expect(result.width).toBe(800);
    expect(result.height).toBe(1600);
    expect(atob(result.dataUrl.split(",")[1])).toBe("clean-pixels");
    expect(result.dataUrl).not.toContain("private-camera-metadata");
  });

  it("rejects more than ten pages before decoding", async () => {
    const files = Array.from(
      { length: 11 },
      (_, index) =>
        new File(["x"], `page-${index}.jpg`, { type: "image/jpeg" }),
    );
    await expect(preprocessImages(files)).rejects.toThrow(/no more than 10/);
  });

  it("retries at smaller settings to meet OCR.space's 1 MB limit", async () => {
    const encodes: Array<{ size: number[]; quality: number }> = [];
    const result = await preprocessImage(
      new File(["pixels"], "large.jpg", { type: "image/jpeg" }),
      {},
      {
        decode: async () => ({ width: 2400, height: 1200 }),
        encode: async (_source, _rect, size, _rotation, quality) => {
          encodes.push({ size, quality });
          return encodes.length === 1
            ? new Blob([new Uint8Array(1_000_001)])
            : new Blob(["small"]);
        },
      },
    );
    expect(encodes).toEqual([
      { size: [1600, 800], quality: 0.86 },
      { size: [1400, 700], quality: 0.8 },
    ]);
    expect(result.width).toBe(1400);
    expect(result.height).toBe(700);
  });
});
