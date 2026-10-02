import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfText, pdfPagesToSongs, suggestPdfSplits, pageHasChordContent } from "./pdfText";
import { writePdfSheet } from "./pdfSheet";
import { newSong } from "../schema/song.v1";

async function textPdf() {
  const document = await PDFDocument.create(),
    font = await document.embedFont(StandardFonts.Helvetica);
  for (const lines of [
    ["Morning Song", "Key: C", "Verse", "C G Am F", "Wake up and sing"],
    ["Evening Song", "Capo: 2", "Key: G", "G D Em C", "Rest at the end"],
  ]) {
    const page = document.addPage([612, 792]);
    lines.forEach((line, index) =>
      page.drawText(line, { x: 60, y: 730 - index * 24, size: 14, font }),
    );
  }
  return document.save();
}

async function pdfText(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"),
    document = await getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
  const output: string[] = [];
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number),
        content = await page.getTextContent();
      output.push(
        content.items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" "),
      );
    }
  } finally {
    await document.destroy();
  }
  return output.join(" ");
}

describe("PDF interchange", () => {
  it("extracts text, proposes page boundaries, and builds editable songs", async () => {
    const pages = await extractPdfText(await textPdf()),
      splits = suggestPdfSplits(pages),
      songs = pdfPagesToSongs(pages, splits);
    expect(pages).toHaveLength(2);
    expect([...splits]).toEqual([2]);
    expect(
      songs.map((song) => ({
        title: song.title,
        capo: song.capo,
        chords: song.measures[0].chords.map((chord) => chord.chordName),
        lyrics: song.measures[0].lyrics,
      })),
    ).toEqual([
      {
        title: "Morning Song",
        capo: 0,
        chords: ["C", "G", "Am", "F"],
        lyrics: "Wake up and sing",
      },
      {
        title: "Evening Song",
        capo: 2,
        chords: ["A", "E", "F#m", "D"],
        lyrics: "Rest at the end",
      },
    ]);
    expect(pdfPagesToSongs(pages, new Set()).at(0)?.measures).toHaveLength(2);
  });

  it("writes structured Letter and A4 sheets in sounding and shape modes", async () => {
    const song = newSong("Printable Song");
    song.artist = "A. Player";
    song.capo = 2;
    song.currentKey = { root: "D", mode: "major" };
    song.originalKey = { ...song.currentKey };
    song.measures[0].chords = [{ id: "c", beat: 0, chordName: "D" }];
    song.measures[0].lyrics = "A line to sing";
    const sounding = await writePdfSheet(song, {
        pageSize: "letter",
        nameMode: "sounding",
      }),
      shape = await writePdfSheet(song, { pageSize: "a4", nameMode: "shape" });
    const soundingDocument = await PDFDocument.load(sounding),
      shapeDocument = await PDFDocument.load(shape);
    expect(soundingDocument.getPage(0).getSize()).toEqual({
      width: 612,
      height: 792,
    });
    expect(shapeDocument.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
    expect(await pdfText(sounding)).toContain("D @ 1");
    expect(await pdfText(shape)).toContain("C @ 1");
  });
});

describe("smart chord-chart extraction", () => {
  it("detects inline chord symbols but not a page title with a text layer", async () => {
    expect(pageHasChordContent("Shawn Mendes\nPage 3\nA great chorus")).toBe(false);
    expect(pageHasChordContent("My [G]song goes [D/F#]on")).toBe(true);
    expect(pageHasChordContent("C | G | Am | Fmaj7")).toBe(true);
  });

  it("preserves inline chord lyrics and chordless continuation pages", () => {
    expect(pageHasChordContent("[C]Hello [Am]world")).toBe(true);
    const [song] = pdfPagesToSongs([
      { number: 1, text: "New Tune\nVerse\n[C]Hello [Am]world" },
      { number: 2, text: "and all these words continue\ninto another line" },
    ], new Set());
    expect(song.measures[0].chords.map((chord) => chord.chordName)).toEqual(["C", "Am"]);
    expect(song.measures[0].lyrics).toContain("Hello world");
    expect(song.measures[0].lyrics).toContain("and all these words continue");
  });
});
