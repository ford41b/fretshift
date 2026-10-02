import { z } from "zod";
import {
  type Song,
  type Tuning,
  type Slot,
  newSong,
  emptySlot,
  resolveTuning,
  SongV1,
} from "../schema/song.v1";
import { fretsFor } from "../theory/pitch";
import { chordToTab, scoreDifficulty } from "../transforms";
export const ImportedNoteSchema = z.object({
  start: z.number().nonnegative(),
  duration: z.number().positive(),
  midi: z.number().int(),
  string: z.number().int().min(0).max(5).optional(),
  muted: z.boolean().optional(),
});
export type ImportedNote = z.infer<typeof ImportedNoteSchema>;
export const TrackChoiceSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  notes: z.number().int().optional(),
});
export type TrackChoice = z.infer<typeof TrackChoiceSchema>;
export class TrackSelectionError extends Error {
  constructor(public tracks: TrackChoice[]) {
    super("Choose the guitar track to import.");
    this.name = "TrackSelectionError";
  }
}
export function materializeTab(input: Song) {
  const song = structuredClone(SongV1.parse(input));
  for (let i = 0; i < song.measures.length; i++) {
    const m = song.measures[i];
    if (!m.tab && m.chords.length) {
      const generated = chordToTab({ ...song, measures: [{ ...m, index: 0 }] });
      if (generated.warnings.length)
        throw new Error(generated.warnings.join(" "));
      song.measures[i] = { ...generated.song.measures[0], index: i };
    }
  }
  return song;
}
export function quarterTimeline(input: Song) {
  const song = materializeTab(input),
    tuning = resolveTuning(song.tuningId),
    notes: ImportedNote[] = [],
    active: (ImportedNote | null)[] = Array(6).fill(null),
    measures: { start: number; duration: number }[] = [];
  let time = 0;
  for (const m of song.measures) {
    const [n, d] = m.timeSignature ?? song.timeSignature,
      step = 4 / d / m.subdivision;
    measures.push({ start: time, duration: (n * 4) / d });
    for (let i = 0; i < n * m.subdivision; i++) {
      const slot = m.tab?.slots[i] ?? emptySlot();
      for (let st = 0; st < 6; st++) {
        const c = slot[st];
        if (c === "hold" && active[st]) active[st]!.duration += step;
        else if (typeof c === "number" || c === "x") {
          const note = {
            start: time + i * step,
            duration: step,
            midi: tuning.midi[st] + song.capo + (typeof c === "number" ? c : 0),
            string: st,
            muted: c === "x",
          };
          notes.push(note);
          active[st] = c === "x" ? null : note;
        } else active[st] = null;
      }
    }
    time += (n * 4) / d;
  }
  return { song, notes, measures, duration: time };
}
function assign(
  notes: ImportedNote[],
  occupied: Set<number>,
  tuning: Tuning,
  capo: number,
) {
  let best: { cost: number; strings: number[] } | undefined;
  const walk = (
    i: number,
    strings: number[],
    used: Set<number>,
    cost: number,
  ) => {
    if (best && best.cost <= cost) return;
    if (i === notes.length) {
      best = { cost, strings: [...strings] };
      return;
    }
    const choices = fretsFor(tuning, notes[i].midi, capo).filter(
      (c) => notes[i].string === undefined || c.stringIdx === notes[i].string,
    );
    for (const c of choices) {
      if (used.has(c.stringIdx)) continue;
      used.add(c.stringIdx);
      strings.push(c.stringIdx);
      walk(
        i + 1,
        strings,
        used,
        cost + c.fret + Math.abs(2.5 - c.stringIdx) * 0.001,
      );
      strings.pop();
      used.delete(c.stringIdx);
    }
  };
  walk(0, [], new Set(occupied), 0);
  return best?.strings;
}
export function placeImportedNotes(song: Song, raw: ImportedNote[]) {
  const notes = z.array(ImportedNoteSchema).parse(raw),
    tuning = resolveTuning(song.tuningId),
    assignments = new Map<ImportedNote, number>();
  let time = 0;
  for (const [mi, m] of song.measures.entries()) {
    const [n, d] = m.timeSignature ?? song.timeSignature,
      step = 4 / d / m.subdivision,
      end = time + (n * 4) / d;
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    for (const note of notes) {
      for (const edge of [note.start, note.start + note.duration])
        if (
          edge > time + 1e-6 &&
          edge < end - 1e-6 &&
          !near((edge - time) / step, Math.round((edge - time) / step))
        )
          throw new Error(
            `Measure ${mi + 1}: note timing needs tuplets or a finer grid; it cannot be imported without changing rhythm.`,
          );
    }
    const slots: Slot[] = [];
    for (let i = 0; i < n * m.subdivision; i++) {
      const at = time + i * step,
        slot = emptySlot(),
        occupied = new Set<number>();
      for (const note of notes) {
        if (
          !note.muted &&
          note.start < at - 1e-6 &&
          note.start + note.duration > at + 1e-6
        ) {
          const st = assignments.get(note);
          if (st === undefined)
            throw new Error("A sustained note has no preceding strike.");
          slot[st] = "hold";
          occupied.add(st);
        }
      }
      const attacks = notes.filter((note) => near(note.start, at));
      const strings = assign(attacks, occupied, tuning, song.capo);
      if (!strings)
        throw new Error(
          `Measure ${mi + 1}, beat ${i / m.subdivision + 1}: pitches do not fit six guitar strings at frets 0–22.`,
        );
      attacks.forEach((note, j) => {
        const st = strings[j];
        assignments.set(note, st);
        slot[st] = note.muted ? "x" : note.midi - tuning.midi[st] - song.capo;
      });
      slots.push(slot);
    }
    m.tab = { slots };
    time = end;
  }
  if (notes.some((n) => n.start + n.duration > time + 1e-6))
    throw new Error("The imported score ends before its final note.");
  song.difficulty = scoreDifficulty(song);
  return SongV1.parse(song);
}
export function blankImported(
  title: string,
  source: "midi" | "musicxml" | "guitarpro",
) {
  const song = newSong(title);
  song.measures = [];
  song.provenance = { source, processedAt: new Date().toISOString() };
  return song;
}
