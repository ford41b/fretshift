import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import midiPackage from "@tonejs/midi";
import { PDFDocument, StandardFonts } from "pdf-lib";

const { Midi } = midiPackage;

async function chordSheetPdf() {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const lines of [
    [
      "River Road",
      "Key: C",
      "Verse",
      "C G Am F",
      "Walking down the river road",
    ],
    [
      "Night Drive",
      "Key: D",
      "Chorus",
      "D A Bm G",
      "Headlights on the county line",
    ],
  ]) {
    const page = pdf.addPage([612, 792]);
    lines.forEach((line, index) =>
      page.drawText(line, {
        x: 54,
        y: 730 - index * 32,
        size: index === 0 ? 22 : 14,
        font,
      }),
    );
  }
  return Buffer.from(await pdf.save());
}

function progressionWav() {
  const sampleRate = 22050,
    seconds = 4,
    samples = new Float32Array(sampleRate * seconds);
  // The current importer drafts single-string roots, not polyphonic chords.
  const chords = [[60], [65], [67], [60]];
  for (const [chordIndex, notes] of chords.entries())
    for (let index = 0; index < sampleRate; index++) {
      const time = index / sampleRate,
        envelope =
          Math.min(1, index / 220) * Math.min(1, (sampleRate - index) / 220);
      samples[chordIndex * sampleRate + index] =
        (envelope *
          notes.reduce(
            (sum, midi) =>
              sum +
              Math.sin(2 * Math.PI * 440 * 2 ** ((midi - 69) / 12) * time),
            0,
          )) /
        notes.length;
    }
  const output = Buffer.alloc(44 + samples.length * 2);
  output.write("RIFF", 0);
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) =>
    output.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
      44 + index * 2,
    ),
  );
  return output;
}

// External XML, deliberately not produced by our writer. High F is a custom tuning.
const customXML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
 <work><work-title>Custom tuning travel</work-title></work>
 <part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
 <part id="P1"><measure number="1">
  <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>
   <staff-details><staff-lines>6</staff-lines>
    <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
    <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
    <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
    <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
    <staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
    <staff-tuning line="6"><tuning-step>F</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
    <capo>1</capo>
   </staff-details>
  </attributes>
  <direction><direction-type><rehearsal>Opening</rehearsal></direction-type><sound tempo="96"/></direction>
  <note><pitch><step>G</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><type>quarter</type>
   <notations><technical><string>1</string><fret>2</fret></technical></notations>
   <lyric><text>Carry this tuning home</text></lyric>
  </note>
  <note><rest/><duration>12</duration><type>half</type><dot/></note>
 </measure></part>
</score-partwise>`;

async function openStructured(page: Page) {
  await page.goto("/import");
  await page.getByRole("button", { name: /Structured files/ }).click();
}

async function uploadXML(page: Page) {
  await page
    .getByLabel("Choose structured file", { exact: true })
    .setInputFiles({
      name: "custom-tuning.musicxml",
      mimeType: "application/vnd.recordare.musicxml+xml",
      buffer: Buffer.from(customXML),
    });
  await expect(
    page.getByRole("heading", { name: "Custom tuning travel", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".import-preview .tab-svg").first()).toBeVisible();
}

async function saveDraft(page: Page) {
  await page.getByRole("button", { name: "Save & edit", exact: true }).click();
  await expect(page).toHaveURL(/\/song\/[^/?]+\?edit=1$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect
    .poll(() =>
      page.evaluate(async (songId) => {
        const path = "/src/persistence/dexie/index.ts";
        const { db } = (await import(
          path
        )) as typeof import("../src/persistence/dexie");
        return Boolean(await db.songs.get(songId));
      }, id),
    )
    .toBe(true);
  return id;
}

async function snapshot(page: Page, id: string) {
  return page.evaluate(async (songId) => {
    const dbPath = "/src/persistence/dexie/index.ts",
      timelinePath = "/src/io/timeline.ts",
      schemaPath = "/src/schema/song.v1.ts";
    const { db } = (await import(
      dbPath
    )) as typeof import("../src/persistence/dexie");
    const { quarterTimeline } = (await import(
      timelinePath
    )) as typeof import("../src/io/timeline");
    const { resolveTuning } = (await import(
      schemaPath
    )) as typeof import("../src/schema/song.v1");
    const song = await db.songs.get(songId);
    if (!song) throw new Error("Imported song was not persisted.");
    return {
      title: song.title,
      capo: song.capo,
      tuningId: song.tuningId,
      tuning: resolveTuning(song.tuningId).midi,
      notes: quarterTimeline(song).notes.map(
        ({ midi, start, duration, string }) => ({
          midi,
          start,
          duration,
          string,
        }),
      ),
      tempo: song.tempo,
      meter: song.timeSignature,
      persistedTuning: (await db.tunings.get(song.tuningId))?.midi,
      quarantined: Boolean(await db.quarantine.get(songId)),
    };
  }, id);
}

async function exportAndReimport(
  page: Page,
  testInfo: TestInfo,
  format: "MIDI" | "MusicXML" | "Guitar Pro",
  title: string,
) {
  await page
    .getByRole("button", { name: "Source and export", exact: true })
    .click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: format, exact: true })
    .click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(
    format === "MIDI"
      ? /\.mid$/
      : format === "MusicXML"
        ? /\.(musicxml|xml)$/
        : /\.gp$/,
  );
  const file = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(file);
  await openStructured(page);
  await page
    .getByLabel("Choose structured file", { exact: true })
    .setInputFiles(file);
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  return saveDraft(page);
}

for (const format of ["MusicXML", "Guitar Pro"] as const) {
  test(`${format} custom tuning survives save, reload and downloaded-file reimport`, async ({
    page,
  }, testInfo) => {
    await openStructured(page);
    await uploadXML(page);
    await expect(page.locator(".import-preview")).toContainText(
      "Carry this tuning home",
    );
    const id = await saveDraft(page);
    const before = await snapshot(page, id);
    expect(before).toMatchObject({
      capo: 1,
      tuning: [65, 59, 55, 50, 45, 40],
      tempo: 96,
      meter: [4, 4],
      notes: [{ midi: 68, start: 0, duration: 1, string: 0 }],
      persistedTuning: [65, 59, 55, 50, 45, 40],
      quarantined: false,
    });
    await page.reload();
    await expect(page.getByLabel("Song title", { exact: true })).toHaveValue(
      before.title,
    );
    await expect(page.getByLabel("Song tuning", { exact: true })).toHaveValue(
      before.tuningId,
    );
    expect(await snapshot(page, id)).toEqual(before);
    const importedId = await exportAndReimport(
      page,
      testInfo,
      format,
      before.title,
    );
    expect(importedId).not.toBe(id);
    const { tuningId: _originalTuningId, ...expected } = before;
    const { tuningId: _importedTuningId, ...actual } = await snapshot(
      page,
      importedId,
    );
    expect(actual).toEqual(expected);
  });
}

test("MIDI requires a track choice and its selected pitches survive export and reimport", async ({
  page,
}, testInfo) => {
  const midi = new Midi();
  midi.header.name = "Two guitar parts";
  midi.header.setTempo(108);
  const bass = midi.addTrack();
  bass.name = "Bass study";
  bass.instrument.number = 24;
  bass.addNote({ midi: 40, ticks: 0, durationTicks: 480, velocity: 0.8 });
  bass.endOfTrackTicks = 1920;
  const lead = midi.addTrack();
  lead.name = "Acoustic lead";
  lead.instrument.number = 24;
  lead.addNote({ midi: 64, ticks: 0, durationTicks: 480, velocity: 0.8 });
  lead.addNote({ midi: 67, ticks: 960, durationTicks: 240, velocity: 0.8 });
  lead.endOfTrackTicks = 1920;
  await openStructured(page);
  await page
    .getByLabel("Choose structured file", { exact: true })
    .setInputFiles({
      name: "two-parts.mid",
      mimeType: "audio/midi",
      buffer: Buffer.from(midi.toArray()),
    });
  await expect(page.getByLabel("Guitar track", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save & edit", exact: true }),
  ).toHaveCount(0);
  const option = page
    .getByLabel("Guitar track", { exact: true })
    .getByRole("option", { name: /Acoustic lead/ });
  await page
    .getByLabel("Guitar track", { exact: true })
    .selectOption((await option.getAttribute("value"))!);
  await page
    .getByRole("button", { name: "Review selected track", exact: true })
    .click();
  await expect(page.locator(".import-preview .tab-svg").first()).toBeVisible();
  const id = await saveDraft(page),
    before = await snapshot(page, id);
  expect(before).toMatchObject({
    title: "Two guitar parts",
    tempo: 108,
    notes: [
      { midi: 64, start: 0, duration: 1 },
      { midi: 67, start: 2, duration: 0.5 },
    ],
  });
  const importedId = await exportAndReimport(
    page,
    testInfo,
    "MIDI",
    before.title,
  );
  expect(await snapshot(page, importedId)).toEqual(before);
});

test("a malformed replacement clears a valid preview without saving either file", async ({
  page,
}) => {
  await openStructured(page);
  await uploadXML(page);
  const songCount = () =>
    page.evaluate(async () => {
      const path = "/src/persistence/dexie/index.ts";
      const { db } = (await import(
        path
      )) as typeof import("../src/persistence/dexie");
      return db.songs.count();
    });
  const before = await songCount();
  await page
    .getByLabel("Choose structured file", { exact: true })
    .setInputFiles({
      name: "broken.musicxml",
      mimeType: "application/xml",
      buffer: Buffer.from("<score-partwise><part>"),
    });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save & edit", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".import-preview")).toHaveCount(0);
  expect(await songCount()).toBe(before);
});

test("text-layer PDF boundaries import as separate songs and export a structured PDF", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/import");
  await page.getByRole("button", { name: /Text-layer PDF/ }).click();
  await page.getByLabel("Choose PDF file", { exact: true }).setInputFiles({
    name: "two-songs.pdf",
    mimeType: "application/pdf",
    buffer: await chordSheetPdf(),
  });
  await expect(
    page.getByText("2 songs proposed from 2 pages", { exact: true }),
  ).toBeVisible();
  const boundary = page.getByLabel("Start a new song on page 2", {
    exact: true,
  });
  await expect(boundary).toBeChecked();
  await boundary.uncheck();
  await expect(
    page.getByText("1 song proposed from 2 pages", { exact: true }),
  ).toBeVisible();
  await boundary.check();
  await expect(
    page.getByRole("heading", { name: "River Road", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save all & edit first", exact: true })
    .click();
  await expect(page).toHaveURL(/\/song\/[^/?]+\?edit=1$/);
  await page
    .getByRole("button", { name: "Source and export", exact: true })
    .click();
  const pdfOptions = page.locator(".pdf-export-options select");
  await pdfOptions.nth(0).selectOption("a4");
  await pdfOptions.nth(1).selectOption("shape");
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Printable PDF", exact: true })
    .click();
  const download = await pending,
    file = testInfo.outputPath("river-road-shape-a4.pdf");
  await download.saveAs(file);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const exported = await PDFDocument.load(
    await import("node:fs/promises").then((fs) => fs.readFile(file)),
  );
  expect(exported.getPageCount()).toBeGreaterThanOrEqual(1);
  await testInfo.attach("printable-sheet", {
    path: file,
    contentType: "application/pdf",
  });
});

test("offline audio analysis produces a waveform and an editable chord draft", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/import");
  await page.getByRole("button", { name: /Audio recording/ }).click();
  await page.getByText("Older single-string draft").click();
  await page.getByLabel("Choose audio file", { exact: true }).setInputFiles({
    name: "I-IV-V-I.wav",
    mimeType: "audio/wav",
    buffer: progressionWav(),
  });
  await expect(page.getByLabel("Draft title", { exact: true })).toHaveValue(
    "I-IV-V-I",
    { timeout: 20000 },
  );
  await expect(
    page.getByRole("img", { name: /Recording waveform/ }),
  ).toBeVisible();
  const chords = page.getByLabel(/^Chord at/);
  await expect(chords).toHaveCount(4);
  await expect(chords.nth(0)).toHaveValue("C");
  await chords.nth(1).fill("Fm");
  await page.getByRole("button", { name: "Save & edit", exact: true }).click();
  await expect(page).toHaveURL(/\/song\/[^/?]+\?edit=1$/);
  await expect(page.getByLabel("Song title", { exact: true })).toHaveValue(
    "I-IV-V-I",
  );
});

for (const theme of ["light", "dark"] as const) {
  test(`structured import and export dialog are accessible in ${theme}${theme === "dark" ? " on mobile" : ""}`, async ({
    page,
  }) => {
    if (theme === "dark")
      await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings");
    await page
      .getByRole("button", {
        name: theme === "light" ? "Light" : "Dark",
        exact: true,
      })
      .click();
    const check = async () => {
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        scan.violations
          .filter((v) => ["critical", "serious"].includes(v.impact ?? ""))
          .map((v) => ({
            id: v.id,
            nodes: v.nodes
              .slice(0, 4)
              .map((n) => ({ html: n.html, summary: n.failureSummary })),
          })),
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(page.viewportSize()!.width);
    };
    await openStructured(page);
    await check();
    await uploadXML(page);
    await check();
    await saveDraft(page);
    await page
      .getByRole("button", { name: "Source and export", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await check();
  });
}
