import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";

const corpus = new URL("../test-fixtures/vision-corpus/", import.meta.url);
const resultsFile = new URL("RESULTS.md", corpus);
await mkdir(corpus, { recursive: true });

const publicKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const required = ["VISION_IMPORT_URL", "FRETSHIFT_USER_ACCESS_TOKEN"];
const missing = required.filter((name) => !process.env[name]);
if (!publicKey) missing.push("SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY");
if (missing.length) {
  await writeFile(
    resultsFile,
    `# Vision benchmark results\n\nStatus: not run (live API configuration required).\n\nMissing: ${missing.map((name) => `\`${name}\``).join(", ")}\n\nThe 20-case corpus is provisional and synthetic. Run \`pnpm bench:vision\` only after deploying the authenticated proxy and authorizing paid calls. No paid API request was made.\n`,
  );
  console.log(`Vision benchmark skipped; missing ${missing.join(", ")}.`);
  process.exit(0);
}

const manifest = JSON.parse(
  await readFile(new URL("manifest.json", corpus), "utf8"),
);
if (!Array.isArray(manifest.cases) || manifest.cases.length < 20) {
  throw new Error("Vision manifest must contain at least 20 cases.");
}

const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
let pdfPagesToSongs;
try {
  ({ pdfPagesToSongs } = await vite.ssrLoadModule("/src/io/pdfText/index.ts"));
} finally {
  await vite.close();
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = old;
    }
  }
  return row[b.length];
}

function validSong(song) {
  return Boolean(
    song &&
      song.schemaVersion === 1 &&
      typeof song.id === "string" &&
      typeof song.title === "string" &&
      Array.isArray(song.timeSignature) &&
      Array.isArray(song.tags) &&
      Array.isArray(song.measures) &&
      song.measures.length &&
      song.measures.every(
        (measure, index) =>
          measure?.index === index &&
          typeof measure.id === "string" &&
          [1, 2, 4].includes(measure.subdivision) &&
          Array.isArray(measure.chords) &&
          measure.chords.every(
            (chord) =>
              typeof chord?.id === "string" &&
              typeof chord.beat === "number" &&
              chord.beat >= 0 &&
              typeof chord.chordName === "string",
          ),
      ),
  );
}

const chordMap = (song) =>
  new Map(
    song.measures.flatMap((measure) =>
      measure.chords.map((chord) => [
        `${measure.index}:${chord.beat}`,
        chord.chordName,
      ]),
    ),
  );

let chordCorrect = 0;
let chordTotal = 0;
let lyricDistance = 0;
let lyricChars = 0;
let invalid = 0;
const rows = [];

for (const item of manifest.cases) {
  const golden = JSON.parse(
    await readFile(new URL(item.golden, corpus), "utf8"),
  );
  if (!validSong(golden)) throw new Error(`Golden ${item.golden} is invalid.`);
  const pageIds = item.images.map((_, index) => `${item.id}-page-${index + 1}`);
  const pages = await Promise.all(
    item.images.map(async (image, index) => {
      const bytes = await readFile(new URL(image, corpus));
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
        throw new Error(`${image} is not JPEG data.`);
      return {
        id: pageIds[index],
        fileName: image,
        dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        width: 800,
        height: 1000,
      };
    }),
  );
  const expectedChords = chordMap(golden);
  const expectedLyrics = golden.measures
    .map((measure) => measure.lyrics ?? "")
    .join("\n");
  let caseChordAccuracy = 0;
  let caseCer = 1;
  let error = "";
  try {
    const response = await fetch(process.env.VISION_IMPORT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: publicKey,
        Authorization: `Bearer ${process.env.FRETSHIFT_USER_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ pages, hints: { title: golden.title } }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (
      !Array.isArray(body.pages) ||
      body.pages.length !== pageIds.length ||
      body.pages.some(
        (page, index) =>
          page?.id !== pageIds[index] || typeof page?.text !== "string",
      ) ||
      JSON.stringify(body.pageIds) !== JSON.stringify(pageIds)
    ) {
      throw new Error("schema-invalid response");
    }
    const song = pdfPagesToSongs(
      body.pages.map((page, index) => ({
        number: index + 1,
        text: page.text,
      })),
      new Set(),
    )[0];
    if (!validSong(song)) throw new Error("schema-invalid parsed song");
    const actualChords = chordMap(song);
    let correct = 0;
    for (const [position, name] of expectedChords)
      if (actualChords.get(position) === name) correct++;
    const actualLyrics = song.measures
      .map((measure) => measure.lyrics ?? "")
      .join("\n");
    const distance = levenshtein(expectedLyrics, actualLyrics);
    caseChordAccuracy = expectedChords.size ? correct / expectedChords.size : 1;
    caseCer = expectedLyrics.length ? distance / expectedLyrics.length : 0;
    chordCorrect += correct;
    lyricDistance += distance;
  } catch (cause) {
    invalid++;
    error = cause instanceof Error ? cause.message : String(cause);
    lyricDistance += expectedLyrics.length;
  }
  chordTotal += expectedChords.size;
  lyricChars += expectedLyrics.length;
  rows.push(
    `| ${item.id} | ${item.variant} | ${item.images.length} | ${(caseChordAccuracy * 100).toFixed(1)}% | ${(caseCer * 100).toFixed(1)}% | ${error.replaceAll("|", "\\|")} |`,
  );
}

const chordAccuracy = chordTotal ? chordCorrect / chordTotal : 0;
const cer = lyricChars ? lyricDistance / lyricChars : 1;
await writeFile(
  resultsFile,
  `# Vision benchmark results\n\nRun: ${new Date().toISOString()}\n\nCorpus: 20 provisional synthetic rendered chart cases. Human review on real photos remains required.\n\n- Chord accuracy: **${(chordAccuracy * 100).toFixed(1)}%** (target ≥80%)\n- Lyric CER: **${(cer * 100).toFixed(1)}%** (target ≤10%)\n- Schema-invalid or failed responses: **${invalid}**\n\n| Case | Variant | Pages | Chord accuracy | Lyric CER | Error |\n|---|---|---:|---:|---:|---|\n${rows.join("\n")}\n`,
);
console.log(
  `Vision benchmark: chords ${(chordAccuracy * 100).toFixed(1)}%, lyric CER ${(cer * 100).toFixed(1)}%, invalid ${invalid}.`,
);
if (chordAccuracy < 0.8 || cer > 0.1 || invalid) process.exitCode = 1;
