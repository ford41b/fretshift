import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const output = new URL("../test-fixtures/vision-corpus/", import.meta.url);
const variants = ["printed", "handwritten", "glare", "skew", "low-contrast"];
const progressions = [
  ["C", "G", "Am", "F"],
  ["G", "D", "Em", "C"],
  ["D", "A", "Bm", "G"],
  ["A", "E", "F#m", "D"],
  ["E", "B7", "A", "E"],
  ["F", "C", "Dm", "Bb"],
  ["Am", "F", "C", "G"],
  ["Em", "C", "G", "D"],
];
const lyricSets = [
  [
    "Morning light across the room",
    "Open roads beneath the sky",
    "Every turn becomes a tune",
    "Carry this old song tonight",
  ],
  [
    "Quiet rain against the glass",
    "Footsteps keep a steady time",
    "Let the restless evening pass",
    "Meet me at the final line",
  ],
  [
    "River stones and cedar trees",
    "Summer air and silver strings",
    "Sing the chorus with the breeze",
    "Hear the hope the melody brings",
  ],
  [
    "City lights are fading slow",
    "Train wheels mark the bars below",
    "Take the harmony back home",
    "End the verse but not the road",
  ],
];

function songFor(index, measureCount) {
  const id = `provisional-${String(index).padStart(2, "0")}`;
  const chords = progressions[(index - 1) % progressions.length];
  const lyrics = lyricSets[(index - 1) % lyricSets.length];
  const timestamp = "2026-09-13T00:00:00.000Z";
  const measures = Array.from({ length: measureCount }, (_, measure) => ({
    id: `${id}-m${measure}`,
    index: measure,
    subdivision: 1,
    ...(measure % 4 === 0
      ? {
          section: {
            kind: measure < 4 ? "verse" : "chorus",
            label: measure < 4 ? "Verse 1" : "Chorus",
          },
        }
      : {}),
    lyrics: lyrics[measure % lyrics.length],
    chords: [
      {
        id: `${id}-c${measure}`,
        beat: 0,
        chordName: chords[measure % chords.length],
      },
    ],
  }));
  const root = chords[0].replace(/m$|7$/, "");
  const mode = chords[0].endsWith("m") ? "minor" : "major";
  return {
    schemaVersion: 1,
    id: `${id}-song`,
    title: `Road Song ${index}`,
    artist: "FretShift Fixtures",
    originalKey: { root, mode },
    currentKey: { root, mode },
    tuningId: "standard",
    capo: index % 4,
    tempo: 88 + (index % 6) * 6,
    timeSignature: [4, 4],
    difficulty: 2,
    tags: ["provisional", variants[(index - 1) % variants.length]],
    measures,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function chartHtml(song, measures, variant, pageNumber, pageCount) {
  const rows = measures
    .map(
      (measure) => `
    <div class="measure">
      ${measure.section ? `<h2>${measure.section.label}</h2>` : ""}
      <div class="chords">${measure.chords.map((chord) => `<span>${chord.chordName}</span>`).join("")}</div>
      <div class="lyrics">${measure.lyrics}</div>
    </div>`,
    )
    .join("");
  const special = [
    variant === "handwritten"
      ? "font-family:'Comic Sans MS','Bradley Hand',cursive;"
      : "",
    variant === "skew" ? "transform:rotate(-1.4deg) scale(.97);" : "",
    variant === "low-contrast" ? "color:#666;background:#f5f1e8;" : "",
  ].join("");
  return `<!doctype html><style>
    *{box-sizing:border-box}html,body{margin:0;width:800px;height:1000px;background:#eee;color:#18171b}
    .sheet{position:relative;width:760px;height:960px;margin:20px;padding:58px 62px;background:#fff;overflow:hidden;font-family:Arial,sans-serif;${special}}
    h1{font-size:42px;margin:0 0 8px;letter-spacing:.02em}.artist{font-size:19px;margin-bottom:18px}.meta{font-size:16px;border-top:2px solid;padding-top:10px;margin-bottom:18px}
    .measure{margin:18px 0 24px}h2{font-size:18px;text-transform:uppercase;letter-spacing:.12em;margin:0 0 8px}.chords{display:grid;grid-template-columns:repeat(4,1fr);font-size:25px;font-weight:700;color:#4f2f91}.lyrics{font-size:22px;line-height:1.35;border-bottom:1px solid #ddd;padding:5px 0 10px}
    .page{position:absolute;right:35px;bottom:28px;font-size:14px}.glare{display:${variant === "glare" ? "block" : "none"};position:absolute;inset:-100px -30px -100px 480px;background:linear-gradient(100deg,transparent,rgba(255,255,255,.76),transparent);transform:rotate(7deg)}
  </style><div class="sheet"><h1>${song.title}</h1><div class="artist">${song.artist}</div><div class="meta">Capo ${song.capo} · ${song.tempo} BPM · 4/4 · Standard tuning</div>${rows}<div class="page">Page ${pageNumber} of ${pageCount}</div><div class="glare"></div></div>`;
}

await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
}
const page = await browser.newPage({
  viewport: { width: 800, height: 1000 },
  deviceScaleFactor: 1,
});
const manifest = [];
try {
  for (let index = 1; index <= 20; index++) {
    const id = `provisional-${String(index).padStart(2, "0")}`;
    const variant = variants[(index - 1) % variants.length];
    const pageCount = index % 5 === 0 ? 2 : 1;
    const song = songFor(index, pageCount * 4);
    const golden = `${id}.golden.json`;
    const images = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const image = `${id}-page-${pageIndex + 1}.jpg`;
      const measures = song.measures.slice(pageIndex * 4, pageIndex * 4 + 4);
      await page.setContent(
        chartHtml(song, measures, variant, pageIndex + 1, pageCount),
        { waitUntil: "load" },
      );
      await page.screenshot({
        path: new URL(image, output).pathname,
        type: "jpeg",
        quality: variant === "low-contrast" ? 72 : 88,
      });
      images.push(image);
    }
    await writeFile(
      new URL(golden, output),
      `${JSON.stringify(song, null, 2)}\n`,
    );
    manifest.push({ id, images, golden, variant, pages: pageCount });
  }
} finally {
  await browser.close();
}
await writeFile(
  new URL("manifest.json", output),
  `${JSON.stringify(
    {
      provisional: true,
      generatedAt: "2026-09-13",
      limitations:
        "Synthetic rendered charts cover typography, mild skew, glare, contrast, and four two-page cases. They do not represent camera blur, folds, handwriting diversity, or real publisher layouts.",
      cases: manifest,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Generated ${manifest.length} rendered vision cases (${manifest.reduce((sum, item) => sum + item.images.length, 0)} pages).`,
);
