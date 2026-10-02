/** Audio Intelligence contracts. Times are seconds from the start of decoded audio. */
export type PcmAudio = { samples: Float32Array; sampleRate: number };

export type AudioFeatures = {
  duration: number;
  hopSeconds: number;
  frames: Array<{ time: number; rms: number; flux: number; chroma: number[];
    flatness: number; independentPitches: number }>;
  onsets: Array<{ time: number; strength: number }>;
};

export type BeatAnalysis = {
  providerId: string;
  tempoBpm: number | null;
  beats: number[];
  downbeats: number[];
  meter: 3 | 4 | null;
  status: "estimated" | "insufficient-evidence";
  /** Evidence strength only. This is not measured beat accuracy. */
  evidence: number;
  warnings: string[];
};

export type ChordCandidate = { label: string; score: number };
export type ChordSegment = {
  start: number;
  end: number;
  /** Null means no defensible label; alternatives remain visible for review. */
  label: string | null;
  status: "estimated" | "ambiguous" | "no-chord";
  alternatives: ChordCandidate[];
};
export type ChordAnalysis = {
  providerId: string;
  vocabulary: string[];
  segments: ChordSegment[];
  warnings: string[];
};
export type ProvisionalMeasure = {
  index: number;
  start: number;
  end: number;
  beats: number[];
  chords: ChordSegment[];
  timingConfirmed: false;
};

export type StemAnalysis = { stems: Record<string, PcmAudio> };
import type { NoteAnalysis } from "../../schema/audioNotes";
export type { NoteAnalysis } from "../../schema/audioNotes";
export type NoteEvent = NoteAnalysis["notes"][number];

export interface AudioDecoder {
  readonly id: string;
  decode(file: File): Promise<PcmAudio>;
}
/** URL ingestion requires a future licensed provider; no downloader is installed. */
export type AudioInput = { kind: "file"; file: File } |
  { kind: "licensed-url"; url: string; entitlement: string };
export interface AudioIngestor {
  resolve(input: AudioInput): Promise<File>;
}
export interface BeatAnalyzer {
  readonly id: string;
  analyze(features: AudioFeatures): BeatAnalysis | Promise<BeatAnalysis>;
}
export interface ChordAnalyzer {
  readonly id: string;
  analyze(features: AudioFeatures): ChordAnalysis | Promise<ChordAnalysis>;
}
export interface StemSeparator {
  readonly id: string;
  separate(audio: PcmAudio): Promise<StemAnalysis>;
}
export interface NoteTranscriber {
  readonly id: string;
  transcribe(audio: PcmAudio): Promise<NoteAnalysis>;
}

export type AudioIntelligenceResult = {
  version: 1;
  duration: number;
  beats: BeatAnalysis;
  chords: ChordAnalysis;
  measures: ProvisionalMeasure[];
  notes: NoteAnalysis | null;
  stemProviderId: string | null;
  warnings: string[];
};

export interface AnalysisOrchestrator {
  analyze(audio: PcmAudio): Promise<AudioIntelligenceResult>;
}
