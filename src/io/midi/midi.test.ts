import { expect, it } from "vitest";
import { Midi } from "@tonejs/midi";
import { parseMidi } from "midi-file";
import { readMidi, writeMidi } from "./index";
import { quarterTimeline, TrackSelectionError } from "../timeline";
import { newSong, newMeasure, emptySlot } from "../../schema/song.v1";
const pitches = (s: ReturnType<typeof readMidi>) =>
  quarterTimeline(s)
    .notes.map((n) => ({ start: n.start, duration: n.duration, midi: n.midi }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
it("round-trips sounding pitches, onset/duration, meter and tempo changes", () => {
  const s = newSong("Guitar MIDI");
  s.tempo = 96;
  s.measures[0].tab!.slots[0][5] = 0;
  s.measures[0].tab!.slots[1][5] = "hold";
  s.measures[0].tab!.slots[2][4] = 2;
  const m = newMeasure(1, 3);
  m.timeSignature = [3, 8];
  m.tempoOverride = 120;
  m.tab = { slots: Array.from({ length: 6 }, emptySlot) };
  m.tab.slots[0][0] = 3;
  s.measures.push(m);
  const first = readMidi(writeMidi(s)),
    second = readMidi(writeMidi(first));
  expect(pitches(first)).toEqual(pitches(s));
  expect(pitches(second)).toEqual(pitches(first));
  expect(
    second.measures.map((m) => [m.timeSignature, m.tempoOverride]),
  ).toEqual(first.measures.map((m) => [m.timeSignature, m.tempoOverride]));
});
it("requires track selection and rejects non-grid rhythm rather than quantizing", () => {
  const midi = new Midi();
  midi.addTrack().addNote({ midi: 60, ticks: 0, durationTicks: 480 });
  midi.addTrack().addNote({ midi: 64, ticks: 0, durationTicks: 480 });
  expect(() => readMidi(midi.toArray())).toThrow(TrackSelectionError);
  expect(readMidi(midi.toArray(), 1).measures.length).toBe(1);
  const bad = new Midi();
  bad.addTrack().addNote({ midi: 60, ticks: 0, durationTicks: 160 });
  expect(() => readMidi(bad.toArray())).toThrow(/finer grid/);
});

it.each([
  [{ root: "A", mode: "minor" }, 0],
  [{ root: "F#", mode: "minor" }, 3],
  [{ root: "Eb", mode: "minor" }, -6],
  [{ root: "Db", mode: "major" }, -5],
  [{ root: "F#", mode: "major" }, 6],
] as const)(
  "preserves %j and writes its standard fifth-count event",
  (key, fifths) => {
    const song = newSong("Key signature");
    song.currentKey = { ...key };
    song.originalKey = { ...key };
    song.measures[0].tab!.slots[0][0] = 0;
    const bytes = writeMidi(song);
    expect(
      parseMidi(bytes)
        .tracks.flat()
        .find((e) => e.type === "keySignature"),
    ).toMatchObject({ key: fifths, scale: key.mode === "minor" ? 1 : 0 });
    expect(readMidi(bytes).currentKey).toEqual(key);
  },
);

it("normalizes MIDI microseconds-per-quarter noise without losing useful decimals", () => {
  const midi = new Midi();
  midi.header.setTempo(108);
  const track = midi.addTrack();
  track.addNote({ midi: 64, ticks: 0, durationTicks: 480 });
  expect(readMidi(midi.toArray()).tempo).toBe(108);
  midi.header.setTempo(108.5);
  expect(readMidi(midi.toArray()).tempo).toBe(108.5);
});
