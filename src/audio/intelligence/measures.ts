import type { BeatAnalysis, ChordAnalysis, ProvisionalMeasure } from "./types";

/** Preview only: a wrong meter or downbeat yields wrong barlines until reviewed. */
export function reconstructProvisionalMeasures(
  duration: number, beats: BeatAnalysis, chords: ChordAnalysis,
): ProvisionalMeasure[] {
  if (!beats.meter || !beats.downbeats.length || beats.beats.length < beats.meter) return [];
  const measures: ProvisionalMeasure[] = [];
  const period = beats.beats.length > 1 ?
    beats.beats[1] - beats.beats[0] : 60 / (beats.tempoBpm ?? 120);
  for (const start of beats.downbeats) {
    const firstBeat = beats.beats.findIndex((time) => Math.abs(time - start) < 0.001);
    if (firstBeat < 0 || firstBeat + beats.meter > beats.beats.length) continue;
    const end = Math.min(duration, beats.beats[firstBeat + beats.meter] ??
      beats.beats[firstBeat + beats.meter - 1] + period);
    measures.push({ index: measures.length, start, end,
      beats: beats.beats.slice(firstBeat, firstBeat + beats.meter),
      chords: chords.segments.filter((chord) => chord.end > start && chord.start < end),
      timingConfirmed: false });
  }
  return measures;
}
