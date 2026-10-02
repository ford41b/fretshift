import { yin } from "../pitch";
import { loadSong } from "../../schema/migrations";
import { newSong, type Measure, type Song } from "../../schema/song.v1";
import { mod, spell } from "../../theory/chordName";
import { midiFromFrequency } from "../../theory/pitch";
import { scoreDifficulty } from "../../transforms";

export type ChordEstimate = {
  start: number;
  duration: number;
  chordName: string;
  confidence: number;
};
export type AudioChordAnalysis = {
  tempo: number;
  keyRoot: string;
  waveform: number[];
  chords: ChordEstimate[];
  assumption: "single-string";
};

type PitchFrame = {
  start: number;
  duration: number;
  root: number;
  confidence: number;
};

type PitchRegion = PitchFrame & { end: number };

function changeEnvelope(samples: Float32Array, sampleRate: number) {
  const frame = Math.max(256, Math.round(sampleRate * 0.05)),
    values: number[] = [];
  let prior = 0;
  for (let start = 0; start + frame <= samples.length; start += frame) {
    let energy = 0;
    for (let index = start; index < start + frame; index++)
      energy += samples[index] ** 2;
    energy = Math.sqrt(energy / frame);
    values.push(Math.max(0, energy - prior));
    prior = energy;
  }
  return { values, frameSeconds: frame / sampleRate };
}

function estimateTempo(samples: Float32Array, sampleRate: number) {
  const { values, frameSeconds } = changeEnvelope(samples, sampleRate),
    mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const peaks = values.flatMap((value, index) =>
    value > mean * 2.5 &&
    value >= (values[index - 1] ?? 0) &&
    value >= (values[index + 1] ?? 0)
      ? [index * frameSeconds]
      : [],
  );
  const intervals = peaks
    .slice(1)
    .map((value, index) => value - peaks[index])
    .filter((value) => value >= 0.3 && value <= 2);
  if (!intervals.length) return 120;
  intervals.sort((a, b) => a - b);
  let tempo = 60 / intervals[Math.floor(intervals.length / 2)];
  while (tempo < 70) tempo *= 2;
  while (tempo > 180) tempo /= 2;
  return Math.round(tempo);
}

function waveform(samples: Float32Array) {
  const points = Math.min(800, samples.length),
    step = Math.max(1, Math.floor(samples.length / points)),
    output: number[] = [];
  for (let start = 0; start < samples.length; start += step) {
    let peak = 0;
    for (
      let index = start;
      index < Math.min(samples.length, start + step);
      index++
    )
      peak = Math.max(peak, Math.abs(samples[index]));
    output.push(peak);
  }
  const max = Math.max(...output, 1e-6);
  return output.map((value) => value / max);
}

function rms(samples: Float32Array) {
  let energy = 0;
  for (const value of samples) energy += value * value;
  return Math.sqrt(energy / Math.max(1, samples.length));
}

function mode(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
}

/**
 * Audio import deliberately uses a conservative monophonic assumption: one
 * guitar string is sounding at a time. That trades chord-quality inference for
 * a much more stable root-note draft that the player can correct afterward.
 */
function singleStringRegions(samples: Float32Array, sampleRate: number) {
  const windowSamples = Math.max(2048, Math.round(sampleRate * 0.16));
  const hopSamples = Math.max(512, Math.round(sampleRate * 0.08));
  const frames: Array<PitchFrame | null> = [];

  for (
    let startSample = 0;
    startSample + windowSamples <= samples.length;
    startSample += hopSamples
  ) {
    const frame = samples.subarray(startSample, startSample + windowSamples);
    if (rms(frame) < 0.009) {
      frames.push(null);
      continue;
    }
    const hz = yin(frame, sampleRate, 0.16);
    if (!hz) {
      frames.push(null);
      continue;
    }
    const exactMidi = midiFromFrequency(hz);
    const midi = Math.round(exactMidi);
    // E2 through E6 covers a standard six-string guitar through a typical
    // 24th fret while rejecting low rumble and very high transient noise.
    if (midi < 40 || midi > 88) {
      frames.push(null);
      continue;
    }
    const cents = Math.abs((exactMidi - midi) * 100);
    frames.push({
      start: startSample / sampleRate,
      duration: windowSamples / sampleRate,
      root: mod(midi),
      confidence: Math.max(0.35, Math.min(0.98, 0.98 - cents / 110)),
    });
  }

  // Majority smoothing removes the short pitch-class flips that polyphonic
  // overtones and pick attacks can produce, without inventing extra notes.
  const smoothed = frames.map((frame, index) => {
    if (!frame) return null;
    const nearby = frames
      .slice(Math.max(0, index - 2), Math.min(frames.length, index + 3))
      .flatMap((candidate) => (candidate ? [candidate.root] : []));
    const winner = mode(nearby);
    if (!winner || winner[1] < Math.min(3, nearby.length)) return null;
    return { ...frame, root: winner[0] };
  });

  const regions: PitchRegion[] = [];
  for (const frame of smoothed) {
    if (!frame) continue;
    const end = frame.start + frame.duration;
    const prior = regions.at(-1);
    if (
      prior &&
      prior.root === frame.root &&
      frame.start <= prior.end + 0.18
    ) {
      const priorWeight = Math.max(0.001, prior.end - prior.start);
      prior.confidence =
        (prior.confidence * priorWeight + frame.confidence * frame.duration) /
        (priorWeight + frame.duration);
      prior.end = Math.max(prior.end, end);
      prior.duration = prior.end - prior.start;
    } else {
      regions.push({ ...frame, end });
    }
  }

  // A chord draft should be sparse and editable, not a frame-by-frame tuner
  // transcript. Ignore fleeting detections and then bridge tiny same-note gaps.
  const stable = regions.filter((region) => region.duration >= 0.52);
  const merged: PitchRegion[] = [];
  for (const region of stable) {
    const prior = merged.at(-1);
    if (
      prior &&
      prior.root === region.root &&
      region.start - prior.end <= 0.55
    ) {
      const total = prior.duration + region.duration;
      prior.confidence =
        (prior.confidence * prior.duration +
          region.confidence * region.duration) /
        total;
      prior.end = region.end;
      prior.duration = prior.end - prior.start;
    } else merged.push({ ...region });
  }

  return merged;
}

export function analyzeAudioSamples(
  samples: Float32Array,
  sampleRate: number,
): AudioChordAnalysis {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || !samples.length)
    throw new Error("Use a nonempty audio recording with a valid sample rate.");
  const duration = samples.length / sampleRate;
  if (duration < 1)
    throw new Error("Use at least one second of audio for a chord draft.");
  if (duration > 15 * 60)
    throw new Error(
      "Audio drafting supports recordings up to 15 minutes. Split longer rehearsals first.",
    );

  const regions = singleStringRegions(samples, sampleRate);
  const chords = regions.map<ChordEstimate>((region) => ({
    start: region.start,
    duration: region.duration,
    chordName: spell(region.root),
    confidence: region.confidence,
  }));

  const roots = regions.reduce(
    (counts, region) => {
      counts[region.root] = (counts[region.root] ?? 0) + region.duration;
      return counts;
    },
    {} as Record<number, number>,
  );
  const key = Array.from({ length: 12 }, (_, root) => ({
    root,
    score:
      (roots[root] ?? 0) * 3 +
      (roots[mod(root + 5)] ?? 0) * 2 +
      (roots[mod(root + 7)] ?? 0) * 2 +
      (roots[mod(root + 9)] ?? 0),
  })).sort((a, b) => b.score - a.score)[0]?.root ?? 0;

  return {
    tempo: estimateTempo(samples, sampleRate),
    keyRoot: spell(key),
    waveform: waveform(samples),
    chords,
    assumption: "single-string",
  };
}

export function audioAnalysisToSong(
  analysis: AudioChordAnalysis,
  title: string,
): Song {
  if (!analysis.chords.length)
    throw new Error(
      "No stable single-string notes were found. Try a cleaner recording or enter chords manually.",
    );
  const song = newSong(title.trim() || "Audio chord draft");
  song.measures = [];
  song.tempo = analysis.tempo;
  song.currentKey = {
    root: analysis.keyRoot as Song["currentKey"]["root"],
    mode: "major",
  };
  song.originalKey = { ...song.currentKey };
  song.provenance = {
    source: "audio",
    overallConfidence:
      analysis.chords.reduce((sum, chord) => sum + chord.confidence, 0) /
      analysis.chords.length,
    processedAt: new Date().toISOString(),
  };
  const beatSeconds = 60 / analysis.tempo;
  for (const chord of analysis.chords) {
    const absoluteBeat = Math.round(chord.start / beatSeconds),
      measureIndex = Math.floor(absoluteBeat / 4),
      beat = absoluteBeat % 4;
    while (song.measures.length <= measureIndex)
      song.measures.push({
        id: crypto.randomUUID(),
        index: song.measures.length,
        subdivision: 1,
        chords: [],
      } as Measure);
    song.measures[measureIndex].chords.push({
      id: crypto.randomUUID(),
      beat,
      chordName: chord.chordName,
    });
  }
  song.difficulty = scoreDifficulty(song);
  return loadSong(song);
}
