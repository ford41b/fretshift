import { Buffer } from "node:buffer";
// Deterministic signal fixtures, not recordings of guitars. Labels precede synthesis.
export function syntheticNotes(kind = "melody", sampleRate = 22050) {
  const duration = 4;
  const notes =
    kind === "silence" || kind === "noise"
      ? []
      : kind === "polyphonic"
        ? [48, 52, 55].map((midi) => ({ start: 0.3, end: 2, midi }))
        : kind === "octave-mixture"
          ? [52, 64].map((midi) => ({ start: 0.3, end: 2, midi }))
          : [52, 57, 64, 64, 60].map((midi, i) => ({
              start: 0.2 + i * 0.7,
              end: 0.7 + i * 0.7,
              midi,
            }));
  const samples = new Float32Array(duration * sampleRate);
  for (const n of notes) {
    for (
      let i = Math.round(n.start * sampleRate);
      i < Math.round(n.end * sampleRate);
      i++
    ) {
      const t = i / sampleRate - n.start,
        length = n.end - n.start;
      const envelope =
        Math.min(1, t / 0.006) *
        Math.min(1, (length - t) / 0.012) *
        Math.exp(-t * 2);
      const hz = 440 * 2 ** ((n.midi - 69) / 12);
      for (let h = 1; h <= 6; h++)
        samples[i] +=
          (0.19 / h ** 1.7) * envelope * Math.sin(2 * Math.PI * hz * h * t);
    }
  }
  if (kind === "noise") {
    let state = 12345;
    for (let i = 0; i < samples.length; i++) {
      state = (1664525 * state + 1013904223) >>> 0;
      samples[i] = ((state / 2 ** 32) * 2 - 1) * 0.05;
    }
  }
  return { samples, sampleRate, notes, duration };
}
export function wavBytes({ samples, sampleRate }) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) =>
    bytes.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, s)) * 32767),
      44 + i * 2,
    ),
  );
  return bytes;
}
