import { describe, expect, it } from "vitest";
import { exporter, importer, model, Settings } from "@coderline/alphatab";
import { strToU8, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  emptySlot,
  newMeasure,
  newSong,
  registerTuning,
  resolveTuning,
  type Song,
} from "../../schema/song.v1";
import { TrackSelectionError, quarterTimeline } from "../timeline";
import { readGuitarPro, writeGuitarPro } from "./index";

const supported = (song: Song) => ({
  title: song.title,
  artist: song.artist,
  key: song.currentKey,
  capo: song.capo,
  tuning: resolveTuning(song.tuningId).midi,
  tempo: song.tempo,
  meter: song.timeSignature,
  measures: song.measures.map((m) => ({
    meter: m.timeSignature ?? song.timeSignature,
    tempo: m.tempoOverride ?? song.tempo,
    section: m.section,
    lyrics: m.lyrics,
    chords: m.chords.map((c) => [c.beat, c.chordName]),
    subdivision: m.subdivision,
    slots: m.tab?.slots,
  })),
});

// Independent alphaTab model fixtures exercise actual binary GP archives at the API boundary.
function fixture(trackCount = 1) {
  const score = new model.Score();
  score.title = "External GP fixture";
  const master = new model.MasterBar();
  master.tempoAutomations.push(
    model.Automation.buildTempoAutomation(false, 0, 96, 2),
  );
  score.addMasterBar(master);
  for (let i = 0; i < trackCount; i++) {
    const track = new model.Track(),
      staff = new model.Staff(),
      bar = new model.Bar(),
      voice = new model.Voice();
    score.addTrack(track);
    track.name = i === 0 ? "Lead guitar" : "Rhythm guitar";
    track.addStaff(staff);
    staff.stringTuning = new model.Tuning("Standard", [64, 59, 55, 50, 45, 40]);
    staff.addBar(bar);
    bar.addVoice(voice);
    const beat = new model.Beat(),
      note = new model.Note();
    beat.duration = model.Duration.Quarter;
    note.string = i === 0 ? 6 : 1;
    note.fret = 3;
    beat.addNote(note);
    voice.addBeat(beat);
  }
  return score;
}
function encode(score: model.Score) {
  score.finish(new Settings());
  return new exporter.Gp7Exporter().export(score, new Settings());
}

it("imports an upstream Guitar Pro 5 fixture that was not made by Fretshift", () => {
  const bytes = readFileSync(
    resolve("test-fixtures/interchange/alphatab-chords.gp5"),
  );
  const song = readGuitarPro(new Uint8Array(bytes));
  expect(song.provenance?.source).toBe("guitarpro");
  expect(quarterTimeline(song).notes.length).toBeGreaterThan(20);
  expect(song.measures.some((measure) => measure.chords.length > 0)).toBe(true);
});

it("round-trips strings, simultaneous notes, cross-measure ties, mutes and score metadata", () => {
  const song = newSong("Café & <Guitar>");
  song.artist = "A & B";
  song.capo = 2;
  song.currentKey = { root: "C#", mode: "minor" };
  song.originalKey = { ...song.currentKey };
  song.tuningId = registerTuning({
    id: "gp-test-custom",
    label: "Custom GP test",
    midi: [65, 59, 55, 50, 45, 40],
    builtIn: false,
  }).id;
  song.measures[0].section = { kind: "verse", label: "Opening" };
  song.measures[0].lyrics = "Sing & play <together>";
  song.measures[0].chords = [{ id: "c", beat: 1.5, chordName: "Dmaj7/F#" }];
  const slots = song.measures[0].tab!.slots;
  slots[0][0] = 0;
  slots[0][5] = 2;
  slots[1][0] = "hold";
  slots[2][5] = "x";
  slots[7][4] = 3;
  const next = newMeasure(1, 3);
  next.timeSignature = [3, 8];
  next.tempoOverride = 88;
  next.tab = { slots: Array.from({ length: 6 }, emptySlot) };
  next.tab.slots[0][4] = "hold";
  next.lyrics = "Words on a sustained note";
  next.section = { kind: "chorus" };
  song.measures.push(next);
  const bytes = writeGuitarPro(song);
  expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
  const loaded = readGuitarPro(bytes);
  expect(supported(loaded)).toEqual(supported(song));
  expect(supported(readGuitarPro(writeGuitarPro(loaded)))).toEqual(
    supported(loaded),
  );
  expect(loaded.provenance?.source).toBe("guitarpro");
});

it("keeps lyrics and chord labels on resting beats", () => {
  const song = newSong("Rest lyrics");
  song.measures[0].lyrics = "Count then play";
  song.measures[0].chords = [{ id: "c", beat: 0, chordName: "Am7" }];
  const loaded = readGuitarPro(writeGuitarPro(song));
  expect(supported(loaded)).toEqual(supported(song));
});

it("requires an explicit track choice and honors six-string numbering", () => {
  const bytes = encode(fixture(2));
  let choices: unknown;
  try {
    readGuitarPro(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(TrackSelectionError);
    choices = (error as TrackSelectionError).tracks;
  }
  expect(choices).toEqual([
    { index: 0, name: "Lead guitar", notes: 1 },
    { index: 1, name: "Rhythm guitar", notes: 1 },
  ]);
  expect(quarterTimeline(readGuitarPro(bytes, 0)).notes).toEqual([
    { start: 0, duration: 1, midi: 67, string: 0, muted: false },
  ]);
  expect(quarterTimeline(readGuitarPro(bytes, 1)).notes[0]).toMatchObject({
    midi: 43,
    string: 5,
  });
  for (const choice of [-1, 0.5, 2])
    expect(() => readGuitarPro(bytes, choice)).toThrow(/track selection/);
});

it("imports independent voices and dotted rhythms without moving pitches or timing", () => {
  const score = fixture(),
    bar = score.tracks[0].staves[0].bars[0];
  bar.voices[0].beats[0].dots = 1;
  const voice = new model.Voice(),
    beat = new model.Beat(),
    note = new model.Note();
  note.string = 1;
  note.fret = 0;
  beat.duration = model.Duration.Half;
  beat.addNote(note);
  voice.addBeat(beat);
  bar.addVoice(voice);
  const song = readGuitarPro(encode(score));
  expect(quarterTimeline(song).notes).toEqual([
    { start: 0, duration: 1.5, midi: 67, string: 0, muted: false },
    { start: 0, duration: 2, midi: 40, string: 5, muted: false },
  ]);
  expect(supported(readGuitarPro(writeGuitarPro(song)))).toEqual(
    supported(song),
  );
});

describe("explicit rejection of unsupported or malformed scores", () => {
  it.each([
    [
      "repeat",
      (score: model.Score) => {
        score.masterBars[0].isRepeatStart = true;
      },
    ],
    [
      "tuplets",
      (score: model.Score) => {
        const beat = score.tracks[0].staves[0].bars[0].voices[0].beats[0];
        beat.tupletNumerator = 3;
        beat.tupletDenominator = 2;
      },
    ],
    [
      "pitch effects",
      (score: model.Score) => {
        score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].harmonicType =
          model.HarmonicType.Natural;
      },
    ],
    [
      "articulations",
      (score: model.Score) => {
        score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].isLetRing = true;
      },
    ],
    [
      "tempo changes inside",
      (score: model.Score) => {
        score.masterBars[0].tempoAutomations.push(
          model.Automation.buildTempoAutomation(false, 0.5, 100, 2),
        );
      },
    ],
  ])("rejects %s", (message, mutate) => {
    const score = fixture();
    mutate(score);
    expect(() => readGuitarPro(encode(score))).toThrow(new RegExp(message));
  });

  it("rejects non-GP content, malformed archives and incomplete files", () => {
    for (const bytes of [
      new Uint8Array(),
      strToU8("<score-partwise/>"),
      strToU8("BCFZ"),
      zipSync({ "ordinary.txt": strToU8("not a score") }),
    ]) {
      expect(() => readGuitarPro(bytes)).toThrow(/Invalid Guitar Pro file/);
    }
  });

  it("rejects guitar ranges and overflow instead of dropping notes", () => {
    const range = fixture();
    range.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret = 23;
    expect(() => readGuitarPro(encode(range))).toThrow(/frets 0–22/);
    const overflow = fixture();
    overflow.tracks[0].staves[0].bars[0].voices[0].beats[0].duration =
      model.Duration.DoubleWhole;
    expect(() => readGuitarPro(encode(overflow))).toThrow(
      /overflowing beat timing/,
    );
  });
});

it("exports alphaTab-readable capo-relative frets and sounding pitches", () => {
  const song = newSong("Capo");
  song.capo = 3;
  song.measures[0].tab!.slots[0][5] = 4;
  const score = importer.ScoreLoader.loadScoreFromBytes(writeGuitarPro(song));
  const staff = score.tracks[0].staves[0];
  expect(staff.capo).toBe(3);
  expect(staff.bars[0].voices[0].beats[0].notes[0]).toMatchObject({
    string: 1,
    fret: 4,
    realValue: 47,
  });
});
