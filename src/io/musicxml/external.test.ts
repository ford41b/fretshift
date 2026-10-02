import { expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readMusicXML, writeMusicXML, unpackMusicXML } from "./index";
import { newSong, resolveTuning } from "../../schema/song.v1";

const attributes =
  "<attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>";
const note = (words = "", extra = "") =>
  `<note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration>${extra}${words ? `<lyric><syllabic>single</syllabic><text>${words}</text></lyric>` : ""}</note>`;
const score = (body: string) =>
  `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>External fixture</work-title></work><part-list><score-part id="g"><part-name>Guitar</part-name></score-part></part-list><part id="g"><measure number="1">${attributes}${body}</measure></part></score-partwise>`;

it("reads external flat harmonies, slash bass, dotted metronome units and repeated lyrics", () => {
  const xml = score(
    `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction><harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind text="m7">minor-seventh</kind><bass><bass-step>D</bass-step><bass-alter>-1</bass-alter></bass></harmony>${note("la")}${note("la")}`,
  );
  const song = readMusicXML(xml);
  expect(song.tempo).toBe(120);
  expect(song.measures[0].chords[0].chordName).toBe("Bbm7/Db");
  expect(song.measures[0].lyrics).toBe("la la");
  expect(
    readMusicXML(
      xml
        .replace("<per-minute>80</per-minute>", "<per-minute>40</per-minute>")
        .replace("</direction>", '<sound tempo="150"/></direction>'),
    ).tempo,
  ).toBe(150);
});

it.each([
  "Dbmaj9/Ab",
  "Cm6",
  "Cdim7",
  "F#11",
  "Bbm13",
  "G7b9",
  "Dsus47",
  "Em7b5",
  "C6add9",
])("exports the actual standard harmony pitches for %s", (chordName) => {
  const song = newSong();
  song.measures[0].chords = [{ id: "c", beat: 0, chordName }];
  const xml = writeMusicXML(song);
  expect(readMusicXML(xml).measures[0].chords[0].chordName).toBe(chordName);
  const harmony = new DOMParser()
    .parseFromString(xml, "application/xml")
    .querySelector("harmony")!;
  expect(harmony.querySelector("kind")!.getAttribute("text")).not.toContain(
    chordName[0],
  );
  if (chordName === "Dbmaj9/Ab") {
    expect(harmony.querySelector("root-step")!.textContent).toBe("D");
    expect(harmony.querySelector("root-alter")!.textContent).toBe("-1");
    expect(harmony.querySelector("kind")!.textContent).toBe("major-ninth");
  }
  if (!harmony.querySelector("degree")) {
    harmony.querySelector("kind")!.removeAttribute("text");
    const external = score(harmony.outerHTML + note());
    expect(readMusicXML(external).measures[0].chords[0].chordName).toBe(
      chordName,
    );
  }
});

it.each([
  { root: "Eb", mode: "minor" },
  { root: "F#", mode: "minor" },
  { root: "Gb", mode: "major" },
  { root: "C#", mode: "major" },
] as const)("round-trips %s key signatures", (key) => {
  const song = newSong();
  song.currentKey = { ...key };
  expect(readMusicXML(writeMusicXML(song)).currentKey).toEqual(key);
});

it("uses standard harmony content when display text conflicts", () => {
  const xml = score(
    '<harmony><root><root-step>C</root-step></root><kind text="C">minor</kind><bass><bass-step>G</bass-step></bass></harmony>' +
      note(),
  );
  expect(readMusicXML(xml).measures[0].chords[0].chordName).toBe("Cm/G");
});

it("unpacks a compressed score and resolves custom six-string tuning", () => {
  const tunings = [39, 44, 49, 54, 58, 62]
    .map((midi, i) => {
      const pc = midi % 12;
      const names: Record<number, [string, number]> = {
        2: ["D", 0],
        3: ["E", -1],
        8: ["A", -1],
        1: ["D", -1],
        6: ["G", -1],
        10: ["B", -1],
      };
      const [step, alter] = names[pc];
      return `<staff-tuning line="${i + 1}"><tuning-step>${step}</tuning-step><tuning-alter>${alter}</tuning-alter><tuning-octave>${Math.floor(midi / 12) - 1}</tuning-octave></staff-tuning>`;
    })
    .join("");
  const xml = score(note()).replace(
    "</attributes>",
    `<staff-details><staff-lines>6</staff-lines>${tunings}<capo>1</capo></staff-details></attributes>`,
  );
  const bytes = zipSync({
    "META-INF/container.xml": strToU8(
      '<container><rootfiles><rootfile full-path="scores/guitar.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
    ),
    "scores/guitar.musicxml": strToU8(xml),
  });
  const song = readMusicXML(unpackMusicXML(bytes));
  expect(resolveTuning(song.tuningId).midi).toEqual([62, 58, 54, 49, 44, 39]);
  expect(song.capo).toBe(1);
  expect(unpackMusicXML(strToU8(xml))).toBe(xml);
  expect(() =>
    unpackMusicXML(
      zipSync({
        "META-INF/container.xml": strToU8(
          '<container><rootfile full-path="absent.xml"/></container>',
        ),
      }),
    ),
  ).toThrow(/declared score/);
});

it("rejects an earlier voice that overflows even after a backup", () => {
  const xml = score(
    note().replace("<duration>4</duration>", "<duration>20</duration>") +
      "<backup><duration>20</duration></backup>" +
      note(),
  );
  expect(() => readMusicXML(xml)).toThrow(/overflows/);
});

it("rejects a missing tie continuation, malformed durations, unsupported articulation and pickups", () => {
  expect(() =>
    readMusicXML(score(note("", '<tie type="start"/>') + note())),
  ).toThrow(/broken tie/);
  expect(() =>
    readMusicXML(
      score(note().replace("<duration>4</duration>", "<duration/>")),
    ),
  ).toThrow(/invalid duration/);
  expect(() =>
    readMusicXML(
      score(
        note(
          "",
          "<notations><articulations><staccato/></articulations></notations>",
        ),
      ),
    ),
  ).toThrow(/articulations/);
  expect(() =>
    readMusicXML(
      score(note()).replace(
        '<measure number="1">',
        '<measure number="0" implicit="yes">',
      ),
    ),
  ).toThrow(/pickup/);
  expect(() =>
    readMusicXML(score("<backup><duration>-4</duration></backup>" + note())),
  ).toThrow(/positive/);
});

it("joins syllables and preserves independent lyric verses", () => {
  const first = note().replace(
    "</note>",
    '<lyric number="1"><syllabic>begin</syllabic><text>Hel</text></lyric><lyric number="2"><text>Play</text></lyric></note>',
  );
  const second = note().replace(
    "</note>",
    '<lyric number="1"><syllabic>end</syllabic><text>lo</text></lyric><lyric number="2"><text>again</text></lyric></note>',
  );
  expect(readMusicXML(score(first + second)).measures[0].lyrics).toBe(
    "Hello\nPlay again",
  );
});

it("selects the declared MusicXML rootfile when a compressed archive includes other resources", () => {
  const bytes = zipSync({
    "META-INF/container.xml": strToU8(
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="preview.pdf" media-type="application/pdf"/><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
    ),
    "preview.pdf": strToU8("preview"),
    "score.xml": strToU8(score(note())),
  });
  expect(readMusicXML(unpackMusicXML(bytes)).title).toBe("External fixture");
  expect(() => unpackMusicXML(new Uint8Array([0x50, 0x4b, 0, 0]))).toThrow(
    /Malformed compressed/,
  );
});

it("reads standard altered harmony degrees without display text", () => {
  const xml = score(
    "<harmony><root><root-step>G</root-step></root><kind>dominant</kind><degree><degree-value>9</degree-value><degree-alter>-1</degree-alter><degree-type>add</degree-type></degree></harmony>" +
      note(),
  );
  expect(readMusicXML(xml).measures[0].chords[0].chordName).toBe("G7b9");
});
