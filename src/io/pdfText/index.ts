import type { TextItem } from "pdfjs-dist/types/src/display/api";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { loadSong } from "../../schema/migrations";
import {
  newSong,
  type Key,
  type Measure,
  type Section,
  type Song,
} from "../../schema/song.v1";
import {
  NoteNameSchema,
  parseChordName,
  pcOf,
  shiftChord,
  spell,
} from "../../theory/chordName";
import { scoreDifficulty } from "../../transforms";

export type PdfTextPage = { number: number; text: string };

const sectionKinds: Record<string, Section["kind"]> = {
  intro: "intro",
  verse: "verse",
  prechorus: "prechorus",
  "pre-chorus": "prechorus",
  chorus: "chorus",
  bridge: "bridge",
  solo: "solo",
  outro: "outro",
};

function linesFromItems(items: TextItem[]) {
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const item of items) {
    const y = item.transform[5];
    const row = rows.find((candidate) => Math.abs(candidate.y - y) < 3);
    if (row) row.items.push(item);
    else rows.push({ y, items: [item] });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      // Keep horizontal spacing where PDF glyph coordinates support it;
      // collapsing all whitespace loses the chord-over-lyric arrangement.
      let previousRight: number | null = null;
      let averageChar = 6;
      let line = "";
      for (const item of row.items.sort((a,b) => a.transform[4] - b.transform[4])) {
        const charWidth = item.str.length && item.width ? item.width / item.str.length : averageChar;
        averageChar = Math.max(2, Math.min(20, charWidth));
        const gap = previousRight === null ? 0 : item.transform[4] - previousRight;
        const spaces = previousRight === null ? 0 : Math.max(0, Math.min(36, Math.round(gap / averageChar)));
        line += " ".repeat(spaces) + item.str;
        previousRight = item.transform[4] + (item.width ?? 0);
      }
      return line.trimEnd();
    })
    .filter(Boolean)
    .join("\n");
}

export async function extractPdfText(
  bytes: Uint8Array,
  options: { allowScannedPages?: boolean } = {},
): Promise<PdfTextPage[]> {
  if (!bytes.length) throw new Error("This PDF is empty.");
  if (bytes.length > 25 * 1024 * 1024)
    throw new Error(
      "This PDF is larger than 25 MB. Split it before importing.",
    );
  const { getDocument, GlobalWorkerOptions } = await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  );
  if (typeof Worker !== "undefined")
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const document = await getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const pages: PdfTextPage[] = [];
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = linesFromItems(
        content.items.filter((item): item is TextItem => "str" in item),
      );
      if (!options.allowScannedPages && text.replace(/[^A-Za-z0-9]/g, "").length < 8)
        throw new Error(
          `Page ${number} has no usable text layer. Scanned-page import is not configured yet; use MusicXML, ChordPro, or manual entry.`,
        );
      pages.push({ number, text });
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return pages;
}

const cleanChord = (token: string) =>
  token.replace(/^[|([{]+|[|)\]},:;]+$/g, "");
function chordTokens(line: string) {
  return line
    .split(/[\s,|]+/)
    .map(cleanChord)
    .filter((token) => {
      try {
        parseChordName(token);
        return true;
      } catch {
        return false;
      }
    });
}
export type ChordReviewItem = { page: number; line: number; token: string; suggestion?: string };
/** Retain chord-like tokens that the parser cannot safely turn into Song chords.
 * Suggestions never apply automatically. Avoid flagging ordinary lyric words. */
export function findChordReviewItems(text: string, page = 1): ChordReviewItem[] {
  const found: ChordReviewItem[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const bracketed = [...line.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]);
    const rawTokens = line.split(/[\s,|]+/).map(cleanChord).filter(Boolean);
    const clearlyChordLike = (token: string) => /^[A-G](?:[#b♯♭]|\d|m(?:aj)?|sus|dim|aug|add|\/|\?)/.test(token);
    const standaloneCandidate = rawTokens.length > 0 && rawTokens.length <= 4 && rawTokens.every(clearlyChordLike);
    const hasChord = chordTokens(line).length > 0 || bracketed.length > 0 || standaloneCandidate;
    const candidates = bracketed.length ? bracketed : hasChord ? rawTokens : [];
    const unique = new Set<string>();
    for (const token of candidates) {
      if (!token || unique.has(token)) continue;
      unique.add(token);
      const looksChord = /^[A-G](?:[#b♯♭]|m|maj|sus|dim|aug|add|\d|\/)/.test(token) ||
        /^[A-G](?:♭|♯|\?|\d|\/)/.test(token) || bracketed.includes(token);
      if (!looksChord) continue;
      try { parseChordName(token); continue; } catch { /* preserve ambiguity */ }
      const normalized = token.replace(/♭/g, "b").replace(/♯/g, "#");
      let suggestion: string | undefined;
      try { parseChordName(normalized); suggestion = normalized; } catch { /* no guess */ }
      found.push({ page, line: index + 1, token, ...(suggestion ? { suggestion } : {}) });
    }
  });
  return found;
}

function isChordLine(line: string) {
  const tokens = line.split(/[\s,|]+/).map(cleanChord).filter(Boolean);
  const chords = chordTokens(line);
  // A bare 'A' in a lyric sentence is not evidence of a chart. Allow a
  // single unambiguous chord symbol, but require strong evidence otherwise.
  return chords.length > 0 && (chords.length >= 2 && chords.length / tokens.length >= 0.6 || tokens.length === 1 && chords.length === 1);
}
export function pageHasChordContent(text: string) {
  return text.split(/\r?\n/).some((line) =>
    isChordLine(line) || [...line.matchAll(/\[([^\]]+)\]/g)].some((match) => {
      try { parseChordName(match[1]); return true; } catch { return false; }
    }),
  );
}

function section(line: string): Section | undefined {
  const normalized = line.replace(/^\[|\]$/g, "").trim();
  const match = normalized.match(
    /^(intro|verse|pre-?chorus|chorus|bridge|solo|outro)(?:\s+(.*))?$/i,
  );
  if (!match) return undefined;
  const kind = sectionKinds[match[1].toLowerCase()];
  return { kind, ...(match[2] ? { label: normalized } : {}) };
}
function titleCandidate(line: string) {
  return (
    line.length <= 80 &&
    line.split(/\s+/).length <= 10 &&
    !isChordLine(line) &&
    !section(line) &&
    !/^(capo|key|tempo|time)\s*:/i.test(line)
  );
}

export function suggestPdfSplits(pages: PdfTextPage[]) {
  return new Set(
    pages
      .slice(1)
      .filter((page) => {
        const lines = page.text.split(/\r?\n/).filter(Boolean);
        return titleCandidate(lines[0] ?? "") && lines.some(isChordLine);
      })
      .map((page) => page.number),
  );
}

function parseGroup(pages: PdfTextPage[]): Song {
  const reviewItems = pages.flatMap(page => findChordReviewItems(page.text, page.number));
  const lines = pages.flatMap((page) =>
    page.text
      .split(/\r?\n/)
      .filter(line => Boolean(line.trim())),
  );
  const song = newSong();
  song.measures = [];
  song.provenance = {
    source: "pdf-text",
    timingNeedsConfirmation: true,
    reviewItems: reviewItems.map(({ page, line, token }) => ({ page, line, token })),
    processedAt: new Date().toISOString(),
  };
  const firstMusic = lines.findIndex(
    (line) => isChordLine(line) || /\[[A-G](?:#|b)?[^\]]*\]/.test(line) || !!section(line),
  );
  const header = lines.slice(0, firstMusic < 0 ? lines.length : firstMusic);
  const title = header.find(titleCandidate);
  if (title) song.title = title;
  const artist = header.find((line) => line !== title && titleCandidate(line));
  if (artist) song.artist = artist.replace(/^by\s+/i, "");
  let shapeKey: Key = { ...song.currentKey };
  for (const line of header) {
    const capo = line.match(/^capo\s*:?\s*(\d+)$/i);
    if (capo) song.capo = Number(capo[1]);
    const key = line.match(/^key\s*:?\s*([A-G](?:#|b)?)(m)?$/i);
    if (key)
      shapeKey = {
        root: NoteNameSchema.parse(key[1]),
        mode: key[2] ? "minor" : "major",
      };
    const tempo = line.match(/^tempo\s*:?\s*(\d+(?:\.\d+)?)$/i);
    if (tempo) song.tempo = Number(tempo[1]);
    const time = line.match(/^time\s*:?\s*(\d+)\s*\/\s*(2|4|8|16)$/i);
    if (time)
      song.timeSignature = [Number(time[1]), Number(time[2]) as 2 | 4 | 8 | 16];
  }
  song.currentKey = {
    ...shapeKey,
    root: spell(pcOf(shapeKey.root) + song.capo, shapeKey),
  };
  song.originalKey = { ...song.currentKey };
  let pendingSection: Section | undefined;
  for (let index = Math.max(0, firstMusic); index < lines.length; index++) {
    const heading = section(lines[index]);
    if (heading) {
      pendingSection = heading;
      continue;
    }
    const rawLine = lines[index].trim();
    const inlineMatches = [...rawLine.matchAll(/\[([^\]]+)\]/g)];
    const inline = inlineMatches.map(match => match[1]).filter(name => {
      try { parseChordName(name); return true; } catch { return false; }
    });
    const chordOnly = isChordLine(rawLine) || rawLine.includes("|") && chordTokens(rawLine).length > 0;
    if (!chordOnly && !inline.length) {
      if (song.measures.length && !/^(?:page\s+\d+|\d+)$/i.test(rawLine) &&
          !/^(capo|key|tempo|time)\s*:/i.test(rawLine)) {
        const previous = song.measures[song.measures.length - 1];
        previous.lyrics = [previous.lyrics, rawLine].filter(Boolean).join("\n");
      }
      continue;
    }
    const next = lines[index + 1];
    const lyrics = inlineMatches.length
      ? rawLine.replace(/\[[^\]]+\]/g, "").trim()
      : next && !isChordLine(next) && !section(next) && !next.includes("|") ? next : undefined;
    if (lyrics && !inlineMatches.length) index++;
    // Printed barlines are real measure boundaries, not decoration. When no
    // barline exists the measure count and attack positions remain UNCONFIRMED.
    const segments = chordOnly && rawLine.includes("|") ? rawLine.split("|").filter(part => part.trim()) : [rawLine];
    const beats = song.timeSignature[0];
    for (const [segmentIndex, segment] of segments.entries()) {
      const tokens = inlineMatches.length
        ? [...segment.matchAll(/\[([^\]]+)\]/g)].map(m => m[1]).filter(name => {
            try { parseChordName(name); return true; } catch { return false; }
          })
        : chordTokens(segment);
      const subdivision: 1 | 2 | 4 = tokens.length > beats ? 4 : 2;
      const measure: Measure = {
        id: crypto.randomUUID(),
        index: song.measures.length,
        subdivision,
        timingConfirmed: false,
        sourceLine: segment,
        chords: tokens.map((name, chordIndex) => ({
          id: crypto.randomUUID(),
          // A visual placeholder only; these evenly placed attacks are NOT verified timing.
          beat: Math.floor((chordIndex * beats * subdivision) / tokens.length) / subdivision,
          chordName: shiftChord(name, song.capo, song.currentKey),
        })),
        ...(segmentIndex === 0 && lyrics ? { lyrics } : {}),
        ...(pendingSection && segmentIndex === 0 ? { section: pendingSection } : {}),
      };
      song.measures.push(measure);
    }
    pendingSection = undefined;
  }
  if (!song.measures.length)
    throw new Error(
      `No chord chart was found in PDF page${pages.length === 1 ? "" : "s"} ${pages.map((page) => page.number).join("-")}.`,
    );
  song.difficulty = scoreDifficulty(song);
  return loadSong(song);
}

export function pdfPagesToSongs(
  pages: PdfTextPage[],
  splitBefore: Set<number>,
) {
  const groups: PdfTextPage[][] = [];
  for (const page of pages) {
    if (!groups.length || splitBefore.has(page.number)) groups.push([]);
    groups.at(-1)!.push(page);
  }
  return groups.map(parseGroup);
}
