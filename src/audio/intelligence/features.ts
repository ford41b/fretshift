import { spectrum } from "../onset";
import type { AudioFeatures, PcmAudio } from "./types";

/** Bound CPU and memory before FFT. Box averaging also limits high-frequency aliasing. */
function downsample(audio: PcmAudio, targetRate = 11025): PcmAudio {
  if (audio.sampleRate <= targetRate) return audio;
  const ratio = audio.sampleRate / targetRate;
  const output = new Float32Array(Math.floor(audio.samples.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const first = Math.floor(i * ratio);
    const last = Math.max(first + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = first; j < last; j++) sum += audio.samples[j];
    output[i] = sum / (last - first);
  }
  return { samples: output, sampleRate: targetRate };
}

export function extractAudioFeatures(input: PcmAudio): AudioFeatures {
  if (!Number.isFinite(input.sampleRate) || input.sampleRate < 8000)
    throw new Error("Audio has an invalid sample rate.");
  const duration = input.samples.length / input.sampleRate;
  if (!Number.isFinite(duration) || duration < 1 || duration > 15 * 60)
    throw new Error("Use a recording between 1 second and 15 minutes.");
  const audio = downsample(input);
  const size = 4096;
  const hop = 512;
  const frames: AudioFeatures["frames"] = [];
  const onsets: AudioFeatures["onsets"] = [];
  let previous: Float64Array | null = null;
  for (let start = 0; start + size <= audio.samples.length; start += hop) {
    const slice = audio.samples.subarray(start, start + size);
    const spec = spectrum(slice);
    const chroma = Array(12).fill(0) as number[];
    const peaks: Array<{ frequency: number; magnitude: number; note: number }> = [];
    let strongest = 0;
    for (let i = 1; i < spec.length; i++) {
      const frequency = (i * audio.sampleRate) / size;
      if (frequency >= 75 && frequency <= 1400) strongest = Math.max(strongest, spec[i]);
    }
    let power = 0;
    let flux = 0;
    let logPower = 0, spectralPower = 0, spectralBins = 0;
    for (let i = 0; i < slice.length; i++) power += slice[i] ** 2;
    for (let i = 1; i < spec.length; i++) {
      const frequency = (i * audio.sampleRate) / size;
      const magnitude = spec[i];
      if (frequency >= 70 && frequency <= 4000)
        flux += Math.max(0, magnitude - (previous?.[i] ?? 0));
      if (frequency >= 75 && frequency <= 4000) {
        const energy = magnitude ** 2 + 1e-12;
        logPower += Math.log(energy);
        spectralPower += energy;
        spectralBins++;
      }
      if (frequency < 75 || frequency > 1400 || magnitude < strongest * 0.055 ||
          magnitude <= spec[i - 1] || magnitude < (spec[i + 1] ?? 0)) continue;
      const midi = 69 + 12 * Math.log2(frequency / 440);
      const note = Math.round(midi);
      const distance = Math.abs(midi - note);
      if (distance > 0.45) continue;
      peaks.push({ frequency, magnitude, note });
      // The shared FFT is the existing FretShift onset implementation.
      chroma[((note % 12) + 12) % 12] +=
        magnitude * (1 - distance) / Math.sqrt(frequency / 100);
    }
    const norm = Math.hypot(...chroma);
    const fundamentalPeaks: typeof peaks = [];
    for (const peak of peaks) {
      const harmonic = fundamentalPeaks.some((lower) => {
        const ratio = peak.frequency / lower.frequency;
        return ratio >= 1.8 && ratio <= 10 &&
          Math.abs(ratio - Math.round(ratio)) * lower.frequency < audio.sampleRate / size * 1.5;
      });
      if (!harmonic) fundamentalPeaks.push(peak);
    }
    frames.push({
      time: (start + size / 2) / audio.sampleRate,
      rms: Math.sqrt(power / size),
      flux: flux / spec.length,
      chroma: norm ? chroma.map((value) => value / norm) : chroma,
      flatness: Math.exp(logPower / Math.max(1, spectralBins)) /
        (spectralPower / Math.max(1, spectralBins)),
      independentPitches: new Set(fundamentalPeaks.map((peak) => ((peak.note % 12) + 12) % 12)).size,
    });
    previous = spec;
  }
  // Short windows locate attacks more accurately than the tonal window.
  let previousOnset: Float64Array | null = null;
  for (let start = 0; start + 1024 <= audio.samples.length; start += 256) {
    const spec = spectrum(audio.samples.subarray(start, start + 1024));
    let strength = 0;
    for (let i = 6; i < spec.length; i++)
      strength += Math.max(0, spec[i] - (previousOnset?.[i] ?? 0));
    onsets.push({ time: (start + 512) / audio.sampleRate, strength });
    previousOnset = spec;
  }
  return { duration, hopSeconds: hop / audio.sampleRate, frames, onsets };
}
