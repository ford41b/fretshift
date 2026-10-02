import { describe, expect, it } from "vitest";
import { CHORD_WINDOW, chordPeaks, judgeChord } from "./chord";
import { strumSignal, voicingMidi } from "./fixtures";
import { compileTargets, EventScorer, type Attack } from "./score";
import { NoteRecognizer } from "./recognition";
import { createSamples } from "../../samples";
import { newSong } from "../../schema/song.v1";

/** Generated strums only: these pin behaviour, they are not accuracy evidence. */
const RATE = 48000;
const SHAPES: Record<string, string> = {
  C: "x32010", G: "320003", D: "xx0232", A: "x02220", E: "022100",
  Am: "x02210", Em: "022000", Dm: "xx0231", F: "133211", Fmaj7: "xx3210",
};
function judge(played: number[], target: string, offset = 0.13) {
  const signal = strumSignal(RATE, 1, played.length ? [{ at: 0.1, midis: played }] : []);
  const start = Math.round((0.1 + offset) * RATE);
  return judgeChord(chordPeaks(signal.subarray(start, start + CHORD_WINDOW), RATE), voicingMidi(SHAPES[target]));
}

describe("required-tone coverage chord judge (synthetic strums)", () => {
  it.each(Object.keys(SHAPES))("correct %s strum is a hit", (name) => {
    const j = judge(voicingMidi(SHAPES[name]), name);
    expect(j.missing).toEqual([]);
    expect(j.outcome).toBe("hit");
  });
  it.each([
    ["Am", "C"], ["C", "Am"], ["Em", "G"], ["Dm", "D"], ["D", "Dm"],
    ["E", "Em"], ["Em", "E"], ["Fmaj7", "F"], ["A", "Am"], ["G", "Em"],
  ])("%s played for %s is never a hit", (played, target) => {
    expect(judge(voicingMidi(SHAPES[played]), target).outcome).not.toBe("hit");
  });
  it("names the missing tone: C target, G omitted (strings 5–4 only)", () => {
    const j = judge([48, 52], "C");
    expect(j.missing).toEqual([7]);
    expect(j.outcome).not.toBe("hit");
  });
  it("root only is wrong: the root's harmonics cannot stand in for E or G", () => {
    const j = judge([48], "C");
    expect(j.present).toEqual([0]);
    expect(j.outcome).toBe("wrong");
  });
  it("a foreign low note ringing with the chord is flagged (open E under D)", () => {
    const j = judge([40, ...voicingMidi(SHAPES.D)], "D");
    expect(j.extraHz.length).toBeGreaterThan(0);
    expect(j.outcome).toBe("wrong");
  });
  it("silence and noise are uncertain or wrong, never hits", () => {
    expect(judge([], "C").outcome).toBe("uncertain");
    let seed = 3;
    const noise = Float32Array.from({ length: CHORD_WINDOW }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return ((seed >>> 0) / 2147483648 - 1) * 0.2;
    });
    expect(judgeChord(chordPeaks(noise, RATE), voicingMidi(SHAPES.C)).outcome).not.toBe("hit");
  });
});


describe("chord scoring stays behind its flag", () => {
  const chordSong = () => {
    const s = newSong();
    s.tempo = 60;
    // Open C voicing in tab: string index 0 is high E.
    const c = SHAPES.C;
    [...c].reverse().forEach((fret, string) => {
      if (fret !== "x") s.measures[0].tab!.slots[0][string] = Number(fret);
    });
    return s;
  };
  it("flag off: chords are unsupported; flag on: voiced chords become scorable", () => {
    expect(compileTargets(chordSong()).targets[0]).toMatchObject({ kind: "chord", supported: false });
    expect(compileTargets(chordSong(), 1, 0, 0, { chordScoring: true }).targets[0]).toMatchObject({
      kind: "chord",
      supported: true,
    });
    const amazing = createSamples().find((x) => x.id === "sample-1")!;
    expect(compileTargets(amazing).targets.every((t) => !t.supported)).toBe(true);
    const flagged = compileTargets(amazing, 1, 0, amazing.measures.length - 1, { chordScoring: true }).targets;
    expect(flagged.filter((t) => t.kind === "chord").every((t) => t.supported === t.notes.length > 1)).toBe(true);
  });
  const strumAttack = (played: number[], id: number): Attack => {
    const signal = strumSignal(RATE, 1, [{ at: 0.1, midis: played }]);
    const start = Math.round(0.23 * RATE);
    return {
      id,
      time: 0.1,
      resolvedAt: 0.4,
      midi: null,
      cents: 0,
      confidence: 0,
      peaks: chordPeaks(signal.subarray(start, start + CHORD_WINDOW), RATE),
    };
  };
  it("scorer: hit, wrong and uncertain stay distinct; only a hit advances Learn", () => {
    const { targets } = compileTargets(chordSong(), 1, 0, 0, { chordScoring: true });
    const learn = new EventScorer(targets, "learn");
    learn.attack(strumAttack(voicingMidi(SHAPES.Am), 1));
    expect(learn.index).toBe(0);
    expect(learn.feedback).toMatch(/^× Chord/);
    learn.attack({ ...strumAttack(voicingMidi(SHAPES.C), 2), peaks: undefined, time: 2, resolvedAt: 2.3 });
    expect(learn.feedback).toMatch(/^\? Chord uncertain/);
    learn.attack({ ...strumAttack(voicingMidi(SHAPES.C), 3), time: 3, resolvedAt: 3.3 });
    expect(learn.index).toBe(1);
    expect(learn.finish()[0].outcome).toBe("hit");
    const rhythm = new EventScorer(targets, "rhythm");
    rhythm.attack({ ...strumAttack([48], 4), time: 0.02 });
    expect(rhythm.finish()[0]).toMatchObject({ outcome: "wrong", timing: "on time" });
  });
  it("flag off: chord targets stay unsupported even with a perfect strum", () => {
    const { targets } = compileTargets(chordSong());
    const rhythm = new EventScorer(targets, "rhythm");
    rhythm.attack({ ...strumAttack(voicingMidi(SHAPES.C), 5), time: 0 });
    expect(rhythm.finish()[0].outcome).toBe("unsupported");
  });
  it("recognizer attaches chord evidence only when enabled", () => {
    const signal = strumSignal(RATE, 1.2, [{ at: 0.3, midis: voicingMidi(SHAPES.G) }]);
    const run = (chords: boolean) => {
      const r = new NoteRecognizer(RATE, 440, 0.003, chords);
      for (let i = 0; i + 1024 <= signal.length; i += 1024) {
        const e = r.process(signal.slice(i, i + 1024), (i + 1024) / RATE);
        if (e.attack) return e.attack;
      }
    };
    expect(run(false)?.peaks).toBeUndefined();
    const attack = run(true)!;
    expect(attack.peaks!.length).toBeGreaterThan(3);
    expect(judgeChord(attack.peaks!, voicingMidi(SHAPES.G)).outcome).toBe("hit");
  });
});

describe("onset detection with ringing strings", () => {
  it("beating between two ringing low strings is not a new attack", () => {
    // G2 + B2 beat at ~25 Hz, which swings single-packet RMS by ~1.7×.
    const signal = strumSignal(RATE, 3, [{ at: 0.5, midis: voicingMidi(SHAPES.G) }]);
    const r = new NoteRecognizer(RATE, 440, 0.003);
    const attacks: number[] = [];
    for (let i = 0; i + 1024 <= signal.length; i += 1024) {
      const e = r.process(signal.slice(i, i + 1024), (i + 1024) / RATE);
      if (e.attack) attacks.push(e.attack.time);
    }
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toBeCloseTo(0.49, 1);
  });
});
