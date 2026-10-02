import { identify } from "../immersive/recognition";
import type { NoteAnalysis, NoteTranscriber, PcmAudio } from "./types";

/** Local, monophonic YIN + harmonic purity. Never conditioned on a score or tuning. */
export class YinNoteTranscriber implements NoteTranscriber {
  readonly id = "fretshift-yin-monophonic-v1";
  async transcribe(audio: PcmAudio): Promise<NoteAnalysis> {
    if (
      !Number.isFinite(audio.sampleRate) ||
      audio.sampleRate < 8000 ||
      !audio.samples.length ||
      audio.samples.length / audio.sampleRate > 300
    )
      throw new Error(
        "Note analysis needs nonempty audio up to five minutes at 8 kHz or above.",
      );
    const rate = Math.min(22050, audio.sampleRate),
      ratio = audio.sampleRate / rate;
    const pcm = new Float32Array(Math.floor(audio.samples.length / ratio));
    for (let i = 0; i < pcm.length; i++) {
      const from = Math.floor(i * ratio),
        to = Math.floor((i + 1) * ratio);
      let sum = 0;
      for (let j = from; j < to; j++) {
        if (!Number.isFinite(audio.samples[j]))
          throw new Error("Audio contains invalid samples.");
        sum += audio.samples[j];
      }
      pcm[i] = sum / (to - from);
    }
    const size = 2048,
      hop = Math.round(rate * 0.01),
      half = size / 2;
    const frames: NoteAnalysis["frames"] = [];
    const window = new Float32Array(size);
    // Centered windows: timestamps describe the source, not when processing finishes.
    for (let center = 0; center < pcm.length; center += hop) {
      window.fill(0);
      const begin = Math.max(0, center - half),
        end = Math.min(pcm.length, center + half);
      window.set(pcm.subarray(begin, end), begin - center + half);
      let energy = 0;
      const a = Math.max(0, (center - hop / 2) | 0),
        b = Math.min(pcm.length, (center + hop / 2) | 0);
      for (let j = a; j < b; j++) energy += pcm[j] ** 2;
      const rms = Math.sqrt(energy / Math.max(1, b - a));
      const pitch =
        rms >= 0.007
          ? identify(window, rate)
          : { midi: null, cents: 0, confidence: 0, flatness: 0 };
      frames.push({ time: center / rate, rms, ...pitch });
    }
    const notes: NoteAnalysis["notes"] = [];
    let active: {
      first: number;
      last: number;
      midi: number;
      evidence: number[];
    } | null = null;
    const finish = () => {
      if (active && active.last - active.first >= 4) {
        const start = Math.max(0, frames[active.first].time - hop / rate / 2);
        const end = Math.min(
          pcm.length / rate,
          frames[active.last].time + hop / rate / 2,
        );
        notes.push({
          id: `detected-${notes.length}`,
          start,
          end,
          midi: active.midi,
          confidence:
            active.evidence.reduce((a, b) => a + b, 0) / active.evidence.length,
          inferredArticulation: "unknown",
        });
      }
      active = null;
    };
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const accepted =
        f.midi !== null && f.confidence >= 0.9 && Math.abs(f.cents) <= 35;
      const repick =
        active &&
        i - active.first > 12 &&
        f.rms > 0.02 &&
        f.rms > (frames[Math.max(0, i - 2)].rms + 0.002) * 2.4;
      if (active && (!accepted || f.midi !== active.midi || repick)) finish();
      if (accepted) {
        if (!active)
          active = { first: i, last: i, midi: f.midi!, evidence: [] };
        active.last = i;
        active.evidence.push(f.confidence);
      }
    }
    finish();
    return {
      providerId: this.id,
      notes,
      frames,
      hopSeconds: hop / rate,
      windowSeconds: size / rate,
      warnings: [
        "Experimental single-note detector. Chords, ringing overlaps and multiple guitars are unsupported; a returned pitch does not prove one guitar part.",
        "Confidence is harmonic evidence, not measured accuracy. Soft tails, repeated attacks, bends and legato may be missed or split. Articulation is unknown.",
      ],
    };
  }
}
