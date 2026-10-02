import { intervalsOf, parseChordName, spell } from "../../theory/chordName";
import type { AudioFeatures, ChordAnalysis, ChordAnalyzer, ChordCandidate, ChordSegment } from "./types";

// Explicit vocabulary. The baseline cannot claim that unknown extended chords are major/minor.
const SUFFIXES = ["", "m", "5", "dim", "aug", "sus2", "sus4", "6", "m6",
  "7", "maj7", "m7", "m7b5", "add9", "9", "maj9"] as const;
const TEMPLATES = Array.from({ length: 12 }, (_, root) =>
  SUFFIXES.map((suffix) => {
    const label = `${spell(root)}${suffix}`;
    const intervals = intervalsOf(parseChordName(label));
    const vector = Array(12).fill(0) as number[];
    for (const interval of intervals) vector[(root + interval) % 12] = 1;
    const norm = Math.hypot(...vector);
    return { label, vector: vector.map((value) => value / norm) };
  })).flat();

function candidates(chroma: number[]): ChordCandidate[] {
  return TEMPLATES.map((template) => ({
    label: template.label,
    score: chroma.reduce((sum, value, i) => sum + value * template.vector[i], 0),
  })).sort((a, b) => b.score - a.score).slice(0, 3);
}

export class ChromaChordAnalyzer implements ChordAnalyzer {
  readonly id = "fretshift-chroma-templates-v1";

  analyze(features: AudioFeatures): ChordAnalysis {
    const frames = features.frames.map((frame) => {
      const tonal = frame.rms >= 0.006 && frame.flatness < 0.4;
      const alternatives = tonal ? candidates(frame.chroma) : [];
      const top = alternatives[0];
      const margin = top ? top.score - (alternatives[1]?.score ?? 0) : 0;
      const pitchStrength = [...frame.chroma].sort((a, b) => b - a);
      const singlePitch = pitchStrength[1] < pitchStrength[0] * 0.42;
      const status: ChordSegment["status"] = !top ? "no-chord" :
        singlePitch || frame.independentPitches < 2 || top.score < 0.72 || margin < 0.045 ?
          "ambiguous" : "estimated";
      return { ...frame, alternatives, status,
        label: status === "estimated" ? top.label : null };
    });
    // A short majority filter removes isolated label flips without upgrading uncertainty.
    const labels = frames.map((frame, i) => {
      if (frame.status !== "estimated") return null;
      const nearby = frames.slice(Math.max(0, i - 2), Math.min(frames.length, i + 3))
        .map((item) => item.label).filter((label) => label !== null);
      const support = nearby.filter((label) => label === frame.label).length;
      return support >= Math.min(3, nearby.length) ? frame.label : null;
    });
    const segments: ChordSegment[] = [];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const label = labels[i];
      const status = label ? "estimated" : frame.status === "no-chord" ? "no-chord" : "ambiguous";
      const start = Math.max(0, frame.time - features.hopSeconds / 2);
      const end = Math.min(features.duration, frame.time + features.hopSeconds / 2);
      const previous = segments.at(-1);
      const sameAlternative = previous?.alternatives[0]?.label === frame.alternatives[0]?.label;
      if (previous && previous.status === status && previous.label === label &&
        (status !== "ambiguous" || sameAlternative) && start - previous.end < 0.001) {
        previous.end = end;
      } else segments.push({ start, end, label, status,
        alternatives: frame.alternatives });
    }
    // The FFT window leaves a small edge without tonal evidence.
    if (segments[0]?.start && segments[0].start > 0)
      segments.unshift({ start: 0, end: segments[0].start, label: null,
        status: "no-chord", alternatives: [] });
    if (segments.length && segments.at(-1)!.end < features.duration)
      segments.push({ start: segments.at(-1)!.end, end: features.duration,
        label: null, status: "no-chord", alternatives: [] });
    for (const segment of segments)
      if (segment.status === "estimated" && segment.end - segment.start < 0.28) {
        segment.label = null;
        segment.status = "ambiguous";
      }
    return { providerId: this.id, vocabulary: TEMPLATES.map((template) => template.label),
      segments, warnings: [
        "Chroma cannot reliably distinguish inversions, all extensions, or guitar from other instruments.",
        "Ambiguous regions require listening and an explicit chord choice; scores are similarity, not accuracy.",
      ] };
  }
}
