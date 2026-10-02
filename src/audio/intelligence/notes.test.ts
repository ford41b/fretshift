import { describe, expect, it } from "vitest";
import { YinNoteTranscriber } from "./notes";
import {
  defaultFingeringOptions,
  fingeringCandidates,
  suggestFingerings,
} from "./fingering";
import { createNoteTranscription } from "./noteReview";
import { audioReviewToSong, createAudioReview } from "./review";
import { compileTargets, EventScorer } from "../immersive/score";
import { practiceTimeline, TimelineQueue } from "../playback/timeline";
import { loadSong } from "../../schema/migrations";
import { syntheticNotes } from "../../../test-fixtures/audio-notes/synthetic.mjs";
import type { AudioIntelligenceResult, NoteAnalysis } from "./types";
import type { ReviewedNote } from "../../schema/audioNotes";

const detected: NoteAnalysis = {
  providerId: "fixture",
  hopSeconds: 0.01,
  windowSeconds: 0.1,
  frames: [],
  warnings: [],
  notes: [
    {
      id: "a",
      start: 0.13,
      end: 0.4,
      midi: 64,
      confidence: 0.95,
      inferredArticulation: "unknown",
    },
    {
      id: "b",
      start: 2.17,
      end: 2.4,
      midi: 67,
      confidence: 0.91,
      inferredArticulation: "unknown",
    },
  ],
};
const result: AudioIntelligenceResult = {
  version: 1,
  duration: 4,
  notes: detected,
  stemProviderId: null,
  warnings: [],
  measures: [],
  beats: {
    providerId: "fixture",
    tempoBpm: 120,
    beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    downbeats: [0, 2],
    meter: 4,
    status: "estimated",
    evidence: 1,
    warnings: [],
  },
  chords: { providerId: "fixture", vocabulary: [], segments: [], warnings: [] },
};
function reviewed() {
  const r = createAudioReview(result, "fixture.wav", []);
  r.reviewed.timingConfirmed = true;
  r.noteTranscription!.notes.forEach((n) => {
    n.confirmed = true;
    n.uncertain = false;
  });
  return r;
}
describe("single-note provider", () => {
  it("detects separated and repeated synthetic pitches with source-time evidence", async () => {
    const fixture = syntheticNotes();
    const out = await new YinNoteTranscriber().transcribe(fixture);
    expect(out.notes.map((n) => n.midi)).toEqual([52, 57, 64, 64, 60]);
    out.notes.forEach((n, i) => {
      expect(Math.abs(n.start - fixture.notes[i].start)).toBeLessThan(0.07);
      expect(n.end).toBeGreaterThan(n.start);
    });
    expect(out.frames.some((f) => f.midi === null)).toBe(true);
    expect(out.notes.every((n) => n.inferredArticulation === "unknown")).toBe(
      true,
    );
    expect(
      createNoteTranscription(out).notes.every(
        (n) => !n.confirmed && n.uncertain,
      ),
    ).toBe(true);
  });
  it("abstains on silence, noise and a triad without fabricating polyphonic voices", async () => {
    for (const kind of ["silence", "noise", "polyphonic"]) {
      const out = await new YinNoteTranscriber().transcribe(
        syntheticNotes(kind),
      );
      expect(out.notes, kind).toHaveLength(0);
    }
  });
  it("rejects invalid PCM rather than serializing invalid evidence", async () => {
    await expect(
      new YinNoteTranscriber().transcribe({
        samples: new Float32Array([NaN]),
        sampleRate: 22050,
      }),
    ).rejects.toThrow(/invalid samples/);
  });
});
describe("fingering paths", () => {
  it("respects tuning, capo, available strings and physical fret limit", () => {
    const options = {
      ...defaultFingeringOptions,
      tuningId: "drop-d",
      capo: 2,
      availableStrings: [5],
      minFret: 0,
      maxFret: 22,
    };
    expect(fingeringCandidates(40, options)).toEqual([{ string: 5, fret: 0 }]);
    expect(fingeringCandidates(62, options)).toEqual([]);
    expect(fingeringCandidates(64, defaultFingeringOptions)).toHaveLength(5);
  });
  it("uses a preferred position and propagates a manual anchor without changing pitch", () => {
    const t = createNoteTranscription(detected);
    const notes: ReviewedNote[] = [64, 65, 67].map((midi, i) => ({
      ...t.notes[0],
      id: String(i),
      midi,
      start: i * 0.3,
      end: i * 0.3 + 0.2,
      fingering: null,
    }));
    const options = {
      ...defaultFingeringOptions,
      position: 9,
      preferOpen: false,
    };
    const suggested = suggestFingerings(notes, options);
    expect(suggested[0].fingering!.fret).toBeGreaterThan(0);
    notes[1].fingering = { string: 1, fret: 6, source: "user" };
    const anchored = suggestFingerings(notes, { ...options, position: 5 });
    expect(anchored.map((n) => n.fingering!.string)).toEqual([1, 1, 1]);
    expect(anchored.map((n) => n.midi)).toEqual([64, 65, 67]);
    expect(anchored[1].fingering!.source).toBe("user");
  });
  it("retains unreachable pitches as unplaced and clears confirmation on setup changes", () => {
    const t = createNoteTranscription(detected);
    t.notes[0].confirmed = true;
    t.notes[0].uncertain = false;
    const next = suggestFingerings(t.notes, {
      ...t.options,
      availableStrings: [5],
      minFret: 0,
      maxFret: 2,
    });
    expect(next[0].fingering).toBeNull();
    expect(next[0].confirmed).toBe(false);
    expect(next[0].midi).toBe(64);
  });
});
describe("notes → saved tab → exact-time practice", () => {
  it("saves a notes-only song, retaining raw evidence, corrections and quantization separately", () => {
    const r = reviewed();
    r.noteTranscription!.notes[0].start = 0.17;
    const song = loadSong(
      JSON.parse(JSON.stringify(audioReviewToSong("Notes", "fixture", r))),
    );
    const t = song.provenance!.audioReview!.noteTranscription!;
    expect(t.detected.notes[0].start).toBe(0.13);
    expect(t.notes[0].start).toBe(0.17);
    expect(t.notes[0].quantized!.startBeat).toBe(0.25);
    expect(song.measures[0].tab).toBeDefined();
    expect(song.measures[0].chords).toEqual([]);
    expect(compileTargets(song, 0.5).targets[0].time).toBeCloseTo(0.34);
    expect(practiceTimeline(song, 0.5).events[0].time).toBeCloseTo(0.34);
  });
  it("uses confirmed sounding pitch under capo and ignores the chosen string for scoring", () => {
    const r = reviewed(),
      t = r.noteTranscription!;
    t.options.capo = 2;
    t.notes = suggestFingerings(t.notes, t.options);
    t.notes.forEach((n) => {
      n.uncertain = false;
      n.confirmed = true;
    });
    const song = audioReviewToSong("Capo", "fixture", r);
    const plan = compileTargets(song),
      scorer = new EventScorer(plan.targets, "learn");
    expect(plan.targets[0].notes[0].midi).toBe(64);
    scorer.attack({
      id: 1,
      time: 0.13,
      resolvedAt: 0.23,
      midi: 64,
      cents: 0,
      confidence: 0.99,
    });
    expect(scorer.results[0]?.outcome).toBe("hit");
  });
  it("does not score drafts, uncertainties, overlaps or stale chart transformations", () => {
    const r = reviewed();
    r.noteTranscription!.notes[0].confirmed = false;
    let song = audioReviewToSong("Draft", "fixture", r);
    expect(compileTargets(song).targets[0].supported).toBe(false);
    expect(practiceTimeline(song, 1).events.map((n) => n.midi)).toEqual([67]);
    r.noteTranscription!.notes[1].start = 0.2;
    song = audioReviewToSong("Overlap", "fixture", r);
    expect(compileTargets(song).targets.every((t) => !t.supported)).toBe(true);
    song = audioReviewToSong("Edited", "fixture", reviewed());
    song.capo = 1;
    expect(compileTargets(song).targets.every((t) => !t.supported)).toBe(true);
    expect(practiceTimeline(song, 1).events).toHaveLength(0);
  });
  it("clips passage duration, excludes carried-in attacks, and loops exact events", () => {
    const song = audioReviewToSong("Passage", "fixture", reviewed());
    const plan = compileTargets(song, 0.5, 1, 1);
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].time).toBeCloseTo(0.34);
    expect(plan.duration).toBe(4);
    const timeline = practiceTimeline(song, 1, 1, 1),
      queue = new TimelineQueue(timeline, 10, true),
      times: number[] = [];
    queue.tick(
      10.15,
      (_, at) => times.push(at),
      () => {},
    );
    queue.tick(
      12.15,
      (_, at) => times.push(at),
      () => {},
    );
    expect(times).toEqual([10.17, 12.17]);
  });
  it("keeps unconfirmed timing blocked and rejects silent loss at quantization collisions", () => {
    const r = reviewed();
    r.reviewed.timingConfirmed = false;
    expect(
      compileTargets(audioReviewToSong("Timing", "fixture", r))
        .needsTimingConfirmation,
    ).toBe(true);
    r.noteTranscription!.notes[1].start = 0.14;
    r.noteTranscription!.notes[1].end = 0.3;
    expect(() => audioReviewToSong("Collision", "fixture", r)).toThrow(
      /same slot/,
    );
  });
  it("preserves deleted source notes and rejects malformed confirmed fingerings on reload", () => {
    const r = reviewed(),
      n = r.noteTranscription!.notes[0];
    n.deleted = true;
    n.confirmed = false;
    const song = audioReviewToSong("Deletion", "fixture", r);
    expect(
      song.provenance!.audioReview!.noteTranscription!.detected.notes,
    ).toHaveLength(2);
    expect(compileTargets(song).targets).toHaveLength(1);
    song.provenance!.audioReview!.noteTranscription!.notes[1].fingering!.fret = 22;
    expect(() => loadSong(song)).toThrow(/Fingering/);
  });
});


describe("persisted detector evidence integrity", () => {
  it.each(["duplicate raw id", "raw offset outside source", "frame outside source", "invalid frame order", "infinite hop", "reversed quantization"])("rejects %s without silently repairing evidence", (kind) => {
    const song = audioReviewToSong("Evidence", "fixture", reviewed());
    const t = song.provenance!.audioReview!.noteTranscription!;
    if (kind === "duplicate raw id") t.detected.notes[1].id = t.detected.notes[0].id;
    if (kind === "raw offset outside source") t.detected.notes[0].end = 5;
    if (kind === "frame outside source") t.detected.frames = [{time: 5, rms: 0, midi: null, cents: 0, confidence: 0, flatness: 0}];
    if (kind === "invalid frame order") t.detected.frames = [1, .5].map(time => ({time, rms: 0, midi: null, cents: 0, confidence: 0, flatness: 0}));
    if (kind === "infinite hop") t.detected.hopSeconds = Infinity;
    if (kind === "reversed quantization") t.notes[0].quantized = {startBeat: 2, endBeat: 1};
    expect(() => loadSong(song)).toThrow();
  });
});
