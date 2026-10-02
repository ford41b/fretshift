import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../cloud/client", () => ({
  cloudConfig: () => ({ url: "https://example.supabase.co", key: "anon-key" }),
  getAccessToken: async () => "access-token",
  getSession: () => ({ user: { id: "account-1" } }),
}));

import { importVision, validateVisionResult } from "./client";
import type { PreparedVisionPage } from "./types";

function wire(overrides: Record<string, unknown> = {}) {
  return {
    pages: [
      {
        id: "page-a",
        text: "Photographed song\nKey: C\nVerse\nC G Am F\nSing along",
      },
    ],
    pageIds: ["page-a"],
    modelId: "ocr-space-engine-3",
    promptVersion: "ocr-v1",
    processedAt: "2026-09-12T12:00:00.000Z",
    ...overrides,
  };
}

const page: PreparedVisionPage = {
  id: "page-a",
  fileName: "chart.jpg",
  dataUrl: "data:image/jpeg;base64,Y2xlYW4=",
  width: 800,
  height: 1200,
};

describe("vision client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("validates OCR pages and builds a song through the text-chart parser", () => {
    const result = validateVisionResult(wire(), "photo", ["page-a"]);
    expect(result.song.title).toBe("Photographed song");
    expect(
      result.song.measures[0].chords.map((chord) => chord.chordName),
    ).toEqual(["C", "G", "Am", "F"]);
    expect(result.song.provenance).toMatchObject({
      source: "photo",
      modelId: "ocr-space-engine-3",
      promptVersion: "ocr-v1",
    });
    expect(() =>
      validateVisionResult(wire({ pageIds: ["other"] }), "photo", ["page-a"]),
    ).toThrow(/page IDs/);
    expect(() =>
      validateVisionResult(
        wire({ pages: [{ id: "page-a", text: "No music here" }] }),
        "photo",
        ["page-a"],
      ),
    ).toThrow(/No chord chart/);
  });

  it("retries once after malformed output", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce({ nope: true })
      .mockResolvedValueOnce(wire());
    const result = await importVision([page], "photo", {}, transport, 100);
    expect(result.song.title).toBe("Photographed song");
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("names the failed page after the single retry", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("bad response"));
    await expect(
      importVision([page], "photo", {}, transport, 100),
    ).rejects.toThrow(
      /page 1 \(chart.jpg\).*after one retry.*ChordPro or manual entry/,
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("turns browser fetch failures into an actionable vision-service error", async () => {
    const transport = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      importVision([page], "photo", {}, transport, 100),
    ).rejects.toThrow(/Could not reach the visual OCR service.*allows this app's origin/);
  });

  it("rejects malformed or duplicate prepared pages before transport", async () => {
    const transport = vi.fn();
    await expect(
      importVision([{ ...page, width: 1601 }], "photo", {}, transport),
    ).rejects.toThrow();
    await expect(
      importVision(
        [page, { ...page, fileName: "duplicate.jpg" }],
        "photo",
        {},
        transport,
      ),
    ).rejects.toThrow(/unique/);
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("independent page OCR", () => {
  it("returns raw text from a chordless page for manual review", async () => {
    const { recognizeVisionTextPage } = await import("./client");
    const transport = vi.fn().mockResolvedValue(wire({
      pages: [{ id: "page-a", text: "Title only, chords are drawn as images" }],
    }));
    const result = await recognizeVisionTextPage(page, undefined, transport, 100);
    expect(result.text).toContain("Title only");
    expect(JSON.parse((transport.mock.calls[0][0] as Request).body ? await
      (transport.mock.calls[0][0] as Request).text() : "{}").pages).toHaveLength(1);
  });

  it("retries a failed page without uploading other pages again", async () => {
    const { recognizeVisionTextPage } = await import("./client");
    const transport = vi.fn().mockRejectedValueOnce(new Error("upstream timeout"))
      .mockResolvedValueOnce(wire());
    await expect(recognizeVisionTextPage(page, undefined, transport, 100))
      .resolves.toMatchObject({ text: expect.stringContaining("C G Am F") });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("cancels without trying another OCR request", async () => {
    const { recognizeVisionTextPage } = await import("./client");
    const controller = new AbortController();
    const transport = vi.fn().mockImplementation(() => {
      controller.abort();
      throw new Error("connection closed");
    });
    await expect(recognizeVisionTextPage(page, controller.signal, transport, 100))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
