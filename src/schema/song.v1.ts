import { z } from "zod";
import { NoteTranscriptionSchema } from "./audioNotes";
import { StrummingStateSchema } from "../strumming/schema";
import { NoteNameSchema, parseChordName } from "../theory/chordName";
export { NoteNameSchema } from "../theory/chordName";
export type { NoteName } from "../theory/chordName";
export const A4_HZ_DEFAULT = 440,
  MAX_FRET = 22,
  MAX_CAPO = 7,
  STRING_COUNT = 6;
const six = <T extends z.ZodTypeAny>(s: T) => z.tuple([s, s, s, s, s, s]);
export const KeySchema = z.object({
  root: NoteNameSchema,
  mode: z.enum(["major", "minor"]),
});
export type Key = z.infer<typeof KeySchema>;
export const TuningSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  midi: six(z.number().int().min(0).max(127)),
  builtIn: z.boolean(),
});
export type Tuning = z.infer<typeof TuningSchema>;
export const BUILT_IN_TUNINGS: Tuning[] = [
  {
    id: "standard",
    label: "Standard (EADGBE)",
    midi: [64, 59, 55, 50, 45, 40],
    builtIn: true,
  },
  {
    id: "drop-d",
    label: "Drop D",
    midi: [64, 59, 55, 50, 45, 38],
    builtIn: true,
  },
  {
    id: "dadgad",
    label: "DADGAD",
    midi: [62, 57, 55, 50, 45, 38],
    builtIn: true,
  },
  {
    id: "open-g",
    label: "Open G",
    midi: [62, 59, 55, 50, 43, 38],
    builtIn: true,
  },
  {
    id: "open-d",
    label: "Open D",
    midi: [62, 57, 54, 50, 45, 38],
    builtIn: true,
  },
  {
    id: "drop-c",
    label: "Drop C",
    midi: [62, 57, 53, 48, 43, 36],
    builtIn: true,
  },
  {
    id: "half-down",
    label: "Half-step down",
    midi: [63, 58, 54, 49, 44, 39],
    builtIn: true,
  },
];
const tunings = new Map(BUILT_IN_TUNINGS.map((t) => [t.id, t]));
export function registerTuning(raw: unknown) {
  const t = TuningSchema.parse(raw);
  if (
    tunings.has(t.id) &&
    tunings.get(t.id)?.builtIn &&
    JSON.stringify(t) !== JSON.stringify(tunings.get(t.id))
  )
    throw new Error("Built-in tunings cannot be changed.");
  tunings.set(t.id, t);
  return t;
}
export function resolveTuning(id: string): Tuning {
  const t = tunings.get(id);
  if (!t)
    throw new Error(
      `Unknown tuning “${id}”. Import or create this custom tuning first.`,
    );
  return t;
}
export const FretSchema = z.union([
  z.number().int().min(0).max(MAX_FRET),
  z.literal("x"),
]);
export type Fret = z.infer<typeof FretSchema>;
export const FingerSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type Finger = z.infer<typeof FingerSchema>;
export const VoicingSchema = z.object({
  frets: six(FretSchema),
  barre: z
    .object({
      fret: z.number().int().min(1).max(MAX_FRET),
      fromString: z.number().int().min(0).max(5),
      toString: z.number().int().min(0).max(5),
    })
    .optional(),
  fingering: six(FingerSchema).optional(),
});
export type Voicing = z.infer<typeof VoicingSchema>;
export const ChordNameSchema = z.string().refine((n) => {
  try {
    parseChordName(n);
    return true;
  } catch {
    return false;
  }
}, "Invalid chord name.");
export const ChordEventSchema = z.object({
  id: z.string().min(1),
  beat: z.number().min(0),
  chordName: ChordNameSchema,
  /** Exact reviewed attack in the source recording; chart beat may be quantized. */
  audioTimeSeconds: z.number().nonnegative().optional(),
  voicing: VoicingSchema.optional(),
  voicingPinned: z.boolean().optional(),
});
export type ChordEvent = z.infer<typeof ChordEventSchema>;
export const CellSchema = z.union([
  z.number().int().min(0).max(MAX_FRET),
  z.null(),
  z.literal("hold"),
  z.literal("x"),
]);
export type Cell = z.infer<typeof CellSchema>;
export const SlotSchema = six(CellSchema);
export type Slot = z.infer<typeof SlotSchema>;
export const TabFrameSchema = z.object({ slots: z.array(SlotSchema) });
export type TabFrame = z.infer<typeof TabFrameSchema>;
export const SectionKindSchema = z.enum([
  "intro",
  "verse",
  "prechorus",
  "chorus",
  "bridge",
  "solo",
  "outro",
  "custom",
]);
export type SectionKind = z.infer<typeof SectionKindSchema>;
export const SectionSchema = z.object({
  kind: SectionKindSchema,
  label: z.string().optional(),
});
export type Section = z.infer<typeof SectionSchema>;
export const TimeSignatureSchema = z.tuple([
  z.number().int().min(1).max(32),
  z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
]);
export const MeasureSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0),
  timeSignature: TimeSignatureSchema.optional(),
  tempoOverride: z.number().min(20).max(400).optional(),
  subdivision: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  section: SectionSchema.optional(),
  lyrics: z.string().optional(),
  chords: z.array(ChordEventSchema),
  tab: TabFrameSchema.optional(),
  outOfRange: z.boolean().optional(),
  /** Explicitly confirmed musical timing; absent/false for inferred PDF/OCR timing. */
  timingConfirmed: z.boolean().optional(),
  sourceLine: z.string().optional(),
});
export type Measure = z.infer<typeof MeasureSchema>;
export const ProvenanceSchema = z.object({
  source: z.enum([
    "photo",
    "pdf-scan",
    "pdf-text",
    "audio",
    "midi",
    "musicxml",
    "guitarpro",
    "chordpro",
    "manual",
    "json",
    "youtube",
  ]),
  confidence: z.record(z.number().min(0).max(1)).optional(),
  overallConfidence: z.number().min(0).max(1).optional(),
  modelId: z.string().optional(),
  promptVersion: z.string().optional(),
  processedAt: z.string().optional(),
  timingNeedsConfirmation: z.boolean().optional(),
  audioReview: z.object({
    noteTranscription: NoteTranscriptionSchema.optional(),
    fileName: z.string(),
    fileSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    duration: z.number().finite().positive(),
    waveform: z.array(z.number().finite().min(0).max(1)),
    detected: z.object({
      tempoBpm: z.number().finite().nullable(),
      beats: z.array(z.number().finite().nonnegative()),
      downbeats: z.array(z.number().finite().nonnegative()),
      meter: z.union([z.literal(3), z.literal(4), z.null()]),
      beatProviderId: z.string().optional(),
      beatStatus: z.enum(["estimated", "insufficient-evidence"]).optional(),
      beatEvidence: z.number().finite().optional(),
      beatWarnings: z.array(z.string()).optional(),
      chordProviderId: z.string().optional(),
      chordWarnings: z.array(z.string()).optional(),
      vocabulary: z.array(z.string()).optional(),
      segments: z.array(z.object({
        start: z.number().finite().nonnegative(), end: z.number().finite().positive(),
        label: z.string().nullable(),
        status: z.enum(["estimated", "ambiguous", "no-chord"]),
        alternatives: z.array(z.object({ label: z.string(), score: z.number().finite() })),
      })),
    }),
    reviewed: z.object({
      tempoBpm: z.number().finite(), beats: z.array(z.number().finite().nonnegative()),
      meter: z.union([z.literal(3), z.literal(4)]),
      firstDownbeatIndex: z.number().finite().int().nonnegative(),
      timingConfirmed: z.boolean(),
      segments: z.array(z.object({
        id: z.string(), start: z.number().finite().nonnegative(), end: z.number().finite().positive(),
        label: z.string().nullable(),
        decision: z.enum(["detected", "corrected", "unknown", "no-chord"]),
        reviewed: z.boolean(),
      })),
    }),
  }).optional(),
  /** YouTube link import (source "youtube"). The video itself is never stored. */
  youtube: z.object({
    videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().positive(),
    options: z.object({
      useHints: z.boolean(),
      windowSeconds: z.number().finite().positive().nullable(),
      overlapSeconds: z.number().finite().nonnegative(),
      fps: z.number().finite().positive(),
      passes: z.number().int().min(1).max(3),
      snapToBeats: z.boolean(),
    }),
    requests: z.number().int().nonnegative(),
    keyGuess: z.string().nullable(),
    capoGuess: z.number().int().min(0).max(12).nullable(),
    sections: z.array(z.object({ label: z.string(), startSeconds: z.number().finite().nonnegative(),
      endSeconds: z.number().finite().positive() })),
  }).optional(),
  /** Unresolved imported chord-like source tokens; never silently discard. */
  reviewItems: z.array(z.object({ page: z.number().int().positive(), line: z.number().int().positive(), token: z.string() })).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
/** Sources whose chords carry reviewed media timestamps (audio file or YouTube video). */
export const hasMediaTimeline = (source: Provenance["source"] | undefined) =>
  source === "audio" || source === "youtube";
export const SongBase = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  artist: z.string(),
  originalKey: KeySchema,
  currentKey: KeySchema,
  tuningId: z.string(),
  capo: z.number().int().min(0).max(MAX_CAPO),
  tempo: z.number().min(20).max(400),
  timeSignature: TimeSignatureSchema,
  difficulty: z.number().int().min(1).max(10),
  difficultyOverride: z.number().int().min(1).max(10).optional(),
  tags: z.array(z.string()),
  measures: z.array(MeasureSchema),
  provenance: ProvenanceSchema.optional(),
  strumming: StrummingStateSchema.optional(),
  referenceAudio: z
    .object({
      fileName: z.string(),
      offsetMs: z.number(),
      sourceTempo: z.number().positive(),
    })
    .optional(),
  ownerId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});
export const SongV1 = SongBase.superRefine((song, ctx) => {
  if (!tunings.has(song.tuningId))
    ctx.addIssue({
      code: "custom",
      path: ["tuningId"],
      message: `Unknown tuning “${song.tuningId}”.`,
    });
  const audio = song.provenance?.audioReview, nt = audio?.noteTranscription;
  const youtube = song.provenance?.youtube;
  if (youtube && (song.provenance?.source !== "youtube" || !audio || youtube.startSeconds >= youtube.endSeconds))
    ctx.addIssue({ code: "custom", path: ["provenance", "youtube"],
      message: "YouTube provenance needs the youtube source, a reviewed timeline and an increasing analyzed range." });
  if (audio) {
    const r = audio.reviewed;
    const issue = (message: string) => ctx.addIssue({code:"custom",path:["provenance","audioReview"],message});
    if (r.tempoBpm < 20 || r.tempoBpm > 400 || r.beats.length < r.firstDownbeatIndex + r.meter ||
      r.beats.some((b,i)=>b>=audio.duration || (i>0 && b<=r.beats[i-1])))
      issue("Audio requires an increasing beat grid inside the recording, a complete first measure and a tempo from 20 to 400 BPM.");
    const regionIds = new Set<string>();
    for (const [i, segment] of r.segments.entries()) {
      if (!segment.id || regionIds.has(segment.id) || segment.start >= segment.end || segment.end > audio.duration + .0001 ||
        (i > 0 && segment.start < r.segments[i-1].end - .0001)) issue("Audio regions need unique identities and ordered, nonoverlapping times inside the recording.");
      regionIds.add(segment.id);
      if ((segment.decision === "unknown" || segment.decision === "no-chord") && segment.label !== null)
        issue("Unknown and No chord regions cannot contain a chord label.");
    }
  }
  if (audio && nt) {
    const r = audio.reviewed, tuning = tunings.get(nt.options.tuningId);
    const issue = (message: string) => ctx.addIssue({code:"custom",path:["provenance","audioReview","noteTranscription"],message});
    if (!tuning) issue("Unknown note-transcription tuning.");
    if (r.beats.length < 2 || r.firstDownbeatIndex >= r.beats.length ||
      r.beats.some((b,i)=>!Number.isFinite(b) || b>=audio.duration || (i>0 && b<=r.beats[i-1])))
      issue("Notes require an increasing beat grid inside the recording.");
    const detectedIds = new Set<string>();
    for (const n of nt.detected.notes) {
      if (!n.id || detectedIds.has(n.id) || n.end > audio.duration) issue("Invalid detected note identity or source timing.");
      detectedIds.add(n.id);
    }
    if (nt.detected.frames.some((f,i) => f.time >= audio.duration || (i > 0 && f.time <= nt.detected.frames[i-1].time)))
      issue("Detected frames must increase inside the recording.");
    const ids = new Set<string>();
    for (const n of nt.notes) {
      if (ids.has(n.id) || n.end>audio.duration || (n.detectedId!==null && !detectedIds.has(n.detectedId)))
        issue("Invalid note identity or source timing.");
      ids.add(n.id);
      if (n.confirmed && !n.fingering) issue("Confirmed notes need a playable fingering.");
      const f=n.fingering;
      if (f && ((tuning?.midi[f.string] ?? -1000)+nt.options.capo+f.fret!==n.midi ||
        !nt.options.availableStrings.includes(f.string) || f.fret<nt.options.minFret ||
        f.fret>nt.options.maxFret || f.fret+nt.options.capo>MAX_FRET)) issue("Fingering must match sounding pitch and guitar constraints.");
    }
  }
  const active: boolean[] = Array(6).fill(false);
  const ids = new Set<string>();
  song.measures.forEach((m, mi) => {
    if (ids.has(m.id))
      ctx.addIssue({
        code: "custom",
        path: ["measures", mi, "id"],
        message: "Measure IDs must be unique.",
      });
    ids.add(m.id);
    const beats = (m.timeSignature ?? song.timeSignature)[0];
    const slots = beats * m.subdivision;
    m.chords.forEach((c, ci) => {
      if (
        c.beat >= beats ||
        Math.abs(c.beat * m.subdivision - Math.round(c.beat * m.subdivision)) >
          1e-8
      )
        ctx.addIssue({
          code: "custom",
          path: ["measures", mi, "chords", ci, "beat"],
          message:
            "Chord beat must be inside the measure and aligned to the grid.",
        });
    });
    if (m.tab) {
      if (m.tab.slots.length !== slots)
        ctx.addIssue({
          code: "custom",
          path: ["measures", mi, "tab", "slots"],
          message: `Expected ${slots} slots for ${beats} beats × ${m.subdivision}.`,
        });
      m.tab.slots.forEach((slot, si) =>
        slot.forEach((c, st) => {
          if (c === "hold" && !active[st])
            ctx.addIssue({
              code: "custom",
              path: ["measures", mi, "tab", "slots", si, st],
              message: `Orphan hold on string ${st + 1}: strike a note before sustaining it.`,
            });
          active[st] = typeof c === "number" || (c === "hold" && active[st]);
        }),
      );
    } else active.fill(false);
  });
});
export type Song = z.infer<typeof SongV1>;
export const emptySlot = (): Slot => [null, null, null, null, null, null];
export const newMeasure = (index: number, beats = 4): Measure => ({
  id: crypto.randomUUID(),
  index,
  subdivision: 2,
  chords: [],
  tab: { slots: Array.from({ length: beats * 2 }, emptySlot) },
});
export function newSong(title = "Untitled song"): Song {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title,
    artist: "",
    originalKey: { root: "C", mode: "major" },
    currentKey: { root: "C", mode: "major" },
    tuningId: "standard",
    capo: 0,
    tempo: 120,
    timeSignature: [4, 4],
    difficulty: 1,
    tags: [],
    measures: [newMeasure(0)],
    provenance: { source: "manual" },
    createdAt: now,
    updatedAt: now,
  };
}
