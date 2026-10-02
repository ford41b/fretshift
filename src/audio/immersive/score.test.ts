import { describe, expect, it } from "vitest";
import { newSong, newMeasure, emptySlot } from "../../schema/song.v1";
import {
  compileTargets,
  EventScorer,
  summarize,
  type Attack,
  type Target,
} from "./score";
const target = (time: number, midi = 64, id = String(time)): Target => ({
  id,
  time,
  measure: 0,
  label: "E4",
  kind: "note",
  supported: true,
  notes: [{ string: 0, fret: midi - 64, midi }],
});
const attack = (time: number, midi: number | null = 64, id = time): Attack => ({
  id,
  time,
  resolvedAt: time + 0.15,
  midi,
  cents: 0,
  confidence: midi === null ? 0 : 0.95,
});
describe("written targets", () => {
  it("respects sounding tuning/capo, offbeats, meter, tempo changes, holds and boundaries", () => {
    const s = newSong();
    s.capo = 2;
    s.tuningId = "drop-d";
    s.tempo = 60;
    const a = s.measures[0];
    a.tab!.slots[1][5] = 0;
    a.tab!.slots[2][5] = "hold";
    const b = newMeasure(1, 3);
    b.timeSignature = [3, 8];
    b.tempoOverride = 120;
    b.tab!.slots[1][0] = 3;
    s.measures.push(b);
    const p = compileTargets(s);
    expect(p.targets.map((t) => [t.time, t.notes[0].midi])).toEqual([
      [0.5, 40],
      [4.125, 69],
    ]);
    expect(p.duration).toBe(4.75);
    expect(compileTargets(s, 0.5, 1, 1).targets[0].time).toBe(0.25);
    expect(compileTargets(s, 1, 1, 1).targets[0].measure).toBe(1);
  });
  it("never creates an attack from a held note crossing a passage boundary", () => {
    const s = newSong();
    s.measures[0].tab!.slots[7][0] = 0;
    const b = newMeasure(1);
    b.tab!.slots[0][0] = "hold";
    s.measures.push(b);
    expect(compileTargets(s, 1, 1, 1).targets).toEqual([]);
  });
  it("groups simultaneous notes once, rejects chord/mute scoring and requires chord timing confirmation", () => {
    const s = newSong();
    s.measures[0].tab!.slots[0] = [0, 1, 0, 2, 3, null];
    s.measures[0].tab!.slots[1] = ["x", "x", "x", null, null, null];
    expect(compileTargets(s).targets.map((t) => [t.kind, t.supported])).toEqual(
      [
        ["chord", false],
        ["muted", false],
      ],
    );
    s.measures[0].tab = undefined;
    s.measures[0].chords = [{ id: "C", beat: 1.5, chordName: "C" }];
    const p = compileTargets(s);
    expect(p.targets).toHaveLength(1);
    expect(p.targets[0].time).toBe(0.75);
    expect(p.needsTimingConfirmation).toBe(true);
  });
  it("applies no second key transposition to already transformed frets", () => {
    const s = newSong();
    s.currentKey.root = "D";
    s.measures[0].tab!.slots[0][0] = 2;
    expect(compileTargets(s).targets[0].notes[0].midi).toBe(66);
  });
  it("restricts dense rhythms and unsupported note ranges", () => {
    const s = newSong();
    s.measures[0].tab!.slots = Array.from({ length: 8 }, emptySlot);
    s.measures[0].tab!.slots[0][0] = 0;
    s.measures[0].tab!.slots[1][0] = 1;
    expect(compileTargets(s).rhythmSupported).toBe(false);
    expect(compileTargets(s, 0.5).rhythmSupported).toBe(true);
  });
});
describe("one attack, at most one score", () => {
  it("scores an offbeat and separates pitch from early/late timing", () => {
    const r = new EventScorer([target(0.5), target(1.5)], "rhythm");
    r.attack(attack(0.39));
    r.attack(attack(1.61, 65));
    expect(r.results.map((r) => [r?.outcome, r?.timing])).toEqual([
      ["hit", "early"],
      ["wrong", "late"],
    ]);
  });
  it("uses attack time, not stable-identity time; applies the explicit offset", () => {
    const r = new EventScorer([target(1)], "rhythm", 50);
    r.attack({ ...attack(1.05), resolvedAt: 1.31 });
    expect(r.results[0]?.offsetMs).toBeCloseTo(0);
  });
  it("does not credit sustained/replayed attacks, wrong octaves, or extra attacks", () => {
    const r = new EventScorer([target(0), target(0.5), target(1)], "rhythm");
    r.attack(attack(0, 64, 1));
    r.attack(attack(0.5, 64, 1));
    r.attack(attack(1, 76, 2));
    r.attack(attack(2, 64, 3));
    r.tick(3);
    expect(r.results.map((r) => r?.outcome)).toEqual([
      "hit",
      "missed",
      "wrong",
    ]);
    expect(r.extraAttacks).toBe(1);
  });
  it("distinguishes silence, ambiguous input, wrong pitch and unsupported chords", () => {
    const chord = { ...target(2), kind: "chord" as const, supported: false };
    const r = new EventScorer([target(0), target(1), chord], "rhythm");
    r.attack(attack(1, null));
    r.attack(attack(2, 60));
    r.tick(3);
    expect(r.results.map((r) => r?.outcome)).toEqual([
      "missed",
      "uncertain",
      "unsupported",
    ]);
    const s = summarize(r.finish());
    expect(s.accuracy).toBe(0);
    expect(s.coverage).toBe(33);
  });
  it("rejects adjacent-event ambiguity instead of giving arbitrary credit", () => {
    const r = new EventScorer([target(1), target(1.4)], "rhythm");
    r.attack(attack(1.2));
    expect(r.results.map((r) => r?.outcome)).toEqual([
      "uncertain",
      "uncertain",
    ]);
  });
  it("learn waits for a fresh matching attack and skip awards no hit", () => {
    const r = new EventScorer([target(0), target(1), target(2)], "learn");
    r.attack(attack(7, 65, 1));
    expect(r.index).toBe(0);
    r.attack(attack(8, 64, 2));
    r.attack(attack(9, 64, 2));
    expect(r.index).toBe(1);
    r.skip();
    expect(r.results[1]?.outcome).toBe("skipped");
    r.attack(attack(10, 64, 3));
    expect(r.index).toBe(3);
    expect(r.results.every((r) => r?.timing === undefined)).toBe(true);
  });
  it("loop generations have no stale credit; incomplete attempts retain denominator", () => {
    const first = new EventScorer([target(0), target(1)], "learn");
    first.attack(attack(0));
    const next = new EventScorer([target(0), target(1)], "learn");
    expect(summarize(first.finish()).coverage).toBe(50);
    expect(summarize(next.finish()).accuracy).toBeNull();
  });
  it.each(["C", "Am", "Fmaj7"])(
    "never passes %s on a root, partial strum, wrong chord or complete signal",
    (name) => {
      const t = {
        ...target(0),
        label: name,
        kind: "chord" as const,
        supported: false,
      };
      for (const midi of [null, 48, 57, 65, 64]) {
        const r = new EventScorer([t], "learn");
        r.attack(attack(1, midi));
        expect(r.index).toBe(0);
        r.skip();
        expect(r.results[0]?.outcome).toBe("unsupported");
      }
    },
  );
});
it("a new note sounding over another held string is unsupported polyphony", () => {
  const s = newSong();
  s.measures[0].tab!.slots[0][0] = 0;
  s.measures[0].tab!.slots[1][0] = "hold";
  s.measures[0].tab!.slots[1][1] = 1;
  const p = compileTargets(s);
  expect(p.targets[1].kind).toBe("chord");
  expect(p.targets[1].supported).toBe(false);
  expect(p.targets[1].notes.map((n) => n.midi)).toEqual([64, 60]);
});
it("pause interrupts only the open event window without awarding missed or stale credit", () => {
  const r = new EventScorer([target(0), target(1), target(2)], "rhythm");
  r.attack(attack(0));
  r.interrupt(1.05);
  expect(r.results.map((r) => r?.outcome)).toEqual([
    "hit",
    "uncertain",
    undefined,
  ]);
  r.attack(attack(1.08, 64, 99));
  expect(r.results[1]?.outcome).toBe("uncertain");
  r.tick(3);
  expect(r.results[2]?.outcome).toBe("missed");
});
it("skipping invalidates an attack whose identity arrives after the skip", () => {
  const r = new EventScorer([target(0), target(1)], "learn");
  r.skip(2);
  r.attack({ ...attack(1.99), resolvedAt: 2.2 });
  expect(r.index).toBe(1);
  r.attack({ ...attack(2.3), resolvedAt: 2.45 });
  expect(r.index).toBe(2);
});
