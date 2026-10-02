import { emptySlot, type Song } from "../../schema/song.v1";
import {
  NoteTranscriptionSchema,
  type NoteAnalysis,
  type NoteTranscription,
  type ReviewedNote,
} from "../../schema/audioNotes";
import {
  defaultFingeringOptions,
  fingeringCandidates,
  suggestFingerings,
} from "./fingering";
import type { AudioReview } from "./review";

export function createNoteTranscription(
  detected: NoteAnalysis,
): NoteTranscription {
  const options = structuredClone(defaultFingeringOptions);
  return {
    version: 1,
    scope: "single-note-user-selected",
    detected: structuredClone(detected),
    options,
    notes: suggestFingerings(
      detected.notes.map((n) => ({
        id: crypto.randomUUID(),
        detectedId: n.id,
        start: n.start,
        end: n.end,
        midi: n.midi,
        confirmed: false,
        uncertain: true,
        deleted: false,
        fingering: null,
        quantized: null,
      })),
      options,
    ),
  };
}

/** Interpolate the reviewed beat map. Negative pickup beats are retained in metadata. */
export function sourceBeat(time: number, review: AudioReview): number {
  const r = review.reviewed,
    beats = r.beats;
  if (
    beats.length < 2 ||
    beats.some((b, i) => !Number.isFinite(b) || (i > 0 && b <= beats[i - 1]))
  )
    throw new Error("Correct the beat grid before quantizing notes.");
  let i = 0;
  while (i + 1 < beats.length && beats[i + 1] <= time) i++;
  const interval =
    i + 1 < beats.length
      ? beats[i + 1] - beats[i]
      : beats.at(-1)! - beats.at(-2)!;
  return i - r.firstDownbeatIndex + (time - beats[i]) / interval;
}

export function quantizeNote(note: ReviewedNote, review: AudioReview) {
  const startBeat = Math.round(sourceBeat(note.start, review) * 4) / 4;
  return {
    startBeat,
    endBeat: Math.max(
      startBeat + 0.25,
      Math.round(sourceBeat(note.end, review) * 4) / 4,
    ),
  };
}

export function validateNoteReview(review: AudioReview) {
  if (!review.noteTranscription) return;
  const t = NoteTranscriptionSchema.parse(review.noteTranscription);
  const ids = new Set<string>();
  for (const n of t.notes) {
    if (
      ids.has(n.id) ||
      n.end > review.duration + 0.0001 ||
      (n.detectedId !== null &&
        !t.detected.notes.some((d) => d.id === n.detectedId))
    )
      throw new Error("Note identities and times must match this recording.");
    ids.add(n.id);
    if (
      n.fingering &&
      !fingeringCandidates(n.midi, t.options).some(
        (c) => c.string === n.fingering!.string && c.fret === n.fingering!.fret,
      )
    )
      throw new Error(
        "A fingering does not match its sounding pitch, tuning, capo or fret range.",
      );
    if (n.confirmed && !n.fingering)
      throw new Error("Choose a playable fingering before confirming a note.");
  }
}

// General chart transformations do not edit source evidence. Invalidate audio practice on divergence.
export function audioChartSignature(song: Song): string {
  return JSON.stringify([
    song.tuningId,
    song.capo,
    song.tempo,
    song.timeSignature,
    song.measures.map((m) => [
      m.subdivision,
      m.timeSignature,
      m.tempoOverride,
      m.tab,
      m.timingConfirmed,
    ]),
  ]);
}

/** The editable source timeline is authoritative; only confirmed notes enter ordinary Song tab. */
export function applyNotesToSong(song: Song, review: AudioReview): void {
  const t = review.noteTranscription;
  if (!t) return;
  validateNoteReview(review);
  song.tuningId = t.options.tuningId;
  song.capo = t.options.capo;
  const occupied = new Set<number>();
  for (const n of t.notes) {
    n.quantized = quantizeNote(n, review);
    if (n.deleted || !n.confirmed || !n.fingering) continue;
    const from = Math.max(0, Math.round(n.quantized.startBeat * 4));
    const to = Math.max(from + 1, Math.round(n.quantized.endBeat * 4));
    const slots = review.reviewed.meter * 4;
    if (from >= song.measures.length * slots)
      throw new Error(
        "A note falls beyond the reviewed beat grid. Extend the grid before saving.",
      );
    if (occupied.has(from))
      throw new Error(
        "Two confirmed note attacks quantize to the same slot. Adjust timing or leave one unconfirmed; no note will be dropped.",
      );
    occupied.add(from);
    const measure = song.measures[Math.floor(from / slots)];
    measure.tab ??= { slots: Array.from({ length: slots }, emptySlot) };
    if (measure.tab.slots[from % slots][n.fingering.string] !== null)
      throw new Error(
        "Confirmed notes overlap on one string. Correct their duration or fingering.",
      );
    measure.tab.slots[from % slots][n.fingering.string] = n.fingering.fret;
    for (
      let i = from + 1;
      i < Math.min(to, song.measures.length * slots);
      i++
    ) {
      const m = song.measures[Math.floor(i / slots)];
      m.tab ??= { slots: Array.from({ length: slots }, emptySlot) };
      if (m.tab.slots[i % slots][n.fingering.string] !== null)
        throw new Error(
          "Confirmed notes overlap on one string. Correct their duration or fingering.",
        );
      m.tab.slots[i % slots][n.fingering.string] = "hold";
    }
  }
  t.chartSignature = audioChartSignature(song);
}
