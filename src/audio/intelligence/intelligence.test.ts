import { describe, expect, it } from "vitest";
import { SongV1 } from "../../schema/song.v1";
import { LocalAnalysisOrchestrator, reviewedAnalysisToSong } from "./index";
import { manifest, renderFixture } from "../../../test-fixtures/audio-intelligence/fixtures.mjs";

function fixture(id: string) {
  const definition = manifest.cases.find((item: { id: string }) => item.id === id);
  if (!definition) throw new Error(`Missing fixture ${id}`);
  return renderFixture(definition);
}

describe("Audio Intelligence local baseline", () => {
  it("returns a provisional pulse, chord regions, and unconfirmed measures", async () => {
    const result = await new LocalAnalysisOrchestrator().analyze(fixture("acoustic-simple"));
    expect(result.beats.tempoBpm).toBeGreaterThan(110);
    expect(result.beats.tempoBpm).toBeLessThan(130);
    expect(result.beats.beats.length).toBeGreaterThan(8);
    expect(result.chords.segments.some((segment) => segment.label === "C")).toBe(true);
    expect(result.measures.length).toBeGreaterThan(0);
    expect(result.measures.every((measure) => measure.timingConfirmed === false)).toBe(true);
    expect(result.notes).toBeNull();
  });

  it("preserves uncertainty and the extended chord vocabulary", async () => {
    const analyzer = new LocalAnalysisOrchestrator();
    const result = await analyzer.analyze(fixture("extended-chords"));
    for (const label of ["Cadd9", "Fmaj7", "Bm7b5"])
      expect(result.chords.vocabulary).toContain(label);
    expect(result.chords.segments.some((segment) => segment.status === "ambiguous" &&
      segment.label === null && segment.alternatives.length > 0)).toBe(true);
  });

  it("does not invent beats or chords for silence/noise or chords for a single-note melody", async () => {
    const analyzer = new LocalAnalysisOrchestrator();
    for (const id of ["silence", "noise"]) {
      const result = await analyzer.analyze(fixture(id));
      expect(result.beats.status).toBe("insufficient-evidence");
      expect(result.chords.segments.some((segment) => segment.label)).toBe(false);
    }
    const melody = await analyzer.analyze(fixture("single-note-melody"));
    expect(melody.chords.segments.some((segment) => segment.label)).toBe(false);
  });

  it("makes a schema-valid reviewed draft without simplifying extensions", () => {
    const song = reviewedAnalysisToSong({
      title: "Reviewed progression", tempoBpm: 120,
      beatTimes: Array.from({ length: 12 }, (_, i) => i * 0.5),
      firstDownbeatIndex: 0, meter: 4, timingConfirmed: false,
      providerId: "test-reviewed-provider",
      chords: [
        { start: 0, label: "Cadd9" },
        { start: 2, label: "Fmaj7" },
        { start: 4, label: "Bm7b5" },
      ],
    });
    expect(SongV1.safeParse(song).success).toBe(true);
    expect(song.measures.map((measure) => measure.chords[0]?.chordName))
      .toEqual(["Cadd9", "Fmaj7", "Bm7b5"]);
    expect(song.provenance?.timingNeedsConfirmation).toBe(true);
    expect(song.measures.every((measure) => measure.timingConfirmed === false)).toBe(true);
  });

  it("rejects unsupported labels and unreviewed timing inputs", () => {
    const base = { title: "Check", tempoBpm: 120, beatTimes: [0, 0.5, 1, 1.5],
      firstDownbeatIndex: 0, meter: 4 as const, timingConfirmed: false,
      providerId: "test" };
    expect(() => reviewedAnalysisToSong({ ...base,
      chords: [{ start: 0, label: "Cnot-a-chord" }] })).toThrow();
    expect(() => reviewedAnalysisToSong({ ...base, firstDownbeatIndex: -1,
      chords: [{ start: 0, label: "C" }] })).toThrow(/downbeat/);
    const offbeat = reviewedAnalysisToSong({ ...base,
      chords: [{ start: 0.3, label: "C" }] });
    expect(offbeat.measures[0].chords[0].audioTimeSeconds).toBe(.3);
    expect(() => reviewedAnalysisToSong({ ...base,
      chords: [{ start: 3.8, label: "C" }] })).toThrow(/beyond the reviewed beat grid/);
  });
});
