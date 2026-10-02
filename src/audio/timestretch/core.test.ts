import { expect, it } from "vitest";
import { renderReference, stretchSamples } from "./core";
import { yin } from "../pitch";
it("prepares exact-duration audio with preserved pitch and no startup buffering gap", () => {
  const sr = 44100,
    source = Float32Array.from(
      { length: sr * 2 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr),
    );
  for (const rate of [0.5, 0.75, 1, 1.5, 2]) {
    const [out] = stretchSamples([source], sr, rate);
    expect(out.length).toBe(Math.ceil(source.length / rate));
    expect(out.findIndex((v) => Math.abs(v) > 0.01) / sr).toBeLessThan(0.002);
    const hz = yin(out.slice(sr * 0.25, sr * 0.25 + 4096), sr)!;
    expect(Math.abs(1200 * Math.log2(hz / 220))).toBeLessThan(10);
    expect(out.slice(-1024).some((v) => Math.abs(v) > 0.05)).toBe(true);
  }
});
it("bounds WSOLA transient displacement and flushes the trailing sound", () => {
  const sr = 44100,
    input = Float32Array.from({ length: sr * 3 }, (_, i) =>
      i > sr * 0.5 && i < sr * 2.5
        ? 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr)
        : 0,
    );
  for (const rate of [0.5, 0.75, 1, 1.5, 2]) {
    const [out] = stretchSamples([input], sr, rate);
    const first = out.findIndex((v) => Math.abs(v) > 0.05);
    let last = out.length - 1;
    while (last >= 0 && Math.abs(out[last]) <= 0.05) last--;
    expect(Math.abs(first / sr - 0.5 / rate)).toBeLessThan(0.06);
    expect(Math.abs(last / sr - 2.5 / rate)).toBeLessThan(0.06);
  }
});
it("aligns negative offsets as leading silence and honors piecewise tempo", () => {
  const sr = 8000,
    input = new Float32Array(sr * 2).fill(0.2);
  const [out] = renderReference([input], sr, [
    { offset: -0.5, sourceDuration: 1, rate: 1 },
    { offset: 0.5, sourceDuration: 1, rate: 2 },
  ]);
  expect(out.length).toBe(sr * 1.5);
  expect(out.slice(0, sr * 0.5).every((x) => x === 0)).toBe(true);
  expect(out[sr * 0.5]).toBeCloseTo(0.2);
  expect(() =>
    renderReference([input], sr, [{ offset: 0, sourceDuration: 1, rate: 30 }]),
  ).toThrow();
  expect(() =>
    renderReference([input], sr, [{ offset: 1.5, sourceDuration: 1, rate: 1 }]),
  ).toThrow(/ends before/);
});
