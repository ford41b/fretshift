import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readMusicXML, writeMusicXML } from "./index";
import {
  newSong,
  newMeasure,
  emptySlot,
  resolveTuning,
  type Song,
} from "../../schema/song.v1";
import { TrackSelectionError, quarterTimeline } from "../timeline";
const supported = (s: Song) => ({
  title: s.title,
  artist: s.artist,
  key: s.currentKey,
  tuning: s.tuningId,
  capo: s.capo,
  tempo: s.tempo,
  meter: s.timeSignature,
  measures: s.measures.map((m) => ({
    meter: m.timeSignature ?? s.timeSignature,
    tempo: m.tempoOverride ?? s.tempo,
    section: m.section,
    lyrics: m.lyrics,
    chords: m.chords.map((c) => [c.beat, c.chordName]),
    subdivision: m.subdivision,
    slots: m.tab?.slots,
  })),
});
it("round-trips guitar strings, holds, mutes, capo, lyrics, chords and sections", () => {
  const s = newSong("Café & <Guitar>");
  s.artist = "A & B";
  s.capo = 2;
  s.currentKey = { root: "D", mode: "major" };
  s.measures[0].chords = [{ id: "c", beat: 1.5, chordName: "Dmaj7/F#" }];
  s.measures[0].lyrics = "Sing & play <together>";
  s.measures[0].section = { kind: "verse", label: "Opening" };
  s.measures[0].tab!.slots[0][0] = 0;
  s.measures[0].tab!.slots[1][0] = "hold";
  s.measures[0].tab!.slots[2][5] = "x";
  s.measures[0].tab!.slots[7][4] = 3;
  const m = newMeasure(1, 3);
  m.timeSignature = [3, 8];
  m.tempoOverride = 96;
  m.tab = { slots: Array.from({ length: 6 }, emptySlot) };
  m.tab.slots[0][4] = "hold";
  s.measures.push(m);
  const first = readMusicXML(writeMusicXML(s));
  expect(supported(first)).toEqual(supported(s));
  expect(supported(readMusicXML(writeMusicXML(first)))).toEqual(
    supported(first),
  );
});
it("handles independent voices and asks when multiple parts exist", () => {
  const xml =
    '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><backup><duration>4</duration></backup><note><pitch><step>E</step><octave>2</octave></pitch><duration>8</duration><voice>2</voice></note></measure></part></score-partwise>';
  const song = readMusicXML(xml);
  expect(
    song.measures[0].tab!.slots[0].filter((c) => typeof c === "number"),
  ).toHaveLength(2);
  const multi = xml.replace(
    "</score-partwise>",
    xml.match(/<part id="P1">.*<\/part>/)![0] + "</score-partwise>",
  );
  expect(() => readMusicXML(multi)).toThrow(TrackSelectionError);
  expect(() =>
    readMusicXML(
      xml.replace(
        "<duration>4</duration>",
        "<duration>1</duration><time-modification/>",
      ),
    ),
  ).toThrow(/time-modification/);
});

it("imports an upstream MusicXML tablature fixture with explicit tuning", () => {
  const xml = readFileSync(
    resolve(
      "test-fixtures/interchange/musicxml-testsuite-71e-tab-staves.musicxml",
    ),
    "utf8",
  );
  expect(() => readMusicXML(xml)).toThrow(TrackSelectionError);
  const song = readMusicXML(xml, 0);
  expect(resolveTuning(song.tuningId).midi).toEqual([64, 59, 55, 50, 45, 40]);
  expect(quarterTimeline(song).notes).toHaveLength(10);
  expect(song.provenance?.source).toBe("musicxml");
});
