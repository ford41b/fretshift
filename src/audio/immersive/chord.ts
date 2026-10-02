import { spectrum } from "../onset";

/**
 * Chord judgement by required-tone coverage. Behind the `chordScoring` release
 * flag (off) until the harness meets CHORD_THRESHOLDS on real recordings.
 *
 * Unlike chroma similarity, every pitch class written in the voicing must be
 * heard at one of the octaves the voicing places it (fundamental, or its
 * octave when that is not a harmonic of another chord note). Harmonics of the
 * expected notes are attributed to them, so C's third harmonic cannot stand in
 * for a missing G. A strong unexplained note with its own harmonic is evidence
 * of a wrong note. Anything between a clear hit and clear wrong is
 * "uncertain". Per-string correctness and strum completeness beyond pitch
 * classes are not assessed.
 */
export type Peak = { hz: number; magnitude: number };
export type ChordOutcome = "hit" | "wrong" | "uncertain";
export type ChordJudgement = {
  outcome: ChordOutcome;
  required: number[];
  present: number[];
  missing: number[];
  /** Strong unexplained fundamentals (Hz) with harmonic support. */
  extraHz: number[];
  coverage: number;
  explained: number;
  reason: string;
};

export const CHORD_WINDOW = 8192;
const CENTS = 40;
const HARMONICS = 8;
const MIN_HZ = 70;
const MAX_HZ = 2100;
const PRESENT_DB = -30;
const EXTRA_RATIO = 0.25;
const HIT_EXPLAINED = 0.7;

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);
const near = (a: number, b: number) => Math.abs(cents(a, b)) <= CENTS;
const hz = (midi: number, a4: number) => a4 * 2 ** ((midi - 69) / 12);

/** Spectral peaks from a Hann-windowed FFT, interpolated, 70–2100 Hz. */
export function chordPeaks(samples: Float32Array, rate: number, limit = 60): Peak[] {
  const rms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
  if (rms < 0.004) return [];
  const mag = spectrum(samples),
    bin = rate / samples.length;
  const lo = Math.max(2, Math.floor(MIN_HZ / bin)),
    hi = Math.min(mag.length - 2, Math.ceil(MAX_HZ / bin));
  const band = Array.from(mag.subarray(lo, hi)).sort((a, b) => a - b);
  const floor = band[band.length >> 1] || 1e-12,
    top = band[band.length - 1] || 0;
  const peaks: Peak[] = [];
  for (let i = lo; i < hi; i++) {
    const m = mag[i];
    if (m <= mag[i - 1] || m < mag[i + 1] || m < floor * 6 || m < top * 0.003) continue;
    const a = Math.log(mag[i - 1] + 1e-12),
      b = Math.log(m + 1e-12),
      c = Math.log(mag[i + 1] + 1e-12),
      shift = (a - c) / (2 * (a - 2 * b + c) || 1);
    peaks.push({ hz: (i + Math.max(-0.5, Math.min(0.5, shift))) * bin, magnitude: m });
  }
  return peaks.sort((x, y) => y.magnitude - x.magnitude).slice(0, limit);
}

export function judgeChord(peaks: Peak[], expectedMidi: number[], a4 = 440): ChordJudgement {
  const notes = [...new Set(expectedMidi)].sort((a, b) => a - b);
  const required = [...new Set(notes.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b);
  const base = { required, present: [] as number[], missing: required, extraHz: [] as number[], coverage: 0, explained: 0 };
  if (peaks.length < 2 || required.length < 2)
    return { ...base, outcome: "uncertain", reason: "Not enough tonal evidence. Strum all strings clearly." };
  const freqs = notes.map((m) => ({ midi: m, pc: ((m % 12) + 12) % 12, f0: hz(m, a4) }));
  const strongest = peaks[0].magnitude;
  const at = (f: number) => peaks.find((p) => near(p.hz, f));
  // A frequency is ambiguous for pitch class `pc` if a different chord tone has a harmonic there.
  const harmonicOfOther = (f: number, pc: number) =>
    freqs.some((n) => n.pc !== pc && Array.from({ length: HARMONICS - 1 }, (_, h) => (h + 2) * n.f0).some((x) => near(f, x)));
  const presence = new Set<number>();
  for (const n of freqs) {
    for (const f of [n.f0, 2 * n.f0]) {
      const p = at(f);
      if (!p || 20 * Math.log10(p.magnitude / strongest) < PRESENT_DB) continue;
      if (harmonicOfOther(f, n.pc)) continue;
      presence.add(n.pc);
    }
  }
  const present = required.filter((pc) => presence.has(pc)),
    missing = required.filter((pc) => !presence.has(pc)),
    coverage = present.length / required.length;
  // Energy attribution: harmonics of written notes, or chord tones in another octave.
  const explainedBy = (p: Peak) => {
    if (freqs.some((n) => Array.from({ length: HARMONICS }, (_, h) => (h + 1) * n.f0).some((x) => near(p.hz, x)))) return true;
    const midi = 69 + 12 * Math.log2(p.hz / a4),
      rounded = Math.round(midi);
    return Math.abs(midi - rounded) * 100 <= CENTS && required.includes(((rounded % 12) + 12) % 12);
  };
  let total = 0,
    explainedEnergy = 0;
  const unexplained: Peak[] = [];
  for (const p of peaks) {
    const e = p.magnitude ** 2;
    total += e;
    if (explainedBy(p)) explainedEnergy += e;
    else unexplained.push(p);
  }
  const explained = total ? explainedEnergy / total : 0;
  // A wrong note shows a strong fundamental plus its own 2nd or 3rd harmonic; body resonances do not.
  const extraHz = unexplained
    .filter((p) => p.hz <= 700 && p.magnitude >= EXTRA_RATIO * strongest && (at(2 * p.hz) || at(3 * p.hz)))
    .map((p) => Math.round(p.hz * 10) / 10);
  const result = { required, present, missing, extraHz, coverage, explained };
  if (coverage === 1 && !extraHz.length && explained >= HIT_EXPLAINED)
    return { ...result, outcome: "hit", reason: "Every written chord tone was heard." };
  if (coverage < 0.5 || extraHz.length)
    return {
      ...result,
      outcome: "wrong",
      reason: extraHz.length ? "A note outside this chord rang clearly." : "Most written chord tones were not heard.",
    };
  return { ...result, outcome: "uncertain", reason: "Some chord tones were unclear. Strum again, letting every string ring." };
}
