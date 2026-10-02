import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { loadSong } from "../../schema/migrations";
import { resolveTuning, type Song, type Voicing } from "../../schema/song.v1";
import { findVoicings } from "../../theory/voicingSearch";
import { displayName } from "../../transforms";

export type PdfSheetOptions = {
  pageSize: "letter" | "a4";
  nameMode: "sounding" | "shape";
};

function safe(font: PDFFont, value: string) {
  return [...value]
    .map((character) => {
      try {
        font.encodeText(character);
        return character;
      } catch {
        return "?";
      }
    })
    .join("");
}

function fit(font: PDFFont, text: string, size: number, width: number) {
  const words = safe(font, text).split(/\s+/),
    lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawDiagram(
  page: PDFPage,
  font: PDFFont,
  name: string,
  voicing: Voicing | undefined,
  x: number,
  y: number,
) {
  page.drawText(safe(font, name), {
    x,
    y: y + 61,
    size: 9,
    font,
    color: rgb(0.22, 0.18, 0.32),
  });
  const left = x + 7,
    top = y + 51,
    width = 42,
    height = 40;
  for (let string = 0; string < 6; string++)
    page.drawLine({
      start: { x: left + (string * width) / 5, y: top },
      end: { x: left + (string * width) / 5, y: top - height },
      thickness: 0.45,
      color: rgb(0.55, 0.53, 0.6),
    });
  for (let fret = 0; fret <= 4; fret++)
    page.drawLine({
      start: { x: left, y: top - (fret * height) / 4 },
      end: { x: left + width, y: top - (fret * height) / 4 },
      thickness: fret === 0 ? 1.2 : 0.45,
      color: rgb(0.45, 0.42, 0.52),
    });
  const frets = [
    ...(voicing?.frets ?? ["x", "x", "x", "x", "x", "x"]),
  ].reverse();
  for (const [string, fret] of frets.entries()) {
    const sx = left + (string * width) / 5;
    if (fret === "x")
      page.drawText("x", { x: sx - 2, y: top + 3, size: 7, font });
    else if (fret === 0)
      page.drawCircle({
        x: sx,
        y: top + 7,
        size: 2,
        borderWidth: 0.7,
        borderColor: rgb(0.35, 0.31, 0.44),
      });
    else
      page.drawCircle({
        x: sx,
        y: top - ((Math.min(fret, 4) - 0.5) * height) / 4,
        size: 2.8,
        color: rgb(0.42, 0.29, 0.78),
      });
  }
}

export async function writePdfSheet(input: Song, options: PdfSheetOptions) {
  const song = loadSong(input),
    document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica),
    bold = await document.embedFont(StandardFonts.HelveticaBold);
  const size: [number, number] =
    options.pageSize === "letter" ? [612, 792] : [595.28, 841.89];
  const margin = 44,
    contentWidth = size[0] - margin * 2;
  const pages: PDFPage[] = [];
  let page = document.addPage(size),
    y = size[1] - margin;
  pages.push(page);
  const addPage = () => {
    page = document.addPage(size);
    pages.push(page);
    y = size[1] - margin;
  };
  page.drawText(safe(bold, song.title), {
    x: margin,
    y: y - 22,
    size: 24,
    font: bold,
    color: rgb(0.18, 0.14, 0.26),
  });
  y -= 38;
  if (song.artist) {
    page.drawText(safe(regular, song.artist), {
      x: margin,
      y,
      size: 11,
      font: regular,
      color: rgb(0.38, 0.35, 0.43),
    });
    y -= 19;
  }
  const tuning = resolveTuning(song.tuningId),
    key = `${song.currentKey.root}${song.currentKey.mode === "minor" ? "m" : ""}`;
  page.drawText(
    safe(
      regular,
      `${key}  |  ${song.tempo} BPM  |  ${song.timeSignature.join("/")}  |  ${tuning.label}  |  Capo ${song.capo || "none"}  |  ${options.nameMode === "shape" ? "Shape names" : "Sounding names"}`,
    ),
    { x: margin, y, size: 9, font: regular, color: rgb(0.42, 0.39, 0.47) },
  );
  y -= 24;
  const names = [
    ...new Set(
      song.measures.flatMap((measure) =>
        measure.chords.map((chord) => chord.chordName),
      ),
    ),
  ];
  if (names.length) {
    page.drawText("CHORDS", {
      x: margin,
      y,
      size: 8,
      font: bold,
      color: rgb(0.42, 0.29, 0.78),
    });
    y -= 76;
    for (const [index, name] of names.entries()) {
      if (index && index % 7 === 0) y -= 76;
      if (y < margin + 90) {
        addPage();
        y -= 76;
      }
      const shown = displayName(name, song, options.nameMode),
        event = song.measures
          .flatMap((measure) => measure.chords)
          .find((chord) => chord.chordName === name);
      drawDiagram(
        page,
        bold,
        shown,
        event?.voicing ?? findVoicings(name, tuning, song.capo, 1)[0],
        margin + (index % 7) * (contentWidth / 7),
        y,
      );
    }
    y -= 10;
  }
  page.drawText("CHART", {
    x: margin,
    y,
    size: 8,
    font: bold,
    color: rgb(0.42, 0.29, 0.78),
  });
  y -= 18;
  for (const measure of song.measures) {
    if (measure.section) {
      if (y < margin + 38) addPage();
      y -= 4;
      page.drawText(
        safe(
          bold,
          (measure.section.label ?? measure.section.kind).toUpperCase(),
        ),
        { x: margin, y, size: 10, font: bold, color: rgb(0.28, 0.22, 0.38) },
      );
      y -= 17;
    }
    const chords =
      measure.chords
        .map(
          (chord) =>
            `${displayName(chord.chordName, song, options.nameMode)} @ ${chord.beat + 1}`,
        )
        .join("   ") || "-";
    const chordLines = fit(bold, chords, 10, contentWidth - 24),
      lyricLines = fit(regular, measure.lyrics ?? "", 10, contentWidth - 24);
    const height = Math.max(
      42,
      18 + chordLines.length * 13 + lyricLines.length * 13,
    );
    if (y - height < margin) addPage();
    page.drawRectangle({
      x: margin,
      y: y - height + 8,
      width: contentWidth,
      height,
      borderWidth: 0.7,
      borderColor: rgb(0.83, 0.81, 0.87),
      color: rgb(0.98, 0.975, 0.99),
    });
    page.drawText(String(measure.index + 1), {
      x: margin + 8,
      y: y - 9,
      size: 7,
      font: regular,
      color: rgb(0.48, 0.45, 0.52),
    });
    let lineY = y - 10;
    for (const line of chordLines) {
      page.drawText(line, {
        x: margin + 24,
        y: lineY,
        size: 10,
        font: bold,
        color: rgb(0.36, 0.23, 0.7),
      });
      lineY -= 13;
    }
    for (const line of lyricLines) {
      page.drawText(line, {
        x: margin + 24,
        y: lineY,
        size: 10,
        font: regular,
        color: rgb(0.2, 0.18, 0.24),
      });
      lineY -= 13;
    }
    y -= height + 7;
  }
  for (const [index, outputPage] of pages.entries())
    outputPage.drawText(`FretShift  |  ${index + 1} / ${pages.length}`, {
      x: margin,
      y: 20,
      size: 7,
      font: regular,
      color: rgb(0.5, 0.48, 0.54),
    });
  document.setTitle(song.title);
  document.setAuthor(song.artist || "FretShift");
  return document.save();
}
