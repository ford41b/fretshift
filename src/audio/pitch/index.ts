import { z } from "zod";
import { midiFromFrequency, noteLabel } from "../../theory/pitch";
export const PitchSchema = z.object({
  frequency: z.number(),
  midi: z.number().int(),
  cents: z.number(),
  note: z.string(),
  state: z.enum(["no signal", "detecting", "flat", "in tune", "sharp"]),
});
export type Pitch = z.infer<typeof PitchSchema>;
export function yin(
  samples: Float32Array,
  sampleRate: number,
  threshold = 0.1,
): number | null {
  let energy = 0;
  for (const s of samples) energy += s * s;
  if (Math.sqrt(energy / samples.length) < 0.007) return null;
  const half = Math.floor(samples.length / 2),
    max = Math.min(half - 1, Math.ceil(sampleRate / 55)),
    min = Math.max(2, Math.floor(sampleRate / 1500));
  const difference = new Float64Array(max + 2);
  for (let tau = 1; tau <= max + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < half; i++) {
      const d = samples[i] - samples[i + tau];
      sum += d * d;
    }
    difference[tau] = sum;
  }
  let cumulative = 0;
  const normalized = new Float64Array(max + 2);
  normalized[0] = 1;
  for (let tau = 1; tau <= max + 1; tau++) {
    cumulative += difference[tau];
    normalized[tau] = cumulative ? (difference[tau] * tau) / cumulative : 1;
  }
  for (let tau = min; tau < max; tau++) {
    if (normalized[tau] < threshold) {
      while (tau + 1 < max && normalized[tau + 1] < normalized[tau]) tau++;
      const prev = normalized[tau - 1],
        cur = normalized[tau],
        next = normalized[tau + 1];
      const denom = 2 * (2 * cur - next - prev);
      const refined = tau + (denom ? (next - prev) / denom : 0);
      return sampleRate / refined;
    }
  }
  return null;
}
export const silence: Pitch = {
  frequency: 0,
  midi: 0,
  cents: 0,
  note: "—",
  state: "no signal",
};
export class TunerState {
  private last = -1;
  private frames = 0;
  update(hz: number | null, a4 = 440): Pitch {
    if (!hz) {
      this.last = -1;
      this.frames = 0;
      return { ...silence };
    }
    const exact = midiFromFrequency(hz, a4),
      midi = Math.round(exact),
      cents = (exact - midi) * 100;
    this.frames = midi === this.last ? this.frames + 1 : 1;
    this.last = midi;
    return {
      frequency: hz,
      midi,
      cents,
      note: noteLabel(midi),
      state:
        this.frames < 3
          ? "detecting"
          : Math.abs(cents) <= 5
            ? "in tune"
            : cents < 0
              ? "flat"
              : "sharp",
    };
  }
}
