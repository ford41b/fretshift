import { loadSong } from "../../schema/migrations";
import { newSong, type Measure, type Song } from "../../schema/song.v1";
import { parseChordName } from "../../theory/chordName";
import { scoreDifficulty } from "../../transforms";

export type ReviewedAudioTimeline = {
  title: string;
  tempoBpm: number;
  beatTimes: number[];
  firstDownbeatIndex: number;
  meter: 3 | 4;
  chords: Array<{ start: number; label: string }>;
  timingConfirmed: boolean;
  providerId: string;
  audioReview?: NonNullable<NonNullable<Song["provenance"]>["audioReview"]>;
};

/** Phase 2 must supply explicit reviewed labels and beat phase. No ambiguous segment is silently dropped. */
export function reviewedAnalysisToSong(review: ReviewedAudioTimeline): Song {
  if (!Number.isFinite(review.tempoBpm) || review.tempoBpm < 20 || review.tempoBpm > 400)
    throw new Error("Confirm a tempo between 20 and 400 BPM.");
  if (!Number.isInteger(review.firstDownbeatIndex) || review.firstDownbeatIndex < 0 ||
      review.firstDownbeatIndex >= review.beatTimes.length)
    throw new Error("Choose the first downbeat before creating a song.");
  if (review.beatTimes.length < review.firstDownbeatIndex + review.meter)
    throw new Error("At least one full reviewed measure is required.");
  if (review.beatTimes.some((beat, i) => !Number.isFinite(beat) || beat < 0 ||
      (i > 0 && beat <= review.beatTimes[i - 1])))
    throw new Error("Beat positions must be increasing nonnegative seconds.");
  const chords = [...review.chords].sort((a, b) => a.start - b.start);
  if (!chords.length && !review.audioReview?.noteTranscription?.notes.some(n=>!n.deleted)) throw new Error("Choose at least one reviewed chord.");
  const song = newSong(review.title.trim() || "Audio chord draft");
  song.tempo = review.tempoBpm;
  song.timeSignature = [review.meter, 4];
  song.measures = [];
  song.provenance = { source: "audio", modelId: review.providerId,
    processedAt: new Date().toISOString(),
    timingNeedsConfirmation: !review.timingConfirmed,
    audioReview: review.audioReview };
  const lastInterval = review.beatTimes.at(-1)! - review.beatTimes.at(-2)!;
  const measureCount = Math.max(1, Math.ceil((review.beatTimes.length - review.firstDownbeatIndex) / review.meter));
  song.measures = Array.from({ length: measureCount }, (_, index): Measure => ({
    id: crypto.randomUUID(), index, subdivision: 4, chords: [],
    timingConfirmed: review.timingConfirmed,
  }));
  for (const chord of chords) {
    parseChordName(chord.label); // Reject unsupported extensions rather than simplifying them.
    if (!Number.isFinite(chord.start) || chord.start < 0)
      throw new Error("Chord timestamps must be nonnegative seconds.");
    let beatIndex = -1;
    for (let i = 0; i < review.beatTimes.length; i++) {
      if (review.beatTimes[i] > chord.start) break;
      beatIndex = i;
    }
    // SongV1 has no pickup measure. Keep the exact source time and show the pickup at chart beat 0.
    if (beatIndex < review.firstDownbeatIndex) {
      song.measures[0].chords.push({ id: crypto.randomUUID(), beat: 0,
        chordName: chord.label, audioTimeSeconds: chord.start });
      continue;
    }
    const current = review.beatTimes[beatIndex];
    const interval = review.beatTimes[beatIndex + 1] - current || lastInterval;
    const fraction = (chord.start - current) / interval;
    const relative = beatIndex - review.firstDownbeatIndex + Math.round(Math.max(0, Math.min(.999, fraction)) * 4) / 4;
    const measureIndex = Math.floor(relative / review.meter);
    const beat = Number((relative - measureIndex * review.meter).toFixed(2));
    if (!song.measures[measureIndex])
      throw new Error("A chord falls beyond the reviewed beat grid. Extend or correct the beats before saving.");
    song.measures[measureIndex].chords.push({ id: crypto.randomUUID(), beat,
      chordName: chord.label, audioTimeSeconds: chord.start });
  }
  song.difficulty = scoreDifficulty(song);
  return loadSong(song);
}
