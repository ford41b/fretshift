import { expect, it } from "vitest";
import { NoteRecognizer, identify } from "./recognition";
import { pluckedSignal } from "./fixtures";
import type { Attack } from "./score";
function recognize(samples: Float32Array, rate = 48000) {
  const detector = new NoteRecognizer(rate);
  const attacks: Attack[] = [];
  let unhealthy = false;
  for (let i = 0; i + 1024 <= samples.length; i += 1024) {
    const e = detector.process(samples.slice(i, i + 1024), (i + 1024) / rate);
    if (e.attack) attacks.push(e.attack);
    unhealthy ||= e.unhealthy;
  }
  return { attacks, unhealthy };
}
it("silence and low-level noise have no attacks; high noise is unusable", () => {
  expect(recognize(new Float32Array(96000)).attacks).toHaveLength(0);
  expect(recognize(pluckedSignal(48000, 2, [], 0.003)).attacks).toHaveLength(0);
  const noisy = recognize(pluckedSignal(48000, 2, [], 0.15));
  expect(noisy.unhealthy).toBe(true);
  expect(noisy.attacks.every((a) => a.midi === null)).toBe(true);
});
it("guitar-like plucks: measures fixture detection delay and omissions, without octave folding", () => {
  const rows = [];
  for (const rate of [44100, 48000])
    for (const midi of [40, 45, 50, 55, 59, 64, 69, 76, 88]) {
      const { attacks } = recognize(
        pluckedSignal(rate, 0.8, [{ at: 0.1, midi }], 0.001),
        rate,
      );
      const match = attacks.find((a) => a.midi === midi);
      rows.push({
        rate,
        midi,
        attacks: attacks.length,
        match: !!match,
        delay: match ? (match.resolvedAt - 0.1) * 1000 : null,
      });
      expect(
        attacks.filter((a) => a.midi !== null).map((a) => a.midi),
        JSON.stringify(rows.at(-1)),
      ).toEqual([midi]);
    }
  console.log(
    "Synthetic pluck benchmark (not real guitar)",
    JSON.stringify(rows),
  );
});
it("sustain produces one attack; rearticulation and note transitions produce distinct attacks", () => {
  expect(
    recognize(pluckedSignal(48000, 2, [{ at: 0.1, midi: 64, decay: 2 }]))
      .attacks,
  ).toHaveLength(1);
  const repeat = recognize(
    pluckedSignal(48000, 2, [
      { at: 0.1, midi: 64 },
      { at: 0.8, midi: 64 },
      { at: 1.4, midi: 67 },
    ]),
  );
  expect(repeat.attacks.map((a) => a.midi)).toEqual([64, 64, 67]);
});
it("octave confusion is not repaired by reference to a target", () => {
  const samples = pluckedSignal(48000, 0.3, [{ at: 0, midi: 76 }]).slice(
    4096,
    8192,
  );
  expect(identify(samples, 48000).midi).toBe(76);
});
it("polyphonic C, Am, Fmaj7 and partial strums are never advertised as chord recognition", () => {
  for (const pitches of [
    [48, 52, 55, 60, 64],
    [45, 52, 57, 60, 64],
    [41, 48, 52, 57, 60, 64],
    [48, 52],
  ]) {
    const signal = pluckedSignal(
      48000,
      0.8,
      pitches.map((midi, i) => ({
        at: 0.1 + i * 0.009,
        midi,
        amplitude: 0.08,
      })),
    );
    const result = recognize(signal);
    // Unknown is preferable. This test documents monophonic fallback, not chord accuracy.
    expect(result.attacks.every((a) => a.midi === null)).toBe(true);
  }
});
it("resetting analysis during a sustained sound cannot invent a new attack", () => {
  const samples = pluckedSignal(48000, 2, [{ at: 0, midi: 64, decay: 3 }]);
  expect(recognize(samples.slice(24000)).attacks).toHaveLength(0);
});
it("reports analysis cost for the reused YIN/FFT baseline", () => {
  const samples = pluckedSignal(48000, 0.5, [{ at: 0, midi: 40 }]).slice(
    4096,
    8192,
  );
  const ms = [];
  for (let i = 0; i < 100; i++) {
    const t = performance.now();
    identify(samples, 48000);
    ms.push(performance.now() - t);
  }
  ms.sort((a, b) => a - b);
  console.log(
    "YIN + harmonic evidence CPU milliseconds",
    JSON.stringify({
      median: ms[50],
      p95: ms[95],
      hopMs: (1024 / 48000) * 1000,
    }),
  );
});
it("sustained polyphony stays unknown without masquerading as a disconnected/noisy microphone", () => {
  const signal = pluckedSignal(
    48000,
    2,
    [48, 52, 55, 60, 64].map((midi) => ({
      at: 0.1,
      midi,
      amplitude: 0.08,
      decay: 2,
    })),
  );
  expect(recognize(signal).unhealthy).toBe(false);
});
