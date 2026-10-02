import type { Song } from "../../schema/song.v1";
import type { AudioIntelligenceResult } from "./types";
import { createNoteTranscription, applyNotesToSong } from "./noteReview";
import { loadSong } from "../../schema/migrations";
import { reviewedAnalysisToSong } from "./song";

export type AudioReview = NonNullable<NonNullable<Song["provenance"]>["audioReview"]>;
export type ReviewSegment = AudioReview["reviewed"]["segments"][number];

export function createAudioReview(result: AudioIntelligenceResult, fileName: string,
  waveform: number[], fileSha256?: string): AudioReview {
  const beats = result.beats.beats;
  const firstDownbeatIndex = result.beats.downbeats.length
    ? Math.max(0, beats.findIndex((beat) => Math.abs(beat - result.beats.downbeats[0]) < .08)) : 0;
  return {
    noteTranscription: result.notes ? createNoteTranscription(result.notes) : undefined,
    fileName, fileSha256, duration: result.duration, waveform,
    detected: { tempoBpm: result.beats.tempoBpm, beats, downbeats: result.beats.downbeats,
      meter: result.beats.meter, beatProviderId: result.beats.providerId,
      beatStatus: result.beats.status, beatEvidence: result.beats.evidence,
      beatWarnings: result.beats.warnings, chordProviderId: result.chords.providerId,
      chordWarnings: result.chords.warnings, vocabulary: result.chords.vocabulary,
      segments: result.chords.segments },
    reviewed: { tempoBpm: result.beats.tempoBpm ?? 120, beats: [...beats],
      meter: result.beats.meter ?? 4, firstDownbeatIndex,
      timingConfirmed: false,
      segments: result.chords.segments.map((segment) => ({
        id: crypto.randomUUID(), start: segment.start, end: segment.end,
        label: segment.label, decision: "detected" as const, reviewed: false,
      })),
    },
  };
}

export function gridAtBpm(duration: number, bpm: number, firstBeat: number): number[] {
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400 ||
      !Number.isFinite(firstBeat) || firstBeat < 0 || firstBeat >= duration)
    throw new Error("Choose a BPM from 20 to 400 and a first beat inside the recording.");
  const beats: number[] = [];
  for (let time = firstBeat; time < duration && beats.length < 2000; time += 60 / bpm)
    beats.push(Number(time.toFixed(4)));
  return beats;
}

export function moveBoundary(segments: ReviewSegment[], index: number, boundary: number): ReviewSegment[] {
  if (index < 0 || index >= segments.length - 1 ||
      !Number.isFinite(boundary) || boundary <= segments[index].start + .02 ||
      boundary >= segments[index + 1].end - .02)
    throw new Error("Choose a boundary inside the two neighboring regions.");
  return segments.map((segment, i) => i === index ? { ...segment, end: boundary, reviewed: true } :
    i === index + 1 ? { ...segment, start: boundary, reviewed: true } : segment);
}

export function splitRegion(segments: ReviewSegment[], index: number, at: number): ReviewSegment[] {
  const segment = segments[index];
  if (!segment || !Number.isFinite(at) || at <= segment.start + .02 || at >= segment.end - .02)
    throw new Error("Choose a split time inside the region.");
  return [...segments.slice(0, index), { ...segment, end: at, reviewed: true },
    { ...segment, id: crypto.randomUUID(), start: at, reviewed: true }, ...segments.slice(index + 1)];
}

export function mergeRegion(segments: ReviewSegment[], index: number): ReviewSegment[] {
  const first = segments[index], next = segments[index + 1];
  if (!first || !next) throw new Error("Choose a region with a following region to merge.");
  if (first.label !== next.label ||
      (first.label === null && first.decision !== next.decision))
    throw new Error("These regions have different chord decisions. Choose the same label or state before merging.");
  return [...segments.slice(0, index), { ...first, end: next.end,
    decision: first.label === null ? first.decision : "corrected" as const,
    reviewed: first.label !== null || (first.reviewed && next.reviewed) }, ...segments.slice(index + 2)];
}

export function audioReviewToSong(title: string, providerId: string, review: AudioReview): Song {
  review = structuredClone(review);
  const r = review.reviewed;
  if (!review.noteTranscription?.notes.some(n => !n.deleted) && !r.segments.some((segment) => segment.label && segment.decision !== "no-chord"))
    throw new Error("No chord was identified. Correct at least one region before saving a transcription.");
  if (r.segments.some((segment) => segment.decision === "detected" && segment.label === null))
    throw new Error("Review each uncertain region: choose a chord, Unknown, or No chord.");
  if (r.segments.some((segment, i) => segment.start < 0 || segment.end > review.duration + .01 ||
      segment.start >= segment.end || (i > 0 && segment.start < r.segments[i - 1].end - .01)))
    throw new Error("Chord regions must be ordered and stay inside the recording.");
  if (r.timingConfirmed && (r.beats.length < r.firstDownbeatIndex + r.meter ||
      !r.beats.every((beat, i) => i === 0 || beat > r.beats[i - 1])))
    throw new Error("Correct the beat grid before confirming timing.");
  const song = reviewedAnalysisToSong({
    title, tempoBpm: r.tempoBpm, beatTimes: r.beats,
    firstDownbeatIndex: r.firstDownbeatIndex, meter: r.meter,
    timingConfirmed: r.timingConfirmed, providerId,
    chords: r.segments.filter((segment): segment is ReviewSegment & { label: string } =>
      !!segment.label && segment.decision !== "no-chord")
      .map((segment) => ({ start: segment.start, label: segment.label })),
    audioReview: review,
  });
  // The bridge validates/copies provenance; update the persisted copy as well.
  applyNotesToSong(song, song.provenance!.audioReview!);
  return loadSong(song);
}
