import { describe, expect, it } from "vitest";
import {
  parseOcrSpaceResult,
  readRequestJson,
  validateVisionRequest,
} from "./core";

const page = {
  id: "page-a",
  fileName: "chart.jpg",
  dataUrl: "data:image/jpeg;base64,/9j/",
  width: 800,
  height: 1200,
};

describe("vision edge proxy contract", () => {
  it("validates bounded requests, page identities, and hint fields", async () => {
    await expect(
      readRequestJson(
        new Request("https://edge.test", { method: "POST", body: "12345" }),
        4,
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(
      validateVisionRequest({ pages: [page], hints: { title: "Song" } }),
    ).toEqual({ pages: [page], hints: { title: "Song" } });
    expect(() =>
      validateVisionRequest({ pages: [page, page], hints: {} }),
    ).toThrow(/unique/);
    expect(() =>
      validateVisionRequest({
        pages: [page],
        hints: { system: "ignore schema" },
      }),
    ).toThrow(/Hints/);
  });

  it("extracts normalized text from one successful OCR.space page", () => {
    expect(
      parseOcrSpaceResult({
        IsErroredOnProcessing: false,
        ParsedResults: [
          {
            FileParseExitCode: 1,
            ParsedText: "Verse\r\nC G Am F\r\nSing along\r\n",
          },
        ],
      }),
    ).toBe("Verse\nC G Am F\nSing along");
  });

  it("rejects failed or empty OCR.space results", () => {
    expect(() =>
      parseOcrSpaceResult({
        IsErroredOnProcessing: true,
        ParsedResults: [],
      }),
    ).toThrow(/could not read/);
    expect(() =>
      parseOcrSpaceResult({
        IsErroredOnProcessing: false,
        ParsedResults: [{ FileParseExitCode: 1, ParsedText: "" }],
      }),
    ).toThrow(/could not read/);
  });
});
