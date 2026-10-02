import { readFileSync } from "node:fs";

export const manifest = JSON.parse(readFileSync("test-fixtures/audio-intelligence/manifest.json", "utf8"));
const NOTES = {
  C: [48, 52, 55], G: [55, 59, 62], Am: [57, 60, 64], F: [53, 57, 60],
  Em: [52, 55, 59], D: [50, 54, 57], C5: [48, 55], F5: [53, 60],
  G5: [55, 62], Cadd9: [48, 52, 55, 62], Fmaj7: [53, 57, 60, 64],
  Bm7b5: [59, 62, 65, 69], G7: [55, 59, 62, 65],
};
const frequency = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Reproducible stand-ins for signal-path tests, not recordings of real instruments. */
export function renderFixture(definition) {
  const sampleRate = manifest.sampleRate;
  const beats = [];
  const count = (definition.bars ?? 0) * 4;
  let time = 0;
  for (let beat = 0; beat < count; beat++) {
    beats.push(time);
    const bpm = definition.tempoBpm ?? definition.tempoStart +
      (definition.tempoEnd - definition.tempoStart) * beat / Math.max(1, count - 1);
    time += 60 / bpm;
  }
  const duration = definition.duration ?? time;
  const samples = new Float32Array(Math.ceil(duration * sampleRate));
  const guitarSamples = new Float32Array(samples.length);
  const addTone = (midi, start, length, gain, style = "pluck", guitar = true) => {
    const hz = frequency(midi);
    const first = Math.round(start * sampleRate);
    for (let i = first; i < Math.min(samples.length, first + length * sampleRate); i++) {
      const local = (i - first) / sampleRate;
      const envelope = style === "sustain" ? (1 - 0.25 * local / length) : Math.exp(-3.8 * local);
      const value = gain * envelope * (Math.sin(2 * Math.PI * hz * local) +
        0.35 * Math.sin(4 * Math.PI * hz * local) +
        0.16 * Math.sin(6 * Math.PI * hz * local));
      samples[i] += value;
      if (guitar) guitarSamples[i] += value;
    }
  };
  const chords = [];
  const notes = [];
  for (let beat = 0; beat < beats.length; beat++) {
    const beatTime = beats[beat];
    const next = beats[beat + 1] ?? duration;
    if (definition.id === "single-note-melody") {
      const midi = [60, 62, 64, 67, 69, 67, 64, 62][beat % 8];
      addTone(midi, beatTime, Math.min(0.4, next - beatTime), 0.24);
      notes.push({ start: beatTime, end: next, midi });
      continue;
    }
    const label = definition.progression[Math.floor(beat / 4) % definition.progression.length];
    if (beat % 4 === 0) chords.push({ start: beatTime, end: 0, label });
    const chordNotes = NOTES[label];
    for (let i = 0; i < chordNotes.length; i++)
      addTone(chordNotes[i], beatTime + i * 0.008, Math.min(0.55, next - beatTime),
        (beat % 4 === 0 ? 0.21 : 0.16) / chordNotes.length,
        definition.id === "clean-electric" ? "sustain" : "pluck");
    if (definition.id === "full-band-like") {
      addTone(chordNotes[0] - 12, beatTime, Math.min(0.35, next - beatTime), 0.12, "pluck", false);
      const first = Math.round(beatTime * sampleRate);
      for (let i = first; i < Math.min(samples.length, first + sampleRate * 0.12); i++) {
        const local = (i - first) / sampleRate;
        samples[i] += 0.12 * Math.exp(-35 * local) * Math.sin(2 * Math.PI * 70 * local);
      }
    }
  }
  for (let i = 0; i < chords.length; i++) chords[i].end = chords[i + 1]?.start ?? duration;
  if (definition.id === "vocal-like-mix") {
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate;
      const f = 190 + 11 * Math.sin(2 * Math.PI * 4.7 * t);
      samples[i] += 0.055 * (Math.sin(2 * Math.PI * f * t) +
        0.3 * Math.sin(4 * Math.PI * f * t));
    }
  }
  if (definition.id === "distorted-guitar") {
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.tanh(samples[i] * 7) * 0.55;
      guitarSamples[i] = Math.tanh(guitarSamples[i] * 7) * 0.55;
    }
  }
  if (definition.id === "noise") {
    let state = 123456789;
    for (let i = 0; i < samples.length; i++) {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      samples[i] = ((state / 0xffffffff) * 2 - 1) * 0.08;
    }
  }
  return { id: definition.id, style: definition.style, samples, sampleRate, duration,
    oracleGuitarStem: { samples: guitarSamples, sampleRate },
    truth: { tempoBpm: definition.tempoBpm ?? null, beats,
      downbeats: beats.filter((_, i) => i % 4 === 0), chords, notes } };
}
