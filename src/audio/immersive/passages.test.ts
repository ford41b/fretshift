import { describe, expect, it } from "vitest";
import { newMeasure, newSong } from "../../schema/song.v1";
import { createSamples } from "../../samples";
import { compileTargets, scorablePassages } from "./score";
import { canOpenImmersive, IMMERSIVE_BETA, IMMERSIVE_FEATURES, scoringEnabledFor } from "./release";

/** Ordinary-song scoring reuses compileTargets; these checks pin the passage rules. */
describe("scorable single-note passages on ordinary songs", () => {
  it("groups single-note measures and stops at chords, muted strings and holds under new notes", () => {
    const s = newSong();
    s.measures = [0, 1, 2, 3, 4, 5].map((i) => newMeasure(i));
    s.measures[0].tab!.slots[0][1] = 1; // C4: single note
    s.measures[1].tab!.slots[0][2] = 2; // A3
    // measure 2: rest only
    s.measures[3].tab!.slots[0][0] = 0; // E4
    s.measures[4].tab!.slots[0][0] = 0; // chord: E4 + B3
    s.measures[4].tab!.slots[0][1] = 0;
    s.measures[5].tab!.slots[0][5] = 0; // E2 held while a new note sounds → polyphonic
    s.measures[5].tab!.slots[1][5] = "hold";
    s.measures[5].tab!.slots[1][0] = 3;
    expect(scorablePassages(s)).toEqual([{ first: 0, last: 3, notes: 3 }]);
    const chordPassage = compileTargets(s, 1, 4, 5).targets;
    expect(chordPassage.map((t) => [t.kind, t.supported])).toEqual([
      ["chord", false],
      ["note", true],
      ["chord", false],
    ]);
  });
  it("every passage it offers compiles to supported single notes only", () => {
    const s = newSong();
    s.measures = [0, 1, 2].map((i) => newMeasure(i));
    s.measures[0].tab!.slots[0][0] = 0;
    s.measures[0].tab!.slots[0][1] = 1; // chord
    s.measures[1].tab!.slots[0][3] = 2;
    s.measures[1].tab!.slots[4][2] = 2;
    s.measures[2].tab!.slots[0][4] = 3;
    const [p] = scorablePassages(s);
    expect(p).toEqual({ first: 1, last: 2, notes: 3 });
    const { targets } = compileTargets(s, 0.5, p.first, p.last);
    expect(targets.every((t) => t.kind === "note" && t.supported)).toBe(true);
  });
  it("muted-string targets block scoring: the arpeggiated sample opens every measure with an x", () => {
    const rising = createSamples().find((x) => x.id === "sample-2")!;
    const whole = compileTargets(rising, 1, 0, rising.measures.length - 1).targets;
    expect(whole.filter((t) => t.kind === "muted").length).toBeGreaterThan(0);
    expect(scorablePassages(rising)).toEqual([]);
    // Imported ChordPro timing still needs review before Rhythm.
    expect(compileTargets(rising, 1, 0, 0).needsTimingConfirmation).toBe(true);
  });
  it("a chord-only chart has no scorable passage", () => {
    const amazing = createSamples().find((x) => x.id === "sample-1")!;
    expect(scorablePassages(amazing)).toEqual([]);
  });
});

describe("criteria-based release flags", () => {
  it("opens the room for every song, scores single notes, keeps chords off without physical evidence", () => {
    expect(IMMERSIVE_FEATURES.room.enabled).toBe(true);
    expect(canOpenImmersive(false)).toBe(true);
    expect(scoringEnabledFor(newSong())).toBe(true);
    expect(IMMERSIVE_FEATURES.latencyCalibration.enabled).toBe(true);
    expect(IMMERSIVE_FEATURES.chordScoring.enabled).toBe(false);
    expect(IMMERSIVE_FEATURES.chordScoring.why).toMatch(/real labeled recordings/);
  });
  it("keeps the beta badge until the physical checklist is recorded", () => {
    expect(IMMERSIVE_BETA).toBe(true);
  });
  it("every criterion names its evidence kind; no physical criterion is met yet", () => {
    for (const f of Object.values(IMMERSIVE_FEATURES))
      for (const c of f.criteria) {
        expect(["synthetic", "local", "emulated", "physical"]).toContain(c.evidence);
        if (c.evidence === "physical") expect(c.met).toBe(false);
      }
  });
});
