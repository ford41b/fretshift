import { describe, it, expect } from "vitest";
import { yin, TunerState } from "./pitch";
import { frequencyOf } from "../theory/pitch";
import { LookaheadScheduler } from "./metronome/scheduler";
import {
  OnsetDetector,
  chroma,
  fingerprintMatch,
  timingOffset,
  timingScore,
} from "./onset";
import { isCleanPass, advanceRamp, aggregateHeat } from "./practice";
import { compilePlayback } from "./playback";
import { newSong, BUILT_IN_TUNINGS } from "../schema/song.v1";
import { curated } from "../theory/voicingSearch";
const sine = (hz: number, rate = 44100, n = 4096) =>
  Float32Array.from(
    { length: n },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate),
  );
describe("real signal processing", () => {
  it("YIN identifies every semitone E2–E6 at 0/±10/±40 cents", () => {
    for (let midi = 40; midi <= 88; midi++)
      for (const cents of [0, 10, -10, 40, -40]) {
        const hz = frequencyOf(midi) * 2 ** (cents / 1200);
        const detected = yin(sine(hz), 44100);
        expect(detected, `${midi} / ${cents}`).not.toBeNull();
        expect(Math.abs(1200 * Math.log2(detected! / hz))).toBeLessThan(4);
      }
  });
  it("requires three stable frames and resets on silence", () => {
    const t = new TunerState();
    expect(t.update(110).state).toBe("detecting");
    expect(t.update(110).state).toBe("detecting");
    expect(t.update(110).state).toBe("in tune");
    expect(t.update(110 * 2 ** (-10 / 1200)).state).toBe("flat");
    expect(t.update(110 * 2 ** (40 / 1200)).state).toBe("sharp");
    expect(t.update(null).state).toBe("no signal");
    expect(yin(new Float32Array(4096), 44100)).toBeNull();
  });
  it("detects synthetic click onsets and timing direction", () => {
    const detector = new OnsetDetector();
    const silence = new Float32Array(4096);
    detector.process(silence, 0);
    const click = Float32Array.from({ length: 4096 }, (_, i) =>
      i > 1800 && i < 2300
        ? Math.sin(i * 7.34) * Math.exp(-(i - 1800) / 100)
        : 0,
    );
    expect(detector.process(click, 0.5).onset).toBe(true);
    expect(detector.process(silence, 0.6).onset).toBe(false);
    expect(timingOffset(0.47, 0, 120)).toBeCloseTo(-30);
    expect(timingOffset(0.54, 0, 120)).toBeCloseTo(40);
    expect(timingScore([0, 0, 0])).toBe(100);
  });
  it("discriminates the two known synthetic G and D voicings", () => {
    const t = BUILT_IN_TUNINGS[0];
    const pitches = (name: string) =>
      curated[name].flatMap((f, i) =>
        typeof f === "number" ? [t.midi[i] + f] : [],
      );
    const a = pitches("G"),
      b = pitches("D");
    const render = (notes: number[]) =>
      Float32Array.from(
        { length: 8192 },
        (_, i) =>
          notes.reduce(
            (sum, m) =>
              sum + Math.sin((2 * Math.PI * frequencyOf(m) * i) / 44100),
            0,
          ) / notes.length,
      );
    expect(fingerprintMatch(chroma(render(a), 44100), a, b).match).toBe("A");
    expect(fingerprintMatch(chroma(render(b), 44100), a, b).match).toBe("B");
  });
});
it("audio-clock scheduler has less than 1ms drift over five minutes", () => {
  const scheduler = new LookaheadScheduler(60 / 123);
  scheduler.start(1);
  const timestamps: number[] = [];
  for (
    let now = 1;
    now < 301;
    now += 0.017 + (Math.round(now * 100) % 3) * 0.009
  )
    scheduler.tick(now, (t) => timestamps.push(t));
  expect(timestamps.length).toBeGreaterThan(600);
  expect(
    Math.max(...timestamps.map((t, i) => Math.abs(t - (1 + (i * 60) / 123)))),
  ).toBeLessThan(0.001);
});
it("clean-pass ramp requires evidence and heat is separate from Song", () => {
  const song = newSong(),
    original = structuredClone(song);
  expect(
    isCleanPass({
      stopped: false,
      rewound: false,
      onsetOffsets: [],
      monophonic: false,
    }),
  ).toBe(false);
  expect(
    isCleanPass({
      stopped: false,
      rewound: false,
      onsetOffsets: [10, -20],
      monophonic: true,
      pitchAccuracy: 0.95,
    }),
  ).toBe(true);
  expect(
    isCleanPass({
      stopped: false,
      rewound: true,
      onsetOffsets: [0],
      monophonic: false,
    }),
  ).toBe(false);
  expect(advanceRamp(90, 5, 100, false)).toBe(90);
  expect(advanceRamp(98, 5, 100, true)).toBe(100);
  expect(aggregateHeat(0, { marked: true, stops: 1 })).toBe(37);
  expect(song).toEqual(original);
});
it("playback sustains holds and uses denominator-correct beat durations", () => {
  const song = newSong();
  song.tempo = 120;
  song.timeSignature = [6, 8];
  song.measures[0].tab = {
    slots: Array.from({ length: 12 }, () => [
      null,
      null,
      null,
      null,
      null,
      null,
    ]),
  };
  song.measures[0].tab.slots[0][5] = 0;
  song.measures[0].tab.slots[1][5] = "hold";
  const compiled = compilePlayback(song);
  expect(compiled.duration).toBe(1.5);
  expect(compiled.events[0].duration).toBe(0.25);
  expect(compiled.events[0].midi).toBe(40);
});
