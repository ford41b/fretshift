import { yin } from "../pitch";
import { spectrum } from "../onset";
import type { Attack } from "./score";
import { CHORD_WINDOW, chordPeaks } from "./chord";

export type Evidence = {
  time: number;
  rms: number;
  midi: number | null;
  cents: number;
  confidence: number;
  unhealthy: boolean;
  attack?: Attack;
};
/** Conservative monophonic evidence. No expected pitch is supplied to this classifier. */
export function identify(samples: Float32Array, rate: number, a4 = 440) {
  const hz = yin(samples, rate);
  const spec = spectrum(samples);
  let noisePower = 0,
    logPower = 0,
    bins = 0;
  for (let i = 1; i < spec.length; i++) {
    const f = (i * rate) / samples.length;
    if (f < 80 || f > 5000) continue;
    const power = spec[i] ** 2 + 1e-15;
    noisePower += power;
    logPower += Math.log(power);
    bins++;
  }
  const flatness = Math.exp(logPower / bins) / (noisePower / bins);
  if (!hz) return { midi: null, cents: 0, confidence: 0, flatness };
  const exact = 69 + 12 * Math.log2(hz / a4),
    midi = Math.round(exact);
  let total = 0,
    harmonic = 0;
  for (let i = 1; i < spec.length; i++) {
    const f = (i * rate) / samples.length;
    if (f < 65 || f > 5000) continue;
    const power = spec[i] ** 2;
    total += power;
    const nearest = Math.round(f / hz);
    if (
      nearest >= 1 &&
      Math.abs(f - nearest * hz) < (rate / samples.length) * 1.6
    )
      harmonic += power;
  }
  const purity = total ? harmonic / total : 0;
  // Do not fold octaves toward the expected score; report the measured absolute pitch.
  return {
    midi: midi >= 40 && midi <= 88 && purity >= 0.88 ? midi : null,
    cents: (exact - midi) * 100,
    confidence: purity >= 0.88 ? purity : 0,
    flatness,
  };
}
export class NoteRecognizer {
  private window = new Float32Array(4096);
  private filled = 0;
  /** RMS of the last two packets: beating between ringing strings swings one packet's RMS. */
  private previousRms = [0, 0];
  private lastAttack = -Infinity;
  private id = 0;
  private badSince: number | null = null;
  private pending: {
    id: number;
    time: number;
    midi: number | null;
    frames: number;
    confidence: number;
    cents: number;
  } | null = null;
  /** Longer window for chord evidence; allocated only when chord scoring is enabled. */
  private long: Float32Array | null;
  constructor(
    private rate: number,
    private a4 = 440,
    private floor = 0.007,
    chords = false,
  ) {
    this.long = chords ? new Float32Array(CHORD_WINDOW) : null;
  }
  process(samples: Float32Array, time: number): Evidence {
    this.window.copyWithin(0, samples.length);
    this.window.set(samples, this.window.length - samples.length);
    if (this.long) {
      this.long.copyWithin(0, samples.length);
      this.long.set(samples, this.long.length - samples.length);
    }
    this.filled += samples.length;
    const rms = Math.sqrt(
      samples.reduce((sum, s) => sum + s * s, 0) / samples.length,
    );
    const threshold = Math.max(0.009, this.floor * 2.8);
    const rising =
      rms > threshold && rms > Math.max(threshold, Math.max(...this.previousRms) * 1.65);
    if (
      this.filled >= this.window.length &&
      rising &&
      time - this.lastAttack >= 0.24 &&
      !this.pending
    ) {
      // Timestamp the first energetic capture block, not the later stable-pitch frame.
      this.pending = {
        id: ++this.id,
        time: time - samples.length / this.rate,
        midi: null,
        frames: 0,
        confidence: 0,
        cents: 0,
      };
      this.lastAttack = time;
    }
    this.previousRms = [this.previousRms[1], rms];
    const pitch =
      this.filled >= this.window.length && rms > this.floor
        ? identify(this.window, this.rate, this.a4)
        : { midi: null, cents: 0, confidence: 0, flatness: 0 };
    // Polyphony is not a failed microphone. Broad-spectrum noise is a separate health signal.
    const bad = rms > 0.75 || (rms > 0.04 && pitch.flatness > 0.3);
    this.badSince = bad ? (this.badSince ?? time) : null;
    const result: Evidence = {
      time,
      rms,
      ...pitch,
      unhealthy: this.badSince !== null && time - this.badSince > 0.25,
    };
    if (this.pending) {
      const p = this.pending;
      if (time - p.time >= this.window.length / this.rate) {
        p.frames =
          pitch.midi !== null && pitch.midi === p.midi
            ? p.frames + 1
            : pitch.midi !== null
              ? 1
              : 0;
        p.midi = pitch.midi;
        p.confidence = pitch.confidence;
        p.cents = pitch.cents;
      }
      if (p.frames >= 3 || time - p.time >= 0.3) {
        result.attack = {
          id: p.id,
          time: p.time,
          resolvedAt: time,
          midi: p.frames >= 3 ? p.midi : null,
          confidence: p.frames >= 3 ? p.confidence : 0,
          cents: p.cents,
          ...(this.long ? { peaks: chordPeaks(this.long, this.rate) } : {}),
        };
        this.pending = null;
      }
    }
    return result;
  }
}
